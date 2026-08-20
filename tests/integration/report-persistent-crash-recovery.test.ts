import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  configureDatabase,
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
} from "../../packages/database/src/index.js";
import { ReportExportRepository } from "../../packages/reports/src/report-export-repository.js";
import { ReportFinalizationExecutor } from "../../packages/reports/src/report-finalization-executor.js";
import { ReportFinalizationRecoveryService } from "../../packages/reports/src/report-finalization-recovery-service.js";
import { seedReportFixture, type ReportFixtureScenario } from "./report-fixtures.js";
import { spawnPersistentCrashWorker } from "./report-persistent-crash-worker.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("M10 persistent report finalization crash boundaries", () => {
  it("restarts after rename-before-READY and retries HTML/ZIP without device work", async () => {
    for (const kind of ["HTML", "ZIP"] as const) {
      const root = await mkdtemp(join(tmpdir(), "test-center-m10-persistent-crash-"));
      roots.push(root);
      const runRoot = join(root, "runs");
      const databasePath = join(root, "reports.sqlite");
      const runId = `fixture-persistent-${kind.toLowerCase()}`;
      const timestamp = "2026-08-20T00:00:00.000Z";

      const database = openDatabase(databasePath);
      await seedReportFixture(database, runRoot, "normal" satisfies ReportFixtureScenario, runId);
      const exports = new ReportExportRepository(database, { runRoot, now: () => timestamp });
      exports.create({
        id: `report-html-${runId}-1`,
        runId,
        format: "HTML",
        finalRelativePath: `${runId}/reports/report-1.html`,
        attempt: 1,
      });
      exports.create({
        id: `report-zip-${runId}-1`,
        runId,
        format: "ZIP",
        finalRelativePath: `${runId}/reports/evidence-1.zip`,
        attempt: 1,
      });
      database.close();

      const child = await spawnPersistentCrashWorker({
        databasePath,
        runRoot,
        runId,
        crashKind: kind,
      });
      expect(child.status, child.stderr).toBe(75);

      const recoveredDatabase = openDatabase(databasePath);
      try {
        const recoveryAsOf = new Date(Date.now() + 60_000).toISOString();
        const recovery = new ReportFinalizationRecoveryService(recoveredDatabase, {
          staleAfterMs: 0,
          now: () => recoveryAsOf,
        });
        expect(recovery.reconcileStale(recoveryAsOf)).toMatchObject([
          { runId, state: "INTERRUPTED", attempt: 1, errorCategory: "STARTUP_INTERRUPTED" },
        ]);

        const firstAttempt = recoveredDatabase
          .prepare(
            "SELECT format, state, error_category FROM report_exports WHERE run_id = ? AND attempt = 1 ORDER BY format ASC",
          )
          .all(runId);
        expect(firstAttempt).toEqual(
          kind === "HTML"
            ? [
                { format: "HTML", state: "FAILED", error_category: "STARTUP_INTERRUPTED" },
                { format: "ZIP", state: "FAILED", error_category: "STARTUP_INTERRUPTED" },
              ]
            : [
                { format: "HTML", state: "READY", error_category: null },
                { format: "ZIP", state: "FAILED", error_category: "STARTUP_INTERRUPTED" },
              ],
        );

        const finalPath = join(
          runRoot,
          runId,
          "reports",
          kind === "HTML" ? "report-1.html" : "evidence-1.zip",
        );
        await expect(readFile(finalPath)).resolves.toBeTruthy();

        const retried = await new ReportFinalizationExecutor(recoveredDatabase, {
          runRoot,
        }).retryFinalization(runId, `retry-${kind}`);
        expect(retried).toMatchObject({ runId, state: "COMPLETED", attempt: 2 });
        expect(
          recoveredDatabase
            .prepare(
              "SELECT format, state, attempt FROM report_exports WHERE run_id = ? ORDER BY attempt ASC, format ASC",
            )
            .all(runId),
        ).toEqual([
          ...(kind === "HTML"
            ? [
                { format: "HTML", state: "FAILED", attempt: 1 },
                { format: "ZIP", state: "FAILED", attempt: 1 },
              ]
            : [
                { format: "HTML", state: "READY", attempt: 1 },
                { format: "ZIP", state: "FAILED", attempt: 1 },
              ]),
          { format: "HTML", state: "READY", attempt: 2 },
          { format: "ZIP", state: "READY", attempt: 2 },
        ]);
      } finally {
        recoveredDatabase.close();
      }
    }
  }, 30_000);
});

function openDatabase(databasePath: string): Database.Database {
  const database = new Database(databasePath);
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    UID_BRIDGE_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    SESSION_API_MIGRATION,
    ACTION_COMMANDS_MIGRATION,
    INCIDENTS_MIGRATION,
    RUN_MEMBERSHIP_MIGRATION,
    RUN_FAILURE_POLICY_MIGRATION,
    EVIDENCE_REPORTS_MIGRATION,
    REPORT_FINALIZATION_MIGRATION,
  ]);
  return database;
}
