import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceManifestStore } from "./evidence-manifest.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("evidence manifest", () => {
  it("hashes evidence and publishes an indexed manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-evidence-"));
    roots.push(root);
    await writeFile(join(root, "start.json"), '{"phase":"start"}\n', "utf8");
    const store = new EvidenceManifestStore({
      rootPath: root,
      runId: "run-001",
      now: () => "2026-08-11T12:00:00.000Z",
    });
    const entry = await store.register({
      evidenceId: "evidence-start",
      kind: "screenshot",
      relativePath: "start.json",
      serial: "R5CX211TXNT",
      capturedAt: "2026-08-11T11:59:59.000Z",
      metadata: { source: "preflight" },
    });
    const manifest = await store.flush();
    expect(entry).toMatchObject({
      evidenceId: "evidence-start",
      kind: "screenshot",
      sizeBytes: 18,
      sha256: "74b26d6712fadf9805140cb54d38e2ed8ae66c7131b52f5ad2ccce3328976e25",
    });
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      runId: "run-001",
      generatedAt: "2026-08-11T12:00:00.000Z",
      entries: [entry],
    });
    expect(manifest.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(await readFile(join(root, "evidence-manifest.json"), "utf8"))).toEqual(
      manifest,
    );
    expect((await readdir(root)).filter((name) => name.endsWith(".partial"))).toEqual([]);
  });

  it("is idempotent and rejects path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-evidence-"));
    roots.push(root);
    await writeFile(join(root, "action.jsonl"), "{}\n", "utf8");
    const store = new EvidenceManifestStore({ rootPath: root, runId: "run-002" });
    const input = {
      evidenceId: "action-log",
      kind: "action-log" as const,
      relativePath: "action.jsonl",
    };
    await expect(store.register({ ...input, relativePath: "../outside.jsonl" })).rejects.toThrow(
      "relativePath",
    );
    const first = await store.register(input);
    expect(await store.register(input)).toEqual(first);
    await expect(store.register({ ...input, relativePath: "other.jsonl" })).rejects.toThrow(
      "already registered",
    );
  });
});
