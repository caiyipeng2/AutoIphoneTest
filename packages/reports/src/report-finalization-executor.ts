import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { win32 } from "node:path";
import { Readable } from "node:stream";

import type Database from "better-sqlite3";

import { EvidenceZipPublisher } from "./evidence-zip.js";
import { EvidenceZipVerifier } from "./evidence-zip-verifier.js";
import { AtomicEvidencePublisher } from "@test-center/evidence";
import { createZipManifest } from "./zip-manifest.js";
import { renderOfflineReport } from "./html-renderer.js";
import { ReportExportRepository } from "./report-export-repository.js";
import {
  ReportFinalizationService,
  type ReportFinalizationRecord,
} from "./report-finalization-service.js";
import { ReportPublicationService } from "./report-publication-service.js";
import { ReportSnapshotRepository } from "./report-snapshot-repository.js";
import { ReportZipPublicationService } from "./report-zip-publication-service.js";

export interface ReportFinalizationExecutorOptions {
  readonly runRoot: string;
  readonly now?: () => string;
}

interface IdempotentRequest {
  readonly runId: string;
  readonly promise: Promise<ReportFinalizationRecord>;
}

/** Rebuilds HTML/ZIP reports from SQLite snapshots without invoking device workers. */
export class ReportFinalizationExecutor {
  private readonly snapshot: ReportSnapshotRepository;
  private readonly exports: ReportExportRepository;
  private readonly finalization: ReportFinalizationService;
  private readonly runRoot: string;
  private readonly inFlightByRun = new Map<string, Promise<ReportFinalizationRecord>>();
  private readonly idempotentRequests = new Map<string, IdempotentRequest>();

  public constructor(database: Database.Database, options: ReportFinalizationExecutorOptions) {
    if (!win32.isAbsolute(options.runRoot)) throw new TypeError("runRoot must be absolute.");
    this.runRoot = win32.normalize(options.runRoot);
    this.snapshot = new ReportSnapshotRepository(database);
    this.exports = new ReportExportRepository(database, { runRoot: this.runRoot });
    this.finalization = new ReportFinalizationService(
      database,
      new ReportPublicationService(
        this.exports,
        new AtomicEvidencePublisher({ runRoot: this.runRoot }),
      ),
      new ReportZipPublicationService(
        this.exports,
        new EvidenceZipPublisher({ runRoot: this.runRoot }),
        new EvidenceZipVerifier({ runRoot: this.runRoot }),
      ),
      options.now === undefined ? {} : { now: options.now },
    );
  }

  public retryFinalization(
    runId: string,
    idempotencyKey: string,
  ): Promise<ReportFinalizationRecord> {
    validateText(runId, "runId");
    validateIdempotencyKey(idempotencyKey);
    const existing = this.idempotentRequests.get(idempotencyKey);
    if (existing !== undefined) {
      if (existing.runId !== runId) {
        throw new Error("Idempotency key was already used for another report run.");
      }
      return existing.promise;
    }

    const prior = this.inFlightByRun.get(runId);
    const queued = (prior === undefined ? Promise.resolve() : prior.catch(() => undefined)).then(
      async () => await this.execute(runId),
    );
    const tracked = queued.finally(() => {
      if (this.inFlightByRun.get(runId) === tracked) this.inFlightByRun.delete(runId);
    });
    this.inFlightByRun.set(runId, tracked);
    this.idempotentRequests.set(idempotencyKey, { runId, promise: tracked });
    while (this.idempotentRequests.size > 256) {
      const oldest = this.idempotentRequests.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.idempotentRequests.delete(oldest);
    }
    return tracked;
  }

  private async execute(runId: string): Promise<ReportFinalizationRecord> {
    const model = this.snapshot.load(runId);
    const previous = this.finalization.get(runId);
    const attempt = (previous?.attempt ?? 0) + 1;
    const runSegment = safeRunSegment(runId);
    const htmlArchivePath = `reports/report-${attempt}.html`;
    const zipArchivePath = `reports/evidence-${attempt}.zip`;
    const htmlRelativePath = `${runSegment}/${htmlArchivePath}`;
    const zipRelativePath = `${runSegment}/${zipArchivePath}`;
    const html = renderOfflineReport(model);
    const htmlBytes = Buffer.byteLength(html, "utf8");
    const htmlSha256 = createHash("sha256").update(html).digest("hex");
    const manifest = createZipManifest({
      html: { relativePath: htmlArchivePath, sha256: htmlSha256, sizeBytes: htmlBytes },
      evidence: model.evidence.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        state: entry.state,
        ...(entry.serial === undefined ? {} : { serial: entry.serial }),
        ...(entry.finalRelativePath === undefined
          ? {}
          : { finalRelativePath: toArchivePath(entry.finalRelativePath) }),
        ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 }),
        ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
        ...(entry.errorCategory === undefined ? {} : { errorCategory: entry.errorCategory }),
        ...(entry.unavailableReason === undefined
          ? {}
          : { unavailableReason: entry.unavailableReason }),
      })),
    });
    const htmlExportId = `report-html-${runId}-${attempt}`;
    const zipExportId = `report-zip-${runId}-${attempt}`;
    this.exports.create({
      id: htmlExportId,
      runId,
      format: "HTML",
      finalRelativePath: htmlRelativePath,
      attempt,
    });
    this.exports.create({
      id: zipExportId,
      runId,
      format: "ZIP",
      finalRelativePath: zipRelativePath,
      attempt,
    });
    return await this.finalization.finalize({
      runId,
      htmlExportId,
      html: { relativePath: htmlRelativePath, attempt, content: [html] },
      zipExportId,
      zip: {
        relativePath: zipRelativePath,
        attempt,
        manifest,
        entries: [
          {
            path: htmlArchivePath,
            associationId: "report-html",
            source: Readable.from([html]),
          },
          ...model.evidence
            .filter(
              (entry) =>
                entry.state === "READY" &&
                entry.finalRelativePath !== undefined &&
                entry.sha256 !== undefined &&
                entry.sizeBytes !== undefined,
            )
            .map((entry) => ({
              path: toArchivePath(entry.finalRelativePath!),
              associationId: entry.id,
              source: fileChunks(
                resolveRunPath(this.runRoot, runSegment, entry.finalRelativePath!),
              ),
            })),
        ],
      },
    });
  }
}

function validateText(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} is required.`);
}

function validateIdempotencyKey(value: string): void {
  validateText(value, "Idempotency key");
  if (value.trim().length > 128)
    throw new TypeError("Idempotency key must be at most 128 characters.");
}

function safeRunSegment(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId === "." || runId === "..") {
    throw new TypeError("Report runId cannot be used as a storage path.");
  }
  return runId;
}

function toArchivePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

function resolveRunPath(root: string, runSegment: string, relativePath: string): string {
  const normalizedRoot = win32.normalize(root);
  const candidate = win32.resolve(normalizedRoot, runSegment, relativePath.replaceAll("/", "\\"));
  const relative = win32.relative(normalizedRoot, candidate);
  if (
    relative !== runSegment &&
    (!relative.startsWith(`${runSegment}\\`) || relative.startsWith("..\\"))
  ) {
    throw new TypeError("Report evidence path escaped the run root.");
  }
  return candidate;
}

async function* fileChunks(filePath: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(filePath)) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}
