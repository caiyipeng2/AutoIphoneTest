import { createHash, randomBytes } from "node:crypto";

import type Database from "better-sqlite3";

export interface CleanupConfirmationTarget {
  readonly runIds: readonly string[];
  readonly expectedBytes: number;
}

export interface CleanupConfirmationOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export class CleanupConfirmationService {
  private readonly now: () => number;
  private readonly ttlMs: number;

  public constructor(
    private readonly database: Database.Database,
    options: CleanupConfirmationOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 60_000;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new TypeError("ttlMs must be positive.");
    }
  }

  public issue(
    target: CleanupConfirmationTarget,
    issuedAt = this.now(),
  ): { nonce: string; expiresAt: string } {
    const normalized = normalizeTarget(target);
    validateTime(issuedAt, "issuedAt");
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(issuedAt + this.ttlMs).toISOString();
    this.database
      .prepare(
        `INSERT INTO cleanup_confirmations
         (nonce_hash, run_ids_json, expected_bytes, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(hash(nonce), normalized.runIdsJson, normalized.expectedBytes, expiresAt);
    return { nonce, expiresAt };
  }

  public consume(
    input: CleanupConfirmationTarget & { readonly nonce: string },
    consumedAt = this.now(),
  ): void {
    const normalized = normalizeTarget(input);
    validateTime(consumedAt, "consumedAt");
    if (typeof input.nonce !== "string" || !input.nonce) {
      throw new TypeError("Confirmation nonce is required.");
    }
    const nonceHash = hash(input.nonce);
    const row = this.database
      .prepare("SELECT * FROM cleanup_confirmations WHERE nonce_hash = ?")
      .get(nonceHash) as CleanupConfirmationRow | undefined;
    if (row === undefined) throw new Error("Cleanup confirmation nonce is invalid.");
    if (row.consumed_at !== null) throw new Error("Cleanup confirmation nonce was already reused.");
    if (Date.parse(row.expires_at) <= consumedAt) {
      throw new Error("Cleanup confirmation nonce is expired.");
    }
    if (
      row.run_ids_json !== normalized.runIdsJson ||
      row.expected_bytes !== normalized.expectedBytes
    ) {
      throw new Error("Cleanup confirmation target does not match.");
    }
    const result = this.database
      .prepare(
        "UPDATE cleanup_confirmations SET consumed_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL",
      )
      .run(new Date(consumedAt).toISOString(), nonceHash);
    if (result.changes !== 1) throw new Error("Cleanup confirmation nonce was already reused.");
  }
}

interface CleanupConfirmationRow {
  readonly run_ids_json: string;
  readonly expected_bytes: number;
  readonly expires_at: string;
  readonly consumed_at: string | null;
}

interface NormalizedTarget {
  readonly runIdsJson: string;
  readonly expectedBytes: number;
}

function normalizeTarget(target: CleanupConfirmationTarget): NormalizedTarget {
  if (!Array.isArray(target.runIds) || target.runIds.length === 0) {
    throw new TypeError("Cleanup confirmation requires at least one run ID.");
  }
  const runIds = [...target.runIds];
  if (runIds.some((runId) => typeof runId !== "string" || !runId.trim())) {
    throw new TypeError("Cleanup confirmation run IDs must be non-empty.");
  }
  if (new Set(runIds).size !== runIds.length) {
    throw new TypeError("Cleanup confirmation run IDs must not contain duplicates.");
  }
  runIds.sort(compareRunIds);
  if (!Number.isSafeInteger(target.expectedBytes) || target.expectedBytes < 0) {
    throw new TypeError("Cleanup confirmation expectedBytes must be non-negative.");
  }
  return { runIdsJson: JSON.stringify(runIds), expectedBytes: target.expectedBytes };
}

function compareRunIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateTime(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
