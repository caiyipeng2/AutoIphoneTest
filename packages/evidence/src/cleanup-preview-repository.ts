import type Database from "better-sqlite3";

import {
  CleanupService,
  type CleanupPreview,
  type CleanupRun,
  type CleanupRunState,
} from "./cleanup-service.js";

interface CleanupPreviewRow {
  readonly id: string;
  readonly run_state: CleanupRunState;
  readonly updated_at: string;
  readonly cleanup_protected: number;
  readonly finalization_state: string | null;
  readonly completed_at: string | null;
  readonly evidence_bytes: number;
  readonly report_bytes: number;
}

/** Builds retention previews from durable run, finalization, evidence, and report records. */
export class CleanupPreviewRepository {
  public constructor(private readonly database: Database.Database) {}

  public preview(retentionDays: number, now: string): CleanupPreview {
    const service = new CleanupService({ retentionDays });
    return service.preview(this.listRuns(), now);
  }

  private listRuns(): readonly CleanupRun[] {
    const rows = this.database
      .prepare(
        `SELECT r.id,
                r.state AS run_state,
                r.updated_at,
                r.cleanup_protected,
                f.state AS finalization_state,
                f.completed_at,
                COALESCE((SELECT SUM(size_bytes)
                          FROM evidence_records
                          WHERE run_id = r.id AND state = 'READY' AND size_bytes IS NOT NULL), 0)
                  AS evidence_bytes,
                COALESCE((SELECT SUM(size_bytes)
                          FROM report_exports
                          WHERE run_id = r.id AND state = 'READY' AND size_bytes IS NOT NULL), 0)
                  AS report_bytes
         FROM test_runs AS r
         LEFT JOIN run_finalizations AS f ON f.run_id = r.id
         ORDER BY r.updated_at ASC, r.id ASC`,
      )
      .all() as readonly CleanupPreviewRow[];
    return rows.map((row) => ({
      runId: row.id,
      state: toCleanupState(row),
      completedAt: row.completed_at ?? row.updated_at,
      protected: row.cleanup_protected === 1,
      storage: [
        { kind: "EVIDENCE", state: "READY", sizeBytes: row.evidence_bytes },
        { kind: "REPORT", state: "READY", sizeBytes: row.report_bytes },
      ],
    }));
  }
}

function toCleanupState(row: CleanupPreviewRow): CleanupRunState {
  switch (row.finalization_state) {
    case "COMPLETED":
      return "COMPLETED";
    case "FINALIZATION_FAILED":
      return "FINALIZATION_FAILED";
    case "ABORTED":
      return "ABORTED";
    case "INTERRUPTED":
      return "INTERRUPTED";
    default:
      return row.run_state;
  }
}
