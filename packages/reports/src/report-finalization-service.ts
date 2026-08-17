import type Database from "better-sqlite3";

import type { ReportPublicationRequest } from "./report-publication-service.js";
import type { ReportExportRecord } from "./report-export-repository.js";
import type { ReportZipPublicationRequest } from "./report-zip-publication-service.js";

export interface ReportHtmlFinalizer {
  publish(exportId: string, request: ReportPublicationRequest): Promise<ReportExportRecord>;
}

export interface ReportZipFinalizer {
  publish(exportId: string, request: ReportZipPublicationRequest): Promise<ReportExportRecord>;
}

export interface ReportFinalizationRequest {
  readonly runId: string;
  readonly htmlExportId: string;
  readonly html: ReportPublicationRequest;
  readonly zipExportId: string;
  readonly zip: ReportZipPublicationRequest;
}

export type ReportFinalizationState =
  "FINALIZING" | "COMPLETED" | "FINALIZATION_FAILED" | "ABORTED" | "INTERRUPTED";

export interface ReportFinalizationRecord {
  readonly runId: string;
  readonly state: ReportFinalizationState;
  readonly attempt: number;
  readonly errorCategory?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
}

export interface ReportFinalizationServiceOptions {
  readonly now?: () => string;
}

interface FinalizationRow {
  readonly run_id: string;
  readonly state: ReportFinalizationState;
  readonly attempt: number;
  readonly error_category: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly updated_at: string;
}

/** Owns the report-only FINALIZING lease and serializes HTML before ZIP publication. */
export class ReportFinalizationService {
  private readonly now: () => string;

  public constructor(
    private readonly database: Database.Database,
    private readonly html: ReportHtmlFinalizer,
    private readonly zip: ReportZipFinalizer,
    options: ReportFinalizationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public get(runId: string): ReportFinalizationRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM run_finalizations WHERE run_id = ?")
      .get(runId) as FinalizationRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  public async finalize(request: ReportFinalizationRequest): Promise<ReportFinalizationRecord> {
    const started = this.acquire(request.runId);
    try {
      await this.html.publish(request.htmlExportId, request.html);
      await this.zip.publish(request.zipExportId, request.zip);
      return this.markCompleted(request.runId, started.attempt);
    } catch (error) {
      this.markFailed(request.runId, started.attempt, "EXPORT_FAILED");
      throw error;
    }
  }

  private acquire(runId: string): ReportFinalizationRecord {
    if (!runId.trim()) throw new TypeError("Report finalization runId is required.");
    const transaction = this.database.transaction(() => {
      const run = this.database.prepare("SELECT state FROM test_runs WHERE id = ?").get(runId) as
        { state: string } | undefined;
      if (run === undefined) throw new Error("Report finalization run not found.");
      if (run.state !== "FINISHED" && run.state !== "FAILED" && run.state !== "INTERRUPTED") {
        throw new Error(`Report finalization requires a terminal run state: ${run.state}`);
      }
      const current = this.database
        .prepare("SELECT * FROM run_finalizations WHERE run_id = ?")
        .get(runId) as FinalizationRow | undefined;
      if (current?.state === "FINALIZING") throw new Error("Report run is already FINALIZING.");
      if (current?.state === "COMPLETED") throw new Error("Report run is already COMPLETED.");
      const attempt = (current?.attempt ?? 0) + 1;
      const now = this.now();
      if (current === undefined) {
        this.database
          .prepare(
            `INSERT INTO run_finalizations
             (run_id, state, attempt, error_category, started_at, completed_at, updated_at)
             VALUES (?, 'FINALIZING', ?, NULL, ?, NULL, ?)`,
          )
          .run(runId, attempt, now, now);
      } else {
        this.database
          .prepare(
            `UPDATE run_finalizations
             SET state = 'FINALIZING', attempt = ?, error_category = NULL,
                 started_at = ?, completed_at = NULL, updated_at = ?
             WHERE run_id = ? AND state <> 'FINALIZING'`,
          )
          .run(attempt, now, now, runId);
      }
      const created = this.database
        .prepare("SELECT * FROM run_finalizations WHERE run_id = ?")
        .get(runId) as FinalizationRow | undefined;
      if (created === undefined) throw new Error("Finalization lease could not be read back.");
      return toRecord(created);
    });
    return transaction.immediate();
  }

  private markCompleted(runId: string, attempt: number): ReportFinalizationRecord {
    const now = this.now();
    const result = this.database
      .prepare(
        `UPDATE run_finalizations
         SET state = 'COMPLETED', completed_at = ?, updated_at = ?
         WHERE run_id = ? AND state = 'FINALIZING' AND attempt = ?`,
      )
      .run(now, now, runId, attempt);
    if (result.changes !== 1) throw new Error("Finalization completion was rejected.");
    const record = this.get(runId);
    if (record === undefined) throw new Error("Completed finalization could not be read back.");
    return record;
  }

  private markFailed(runId: string, attempt: number, category: string): void {
    this.database
      .prepare(
        `UPDATE run_finalizations
         SET state = 'FINALIZATION_FAILED', error_category = ?, updated_at = ?
         WHERE run_id = ? AND state = 'FINALIZING' AND attempt = ?`,
      )
      .run(category, this.now(), runId, attempt);
  }
}

function toRecord(row: FinalizationRow): ReportFinalizationRecord {
  return {
    runId: row.run_id,
    state: row.state,
    attempt: row.attempt,
    ...(row.error_category === null ? {} : { errorCategory: row.error_category }),
    startedAt: row.started_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    updatedAt: row.updated_at,
  };
}
