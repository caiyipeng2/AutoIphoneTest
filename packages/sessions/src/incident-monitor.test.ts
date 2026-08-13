import { describe, expect, it, vi } from "vitest";

import { parseIncident } from "@test-center/contracts/incident";
import { IncidentMonitor } from "./incident-monitor.js";
import { IncidentRepository } from "./incident-repository.js";
import Database from "better-sqlite3";
import {
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  INCIDENTS_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  migrate,
} from "@test-center/database/migrations";

const incident = parseIncident({
  schemaVersion: 1,
  incidentId: "inc-monitor-1",
  runId: "run-a",
  serial: "follower-b",
  category: "BRIDGE_TIMEOUT",
  generation: 1,
  detectedAtRealtimeMs: 12_000,
  detectedAt: "2026-08-13T00:00:01.000Z",
  source: "bridge-monitor",
  details: { state: "timeout" },
});

describe("IncidentMonitor", () => {
  it("records once and executes the selected quarantine policy", async () => {
    const { database } = createIncidentHarness();
    const repository = new IncidentRepository(database);
    const executor = { pauseAll: vi.fn(), quarantineDevice: vi.fn(async () => undefined) };
    const monitor = new IncidentMonitor(repository, executor);

    const first = await monitor.handle({
      incident,
      policy: "QUARANTINE_FAILED_DEVICE",
      members: [
        { serial: "leader-a", role: "LEADER", membershipState: "ACTIVE" },
        { serial: "follower-b", role: "FOLLOWER", membershipState: "ACTIVE" },
      ],
    });
    const duplicate = await monitor.handle({
      incident,
      policy: "QUARANTINE_FAILED_DEVICE",
      members: [
        { serial: "leader-a", role: "LEADER", membershipState: "ACTIVE" },
        { serial: "follower-b", role: "FOLLOWER", membershipState: "ACTIVE" },
      ],
    });

    expect(first.decision.action).toBe("QUARANTINE_DEVICE");
    expect(first.recovery.status).toBe("SUCCEEDED");
    expect(duplicate.recovery.id).toBe(first.recovery.id);
    expect(executor.quarantineDevice).toHaveBeenCalledTimes(1);
    expect(executor.quarantineDevice).toHaveBeenCalledWith(
      "run-a",
      "follower-b",
      expect.any(String),
    );
  });

  it("records a failed recovery without hiding the incident evidence", async () => {
    const { database } = createIncidentHarness();
    const repository = new IncidentRepository(database);
    const executor = {
      pauseAll: vi.fn(async () => {
        throw new Error("worker stop failed");
      }),
      quarantineDevice: vi.fn(async () => undefined),
    };
    const monitor = new IncidentMonitor(repository, executor);

    const result = await monitor.handle({
      incident: { ...incident, incidentId: "inc-monitor-failed", serial: undefined },
      policy: "PAUSE_ALL",
      members: [{ serial: "leader-a", role: "LEADER", membershipState: "ACTIVE" }],
    });

    expect(result.incident.incidentId).toBe("inc-monitor-failed");
    expect(result.recovery.status).toBe("FAILED");
    expect(result.recovery.errorMessage).toBe("worker stop failed");
  });
});

function createIncidentHarness(): { database: Database.Database } {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    INCIDENTS_MIGRATION,
  ]);
  const timestamp = "2026-08-13T00:00:00.000Z";
  for (const serial of ["leader-a", "follower-b"]) {
    database
      .prepare(
        `INSERT INTO devices
         (serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq, created_at, updated_at)
         VALUES (?, 'ONLINE', '{}', ?, ?, 1, ?, ?)`,
      )
      .run(serial, timestamp, timestamp, timestamp, timestamp);
  }
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, ?, 'RUNNING', 1, ?, ?, ?)`,
    )
    .run("run-a", "Idle Weapon Shop Tycoon", "nonce-hash", timestamp, timestamp);
  return { database };
}
