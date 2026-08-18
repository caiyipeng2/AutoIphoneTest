import type Database from "better-sqlite3";

export type CleanupState = "ACTIVE" | "DELETING" | "DELETED" | "RECOVERY_REQUIRED";
export type CleanupAuditEventKind =
  "STARTED" | "RUN_MOVED" | "RUN_RESTORED" | "MOVE_FAILED" | "COMPLETED" | "ROLLED_BACK";

export interface CleanupAuditRepositoryOptions {
  readonly now?: () => string;
}

export interface AppendCleanupAuditEventInput {
  readonly cleanupId: string;
  readonly kind: CleanupAuditEventKind;
  readonly runId?: string;
  readonly sourcePath?: string;
  readonly trashPath?: string;
  readonly errorMessage?: string;
}

export interface CleanupAuditEvent {
  readonly sequence: number;
  readonly cleanupId: string;
  readonly kind: CleanupAuditEventKind;
  readonly runId?: string;
  readonly sourcePath?: string;
  readonly trashPath?: string;
  readonly errorMessage?: string;
  readonly createdAt: string;
}

interface CleanupAuditEventRow {
  readonly sequence: number;
  readonly cleanup_id: string;
  readonly kind: CleanupAuditEventKind;
  readonly run_id: string | null;
  readonly source_path: string | null;
  readonly trash_path: string | null;
  readonly error_message: string | null;
  readonly created_at: string;
}

/** Persists cleanup state transitions and append-only move/recovery events. */
export class CleanupAuditRepository {
  private readonly now: () => string;

  public constructor(
    private readonly database: Database.Database,
    options: CleanupAuditRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public markDeleting(runIds: readonly string[]): readonly string[] {
    const normalizedRunIds = normalizeRunIds(runIds);
    const transaction = this.database.transaction(() => {
      for (const runId of normalizedRunIds) {
        const row = this.database
          .prepare("SELECT cleanup_state FROM test_runs WHERE id = ?")
          .get(runId) as { cleanup_state: CleanupState } | undefined;
        if (row === undefined) throw new Error(`Run not found: ${runId}.`);
        if (row.cleanup_state !== "ACTIVE") {
          throw new Error(`Run cleanup state is not ACTIVE: ${runId}.`);
        }
      }
      const now = this.now();
      for (const runId of normalizedRunIds) {
        const result = this.database
          .prepare(
            "UPDATE test_runs SET cleanup_state = 'DELETING', updated_at = ? WHERE id = ? AND cleanup_state = 'ACTIVE'",
          )
          .run(now, runId);
        if (result.changes !== 1)
          throw new Error(`Run cleanup state transition was rejected: ${runId}.`);
      }
      return normalizedRunIds;
    });
    return transaction.immediate();
  }

  public markDeleted(runIds: readonly string[]): readonly string[] {
    return this.transitionRuns(runIds, "DELETING", "DELETED");
  }

  public markRecoveryRequired(runIds: readonly string[]): readonly string[] {
    return this.transitionRuns(runIds, "DELETING", "RECOVERY_REQUIRED");
  }

  public appendEvent(input: AppendCleanupAuditEventInput): CleanupAuditEvent {
    validateEvent(input);
    const result = this.database
      .prepare(
        `INSERT INTO cleanup_audit_events
         (cleanup_id, kind, run_id, source_path, trash_path, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.cleanupId,
        input.kind,
        input.runId ?? null,
        input.sourcePath ?? null,
        input.trashPath ?? null,
        input.errorMessage ?? null,
        this.now(),
      );
    const row = this.database
      .prepare("SELECT * FROM cleanup_audit_events WHERE sequence = ?")
      .get(Number(result.lastInsertRowid)) as CleanupAuditEventRow | undefined;
    if (row === undefined) throw new Error("Cleanup audit event could not be read back.");
    return toEvent(row);
  }

  public listEvents(cleanupId: string): readonly CleanupAuditEvent[] {
    validateSegment(cleanupId, "cleanup ID");
    const rows = this.database
      .prepare("SELECT * FROM cleanup_audit_events WHERE cleanup_id = ? ORDER BY sequence ASC")
      .all(cleanupId) as readonly CleanupAuditEventRow[];
    return rows.map(toEvent);
  }

  private transitionRuns(
    runIds: readonly string[],
    fromState: CleanupState,
    toState: CleanupState,
  ): readonly string[] {
    const normalizedRunIds = normalizeRunIds(runIds);
    const transaction = this.database.transaction(() => {
      for (const runId of normalizedRunIds) {
        const result = this.database
          .prepare(
            "UPDATE test_runs SET cleanup_state = ?, updated_at = ? WHERE id = ? AND cleanup_state = ?",
          )
          .run(toState, this.now(), runId, fromState);
        if (result.changes !== 1) {
          const row = this.database
            .prepare("SELECT cleanup_state FROM test_runs WHERE id = ?")
            .get(runId) as { cleanup_state: CleanupState } | undefined;
          if (row === undefined) throw new Error(`Run not found: ${runId}.`);
          throw new Error(`Run cleanup state must be ${fromState} before ${toState}: ${runId}.`);
        }
      }
      return normalizedRunIds;
    });
    return transaction.immediate();
  }
}

function validateEvent(input: AppendCleanupAuditEventInput): void {
  validateSegment(input.cleanupId, "cleanup ID");
  if (
    (input.kind === "RUN_MOVED" || input.kind === "RUN_RESTORED" || input.kind === "MOVE_FAILED") &&
    input.runId === undefined
  ) {
    throw new TypeError(`${input.kind} audit event requires a run ID.`);
  }
  if (input.runId !== undefined) validateSegment(input.runId, "run ID");
  if (input.errorMessage !== undefined && !input.errorMessage.trim()) {
    throw new TypeError("errorMessage must not be empty.");
  }
}

function normalizeRunIds(runIds: readonly string[]): readonly string[] {
  if (!Array.isArray(runIds) || runIds.length === 0)
    throw new TypeError("At least one run ID is required.");
  const normalized = [...runIds];
  for (const runId of normalized) validateSegment(runId, "run ID");
  if (new Set(normalized).size !== normalized.length)
    throw new TypeError("Run IDs must not contain duplicates.");
  normalized.sort(compareSegments);
  return normalized;
}

function validateSegment(value: string, field: string): void {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new TypeError(`${field} must be a single safe path segment.`);
  }
}

function compareSegments(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toEvent(row: CleanupAuditEventRow): CleanupAuditEvent {
  return {
    sequence: row.sequence,
    cleanupId: row.cleanup_id,
    kind: row.kind,
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    ...(row.source_path === null ? {} : { sourcePath: row.source_path }),
    ...(row.trash_path === null ? {} : { trashPath: row.trash_path }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    createdAt: row.created_at,
  };
}
