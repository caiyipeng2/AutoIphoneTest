import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureDatabase,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
  RUN_ACTIONS_MIGRATION,
  ACTION_COMMANDS_MIGRATION,
} from "./migrations.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function openRunsDatabase(): Database.Database {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    ACTION_COMMANDS_MIGRATION,
  ]);
  databases.push(database);
  return database;
}

describe("M6 runs/actions migration", () => {
  it("creates the run tables and is idempotent", () => {
    const database = new Database(":memory:");
    configureDatabase(database);
    databases.push(database);

    expect(
      migrate(database, [
        FOUNDATION_MIGRATION,
        DEVICES_MIGRATION,
        RUN_ACTIONS_MIGRATION,
        ACTION_COMMANDS_MIGRATION,
      ]).applied,
    ).toEqual(["0001_foundation", "0002_devices", "0008_runs_actions", "0010_action_commands"]);
    expect(
      migrate(database, [
        FOUNDATION_MIGRATION,
        DEVICES_MIGRATION,
        RUN_ACTIONS_MIGRATION,
        ACTION_COMMANDS_MIGRATION,
      ]).applied,
    ).toEqual([]);

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?, ?, ?)",
      )
      .all(
        "test_runs",
        "run_devices",
        "actions",
        "action_targets",
        "action_outbox",
        "device_action_results",
        "run_transitions",
      )
      .map((row) => (row as { name: string }).name)
      .sort();

    expect(tables).toEqual([
      "action_outbox",
      "action_targets",
      "actions",
      "device_action_results",
      "run_devices",
      "run_transitions",
      "test_runs",
    ]);
  });

  it("enforces one client request and action sequence per run", () => {
    const database = openRunsDatabase();
    database
      .prepare(
        "INSERT INTO test_runs (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "run-1",
        "Idle Weapon Shop Tycoon",
        "CREATED",
        1,
        "nonce-hash",
        "2026-08-11",
        "2026-08-11",
      );
    database
      .prepare(
        "INSERT INTO actions (id, run_id, action_seq, client_request_id, action_type, payload_json, state, metrics_epoch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "action-1",
        "run-1",
        1,
        "request-1",
        "tap",
        "{}",
        "QUEUED",
        1,
        "2026-08-11",
        "2026-08-11",
      );

    expect(() =>
      database
        .prepare(
          "INSERT INTO actions (id, run_id, action_seq, client_request_id, action_type, payload_json, state, metrics_epoch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "action-2",
          "run-1",
          2,
          "request-1",
          "tap",
          "{}",
          "QUEUED",
          1,
          "2026-08-11",
          "2026-08-11",
        ),
    ).toThrow(/UNIQUE constraint failed/);

    expect(() =>
      database
        .prepare(
          "INSERT INTO actions (id, run_id, action_seq, client_request_id, action_type, payload_json, state, metrics_epoch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "action-2",
          "run-1",
          1,
          "request-2",
          "tap",
          "{}",
          "QUEUED",
          1,
          "2026-08-11",
          "2026-08-11",
        ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects a second active Leader in the same run epoch", () => {
    const database = openRunsDatabase();
    database
      .prepare(
        "INSERT INTO test_runs (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "run-1",
        "Idle Weapon Shop Tycoon",
        "CREATED",
        1,
        "nonce-hash",
        "2026-08-11",
        "2026-08-11",
      );
    database
      .prepare(
        "INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("leader-a", "ONLINE", "2026-08-11", "2026-08-11", "2026-08-11", "2026-08-11");
    database
      .prepare(
        "INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("leader-b", "ONLINE", "2026-08-11", "2026-08-11", "2026-08-11", "2026-08-11");

    const insertMember = database.prepare(
      "INSERT INTO run_devices (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertMember.run("run-1", "leader-a", "LEADER", "ACTIVE", 1, 1, "2026-08-11", "2026-08-11");

    expect(() =>
      insertMember.run("run-1", "leader-b", "LEADER", "ACTIVE", 1, 1, "2026-08-11", "2026-08-11"),
    ).toThrow(/UNIQUE constraint failed/);

    expect(() =>
      insertMember.run("run-1", "leader-b", "FOLLOWER", "ACTIVE", 1, 1, "2026-08-11", "2026-08-11"),
    ).not.toThrow();
  });

  it("keeps action targets and results bound to their action and serial", () => {
    const database = openRunsDatabase();
    database
      .prepare(
        "INSERT INTO test_runs (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "run-1",
        "Idle Weapon Shop Tycoon",
        "CREATED",
        1,
        "nonce-hash",
        "2026-08-11",
        "2026-08-11",
      );
    database
      .prepare(
        "INSERT INTO actions (id, run_id, action_seq, client_request_id, action_type, payload_json, state, metrics_epoch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "action-1",
        "run-1",
        1,
        "request-1",
        "tap",
        "{}",
        "QUEUED",
        1,
        "2026-08-11",
        "2026-08-11",
      );
    database
      .prepare(
        "INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("leader-a", "ONLINE", "2026-08-11", "2026-08-11", "2026-08-11", "2026-08-11");

    database
      .prepare(
        "INSERT INTO action_targets (action_id, serial, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("action-1", "leader-a", "QUEUED", "2026-08-11", "2026-08-11");
    database
      .prepare(
        "INSERT INTO device_action_results (action_id, serial, state, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("action-1", "leader-a", "PENDING", "{}", "2026-08-11", "2026-08-11");

    expect(() =>
      database
        .prepare(
          "INSERT INTO action_targets (action_id, serial, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("missing-action", "leader-a", "QUEUED", "2026-08-11", "2026-08-11"),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
