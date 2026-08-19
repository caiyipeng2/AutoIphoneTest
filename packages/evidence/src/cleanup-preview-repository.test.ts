import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLEANUP_PROTECTION_MIGRATION,
  DEVICES_MIGRATION,
  EVIDENCE_REPORTS_MIGRATION,
  configureDatabase,
  FOUNDATION_MIGRATION,
  migrate,
  REPORT_FINALIZATION_MIGRATION,
  RUN_ACTIONS_MIGRATION,
} from "@test-center/database";

import { CleanupPreviewRepository } from "./cleanup-preview-repository.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createRepository(): { database: Database.Database; repository: CleanupPreviewRepository } {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    EVIDENCE_REPORTS_MIGRATION,
    REPORT_FINALIZATION_MIGRATION,
    CLEANUP_PROTECTION_MIGRATION,
  ]);
  insertRun(database, "run-old", "FINISHED", "2026-07-01T00:00:00.000Z");
  insertRun(database, "run-completed", "FINISHED", "2026-07-01T00:00:00.000Z");
  insertRun(database, "run-protected", "FINISHED", "2026-07-01T00:00:00.000Z");
  insertRun(database, "run-active", "RUNNING", "2026-07-01T00:00:00.000Z");
  insertRun(database, "run-recent", "FINISHED", "2026-08-10T00:00:00.000Z");
  database.prepare("UPDATE test_runs SET cleanup_protected = 1 WHERE id = 'run-protected'").run();
  database
    .prepare(
      `INSERT INTO run_finalizations
       (run_id, state, attempt, started_at, completed_at, updated_at)
       VALUES ('run-completed', 'COMPLETED', 1, ?, ?, ?)`,
    )
    .run("2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z", "2026-07-02T00:00:00.000Z");
  insertEvidence(database, "evidence-old", "run-old", 100);
  insertEvidence(database, "evidence-completed", "run-completed", 150);
  insertReport(database, "report-old", "run-old", 200);
  insertReport(database, "report-completed", "run-completed", 250);
  insertEvidence(database, "evidence-failed", "run-old", 9, "FAILED");
  databases.push(database);
  return { database, repository: new CleanupPreviewRepository(database) };
}

function insertRun(
  database: Database.Database,
  id: string,
  state: "FINISHED" | "RUNNING",
  updatedAt: string,
): void {
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, 'Idle Weapon Shop Tycoon', ?, 1, 'nonce', ?, ?)`,
    )
    .run(id, state, updatedAt, updatedAt);
}

function insertEvidence(
  database: Database.Database,
  id: string,
  runId: string,
  sizeBytes: number,
  state = "READY",
): void {
  database
    .prepare(
      `INSERT INTO evidence_records
       (id, run_id, kind, state, size_bytes, attempt, created_at, updated_at)
       VALUES (?, ?, 'SCREENSHOT', ?, ?, 1, ?, ?)`,
    )
    .run(id, runId, state, sizeBytes, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
}

function insertReport(
  database: Database.Database,
  id: string,
  runId: string,
  sizeBytes: number,
): void {
  database
    .prepare(
      `INSERT INTO report_exports
       (id, run_id, format, state, size_bytes, attempt, created_at, updated_at)
       VALUES (?, ?, 'HTML', 'READY', ?, 1, ?, ?)`,
    )
    .run(id, runId, sizeBytes, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
}

describe("cleanup preview repository", () => {
  it("previews expired terminal runs and sums only READY evidence and reports", () => {
    const { repository } = createRepository();

    expect(repository.preview(30, "2026-08-18T00:00:00.000Z")).toEqual({
      cutoffAt: "2026-07-19T00:00:00.000Z",
      candidates: [
        {
          runId: "run-old",
          state: "FINISHED",
          completedAt: "2026-07-01T00:00:00.000Z",
          estimatedBytes: 300,
        },
        {
          runId: "run-completed",
          state: "COMPLETED",
          completedAt: "2026-07-02T00:00:00.000Z",
          estimatedBytes: 400,
        },
      ],
      totalEstimatedBytes: 700,
    });
  });

  it("rejects invalid retention values before querying storage", () => {
    const { repository } = createRepository();

    expect(() => repository.preview(0, "2026-08-18T00:00:00.000Z")).toThrow(/retentionDays/);
  });
});
