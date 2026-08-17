import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { win32 } from "node:path";

import * as yauzl from "yauzl";
import type { ZipManifest } from "./zip-manifest.js";
import { serializeZipManifest } from "./zip-manifest.js";

export interface EvidenceZipVerifierOptions {
  readonly runRoot: string;
}

export interface EvidenceZipVerifyRequest {
  readonly relativePath: string;
  readonly manifest: ZipManifest;
}

export interface VerifiedZipEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface EvidenceZipVerifyResult {
  readonly state: "VERIFIED";
  readonly relativePath: string;
  readonly entries: readonly VerifiedZipEntry[];
}

/** Reopens a ZIP64 archive and verifies streamed entry bytes against its manifest. */
export class EvidenceZipVerifier {
  private readonly runRoot: string;

  public constructor(options: EvidenceZipVerifierOptions) {
    if (!win32.isAbsolute(options.runRoot)) throw new TypeError("runRoot must be absolute.");
    this.runRoot = win32.normalize(options.runRoot);
  }

  public async verify(request: EvidenceZipVerifyRequest): Promise<EvidenceZipVerifyResult> {
    const relativePath = normalizeRelativePath(request.relativePath);
    const archivePath = resolveInside(this.runRoot, relativePath);
    await assertArchiveExists(archivePath, relativePath);
    const expected = new Map(request.manifest.entries.map((entry) => [entry.path, entry]));
    const seen = new Set<string>();
    const measured: VerifiedZipEntry[] = [];
    let embeddedManifest: ZipManifest | undefined;
    const zipFile = await yauzl.openPromise(archivePath, {
      lazyEntries: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    try {
      for await (const entry of zipFile.eachEntry()) {
        if (entry.fileName === "manifest.json") {
          if (embeddedManifest !== undefined)
            throw new Error("ZIP contains duplicate manifest.json.");
          embeddedManifest = parseEmbeddedManifest(
            await readBoundedText(await zipFile.openReadStreamPromise(entry)),
          );
          continue;
        }
        const expectedEntry = expected.get(entry.fileName);
        if (expectedEntry === undefined) {
          throw new Error(`ZIP contains an unexpected entry: ${entry.fileName}`);
        }
        if (seen.has(entry.fileName))
          throw new Error(`ZIP contains duplicate entry: ${entry.fileName}`);
        seen.add(entry.fileName);
        const measuredEntry = await hashStream(await zipFile.openReadStreamPromise(entry));
        if (
          measuredEntry.sha256 !== expectedEntry.sha256 ||
          measuredEntry.sizeBytes !== expectedEntry.sizeBytes
        ) {
          throw new Error(`ZIP entry hash or size mismatch: ${entry.fileName}`);
        }
        measured.push({ path: entry.fileName, ...measuredEntry });
      }
    } finally {
      zipFile.close();
    }

    if (embeddedManifest === undefined) throw new Error("ZIP is missing manifest.json.");
    if (serializeZipManifest(embeddedManifest) !== serializeZipManifest(request.manifest)) {
      throw new Error("ZIP manifest does not match the expected manifest.");
    }
    if (seen.size !== expected.size)
      throw new Error("ZIP is missing one or more manifest entries.");
    measured.sort((left, right) => left.path.localeCompare(right.path));
    return { state: "VERIFIED", relativePath, entries: measured };
  }
}

async function hashStream(
  stream: AsyncIterable<Uint8Array>,
): Promise<Omit<VerifiedZipEntry, "path">> {
  const digest = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    digest.update(bytes);
    sizeBytes += bytes.byteLength;
  }
  return { sha256: digest.digest("hex"), sizeBytes };
}

async function readBoundedText(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += bytes.byteLength;
    if (sizeBytes > 4 * 1024 * 1024) throw new Error("ZIP manifest exceeds the 4 MiB limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseEmbeddedManifest(value: string): ZipManifest {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") throw new Error("manifest is not an object");
    return parsed as ZipManifest;
  } catch (error) {
    throw new Error("ZIP manifest is not valid JSON.", { cause: error });
  }
}

async function assertArchiveExists(archivePath: string, relativePath: string): Promise<void> {
  try {
    await stat(archivePath);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`ZIP archive is missing: ${relativePath}`, { cause: error });
    }
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

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
