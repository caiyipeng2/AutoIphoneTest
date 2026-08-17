import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceZipPublisher } from "./evidence-zip.js";
import { EvidenceZipVerifier } from "./evidence-zip-verifier.js";
import { createZipManifest } from "./zip-manifest.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function makeFixture() {
  const html = "<html>report</html>\n";
  const log = "2026-08-14Z\n";
  const manifest = createZipManifest({
    html: {
      relativePath: "reports/report.html",
      sha256: digest(html),
      sizeBytes: Buffer.byteLength(html),
    },
    evidence: [
      {
        id: "ev-log",
        kind: "LOGCAT_SEGMENT",
        state: "READY",
        finalRelativePath: "evidence/log.txt",
        sha256: digest(log),
        sizeBytes: Buffer.byteLength(log),
      },
    ],
  });
  return { html, log, manifest };
}

async function publishFixture(root: string, manifest = makeFixture().manifest): Promise<void> {
  const { html, log } = makeFixture();
  await new EvidenceZipPublisher({ runRoot: root }).publish({
    relativePath: "reports/evidence.zip",
    attempt: 1,
    manifest,
    entries: [
      {
        path: "reports/report.html",
        associationId: "report-html",
        source: Readable.from([html]),
      },
      {
        path: "evidence/log.txt",
        associationId: "ev-log",
        source: Readable.from([log]),
      },
    ],
  });
}

describe("evidence ZIP verifier", () => {
  it("reopens ZIP64 and verifies every physical entry against the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-evidence-zip-verify-"));
    roots.push(root);
    const { manifest } = makeFixture();
    await publishFixture(root, manifest);

    await expect(
      new EvidenceZipVerifier({ runRoot: root }).verify({
        relativePath: "reports/evidence.zip",
        manifest,
      }),
    ).resolves.toMatchObject({
      state: "VERIFIED",
      relativePath: "reports/evidence.zip",
      entries: [
        { path: "evidence/log.txt", sizeBytes: 12 },
        { path: "reports/report.html", sizeBytes: 20 },
      ],
    });
  });

  it("rejects an archive whose bytes do not match the recorded manifest hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-evidence-zip-verify-"));
    roots.push(root);
    const fixture = makeFixture();
    const tamperedManifest = createZipManifest({
      html: {
        relativePath: "reports/report.html",
        sha256: "f".repeat(64),
        sizeBytes: fixture.manifest.entries.find((entry) => entry.associationId === "report-html")!
          .sizeBytes,
      },
      evidence: [
        {
          id: "ev-log",
          kind: "LOGCAT_SEGMENT",
          state: "READY",
          finalRelativePath: "evidence/log.txt",
          sha256: fixture.manifest.entries.find((entry) => entry.associationId === "ev-log")!
            .sha256,
          sizeBytes: fixture.manifest.entries.find((entry) => entry.associationId === "ev-log")!
            .sizeBytes,
        },
      ],
    });
    await publishFixture(root, tamperedManifest);

    await expect(
      new EvidenceZipVerifier({ runRoot: root }).verify({
        relativePath: "reports/evidence.zip",
        manifest: tamperedManifest,
      }),
    ).rejects.toThrow(/sha256|hash/i);
  });

  it("rejects archive paths outside the configured run root before opening a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-evidence-zip-verify-"));
    roots.push(root);
    const { manifest } = makeFixture();

    await expect(
      new EvidenceZipVerifier({ runRoot: root }).verify({
        relativePath: "../outside.zip",
        manifest,
      }),
    ).rejects.toThrow(/relative|inside/i);
  });
});
