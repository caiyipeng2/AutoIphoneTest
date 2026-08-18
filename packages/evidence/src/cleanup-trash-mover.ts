import { mkdir, rename } from "node:fs/promises";
import { win32 } from "node:path";

export interface CleanupMoveFileSystem {
  mkdir(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
}

export interface CleanupMoveRequest {
  readonly runsRoot: string;
  readonly trashRoot: string;
  readonly cleanupId: string;
  readonly runIds: readonly string[];
}

export interface CleanupMovedRun {
  readonly runId: string;
  readonly sourcePath: string;
  readonly trashPath: string;
}

export interface CleanupMoveResult {
  readonly cleanupId: string;
  readonly moved: readonly CleanupMovedRun[];
}

const defaultFileSystem: CleanupMoveFileSystem = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  rename: async (source, destination) => {
    await rename(source, destination);
  },
};

/** Moves owned run directories into same-volume trash and rolls back partial moves. */
export class CleanupTrashMover {
  public constructor(private readonly fileSystem: CleanupMoveFileSystem = defaultFileSystem) {}

  public async move(request: CleanupMoveRequest): Promise<CleanupMoveResult> {
    const normalized = normalizeRequest(request);
    const trashDirectory = win32.join(normalized.trashRoot, normalized.cleanupId);
    await this.fileSystem.mkdir(trashDirectory);
    const moved: CleanupMovedRun[] = [];
    try {
      for (const runId of normalized.runIds) {
        const sourcePath = win32.join(normalized.runsRoot, runId);
        const trashPath = win32.join(trashDirectory, runId);
        await this.fileSystem.rename(sourcePath, trashPath);
        moved.push({ runId, sourcePath, trashPath });
      }
      return { cleanupId: normalized.cleanupId, moved };
    } catch (error) {
      const rollbackFailures: unknown[] = [];
      for (const item of [...moved].reverse()) {
        try {
          await this.fileSystem.rename(item.trashPath, item.sourcePath);
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError);
        }
      }
      if (rollbackFailures.length > 0) {
        throw new Error(
          `Cleanup move failed and ${rollbackFailures.length} rollback operation(s) also failed.`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

function normalizeRequest(request: CleanupMoveRequest): CleanupMoveRequest {
  validateAbsoluteWindowsPath(request.runsRoot, "runsRoot");
  validateAbsoluteWindowsPath(request.trashRoot, "trashRoot");
  if (
    win32.parse(request.runsRoot).root.toLowerCase() !==
    win32.parse(request.trashRoot).root.toLowerCase()
  ) {
    throw new TypeError("runsRoot and trashRoot must be on the same volume.");
  }
  if (
    isPathWithin(request.runsRoot, request.trashRoot) ||
    isPathWithin(request.trashRoot, request.runsRoot)
  ) {
    throw new TypeError("runsRoot and trashRoot must not overlap.");
  }
  validateSegment(request.cleanupId, "cleanup ID");
  if (!Array.isArray(request.runIds) || request.runIds.length === 0) {
    throw new TypeError("At least one run ID is required.");
  }
  const runIds = [...request.runIds];
  for (const runId of runIds) validateSegment(runId, "run ID");
  if (new Set(runIds).size !== runIds.length)
    throw new TypeError("Run IDs must not contain duplicates.");
  runIds.sort(compareSegments);
  return { ...request, runIds };
}

function validateAbsoluteWindowsPath(value: string, field: string): void {
  if (
    !win32.isAbsolute(value) ||
    win32.parse(value).root === "\\" ||
    win32.parse(value).root === "/"
  ) {
    throw new TypeError(`${field} must be a fully qualified Windows path.`);
  }
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

function isPathWithin(basePath: string, candidatePath: string): boolean {
  const base = win32.normalize(basePath);
  const candidate = win32.normalize(candidatePath);
  if (win32.parse(base).root.toLowerCase() !== win32.parse(candidate).root.toLowerCase())
    return false;
  const relative = win32.relative(base, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..\\") && relative !== ".." && !win32.isAbsolute(relative))
  );
}
