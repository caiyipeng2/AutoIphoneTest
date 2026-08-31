import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  RUN_FAILURE_POLICY_MIGRATION,
  SESSION_API_MIGRATION,
  SESSION_BRIDGE_MODE_MIGRATION,
  configureDatabase,
  migrate,
} from "./migrations.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("session bridge mode migration", () => {
  it("adds a required per-session mode with a strict default", () => {
    const database = new Database(":memory:");
    databases.push(database);
    configureDatabase(database);

    const result = migrate(database, [
      FOUNDATION_MIGRATION,
      DEVICES_MIGRATION,
      RUN_ACTIONS_MIGRATION,
      SESSION_API_MIGRATION,
      ACTION_COMMANDS_MIGRATION,
      RUN_FAILURE_POLICY_MIGRATION,
      SESSION_BRIDGE_MODE_MIGRATION,
    ]);

    expect(result.applied).toContain("0020_session_bridge_mode");
    expect(
      database
        .prepare("PRAGMA table_info(test_runs)")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toContain("bridge_mode");

    database
      .prepare(
        `INSERT INTO test_runs
         (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
         VALUES (?, ?, 'CREATED', 1, ?, ?, ?)`,
      )
      .run("run-default-mode", "com.example.game", "nonce", "now", "now");
    expect(
      database.prepare("SELECT bridge_mode FROM test_runs WHERE id = ?").get("run-default-mode"),
    ).toEqual({ bridge_mode: "REQUIRED" });

    database
      .prepare("UPDATE test_runs SET bridge_mode = ? WHERE id = ?")
      .run("APPIUM_ONLY", "run-default-mode");
    expect(
      database.prepare("SELECT bridge_mode FROM test_runs WHERE id = ?").get("run-default-mode"),
    ).toEqual({ bridge_mode: "APPIUM_ONLY" });
    expect(() =>
      database
        .prepare("UPDATE test_runs SET bridge_mode = ? WHERE id = ?")
        .run("UNSUPPORTED", "run-default-mode"),
    ).toThrow();
  });
});
