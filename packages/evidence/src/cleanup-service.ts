export type CleanupRunState =
  | "CREATED"
  | "PREFLIGHT"
  | "RUNNING"
  | "PAUSED"
  | "FINISHED"
  | "INTERRUPTED"
  | "FAILED"
  | "FINALIZING"
  | "COMPLETED"
  | "FINALIZATION_FAILED"
  | "ABORTED";

export type CleanupStorageEntry = {
  readonly kind: "EVIDENCE" | "REPORT" | "IMPORTED_ARTIFACT";
  readonly state: "PENDING" | "READY" | "FAILED" | "MISSING";
  readonly sizeBytes: number;
};

export interface CleanupRun {
  readonly runId: string;
  readonly state: CleanupRunState;
  readonly completedAt: string;
  readonly protected: boolean;
  readonly storage: readonly CleanupStorageEntry[];
}

export interface CleanupServiceOptions {
  readonly retentionDays: number;
}

export interface CleanupCandidate {
  readonly runId: string;
  readonly state: Extract<
    CleanupRunState,
    "FINISHED" | "FAILED" | "INTERRUPTED" | "COMPLETED" | "FINALIZATION_FAILED" | "ABORTED"
  >;
  readonly completedAt: string;
  readonly estimatedBytes: number;
}

export interface CleanupPreview {
  readonly cutoffAt: string;
  readonly candidates: readonly CleanupCandidate[];
  readonly totalEstimatedBytes: number;
}

const TERMINAL_STATES = new Set<CleanupRunState>([
  "FINISHED",
  "FAILED",
  "INTERRUPTED",
  "COMPLETED",
  "FINALIZATION_FAILED",
  "ABORTED",
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETENTION_DAYS = 3650;

/** Builds a non-destructive retention preview from already indexed run storage records. */
export class CleanupService {
  private readonly retentionDays: number;

  public constructor(options: CleanupServiceOptions) {
    if (
      !Number.isSafeInteger(options.retentionDays) ||
      options.retentionDays < 1 ||
      options.retentionDays > MAX_RETENTION_DAYS
    ) {
      throw new TypeError(`retentionDays must be between 1 and ${MAX_RETENTION_DAYS}.`);
    }
    this.retentionDays = options.retentionDays;
  }

  public preview(runs: readonly CleanupRun[], now: string): CleanupPreview {
    const nowMs = parseTimestamp(now, "now");
    const cutoffMs = nowMs - this.retentionDays * DAY_MS;
    const candidates = runs
      .map((run) => this.toCandidate(run, cutoffMs))
      .filter((candidate): candidate is CleanupCandidate => candidate !== undefined)
      .sort((left, right) => {
        const byDate = left.completedAt.localeCompare(right.completedAt);
        return byDate === 0 ? left.runId.localeCompare(right.runId) : byDate;
      });
    const totalEstimatedBytes = candidates.reduce(
      (total, candidate) => addBytes(total, candidate.estimatedBytes),
      0,
    );
    return {
      cutoffAt: new Date(cutoffMs).toISOString(),
      candidates,
      totalEstimatedBytes,
    };
  }

  private toCandidate(run: CleanupRun, cutoffMs: number): CleanupCandidate | undefined {
    if (!run.runId.trim()) throw new TypeError("runId is required.");
    const completedMs = parseTimestamp(run.completedAt, "completedAt");
    let estimatedBytes = 0;
    for (const item of run.storage) {
      if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0) {
        throw new TypeError("storage sizeBytes must be a non-negative safe integer.");
      }
      if (item.kind !== "IMPORTED_ARTIFACT" && item.state === "READY") {
        estimatedBytes = addBytes(estimatedBytes, item.sizeBytes);
      }
    }
    if (run.protected || !TERMINAL_STATES.has(run.state) || completedMs >= cutoffMs) {
      return undefined;
    }
    return {
      runId: run.runId,
      state: run.state as CleanupCandidate["state"],
      completedAt: run.completedAt,
      estimatedBytes,
    };
  }
}

function parseTimestamp(value: string, field: string): number {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be an ISO timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be an ISO timestamp.`);
  return parsed;
}

function addBytes(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total))
    throw new RangeError("storage byte estimate exceeds safe integer range.");
  return total;
}
