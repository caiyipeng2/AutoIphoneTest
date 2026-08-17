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
  UID_BRIDGE_MIGRATION,
} from "@test-center/database/migrations";
import { ReportSnapshotRepository } from "./report-snapshot-repository.js";

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
  ]);
  return database;
}

function seedRun(database: Database.Database, state = "FINISHED"): void {
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES ('run-1', 'Idle Weapon Shop Tycoon', ?, 2, 'nonce', '2026-08-14T01:00:00.000Z', '2026-08-14T01:05:00.000Z')`,
    )
    .run(state);
  for (const serial of ["ABC1234567", "ZX2G22B7F8"]) {
    database
      .prepare(
        `INSERT INTO devices
         (serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq, created_at, updated_at)
         VALUES (?, 'ONLINE', '{}', '2026-08-14T00:00:00.000Z', '2026-08-14T01:00:00.000Z', 1, '2026-08-14T00:00:00.000Z', '2026-08-14T01:00:00.000Z')`,
      )
      .run(serial);
  }
  database
    .prepare(
      `INSERT INTO run_devices
       (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at)
       VALUES ('run-1', 'ZX2G22B7F8', 'FOLLOWER', 'ACTIVE', 2, 1, '2026-08-14T01:00:00.000Z', '2026-08-14T01:00:00.000Z'),
              ('run-1', 'ABC1234567', 'LEADER', 'RECOVERING', 2, 3, '2026-08-14T01:00:00.000Z', '2026-08-14T01:02:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO device_uid_observations
       (serial, package_name, install_generation, app_data_generation, uid, source, actor, build_id, observed_at)
       VALUES ('ABC1234567', 'Idle Weapon Shop Tycoon', 1, 1, 'UID-OLD', 'BRIDGE_AUTO', 'bridge', 'build-1', '2026-08-14T01:01:00.000Z'),
              ('ABC1234567', 'Idle Weapon Shop Tycoon', 1, 1, 'UID-NEW', 'BRIDGE_AUTO', 'bridge', 'build-1', '2026-08-14T01:03:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO actions
       (id, run_id, action_seq, client_request_id, action_type, payload_json, state, metrics_epoch, created_at, updated_at)
       VALUES ('act-2', 'run-1', 2, 'request-2', 'tap', '{"payload":null,"sourceFrameId":null}', 'SUCCEEDED', 2, '2026-08-14T01:02:00.000Z', '2026-08-14T01:02:00.000Z'),
              ('act-1', 'run-1', 1, 'request-1', 'tap', '{"payload":null,"sourceFrameId":null}', 'FAILED', 2, '2026-08-14T01:01:00.000Z', '2026-08-14T01:01:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO action_targets (action_id, serial, state, created_at, updated_at)
       VALUES ('act-2', 'ZX2G22B7F8', 'SUCCEEDED', '2026-08-14T01:02:00.000Z', '2026-08-14T01:02:00.000Z'),
              ('act-1', 'ABC1234567', 'FAILED', '2026-08-14T01:01:00.000Z', '2026-08-14T01:01:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO evidence_records
       (id, run_id, serial, kind, state, final_relative_path, sha256, size_bytes, unavailable_reason, attempt, created_at, updated_at)
       VALUES ('ev-2', 'run-1', 'ZX2G22B7F8', 'REDACTED_LOGCAT', 'READY', 'evidence/logcat-2.txt', ?, 12, NULL, 1, '2026-08-14T01:03:00.000Z', '2026-08-14T01:03:00.000Z'),
              ('ev-1', 'run-1', 'ABC1234567', 'CURRENT_SCREENSHOT', 'MISSING', NULL, NULL, NULL, 'DEVICE_DISCONNECTED', 1, '2026-08-14T01:03:00.000Z', '2026-08-14T01:03:00.000Z')`,
    )
    .run("a".repeat(64));
  database
    .prepare(
      `INSERT INTO incidents
       (incident_id, run_id, serial, schema_version, category, generation, detected_at_realtime_ms,
        detected_at, source, evidence_ref, details_json, created_at)
       VALUES ('inc-1', 'run-1', 'ABC1234567', 1, 'APP_CRASH_OR_ANR', 3, 100,
               '2026-08-14T01:03:00.000Z', 'watchdog', 'ev-1', '{"message":"crash"}', '2026-08-14T01:03:00.000Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO recovery_attempts
       (id, incident_id, run_id, action, target_serial, reason, deadline_realtime_ms, status, started_at, completed_at, error_message)
       VALUES ('recovery-1', 'inc-1', 'run-1', 'QUARANTINE_DEVICE', 'ABC1234567', 'isolate', 500, 'FAILED',
               '2026-08-14T01:03:01.000Z', '2026-08-14T01:03:02.000Z', 'timeout')`,
    )
    .run();
}

describe("report snapshot repository", () => {
  it("loads a consistent run snapshot with latest UID and deterministic collections", () => {
    const database = openDatabase();
    seedRun(database);

    const model = new ReportSnapshotRepository(database).load("run-1");

    expect(model.run).toMatchObject({
      id: "run-1",
      packageName: "Idle Weapon Shop Tycoon",
      state: "FINISHED",
      currentEpoch: 2,
    });
    expect(model.devices.map((device) => device.serial)).toEqual(["ABC1234567", "ZX2G22B7F8"]);
    expect(model.devices[0]).toMatchObject({ uid: "UID-NEW", membershipState: "RECOVERING" });
    expect(model.actions.map((action) => action.id)).toEqual(["act-1", "act-2"]);
    expect(model.actions[0]?.targets[0]).toMatchObject({ serial: "ABC1234567", state: "FAILED" });
    expect(model.evidence.map((entry) => entry.id)).toEqual(["ev-1", "ev-2"]);
    expect(model.evidence[1]).toMatchObject({
      state: "READY",
      finalRelativePath: "evidence/logcat-2.txt",
    });
    expect(model.incidents).toMatchObject([{ incidentId: "inc-1", category: "APP_CRASH_OR_ANR" }]);
    expect(model.recoveries).toMatchObject([{ id: "recovery-1", status: "FAILED" }]);
  });

  it("rejects unknown runs and live run states before rendering", () => {
    const database = openDatabase();
    const repository = new ReportSnapshotRepository(database);
    expect(() => repository.load("missing-run")).toThrow(/run not found/i);

    seedRun(database, "RUNNING");
    expect(() => repository.load("run-1")).toThrow(/reportable|terminal|state/i);
  });
});
