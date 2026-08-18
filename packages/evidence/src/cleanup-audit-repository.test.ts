import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLEANUP_AUDIT_MIGRATION,
  configureDatabase,
  FOUNDATION_MIGRATION,
  migrate,
  RUN_ACTIONS_MIGRATION,
} from "@test-center/database";

import { CleanupAuditRepository } from "./cleanup-audit-repository.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createRepository(): { database: Database.Database; repository: CleanupAuditRepository } {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [FOUNDATION_MIGRATION, RUN_ACTIONS_MIGRATION, CLEANUP_AUDIT_MIGRATION]);
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, 'Idle Weapon Shop Tycoon', 'FINISHED', 1, 'nonce', ?, ?)`,
    )
    .run("run-a", "2026-08-18T00:00:00.000Z", "2026-08-18T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, 'Idle Weapon Shop Tycoon', 'FAILED', 1, 'nonce', ?, ?)`,
    )
    .run("run-b", "2026-08-18T00:00:00.000Z", "2026-08-18T00:00:00.000Z");
  databases.push(database);
  return {
    database,
    repository: new CleanupAuditRepository(database, { now: () => "2026-08-18T01:00:00.000Z" }),
  };
}

describe("cleanup audit repository", () => {
  it("marks selected runs DELETING atomically and refuses a second transition", () => {
    const { database, repository } = createRepository();

    expect(repository.markDeleting(["run-b", "run-a"])).toEqual(["run-a", "run-b"]);
    expect(database.prepare("SELECT id, cleanup_state FROM test_runs ORDER BY id").all()).toEqual([
      { id: "run-a", cleanup_state: "DELETING" },
      { id: "run-b", cleanup_state: "DELETING" },
    ]);
    expect(() => repository.markDeleting(["run-a"])).toThrow(/cleanup state/i);
  });

  it("appends cleanup events without overwriting earlier evidence", () => {
    const { repository } = createRepository();

    repository.appendEvent({ cleanupId: "cleanup-1", kind: "STARTED", runId: "run-a" });
    repository.appendEvent({
      cleanupId: "cleanup-1",
      kind: "RUN_MOVED",
      runId: "run-a",
      sourcePath: "E:\\data\\runs\\run-a",
      trashPath: "E:\\data\\trash\\cleanup-1\\run-a",
    });
    repository.appendEvent({ cleanupId: "cleanup-1", kind: "COMPLETED" });

    expect(repository.listEvents("cleanup-1")).toMatchObject([
      { sequence: 1, kind: "STARTED", runId: "run-a" },
      { sequence: 2, kind: "RUN_MOVED", runId: "run-a" },
      { sequence: 3, kind: "COMPLETED" },
    ]);
  });

  it("rejects unknown runs and invalid event identifiers", () => {
    const { repository } = createRepository();

    expect(() => repository.markDeleting(["missing-run"])).toThrow(/run/i);
    expect(() => repository.appendEvent({ cleanupId: "../escape", kind: "STARTED" })).toThrow(
      /cleanup ID/i,
    );
    expect(() => repository.appendEvent({ cleanupId: "cleanup-1", kind: "RUN_MOVED" })).toThrow(
      /run ID/i,
    );
  });
});
