import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { win32 } from "node:path";

export type EvidenceKind =
  "action-log" | "logcat-segment" | "run-event" | "screenshot" | "timing" | "video";
export interface EvidenceManifestStoreOptions {
  readonly rootPath: string;
  readonly runId: string;
  readonly now?: () => string;
}
export interface EvidenceEntryInput {
  readonly evidenceId: string;
  readonly kind: EvidenceKind;
  readonly relativePath: string;
  readonly serial?: string;
  readonly capturedAt?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}
export interface EvidenceManifestEntry extends EvidenceEntryInput {
  readonly capturedAt: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}
export interface EvidenceManifest {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly generatedAt: string;
  readonly entries: readonly EvidenceManifestEntry[];
  readonly manifestSha256: string;
}

const MANIFEST_NAME = "evidence-manifest.json";

export class EvidenceManifestStore {
  private readonly rootPath: string;
  private readonly runId: string;
  private readonly now: () => string;
  private readonly entries = new Map<string, EvidenceManifestEntry>();
  private loaded = false;

  public constructor(options: EvidenceManifestStoreOptions) {
    if (!win32.isAbsolute(options.rootPath)) throw new TypeError("rootPath must be absolute.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.runId))
      throw new TypeError("runId is invalid.");
    this.rootPath = win32.normalize(options.rootPath);
    this.runId = options.runId;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async register(input: EvidenceEntryInput): Promise<EvidenceManifestEntry> {
    await this.loadExisting();
    const existing = this.entries.get(input.evidenceId);
    if (existing !== undefined) {
      if (!sameIdentity(existing, input))
        throw new Error(
          `Evidence ${input.evidenceId} is already registered with different payload.`,
        );
      return existing;
    }
    validateEvidenceId(input.evidenceId);
    const relativePath = normalizeRelativePath(input.relativePath);
    const absolutePath = resolveInside(this.rootPath, relativePath);
    const file = await stat(absolutePath);
    if (!file.isFile()) throw new Error(`Evidence path is not a file: ${relativePath}`);
    const bytes = await readFile(absolutePath);
    const entry: EvidenceManifestEntry = {
      ...input,
      relativePath,
      capturedAt: input.capturedAt ?? this.now(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
    };
    this.entries.set(entry.evidenceId, entry);
    return entry;
  }

  public async flush(): Promise<EvidenceManifest> {
    await this.loadExisting();
    const entries = [...this.entries.values()].sort((left, right) =>
      left.evidenceId.localeCompare(right.evidenceId),
    );
    const unsigned = {
      schemaVersion: 1 as const,
      runId: this.runId,
      generatedAt: this.now(),
      entries,
    };
    const canonical = `${JSON.stringify(unsigned, null, 2)}\n`;
    const manifest: EvidenceManifest = {
      ...unsigned,
      manifestSha256: createHash("sha256").update(canonical).digest("hex"),
    };
    const partialPath = win32.join(this.rootPath, `${MANIFEST_NAME}.${randomUUID()}.partial`);
    const handle = await open(partialPath, "wx");
    try {
      await handle.write(`${JSON.stringify(manifest, null, 2)}\n`, undefined, "utf8");
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
    const destination = win32.join(this.rootPath, MANIFEST_NAME);
    try {
      await rename(partialPath, destination);
    } catch (error) {
      await rm(destination, { force: true });
      await rename(partialPath, destination).catch(() => {
        throw error;
      });
    }
    return manifest;
  }

  private async loadExisting(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(
        await readFile(win32.join(this.rootPath, MANIFEST_NAME), "utf8"),
      ) as Partial<EvidenceManifest>;
      if (raw.runId !== this.runId || raw.schemaVersion !== 1 || !Array.isArray(raw.entries))
        throw new Error("Existing evidence manifest does not match this run.");
      for (const entry of raw.entries) this.entries.set(entry.evidenceId, entry);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
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
function validateEvidenceId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
    throw new TypeError("evidenceId is invalid.");
}
function sameIdentity(left: EvidenceManifestEntry, right: EvidenceEntryInput): boolean {
  return (
    left.kind === right.kind &&
    left.relativePath === normalizeRelativePath(right.relativePath) &&
    left.serial === right.serial
  );
}
function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
