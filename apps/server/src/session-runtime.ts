import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import type { DeviceRegistry } from "@test-center/devices";
import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";
import { ActionOutbox, RunActionRepository, type ActionDispatcher } from "@test-center/sessions";
import type { ReportFinalizationExecutor } from "@test-center/reports";
import type { RuntimeWorkerCoordinator } from "./runtime-worker-coordinator.js";
import type { BridgeMode } from "./runtime-config.js";

import type {
  SessionCreateInput,
  SessionPreflightProbe,
  SessionActionInput,
  SessionActionResult,
  SessionCompletionInput,
  SessionRouteService,
  SessionView,
} from "./routes/sessions.js";

export interface SessionVideoRecorder {
  start(input: {
    readonly runId: string;
    readonly serial: DeviceSerial;
    readonly enabled: boolean;
  }): Promise<void>;
  stop(runId: string): Promise<unknown>;
}

interface SessionRow {
  readonly id: string;
  readonly client_request_id: string;
  readonly package_name: string;
  readonly state: SessionView["state"];
  readonly current_epoch: number;
  readonly leader_video_enabled: number;
  readonly failure_policy: "PAUSE_ALL" | "QUARANTINE_FAILED_DEVICE";
  readonly bridge_mode: BridgeMode;
  readonly serial: string;
  readonly membership_state: SessionView["leader"]["membershipState"];
  readonly epoch: number;
  readonly generation: number;
  readonly run_nonce_hash: string;
}

interface SessionMemberRow {
  readonly serial: string;
  readonly role: "LEADER" | "FOLLOWER";
  readonly membership_state: SessionView["leader"]["membershipState"];
  readonly epoch: number;
  readonly generation: number;
}

export class RuntimeSessionRouteService implements SessionRouteService {
  public constructor(
    private readonly database: Database.Database,
    private readonly registry: DeviceRegistry,
    private readonly preflightProbe?: SessionPreflightProbe,
    private readonly actionRepository = new RunActionRepository(database),
    private readonly actionDispatcher?: Pick<ActionDispatcher, "dispatch">,
    private readonly workerCoordinator?: Pick<RuntimeWorkerCoordinator, "start" | "stop">,
    private readonly actionOutbox = new ActionOutbox(database),
    private readonly finalization?: Pick<ReportFinalizationExecutor, "startFinalization">,
    private readonly videoRecorder?: SessionVideoRecorder,
    private readonly defaultBridgeMode: BridgeMode = "REQUIRED",
  ) {}

  public async create(
    input: SessionCreateInput,
  ): Promise<{ readonly session: SessionView; readonly state: "CREATED" | "DEDUPLICATED" }> {
    const packageName = parseAndroidPackageName(input.packageName);
    const deviceSerials = normalizeDeviceSerials(input);
    const existing = this.findByClientRequestId(input.clientRequestId);
    if (existing !== undefined) {
      if (
        existing.package_name !== packageName ||
        !sameSerials(this.readMemberSerials(existing.id), deviceSerials) ||
        Boolean(existing.leader_video_enabled) !== input.leaderVideoEnabled ||
        existing.failure_policy !== (input.failurePolicy ?? "PAUSE_ALL") ||
        existing.bridge_mode !== (input.bridgeMode ?? this.defaultBridgeMode)
      ) {
        throw new Error("Session client request already exists with different payload.");
      }
      return { session: this.toView(existing), state: "DEDUPLICATED" };
    }
    for (const serial of deviceSerials) {
      const device = this.registry.get(serial);
      if (device === undefined) throw new Error(`Device not found: ${serial}.`);
      if (device.state !== "ONLINE") throw new Error(`Device must be online: ${serial}.`);
    }
    const now = new Date().toISOString();
    const runId = `run-${randomUUID()}`;
    const runNonceHash = createHash("sha256").update(randomUUID()).digest("hex");
    const insert = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO test_runs (id, package_name, state, current_epoch, run_nonce_hash, client_request_id, leader_video_enabled, failure_policy, bridge_mode, created_at, updated_at)
         VALUES (?, ?, 'CREATED', 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          packageName,
          runNonceHash,
          input.clientRequestId,
          input.leaderVideoEnabled ? 1 : 0,
          input.failurePolicy ?? "PAUSE_ALL",
          input.bridgeMode ?? this.defaultBridgeMode,
          now,
          now,
        );
      const insertMember = this.database.prepare(
        `INSERT INTO run_devices (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', 1, 1, ?, ?)`,
      );
      deviceSerials.forEach((serial, index) =>
        insertMember.run(runId, serial, index === 0 ? "LEADER" : "FOLLOWER", now, now),
      );
      this.database
        .prepare(
          `INSERT INTO run_transitions (run_id, from_state, to_state, reason, created_at)
         VALUES (?, NULL, 'CREATED', 'SESSION_CREATED', ?)`,
        )
        .run(runId, now);
    });
    insert.immediate();
    const session = this.get(runId);
    if (session === undefined) throw new Error("Created session could not be read back.");
    return { session, state: "CREATED" };
  }

  public get(id: string): SessionView | undefined {
    const row = this.database
      .prepare(
        `SELECT r.id, r.client_request_id, r.package_name, r.state, r.current_epoch, r.leader_video_enabled, r.failure_policy, r.bridge_mode,
              d.serial, d.membership_state, d.epoch, d.generation
       FROM test_runs r JOIN run_devices d ON d.run_id = r.id AND d.role = 'LEADER' AND d.epoch = r.current_epoch
       WHERE r.id = ?`,
      )
      .get(id) as SessionRow | undefined;
    return row === undefined ? undefined : this.toView(row);
  }

  public async preflight(id: string): Promise<SessionView> {
    return await this.transition(id, "CREATED", "PREFLIGHT", "SESSION_PREFLIGHT");
  }

  public async start(id: string): Promise<SessionView> {
    const current = this.get(id);
    if (current === undefined) throw new Error("Session not found.");
    if (current.state !== "PREFLIGHT") throw new Error("Session state must be PREFLIGHT.");
    if (this.workerCoordinator !== undefined) {
      await this.workerCoordinator.start(
        current.id,
        current.devices.map((device) => device.serial),
        current.packageName,
        this.readRunNonceHash(current.id),
        current.bridgeMode,
      );
    }
    try {
      await this.videoRecorder
        ?.start({
          runId: current.id,
          serial: current.leader.serial,
          enabled: current.leaderVideoEnabled,
        })
        .catch(() => undefined);
      return await this.transition(id, "PREFLIGHT", "RUNNING", "SESSION_STARTED");
    } catch (error) {
      await this.videoRecorder?.stop(id).catch(() => undefined);
      await this.workerCoordinator?.stop(id).catch(() => undefined);
      throw error;
    }
  }

  public async pause(id: string, reason: string): Promise<SessionView> {
    if (!reason.trim() || reason.length > 128) throw new TypeError("Pause reason is invalid.");
    const current = this.get(id);
    if (current === undefined) throw new Error("Session not found.");
    if (current.state !== "RUNNING") throw new Error("Session state must be RUNNING.");
    await this.workerCoordinator?.stop(id);
    await this.videoRecorder?.stop(id).catch(() => undefined);
    this.actionOutbox.cancelQueuedForRun(id, "SESSION_PAUSED");
    const now = new Date().toISOString();
    const update = this.database.transaction(() => {
      const changed = this.database
        .prepare(
          "UPDATE test_runs SET state = 'PAUSED', updated_at = ? WHERE id = ? AND state = 'RUNNING'",
        )
        .run(now, id) as { changes: number };
      if (changed.changes !== 1) throw new Error("Session state changed while pausing.");
      this.database
        .prepare(
          "INSERT INTO run_transitions (run_id, from_state, to_state, reason, created_at) VALUES (?, 'RUNNING', 'PAUSED', ?, ?)",
        )
        .run(id, `SESSION_PAUSED:${reason}`, now);
    });
    update.immediate();
    const paused = this.get(id);
    if (paused === undefined) throw new Error("Paused session could not be read back.");
    return paused;
  }

  public async complete(id: string, input: SessionCompletionInput): Promise<SessionView> {
    if (!input.reason.trim() || input.reason.length > 128)
      throw new TypeError("Completion reason is invalid.");
    const current = this.get(id);
    if (current === undefined) throw new Error("Session not found.");
    if (current.state !== "RUNNING" && current.state !== "PAUSED") {
      throw new Error("Session state must be RUNNING or PAUSED.");
    }

    await this.workerCoordinator?.stop(id);
    await this.videoRecorder?.stop(id).catch(() => undefined);
    this.actionOutbox.cancelQueuedForRun(id, "SESSION_COMPLETED");
    const now = new Date().toISOString();
    const update = this.database.transaction(() => {
      const changed = this.database
        .prepare("UPDATE test_runs SET state = ?, updated_at = ? WHERE id = ? AND state = ?")
        .run(input.state, now, id, current.state) as { changes: number };
      if (changed.changes !== 1) throw new Error("Session state changed while completing.");
      this.database
        .prepare(
          "INSERT INTO run_transitions (run_id, from_state, to_state, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, current.state, input.state, `SESSION_COMPLETED:${input.reason}`, now);
    });
    update.immediate();

    const completed = this.get(id);
    if (completed === undefined) throw new Error("Completed session could not be read back.");
    if (this.finalization !== undefined) {
      await this.finalization.startFinalization(id).catch(() => undefined);
    }
    return completed;
  }

  public async submitAction(
    id: string,
    actorSessionId: string,
    input: SessionActionInput,
  ): Promise<SessionActionResult> {
    void actorSessionId;
    const session = this.get(id);
    if (session === undefined) throw new Error("Session not found.");
    const result = this.actionRepository.create({ runId: id, ...input });
    if (result.state === "CREATED" && this.actionDispatcher !== undefined) {
      const action = await this.actionDispatcher.dispatch({
        actionId: result.action.id,
        packageName: session.packageName,
        bridgeMode: session.bridgeMode,
      });
      return { state: result.state, action };
    }
    return result;
  }

  private findByClientRequestId(clientRequestId: string): SessionRow | undefined {
    return this.database
      .prepare(
        `SELECT r.id, r.client_request_id, r.package_name, r.state, r.current_epoch, r.leader_video_enabled, r.failure_policy, r.bridge_mode,
              d.serial, d.membership_state, d.epoch, d.generation
       FROM test_runs r JOIN run_devices d ON d.run_id = r.id AND d.role = 'LEADER' AND d.epoch = r.current_epoch
       WHERE r.client_request_id = ?`,
      )
      .get(clientRequestId) as SessionRow | undefined;
  }

  private readRunNonceHash(runId: string): string {
    const row = this.database
      .prepare("SELECT run_nonce_hash FROM test_runs WHERE id = ?")
      .get(runId) as { run_nonce_hash: string } | undefined;
    if (row === undefined) throw new Error("Run not found.");
    return `sha256:${row.run_nonce_hash}`;
  }

  private readMemberSerials(runId: string): readonly string[] {
    return (
      this.database
        .prepare("SELECT serial FROM run_devices WHERE run_id = ? ORDER BY serial ASC")
        .all(runId) as readonly { serial: string }[]
    ).map((row) => row.serial);
  }

  private toView(row: SessionRow): SessionView {
    const devices = this.database
      .prepare(
        `SELECT serial, role, membership_state, epoch, generation
         FROM run_devices WHERE run_id = ? AND epoch = ? ORDER BY role = 'LEADER' DESC, serial ASC`,
      )
      .all(row.id, row.current_epoch) as readonly SessionMemberRow[];
    return {
      id: row.id,
      clientRequestId: row.client_request_id,
      packageName: row.package_name,
      state: row.state,
      currentEpoch: row.current_epoch,
      leaderVideoEnabled: Boolean(row.leader_video_enabled),
      failurePolicy: row.failure_policy,
      bridgeMode: row.bridge_mode,
      leader: {
        serial: parseDeviceSerial(row.serial) as DeviceSerial,
        role: "LEADER",
        membershipState: row.membership_state,
        epoch: row.epoch,
        generation: row.generation,
      },
      devices: devices.map((device) => ({
        serial: parseDeviceSerial(device.serial) as DeviceSerial,
        role: device.role,
        membershipState: device.membership_state,
        epoch: device.epoch,
        generation: device.generation,
      })),
    };
  }

  private async transition(
    id: string,
    expectedState: SessionView["state"],
    nextState: SessionView["state"],
    reason: string,
  ): Promise<SessionView> {
    const current = this.get(id);
    if (current === undefined) throw new Error("Session not found.");
    if (current.state !== expectedState) throw new Error(`Session state must be ${expectedState}.`);
    for (const member of current.devices) {
      const device = this.registry.get(member.serial);
      if (device === undefined) throw new Error(`Device not found: ${member.serial}.`);
      if (device.state !== "ONLINE") throw new Error(`Device must be online: ${member.serial}.`);
    }
    if (nextState === "PREFLIGHT") {
      if (this.preflightProbe !== undefined) {
        for (const member of current.devices) {
          await this.preflightProbe.check({
            serial: member.serial,
            packageName: current.packageName,
          });
        }
      }
    }
    const now = new Date().toISOString();
    const update = this.database.transaction(() => {
      this.database
        .prepare("UPDATE test_runs SET state = ?, updated_at = ? WHERE id = ? AND state = ?")
        .run(nextState, now, id, expectedState);
      this.database
        .prepare(
          "INSERT INTO run_transitions (run_id, from_state, to_state, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, expectedState, nextState, reason, now);
    });
    update.immediate();
    const next = this.get(id);
    if (next === undefined) throw new Error("Session transition could not be read back.");
    return next;
  }
}

function normalizeDeviceSerials(input: SessionCreateInput): readonly DeviceSerial[] {
  const serials =
    input.deviceSerials ?? (input.deviceSerial === undefined ? [] : [input.deviceSerial]);
  const unique = [...new Set(serials)];
  if (unique.length === 0) throw new Error("At least one device is required.");
  if (unique.length > 4) throw new Error("A session supports at most four devices.");
  if (unique.length !== serials.length) throw new Error("Device serials must be unique.");
  return unique;
}

function sameSerials(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((serial, index) => serial === rightSorted[index]);
}
