import type Database from "better-sqlite3";

export interface RunPauseExecutor {
  pauseAll(runId: string, reason: string): Promise<void>;
}

export interface QuarantineResult {
  readonly state: "CREATED" | "DEDUPLICATED";
  readonly runId: string;
  readonly serial: string;
  readonly membershipState: "QUARANTINED";
  readonly epoch: number;
}

export class RunMembershipRepository {
  public constructor(private readonly database: Database.Database) {}

  public quarantine(
    runId: string,
    serial: string,
    reason: string,
    now = new Date().toISOString(),
  ): QuarantineResult {
    if (!runId.trim() || !serial.trim()) throw new TypeError("Run and serial are required.");
    if (!reason.trim()) throw new TypeError("Quarantine reason is required.");
    const transaction = this.database.transaction(() => {
      const member = this.database
        .prepare(
          `SELECT role, membership_state, epoch
           FROM run_devices
           WHERE run_id = ? AND serial = ?
           ORDER BY epoch DESC LIMIT 1`,
        )
        .get(runId, serial) as
        | {
            role: "LEADER" | "FOLLOWER";
            membership_state: "ACTIVE" | "QUARANTINED" | "RECOVERING" | "LEFT";
            epoch: number;
          }
        | undefined;
      if (member === undefined) throw new Error("Run device not found.");
      if (member.role === "LEADER") throw new Error("The run leader cannot be quarantined.");
      if (member.membership_state === "QUARANTINED") {
        return {
          state: "DEDUPLICATED" as const,
          runId,
          serial,
          membershipState: "QUARANTINED" as const,
          epoch: member.epoch,
        };
      }
      if (member.membership_state !== "ACTIVE") {
        throw new Error(`Run device cannot be quarantined from ${member.membership_state}.`);
      }
      const changed = this.database
        .prepare(
          `UPDATE run_devices
           SET membership_state = 'QUARANTINED', updated_at = ?
           WHERE run_id = ? AND serial = ? AND epoch = ? AND membership_state = 'ACTIVE'`,
        )
        .run(now, runId, serial, member.epoch) as { changes: number };
      if (changed.changes !== 1)
        throw new Error("Run device membership changed while quarantining.");
      this.database
        .prepare(
          `INSERT INTO run_device_transitions
           (run_id, serial, epoch, from_state, to_state, reason, created_at)
           VALUES (?, ?, ?, 'ACTIVE', 'QUARANTINED', ?, ?)`,
        )
        .run(runId, serial, member.epoch, reason, now);
      return {
        state: "CREATED" as const,
        runId,
        serial,
        membershipState: "QUARANTINED" as const,
        epoch: member.epoch,
      };
    });
    return transaction();
  }
}

export class RunMembershipIncidentExecutor {
  public constructor(
    private readonly membership: RunMembershipRepository,
    private readonly pauseExecutor: RunPauseExecutor,
  ) {}

  public async pauseAll(runId: string, reason: string): Promise<void> {
    await this.pauseExecutor.pauseAll(runId, reason);
  }

  public async quarantineDevice(runId: string, serial: string, reason: string): Promise<void> {
    this.membership.quarantine(runId, serial, reason);
  }
}
