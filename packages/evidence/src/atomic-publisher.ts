import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, win32 } from "node:path";

export type AtomicPublishPhase = "CLOSED" | "HASHED" | "RENAMED";
export type AtomicPublishChunk = string | Uint8Array;
export type AtomicPublishContent = Iterable<AtomicPublishChunk> | AsyncIterable<AtomicPublishChunk>;

export interface AtomicEvidencePublisherOptions {
  readonly runRoot: string;
}

export interface AtomicPublishRequest {
  readonly relativePath: string;
  readonly attempt: number;
  readonly content: AtomicPublishContent;
  readonly onPhase?: (phase: AtomicPublishPhase) => void;
}

export interface AtomicPublishResult {
  readonly state: "READY";
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** Publishes one evidence file without exposing a partially written final path. */
export class AtomicEvidencePublisher {
  private readonly runRoot: string;

  public constructor(options: AtomicEvidencePublisherOptions) {
    if (!win32.isAbsolute(options.runRoot)) throw new TypeError("runRoot must be absolute.");
    this.runRoot = win32.normalize(options.runRoot);
  }

  public async publish(request: AtomicPublishRequest): Promise<AtomicPublishResult> {
    validateAttempt(request.attempt);
    const relativePath = normalizeRelativePath(request.relativePath);
    const finalPath = resolveInside(this.runRoot, relativePath);
    const parentPath = dirname(finalPath);
    await assertFinalPathAvailable(finalPath, relativePath);
    await mkdir(parentPath, { recursive: true });

    const partialPath = win32.join(
      parentPath,
      `${win32.basename(finalPath)}.partial-${request.attempt}-${randomUUID()}`,
    );
    const handle = await open(partialPath, "wx");
    let closed = false;
    try {
      for await (const chunk of request.content) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
        await handle.write(bytes);
      }
      await handle.sync();
      await handle.close();
      closed = true;
      request.onPhase?.("CLOSED");

      const { sha256, sizeBytes } = await hashFile(partialPath);
      request.onPhase?.("HASHED");
      await rename(partialPath, finalPath);
      request.onPhase?.("RENAMED");
      return { state: "READY", relativePath, sizeBytes, sha256 };
    } catch (error) {
      if (!closed) await handle.close().catch(() => undefined);
      await rm(partialPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

async function hashFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const digest = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    digest.update(bytes);
    sizeBytes += bytes.byteLength;
  }
  return { sha256: digest.digest("hex"), sizeBytes };
}

async function assertFinalPathAvailable(finalPath: string, relativePath: string): Promise<void> {
  try {
    await stat(finalPath);
    throw new Error(`Final evidence path already exists: ${relativePath}`);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

function normalizeRelativePath(value: string): string {
  if (value.trim().length === 0 || win32.isAbsolute(value))
    throw new TypeError("relativePath must be relative.");
  const normalized = win32.normalize(value.replaceAll("/", "\\"));
  if (normalized === "." || normalized.startsWith("..\\") || normalized.includes(":\\"))
    throw new TypeError("relativePath must stay inside the run root.");
  return normalized.replaceAll("\\", "/");
}

function resolveInside(rootPath: string, relativePath: string): string {
  const root = win32.normalize(rootPath);
  const absolute = win32.resolve(root, relativePath.replaceAll("/", "\\"));
  if (absolute !== root && !absolute.startsWith(`${root}\\`))
    throw new TypeError("relativePath must stay inside the run root.");
  return absolute;
}

function validateAttempt(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("attempt must be positive.");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
