import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLEANUP_AUDIT_MIGRATION,
  configureDatabase,
  FOUNDATION_MIGRATION,
  migrate,
  RUN_ACTIONS_MIGRATION,
} from "@test-center/database";

import {
  CleanupExecutionService,
  type CleanupExecutionConfirmation,
  type CleanupExecutionFileSystem,
  type CleanupExecutionMover,
} from "./cleanup-execution-service.js";
import { CleanupAuditRepository } from "./cleanup-audit-repository.js";
import type {
  CleanupMoveRequest,
  CleanupMovedRun,
  CleanupMoveResult,
} from "./cleanup-trash-mover.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

class ConfirmationSpy implements CleanupExecutionConfirmation {
  public readonly calls: Array<{
    runIds: readonly string[];
    expectedBytes: number;
    nonce: string;
  }> = [];
  public reject = false;

  public consume(input: { runIds: readonly string[]; expectedBytes: number; nonce: string }): void {
    if (this.reject) throw new Error("confirmation rejected");
    this.calls.push(input);
  }
}

class MoverStub implements CleanupExecutionMover {
  public readonly moveCalls: CleanupMoveRequest[] = [];
  public readonly restoreCalls: CleanupMoveResult[] = [];
  public rejectRestore = false;

  public async move(request: CleanupMoveRequest): Promise<CleanupMoveResult> {
    this.moveCalls.push(request);
    return {
      cleanupId: request.cleanupId,
      moved: request.runIds.map((runId) => ({
        runId,
        sourcePath: `E:\\TestCenter\\data\\runs\\${runId}`,
        trashPath: `E:\\TestCenter\\data\\trash\\${request.cleanupId}\\${runId}`,
      })),
    };
  }

  public async restore(
    _request: CleanupMoveRequest,
    result: CleanupMoveResult,
  ): Promise<readonly CleanupMovedRun[]> {
    this.restoreCalls.push(result);
    if (this.rejectRestore) throw new Error("restore failed");
    return result.moved;
  }
}

class FileSystemStub implements CleanupExecutionFileSystem {
  public readonly removeCalls: string[] = [];
  public failOnCall: number | undefined;

  public async remove(path: string): Promise<void> {
    this.removeCalls.push(path);
    if (this.removeCalls.length === this.failOnCall) throw new Error("remove failed");
  }
}

function createService(): {
  database: Database.Database;
  repository: CleanupAuditRepository;
  confirmation: ConfirmationSpy;
  mover: MoverStub;
  fileSystem: FileSystemStub;
  service: CleanupExecutionService;
} {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [FOUNDATION_MIGRATION, RUN_ACTIONS_MIGRATION, CLEANUP_AUDIT_MIGRATION]);
  for (const runId of ["run-a", "run-b"]) {
    database
      .prepare(
        `INSERT INTO test_runs
         (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
         VALUES (?, 'Idle Weapon Shop Tycoon', 'FINISHED', 1, 'nonce', ?, ?)`,
      )
      .run(runId, "2026-08-18T00:00:00.000Z", "2026-08-18T00:00:00.000Z");
  }
  databases.push(database);
  const repository = new CleanupAuditRepository(database, {
    now: () => "2026-08-18T01:00:00.000Z",
  });
  const confirmation = new ConfirmationSpy();
  const mover = new MoverStub();
  const fileSystem = new FileSystemStub();
  return {
    database,
    repository,
    confirmation,
    mover,
    fileSystem,
    service: new CleanupExecutionService(repository, confirmation, mover, fileSystem),
  };
}

const request = {
  cleanupId: "cleanup-1",
  nonce: "nonce-1",
  runIds: ["run-b", "run-a"],
  expectedBytes: 128,
  runsRoot: "E:\\TestCenter\\data\\runs",
  trashRoot: "E:\\TestCenter\\data\\trash",
};

describe("cleanup execution service", () => {
  it("consumes confirmation, moves, deletes, audits, and marks runs DELETED", async () => {
    const { database, repository, confirmation, mover, fileSystem, service } = createService();

    await expect(service.execute(request)).resolves.toMatchObject({
      cleanupId: "cleanup-1",
      state: "DELETED",
      deleted: ["run-a", "run-b"],
      restored: [],
      unresolved: [],
    });
    expect(confirmation.calls).toEqual([
      { runIds: ["run-a", "run-b"], expectedBytes: 128, nonce: "nonce-1" },
    ]);
    expect(mover.moveCalls[0]?.runIds).toEqual(["run-a", "run-b"]);
    expect(fileSystem.removeCalls).toEqual([
      "E:\\TestCenter\\data\\trash\\cleanup-1\\run-a",
      "E:\\TestCenter\\data\\trash\\cleanup-1\\run-b",
    ]);
    expect(database.prepare("SELECT id, cleanup_state FROM test_runs ORDER BY id").all()).toEqual([
      { id: "run-a", cleanup_state: "DELETED" },
      { id: "run-b", cleanup_state: "DELETED" },
    ]);
    expect(repository.listEvents("cleanup-1").map((event) => event.kind)).toEqual([
      "STARTED",
      "RUN_MOVED",
      "RUN_MOVED",
      "COMPLETED",
    ]);
  });

  it("restores moved runs and marks RECOVERY_REQUIRED when deletion fails", async () => {
    const { database, repository, mover, fileSystem, service } = createService();
    fileSystem.failOnCall = 2;

    await expect(service.execute(request)).resolves.toMatchObject({
      cleanupId: "cleanup-1",
      state: "RECOVERY_REQUIRED",
      deleted: ["run-a"],
      restored: ["run-b"],
      unresolved: [],
    });
    expect(mover.restoreCalls).toHaveLength(1);
    expect(mover.restoreCalls[0]?.moved.map((item) => item.runId)).toEqual(["run-b"]);
    expect(database.prepare("SELECT id, cleanup_state FROM test_runs ORDER BY id").all()).toEqual([
      { id: "run-a", cleanup_state: "RECOVERY_REQUIRED" },
      { id: "run-b", cleanup_state: "RECOVERY_REQUIRED" },
    ]);
    expect(repository.listEvents("cleanup-1").map((event) => event.kind)).toEqual([
      "STARTED",
      "RUN_MOVED",
      "RUN_MOVED",
      "RUN_RESTORED",
      "ROLLED_BACK",
    ]);
  });

  it("does not mutate cleanup state when confirmation is rejected", async () => {
    const { database, confirmation, mover, service } = createService();
    confirmation.reject = true;

    await expect(service.execute(request)).rejects.toThrow(/confirmation rejected/i);
    expect(mover.moveCalls).toHaveLength(0);
    expect(database.prepare("SELECT DISTINCT cleanup_state FROM test_runs").all()).toEqual([
      { cleanup_state: "ACTIVE" },
    ]);
  });

  it("reports unresolved trash paths when restoration also fails", async () => {
    const { mover, fileSystem, service } = createService();
    fileSystem.failOnCall = 2;
    mover.rejectRestore = true;

    await expect(service.execute(request)).resolves.toMatchObject({
      state: "RECOVERY_REQUIRED",
      deleted: ["run-a"],
      restored: [],
      unresolved: ["run-b"],
    });
  });
});
