import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, win32 } from "node:path";
import { Readable } from "node:stream";

import { ZipArchive } from "archiver";
import { serializeZipManifest, type ZipManifest } from "./zip-manifest.js";

export type ZipPublishPhase = "CLOSED" | "HASHED" | "RENAMED";
export type ZipEntrySource = Readable | AsyncIterable<string | Uint8Array>;

export interface EvidenceZipPublisherOptions {
  readonly runRoot: string;
}

export interface EvidenceZipEntryInput {
  readonly path: string;
  readonly associationId: string;
  readonly source: ZipEntrySource;
}

export interface EvidenceZipPublishRequest {
  readonly relativePath: string;
  readonly attempt: number;
  readonly manifest: ZipManifest;
  readonly entries: readonly EvidenceZipEntryInput[];
  readonly onPhase?: (phase: ZipPublishPhase) => void;
}

export interface EvidenceZipPublishResult {
  readonly state: "READY";
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** Streams a verified manifest and its files into a forced-ZIP64 archive. */
export class EvidenceZipPublisher {
  private readonly runRoot: string;

  public constructor(options: EvidenceZipPublisherOptions) {
    if (!win32.isAbsolute(options.runRoot)) throw new TypeError("runRoot must be absolute.");
    this.runRoot = win32.normalize(options.runRoot);
  }

  public async publish(request: EvidenceZipPublishRequest): Promise<EvidenceZipPublishResult> {
    validateAttempt(request.attempt);
    const relativePath = normalizeRelativePath(request.relativePath);
    validateEntries(request.manifest, request.entries);
    const finalPath = resolveInside(this.runRoot, relativePath);
    const parentPath = dirname(finalPath);
    await assertFinalPathAvailable(finalPath, relativePath);
    await mkdir(parentPath, { recursive: true });

    const partialPath = win32.join(
      parentPath,
      `${win32.basename(finalPath)}.partial-${request.attempt}-${randomUUID()}`,
    );
    try {
      await writeArchive(partialPath, request.manifest, request.entries);
      request.onPhase?.("CLOSED");
      const { sha256, sizeBytes } = await hashFile(partialPath);
      request.onPhase?.("HASHED");
      await rename(partialPath, finalPath);
      request.onPhase?.("RENAMED");
      return { state: "READY", relativePath, sizeBytes, sha256 };
    } catch (error) {
      await rm(partialPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

async function writeArchive(
  partialPath: string,
  manifest: ZipManifest,
  entries: readonly EvidenceZipEntryInput[],
): Promise<void> {
  const output = createWriteStream(partialPath, { flags: "wx" });
  const archive = new ZipArchive({ forceZip64: true, zlib: { level: 9 } });
  const sources = entries.map((entry) => ({ entry, source: toReadable(entry.source) }));

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      archive.abort();
      output.destroy();
      reject(error);
    };
    const close = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    archive.pipe(output);
    archive.append(`${serializeZipManifest(manifest)}\n`, {
      name: "manifest.json",
      date: new Date(0),
    });
    for (const { entry, source } of sources) {
      source.once("error", fail);
      archive.append(source, { name: entry.path, date: new Date(0) });
    }
    archive.on("error", fail);
    archive.on("warning", fail);
    output.once("error", fail);
    output.once("close", close);
    void archive.finalize().catch(fail);
  });
}

function validateEntries(manifest: ZipManifest, entries: readonly EvidenceZipEntryInput[]): void {
  if (manifest.entries.some((entry) => entry.path.toLowerCase() === "manifest.json")) {
    throw new Error("ZIP manifest entry path is reserved: manifest.json");
  }
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry.associationId]));
  const seen = new Set<string>();
  for (const entry of entries) {
    const path = normalizeRelativePath(entry.path);
    if (path !== entry.path) throw new Error("ZIP physical entry path is not canonical.");
    if (seen.has(path)) throw new Error(`Duplicate ZIP physical entry: ${path}`);
    seen.add(path);
    if (expected.get(path) !== entry.associationId) {
      throw new Error(`ZIP physical entry association does not match: ${path}`);
    }
  }
  if (entries.length !== manifest.entries.length) {
    throw new Error("ZIP physical entries do not match the manifest.");
  }
  for (const path of expected.keys()) {
    if (!seen.has(path)) throw new Error(`ZIP physical entry is missing: ${path}`);
  }
}

function toReadable(source: ZipEntrySource): Readable {
  return source instanceof Readable ? source : Readable.from(source);
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
    throw new Error(`Final ZIP path already exists: ${relativePath}`);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

function normalizeRelativePath(value: string): string {
  if (value.trim().length === 0 || win32.isAbsolute(value)) {
    throw new TypeError("ZIP path must be relative.");
  }
  const forwardSlashValue = value.replaceAll("\\", "/");
  if (forwardSlashValue.split("/").some((segment) => segment === "..")) {
    throw new TypeError("ZIP path must stay inside the run root.");
  }
  const normalized = win32.normalize(forwardSlashValue.replaceAll("/", "\\"));
  if (normalized === "." || normalized.startsWith("..\\") || normalized.includes(":\\")) {
    throw new TypeError("ZIP path must stay inside the run root.");
  }
  return normalized.replaceAll("\\", "/");
}

function resolveInside(rootPath: string, relativePath: string): string {
  const root = win32.normalize(rootPath);
  const absolute = win32.resolve(root, relativePath.replaceAll("/", "\\"));
  if (absolute !== root && !absolute.startsWith(`${root}\\`)) {
    throw new TypeError("ZIP path must stay inside the run root.");
  }
  return absolute;
}

function validateAttempt(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("attempt must be positive.");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
