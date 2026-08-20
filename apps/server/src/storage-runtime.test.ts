import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { GIBIBYTE } from "@test-center/evidence";
import { createStorageOverviewSnapshot, estimateSecondsUntilBlocked } from "./storage-runtime.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("storage overview runtime", () => {
  it("estimates time to the danger threshold from the recent write rate", () => {
    expect(estimateSecondsUntilBlocked(12 * GIBIBYTE, 2_000)).toBe(3_758_096);
    expect(estimateSecondsUntilBlocked(5 * GIBIBYTE, 2_000)).toBe(0);
    expect(estimateSecondsUntilBlocked(12 * GIBIBYTE, 0)).toBeUndefined();
    expect(estimateSecondsUntilBlocked(undefined, 2_000)).toBeUndefined();
  });

  it("counts active run states while excluding completed history", () => {
    const database = new Database(":memory:");
    databases.push(database);
    database.exec("CREATE TABLE test_runs (id TEXT PRIMARY KEY, state TEXT NOT NULL)");
    const insert = database.prepare("INSERT INTO test_runs (id, state) VALUES (?, ?)");
    insert.run("created", "CREATED");
    insert.run("preflight", "PREFLIGHT");
    insert.run("running", "RUNNING");
    insert.run("paused", "PAUSED");
    insert.run("finished", "FINISHED");

    expect(
      createStorageOverviewSnapshot(database, {
        measuredAtMs: Date.parse("2026-08-20T08:00:00.000Z"),
        pressure: "NORMAL",
        freeBytes: 50 * GIBIBYTE,
        writeRateBytesPerSecond: 2_000,
      }),
    ).toMatchObject({
      activeRunCount: 4,
      measuredAt: "2026-08-20T08:00:00.000Z",
      estimatedSecondsUntilBlocked: 24_159_191,
    });
  });
});
