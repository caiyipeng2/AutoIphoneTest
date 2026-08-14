import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceManifestStore } from "./evidence-manifest.js";
import { redactLogcatEvidence } from "./logcat-evidence.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function createManifestedSegment(): Promise<{
  root: string;
  manifest: Awaited<ReturnType<EvidenceManifestStore["flush"]>>;
}> {
  const root = await mkdtemp(join(tmpdir(), "test-center-logcat-evidence-"));
  roots.push(root);
  const source = [
    "08-10 10:11:12.345  123  456 I Unity: token=access-secret action=金币 ABC\n",
    "08-10 10:11:13.345  123  456 W Unity: Authorization: Bearer bearer-secret\n",
  ].join("");
  await writeFile(join(root, "logcat-0001.raw"), source, "utf8");
  const store = new EvidenceManifestStore({ rootPath: root, runId: "run-1" });
  await store.register({
    evidenceId: "logcat-1",
    kind: "logcat-segment",
    relativePath: "logcat-0001.raw",
    serial: "serial-a",
    metadata: { startedAtMonotonicMs: 100, endedAtMonotonicMs: 200 },
  });
  return { root, manifest: await store.flush() };
}

describe("logcat evidence redaction", () => {
  it("redacts secrets and token patterns while preserving threadtime prefixes", async () => {
    const { root, manifest } = await createManifestedSegment();

    const result = await redactLogcatEvidence({
      rootPath: root,
      manifest,
      evidenceId: "logcat-1",
      serial: "serial-a",
      secrets: ["access-secret", "bearer-secret"],
      actionTexts: ["金币 ABC"],
      maxBytes: 4096,
      maxLines: 10,
      range: { startMonotonicMs: 100, endMonotonicMs: 200 },
    });

    expect(result).toMatchObject({
      evidenceId: "logcat-1",
      serial: "serial-a",
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      recordCount: 2,
      truncated: false,
    });
    expect(result.content).toContain("08-10 10:11:12.345  123  456 I Unity:");
    expect(result.content).not.toContain("access-secret");
    expect(result.content).not.toContain("金币 ABC");
    expect(result.content).not.toContain("bearer-secret");
    expect(result.content).toContain("[REDACTED_TEXT]");
  });

  it("bounds output by bytes and records truncation while draining the source", async () => {
    const { root, manifest } = await createManifestedSegment();
    const result = await redactLogcatEvidence({
      rootPath: root,
      manifest,
      evidenceId: "logcat-1",
      serial: "serial-a",
      secrets: [],
      maxBytes: 40,
      maxLines: 10,
    });

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(40);
    expect(result.sourceSha256).toBe(
      createHash("sha256")
        .update(
          [
            "08-10 10:11:12.345  123  456 I Unity: token=access-secret action=金币 ABC\n",
            "08-10 10:11:13.345  123  456 W Unity: Authorization: Bearer bearer-secret\n",
          ].join(""),
        )
        .digest("hex"),
    );
  });

  it("rejects unregistered IDs, serial mismatches, source changes, and out-of-range windows", async () => {
    const { root, manifest } = await createManifestedSegment();

    await expect(
      redactLogcatEvidence({
        rootPath: root,
        manifest,
        evidenceId: "missing-logcat",
        serial: "serial-a",
        secrets: [],
        maxBytes: 100,
        maxLines: 10,
      }),
    ).rejects.toThrow(/registered/);
    await expect(
      redactLogcatEvidence({
        rootPath: root,
        manifest,
        evidenceId: "logcat-1",
        serial: "serial-b",
        secrets: [],
        maxBytes: 100,
        maxLines: 10,
      }),
    ).rejects.toThrow(/serial/);
    await expect(
      redactLogcatEvidence({
        rootPath: root,
        manifest,
        evidenceId: "logcat-1",
        serial: "serial-a",
        secrets: [],
        maxBytes: 100,
        maxLines: 10,
        range: { startMonotonicMs: 99, endMonotonicMs: 200 },
      }),
    ).rejects.toThrow(/range/);

    await writeFile(join(root, "logcat-0001.raw"), "tampered\n", "utf8");
    await expect(
      redactLogcatEvidence({
        rootPath: root,
        manifest,
        evidenceId: "logcat-1",
        serial: "serial-a",
        secrets: [],
        maxBytes: 100,
        maxLines: 10,
      }),
    ).rejects.toThrow(/hash|size|changed/);
  });
});
