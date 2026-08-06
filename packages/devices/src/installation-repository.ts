import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { DataMutationKind, MutationStatus } from "@test-center/contracts/deployment";
import type { DeviceSerial } from "@test-center/contracts/device";

export interface InstallationRecord {
  readonly serial: DeviceSerial;
  readonly packageName: string;
  readonly installGeneration: number;
  readonly appDataGeneration: number;
  readonly currentUid: string | null;
  readonly lastMutationId: string | null;
  readonly lastMutationKind: DataMutationKind | null;
  readonly lastMutationStatus: MutationStatus | null;
  readonly lastMutationError: string | null;
  readonly updatedAt: string;
}

interface InstallationRow {
  serial: string;
  package_name: string;
  install_generation: number;
  app_data_generation: number;
  current_uid: string | null;
  last_mutation_id: string | null;
  last_mutation_kind: DataMutationKind | null;
  last_mutation_status: MutationStatus | null;
  last_mutation_error: string | null;
  updated_at: string;
}

export class InstallationRepository {
  public constructor(private readonly database: Database.Database) {}

  public ensure(
    serial: DeviceSerial,
    packageName: string,
    updatedAt = new Date().toISOString(),
  ): void {
    const ensureRows = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO device_app_installations (serial, package_name, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(serial, package_name) DO NOTHING`,
        )
        .run(serial, packageName, updatedAt);
      this.database
        .prepare(
          `INSERT INTO device_uids (serial, package_name, current_uid, updated_at)
           VALUES (?, ?, NULL, ?)
           ON CONFLICT(serial, package_name) DO NOTHING`,
        )
        .run(serial, packageName, updatedAt);
    });
    ensureRows.immediate();
  }

  public get(serial: DeviceSerial, packageName: string): InstallationRecord {
    const row = this.database
      .prepare<[string, string], InstallationRow>(
        `SELECT i.serial, i.package_name, i.install_generation, i.app_data_generation,
                u.current_uid, i.last_mutation_kind, i.last_mutation_status,
                i.last_mutation_id, i.last_mutation_error, i.updated_at
         FROM device_app_installations i
         JOIN device_uids u ON u.serial = i.serial AND u.package_name = i.package_name
         WHERE i.serial = ? AND i.package_name = ?`,
      )
      .get(serial, packageName);
    if (row === undefined) throw new Error(`Unknown installation '${serial}/${packageName}'.`);
    return {
      serial: row.serial as DeviceSerial,
      packageName: row.package_name,
      installGeneration: row.install_generation,
      appDataGeneration: row.app_data_generation,
      currentUid: row.current_uid,
      lastMutationId: row.last_mutation_id,
      lastMutationKind: row.last_mutation_kind,
      lastMutationStatus: row.last_mutation_status,
      lastMutationError: row.last_mutation_error,
      updatedAt: row.updated_at,
    };
  }

  public setCurrentUid(
    serial: DeviceSerial,
    packageName: string,
    uid: string,
    updatedAt = new Date().toISOString(),
  ): void {
    this.ensure(serial, packageName, updatedAt);
    const current = this.get(serial, packageName);
    if (current.lastMutationStatus !== null) {
      throw new Error(
        "UID requires a fresh installation observation after a destructive mutation.",
      );
    }
    this.database
      .prepare(
        "UPDATE device_uids SET current_uid = ?, updated_at = ? WHERE serial = ? AND package_name = ?",
      )
      .run(uid, updatedAt, serial, packageName);
  }

  public recordDataMutation(input: {
    readonly serial: DeviceSerial;
    readonly packageName: string;
    readonly kind: DataMutationKind;
    readonly updatedAt?: string;
  }): InstallationRecord {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const mutationId = randomUUID();
    this.ensure(input.serial, input.packageName, updatedAt);
    const update = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE device_app_installations
           SET install_generation = install_generation + ?,
               app_data_generation = app_data_generation + 1,
               last_mutation_id = ?, last_mutation_kind = ?, last_mutation_status = 'PENDING',
               last_mutation_error = NULL, updated_at = ?
           WHERE serial = ? AND package_name = ?`,
        )
        .run(
          input.kind === "UNINSTALL_REINSTALL" ? 1 : 0,
          mutationId,
          input.kind,
          updatedAt,
          input.serial,
          input.packageName,
        );
      this.database
        .prepare(
          "UPDATE device_uids SET current_uid = NULL, updated_at = ? WHERE serial = ? AND package_name = ?",
        )
        .run(updatedAt, input.serial, input.packageName);
    });
    update.immediate();
    return this.get(input.serial, input.packageName);
  }

  public recordMutationResult(
    serial: DeviceSerial,
    packageName: string,
    mutationId: string,
    status: Exclude<MutationStatus, "PENDING">,
    error?: string,
    updatedAt = new Date().toISOString(),
  ): InstallationRecord {
    const result = this.database
      .prepare(
        `UPDATE device_app_installations
         SET last_mutation_status = ?, last_mutation_error = ?, updated_at = ?
         WHERE serial = ? AND package_name = ? AND last_mutation_id = ? AND last_mutation_status = 'PENDING'`,
      )
      .run(status, error ?? null, updatedAt, serial, packageName, mutationId);
    if (result.changes !== 1) throw new Error("Stale or non-pending mutation result.");
    return this.get(serial, packageName);
  }

  public recordInstallationObservation(
    serial: DeviceSerial,
    packageName: string,
    mutationId: string,
    uid: string,
    updatedAt = new Date().toISOString(),
  ): InstallationRecord {
    this.ensure(serial, packageName, updatedAt);
    const observe = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE device_app_installations
           SET last_mutation_status = NULL, last_mutation_error = NULL, updated_at = ?
           WHERE serial = ? AND package_name = ? AND last_mutation_id = ?`,
        )
        .run(updatedAt, serial, packageName, mutationId);
      if (result.changes !== 1)
        throw new Error("Installation observation does not match the current mutation.");
      this.database
        .prepare(
          "UPDATE device_uids SET current_uid = ?, updated_at = ? WHERE serial = ? AND package_name = ?",
        )
        .run(uid, updatedAt, serial, packageName);
    });
    observe.immediate();
    return this.get(serial, packageName);
  }
}
