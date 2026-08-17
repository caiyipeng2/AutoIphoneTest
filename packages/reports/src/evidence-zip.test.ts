import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { createZipManifest } from "./zip-manifest.js";
import { EvidenceZipPublisher } from "./evidence-zip.js";

const roots: string[] = [];
const sha = (digit: string): string => digit.repeat(64);

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function makeManifest() {
  return createZipManifest({
    html: { relativePath: "reports/report.html", sha256: sha("a"), sizeBytes: 21 },
    evidence: [
      {
        id: "ev-log",
        kind: "LOGCAT_SEGMENT",
        state: "READY",
        finalRelativePath: "evidence/log.txt",
        sha256: sha("b"),
        sizeBytes: 15,
      },
    ],
  });
}

describe("evidence ZIP publisher", () => {
  it("publishes a ZIP64 archive from streams and returns measured final metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-evidence-zip-"));
    roots.push(root);
    const publisher = new EvidenceZipPublisher({ runRoot: root });
    const manifest = makeManifest();

    const result = await publisher.publish({
      relativePath: "reports/evidence.zip",
      attempt: 1,
      manifest,
      entries: [
        {
          path: "reports/report.html",
          associationId: "report-html",
          source: Readable.from(["<html>report</html>\n"]),
        },
        {
          path: "evidence/log.txt",
          associationId: "ev-log",
          source: Readable.from(["2026-08-14Z\n"]),
        },
      ],
    });

    const bytes = await readFile(join(root, "reports", "evidence.zip"));
    expect(result).toMatchObject({
      state: "READY",
      relativePath: "reports/evidence.zip",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07]))).toBe(true);
    expect(await readdir(join(root, "reports"))).toEqual(["evidence.zip"]);
  });

  it("removes the partial archive when an entry stream fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-evidence-zip-"));
    roots.push(root);
    const publisher = new EvidenceZipPublisher({ runRoot: root });
    const manifest = makeManifest();

    await expect(
      publisher.publish({
        relativePath: "reports/evidence.zip",
        attempt: 1,
        manifest,
        entries: [
          {
            path: "reports/report.html",
            associationId: "report-html",
            source: Readable.from(
              (async function* () {
                yield "partial";
                throw new Error("evidence stream interrupted");
              })(),
            ),
          },
          {
            path: "evidence/log.txt",
            associationId: "ev-log",
            source: Readable.from(["never reached"]),
          },
        ],
      }),
    ).rejects.toThrow("evidence stream interrupted");
    expect(await readdir(join(root, "reports"))).toEqual([]);
  });

  it.each([
    ["path traversal", "../outside.html", "report-html"],
    ["association mismatch", "reports/report.html", "wrong-id"],
  ])("rejects %s before creating the output directory", (_label, path, associationId) => {
    return (async () => {
      const root = await mkdtemp(join(tmpdir(), "test-center-evidence-zip-"));
      roots.push(root);
      const publisher = new EvidenceZipPublisher({ runRoot: root });
      const manifest = makeManifest();
      await expect(
        publisher.publish({
          relativePath: "reports/evidence.zip",
          attempt: 1,
          manifest,
          entries: [
            {
              path,
              associationId,
              source: Readable.from(["invalid"]),
            },
          ],
        }),
      ).rejects.toThrow(/path|association/i);
      await expect(readdir(join(root, "reports"))).rejects.toMatchObject({ code: "ENOENT" });
    })();
  });
});
