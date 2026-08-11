import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import type { DeviceRegistry } from "@test-center/devices";
import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

import type { SessionCreateInput, SessionRouteService, SessionView } from "./routes/sessions.js";

interface SessionRow {
  readonly id: string;
  readonly client_request_id: string;
  readonly package_name: string;
  readonly state: SessionView["state"];
  readonly current_epoch: number;
  readonly leader_video_enabled: number;
  readonly serial: string;
  readonly membership_state: SessionView["leader"]["membershipState"];
  readonly epoch: number;
  readonly generation: number;
}

export class RuntimeSessionRouteService implements SessionRouteService {
  public constructor(
    private readonly database: Database.Database,
    private readonly registry: DeviceRegistry,
  ) {}

  public async create(
    input: SessionCreateInput,
  ): Promise<{ readonly session: SessionView; readonly state: "CREATED" | "DEDUPLICATED" }> {
    const packageName = parseAndroidPackageName(input.packageName);
    const existing = this.findByClientRequestId(input.clientRequestId);
    if (existing !== undefined) {
      if (
        existing.package_name !== packageName ||
        existing.serial !== input.deviceSerial ||
        Boolean(existing.leader_video_enabled) !== input.leaderVideoEnabled
      ) {
        throw new Error("Session client request already exists with different payload.");
      }
      return { session: this.toView(existing), state: "DEDUPLICATED" };
    }
    const device = this.registry.get(input.deviceSerial);
    if (device === undefined) throw new Error("Device not found.");
    if (device.state !== "ONLINE") throw new Error("Device must be online.");

    const now = new Date().toISOString();
    const runId = `run-${randomUUID()}`;
    const runNonceHash = createHash("sha256").update(randomUUID()).digest("hex");
    const insert = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO test_runs (id, package_name, state, current_epoch, run_nonce_hash, client_request_id, leader_video_enabled, created_at, updated_at)
         VALUES (?, ?, 'CREATED', 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          packageName,
          runNonceHash,
          input.clientRequestId,
          input.leaderVideoEnabled ? 1 : 0,
          now,
          now,
        );
      this.database
        .prepare(
          `INSERT INTO run_devices (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at)
         VALUES (?, ?, 'LEADER', 'ACTIVE', 1, 1, ?, ?)`,
        )
        .run(runId, input.deviceSerial, now, now);
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
        `SELECT r.id, r.client_request_id, r.package_name, r.state, r.current_epoch, r.leader_video_enabled,
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
    return await this.transition(id, "PREFLIGHT", "RUNNING", "SESSION_STARTED");
  }

  private findByClientRequestId(clientRequestId: string): SessionRow | undefined {
    return this.database
      .prepare(
        `SELECT r.id, r.client_request_id, r.package_name, r.state, r.current_epoch, r.leader_video_enabled,
              d.serial, d.membership_state, d.epoch, d.generation
       FROM test_runs r JOIN run_devices d ON d.run_id = r.id AND d.role = 'LEADER' AND d.epoch = r.current_epoch
       WHERE r.client_request_id = ?`,
      )
      .get(clientRequestId) as SessionRow | undefined;
  }

  private toView(row: SessionRow): SessionView {
    return {
      id: row.id,
      clientRequestId: row.client_request_id,
      packageName: row.package_name,
      state: row.state,
      currentEpoch: row.current_epoch,
      leaderVideoEnabled: Boolean(row.leader_video_enabled),
      leader: {
        serial: parseDeviceSerial(row.serial) as DeviceSerial,
        role: "LEADER",
        membershipState: row.membership_state,
        epoch: row.epoch,
        generation: row.generation,
      },
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
    const device = this.registry.get(current.leader.serial);
    if (device === undefined) throw new Error("Device not found.");
    if (device.state !== "ONLINE") throw new Error("Device must be online.");
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
