import { posix, win32 } from "node:path";

export type ZipManifestEvidenceState = "PENDING" | "READY" | "FAILED" | "MISSING";
export type ZipManifestEntryType = "HTML_REPORT" | "EVIDENCE";

export interface ZipManifestHtmlInput {
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ZipManifestEvidenceInput {
  readonly id: string;
  readonly kind: string;
  readonly state: ZipManifestEvidenceState;
  readonly serial?: string;
  readonly finalRelativePath?: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly errorCategory?: string;
  readonly unavailableReason?: string;
}

export interface ZipManifestInput {
  readonly html: ZipManifestHtmlInput;
  readonly evidence: readonly ZipManifestEvidenceInput[];
}

export interface ZipManifestEntry {
  readonly path: string;
  readonly type: ZipManifestEntryType;
  readonly associationId: string;
  readonly kind?: string;
  readonly serial?: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ZipManifestUnavailable {
  readonly associationId: string;
  readonly kind: string;
  readonly state: Exclude<ZipManifestEvidenceState, "READY">;
  readonly serial?: string;
  readonly errorCategory?: string;
  readonly unavailableReason?: string;
}

export interface ZipManifest {
  readonly schemaVersion: 1;
  readonly entries: readonly ZipManifestEntry[];
  readonly unavailable: readonly ZipManifestUnavailable[];
}

/** Builds the deterministic metadata file that the ZIP verifier will trust. */
export function createZipManifest(input: ZipManifestInput): ZipManifest {
  const entries: ZipManifestEntry[] = [];
  const unavailable: ZipManifestUnavailable[] = [];
  const normalizedPaths = new Map<string, string>();
  const associationIds = new Set<string>(["report-html"]);

  const htmlPath = normalizeEntryPath(input.html.relativePath);
  assertMeasuredMetadata(input.html.sha256, input.html.sizeBytes, "HTML report");
  addPath(normalizedPaths, htmlPath, "HTML report");
  entries.push({
    path: htmlPath,
    type: "HTML_REPORT",
    associationId: "report-html",
    sha256: input.html.sha256,
    sizeBytes: input.html.sizeBytes,
  });

  for (const evidence of input.evidence) {
    requireText(evidence.id, "evidence.id");
    if (associationIds.has(evidence.id)) {
      throw new Error(`Duplicate ZIP associationId: ${evidence.id}`);
    }
    associationIds.add(evidence.id);
    requireText(evidence.kind, `evidence ${evidence.id} kind`);
    if (evidence.serial !== undefined)
      requireText(evidence.serial, `evidence ${evidence.id} serial`);
    if (evidence.state === "READY") {
      if (evidence.finalRelativePath === undefined) {
        throw new TypeError(`READY evidence ${evidence.id} requires finalRelativePath.`);
      }
      if (evidence.sha256 === undefined || evidence.sizeBytes === undefined) {
        throw new TypeError(`READY evidence ${evidence.id} requires sha256 and sizeBytes.`);
      }
      const path = normalizeEntryPath(evidence.finalRelativePath);
      assertMeasuredMetadata(evidence.sha256, evidence.sizeBytes, `evidence ${evidence.id}`);
      addPath(normalizedPaths, path, `evidence ${evidence.id}`);
      entries.push({
        path,
        type: "EVIDENCE",
        associationId: evidence.id,
        kind: evidence.kind,
        ...(evidence.serial === undefined ? {} : { serial: evidence.serial }),
        sha256: evidence.sha256,
        sizeBytes: evidence.sizeBytes,
      });
      continue;
    }

    if (
      evidence.state !== "PENDING" &&
      evidence.state !== "FAILED" &&
      evidence.state !== "MISSING"
    ) {
      throw new TypeError(`Evidence ${evidence.id} state is invalid.`);
    }
    if (evidence.errorCategory !== undefined)
      requireText(evidence.errorCategory, `evidence ${evidence.id} errorCategory`);
    if (evidence.unavailableReason !== undefined)
      requireText(evidence.unavailableReason, `evidence ${evidence.id} unavailableReason`);
    if (evidence.errorCategory === undefined && evidence.unavailableReason === undefined) {
      throw new TypeError(`Unavailable evidence ${evidence.id} requires a reason.`);
    }
    unavailable.push({
      associationId: evidence.id,
      kind: evidence.kind,
      state: evidence.state,
      ...(evidence.serial === undefined ? {} : { serial: evidence.serial }),
      ...(evidence.errorCategory === undefined ? {} : { errorCategory: evidence.errorCategory }),
      ...(evidence.unavailableReason === undefined
        ? {}
        : { unavailableReason: evidence.unavailableReason }),
    });
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));
  unavailable.sort((left, right) => left.associationId.localeCompare(right.associationId));
  return { schemaVersion: 1, entries, unavailable };
}

/** Serializes the manifest with sorted object keys so archive bytes are reproducible. */
export function serializeZipManifest(manifest: ZipManifest): string {
  return stableStringify(manifest);
}

function normalizeEntryPath(value: string): string {
  requireText(value, "relative path");
  if (win32.isAbsolute(value) || posix.isAbsolute(value)) {
    throw new TypeError("ZIP entry relative path must be relative.");
  }
  const forwardSlashValue = value.replaceAll("\\", "/");
  if (forwardSlashValue.split("/").some((segment) => segment === "..")) {
    throw new TypeError("ZIP entry relative path must stay inside the archive.");
  }
  const normalized = posix.normalize(forwardSlashValue);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes(":")
  ) {
    throw new TypeError("ZIP entry relative path must stay inside the archive.");
  }
  return normalized;
}

function addPath(paths: Map<string, string>, path: string, owner: string): void {
  const collisionKey = path.toLocaleLowerCase("en-US");
  const existing = paths.get(collisionKey);
  if (existing !== undefined) {
    throw new Error(`ZIP entry path collision between ${existing} and ${owner}: ${path}`);
  }
  paths.set(collisionKey, owner);
}

function assertMeasuredMetadata(sha256: string, sizeBytes: number, owner: string): void {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError(`${owner} sha256 must be lowercase hex.`);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new TypeError(`${owner} sizeBytes must be a non-negative integer.`);
  }
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} is required.`);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
