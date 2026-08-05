import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ContentStore, type ContentInput } from "./content-store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function input(value: string): Promise<ContentInput> {
  return (async function* () {
    yield value.slice(0, 2);
    yield Buffer.from(value.slice(2));
  })();
}

describe("content store", () => {
  it("hashes streams and deduplicates bytes under different names", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-artifacts-"));
    roots.push(root);
    const store = new ContentStore({ rootPath: root });
    const first = await store.stage(await input("same bytes"), "game.apk");
    const second = await store.stage(await input("same bytes"), "renamed.apk");
    const publishedFirst = await store.publish(first);
    const publishedSecond = await store.publish(second);
    expect(publishedSecond).toMatchObject({
      sha256: publishedFirst.sha256,
      sizeBytes: publishedFirst.sizeBytes,
      storedPath: publishedFirst.storedPath,
      created: false,
    });
    expect(publishedFirst.storedPath).toContain(
      `sha256/${first.sha256.slice(0, 2)}/${first.sha256}/`,
    );
    expect(
      await readFile(join(root, publishedFirst.storedPath.replaceAll("/", "\\")), "utf8"),
    ).toBe("same bytes");
    expect(await store.listPartialFiles()).toEqual([]);
  });

  it("removes a partial file when the input stream fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-artifacts-"));
    roots.push(root);
    const store = new ContentStore({ rootPath: root });
    const failing: ContentInput = (async function* () {
      yield "prefix";
      throw new Error("source failed");
    })();
    await expect(store.stage(failing, "bad.apk")).rejects.toThrow("source failed");
    expect(await store.listPartialFiles()).toEqual([]);
  });

  it("does not mutate a source file while staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-artifacts-"));
    roots.push(root);
    const sourcePath = join(root, "source.apk");
    await writeFile(sourcePath, "source bytes");
    const before = await readFile(sourcePath);
    const store = new ContentStore({ rootPath: root });
    const staged = await store.stage(await input(before.toString()), "source.apk");
    await store.publish(staged);
    expect(await readFile(sourcePath)).toEqual(before);
    expect((await readdir(root)).sort()).toContain("source.apk");
  });
});
