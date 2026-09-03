import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  ACTION_RETRY_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  configureDatabase,
  migrate,
} from "./migrations.js";

describe("action retry migration", () => {
  it("adds a nullable parent action link after the action command schema", () => {
    const database = new Database(":memory:");
    configureDatabase(database);
    migrate(database, [
      FOUNDATION_MIGRATION,
      DEVICES_MIGRATION,
      RUN_ACTIONS_MIGRATION,
      ACTION_COMMANDS_MIGRATION,
      ACTION_RETRY_MIGRATION,
    ]);

    expect(
      database
        .prepare("PRAGMA table_info(actions)")
        .all()
        .map((column) => (column as { name: string }).name),
    ).toContain("parent_action_id");
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("idx_actions_parent_action"),
    ).toEqual({ name: "idx_actions_parent_action" });
    database.close();
  });
});
