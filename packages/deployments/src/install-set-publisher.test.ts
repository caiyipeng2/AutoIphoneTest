import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import Database from "better-sqlite3";
import {
  ARTIFACTS_MIGRATION,
  configureDatabase,
  DEPLOYMENTS_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  INSTALL_SETS_MIGRATION,
  migrate,
} from "@test-center/database/migrations";

import { publishInstallSet } from "./aab-install-set.js";

const roots: string[] = [];
const databases: Database.Database[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
  for (const database of databases.splice(0)) database.close();
});

describe("AAB install-set atomic publication", () => {
  it("creates the content-addressed install set metadata table", () => {
    const database = new Database(":memory:");
    configureDatabase(database);
    migrate(database, [
      FOUNDATION_MIGRATION,
      DEVICES_MIGRATION,
      ARTIFACTS_MIGRATION,
      DEPLOYMENTS_MIGRATION,
      INSTALL_SETS_MIGRATION,
    ]);
    databases.push(database);

    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'install_sets'")
        .get(),
    ).toEqual({ name: "install_sets" });
  });

  it("hashes a partial archive and atomically renames it only after verification", async () => {
    const root = win32.join(process.cwd(), "data", "tests", `install-set-${randomUUID()}`);
    roots.push(root);
    await mkdir(root, { recursive: true });
    const partialPath = win32.join(root, "game.apks.partial");
    const finalPath = win32.join(root, "game.apks");
    await writeFile(partialPath, "apks-content", "utf8");

    const published = await publishInstallSet({
      partialPath,
      finalPath,
      expectedSha256: createHash("sha256").update("apks-content", "utf8").digest("hex"),
    });

    expect(published.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(finalPath, "utf8")).toBe("apks-content");
    await expect(readFile(partialPath)).rejects.toThrow();
  });
});
