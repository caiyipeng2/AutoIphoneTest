import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  INCIDENTS_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  migrate,
} from "@test-center/database/migrations";
import { parseIncident, type Incident } from "@test-center/contracts/incident";
import { IncidentRepository } from "./incident-repository.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createHarness(): { database: Database.Database; repository: IncidentRepository } {
  const database = new Database(":memory:");
  databases.push(database);
  database.pragma("foreign_keys = ON");
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    INCIDENTS_MIGRATION,
  ]);
  database
    .prepare(
      `INSERT INTO devices
       (serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq, created_at, updated_at)
       VALUES (?, 'ONLINE', '{}', ?, ?, 1, ?, ?)`,
    )
    .run(
      "leader-a",
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, ?, 'RUNNING', 1, ?, ?, ?)`,
    )
    .run(
      "run-a",
      "Idle Weapon Shop Tycoon",
      "nonce-hash",
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
    );
  return { database, repository: new IncidentRepository(database) };
}

function createIncident(overrides: Partial<Incident> = {}): Incident {
  return parseIncident({
    schemaVersion: 1,
    incidentId: `inc-${randomUUID()}`,
    runId: "run-a",
    serial: "leader-a",
    category: "ADB_DISCONNECTED",
    generation: 1,
    detectedAtRealtimeMs: 12_000,
    detectedAt: "2026-08-13T00:00:01.000Z",
    source: "adb-monitor",
    evidenceRef: "evidence://incident-1",
    details: { state: "offline" },
    ...overrides,
  });
}

describe("IncidentRepository", () => {
  it("persists an incident idempotently and returns a frozen typed record", () => {
    const { repository } = createHarness();
    const incident = createIncident({ incidentId: "inc-fixed" });

    const first = repository.record(incident);
    const duplicate = repository.record(incident);

    expect(first.state).toBe("CREATED");
    expect(duplicate.state).toBe("DEDUPLICATED");
    expect(repository.get("inc-fixed")).toMatchObject(incident);
    expect(Object.isFrozen(repository.get("inc-fixed"))).toBe(true);
    expect(Object.isFrozen(repository.get("inc-fixed")?.details)).toBe(true);
  });

  it("lists incidents by run in detection order and preserves device-less incidents", () => {
    const { repository } = createHarness();
    repository.record(
      createIncident({ incidentId: "inc-late", serial: undefined, detectedAtRealtimeMs: 20_000 }),
    );
    repository.record(createIncident({ incidentId: "inc-early", detectedAtRealtimeMs: 10_000 }));

    expect(repository.list("run-a").map((item) => [item.incidentId, item.serial])).toEqual([
      ["inc-early", "leader-a"],
      ["inc-late", undefined],
    ]);
  });

  it("records recovery attempts and exposes unfinished attempts for restart reconciliation", () => {
    const { repository } = createHarness();
    const incident = createIncident({ incidentId: "inc-recovery" });
    repository.record(incident);

    const attempt = repository.startRecovery({
      incidentId: incident.incidentId,
      action: "PAUSE_ALL",
      reason: "leader failure",
      deadlineRealtimeMs: 14_000,
    });
    expect(attempt.status).toBe("STARTED");
    expect(repository.listUnfinishedRecovery("run-a")).toHaveLength(1);

    const completed = repository.finishRecovery(attempt.id, {
      status: "SUCCEEDED",
      completedAt: "2026-08-13T00:00:02.000Z",
    });
    expect(completed.status).toBe("SUCCEEDED");
    expect(repository.listUnfinishedRecovery("run-a")).toHaveLength(0);
  });
});
