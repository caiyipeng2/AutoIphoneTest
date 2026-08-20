import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { ReportFinalizationRecoveryService } from "../../packages/reports/src/report-finalization-recovery-service.js";
import { AtomicEvidencePublisher } from "../../packages/evidence/src/atomic-publisher.js";
import { EvidenceZipPublisher } from "../../packages/reports/src/evidence-zip.js";
import { createZipManifest } from "../../packages/reports/src/zip-manifest.js";
import { spawnCrashWorker, type ReportCrashPhase } from "./report-crash-worker.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("M10 report publication crash boundaries", () => {
  it("cleans orphan partial HTML and ZIP files after representative child crashes", async () => {
    const phases: readonly ReportCrashPhase[] = ["TEMP_CREATED", "RENAMED"];
    for (const kind of ["HTML", "ZIP"] as const) {
      for (const phase of phases) {
        const root = await mkdtemp(join(tmpdir(), "test-center-report-crash-"));
        roots.push(root);
        const result = await spawnCrashWorker({ kind, phase, runRoot: root });
        expect(result.status, `${kind}/${phase}`).toBe(75);

        const finalPath = join(root, "reports", kind === "HTML" ? "report.html" : "evidence.zip");
        const filesBeforeRecovery = await listFiles(root);
        if (phase === "RENAMED") {
          expect(filesBeforeRecovery).toContain(
            join("reports", kind === "HTML" ? "report.html" : "evidence.zip"),
          );
          await expect(readFile(finalPath)).resolves.toBeTruthy();
        } else {
          expect(filesBeforeRecovery.some((file) => file.includes(".partial-"))).toBe(true);
          await expect(readFile(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
        }

        const database = new Database(":memory:");
        try {
          await new ReportFinalizationRecoveryService(database).reconcileOrphanedPartials(root);
        } finally {
          database.close();
        }
        expect((await listFiles(root)).some((file) => file.includes(".partial-"))).toBe(false);
      }
    }
  }, 30_000);

  it("covers every publisher phase with deterministic in-process fault injection", async () => {
    const phases: readonly ReportCrashPhase[] = [
      "TEMP_CREATED",
      "MID_WRITE",
      "CLOSED",
      "HASHED",
      "RENAMED",
    ];
    for (const kind of ["HTML", "ZIP"] as const) {
      for (const phase of phases) {
        const root = await mkdtemp(join(tmpdir(), "test-center-report-phase-"));
        roots.push(root);
        await expect(runInProcessProbe(kind, phase, root)).rejects.toThrow("injected crash");
        const finalPath = join(root, "reports", kind === "HTML" ? "report.html" : "evidence.zip");
        if (phase === "RENAMED") {
          await expect(readFile(finalPath)).resolves.toBeTruthy();
        } else {
          await expect(readFile(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
        }
        expect((await listFiles(root)).some((file) => file.includes(".partial-"))).toBe(false);
      }
    }
  });
});

async function runInProcessProbe(
  kind: "HTML" | "ZIP",
  phase: ReportCrashPhase,
  runRoot: string,
): Promise<void> {
  const inject = (current: ReportCrashPhase): void => {
    if (current === phase) throw new Error("injected crash");
  };
  if (kind === "HTML") {
    await new AtomicEvidencePublisher({ runRoot }).publish({
      relativePath: "reports/report.html",
      attempt: 1,
      content: crashingHtmlContent(phase),
      onPhase: inject,
    });
    return;
  }
  const html = "zip crash fixture\n";
  const sha256 = createHash("sha256").update(html).digest("hex");
  await new EvidenceZipPublisher({ runRoot }).publish({
    relativePath: "reports/evidence.zip",
    attempt: 1,
    manifest: createZipManifest({
      html: { relativePath: "reports/report.html", sha256, sizeBytes: Buffer.byteLength(html) },
      evidence: [],
    }),
    entries: [
      {
        path: "reports/report.html",
        associationId: "report-html",
        source: Readable.from(crashingZipContent(phase, html)),
      },
    ],
    onPhase: inject,
  });
}

async function* crashingHtmlContent(phase: ReportCrashPhase): AsyncGenerator<string> {
  if (phase === "TEMP_CREATED") throw new Error("injected crash");
  yield "<!doctype html>";
  if (phase === "MID_WRITE") throw new Error("injected crash");
  yield "complete";
}

async function* crashingZipContent(phase: ReportCrashPhase, html: string): AsyncGenerator<string> {
  if (phase === "TEMP_CREATED") throw new Error("injected crash");
  yield html.slice(0, 5);
  if (phase === "MID_WRITE") throw new Error("injected crash");
  yield html.slice(5);
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(path.slice(root.length + 1));
    }
  }
  await visit(root);
  return files;
}
