import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureDatabase,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
  ACTION_COMMANDS_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  SESSION_API_MIGRATION,
} from "@test-center/database";

import { ActionOutbox } from "./action-outbox.js";
import { ActionDispatcher } from "./action-dispatcher.js";
import { RunActionRepository } from "./run-repository.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createHarness() {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    SESSION_API_MIGRATION,
    ACTION_COMMANDS_MIGRATION,
  ]);
  database
    .prepare(
      `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
    )
    .run("leader-a", "now", "now", "now", "now");
  database
    .prepare(
      `INSERT INTO test_runs (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, ?, 'RUNNING', 1, ?, ?, ?)`,
    )
    .run("run-1", "Idle Weapon Shop Tycoon", "nonce-hash", "now", "now");
  database
    .prepare(
      `INSERT INTO run_devices
       (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at)
       VALUES (?, ?, 'LEADER', 'ACTIVE', 1, 1, ?, ?)`,
    )
    .run("run-1", "leader-a", "now", "now");
  databases.push(database);
  return {
    database,
    repository: new RunActionRepository(database),
    outbox: new ActionOutbox(database),
  };
}

describe("RunActionRepository", () => {
  it("persists one action, target snapshot, result, and outbox in one transaction", () => {
    const { database, repository } = createHarness();

    const result = repository.create({
      runId: "run-1",
      clientRequestId: "request-1",
      type: "tap",
      payload: { kind: "tap", x: 0.25, y: 0.75 },
      sourceMetricsEpoch: 4,
      sourceFrameId: "frame-9",
    });

    expect(result.state).toBe("CREATED");
    expect(result.action).toMatchObject({
      runId: "run-1",
      actionSeq: 1,
      type: "tap",
      sourceMetricsEpoch: 4,
      sourceFrameId: "frame-9",
      targets: [{ serial: "leader-a", state: "QUEUED" }],
    });
    expect(
      database.prepare("SELECT state FROM actions WHERE id = ?").get(result.action.id),
    ).toEqual({ state: "QUEUED" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM device_action_results").get()).toEqual({
      count: 1,
    });
    expect(
      database.prepare("SELECT state FROM action_outbox WHERE action_id = ?").get(result.action.id),
    ).toEqual({
      state: "QUEUED",
    });
  });

  it("deduplicates the same request and rejects a changed payload", () => {
    const { repository } = createHarness();
    const input = {
      runId: "run-1",
      clientRequestId: "request-1",
      type: "tap" as const,
      payload: { kind: "tap" as const, x: 0.25, y: 0.75 },
      sourceMetricsEpoch: 4,
    };
    const first = repository.create(input);
    const retry = repository.create({ ...input, payload: { y: 0.75, x: 0.25, kind: "tap" } });

    expect(retry).toEqual({ state: "DEDUPLICATED", action: first.action });
    expect(() =>
      repository.create({ ...input, payload: { kind: "tap", x: 0.26, y: 0.75 } }),
    ).toThrow("different payload");
  });

  it("allows only one queued or dispatching action per run", () => {
    const { repository } = createHarness();
    repository.create({
      runId: "run-1",
      clientRequestId: "request-1",
      type: "tap",
      payload: { kind: "tap", x: 0.25, y: 0.75 },
      sourceMetricsEpoch: 4,
    });

    expect(() =>
      repository.create({
        runId: "run-1",
        clientRequestId: "request-2",
        type: "swipe",
        payload: {
          kind: "swipe",
          path: [
            [0.2, 0.8],
            [0.2, 0.2],
          ],
          durationMs: 300,
        },
        sourceMetricsEpoch: 4,
      }),
    ).toThrow("in flight");
  });

  it("persists a lifecycle command without requiring a pointer payload", () => {
    const { repository } = createHarness();

    const result = repository.create({
      runId: "run-1",
      clientRequestId: "request-restart",
      type: "restart",
      command: { type: "restart" },
      sourceMetricsEpoch: 4,
    });

    expect(result.action).toMatchObject({
      type: "restart",
      command: { type: "restart" },
      targets: [{ serial: "leader-a", state: "QUEUED" }],
    });
  });
});

describe("ActionOutbox", () => {
  it("leases the next action once and fences the lease token", () => {
    const { repository, outbox } = createHarness();
    const created = repository.create({
      runId: "run-1",
      clientRequestId: "request-1",
      type: "tap",
      payload: { kind: "tap", x: 0.25, y: 0.75 },
      sourceMetricsEpoch: 4,
    });

    const lease = outbox.leaseNext("worker-a", "2026-08-11T00:00:00.000Z");
    expect(lease).toMatchObject({ actionId: created.action.id, ownerToken: "worker-a" });
    expect(outbox.leaseNext("worker-b", "2026-08-11T00:00:01.000Z")).toBeUndefined();
    expect(() => outbox.markDispatching(created.action.id, "wrong-token")).toThrow("lease");
    outbox.markDispatching(created.action.id, lease!.leaseToken);
  });

  it("reconciles queued actions as cancelled and leased actions as unknown", () => {
    const { repository, outbox, database } = createHarness();
    const queued = repository.create({
      runId: "run-1",
      clientRequestId: "request-1",
      type: "tap",
      payload: { kind: "tap", x: 0.25, y: 0.75 },
      sourceMetricsEpoch: 4,
    });
    const lease = outbox.leaseNext("worker-a", "2026-08-11T00:00:00.000Z");
    outbox.markDispatching(queued.action.id, lease!.leaseToken);
    outbox.reconcileAfterRestart("2026-08-11T00:00:02.000Z");

    expect(
      database.prepare("SELECT state FROM actions WHERE id = ?").get(queued.action.id),
    ).toEqual({
      state: "UNKNOWN",
    });
    expect(
      database
        .prepare("SELECT state FROM device_action_results WHERE action_id = ?")
        .get(queued.action.id),
    ).toEqual({ state: "UNKNOWN" });
  });

  it("writes a successful device result and acknowledges the outbox", () => {
    const { repository, outbox, database } = createHarness();
    const created = repository.create({
      runId: "run-1",
      clientRequestId: "request-1",
      type: "tap",
      payload: { kind: "tap", x: 0.25, y: 0.75 },
      sourceMetricsEpoch: 4,
    });
    const lease = outbox.leaseAction(created.action.id, "worker-a", "2026-08-11T00:00:00.000Z");
    outbox.markDispatching(created.action.id, lease!.leaseToken, "2026-08-11T00:00:01.000Z");
    outbox.completeTarget(
      created.action.id,
      lease!.leaseToken,
      "leader-a",
      "SUCCEEDED",
      JSON.stringify({ ok: true, pointerActionCount: 3 }),
      "2026-08-11T00:00:02.000Z",
    );

    expect(repository.get(created.action.id)).toMatchObject({
      state: "SUCCEEDED",
      targets: [{ serial: "leader-a", state: "SUCCEEDED" }],
    });
    expect(
      database
        .prepare("SELECT state, result_json FROM device_action_results WHERE action_id = ?")
        .get(created.action.id),
    ).toEqual({
      state: "SUCCEEDED",
      result_json: JSON.stringify({ ok: true, pointerActionCount: 3 }),
    });
    expect(
      database
        .prepare("SELECT state, lease_token FROM action_outbox WHERE action_id = ?")
        .get(created.action.id),
    ).toEqual({
      state: "ACKED",
      lease_token: null,
    });
  });

  it("records executor failures as failed device results", async () => {
    const { repository, outbox, database } = createHarness();
    const created = repository.create({
      runId: "run-1",
      clientRequestId: "request-1",
      type: "tap",
      payload: { kind: "tap", x: 0.25, y: 0.75 },
      sourceMetricsEpoch: 4,
    });
    const dispatcher = new ActionDispatcher(
      repository,
      outbox,
      () => ({
        execute: async () => {
          throw new Error("device action failed");
        },
      }),
      "worker-a",
    );

    const result = await dispatcher.dispatch({
      actionId: created.action.id,
      packageName: "Idle Weapon Shop Tycoon",
    });

    expect(result).toMatchObject({
      state: "FAILED",
      targets: [{ serial: "leader-a", state: "FAILED" }],
    });
    expect(
      database
        .prepare("SELECT state, result_json FROM device_action_results WHERE action_id = ?")
        .get(created.action.id),
    ).toEqual({
      state: "FAILED",
      result_json: JSON.stringify({
        ok: false,
        error: { name: "Error", message: "device action failed" },
      }),
    });
  });

  it("passes the persisted lifecycle command to each device executor", async () => {
    const { repository, outbox } = createHarness();
    const created = repository.create({
      runId: "run-1",
      clientRequestId: "request-dispatch-restart",
      type: "restart",
      command: { type: "restart" },
      sourceMetricsEpoch: 4,
    });
    const execute = vi.fn(async () => ({ restarted: true }));
    const dispatcher = new ActionDispatcher(
      repository,
      outbox,
      () => ({ execute }),
      "worker-command",
    );

    await dispatcher.dispatch({ actionId: created.action.id, packageName: "com.example.game" });

    expect(execute).toHaveBeenCalledWith({
      serial: "leader-a",
      packageName: "com.example.game",
      command: { type: "restart" },
    });
  });

  it("dispatches all active targets concurrently", async () => {
    const { repository, outbox, database } = createHarness();
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at)
         VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run("follower-b", "now", "now", "now", "now");
    database
      .prepare(
        `INSERT INTO run_devices
         (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at)
         VALUES (?, ?, 'FOLLOWER', 'ACTIVE', 1, 1, ?, ?)`,
      )
      .run("run-1", "follower-b", "now", "now");
    const created = repository.create({
      runId: "run-1",
      clientRequestId: "request-concurrent",
      type: "tap",
      payload: { kind: "tap", x: 0.25, y: 0.75 },
      sourceMetricsEpoch: 4,
    });
    let concurrent = 0;
    let maxConcurrent = 0;
    const dispatcher = new ActionDispatcher(
      repository,
      outbox,
      () => ({
        execute: async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 20));
          concurrent -= 1;
          return { accepted: true };
        },
      }),
      "worker-concurrent",
    );

    const result = await dispatcher.dispatch({
      actionId: created.action.id,
      packageName: "Idle Weapon Shop Tycoon",
    });

    expect(maxConcurrent).toBe(2);
    expect(result).toMatchObject({
      state: "SUCCEEDED",
      targets: [
        { serial: "follower-b", state: "SUCCEEDED" },
        { serial: "leader-a", state: "SUCCEEDED" },
      ],
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM device_action_results WHERE action_id = ? AND state = 'SUCCEEDED'",
        )
        .get(created.action.id),
    ).toEqual({ count: 2 });
  });
});
