import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { AtomicEvidencePublisher } from "../../packages/evidence/src/atomic-publisher.js";
import { EvidenceZipPublisher } from "../../packages/reports/src/evidence-zip.js";
import { createZipManifest } from "../../packages/reports/src/zip-manifest.js";

export type ReportCrashKind = "HTML" | "ZIP";
export type ReportCrashPhase = "TEMP_CREATED" | "MID_WRITE" | "CLOSED" | "HASHED" | "RENAMED";

export interface ReportCrashWorkerInput {
  readonly kind: ReportCrashKind;
  readonly phase: ReportCrashPhase;
  readonly runRoot: string;
}

export interface ReportCrashWorkerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the crash fixture in a separate Node process so the publisher cannot catch the exit. */
export function spawnCrashWorker(input: ReportCrashWorkerInput): Promise<ReportCrashWorkerResult> {
  const workerPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ["--import", "tsx", workerPath, JSON.stringify(input)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (status) => resolveResult({ status, stdout, stderr }));
  });
}

async function runWorker(input: ReportCrashWorkerInput): Promise<void> {
  const crash = (phase: ReportCrashPhase): void => {
    if (phase === input.phase) process.exit(75);
  };
  if (input.kind === "HTML") {
    await new AtomicEvidencePublisher({ runRoot: input.runRoot }).publish({
      relativePath: "reports/report.html",
      attempt: 1,
      content: htmlContent(input.phase),
      onPhase: crash,
    });
  } else {
    const html = "zip crash fixture\n";
    const sha256 = createHash("sha256").update(html).digest("hex");
    const manifest = createZipManifest({
      html: { relativePath: "reports/report.html", sha256, sizeBytes: Buffer.byteLength(html) },
      evidence: [],
    });
    await new EvidenceZipPublisher({ runRoot: input.runRoot }).publish({
      relativePath: "reports/evidence.zip",
      attempt: 1,
      manifest,
      entries: [
        {
          path: "reports/report.html",
          associationId: "report-html",
          source: zipContent(input.phase, html),
        },
      ],
      onPhase: crash,
    });
  }
}

async function* htmlContent(phase: ReportCrashPhase): AsyncGenerator<string> {
  if (phase === "TEMP_CREATED") process.exit(75);
  yield "<!doctype html><html><body>";
  if (phase === "MID_WRITE") process.exit(75);
  yield "complete fixture</body></html>\n";
}

async function* zipContent(phase: ReportCrashPhase, html: string): AsyncGenerator<string> {
  if (phase === "TEMP_CREATED") process.exit(75);
  yield html.slice(0, 5);
  if (phase === "MID_WRITE") process.exit(75);
  yield html.slice(5);
}

const entryPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (entryPath === resolve(fileURLToPath(import.meta.url))) {
  const payload = process.argv[2];
  if (payload === undefined) throw new Error("Crash worker input is required.");
  void runWorker(JSON.parse(payload) as ReportCrashWorkerInput).catch((error: unknown) => {
    process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
