import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { win32 } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimePaths, ensureRuntimeDirectories, isPathWithin } from "./runtime-paths.js";
import { FOUNDATION_MIGRATION, migrate } from "./migrations.js";
import { openDatabase } from "./connection.js";
import { getSetting, setSetting } from "./settings-repository.js";

const openDatabases: Database.Database[] = [];
const cleanupRoots: string[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  await Promise.all(
    cleanupRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
});

describe("runtime paths", () => {
  it("keeps every mutable path below the configured E-drive data root", async () => {
    const projectRoot = win32.normalize(process.cwd());
    const dataRoot = win32.join(projectRoot, "data", "tests", `database-${randomUUID()}`);
    const paths = createRuntimePaths(projectRoot, dataRoot);
    cleanupRoots.push(paths.dataRoot);

    expect(paths.dataRoot).toBe(dataRoot);
    expect(
      [
        paths.databasePath,
        paths.logsRoot,
        paths.artifactsRoot,
        paths.runsRoot,
        paths.tempRoot,
      ].every((path) => isPathWithin(paths.dataRoot, path)),
    ).toBe(true);

    await ensureRuntimeDirectories(paths);
    expect(paths.logsRoot).toBeTruthy();
  });

  it("rejects traversal and a data root on another drive", () => {
    const projectRoot = "E:\\Projects\\UnityMultiDeviceTestCenter";

    expect(() => createRuntimePaths(projectRoot, "E:\\Projects\\outside")).toThrow(
      /below the project root/,
    );
    expect(() => createRuntimePaths(projectRoot, "C:\\Temp\\test-center")).toThrow(/same drive/);
  });
});

describe("SQLite foundation", () => {
  it("configures WAL, foreign keys, busy timeout, and idempotent checksummed migrations", async () => {
    const projectRoot = win32.normalize(process.cwd());
    const dataRoot = win32.join(projectRoot, "data", "tests", `database-${randomUUID()}`);
    const paths = createRuntimePaths(projectRoot, dataRoot);
    cleanupRoots.push(paths.dataRoot);
    await ensureRuntimeDirectories(paths);
    const database = openDatabase(paths);
    openDatabases.push(database);

    const first = migrate(database, [FOUNDATION_MIGRATION]);
    const second = migrate(database, [FOUNDATION_MIGRATION]);

    expect(first.applied).toEqual(["0001_foundation"]);
    expect(second.applied).toEqual([]);
    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(
      database
        .prepare("SELECT checksum FROM schema_migrations WHERE id = ?")
        .get("0001_foundation"),
    ).toEqual(expect.objectContaining({ checksum: expect.stringMatching(/^[a-f0-9]{64}$/) }));

    expect(() =>
      migrate(database, [
        { id: "0001_foundation", sql: `${FOUNDATION_MIGRATION.sql}\n-- changed` },
      ]),
    ).toThrow(/checksum mismatch/);
  });

  it("accepts only closed validated settings and preserves them", async () => {
    const projectRoot = win32.normalize(process.cwd());
    const dataRoot = win32.join(projectRoot, "data", "tests", `database-${randomUUID()}`);
    const paths = createRuntimePaths(projectRoot, dataRoot);
    cleanupRoots.push(paths.dataRoot);
    await ensureRuntimeDirectories(paths);
    const database = openDatabase(paths);
    openDatabases.push(database);
    migrate(database, [FOUNDATION_MIGRATION]);

    setSetting(database, "dataRoot", dataRoot);
    setSetting(database, "retentionDays", 30);
    expect(getSetting(database, "dataRoot")).toBe(dataRoot);
    expect(getSetting(database, "retentionDays")).toBe(30);
    expect(() => setSetting(database, "unknown", true)).toThrow(/Unknown setting/);
    expect(() => setSetting(database, "retentionDays", 0)).toThrow(/retentionDays/);
    expect(() =>
      setSetting(database, "diskThresholds", { warningBytes: 5, dangerBytes: 10 }),
    ).toThrow(/dangerBytes/);
  });
});
