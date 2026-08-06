import { createHash, randomBytes } from "node:crypto";

import type Database from "better-sqlite3";
import type { DeviceSerial } from "@test-center/contracts/device";

export type DestructiveOperationKind = "CLEAR_DATA" | "UNINSTALL_REINSTALL";

export interface DestructiveConfirmationTarget {
  readonly sessionId: string;
  readonly operationKind: DestructiveOperationKind;
  readonly artifactId: string;
  readonly deviceSerial: DeviceSerial;
  readonly packageName: string;
  readonly installGeneration: number;
  readonly appDataGeneration: number;
}

export interface DestructiveConfirmationOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export class DestructiveConfirmationService {
  private readonly now: () => number;
  private readonly ttlMs: number;

  public constructor(
    private readonly database: Database.Database,
    options: DestructiveConfirmationOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 60_000;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0)
      throw new TypeError("ttlMs must be positive.");
  }

  public issue(
    target: DestructiveConfirmationTarget,
    issuedAt = this.now(),
  ): { nonce: string; expiresAt: string } {
    validateTarget(target);
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(issuedAt + this.ttlMs).toISOString();
    this.database
      .prepare(
        `INSERT INTO destructive_confirmations
       (nonce_hash, session_id, operation_kind, artifact_id, device_serial, package_name,
        install_generation, app_data_generation, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hash(nonce),
        target.sessionId,
        target.operationKind,
        target.artifactId,
        target.deviceSerial,
        target.packageName,
        target.installGeneration,
        target.appDataGeneration,
        expiresAt,
      );
    return { nonce, expiresAt };
  }

  public consume(
    input: DestructiveConfirmationTarget & { readonly nonce: string },
    consumedAt = this.now(),
  ): void {
    validateTarget(input);
    const nonceHash = hash(input.nonce);
    const row = this.database
      .prepare("SELECT * FROM destructive_confirmations WHERE nonce_hash = ?")
      .get(nonceHash) as ConfirmationRow | undefined;
    if (row === undefined) throw new Error("Confirmation nonce is invalid.");
    if (row.consumed_at !== null) throw new Error("Confirmation nonce was already reused.");
    if (Date.parse(row.expires_at) <= consumedAt) throw new Error("Confirmation nonce is expired.");
    if (!matches(row, input)) throw new Error("Confirmation target does not match.");
    const result = this.database
      .prepare(
        "UPDATE destructive_confirmations SET consumed_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL",
      )
      .run(new Date(consumedAt).toISOString(), nonceHash);
    if (result.changes !== 1) throw new Error("Confirmation nonce was already reused.");
  }
}

interface ConfirmationRow {
  session_id: string;
  operation_kind: DestructiveOperationKind;
  artifact_id: string;
  device_serial: string;
  package_name: string;
  install_generation: number;
  app_data_generation: number;
  expires_at: string;
  consumed_at: string | null;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateTarget(target: DestructiveConfirmationTarget): void {
  if (!target.sessionId || !target.artifactId || !target.packageName)
    throw new TypeError("Confirmation target is incomplete.");
  if (!Number.isSafeInteger(target.installGeneration) || target.installGeneration < 1)
    throw new TypeError("installGeneration must be positive.");
  if (!Number.isSafeInteger(target.appDataGeneration) || target.appDataGeneration < 1)
    throw new TypeError("appDataGeneration must be positive.");
}

function matches(row: ConfirmationRow, target: DestructiveConfirmationTarget): boolean {
  return (
    row.session_id === target.sessionId &&
    row.operation_kind === target.operationKind &&
    row.artifact_id === target.artifactId &&
    row.device_serial === target.deviceSerial &&
    row.package_name === target.packageName &&
    row.install_generation === target.installGeneration &&
    row.app_data_generation === target.appDataGeneration
  );
}
