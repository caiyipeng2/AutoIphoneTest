import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { win32 } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertZipInput,
  ArtifactRepository,
  ContentStore,
} from "../../packages/artifacts/src/index.js";
import {
  ArtifactImportProvider,
  type ArtifactImportService,
} from "../../packages/build-provider/src/artifact-import-provider.js";
import {
  ARTIFACTS_MIGRATION,
  configureDatabase,
  FOUNDATION_MIGRATION,
  migrate,
} from "../../packages/database/src/index.js";

const projectRoot = win32.normalize(process.cwd());
const workRoots: string[] = [];

describe("M3 artifact import acceptance", () => {
  afterEach(async () => {
    await Promise.all(
      workRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("deduplicates the same content, records installed identity, and leaves no orphans", async () => {
    const root = win32.join(projectRoot, "data", `task6-${randomUUID()}`);
    workRoots.push(root);
    const importOne = win32.join(root, "imports-one");
    const importTwo = win32.join(root, "imports-two");
    const store = new ContentStore({ rootPath: win32.join(root, "artifacts") });
    await Promise.all([
      mkdir(importOne, { recursive: true }),
      mkdir(importTwo, { recursive: true }),
    ]);
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("task6-apk")]);
    const firstPath = win32.join(importOne, "first.apk");
    const secondPath = win32.join(importTwo, "renamed.apk");
    await Promise.all([writeFile(firstPath, bytes), writeFile(secondPath, bytes)]);

    const database = new Database(":memory:");
    configureDatabase(database);
    migrate(database, [FOUNDATION_MIGRATION, ARTIFACTS_MIGRATION]);
    const repository = new ArtifactRepository(database, store);
    const service: ArtifactImportService = {
      stage: async (request) =>
        await store.stage(createReadStream(request.artifactPath), request.originalName),
      parse: async () => ({}),
      publish: async (staged, input) => await repository.publishSource(staged, input),
      discard: async (staged) => await rm(staged.partialPath, { force: true }),
    };
    const provider = new ArtifactImportProvider(service);
    const request = (source: string, path: string, originalName: string) => ({
      providerId: "artifact-import",
      kind: "APK" as const,
      importSource: source,
      artifactPath: path,
      originalName,
    });

    const firstEvents: string[] = [];
    const first = await provider.build(
      request(importOne, firstPath, "first.apk"),
      async (event) => {
        firstEvents.push(`${event.phase}:${event.status}`);
      },
    );
    const second = await provider.build(
      request(importTwo, secondPath, "renamed.apk"),
      async () => undefined,
    );
    expect(first.artifact.artifactId).toBe(second.artifact.artifactId);
    expect(first.artifact.publishState).toBe("CREATED");
    expect(second.artifact.publishState).toBe("DEDUPLICATED");
    expect(firstEvents).toEqual([
      "validate:completed",
      "hash:completed",
      "parse:completed",
      "publish:completed",
    ]);
    expect(repository.list()).toHaveLength(1);

    const identity = {
      deviceSerial: "R5CX211TXNT",
      packageName: "com.example.task6",
      versionName: "1.0.0",
      versionCode: 7,
      signerSha256: "a".repeat(64),
      installedSetSha256: createHash("sha256").update("installed-set").digest("hex"),
      observedAt: "2026-08-05T00:00:00.000Z",
    } as const;
    expect(repository.registerInstalled(identity).state).toBe("CREATED");
    expect(repository.registerInstalled(identity).state).toBe("DEDUPLICATED");
    expect(repository.listInstalled()).toHaveLength(1);

    const publishedFiles = await listFiles(win32.join(root, "artifacts", "sha256"));
    expect(publishedFiles).toHaveLength(1);
    expect(await store.listPartialFiles()).toEqual([]);
    expect(await readFile(win32.join(root, "artifacts", "sha256", publishedFiles[0]!))).toEqual(
      bytes,
    );
    database.close();
  });

  it("removes a partial file when a stream fails halfway and rejects invalid package bytes", async () => {
    const root = win32.join(projectRoot, "data", `task6-failure-${randomUUID()}`);
    workRoots.push(root);
    const store = new ContentStore({ rootPath: win32.join(root, "artifacts") });
    async function* corruptStream(): AsyncGenerator<Buffer> {
      yield Buffer.from("partial");
      throw new Error("simulated stream interruption");
    }

    await expect(store.stage(corruptStream(), "broken.apk")).rejects.toThrow(
      "simulated stream interruption",
    );
    expect(await store.listPartialFiles()).toEqual([]);

    const invalidPath = win32.join(root, "invalid.bin");
    await mkdir(root, { recursive: true });
    await writeFile(invalidPath, Buffer.from("not-an-android-package"));
    await expect(assertZipInput(invalidPath)).rejects.toThrow("INVALID_FORMAT");
  });
});

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(directory, { withFileTypes: true }),
    );
    for (const entry of entries) {
      const path = win32.join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else output.push(win32.relative(root, path).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return output;
}
