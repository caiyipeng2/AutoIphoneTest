import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { win32 } from "node:path";

import { parseDeviceSerial } from "@test-center/contracts/device";
import type { EvidenceManifest, EvidenceManifestEntry } from "./evidence-manifest.js";
import { TextRedactor } from "./text-redactor.js";

export interface LogcatTimeRange {
  readonly startMonotonicMs: number;
  readonly endMonotonicMs: number;
}

export interface LogcatEvidenceRequest {
  readonly rootPath: string;
  readonly manifest: EvidenceManifest;
  readonly evidenceId: string;
  readonly serial: string;
  readonly secrets: readonly string[];
  readonly actionTexts?: readonly string[];
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly range?: LogcatTimeRange;
}

export interface RedactedLogcatEvidence {
  readonly evidenceId: string;
  readonly serial: string;
  readonly sourceRelativePath: string;
  readonly sourceSha256: string;
  readonly sourceByteSize: number;
  readonly content: string;
  readonly outputByteSize: number;
  readonly recordCount: number;
  readonly truncated: boolean;
}

const THREADTIME_PREFIX =
  /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWEF]\s+[^:]+:\s*)(.*)$/;
const TOKEN_PATTERN =
  /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|bearer|cookie|csrf|bootstrap|keystore[_-]?password)\b\s*[:=]\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

export async function redactLogcatEvidence(
  request: LogcatEvidenceRequest,
): Promise<RedactedLogcatEvidence> {
  validateRequest(request);
  parseDeviceSerial(request.serial);
  const entry = request.manifest.entries.find(
    (candidate) => candidate.evidenceId === request.evidenceId,
  );
  if (entry === undefined) throw new Error("Logcat evidence is not registered in the manifest.");
  validateManifestEntry(entry, request);
  validateRange(entry, request.range);

  const sourcePath = resolveInside(request.rootPath, entry.relativePath);
  const source = createReadStream(sourcePath);
  const digest = createHash("sha256");
  let sourceByteSize = 0;
  source.on("data", (chunk: string | Buffer) => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    digest.update(bytes);
    sourceByteSize += bytes.byteLength;
  });

  const lines = createInterface({ input: source, crlfDelay: Infinity });
  const redactor = new TextRedactor({ runSalt: "m10-logcat-source-redaction" });
  const output: string[] = [];
  let outputByteSize = 0;
  let recordCount = 0;
  let truncated = false;
  try {
    for await (const line of lines) {
      if (recordCount >= request.maxLines) {
        truncated = true;
        continue;
      }
      const redacted = redactLine(line, redactor, request.secrets, request.actionTexts ?? []);
      const withNewline = `${redacted}\n`;
      const bytes = Buffer.byteLength(withNewline, "utf8");
      if (outputByteSize + bytes > request.maxBytes) {
        const remaining = request.maxBytes - outputByteSize;
        if (remaining > 0) {
          const clipped = clipUtf8(withNewline, remaining);
          output.push(clipped);
          outputByteSize += Buffer.byteLength(clipped, "utf8");
        }
        truncated = true;
        continue;
      }
      output.push(withNewline);
      outputByteSize += bytes;
      recordCount += 1;
    }
  } finally {
    lines.close();
  }

  const sourceSha256 = digest.digest("hex");
  if (sourceByteSize !== entry.sizeBytes || sourceSha256 !== entry.sha256) {
    throw new Error("Manifest logcat source hash or size changed before redaction.");
  }
  return {
    evidenceId: request.evidenceId,
    serial: request.serial,
    sourceRelativePath: entry.relativePath,
    sourceSha256,
    sourceByteSize,
    content: output.join(""),
    outputByteSize,
    recordCount,
    truncated,
  };
}

function validateRequest(request: LogcatEvidenceRequest): void {
  if (!win32.isAbsolute(request.rootPath)) throw new TypeError("rootPath must be absolute.");
  if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive integer.");
  }
  if (!Number.isSafeInteger(request.maxLines) || request.maxLines < 1) {
    throw new TypeError("maxLines must be a positive integer.");
  }
  if (request.range !== undefined) {
    if (
      !Number.isFinite(request.range.startMonotonicMs) ||
      !Number.isFinite(request.range.endMonotonicMs) ||
      request.range.startMonotonicMs > request.range.endMonotonicMs
    ) {
      throw new TypeError("Logcat range is invalid.");
    }
  }
}

function validateManifestEntry(entry: EvidenceManifestEntry, request: LogcatEvidenceRequest): void {
  if (entry.kind !== "logcat-segment")
    throw new Error("Manifest evidence is not a logcat segment.");
  if (entry.serial !== request.serial)
    throw new Error("Manifest logcat serial does not match request serial.");
  resolveInside(request.rootPath, entry.relativePath);
}

function validateRange(entry: EvidenceManifestEntry, range: LogcatTimeRange | undefined): void {
  if (range === undefined) return;
  const started = metadataNumber(entry, "startedAtMonotonicMs");
  const ended = metadataNumber(entry, "endedAtMonotonicMs");
  if (
    started === undefined ||
    ended === undefined ||
    range.startMonotonicMs < started ||
    range.endMonotonicMs > ended
  ) {
    throw new Error("Requested logcat range is outside the manifest evidence range.");
  }
}

function metadataNumber(entry: EvidenceManifestEntry, key: string): number | undefined {
  const value = entry.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function redactLine(
  line: string,
  redactor: TextRedactor,
  secrets: readonly string[],
  actionTexts: readonly string[],
): string {
  const match = THREADTIME_PREFIX.exec(line);
  if (match === null) return redactSensitive(line, redactor, [...secrets, ...actionTexts]);
  const prefix = match[1];
  const message = match[2];
  if (prefix === undefined || message === undefined) {
    return redactSensitive(line, redactor, [...secrets, ...actionTexts]);
  }
  return `${prefix}${redactSensitive(message, redactor, [...secrets, ...actionTexts])}`;
}

function redactSensitive(
  value: string,
  redactor: TextRedactor,
  secrets: readonly string[],
): string {
  const exact = redactor.redact(value, secrets);
  return exact.replaceAll(TOKEN_PATTERN, "[REDACTED_TEXT]");
}

function clipUtf8(value: string, maxBytes: number): string {
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

function resolveInside(rootPath: string, relativePath: string): string {
  if (relativePath.trim().length === 0 || win32.isAbsolute(relativePath)) {
    throw new TypeError("Manifest relative path must be relative.");
  }
  const root = win32.normalize(rootPath);
  const normalized = win32.normalize(relativePath.replaceAll("/", "\\"));
  const absolute = win32.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(`${root}\\`)) {
    throw new TypeError("Manifest relative path must stay inside the root.");
  }
  return absolute;
}
