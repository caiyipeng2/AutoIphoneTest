import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
} from "@test-center/database/migrations";
import { ReportFinalizationRecoveryService } from "./report-finalization-recovery-service.js";

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
    EVIDENCE_REPORTS_MIGRATION,
    REPORT_FINALIZATION_MIGRATION,
  ]);
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, 'Idle Weapon Shop Tycoon', ?, 1, 'nonce', ?, ?)`,
    )
    .run("run-stale", "FINISHED", "2026-08-14T00:00:00.000Z", "2026-08-14T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, 'Idle Weapon Shop Tycoon', ?, 1, 'nonce', ?, ?)`,
    )
    .run("run-fresh", "FAILED", "2026-08-14T00:00:00.000Z", "2026-08-14T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO run_finalizations
       (run_id, state, attempt, started_at, updated_at)
       VALUES ('run-stale', 'FINALIZING', 2, '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z'),
              ('run-fresh', 'FINALIZING', 1, '2026-08-14T00:00:00.000Z', '2026-08-17T12:59:30.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO report_exports
       (id, run_id, format, state, attempt, created_at, updated_at)
       VALUES ('export-stale', 'run-stale', 'HTML', 'PENDING', 1,
               '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
    )
    .run();
  return database;
}

describe("report finalization recovery service", () => {
  it("interrupts stale finalization and its terminal source run", () => {
    const database = openDatabase();
    const service = new ReportFinalizationRecoveryService(database, {
      now: () => "2026-08-17T13:00:00.000Z",
      staleAfterMs: 60_000,
    });

    expect(service.reconcileStale()).toMatchObject([
      {
        runId: "run-stale",
        state: "INTERRUPTED",
        attempt: 2,
        errorCategory: "STARTUP_INTERRUPTED",
      },
    ]);
    expect(
      database.prepare("SELECT state FROM test_runs WHERE id = 'run-stale'").pluck().get(),
    ).toBe("INTERRUPTED");
    expect(
      database.prepare("SELECT state FROM report_exports WHERE id = 'export-stale'").pluck().get(),
    ).toBe("FAILED");
    expect(service.reconcileStale()).toEqual([]);
  });

  it("leaves fresh FINALIZING work untouched", () => {
    const database = openDatabase();
    const service = new ReportFinalizationRecoveryService(database, {
      now: () => "2026-08-17T13:00:00.000Z",
      staleAfterMs: 60_000,
    });

    expect(service.reconcileStale()).toHaveLength(1);
    expect(service.get("run-fresh")).toMatchObject({ state: "FINALIZING", attempt: 1 });
    expect(
      database.prepare("SELECT state FROM test_runs WHERE id = 'run-fresh'").pluck().get(),
    ).toBe("FAILED");
  });

  it("removes only orphan publisher partials and preserves complete files", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-recovery-files-"));
    roots.push(root);
    await mkdir(join(root, "run-1", "reports"), { recursive: true });
    await writeFile(join(root, "run-1", "reports", "report.html.partial-crash"), "partial");
    await writeFile(join(root, "run-1", "reports", "report.html"), "complete");

    const removed = await new ReportFinalizationRecoveryService(database).reconcileOrphanedPartials(
      root,
    );

    expect(removed).toEqual(["run-1/reports/report.html.partial-crash"]);
    expect(await readdir(join(root, "run-1", "reports"))).toEqual(["report.html"]);
  });
});
