import { win32 } from "node:path";

import type Database from "better-sqlite3";

export type ReportExportFormat = "HTML" | "ZIP";
export type ReportExportState = "PENDING" | "READY" | "FAILED" | "MISSING";

export interface ReportExportRecord {
  readonly id: string;
  readonly runId: string;
  readonly format: ReportExportFormat;
  readonly state: ReportExportState;
  readonly tempRelativePath?: string;
  readonly finalRelativePath?: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly errorCategory?: string;
  readonly attempt: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReportExportRepositoryOptions {
  readonly runRoot?: string;
  readonly now?: () => string;
}

export interface CreateReportExportInput {
  readonly id: string;
  readonly runId: string;
  readonly format: ReportExportFormat;
  readonly tempRelativePath?: string;
  readonly finalRelativePath?: string;
  readonly attempt: number;
}

export interface MarkReportExportReadyInput {
  readonly finalRelativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface MarkReportExportFailedInput {
  readonly category: string;
}

interface ReportExportRow {
  readonly id: string;
  readonly run_id: string;
  readonly format: ReportExportFormat;
  readonly state: ReportExportState;
  readonly temp_relative_path: string | null;
  readonly final_relative_path: string | null;
  readonly sha256: string | null;
  readonly size_bytes: number | null;
  readonly error_category: string | null;
  readonly attempt: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Persists HTML/ZIP export attempts without coupling state to file I/O. */
export class ReportExportRepository {
  private readonly now: () => string;
  private readonly runRoot?: string;

  public constructor(
    private readonly database: Database.Database,
    options: ReportExportRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    if (options.runRoot !== undefined) {
      if (!win32.isAbsolute(options.runRoot)) throw new TypeError("runRoot must be absolute.");
      this.runRoot = win32.normalize(options.runRoot);
    }
  }

  public create(input: CreateReportExportInput): ReportExportRecord {
    validateCreateInput(input);
    const tempRelativePath = this.normalizeOptionalPath(input.tempRelativePath);
    const finalRelativePath = this.normalizeOptionalPath(input.finalRelativePath);
    const existing = this.readRow(input.id);
    if (existing !== undefined) {
      if (!sameIdentity(existing, input, tempRelativePath, finalRelativePath)) {
        throw new Error("Report export id already exists with different content.");
      }
      return this.toRecord(existing);
    }
    const now = this.now();
    this.database
      .prepare(
        `INSERT INTO report_exports
         (id, run_id, format, state, temp_relative_path, final_relative_path, attempt, created_at, updated_at)
         VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.format,
        tempRelativePath ?? null,
        finalRelativePath ?? null,
        input.attempt,
        now,
        now,
      );
    const created = this.readRow(input.id);
    if (created === undefined) throw new Error("Report export could not be read back.");
    return this.toRecord(created);
  }

  public get(id: string): ReportExportRecord | undefined {
    const row = this.readRow(id);
    return row === undefined ? undefined : this.toRecord(row);
  }

  public listPending(runId?: string): readonly ReportExportRecord[] {
    const rows =
      runId === undefined
        ? (this.database
            .prepare(
              `SELECT * FROM report_exports
               WHERE state = 'PENDING' ORDER BY created_at ASC, id ASC`,
            )
            .all() as readonly ReportExportRow[])
        : (this.database
            .prepare(
              `SELECT * FROM report_exports
               WHERE state = 'PENDING' AND run_id = ?
               ORDER BY created_at ASC, id ASC`,
            )
            .all(runId) as readonly ReportExportRow[]);
    return rows.map((row) => this.toRecord(row));
  }

  public markReady(id: string, input: MarkReportExportReadyInput): ReportExportRecord {
    const finalRelativePath = this.normalizePath(input.finalRelativePath);
    if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new TypeError("sha256 must be lowercase hex.");
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
      throw new TypeError("sizeBytes must be a non-negative integer.");
    }
    return this.transition(id, (now) => ({
      sql: `UPDATE report_exports
           SET state = 'READY', final_relative_path = ?, sha256 = ?, size_bytes = ?,
               error_category = NULL, updated_at = ?
           WHERE id = ? AND state = 'PENDING'`,
      params: [finalRelativePath, input.sha256, input.sizeBytes, now, id],
    }));
  }

  public markFailed(id: string, input: MarkReportExportFailedInput): ReportExportRecord {
    return this.markTerminal(id, "FAILED", input.category);
  }

  public markMissing(id: string, input: MarkReportExportFailedInput): ReportExportRecord {
    return this.markTerminal(id, "MISSING", input.category);
  }

  private markTerminal(
    id: string,
    state: "FAILED" | "MISSING",
    category: string,
  ): ReportExportRecord {
    if (!category.trim()) throw new TypeError("Report export error category is required.");
    return this.transition(id, (now) => ({
      sql: `UPDATE report_exports
           SET state = ?, error_category = ?, updated_at = ?
           WHERE id = ? AND state = 'PENDING'`,
      params: [state, category, now, id],
    }));
  }

  private transition(
    id: string,
    update: (now: string) => { sql: string; params: readonly unknown[] },
  ): ReportExportRecord {
    const transaction = this.database.transaction(() => {
      const current = this.readRow(id);
      if (current === undefined) throw new Error("Report export not found.");
      if (current.state !== "PENDING") {
        throw new Error(`Report export is already terminal: ${current.state}`);
      }
      const mutation = update(this.now());
      const result = this.database.prepare(mutation.sql).run(...mutation.params);
      if (result.changes !== 1) throw new Error("Report export transition was rejected.");
      const updated = this.readRow(id);
      if (updated === undefined) throw new Error("Report export could not be read back.");
      return updated;
    });
    return this.toRecord(transaction.immediate());
  }

  private normalizeOptionalPath(value: string | undefined): string | undefined {
    return value === undefined ? undefined : this.normalizePath(value);
  }

  private normalizePath(value: string): string {
    if (value.trim().length === 0 || win32.isAbsolute(value)) {
      throw new TypeError("relative path must be relative.");
    }
    const normalized = win32.normalize(value.replaceAll("/", "\\"));
    if (normalized === "." || normalized.startsWith("..\\") || normalized.includes(":\\")) {
      throw new TypeError("relative path must stay inside the run root.");
    }
    if (this.runRoot !== undefined) resolveInside(this.runRoot, normalized.replaceAll("\\", "/"));
    return normalized.replaceAll("\\", "/");
  }

  private readRow(id: string): ReportExportRow | undefined {
    return this.database.prepare("SELECT * FROM report_exports WHERE id = ?").get(id) as
      ReportExportRow | undefined;
  }

  private toRecord(row: ReportExportRow): ReportExportRecord {
    return Object.freeze({
      id: row.id,
      runId: row.run_id,
      format: row.format,
      state: row.state,
      ...(row.temp_relative_path === null ? {} : { tempRelativePath: row.temp_relative_path }),
      ...(row.final_relative_path === null ? {} : { finalRelativePath: row.final_relative_path }),
      ...(row.sha256 === null ? {} : { sha256: row.sha256 }),
      ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
      ...(row.error_category === null ? {} : { errorCategory: row.error_category }),
      attempt: row.attempt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

function validateCreateInput(input: CreateReportExportInput): void {
  if (!input.id.trim() || !input.runId.trim())
    throw new TypeError("Report export id and runId are required.");
  if (input.format !== "HTML" && input.format !== "ZIP")
    throw new TypeError("Report export format is invalid.");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new TypeError("Report export attempt must be positive.");
  }
}

function sameIdentity(
  row: ReportExportRow,
  input: CreateReportExportInput,
  tempRelativePath: string | undefined,
  finalRelativePath: string | undefined,
): boolean {
  return (
    row.run_id === input.runId &&
    row.format === input.format &&
    row.temp_relative_path === (tempRelativePath ?? null) &&
    row.final_relative_path === (finalRelativePath ?? null) &&
    row.attempt === input.attempt
  );
}

function resolveInside(rootPath: string, relativePath: string): string {
  const root = win32.normalize(rootPath);
  const absolute = win32.resolve(root, relativePath.replaceAll("/", "\\"));
  if (absolute !== root && !absolute.startsWith(`${root}\\`)) {
    throw new TypeError("relative path must stay inside the run root.");
  }
  return absolute;
}
