import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  DEVICES_MIGRATION,
  EVIDENCE_REPORTS_MIGRATION,
  FOUNDATION_MIGRATION,
  INCIDENTS_MIGRATION,
  migrate,
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
  return database;
}

describe("evidence and report migration", () => {
  it("creates durable evidence and report export tables with pending indexes", () => {
    const database = openMigratedDatabase();
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('evidence_records', 'report_exports') ORDER BY name",
      )
      .all() as readonly { name: string }[];

    expect(tables.map((table) => table.name)).toEqual(["evidence_records", "report_exports"]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%pending%'",
        )
        .all(),
    ).not.toEqual([]);
  });

  it("accepts pending evidence and rejects unknown evidence states", () => {
    const database = openMigratedDatabase();
    database
      .prepare(
        `INSERT INTO test_runs
         (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
         VALUES ('run-1', 'com.example.game', 'FINISHED', 1, 'nonce', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
      )
      .run();

    database
      .prepare(
        `INSERT INTO evidence_records
         (id, run_id, kind, state, attempt, created_at, updated_at)
         VALUES ('ev-1', 'run-1', 'CURRENT_SCREENSHOT', 'PENDING', 1, '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
      )
      .run();
    expect(database.prepare("SELECT state FROM evidence_records WHERE id = 'ev-1'").get()).toEqual({
      state: "PENDING",
    });

    expect(() =>
      database
        .prepare(
          `INSERT INTO evidence_records
           (id, run_id, kind, state, attempt, created_at, updated_at)
           VALUES ('ev-2', 'run-1', 'CURRENT_SCREENSHOT', 'BOGUS', 1, '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("constrains report exports to HTML or ZIP and the same evidence lifecycle states", () => {
    const database = openMigratedDatabase();
    database
      .prepare(
        `INSERT INTO test_runs
         (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
         VALUES ('run-2', 'com.example.game', 'FINISHED', 1, 'nonce', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO report_exports
         (id, run_id, format, state, attempt, created_at, updated_at)
         VALUES ('report-1', 'run-2', 'HTML', 'PENDING', 1, '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
      )
      .run();
    expect(
      database.prepare("SELECT format, state FROM report_exports WHERE id = 'report-1'").get(),
    ).toEqual({
      format: "HTML",
      state: "PENDING",
    });
    expect(() =>
      database
        .prepare(
          `INSERT INTO report_exports
           (id, run_id, format, state, attempt, created_at, updated_at)
           VALUES ('report-2', 'run-2', 'PDF', 'PENDING', 1, '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });
});
