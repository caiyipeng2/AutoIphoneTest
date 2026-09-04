import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  ACTION_RETRY_MIGRATION,
  ACTION_SKIP_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  configureDatabase,
  migrate,
} from "./migrations.js";

describe("action skip migration", () => {
  it("creates the linked immutable skip decision table", () => {
    const database = new Database(":memory:");
    configureDatabase(database);
    migrate(database, [
      FOUNDATION_MIGRATION,
      DEVICES_MIGRATION,
      RUN_ACTIONS_MIGRATION,
      ACTION_COMMANDS_MIGRATION,
      ACTION_RETRY_MIGRATION,
      ACTION_SKIP_MIGRATION,
    ]);

    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("action_skip_decisions"),
    ).toEqual({ name: "action_skip_decisions" });
    database.close();
  });
});
