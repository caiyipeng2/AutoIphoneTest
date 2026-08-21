import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  DEVICES_MIGRATION,
  EVIDENCE_REPORTS_MIGRATION,
  FOUNDATION_MIGRATION,
  INCIDENTS_MIGRATION,
  migrate,
  OPTIONAL_REPORT_EXPORTS_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  RUN_FAILURE_POLICY_MIGRATION,
  RUN_MEMBERSHIP_MIGRATION,
  SESSION_API_MIGRATION,
} from "./migrations.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function openMigratedDatabase(): Database.Database {
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
  ]);
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES ('run-optional', 'Idle Weapon Shop Tycoon', 'FINISHED', 1, 'nonce', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO report_exports
       (id, run_id, format, state, final_relative_path, sha256, size_bytes, attempt, created_at, updated_at)
       VALUES ('html-legacy', 'run-optional', 'HTML', 'READY', 'run-optional/reports/report.html', ?, 10, 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')`,
    )
    .run("a".repeat(64));
  database
    .prepare(
      `INSERT INTO report_exports
       (id, run_id, format, state, final_relative_path, sha256, size_bytes, attempt, created_at, updated_at)
       VALUES ('zip-legacy', 'run-optional', 'ZIP', 'READY', 'run-optional/reports/evidence.zip', ?, 20, 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')`,
    )
    .run("b".repeat(64));
  migrate(database, [OPTIONAL_REPORT_EXPORTS_MIGRATION]);
  return database;
}

describe("optional report export migration", () => {
  it("keeps existing HTML/ZIP rows and allows EXCEL, PDF, and JUNIT", () => {
    const database = openMigratedDatabase();
    for (const format of ["EXCEL", "PDF", "JUNIT"]) {
      database
        .prepare(
          `INSERT INTO report_exports
           (id, run_id, format, state, attempt, created_at, updated_at)
           VALUES (?, 'run-optional', ?, 'PENDING', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')`,
        )
        .run(`${format.toLowerCase()}-1`, format);
    }

    expect(
      database.prepare("SELECT id FROM report_exports WHERE id = 'html-legacy'").get(),
    ).toEqual({
      id: "html-legacy",
    });
    expect(database.prepare("SELECT id FROM report_exports WHERE id = 'zip-legacy'").get()).toEqual(
      {
        id: "zip-legacy",
      },
    );
    expect(
      database
        .prepare("SELECT format FROM report_exports WHERE run_id = ? ORDER BY format")
        .all("run-optional"),
    ).toEqual([
      { format: "EXCEL" },
      { format: "HTML" },
      { format: "JUNIT" },
      { format: "PDF" },
      { format: "ZIP" },
    ]);
  });
});
