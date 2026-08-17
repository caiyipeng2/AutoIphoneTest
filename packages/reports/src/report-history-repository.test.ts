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
import { ReportHistoryRepository } from "./report-history-repository.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function openDatabase(): Database.Database {
  const database = new Database(":memory:");
  databases.push(database);
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
  database
    .prepare(
      `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES ('R5CX211TXNT', 'ONLINE', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z'),
              ('R5CRC342PRF', 'ONLINE', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, client_request_id, created_at, updated_at)
       VALUES ('run-failed', 'Idle Weapon Shop Tycoon', 'FAILED', 1, 'nonce-failed', 'request-failed', '2026-08-14T02:00:00.000Z', '2026-08-14T02:05:00.000Z'),
              ('run-finished', 'Idle Weapon Shop Tycoon', 'FINISHED', 1, 'nonce-finished', 'request-finished', '2026-08-15T02:00:00.000Z', '2026-08-15T02:05:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO run_devices
       (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at)
       VALUES ('run-failed', 'R5CX211TXNT', 'LEADER', 'ACTIVE', 1, 1, '2026-08-14T02:00:00.000Z', '2026-08-14T02:00:00.000Z'),
              ('run-finished', 'R5CX211TXNT', 'LEADER', 'ACTIVE', 1, 1, '2026-08-15T02:00:00.000Z', '2026-08-15T02:00:00.000Z'),
              ('run-finished', 'R5CRC342PRF', 'FOLLOWER', 'ACTIVE', 1, 1, '2026-08-15T02:00:00.000Z', '2026-08-15T02:00:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO device_uid_observations
       (serial, package_name, install_generation, app_data_generation, uid, source, actor, build_id, observed_at)
       VALUES ('R5CX211TXNT', 'Idle Weapon Shop Tycoon', 1, 1, 'UID-LEADER', 'MANUAL', 'test', 'build-1', '2026-08-15T02:04:00.000Z'),
              ('R5CRC342PRF', 'Idle Weapon Shop Tycoon', 1, 1, 'UID-FOLLOWER', 'MANUAL', 'test', 'build-1', '2026-08-15T02:04:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO report_exports
       (id, run_id, format, state, final_relative_path, sha256, size_bytes, attempt, created_at, updated_at)
       VALUES ('html-finished', 'run-finished', 'HTML', 'READY', 'reports/run-finished.html', printf('%064d', 1), 120, 1, '2026-08-15T02:05:00.000Z', '2026-08-15T02:05:00.000Z'),
              ('zip-finished', 'run-finished', 'ZIP', 'FAILED', NULL, NULL, NULL, 1, '2026-08-15T02:05:00.000Z', '2026-08-15T02:05:01.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO run_finalizations
       (run_id, state, attempt, error_category, started_at, completed_at, updated_at)
       VALUES ('run-finished', 'FINALIZATION_FAILED', 1, 'EXPORT_FAILED', '2026-08-15T02:05:00.000Z', NULL, '2026-08-15T02:05:01.000Z')`,
    )
    .run();
  return database;
}

describe("report history repository", () => {
  it("lists recent runs with device and UID identities and supports filters", () => {
    const repository = new ReportHistoryRepository(openDatabase());

    expect(repository.list()).toMatchObject([
      {
        runId: "run-finished",
        state: "FINISHED",
        devices: [
          { serial: "R5CRC342PRF", role: "FOLLOWER", uid: "UID-FOLLOWER" },
          { serial: "R5CX211TXNT", role: "LEADER", uid: "UID-LEADER" },
        ],
      },
      { runId: "run-failed", state: "FAILED" },
    ]);
    expect(repository.list({ state: "FAILED" }).map((run) => run.runId)).toEqual(["run-failed"]);
    expect(repository.list({ serial: "R5CRC342PRF" }).map((run) => run.runId)).toEqual([
      "run-finished",
    ]);
    expect(repository.list({ uid: "UID-LEADER", from: "2026-08-15T00:00:00.000Z" })).toHaveLength(
      1,
    );
    expect(repository.list({ limit: 1 })).toHaveLength(1);
  });

  it("returns export and finalization state for a run detail", () => {
    const repository = new ReportHistoryRepository(openDatabase());

    expect(repository.get("run-finished")).toMatchObject({
      runId: "run-finished",
      exports: [
        { id: "html-finished", format: "HTML", state: "READY" },
        { id: "zip-finished", format: "ZIP", state: "FAILED" },
      ],
      finalization: {
        state: "FINALIZATION_FAILED",
        attempt: 1,
        errorCategory: "EXPORT_FAILED",
      },
    });
    expect(repository.get("missing")).toBeUndefined();
  });
});
