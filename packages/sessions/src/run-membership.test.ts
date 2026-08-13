import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  INCIDENTS_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  RUN_MEMBERSHIP_MIGRATION,
  migrate,
} from "@test-center/database/migrations";
import { RunMembershipIncidentExecutor, RunMembershipRepository } from "./run-membership.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createHarness(): { database: Database.Database; repository: RunMembershipRepository } {
  const database = new Database(":memory:");
  databases.push(database);
  database.pragma("foreign_keys = ON");
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    INCIDENTS_MIGRATION,
    RUN_MEMBERSHIP_MIGRATION,
  ]);
  const now = "2026-08-13T00:00:00.000Z";
  for (const serial of ["leader-a", "follower-b"]) {
    database
      .prepare(
        `INSERT INTO devices
         (serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq, created_at, updated_at)
         VALUES (?, 'ONLINE', '{}', ?, ?, 1, ?, ?)`,
      )
      .run(serial, now, now, now, now);
  }
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES ('run-a', 'Idle Weapon Shop Tycoon', 'RUNNING', 1, 'nonce-hash', ?, ?)`,
    )
    .run(now, now);
  for (const [serial, role] of [
    ["leader-a", "LEADER"],
    ["follower-b", "FOLLOWER"],
  ] as const) {
    database
      .prepare(
        `INSERT INTO run_devices
         (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at)
         VALUES ('run-a', ?, ?, 'ACTIVE', 1, 1, ?, ?)`,
      )
      .run(serial, role, now, now);
  }
  return { database, repository: new RunMembershipRepository(database) };
}

describe("RunMembershipRepository", () => {
  it("quarantines an active follower and records a member transition", () => {
    const { database, repository } = createHarness();

    const result = repository.quarantine(
      "run-a",
      "follower-b",
      "bridge timeout",
      "2026-08-13T00:00:02.000Z",
    );

    expect(result.state).toBe("CREATED");
    expect(result.membershipState).toBe("QUARANTINED");
    expect(
      database
        .prepare("SELECT membership_state FROM run_devices WHERE run_id = ? AND serial = ?")
        .get("run-a", "follower-b"),
    ).toEqual({ membership_state: "QUARANTINED" });
    expect(
      database.prepare("SELECT from_state, to_state, reason FROM run_device_transitions").get(),
    ).toEqual({ from_state: "ACTIVE", to_state: "QUARANTINED", reason: "bridge timeout" });
  });

  it("is idempotent for an already quarantined follower and rejects the leader", () => {
    const { repository } = createHarness();
    const first = repository.quarantine("run-a", "follower-b", "bridge timeout");
    const duplicate = repository.quarantine("run-a", "follower-b", "bridge timeout");

    expect(first.state).toBe("CREATED");
    expect(duplicate.state).toBe("DEDUPLICATED");
    expect(() => repository.quarantine("run-a", "leader-a", "leader failure")).toThrow(/leader/i);
  });

  it("adapts quarantine persistence and pause callback to the incident executor contract", async () => {
    const { repository } = createHarness();
    const pauseAll = async () => undefined;
    const executor = new RunMembershipIncidentExecutor(repository, { pauseAll });

    await executor.quarantineDevice("run-a", "follower-b", "bridge timeout");

    expect(repository.quarantine("run-a", "follower-b", "bridge timeout").state).toBe(
      "DEDUPLICATED",
    );
  });
});
