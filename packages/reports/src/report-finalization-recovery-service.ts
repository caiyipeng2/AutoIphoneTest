import { readdir, rm } from "node:fs/promises";
import { join, win32 } from "node:path";

import type Database from "better-sqlite3";

import type {
  ReportFinalizationRecord,
  ReportFinalizationState,
} from "./report-finalization-service.js";

export interface ReportFinalizationRecoveryOptions {
  readonly now?: () => string;
  readonly staleAfterMs?: number;
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

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

/** Converts abandoned report leases into an explicit restart outcome. */
export class ReportFinalizationRecoveryService {
  private readonly now: () => string;
  private readonly staleAfterMs: number;

  public constructor(
    private readonly database: Database.Database,
    options: ReportFinalizationRecoveryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    if (!Number.isSafeInteger(this.staleAfterMs) || this.staleAfterMs < 0) {
      throw new TypeError("staleAfterMs must be a non-negative integer.");
    }
  }

  public get(runId: string): ReportFinalizationRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM run_finalizations WHERE run_id = ?")
      .get(runId) as FinalizationRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  /** Removes only publisher partials left behind by a hard process exit. */
  public async reconcileOrphanedPartials(runRoot: string): Promise<readonly string[]> {
    const normalizedRoot = normalizeRunRoot(runRoot);
    const partials = await findPartialFiles(normalizedRoot);
    await Promise.all(partials.map((filePath) => rm(filePath, { force: true })));
    return partials
      .map((filePath) => win32.relative(normalizedRoot, filePath).replaceAll("\\", "/"))
      .sort();
  }

  public reconcileStale(asOf = this.now()): readonly ReportFinalizationRecord[] {
    const asOfTime = Date.parse(asOf);
    if (!Number.isFinite(asOfTime)) throw new TypeError("asOf must be an ISO timestamp.");
    const cutoff = new Date(asOfTime - this.staleAfterMs).toISOString();
    const transaction = this.database.transaction(() => {
      const stale = this.database
        .prepare(
          `SELECT * FROM run_finalizations
           WHERE state = 'FINALIZING' AND updated_at < ?
           ORDER BY updated_at ASC, run_id ASC`,
        )
        .all(cutoff) as readonly FinalizationRow[];
      for (const row of stale) {
        const changed = this.database
          .prepare(
            `UPDATE run_finalizations
             SET state = 'INTERRUPTED', error_category = 'STARTUP_INTERRUPTED', updated_at = ?
             WHERE run_id = ? AND state = 'FINALIZING' AND updated_at < ?`,
          )
          .run(asOf, row.run_id, cutoff) as { changes: number };
        if (changed.changes !== 1) continue;
        this.database
          .prepare(
            `UPDATE test_runs
             SET state = 'INTERRUPTED', updated_at = ?
             WHERE id = ? AND state IN ('FINISHED', 'FAILED')`,
          )
          .run(asOf, row.run_id);
        this.database
          .prepare(
            `UPDATE report_exports
             SET state = 'FAILED', error_category = 'STARTUP_INTERRUPTED', updated_at = ?
             WHERE run_id = ? AND state = 'PENDING'`,
          )
          .run(asOf, row.run_id);
      }
      return stale
        .map((row) => this.get(row.run_id))
        .filter((record): record is ReportFinalizationRecord => record?.state === "INTERRUPTED");
    });
    return transaction.immediate();
  }
}

async function findPartialFiles(runRoot: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && isPartialName(entry.name)) {
        files.push(path);
      }
    }
  }
  await visit(runRoot);
  return files;
}

function isPartialName(name: string): boolean {
  return name.includes(".partial-") || name.endsWith(".partial");
}

function normalizeRunRoot(value: string): string {
  if (!win32.isAbsolute(value)) throw new TypeError("runRoot must be absolute.");
  return win32.normalize(value);
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
