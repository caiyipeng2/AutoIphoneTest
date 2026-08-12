import type Database from "better-sqlite3";

import type { DeviceSerial } from "@test-center/contracts/device";

import type { DeploymentMachineSnapshot, DeploymentPersistence } from "./deployment-machine.js";

export interface PersistedDeployment {
  readonly id: string;
  readonly serial: DeviceSerial;
  readonly packageName: string;
  readonly state: DeploymentMachineSnapshot["state"];
  readonly currentStep: DeploymentMachineSnapshot["currentStep"] | null;
  readonly failedStep: DeploymentMachineSnapshot["failedStep"] | null;
  readonly failureMessage: string | null;
  readonly updatedAt: string;
}

interface DeploymentRow {
  id: string;
  serial: string;
  package_name: string;
  state: PersistedDeployment["state"];
  current_step: PersistedDeployment["currentStep"] | null;
  failed_step: PersistedDeployment["failedStep"] | null;
  failure_message: string | null;
  updated_at: string;
}

export class DeploymentRepository implements DeploymentPersistence {
  public constructor(
    private readonly database: Database.Database,
    private readonly deploymentId: string,
    private readonly serial: DeviceSerial,
  ) {}

  public create(input: {
    readonly packageName: string;
    readonly artifactId?: string;
    readonly createdAt?: string;
  }): void {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO deployments (id, artifact_id, package_name, state, created_at, updated_at)
           VALUES (?, ?, ?, 'QUEUED', ?, ?)`,
        )
        .run(this.deploymentId, input.artifactId ?? null, input.packageName, createdAt, createdAt);
      this.database
        .prepare(
          `INSERT INTO deployment_devices (deployment_id, serial, state, created_at, updated_at)
           VALUES (?, ?, 'QUEUED', ?, ?)`,
        )
        .run(this.deploymentId, this.serial, createdAt, createdAt);
    });
    create.immediate();
  }

  public persist(snapshot: DeploymentMachineSnapshot, updatedAt: string): void {
    const persist = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE deployments
           SET state = ?, current_step = ?, failed_step = ?, failure_message = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          snapshot.state,
          snapshot.currentStep ?? null,
          snapshot.failedStep ?? null,
          snapshot.failureMessage ?? null,
          updatedAt,
          this.deploymentId,
        );
      if (result.changes !== 1) throw new Error(`Unknown deployment '${this.deploymentId}'.`);
      this.database
        .prepare(
          `UPDATE deployment_devices SET state = ?, updated_at = ?
           WHERE deployment_id = ? AND serial = ?`,
        )
        .run(snapshot.state, updatedAt, this.deploymentId, this.serial);
      if (snapshot.currentStep !== undefined) {
        this.database
          .prepare(
            `UPDATE deployment_steps SET state = 'SUCCEEDED', ended_at = ?
             WHERE deployment_id = ? AND serial = ? AND state = 'RUNNING' AND step_kind <> ?`,
          )
          .run(updatedAt, this.deploymentId, this.serial, snapshot.currentStep);
      }
      const step = snapshot.currentStep;
      if (step !== undefined) {
        this.database
          .prepare(
            `INSERT OR IGNORE INTO deployment_steps
             (deployment_id, serial, step_kind, attempt_number, state, started_at)
             VALUES (?, ?, ?, ?, 'RUNNING', ?)`,
          )
          .run(this.deploymentId, this.serial, step, snapshot.attempt, updatedAt);
      }
      if (snapshot.state === "FAILED" && snapshot.failedStep !== undefined) {
        this.database
          .prepare(
            `UPDATE deployment_steps
             SET state = 'FAILED', ended_at = ?, error_category = ?
             WHERE deployment_id = ? AND serial = ? AND step_kind = ? AND attempt_number = ? AND state = 'RUNNING'`,
          )
          .run(
            updatedAt,
            snapshot.failureMessage ?? "deployment_failed",
            this.deploymentId,
            this.serial,
            snapshot.failedStep,
            snapshot.attempt,
          );
      }
      if (snapshot.state === "COMPLETED") {
        this.database
          .prepare(
            `UPDATE deployment_steps SET state = 'SUCCEEDED', ended_at = ?
             WHERE deployment_id = ? AND serial = ? AND state = 'RUNNING'`,
          )
          .run(updatedAt, this.deploymentId, this.serial);
      }
      if (snapshot.state === "CANCELLED") {
        this.database
          .prepare(
            `UPDATE deployment_steps SET state = 'CANCELLED', ended_at = ?
             WHERE deployment_id = ? AND serial = ? AND state = 'RUNNING'`,
          )
          .run(updatedAt, this.deploymentId, this.serial);
      }
    });
    persist.immediate();
  }

  public get(): PersistedDeployment {
    const row = this.database
      .prepare<[string, string], DeploymentRow>(
        `SELECT d.id, dd.serial, d.package_name, dd.state,
                (SELECT step_kind FROM deployment_steps ds WHERE ds.deployment_id = d.id AND ds.serial = dd.serial AND ds.state = 'RUNNING' ORDER BY ds.id DESC LIMIT 1) AS current_step,
                (SELECT step_kind FROM deployment_steps ds WHERE ds.deployment_id = d.id AND ds.serial = dd.serial AND ds.state = 'FAILED' ORDER BY ds.id DESC LIMIT 1) AS failed_step,
                (SELECT error_category FROM deployment_steps ds WHERE ds.deployment_id = d.id AND ds.serial = dd.serial AND ds.state = 'FAILED' ORDER BY ds.id DESC LIMIT 1) AS failure_message,
                dd.updated_at
         FROM deployments d
         JOIN deployment_devices dd ON dd.deployment_id = d.id
         WHERE d.id = ? AND dd.serial = ?`,
      )
      .get(this.deploymentId, this.serial);
    if (row === undefined) throw new Error(`Unknown deployment '${this.deploymentId}'.`);
    return {
      id: row.id,
      serial: row.serial as DeviceSerial,
      packageName: row.package_name,
      state: row.state,
      currentStep: row.current_step,
      failedStep: row.failed_step,
      failureMessage: row.failure_message,
      updatedAt: row.updated_at,
    };
  }

  public getSnapshot(): DeploymentMachineSnapshot {
    const deployment = this.get();
    const currentStep = deployment.currentStep;
    const failedStep = deployment.failedStep;
    const failureMessage = deployment.failureMessage;
    return {
      state: deployment.state,
      ...(currentStep == null ? {} : { currentStep }),
      ...(failedStep == null ? {} : { failedStep }),
      ...(failureMessage == null ? {} : { failureMessage }),
      attempt: 1,
      attempts: [],
    };
  }
}
