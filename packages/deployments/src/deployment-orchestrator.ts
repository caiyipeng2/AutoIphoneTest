import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import type { DeviceSerial } from "@test-center/contracts/device";
import type { DataMutationKind } from "@test-center/contracts/deployment";
import type { InstalledIdentity } from "@test-center/artifacts/installed-identity";
import {
  DestructiveConfirmationService,
  type DestructiveOperationKind,
} from "@test-center/security";

import { DeploymentMachine, type DeploymentMachineSnapshot } from "./deployment-machine.js";
import { DeploymentRepository } from "./deployment-repository.js";

export interface DeploymentArtifact {
  readonly id: string;
  readonly kind: "APK" | "AAB";
  readonly packageName: string;
  readonly versionName: string;
  readonly versionCode: number;
  readonly signerSha256: string;
  readonly storedPath: string;
  readonly launchActivity?: string;
}

export interface DeploymentActions {
  installApk(input: {
    readonly serial: DeviceSerial;
    readonly artifact: DeploymentArtifact;
  }): Promise<void>;
  installAab(input: {
    readonly serial: DeviceSerial;
    readonly artifact: DeploymentArtifact;
  }): Promise<void>;
  clearData(input: { readonly serial: DeviceSerial; readonly packageName: string }): Promise<void>;
  uninstallReinstall(input: {
    readonly serial: DeviceSerial;
    readonly packageName: string;
  }): Promise<void>;
  collectIdentity(input: {
    readonly serial: DeviceSerial;
    readonly packageName: string;
  }): Promise<
    Pick<
      InstalledIdentity,
      "packageName" | "versionName" | "versionCode" | "signerSha256" | "launchActivity"
    >
  >;
  startActivity(input: {
    readonly serial: DeviceSerial;
    readonly packageName: string;
    readonly activityName: string;
  }): Promise<void>;
  foregroundActivity(input: { readonly serial: DeviceSerial }): Promise<string | undefined>;
  packagePid(input: {
    readonly serial: DeviceSerial;
    readonly packageName: string;
  }): Promise<number | null>;
}

export interface DeploymentOrchestratorOptions {
  artifact(id: string): DeploymentArtifact | undefined;
  deviceState(serial: DeviceSerial): "ONLINE" | "UNAUTHORIZED" | "OFFLINE" | "UNKNOWN";
  readonly actions: DeploymentActions;
  readonly confirmations?: DestructiveConfirmationService;
  readonly installation?: InstallationMutationStore;
  readonly now?: () => string;
}

export interface InstallationMutationStore {
  recordDataMutation(input: {
    readonly serial: DeviceSerial;
    readonly packageName: string;
    readonly kind: DataMutationKind;
  }): { readonly lastMutationId: string | null };
  recordMutationResult(
    serial: DeviceSerial,
    packageName: string,
    mutationId: string,
    status: "SUCCEEDED" | "FAILED",
    error?: string,
  ): void;
}

export interface DeploymentCreateInput {
  readonly clientRequestId: string;
  readonly artifactId: string;
  readonly deviceSerial?: DeviceSerial;
  readonly deviceSerials?: readonly DeviceSerial[];
  readonly mutation?: "NONE" | DestructiveOperationKind;
  readonly confirmationNonce?: string;
  readonly sessionId?: string;
  readonly installGeneration?: number;
  readonly appDataGeneration?: number;
}

export interface DeploymentView {
  readonly id: string;
  readonly clientRequestId: string;
  readonly artifactId: string;
  readonly deviceSerial: DeviceSerial;
  readonly deviceSerials: readonly DeviceSerial[];
  readonly devices: readonly DeploymentDeviceView[];
  readonly packageName: string;
  readonly mutation: "NONE" | DestructiveOperationKind;
  readonly state: DeploymentMachineSnapshot["state"];
  readonly currentStep: DeploymentMachineSnapshot["currentStep"] | null;
  readonly failedStep: DeploymentMachineSnapshot["failedStep"] | null;
  readonly failureMessage: string | null;
}

export interface DeploymentDeviceView {
  readonly serial: DeviceSerial;
  readonly role: "LEADER" | "FOLLOWER";
  readonly state: DeploymentMachineSnapshot["state"];
  readonly currentStep: DeploymentMachineSnapshot["currentStep"] | null;
  readonly failedStep: DeploymentMachineSnapshot["failedStep"] | null;
  readonly failureMessage: string | null;
}

export class DeploymentOrchestrator {
  private readonly now: () => string;
  private readonly listeners = new Set<(deployment: DeploymentView) => void>();

  public constructor(
    private readonly database: Database.Database,
    private readonly options: DeploymentOrchestratorOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async create(input: DeploymentCreateInput): Promise<DeploymentView> {
    if (!input.clientRequestId.trim()) throw new TypeError("clientRequestId is required.");
    const artifact = this.options.artifact(input.artifactId);
    if (artifact === undefined) throw new Error("Artifact not found.");
    if (!/^[a-f0-9]{64}$/.test(artifact.signerSha256))
      throw new Error("Artifact signer identity is invalid.");
    const serials = normalizeDeviceSerials(input);
    const mutation = input.mutation ?? "NONE";
    const existing = this.findByRequest(input.clientRequestId);
    if (existing !== undefined) {
      if (
        existing.artifact_id !== input.artifactId ||
        !sameSerials(existing.serials, serials) ||
        existing.mutation_kind !== mutation
      )
        throw new Error("Idempotency key was reused with a different deployment.");
      return this.get(existing.id);
    }
    for (const serial of serials) {
      if (this.options.deviceState(serial) !== "ONLINE") throw new Error("Device must be online.");
      if (this.isOccupied(serial)) throw new Error("Device has an active deployment.");
    }
    const id = randomUUID();
    const createdAt = this.now();
    const insert = this.database.transaction(() => {
      if (mutation !== "NONE") {
        if (
          this.options.confirmations === undefined ||
          input.confirmationNonce === undefined ||
          input.sessionId === undefined
        )
          throw new Error("Destructive confirmation is required.");
        this.options.confirmations.consume({
          sessionId: input.sessionId,
          operationKind: mutation,
          artifactId: input.artifactId,
          deviceSerial: serials[0]!,
          packageName: artifact.packageName,
          installGeneration: input.installGeneration ?? 1,
          appDataGeneration: input.appDataGeneration ?? 1,
          nonce: input.confirmationNonce,
        });
      }
      this.database
        .prepare(
          "INSERT INTO deployments (id, artifact_id, package_name, client_request_id, mutation_kind, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?)",
        )
        .run(
          id,
          input.artifactId,
          artifact.packageName,
          input.clientRequestId,
          mutation,
          createdAt,
          createdAt,
        );
      const insertTarget = this.database.prepare(
        "INSERT INTO deployment_devices (deployment_id, serial, state, created_at, updated_at) VALUES (?, ?, 'QUEUED', ?, ?)",
      );
      for (const serial of serials) insertTarget.run(id, serial, createdAt, createdAt);
    });
    insert.immediate();
    return this.publish(id);
  }

  public list(): DeploymentView[] {
    return this.database
      .prepare("SELECT d.id FROM deployments d ORDER BY d.created_at DESC")
      .all()
      .map((row) => this.get(String((row as { id: string }).id)));
  }

  public get(id: string): DeploymentView {
    const row = this.database
      .prepare(
        "SELECT id, client_request_id, artifact_id, package_name, mutation_kind FROM deployments WHERE id = ?",
      )
      .get(id) as DeploymentAggregateRow | undefined;
    if (row === undefined) throw new Error(`Deployment '${id}' not found.`);
    const targets = this.database
      .prepare(
        `SELECT dd.serial, dd.state,
          (SELECT step_kind FROM deployment_steps ds WHERE ds.deployment_id = dd.deployment_id AND ds.serial = dd.serial AND ds.state = 'RUNNING' ORDER BY ds.id DESC LIMIT 1) AS current_step,
          (SELECT step_kind FROM deployment_steps ds WHERE ds.deployment_id = dd.deployment_id AND ds.serial = dd.serial AND ds.state = 'FAILED' ORDER BY ds.id DESC LIMIT 1) AS failed_step,
          (SELECT error_category FROM deployment_steps ds WHERE ds.deployment_id = dd.deployment_id AND ds.serial = dd.serial AND ds.state = 'FAILED' ORDER BY ds.id DESC LIMIT 1) AS failure_message
          FROM deployment_devices dd WHERE dd.deployment_id = ? ORDER BY dd.rowid`,
      )
      .all(id) as DeploymentTargetRow[];
    if (targets.length === 0) throw new Error(`Deployment '${id}' has no targets.`);
    const state = aggregateState(targets.map((target) => target.state));
    return {
      id: row.id,
      clientRequestId: row.client_request_id,
      artifactId: row.artifact_id,
      deviceSerial: targets[0]!.serial as DeviceSerial,
      deviceSerials: targets.map((target) => target.serial as DeviceSerial),
      packageName: row.package_name,
      mutation: row.mutation_kind,
      state,
      currentStep: targets.every((target) => target.current_step === targets[0]!.current_step)
        ? targets[0]!.current_step
        : null,
      failedStep: targets.find((target) => target.failed_step !== null)?.failed_step ?? null,
      failureMessage:
        targets.find((target) => target.failure_message !== null)?.failure_message ?? null,
      devices: targets.map((target, index) => ({
        serial: target.serial as DeviceSerial,
        role: index === 0 ? "LEADER" : "FOLLOWER",
        state: target.state,
        currentStep: target.current_step,
        failedStep: target.failed_step,
        failureMessage: target.failure_message,
      })),
    };
  }

  public async run(id: string): Promise<DeploymentView> {
    const view = this.get(id);
    const artifact = this.options.artifact(view.artifactId);
    if (artifact === undefined) throw new Error("Artifact not found.");
    await Promise.all(
      view.deviceSerials.map((serial) => this.runTarget(id, view, artifact, serial)),
    );
    return this.get(id);
  }

  private async runTarget(
    id: string,
    view: DeploymentView,
    artifact: DeploymentArtifact,
    serial: DeviceSerial,
  ): Promise<void> {
    const repository = new DeploymentRepository(this.database, id, serial);
    const machine = new DeploymentMachine({
      persistence: repository,
      initialSnapshot: repository.getSnapshot(),
      now: this.now,
    });
    let snapshot = machine.snapshot;
    let verifiedIdentity:
      | Pick<
          InstalledIdentity,
          "packageName" | "versionName" | "versionCode" | "signerSha256" | "launchActivity"
        >
      | undefined;
    try {
      while (!["COMPLETED", "FAILED", "CANCELLED"].includes(snapshot.state)) {
        if (snapshot.state === "QUEUED") {
          snapshot = machine.dispatch({ type: "START_OR_ADVANCE" });
        } else if (snapshot.state === "PRECHECK") {
          if (this.options.deviceState(serial) !== "ONLINE")
            throw new Error("Device went offline during precheck.");
          snapshot = machine.dispatch({ type: "START_OR_ADVANCE" });
        } else if (snapshot.state === "PREPARE") {
          let mutationId: string | undefined;
          if (view.mutation !== "NONE" && this.options.installation !== undefined) {
            mutationId =
              this.options.installation.recordDataMutation({
                serial,
                packageName: artifact.packageName,
                kind: view.mutation,
              }).lastMutationId ?? undefined;
          }
          try {
            if (view.mutation === "CLEAR_DATA")
              await this.options.actions.clearData({ serial, packageName: artifact.packageName });
            if (view.mutation === "UNINSTALL_REINSTALL")
              await this.options.actions.uninstallReinstall({
                serial,
                packageName: artifact.packageName,
              });
            if (mutationId !== undefined)
              this.options.installation?.recordMutationResult(
                serial,
                artifact.packageName,
                mutationId,
                "SUCCEEDED",
              );
          } catch (error) {
            if (mutationId !== undefined)
              this.options.installation?.recordMutationResult(
                serial,
                artifact.packageName,
                mutationId,
                "FAILED",
                error instanceof Error ? error.message : "mutation_failed",
              );
            throw error;
          }
          snapshot = machine.dispatch({ type: "START_OR_ADVANCE" });
        } else if (snapshot.state === "INSTALL") {
          if (artifact.kind === "APK") await this.options.actions.installApk({ serial, artifact });
          else await this.options.actions.installAab({ serial, artifact });
          snapshot = machine.dispatch({ type: "START_OR_ADVANCE" });
        } else if (snapshot.state === "VERIFY") {
          const identity = await this.options.actions.collectIdentity({
            serial,
            packageName: artifact.packageName,
          });
          if (
            identity.packageName !== artifact.packageName ||
            identity.versionName !== artifact.versionName ||
            identity.versionCode !== artifact.versionCode ||
            identity.signerSha256 !== artifact.signerSha256
          )
            throw new Error("Installed identity does not match the artifact.");
          if (identity.launchActivity === undefined && artifact.launchActivity === undefined)
            throw new Error("Installed launch activity is unavailable.");
          verifiedIdentity = identity;
          snapshot = machine.dispatch({ type: "START_OR_ADVANCE" });
        } else if (snapshot.state === "LAUNCH") {
          const activity = verifiedIdentity?.launchActivity ?? artifact.launchActivity;
          if (activity === undefined) throw new Error("Launch activity is unavailable.");
          const activityName = activity.includes("/")
            ? (() => {
                const [packageName, className] = activity.split("/", 2);
                return className?.startsWith(".")
                  ? `${packageName}${className}`
                  : (className ?? activity);
              })()
            : activity;
          await this.options.actions.startActivity({
            serial,
            packageName: artifact.packageName,
            activityName,
          });
          const foreground = await this.options.actions.foregroundActivity({ serial });
          const pid = await this.options.actions.packagePid({
            serial,
            packageName: artifact.packageName,
          });
          if (
            foreground === undefined ||
            !foreground.includes(artifact.packageName) ||
            pid === null
          )
            throw new Error("Foreground verification failed.");
          snapshot = machine.dispatch({ type: "START_OR_ADVANCE" });
        }
        this.publish(id);
      }
    } catch (error) {
      if (machine.snapshot.state !== "FAILED") {
        machine.dispatch({
          type: "FAIL",
          step: machine.snapshot.currentStep!,
          message: error instanceof Error ? error.message : "Deployment failed.",
        });
        this.publish(id);
      }
    }
  }

  public async retry(id: string): Promise<DeploymentView> {
    const view = this.get(id);
    for (const target of view.devices.filter((device) => device.state === "FAILED")) {
      const repository = new DeploymentRepository(this.database, id, target.serial);
      const machine = new DeploymentMachine({
        persistence: repository,
        initialSnapshot: repository.getSnapshot(),
        now: this.now,
      });
      machine.dispatch({ type: "RETRY" });
    }
    this.publish(id);
    return await this.run(id);
  }

  public async cancel(id: string): Promise<DeploymentView> {
    const view = this.get(id);
    for (const target of view.devices.filter(
      (device) => !["COMPLETED", "FAILED", "CANCELLED"].includes(device.state),
    )) {
      const repository = new DeploymentRepository(this.database, id, target.serial);
      const machine = new DeploymentMachine({
        persistence: repository,
        initialSnapshot: repository.getSnapshot(),
        now: this.now,
      });
      machine.dispatch({ type: "CANCEL" });
    }
    return this.publish(id);
  }

  public subscribe(listener: (deployment: DeploymentView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public recoverInterrupted(): readonly DeploymentView[] {
    const rows = this.database
      .prepare(
        "SELECT DISTINCT d.id, d.state AS aggregate_state, d.current_step AS aggregate_step FROM deployments d JOIN deployment_devices dd ON dd.deployment_id = d.id WHERE (d.state IN ('PRECHECK', 'PREPARE', 'INSTALL', 'VERIFY', 'LAUNCH') OR dd.state IN ('PRECHECK', 'PREPARE', 'INSTALL', 'VERIFY', 'LAUNCH'))",
      )
      .all() as Array<{
      id: string;
      aggregate_state: DeploymentView["state"];
      aggregate_step: DeploymentView["currentStep"];
    }>;
    const recovered: DeploymentView[] = [];
    for (const row of rows) {
      const view = this.get(row.id);
      for (const target of view.devices) {
        if (target.currentStep === null && row.aggregate_step !== null) {
          this.database
            .prepare(
              "UPDATE deployment_devices SET state = ? WHERE deployment_id = ? AND serial = ?",
            )
            .run(row.aggregate_state, row.id, target.serial);
          this.database
            .prepare(
              "INSERT OR IGNORE INTO deployment_steps (deployment_id, serial, step_kind, attempt_number, state, started_at) VALUES (?, ?, ?, 1, 'RUNNING', ?)",
            )
            .run(row.id, target.serial, row.aggregate_step, this.now());
          const legacyRepository = new DeploymentRepository(this.database, row.id, target.serial);
          const legacyMachine = new DeploymentMachine({
            persistence: legacyRepository,
            initialSnapshot: legacyRepository.getSnapshot(),
            now: this.now,
          });
          legacyMachine.dispatch({
            type: "FAIL",
            step: row.aggregate_step!,
            message: "Deployment interrupted by server restart.",
          });
          continue;
        }
        if (!["PRECHECK", "PREPARE", "INSTALL", "VERIFY", "LAUNCH"].includes(target.state))
          continue;
        const repository = new DeploymentRepository(this.database, row.id, target.serial);
        const machine = new DeploymentMachine({
          persistence: repository,
          initialSnapshot: repository.getSnapshot(),
          now: this.now,
        });
        if (machine.snapshot.currentStep !== undefined) {
          machine.dispatch({
            type: "FAIL",
            step: machine.snapshot.currentStep,
            message: "Deployment interrupted by server restart.",
          });
        }
      }
      recovered.push(this.publish(row.id));
    }
    return recovered;
  }

  private isOccupied(serial: DeviceSerial): boolean {
    const row = this.database
      .prepare(
        "SELECT 1 FROM deployment_devices dd JOIN deployments d ON d.id = dd.deployment_id WHERE dd.serial = ? AND d.state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') LIMIT 1",
      )
      .get(serial);
    return row !== undefined;
  }

  private findByRequest(clientRequestId: string): ExistingDeployment | undefined {
    const row = this.database
      .prepare("SELECT id, artifact_id, mutation_kind FROM deployments WHERE client_request_id = ?")
      .get(clientRequestId) as
      { id: string; artifact_id: string; mutation_kind: DeploymentView["mutation"] } | undefined;
    if (row === undefined) return undefined;
    const serials = this.database
      .prepare("SELECT serial FROM deployment_devices WHERE deployment_id = ? ORDER BY rowid")
      .all(row.id)
      .map((target) => String((target as { serial: string }).serial));
    return { ...row, serials };
  }

  private publish(id: string): DeploymentView {
    const view = this.get(id);
    for (const listener of this.listeners) listener(view);
    return view;
  }
}

interface ExistingDeployment {
  id: string;
  artifact_id: string;
  serials: readonly string[];
  mutation_kind: DeploymentView["mutation"];
}
interface DeploymentAggregateRow {
  id: string;
  client_request_id: string;
  artifact_id: string;
  package_name: string;
  mutation_kind: DeploymentView["mutation"];
}
interface DeploymentTargetRow {
  serial: string;
  state: DeploymentView["state"];
  current_step: DeploymentView["currentStep"];
  failed_step: DeploymentView["failedStep"];
  failure_message: string | null;
}

function normalizeDeviceSerials(input: DeploymentCreateInput): DeviceSerial[] {
  if (input.deviceSerial !== undefined && input.deviceSerials !== undefined)
    throw new Error("Use deviceSerial or deviceSerials, not both.");
  const serials = [
    ...(input.deviceSerials ?? (input.deviceSerial === undefined ? [] : [input.deviceSerial])),
  ];
  if (serials.length < 1) throw new Error("At least one device is required.");
  if (serials.length > 4) throw new Error("A deployment supports at most four devices.");
  if (new Set(serials).size !== serials.length)
    throw new Error("Deployment devices must be unique.");
  return serials;
}

function sameSerials(left: readonly string[], right: readonly DeviceSerial[]): boolean {
  return left.length === right.length && left.every((serial, index) => serial === right[index]);
}

function aggregateState(states: readonly DeploymentView["state"][]): DeploymentView["state"] {
  if (states.every((state) => state === "COMPLETED")) return "COMPLETED";
  if (states.every((state) => state === "CANCELLED")) return "CANCELLED";
  if (
    states.some((state) => state === "FAILED") &&
    states.every((state) => ["COMPLETED", "FAILED", "CANCELLED"].includes(state))
  )
    return "FAILED";
  return states.find((state) => !["COMPLETED", "FAILED", "CANCELLED"].includes(state)) ?? "QUEUED";
}
