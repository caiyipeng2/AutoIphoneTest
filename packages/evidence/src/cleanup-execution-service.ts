import { rm } from "node:fs/promises";

import type { CleanupAuditRepository } from "./cleanup-audit-repository.js";
import type {
  CleanupMoveRequest,
  CleanupMovedRun,
  CleanupMoveResult,
} from "./cleanup-trash-mover.js";

export interface CleanupExecutionConfirmation {
  consume(input: { runIds: readonly string[]; expectedBytes: number; nonce: string }): void;
}

export interface CleanupExecutionFileSystem {
  remove(path: string): Promise<void>;
}

export interface CleanupExecutionMover {
  move(request: CleanupMoveRequest): Promise<CleanupMoveResult>;
  restore(
    request: CleanupMoveRequest,
    result: CleanupMoveResult,
  ): Promise<readonly CleanupMovedRun[]>;
}

export interface CleanupExecutionRequest extends CleanupMoveRequest {
  readonly nonce: string;
  readonly expectedBytes: number;
}

export interface CleanupExecutionResult {
  readonly cleanupId: string;
  readonly state: "DELETED" | "RECOVERY_REQUIRED";
  readonly moved: readonly CleanupMovedRun[];
  readonly deleted: readonly string[];
  readonly restored: readonly string[];
  readonly unresolved: readonly string[];
  readonly errorMessage?: string;
}

const defaultFileSystem: CleanupExecutionFileSystem = {
  remove: async (path) => await rm(path, { recursive: true, force: false }),
};

/** Executes a confirmed cleanup while preserving a recoverable audit trail. */
export class CleanupExecutionService {
  public constructor(
    private readonly repository: CleanupAuditRepository,
    private readonly confirmation: CleanupExecutionConfirmation,
    private readonly mover: CleanupExecutionMover,
    private readonly fileSystem: CleanupExecutionFileSystem = defaultFileSystem,
  ) {}

  public async execute(request: CleanupExecutionRequest): Promise<CleanupExecutionResult> {
    const normalized = normalizeRequest(request);
    this.confirmation.consume({
      runIds: normalized.runIds,
      expectedBytes: normalized.expectedBytes,
      nonce: normalized.nonce,
    });
    this.repository.markDeleting(normalized.runIds);
    this.repository.appendEvent({ cleanupId: normalized.cleanupId, kind: "STARTED" });

    let moved: CleanupMoveResult;
    try {
      moved = await this.mover.move(normalized);
    } catch (error) {
      for (const runId of normalized.runIds) {
        this.repository.appendEvent({
          cleanupId: normalized.cleanupId,
          kind: "MOVE_FAILED",
          runId,
          errorMessage: errorMessage(error),
        });
      }
      this.repository.markRecoveryRequired(normalized.runIds);
      this.repository.appendEvent({
        cleanupId: normalized.cleanupId,
        kind: "ROLLED_BACK",
        errorMessage: errorMessage(error),
      });
      return {
        cleanupId: normalized.cleanupId,
        state: "RECOVERY_REQUIRED",
        moved: [],
        deleted: [],
        restored: [],
        unresolved: [],
        errorMessage: errorMessage(error),
      };
    }

    for (const item of moved.moved) {
      this.repository.appendEvent({
        cleanupId: normalized.cleanupId,
        kind: "RUN_MOVED",
        runId: item.runId,
        sourcePath: item.sourcePath,
        trashPath: item.trashPath,
      });
    }

    const deleted: CleanupMovedRun[] = [];
    try {
      for (const item of moved.moved) {
        await this.fileSystem.remove(item.trashPath);
        deleted.push(item);
      }
      this.repository.markDeleted(normalized.runIds);
      this.repository.appendEvent({ cleanupId: normalized.cleanupId, kind: "COMPLETED" });
      return {
        cleanupId: normalized.cleanupId,
        state: "DELETED",
        moved: moved.moved,
        deleted: deleted.map((item) => item.runId),
        restored: [],
        unresolved: [],
      };
    } catch (error) {
      const pendingRestore = moved.moved.filter(
        (item) => !deleted.some((deletedItem) => deletedItem.runId === item.runId),
      );
      let restored: readonly CleanupMovedRun[] = [];
      let unresolved = pendingRestore.map((item) => item.runId);
      let failureMessage = errorMessage(error);
      try {
        restored = await this.mover.restore(normalized, {
          cleanupId: moved.cleanupId,
          moved: pendingRestore,
        });
        unresolved = pendingRestore
          .map((item) => item.runId)
          .filter((runId) => !restored.some((item) => item.runId === runId));
        for (const item of restored) {
          this.repository.appendEvent({
            cleanupId: normalized.cleanupId,
            kind: "RUN_RESTORED",
            runId: item.runId,
            sourcePath: item.sourcePath,
            trashPath: item.trashPath,
          });
        }
      } catch (restoreError) {
        failureMessage = `${failureMessage}; ${errorMessage(restoreError)}`;
      }
      this.repository.markRecoveryRequired(normalized.runIds);
      this.repository.appendEvent({
        cleanupId: normalized.cleanupId,
        kind: "ROLLED_BACK",
        errorMessage: failureMessage,
      });
      return {
        cleanupId: normalized.cleanupId,
        state: "RECOVERY_REQUIRED",
        moved: moved.moved,
        deleted: deleted.map((item) => item.runId),
        restored: restored.map((item) => item.runId),
        unresolved,
        errorMessage: failureMessage,
      };
    }
  }
}

function normalizeRequest(request: CleanupExecutionRequest): CleanupExecutionRequest {
  if (typeof request.nonce !== "string" || !request.nonce) {
    throw new TypeError("Cleanup confirmation nonce is required.");
  }
  if (!Number.isSafeInteger(request.expectedBytes) || request.expectedBytes < 0) {
    throw new TypeError("Cleanup expectedBytes must be a non-negative safe integer.");
  }
  if (!Array.isArray(request.runIds) || request.runIds.length === 0) {
    throw new TypeError("At least one run ID is required.");
  }
  const runIds = [...request.runIds];
  for (const runId of runIds) validateSegment(runId, "run ID");
  if (new Set(runIds).size !== runIds.length) {
    throw new TypeError("Run IDs must not contain duplicates.");
  }
  runIds.sort(compareSegments);
  validateSegment(request.cleanupId, "cleanup ID");
  return { ...request, runIds };
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

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Cleanup execution failed.";
}
