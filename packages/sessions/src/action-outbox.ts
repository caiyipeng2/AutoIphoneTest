import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

export interface ActionLease {
  readonly actionId: string;
  readonly runId: string;
  readonly leaseToken: string;
  readonly ownerToken: string;
  readonly leasedAt: string;
}

interface QueuedOutboxRow {
  readonly action_id: string;
  readonly run_id: string;
}

export class ActionOutbox {
  public constructor(private readonly database: Database.Database) {}

  public leaseNext(
    ownerToken: string,
    leasedAt = new Date().toISOString(),
  ): ActionLease | undefined {
    if (!ownerToken.trim()) throw new TypeError("Outbox ownerToken is required.");
    const transaction = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT outbox.action_id, actions.run_id
           FROM action_outbox AS outbox
           JOIN actions ON actions.id = outbox.action_id
           WHERE outbox.state = 'QUEUED'
           ORDER BY actions.run_id ASC, actions.action_seq ASC
           LIMIT 1`,
        )
        .get() as QueuedOutboxRow | undefined;
      if (row === undefined) return undefined;
      const leaseToken = `lease-${randomUUID()}`;
      const changed = this.database
        .prepare(
          `UPDATE action_outbox
           SET state = 'LEASED', lease_token = ?, leased_at = ?, attempt_count = attempt_count + 1, updated_at = ?
           WHERE action_id = ? AND state = 'QUEUED'`,
        )
        .run(leaseToken, leasedAt, leasedAt, row.action_id) as { changes: number };
      if (changed.changes !== 1) return undefined;
      this.database
        .prepare(
          "UPDATE actions SET state = 'LEASED', updated_at = ? WHERE id = ? AND state = 'QUEUED'",
        )
        .run(leasedAt, row.action_id);
      this.database
        .prepare(
          `INSERT INTO action_transitions (action_id, from_state, to_state, reason, created_at)
           VALUES (?, 'QUEUED', 'LEASED', 'OUTBOX_LEASED', ?)`,
        )
        .run(row.action_id, leasedAt);
      return {
        actionId: row.action_id,
        runId: row.run_id,
        leaseToken,
        ownerToken,
        leasedAt,
      };
    });
    return transaction();
  }

  public markDispatching(
    actionId: string,
    leaseToken: string,
    now = new Date().toISOString(),
  ): void {
    const transaction = this.database.transaction(() => {
      const changed = this.database
        .prepare(
          `UPDATE action_outbox SET state = 'DISPATCHING', updated_at = ?
           WHERE action_id = ? AND state = 'LEASED' AND lease_token = ?`,
        )
        .run(now, actionId, leaseToken) as { changes: number };
      if (changed.changes !== 1) throw new Error("Action outbox lease is invalid or expired.");
      this.database
        .prepare(
          "UPDATE actions SET state = 'DISPATCHING', updated_at = ? WHERE id = ? AND state = 'LEASED'",
        )
        .run(now, actionId);
      this.database
        .prepare(
          "UPDATE action_targets SET state = 'DISPATCHING', updated_at = ? WHERE action_id = ? AND state = 'QUEUED'",
        )
        .run(now, actionId);
      this.database
        .prepare(
          `INSERT INTO action_transitions (action_id, from_state, to_state, reason, created_at)
           VALUES (?, 'LEASED', 'DISPATCHING', 'OUTBOX_DISPATCHING', ?)`,
        )
        .run(actionId, now);
    });
    transaction();
  }

  public reconcileAfterRestart(now = new Date().toISOString()): void {
    const transaction = this.database.transaction(() => {
      const rows = this.database
        .prepare(
          "SELECT action_id, state FROM action_outbox WHERE state IN ('QUEUED', 'LEASED', 'DISPATCHING')",
        )
        .all() as readonly { action_id: string; state: "QUEUED" | "LEASED" | "DISPATCHING" }[];
      for (const row of rows) {
        const next = row.state === "QUEUED" ? "CANCELLED" : "UNKNOWN";
        const reason =
          row.state === "QUEUED" ? "STARTUP_CANCELLED_QUEUED" : "STARTUP_UNKNOWN_LEASE";
        this.database
          .prepare(
            "UPDATE action_outbox SET state = 'CANCELLED', lease_token = NULL, updated_at = ? WHERE action_id = ?",
          )
          .run(now, row.action_id);
        this.database
          .prepare("UPDATE actions SET state = ?, updated_at = ? WHERE id = ?")
          .run(next, now, row.action_id);
        this.database
          .prepare(
            "UPDATE action_targets SET state = ?, updated_at = ? WHERE action_id = ? AND state IN ('QUEUED', 'DISPATCHING')",
          )
          .run(next, now, row.action_id);
        this.database
          .prepare(
            "UPDATE device_action_results SET state = ?, result_json = ?, updated_at = ? WHERE action_id = ? AND state = 'PENDING'",
          )
          .run(
            next === "CANCELLED" ? "CANCELLED" : "UNKNOWN",
            JSON.stringify({ reason }),
            now,
            row.action_id,
          );
        this.database
          .prepare(
            `INSERT INTO action_transitions (action_id, from_state, to_state, reason, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(row.action_id, row.state, next, reason, now);
      }
    });
    transaction();
  }
}
