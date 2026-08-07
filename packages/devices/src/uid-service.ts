import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { DeviceSerial } from "@test-center/contracts/device";
import { InstallationRepository, type InstallationRecord } from "./installation-repository.js";

export type UidSource = "BRIDGE_AUTO" | "MANUAL" | "UNKNOWN";
export type BridgeHealthStatus = "READY" | "DEGRADED" | "UNAVAILABLE";

export interface BridgeStateObservation {
  readonly serial: DeviceSerial;
  readonly packageName: string;
  readonly bridgeInstanceId: string;
  readonly bootId: string;
  readonly buildId: string;
  readonly uid: string | null;
  readonly installGeneration: number;
  readonly appDataGeneration: number;
  readonly stateSeq: number;
  readonly observedAt?: string;
}

export interface UidObservation {
  readonly uid: string;
  readonly source: UidSource;
  readonly actor: string;
  readonly buildId: string;
  readonly installGeneration: number;
  readonly appDataGeneration: number;
  readonly observedAt: string;
}

export interface BridgeHealth {
  readonly status: BridgeHealthStatus;
  readonly bridgeInstanceId?: string;
  readonly bootId?: string;
  readonly buildId?: string;
  readonly stateSeq?: number;
  readonly lastStateAt?: string;
  readonly reason?: string;
}

export interface UidSnapshot {
  readonly installation: InstallationRecord;
  readonly uid: UidObservation | null;
  readonly bridge: BridgeHealth;
}

export interface UidServiceOptions {
  readonly now?: () => string;
  readonly confirmationTtlMs?: number;
}

export interface ManualUidConfirmation {
  readonly nonce: string;
  readonly expiresAt: string;
}

interface StoredConfirmation {
  readonly sessionId: string;
  readonly serial: DeviceSerial;
  readonly packageName: string;
  readonly expiresAtMs: number;
}

interface UidObservationRow {
  uid: string;
  source: "BRIDGE_AUTO" | "MANUAL";
  actor: string;
  build_id: string;
  install_generation: number;
  app_data_generation: number;
  observed_at: string;
}

interface BridgeHealthState extends BridgeHealth {
  readonly serial: DeviceSerial;
  readonly packageName: string;
}

const DEFAULT_CONFIRMATION_TTL_MS = 60_000;

export class UidService {
  private readonly now: () => string;
  private readonly confirmationTtlMs: number;
  private readonly health = new Map<string, BridgeHealthState>();
  private readonly confirmations = new Map<string, StoredConfirmation>();

  public constructor(
    private readonly database: Database.Database,
    private readonly installations: InstallationRepository = new InstallationRepository(database),
    options: UidServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.confirmationTtlMs = options.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    if (!Number.isFinite(this.confirmationTtlMs) || this.confirmationTtlMs <= 0) {
      throw new TypeError("confirmationTtlMs must be greater than zero.");
    }
  }

  public ensure(serial: DeviceSerial, packageName: string): InstallationRecord {
    validatePackageName(packageName);
    this.installations.ensure(serial, packageName, this.now());
    return this.installations.get(serial, packageName);
  }

  public get(serial: DeviceSerial, packageName: string): UidSnapshot {
    validatePackageName(packageName);
    const installation = this.installations.get(serial, packageName);
    const uid = this.selectCurrentUid(serial, packageName, installation);
    const bridge =
      this.health.get(keyFor(serial, packageName)) ??
      ({
        status: "UNAVAILABLE",
        reason: "The Unity QA bridge has not reported state.",
      } satisfies BridgeHealth);
    return { installation, uid, bridge };
  }

  public observeBridgeState(input: BridgeStateObservation): UidSnapshot {
    validatePackageName(input.packageName);
    validatePositiveSafeInteger(input.installGeneration, "installGeneration");
    validatePositiveSafeInteger(input.appDataGeneration, "appDataGeneration");
    validatePositiveSafeInteger(input.stateSeq, "stateSeq");
    if (!input.bridgeInstanceId || !input.bootId || !input.buildId) {
      throw new TypeError("bridgeInstanceId, bootId, and buildId are required.");
    }

    const key = keyFor(input.serial, input.packageName);
    const previous = this.health.get(key);
    if (
      previous !== undefined &&
      previous.bridgeInstanceId === input.bridgeInstanceId &&
      previous.bootId === input.bootId &&
      previous.stateSeq !== undefined &&
      input.stateSeq <= previous.stateSeq
    ) {
      throw new Error("Stale bridge state sequence.");
    }

    const installation = this.ensure(input.serial, input.packageName);
    const generationMatches =
      installation.installGeneration === input.installGeneration &&
      installation.appDataGeneration === input.appDataGeneration;
    const observedAt = input.observedAt ?? this.now();
    if (generationMatches && input.uid !== null) {
      const updated = this.installations.recordCurrentUidObservation({
        serial: input.serial,
        packageName: input.packageName,
        uid: validateUid(input.uid),
        installGeneration: input.installGeneration,
        appDataGeneration: input.appDataGeneration,
        updatedAt: observedAt,
      });
      this.insertObservation({
        serial: input.serial,
        packageName: input.packageName,
        uid: updated.currentUid!,
        installGeneration: input.installGeneration,
        appDataGeneration: input.appDataGeneration,
        source: "BRIDGE_AUTO",
        actor: `bridge:${input.bridgeInstanceId}`,
        buildId: input.buildId,
        observedAt,
      });
    }

    const reason = generationMatches
      ? input.uid === null
        ? "Bridge state does not contain a UID."
        : undefined
      : "Bridge state generation does not match the current installation.";
    this.health.set(key, {
      serial: input.serial,
      packageName: input.packageName,
      status: generationMatches && input.uid !== null ? "READY" : "DEGRADED",
      bridgeInstanceId: input.bridgeInstanceId,
      bootId: input.bootId,
      buildId: input.buildId,
      stateSeq: input.stateSeq,
      lastStateAt: observedAt,
      ...(reason === undefined ? {} : { reason }),
    });
    return this.get(input.serial, input.packageName);
  }

  public markBridgeUnavailable(
    serial: DeviceSerial,
    packageName: string,
    reason = "The Unity QA bridge is disconnected.",
  ): BridgeHealth {
    validatePackageName(packageName);
    const previous = this.health.get(keyFor(serial, packageName));
    const next: BridgeHealthState = {
      serial,
      packageName,
      status: "UNAVAILABLE",
      ...(previous?.bridgeInstanceId === undefined
        ? {}
        : { bridgeInstanceId: previous.bridgeInstanceId }),
      ...(previous?.bootId === undefined ? {} : { bootId: previous.bootId }),
      ...(previous?.buildId === undefined ? {} : { buildId: previous.buildId }),
      ...(previous?.stateSeq === undefined ? {} : { stateSeq: previous.stateSeq }),
      ...(previous?.lastStateAt === undefined ? {} : { lastStateAt: previous.lastStateAt }),
      reason,
    };
    this.health.set(keyFor(serial, packageName), next);
    return next;
  }

  public issueManualUidConfirmation(input: {
    readonly sessionId: string;
    readonly serial: DeviceSerial;
    readonly packageName: string;
  }): ManualUidConfirmation {
    validatePackageName(input.packageName);
    this.ensure(input.serial, input.packageName);
    const nonce = randomUUID();
    const expiresAtMs = Date.now() + this.confirmationTtlMs;
    this.confirmations.set(hashNonce(nonce), {
      sessionId: input.sessionId,
      serial: input.serial,
      packageName: input.packageName,
      expiresAtMs,
    });
    return { nonce, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  public setManualUid(input: {
    readonly sessionId: string;
    readonly serial: DeviceSerial;
    readonly packageName: string;
    readonly uid: string;
    readonly confirmationNonce: string;
  }): UidSnapshot {
    validatePackageName(input.packageName);
    const confirmation = this.confirmations.get(hashNonce(input.confirmationNonce));
    if (
      confirmation === undefined ||
      confirmation.sessionId !== input.sessionId ||
      confirmation.serial !== input.serial ||
      confirmation.packageName !== input.packageName ||
      confirmation.expiresAtMs <= Date.now()
    ) {
      throw new Error("Manual UID confirmation is invalid or expired.");
    }
    this.confirmations.delete(hashNonce(input.confirmationNonce));
    const installation = this.ensure(input.serial, input.packageName);
    const observedAt = this.now();
    const updated = this.installations.recordCurrentUidObservation({
      serial: input.serial,
      packageName: input.packageName,
      uid: validateUid(input.uid),
      installGeneration: installation.installGeneration,
      appDataGeneration: installation.appDataGeneration,
      updatedAt: observedAt,
    });
    this.insertObservation({
      serial: input.serial,
      packageName: input.packageName,
      uid: updated.currentUid!,
      installGeneration: updated.installGeneration,
      appDataGeneration: updated.appDataGeneration,
      source: "MANUAL",
      actor: `session:${input.sessionId}`,
      buildId: this.health.get(keyFor(input.serial, input.packageName))?.buildId ?? "manual",
      observedAt,
    });
    return this.get(input.serial, input.packageName);
  }

  private selectCurrentUid(
    serial: DeviceSerial,
    packageName: string,
    installation: InstallationRecord,
  ): UidObservation | null {
    if (installation.currentUid === null) return null;
    const row = this.database
      .prepare<[string, string, number, number], UidObservationRow>(
        `SELECT uid, source, actor, build_id, install_generation, app_data_generation, observed_at
         FROM device_uid_observations
         WHERE serial = ? AND package_name = ? AND install_generation = ? AND app_data_generation = ?
         ORDER BY observed_at DESC LIMIT 1`,
      )
      .get(serial, packageName, installation.installGeneration, installation.appDataGeneration);
    if (row === undefined) {
      return {
        uid: installation.currentUid,
        source: "UNKNOWN",
        actor: "legacy",
        buildId: "unknown",
        installGeneration: installation.installGeneration,
        appDataGeneration: installation.appDataGeneration,
        observedAt: installation.updatedAt,
      };
    }
    return {
      uid: row.uid,
      source: row.source,
      actor: row.actor,
      buildId: row.build_id,
      installGeneration: row.install_generation,
      appDataGeneration: row.app_data_generation,
      observedAt: row.observed_at,
    };
  }

  private insertObservation(input: {
    readonly serial: DeviceSerial;
    readonly packageName: string;
    readonly uid: string;
    readonly source: "BRIDGE_AUTO" | "MANUAL";
    readonly actor: string;
    readonly buildId: string;
    readonly installGeneration: number;
    readonly appDataGeneration: number;
    readonly observedAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO device_uid_observations
         (serial, package_name, install_generation, app_data_generation, uid, source, actor, build_id, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.serial,
        input.packageName,
        input.installGeneration,
        input.appDataGeneration,
        input.uid,
        input.source,
        input.actor,
        input.buildId,
        input.observedAt,
      );
  }
}

function keyFor(serial: DeviceSerial, packageName: string): string {
  return `${serial}/${packageName}`;
}

function validatePackageName(value: string): void {
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(value) || value.length > 256) {
    throw new TypeError("packageName must be a valid Android package name.");
  }
}

function validateUid(value: string): string {
  const uid = value.trim();
  if (uid.length === 0 || uid.length > 256)
    throw new TypeError("UID must be non-empty and at most 256 characters.");
  return uid;
}

function validatePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer.`);
}

function hashNonce(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
