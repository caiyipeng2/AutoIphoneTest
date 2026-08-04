import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureDatabase,
  ARTIFACTS_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database/migrations";

import { ArtifactRepository } from "./artifact-repository.js";
import { ContentStore, type ContentInput } from "./content-store.js";

const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function content(value: string): Promise<ContentInput> {
  return (async function* () {
    yield value;
  })();
}

async function createRepository(): Promise<{
  repository: ArtifactRepository;
  store: ContentStore;
  root: string;
  database: Database.Database;
}> {
  const root = await mkdtemp(join(tmpdir(), "test-center-artifacts-"));
  roots.push(root);
  const database = new Database(":memory:");
  databases.push(database);
  configureDatabase(database);
  migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION, ARTIFACTS_MIGRATION]);
  const store = new ContentStore({ rootPath: root });
  return { repository: new ArtifactRepository(database, store), store, root, database };
}

describe("artifact repository", () => {
  it("deduplicates equal bytes even when names differ", async () => {
    const { repository, store } = await createRepository();
    const first = await store.stage(await content("same bytes"), "game.apk");
    const second = await store.stage(await content("same bytes"), "renamed.apk");
    const created = await repository.publishSource(
      first,
      { kind: "APK" },
      "2026-08-04T12:00:00.000Z",
    );
    const duplicate = await repository.publishSource(
      second,
      { kind: "APK" },
      "2026-08-04T12:00:01.000Z",
    );
    expect(created.state).toBe("CREATED");
    expect(duplicate.state).toBe("DEDUPLICATED");
    expect(duplicate.artifact.id).toBe(created.artifact.id);
    expect(repository.list()).toHaveLength(1);
  });

  it("removes the published content if the metadata transaction fails", async () => {
    const { repository, store, root, database } = await createRepository();
    database.exec(
      "CREATE TRIGGER fail_artifact_insert BEFORE INSERT ON artifacts BEGIN SELECT RAISE(ABORT, 'metadata failed'); END;",
    );
    const staged = await store.stage(await content("broken metadata"), "broken.apk");
    await expect(repository.publishSource(staged, { kind: "APK" })).rejects.toThrow(
      "metadata failed",
    );
    expect(await readdir(join(root, "sha256"))).toEqual([]);
    expect(await store.listPartialFiles()).toEqual([]);
  });
});
