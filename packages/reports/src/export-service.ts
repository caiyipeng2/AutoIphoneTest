import { isAbsolute } from "node:path";
import { win32 } from "node:path";

import type { ImmutableReportModel } from "./report-model.js";
import {
  ReportExportRepository,
  type ReportExportFormat,
  type ReportExportRecord,
} from "./report-export-repository.js";

export type ReportOptionalExportFormat = "EXCEL" | "PDF" | "JUNIT";

export interface ReportExportPublishResult {
  readonly finalPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ReportExportPublisher {
  publish(model: ImmutableReportModel, finalPath: string): Promise<ReportExportPublishResult>;
}

export interface ReportExportServiceOptions {
  readonly repository: ReportExportRepository;
  readonly runRoot: string;
  readonly loadModel: (runId: string) => ImmutableReportModel | Promise<ImmutableReportModel>;
  readonly publishers: Readonly<Record<ReportOptionalExportFormat, ReportExportPublisher>>;
}

interface QueuedExport {
  readonly record: ReportExportRecord;
  readonly format: ReportOptionalExportFormat;
}

interface IdempotencyEntry {
  readonly runId: string;
  readonly signature: string;
  readonly records: readonly ReportExportRecord[];
}

const OPTIONAL_FORMATS: readonly ReportOptionalExportFormat[] = ["EXCEL", "PDF", "JUNIT"];

/** Queues optional report exports without changing the mandatory HTML/ZIP finalization path. */
export class ReportExportService {
  private readonly queue: QueuedExport[] = [];
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly activePromises = new Set<Promise<void>>();
  private activePdf = 0;
  private activeOther = 0;
  private drainPromise: Promise<void> | undefined;

  public constructor(private readonly options: ReportExportServiceOptions) {
    if (!isAbsolute(options.runRoot))
      throw new TypeError("Report export runRoot must be absolute.");
  }

  public request(
    runId: string,
    formats: readonly ReportOptionalExportFormat[],
    idempotencyKey: string,
  ): readonly ReportExportRecord[] {
    validateText(runId, "runId");
    validateText(idempotencyKey, "idempotencyKey");
    const normalized = normalizeFormats(formats);
    const signature = `${runId}:${normalized.join(",")}`;
    const existing = this.idempotency.get(idempotencyKey);
    if (existing !== undefined) {
      if (existing.runId !== runId || existing.signature !== signature) {
        throw new Error("Idempotency key was already used for another export request.");
      }
      return existing.records;
    }

    const records = normalized.map((format) => {
      const attempt = nextAttempt(this.options.repository.list(runId), format);
      return this.options.repository.create({
        id: `optional-${runId}-${format}-${attempt}`,
        runId,
        format,
        attempt,
        finalRelativePath: optionalRelativePath(runId, format, attempt),
      });
    });
    const entry = { runId, signature, records };
    this.idempotency.set(idempotencyKey, entry);
    for (const record of records) {
      this.queue.push({ record, format: record.format as ReportOptionalExportFormat });
    }
    this.startDrain();
    return records;
  }

  public async whenIdle(): Promise<void> {
    while (this.drainPromise !== undefined || this.queue.length > 0) {
      await this.drainPromise;
    }
  }

  private startDrain(): void {
    if (this.drainPromise !== undefined) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = undefined;
      if (this.queue.length > 0) this.startDrain();
    });
  }

  private async drain(): Promise<void> {
    while (true) {
      while (true) {
        const index = this.queue.findIndex((job) => this.canStart(job.format));
        if (index < 0) break;
        const [job] = this.queue.splice(index, 1);
        if (job === undefined) break;
        this.markActive(job.format, 1);
        const task = this.process(job).finally(() => {
          this.markActive(job.format, -1);
          this.activePromises.delete(task);
        });
        this.activePromises.add(task);
      }
      if (this.activePromises.size === 0) return;
      await Promise.race(this.activePromises);
    }
  }

  private canStart(format: ReportOptionalExportFormat): boolean {
    return format === "PDF" ? this.activePdf < 1 : this.activeOther < 2;
  }

  private markActive(format: ReportOptionalExportFormat, delta: 1 | -1): void {
    if (format === "PDF") this.activePdf += delta;
    else this.activeOther += delta;
  }

  private async process(job: QueuedExport): Promise<void> {
    try {
      const model = await this.options.loadModel(job.record.runId);
      if (!["FINISHED", "FAILED", "INTERRUPTED"].includes(model.run.state)) {
        throw new Error("Report source is not in a terminal state.");
      }
      const relativePath = job.record.finalRelativePath;
      if (relativePath === undefined) throw new Error("Report export path is missing.");
      const finalPath = win32.resolve(this.options.runRoot, relativePath.replaceAll("/", "\\"));
      const published = await this.options.publishers[job.format].publish(model, finalPath);
      this.options.repository.markReady(job.record.id, {
        finalRelativePath: relativePath,
        sha256: published.sha256,
        sizeBytes: published.sizeBytes,
      });
    } catch {
      this.options.repository.markFailed(job.record.id, { category: "EXPORT_FAILED" });
    }
  }
}

function normalizeFormats(
  formats: readonly ReportOptionalExportFormat[],
): readonly ReportOptionalExportFormat[] {
  if (formats.length === 0) throw new TypeError("At least one optional export format is required.");
  const unique = new Set(formats);
  if (
    unique.size !== formats.length ||
    [...unique].some((format) => !OPTIONAL_FORMATS.includes(format))
  ) {
    throw new TypeError("Optional export formats are invalid or duplicated.");
  }
  return OPTIONAL_FORMATS.filter((format) => unique.has(format));
}

function nextAttempt(records: readonly ReportExportRecord[], format: ReportExportFormat): number {
  return (
    Math.max(
      0,
      ...records.filter((record) => record.format === format).map((record) => record.attempt),
    ) + 1
  );
}

function optionalRelativePath(
  runId: string,
  format: ReportOptionalExportFormat,
  attempt: number,
): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId === "." || runId === "..") {
    throw new TypeError("Report runId cannot be used as an export path.");
  }
  const extension = format === "EXCEL" ? "xlsx" : format === "PDF" ? "pdf" : "xml";
  return `${runId}/reports/${format.toLowerCase()}-${attempt}.${extension}`;
}

function validateText(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} is required.`);
}
