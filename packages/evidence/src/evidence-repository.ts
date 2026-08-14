import { stat } from "node:fs/promises";
import { win32 } from "node:path";

import type Database from "better-sqlite3";

export type PersistedEvidenceKind =
  | "ACTION_LOG"
  | "LOGCAT_SEGMENT"
  | "RUN_EVENT"
  | "SCREENSHOT"
  | "TIMING"
  | "VIDEO"
  | "CURRENT_SCREENSHOT"
  | "FOREGROUND_PROCESS"
  | "REDACTED_LOGCAT"
  | "MAPPED_INPUT"
  | "APPIUM_TIMING"
  | "BRIDGE_STATE"
  | "BRIDGE_ARM"
  | "BRIDGE_ACK"
  | "BUFFERED_LOGCAT";
export type EvidenceState = "PENDING" | "READY" | "FAILED" | "MISSING";
export type EvidenceUnavailableReason =
  "DEVICE_DISCONNECTED" | "PROCESS_ABSENT" | "SOURCE_NOT_APPLICABLE";

export interface EvidenceRecord {
  readonly id: string;
  readonly runId: string;
  readonly actionId?: string;
  readonly serial?: string;
  readonly kind: PersistedEvidenceKind;
  readonly state: EvidenceState;
  readonly tempRelativePath?: string;
  readonly finalRelativePath?: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly captureErrorCategory?: string;
  readonly unavailableReason?: EvidenceUnavailableReason;
  readonly capturedAt?: string;
  readonly attempt: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvidenceRepositoryOptions {
  readonly runRoot?: string;
  readonly now?: () => string;
}

export interface CreateEvidenceInput {
  readonly id: string;
  readonly runId: string;
  readonly actionId?: string;
  readonly serial?: string;
  readonly kind: PersistedEvidenceKind;
  readonly tempRelativePath?: string;
  readonly finalRelativePath?: string;
  readonly capturedAt?: string;
  readonly attempt: number;
}

export interface MarkReadyInput {
  readonly finalRelativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly capturedAt?: string;
}

export interface MarkFailedInput {
  readonly category: string;
}

export interface MarkMissingInput {
  readonly reason: EvidenceUnavailableReason;
}

interface EvidenceRow {
  readonly id: string;
  readonly run_id: string;
  readonly action_id: string | null;
  readonly serial: string | null;
  readonly kind: PersistedEvidenceKind;
  readonly state: EvidenceState;
  readonly temp_relative_path: string | null;
  readonly final_relative_path: string | null;
  readonly sha256: string | null;
  readonly size_bytes: number | null;
  readonly capture_error_category: string | null;
  readonly unavailable_reason: EvidenceUnavailableReason | null;
  readonly captured_at: string | null;
  readonly attempt: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export class EvidenceRepository {
  private readonly now: () => string;
  private readonly runRoot?: string;

  public constructor(
    private readonly database: Database.Database,
    options: EvidenceRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    if (options.runRoot !== undefined) {
      if (!win32.isAbsolute(options.runRoot)) throw new TypeError("runRoot must be absolute.");
      this.runRoot = win32.normalize(options.runRoot);
    }
  }

  public create(input: CreateEvidenceInput): EvidenceRecord {
    validateCreateInput(input);
    const tempRelativePath = this.normalizeOptionalPath(input.tempRelativePath);
    const finalRelativePath = this.normalizeOptionalPath(input.finalRelativePath);
    const existing = this.readRow(input.id);
    if (existing !== undefined) {
      if (!sameIdentity(existing, input, tempRelativePath, finalRelativePath)) {
        throw new Error("Evidence id already exists with different content.");
      }
      return this.toRecord(existing);
    }
    const now = this.now();
    this.database
      .prepare(
        `INSERT INTO evidence_records
         (id, run_id, action_id, serial, kind, state, temp_relative_path, final_relative_path,
          captured_at, attempt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.actionId ?? null,
        input.serial ?? null,
        input.kind,
        tempRelativePath ?? null,
        finalRelativePath ?? null,
        input.capturedAt ?? null,
        input.attempt,
        now,
        now,
      );
    const created = this.readRow(input.id);
    if (created === undefined) throw new Error("Evidence could not be read back.");
    return this.toRecord(created);
  }

  public get(id: string): EvidenceRecord | undefined {
    const row = this.readRow(id);
    return row === undefined ? undefined : this.toRecord(row);
  }

  public listPending(runId?: string): readonly EvidenceRecord[] {
    const rows =
      runId === undefined
        ? (this.database
            .prepare(
              `SELECT * FROM evidence_records
               WHERE state = 'PENDING' ORDER BY created_at ASC, id ASC`,
            )
            .all() as readonly EvidenceRow[])
        : (this.database
            .prepare(
              `SELECT * FROM evidence_records
               WHERE state = 'PENDING' AND run_id = ? ORDER BY created_at ASC, id ASC`,
            )
            .all(runId) as readonly EvidenceRow[]);
    return rows.map((row) => this.toRecord(row));
  }

  public markReady(id: string, input: MarkReadyInput): EvidenceRecord {
    const finalRelativePath = this.normalizePath(input.finalRelativePath);
    if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new TypeError("sha256 must be lowercase hex.");
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
      throw new TypeError("sizeBytes must be a non-negative integer.");
    }
    return this.transition(id, (now) => ({
      sql: `UPDATE evidence_records
           SET state = 'READY', final_relative_path = ?, sha256 = ?, size_bytes = ?,
               captured_at = COALESCE(?, captured_at), capture_error_category = NULL,
               unavailable_reason = NULL, updated_at = ?
           WHERE id = ? AND state = 'PENDING'`,
      params: [finalRelativePath, input.sha256, input.sizeBytes, input.capturedAt ?? null, now, id],
    }));
  }

  public markFailed(id: string, input: MarkFailedInput): EvidenceRecord {
    if (!input.category.trim()) throw new TypeError("Failure category is required.");
    return this.transition(id, (now) => ({
      sql: `UPDATE evidence_records
           SET state = 'FAILED', capture_error_category = ?, unavailable_reason = NULL, updated_at = ?
           WHERE id = ? AND state = 'PENDING'`,
      params: [input.category, now, id],
    }));
  }

  public markMissing(id: string, input: MarkMissingInput): EvidenceRecord {
    return this.transition(id, (now) => ({
      sql: `UPDATE evidence_records
           SET state = 'MISSING', unavailable_reason = ?, capture_error_category = NULL, updated_at = ?
           WHERE id = ? AND state = 'PENDING'`,
      params: [input.reason, now, id],
    }));
  }

  public async reconcilePending(runId?: string): Promise<readonly EvidenceRecord[]> {
    if (this.runRoot === undefined) throw new Error("runRoot is required for reconciliation.");
    const pending = this.listPending(runId);
    const decisions = await Promise.all(
      pending.map(async (record) => {
        const finalExists = await this.pathExists(record.finalRelativePath);
        const partialExists = await this.pathExists(record.tempRelativePath);
        return {
          id: record.id,
          category: finalExists
            ? "ORPHANED_PENDING"
            : partialExists
              ? "ORPHANED_PARTIAL"
              : "ORPHANED_PENDING",
        };
      }),
    );
    const transaction = this.database.transaction(() => {
      const now = this.now();
      for (const decision of decisions) {
        this.database
          .prepare(
            `UPDATE evidence_records
             SET state = 'FAILED', capture_error_category = ?, updated_at = ?
             WHERE id = ? AND state = 'PENDING'`,
          )
          .run(decision.category, now, decision.id);
      }
    });
    transaction.immediate();
    return decisions
      .map((decision) => this.get(decision.id))
      .filter((record): record is EvidenceRecord => record !== undefined);
  }

  private transition(
    id: string,
    update: (now: string) => { sql: string; params: readonly unknown[] },
  ): EvidenceRecord {
    const transaction = this.database.transaction(() => {
      const current = this.readRow(id);
      if (current === undefined) throw new Error("Evidence not found.");
      if (current.state !== "PENDING")
        throw new Error(`Evidence is already terminal: ${current.state}`);
      const mutation = update(this.now());
      const result = this.database.prepare(mutation.sql).run(...mutation.params);
      if (result.changes !== 1) throw new Error("Evidence transition was rejected.");
      const updated = this.readRow(id);
      if (updated === undefined) throw new Error("Evidence could not be read back.");
      return updated;
    });
    return this.toRecord(transaction.immediate());
  }

  private async pathExists(relativePath: string | undefined): Promise<boolean> {
    if (relativePath === undefined || this.runRoot === undefined) return false;
    try {
      const file = await stat(resolveInside(this.runRoot, relativePath));
      return file.isFile();
    } catch (error) {
      return isMissingFile(error) ? false : Promise.reject(error);
    }
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

  private readRow(id: string): EvidenceRow | undefined {
    return this.database.prepare("SELECT * FROM evidence_records WHERE id = ?").get(id) as
      EvidenceRow | undefined;
  }

  private toRecord(row: EvidenceRow): EvidenceRecord {
    return Object.freeze({
      id: row.id,
      runId: row.run_id,
      ...(row.action_id === null ? {} : { actionId: row.action_id }),
      ...(row.serial === null ? {} : { serial: row.serial }),
      kind: row.kind,
      state: row.state,
      ...(row.temp_relative_path === null ? {} : { tempRelativePath: row.temp_relative_path }),
      ...(row.final_relative_path === null ? {} : { finalRelativePath: row.final_relative_path }),
      ...(row.sha256 === null ? {} : { sha256: row.sha256 }),
      ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
      ...(row.capture_error_category === null
        ? {}
        : { captureErrorCategory: row.capture_error_category }),
      ...(row.unavailable_reason === null ? {} : { unavailableReason: row.unavailable_reason }),
      ...(row.captured_at === null ? {} : { capturedAt: row.captured_at }),
      attempt: row.attempt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

function validateCreateInput(input: CreateEvidenceInput): void {
  if (!input.id.trim() || !input.runId.trim())
    throw new TypeError("Evidence id and runId are required.");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new TypeError("Evidence attempt must be positive.");
  }
}

function sameIdentity(
  row: EvidenceRow,
  input: CreateEvidenceInput,
  tempRelativePath: string | undefined,
  finalRelativePath: string | undefined,
): boolean {
  return (
    row.run_id === input.runId &&
    row.action_id === (input.actionId ?? null) &&
    row.serial === (input.serial ?? null) &&
    row.kind === input.kind &&
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

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
