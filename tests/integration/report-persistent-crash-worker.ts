import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import Database from "better-sqlite3";

import {
  AtomicEvidencePublisher,
  type AtomicPublishRequest,
} from "../../packages/evidence/src/atomic-publisher.js";
import {
  EvidenceZipPublisher,
  type EvidenceZipPublishRequest,
} from "../../packages/reports/src/evidence-zip.js";
import { EvidenceZipVerifier } from "../../packages/reports/src/evidence-zip-verifier.js";
import { ReportExportRepository } from "../../packages/reports/src/report-export-repository.js";
import { ReportFinalizationService } from "../../packages/reports/src/report-finalization-service.js";
import { ReportPublicationService } from "../../packages/reports/src/report-publication-service.js";
import { ReportZipPublicationService } from "../../packages/reports/src/report-zip-publication-service.js";
import { createZipManifest } from "../../packages/reports/src/zip-manifest.js";

export type PersistentCrashKind = "HTML" | "ZIP";

export interface PersistentCrashWorkerInput {
  readonly databasePath: string;
  readonly runRoot: string;
  readonly runId: string;
  readonly crashKind: PersistentCrashKind;
}

export interface PersistentCrashWorkerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a real SQLite-backed finalizer in a child process so a post-rename exit is not caught. */
export function spawnPersistentCrashWorker(
  input: PersistentCrashWorkerInput,
): Promise<PersistentCrashWorkerResult> {
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

async function runWorker(input: PersistentCrashWorkerInput): Promise<void> {
  const database = new Database(input.databasePath);
  const exports = new ReportExportRepository(database, { runRoot: input.runRoot });
  const htmlPublisher = new CrashAfterRenameHtmlPublisher(input.runRoot, input.crashKind);
  const zipPublisher = new CrashAfterRenameZipPublisher(input.runRoot, input.crashKind);
  const finalization = new ReportFinalizationService(
    database,
    new ReportPublicationService(exports, htmlPublisher as unknown as AtomicEvidencePublisher),
    new ReportZipPublicationService(
      exports,
      zipPublisher as unknown as EvidenceZipPublisher,
      new EvidenceZipVerifier({ runRoot: input.runRoot }),
    ),
  );
  const html = "<!doctype html><html><body>persistent crash fixture</body></html>\n";
  const htmlRelativePath = `${input.runId}/reports/report-1.html`;
  const zipRelativePath = `${input.runId}/reports/evidence-1.zip`;
  const htmlPath = "reports/report-1.html";
  const htmlSha256 = createHash("sha256").update(html).digest("hex");
  const manifest = createZipManifest({
    html: { relativePath: htmlPath, sha256: htmlSha256, sizeBytes: Buffer.byteLength(html) },
    evidence: [],
  });

  await finalization.finalize({
    runId: input.runId,
    htmlExportId: `report-html-${input.runId}-1`,
    html: { relativePath: htmlRelativePath, attempt: 1, content: [html] },
    zipExportId: `report-zip-${input.runId}-1`,
    zip: {
      relativePath: zipRelativePath,
      attempt: 1,
      manifest,
      entries: [{ path: htmlPath, associationId: "report-html", source: [html] }],
    },
  });
}

class CrashAfterRenameHtmlPublisher {
  private readonly publisher: AtomicEvidencePublisher;

  public constructor(
    runRoot: string,
    private readonly crashKind: PersistentCrashKind,
  ) {
    this.publisher = new AtomicEvidencePublisher({ runRoot });
  }

  public async publish(
    request: AtomicPublishRequest,
  ): Promise<Awaited<ReturnType<AtomicEvidencePublisher["publish"]>>> {
    return await this.publisher.publish({
      ...request,
      onPhase: (phase) => {
        request.onPhase?.(phase);
        if (this.crashKind === "HTML" && phase === "RENAMED") process.exit(75);
      },
    });
  }
}

class CrashAfterRenameZipPublisher {
  private readonly publisher: EvidenceZipPublisher;

  public constructor(
    runRoot: string,
    private readonly crashKind: PersistentCrashKind,
  ) {
    this.publisher = new EvidenceZipPublisher({ runRoot });
  }

  public async publish(
    request: EvidenceZipPublishRequest,
  ): Promise<Awaited<ReturnType<EvidenceZipPublisher["publish"]>>> {
    return await this.publisher.publish({
      ...request,
      onPhase: (phase) => {
        request.onPhase?.(phase);
        if (this.crashKind === "ZIP" && phase === "RENAMED") process.exit(75);
      },
    });
  }

  public async cleanupPublished(relativePath: string): Promise<void> {
    await this.publisher.cleanupPublished(relativePath);
  }
}

const entryPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (entryPath === resolve(fileURLToPath(import.meta.url))) {
  const payload = process.argv[2];
  if (payload === undefined) throw new Error("Persistent crash worker input is required.");
  void runWorker(JSON.parse(payload) as PersistentCrashWorkerInput).catch((error: unknown) => {
    process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
