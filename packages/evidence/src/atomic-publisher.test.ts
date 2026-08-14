import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AtomicEvidencePublisher, type AtomicPublishPhase } from "./atomic-publisher.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("atomic evidence publisher", () => {
  it("closes, hashes, and renames a same-directory partial in that order", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-atomic-publisher-"));
    roots.push(root);
    const phases: AtomicPublishPhase[] = [];
    const publisher = new AtomicEvidencePublisher({ runRoot: root });

    const result = await publisher.publish({
      relativePath: "device-1/capture.log",
      attempt: 3,
      content: (async function* () {
        yield "alpha\n";
        yield new TextEncoder().encode("beta\n");
      })(),
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["CLOSED", "HASHED", "RENAMED"]);
    expect(result).toMatchObject({
      state: "READY",
      relativePath: "device-1/capture.log",
      sizeBytes: 11,
      sha256: "e49c81e2d2f84e259d40e2fb8192f3bcd198b355184845d76d8f58807d0d78ee",
    });
    expect(await readFile(join(root, "device-1", "capture.log"), "utf8")).toBe("alpha\nbeta\n");
    expect((await readdir(join(root, "device-1"))).some((name) => name.includes(".partial-"))).toBe(
      false,
    );
  });

  it("removes the partial when the content stream fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-atomic-publisher-"));
    roots.push(root);
    const publisher = new AtomicEvidencePublisher({ runRoot: root });

    await expect(
      publisher.publish({
        relativePath: "failed/capture.log",
        attempt: 1,
        content: (async function* () {
          yield "before failure";
          throw new Error("capture stream failed");
        })(),
      }),
    ).rejects.toThrow("capture stream failed");

    expect(await readdir(join(root, "failed")).catch(() => [])).toEqual([]);
  });

  it("rejects absolute and traversal paths before creating a partial", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-atomic-publisher-"));
    roots.push(root);
    const publisher = new AtomicEvidencePublisher({ runRoot: root });

    await expect(
      publisher.publish({ relativePath: "../outside.log", attempt: 1, content: ["x"] }),
    ).rejects.toThrow("relativePath");
    await expect(
      publisher.publish({ relativePath: "C:\\outside.log", attempt: 1, content: ["x"] }),
    ).rejects.toThrow("relativePath");
  });

  it("does not overwrite an existing final file and cleans its partial", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-atomic-publisher-"));
    roots.push(root);
    await writeFile(join(root, "existing.log"), "original", "utf8");
    const publisher = new AtomicEvidencePublisher({ runRoot: root });

    await expect(
      publisher.publish({ relativePath: "existing.log", attempt: 2, content: ["replacement"] }),
    ).rejects.toThrow("already exists");
    expect(await readFile(join(root, "existing.log"), "utf8")).toBe("original");
    expect((await readdir(root)).filter((name) => name.includes(".partial-")).length).toBe(0);
    expect((await stat(join(root, "existing.log"))).isFile()).toBe(true);
  });
});
