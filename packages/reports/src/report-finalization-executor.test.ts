import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  DEVICES_MIGRATION,
  EVIDENCE_REPORTS_MIGRATION,
  FOUNDATION_MIGRATION,
  INCIDENTS_MIGRATION,
  migrate,
  REPORT_FINALIZATION_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  RUN_FAILURE_POLICY_MIGRATION,
  RUN_MEMBERSHIP_MIGRATION,
  SESSION_API_MIGRATION,
  UID_BRIDGE_MIGRATION,
} from "@test-center/database/migrations";
import { ReportFinalizationExecutor } from "./report-finalization-executor.js";

const databases: Database.Database[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function openDatabase(): Database.Database {
  const database = new Database(":memory:");
  databases.push(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    SESSION_API_MIGRATION,
    ACTION_COMMANDS_MIGRATION,
    INCIDENTS_MIGRATION,
    RUN_MEMBERSHIP_MIGRATION,
    RUN_FAILURE_POLICY_MIGRATION,
    UID_BRIDGE_MIGRATION,
    EVIDENCE_REPORTS_MIGRATION,
    REPORT_FINALIZATION_MIGRATION,
  ]);
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES ('run-1', 'Idle Weapon Shop Tycoon', 'FINISHED', 1, 'nonce',
               '2026-08-18T01:00:00.000Z', '2026-08-18T01:05:00.000Z')`,
    )
    .run();
  return database;
}

describe("report finalization executor", () => {
  it("rebuilds failed reports from the snapshot and deduplicates the same request", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-finalization-executor-"));
    roots.push(root);
    const evidence = "evidence\n";
    database
      .prepare(
        `INSERT INTO evidence_records
         (id, run_id, kind, state, final_relative_path, sha256, size_bytes, attempt, created_at, updated_at)
         VALUES ('ev-1', 'run-1', 'RUN_EVENT', 'READY', 'evidence/event.txt', ?, ?, 1,
                 '2026-08-18T01:05:00.000Z', '2026-08-18T01:05:00.000Z')`,
      )
      .run(createHash("sha256").update(evidence).digest("hex"), Buffer.byteLength(evidence));

    const executor = new ReportFinalizationExecutor(database, { runRoot: root });
    let firstFailure: unknown;
    try {
      await executor.retryFinalization("run-1", "retry-1");
    } catch (error) {
      firstFailure = error;
    }
    expect(firstFailure).toBeInstanceOf(Error);
    expect(
      database.prepare("SELECT state, attempt FROM run_finalizations WHERE run_id = 'run-1'").get(),
    ).toEqual({ state: "FINALIZATION_FAILED", attempt: 1 });

    await mkdir(join(root, "run-1", "evidence"), { recursive: true });
    await writeFile(join(root, "run-1", "evidence", "event.txt"), evidence);
    const completed = await executor.retryFinalization("run-1", "retry-2");
    expect(completed).toMatchObject({ state: "COMPLETED", attempt: 2 });

    const duplicate = await executor.retryFinalization("run-1", "retry-2");
    expect(duplicate).toEqual(completed);
    expect(
      database
        .prepare(
          "SELECT format, state, attempt FROM report_exports WHERE run_id = 'run-1' ORDER BY format, attempt",
        )
        .all(),
    ).toEqual([
      { format: "HTML", state: "READY", attempt: 1 },
      { format: "HTML", state: "READY", attempt: 2 },
      { format: "ZIP", state: "FAILED", attempt: 1 },
      { format: "ZIP", state: "READY", attempt: 2 },
    ]);
    expect(await readFile(join(root, "run-1", "reports", "report-2.html"), "utf8")).toContain(
      "Idle Weapon Shop Tycoon",
    );
    expect(
      (await readFile(join(root, "run-1", "reports", "evidence-2.zip"))).subarray(0, 2),
    ).toEqual(Buffer.from("PK"));
  });
});
