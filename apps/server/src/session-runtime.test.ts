import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { win32 } from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import {
  createRuntimePaths,
  ensureRuntimeDirectories,
  openDatabase,
  migrate,
  FOUNDATION_MIGRATION,
  DEVICES_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  SESSION_API_MIGRATION,
  ACTION_COMMANDS_MIGRATION,
  RUN_FAILURE_POLICY_MIGRATION,
  SESSION_BRIDGE_MODE_MIGRATION,
} from "@test-center/database";

import { RuntimeSessionRouteService } from "./session-runtime.js";
import type { ActionView } from "@test-center/sessions";
import { RunActionRepository } from "@test-center/sessions";
import { ActionOutbox } from "@test-center/sessions";

const databases: Database.Database[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
});

describe("RuntimeSessionRouteService", () => {
  it("resumes a paused session with fresh workers and the next epoch/generation", async () => {
    const database = await createDatabase();
    const serials = [parseDeviceSerial("R5CX211TXNT"), parseDeviceSerial("R5CRC342PRF")];
    for (const serial of serials) {
      database
        .prepare(
          `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
        )
        .run(serial, "now", "now", "now", "now");
    }
    const registry = { get: vi.fn(() => ({ state: "ONLINE" })) };
    const coordinator = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    const dispatcher = { dispatch: vi.fn() };
    const service = new RuntimeSessionRouteService(
      database,
      registry as never,
      undefined,
      undefined,
      dispatcher,
      coordinator,
    );
    const created = await service.create({
      clientRequestId: "request-resume",
      packageName: "com.example.game",
      deviceSerials: serials,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);
    await service.pause(created.session.id, "fault-monitor");

    const resumed = await service.resume(created.session.id, "operator-rebuild");

    expect(resumed).toMatchObject({
      state: "RUNNING",
      currentEpoch: 2,
      devices: [
        { serial: serials[0], role: "LEADER", membershipState: "ACTIVE", epoch: 2, generation: 2 },
        {
          serial: serials[1],
          role: "FOLLOWER",
          membershipState: "ACTIVE",
          epoch: 2,
          generation: 2,
        },
      ],
    });
    expect(coordinator.start).toHaveBeenLastCalledWith(
      created.session.id,
      serials,
      "com.example.game",
      expect.stringMatching(/^sha256:/),
      "REQUIRED",
      new Map([
        [serials[0], 2],
        [serials[1], 2],
      ]),
    );
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(
      database
        .prepare(
          "SELECT from_state, to_state, reason FROM run_transitions WHERE run_id = ? ORDER BY id DESC LIMIT 1",
        )
        .get(created.session.id),
    ).toEqual({
      from_state: "PAUSED",
      to_state: "RUNNING",
      reason: "OPERATOR_RESUMED:operator-rebuild",
    });
  });

  it("leaves a paused session unchanged when rebuilt workers cannot start", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const coordinator = {
      start: vi
        .fn<(...args: never[]) => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("rebuild failed")),
      stop: vi.fn(async () => undefined),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    const created = await service.create({
      clientRequestId: "request-resume-failed",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);
    await service.pause(created.session.id, "fault-monitor");

    await expect(service.resume(created.session.id, "operator-rebuild")).rejects.toThrow(
      "rebuild failed",
    );
    expect(service.get(created.session.id)).toMatchObject({ state: "PAUSED", currentEpoch: 1 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM run_devices WHERE run_id = ?")
        .get(created.session.id),
    ).toEqual({ count: 1 });
  });

  it("refuses to resume when an active member is no longer online", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    let online = true;
    const registry = { get: vi.fn(() => ({ state: online ? "ONLINE" : "OFFLINE" })) };
    const coordinator = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    const service = new RuntimeSessionRouteService(
      database,
      registry as never,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    const created = await service.create({
      clientRequestId: "request-resume-offline",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);
    await service.pause(created.session.id, "fault-monitor");
    online = false;

    await expect(service.resume(created.session.id, "operator-rebuild")).rejects.toThrow("online");
    expect(coordinator.start).toHaveBeenCalledTimes(1);
    expect(service.get(created.session.id)).toMatchObject({ state: "PAUSED", currentEpoch: 1 });
  });

  it("pauses a running session, stops workers, and records the transition", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const coordinator = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    const created = await service.create({
      clientRequestId: "request-pause",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);

    const paused = await service.pause(created.session.id, "fault-monitor");

    expect(paused.state).toBe("PAUSED");
    expect(coordinator.stop).toHaveBeenCalledWith(created.session.id);
    expect(
      database
        .prepare(
          "SELECT from_state, to_state, reason FROM run_transitions WHERE run_id = ? ORDER BY id DESC LIMIT 1",
        )
        .get(created.session.id),
    ).toEqual({
      from_state: "RUNNING",
      to_state: "PAUSED",
      reason: "SESSION_PAUSED:fault-monitor",
    });
  });

  it("persists the selected failure policy for runtime incident decisions", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const service = new RuntimeSessionRouteService(database, {
      get: () => ({ state: "ONLINE" }),
    } as never);
    const created = await service.create({
      clientRequestId: "request-policy",
      packageName: "com.example.game",
      deviceSerials: [serial],
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
      failurePolicy: "QUARANTINE_FAILED_DEVICE",
    });

    const row = database
      .prepare("SELECT failure_policy FROM test_runs WHERE id = ?")
      .get(created.session.id) as { failure_policy: string };
    expect(row.failure_policy).toBe("QUARANTINE_FAILED_DEVICE");
  });

  it("cancels queued actions when pausing a running session", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const repository = new RunActionRepository(database);
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      repository,
      undefined,
      undefined,
      new ActionOutbox(database),
    );
    const created = await service.create({
      clientRequestId: "request-pause-queued",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);
    const queued = await service.submitAction(created.session.id, "session-1", {
      clientRequestId: "action-pause-queued",
      type: "tap",
      payload: { kind: "tap", x: 0.5, y: 0.5 },
      sourceMetricsEpoch: 1,
    });

    await service.pause(created.session.id, "fault-monitor");

    expect(repository.get(queued.action.id)?.state).toBe("CANCELLED");
  });

  it("rejects pausing a session that is not running", async () => {
    const database = await createDatabase();
    const service = new RuntimeSessionRouteService(database, { get: () => undefined } as never);
    await expect(service.pause("missing-run", "fault-monitor")).rejects.toThrow(
      "Session not found",
    );
  });

  it("passes the persisted run nonce hash to managed workers", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const workerCoordinator = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      undefined,
      undefined,
      workerCoordinator,
    );
    const created = await service.create({
      clientRequestId: "request-worker-nonce",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);
    const stored = database
      .prepare("SELECT run_nonce_hash FROM test_runs WHERE id = ?")
      .get(created.session.id) as { run_nonce_hash: string };
    expect(workerCoordinator.start).toHaveBeenCalledWith(
      created.session.id,
      [serial],
      "com.example.game",
      `sha256:${stored.run_nonce_hash}`,
      "REQUIRED",
    );
  });

  it("persists a leader run and deduplicates the same client request", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const registry = { get: vi.fn(() => ({ state: "ONLINE" })) };
    const preflightProbe = { check: vi.fn(async () => undefined) };
    const service = new RuntimeSessionRouteService(database, registry as never, preflightProbe);
    const input = {
      clientRequestId: "request-1",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    };

    const created = await service.create(input);
    expect(created.state).toBe("CREATED");
    expect(created.session).toMatchObject({
      packageName: input.packageName,
      state: "CREATED",
      currentEpoch: 1,
      leaderVideoEnabled: true,
      leader: { serial, role: "LEADER", epoch: 1, generation: 1 },
    });
    expect(service.get(created.session.id)).toEqual(created.session);
    expect(await service.create(input)).toEqual({
      session: created.session,
      state: "DEDUPLICATED",
    });
    await expect(service.create({ ...input, packageName: "com.example.other" })).rejects.toThrow(
      "different payload",
    );
    const preflight = await service.preflight(created.session.id);
    expect(preflight.state).toBe("PREFLIGHT");
    expect(preflightProbe.check).toHaveBeenCalledWith({ serial, packageName: input.packageName });
    const started = await service.start(created.session.id);
    expect(started.state).toBe("RUNNING");
    const action = await service.submitAction(created.session.id, "session-1", {
      clientRequestId: "action-1",
      type: "tap",
      payload: { kind: "tap", x: 0.5, y: 0.5 },
      sourceMetricsEpoch: 1,
    });
    expect(action.state).toBe("CREATED");
    expect(action.action.targets).toEqual([{ serial, state: "QUEUED" }]);
    await expect(service.start(created.session.id)).rejects.toThrow("PREFLIGHT");
    expect(database.prepare("SELECT COUNT(*) AS count FROM test_runs").get()).toEqual({ count: 1 });
  });

  it("rejects an offline device before creating a run", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'OFFLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const service = new RuntimeSessionRouteService(database, {
      get: () => ({ state: "OFFLINE" }),
    } as never);
    await expect(
      service.create({
        clientRequestId: "request-offline",
        packageName: "com.example.game",
        deviceSerial: serial,
        leaderVideoEnabled: true,
        actorSessionId: "session-1",
      }),
    ).rejects.toThrow("online");
  });

  it("persists the selected bridge mode and passes it to managed workers", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at)
         VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const workerCoordinator = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const actionDispatcher = {
      dispatch: vi.fn(async (input: { readonly actionId: string }) => ({
        id: input.actionId,
        runId: "run-bridge-mode",
        clientRequestId: "bridge-mode-action",
        actionSeq: 1,
        type: "tap" as const,
        command: { type: "tap" as const, x: 0.5, y: 0.5 },
        payload: { kind: "tap" as const, x: 0.5, y: 0.5 },
        sourceMetricsEpoch: 1,
        state: "SUCCEEDED" as const,
        targets: [{ serial, state: "SUCCEEDED" as const }],
      })),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      undefined,
      actionDispatcher,
      workerCoordinator,
    );
    const input = {
      clientRequestId: "bridge-mode-request",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: false,
      bridgeMode: "APPIUM_ONLY" as const,
      actorSessionId: "session-bridge-mode",
    };

    const created = await service.create(input);
    expect(created.session.bridgeMode).toBe("APPIUM_ONLY");
    expect(
      database.prepare("SELECT bridge_mode FROM test_runs WHERE id = ?").get(created.session.id),
    ).toEqual({ bridge_mode: "APPIUM_ONLY" });
    expect((await service.create(input)).session).toEqual(created.session);

    await service.preflight(created.session.id);
    await service.start(created.session.id);
    const stored = database
      .prepare("SELECT run_nonce_hash FROM test_runs WHERE id = ?")
      .get(created.session.id) as { run_nonce_hash: string };
    expect(workerCoordinator.start).toHaveBeenCalledWith(
      created.session.id,
      [serial],
      input.packageName,
      `sha256:${stored.run_nonce_hash}`,
      "APPIUM_ONLY",
    );

    await service.submitAction(created.session.id, "session-bridge-mode", {
      clientRequestId: "bridge-mode-action",
      type: "tap",
      payload: { kind: "tap", x: 0.5, y: 0.5 },
      sourceMetricsEpoch: 1,
    });
    expect(actionDispatcher.dispatch).toHaveBeenCalledWith({
      actionId: expect.any(String),
      packageName: input.packageName,
      bridgeMode: "APPIUM_ONLY",
    });
  });

  it("dispatches a newly created action when an executor is configured", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const repository = new RunActionRepository(database);
    const dispatcher = {
      dispatch: vi.fn(async ({ actionId }: { readonly actionId: string }): Promise<ActionView> => {
        const action = repository.get(actionId);
        if (action === undefined) throw new Error("Action not found in test dispatcher.");
        return {
          ...action,
          state: "SUCCEEDED",
          targets: action.targets.map((target) => ({ ...target, state: "SUCCEEDED" })),
        };
      }),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      repository,
      dispatcher,
    );
    const created = await service.create({
      clientRequestId: "request-dispatcher",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);
    const result = await service.submitAction(created.session.id, "session-1", {
      clientRequestId: "action-dispatcher",
      type: "tap",
      payload: { kind: "tap", x: 0.5, y: 0.5 },
      sourceMetricsEpoch: 1,
    });

    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      actionId: result.action.id,
      packageName: "com.example.game",
      bridgeMode: "REQUIRED",
    });
    expect(result.action.state).toBe("SUCCEEDED");
  });

  it("passes a lifecycle command from the session service into persistence and dispatch", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const repository = new RunActionRepository(database);
    const dispatcher = {
      dispatch: vi.fn(async () => {
        throw new Error("stop-after-persistence");
      }),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      repository,
      dispatcher,
    );
    const created = await service.create({
      clientRequestId: "request-command-session",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);

    await expect(
      service.submitAction(created.session.id, "session-1", {
        clientRequestId: "action-command-session",
        type: "restart",
        command: { type: "restart" },
        sourceMetricsEpoch: 1,
      }),
    ).rejects.toThrow("stop-after-persistence");
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const action = repository.get(
      (
        database
          .prepare("SELECT id FROM actions WHERE client_request_id = ?")
          .get("action-command-session") as { id: string }
      ).id,
    );
    expect(action).toMatchObject({ type: "restart", command: { type: "restart" } });
  });

  it("creates a variable-size session with a leader and follower members", async () => {
    const database = await createDatabase();
    const serials = [parseDeviceSerial("R5CX211TXNT"), parseDeviceSerial("R5CRC342PRF")];
    for (const serial of serials) {
      database
        .prepare(
          `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
        )
        .run(serial, "now", "now", "now", "now");
    }
    const preflightProbe = { check: vi.fn(async () => undefined) };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      preflightProbe,
    );

    const created = await service.create({
      clientRequestId: "request-two-devices",
      packageName: "com.example.game",
      deviceSerials: serials,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });

    expect(created.session.devices).toMatchObject([
      { serial: serials[0], role: "LEADER" },
      { serial: serials[1], role: "FOLLOWER" },
    ]);
    await service.preflight(created.session.id);
    expect(preflightProbe.check).toHaveBeenNthCalledWith(1, {
      serial: serials[0],
      packageName: "com.example.game",
    });
    expect(preflightProbe.check).toHaveBeenNthCalledWith(2, {
      serial: serials[1],
      packageName: "com.example.game",
    });
    const started = await service.start(created.session.id);
    expect(started.devices).toHaveLength(2);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM run_devices WHERE run_id = ?")
        .get(created.session.id),
    ).toEqual({ count: 2 });
  });

  it("starts managed workers before committing RUNNING", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const coordinator = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    const created = await service.create({
      clientRequestId: "request-worker-start",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    const started = await service.start(created.session.id);
    expect(started.state).toBe("RUNNING");
    expect(coordinator.start).toHaveBeenCalledWith(
      created.session.id,
      [serial],
      "com.example.game",
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      "REQUIRED",
    );
  });

  it("keeps PREFLIGHT when managed worker startup fails", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const coordinator = {
      start: vi.fn(async () => {
        throw new Error("worker start failed");
      }),
      stop: vi.fn(async () => undefined),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    const created = await service.create({
      clientRequestId: "request-worker-fail",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await expect(service.start(created.session.id)).rejects.toThrow("worker start failed");
    expect(service.get(created.session.id)?.state).toBe("PREFLIGHT");
    expect(coordinator.stop).not.toHaveBeenCalled();
  });

  it("completes a running session, fences workers, and starts report finalization", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const coordinator = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    const finalization = {
      startFinalization: vi.fn(async () => ({
        runId: "run-complete",
        state: "FINALIZING" as const,
        attempt: 1,
        startedAt: "now",
        updatedAt: "now",
      })),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      undefined,
      undefined,
      coordinator,
      undefined,
      finalization,
    );
    const created = await service.create({
      clientRequestId: "request-complete",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);

    const completed = await service.complete(created.session.id, {
      state: "FINISHED",
      reason: "operator-finished",
    });

    expect(completed.state).toBe("FINISHED");
    expect(coordinator.stop).toHaveBeenCalledWith(created.session.id);
    expect(finalization.startFinalization).toHaveBeenCalledWith(created.session.id);
    expect(
      database
        .prepare(
          "SELECT from_state, to_state, reason FROM run_transitions WHERE run_id = ? ORDER BY id DESC LIMIT 1",
        )
        .get(created.session.id),
    ).toEqual({
      from_state: "RUNNING",
      to_state: "FINISHED",
      reason: "SESSION_COMPLETED:operator-finished",
    });
  });

  it("starts and finalizes leader video around the session lifecycle", async () => {
    const database = await createDatabase();
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(serial, "now", "now", "now", "now");
    const coordinator = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    const videoRecorder = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const service = new RuntimeSessionRouteService(
      database,
      { get: () => ({ state: "ONLINE" }) } as never,
      undefined,
      undefined,
      undefined,
      coordinator,
      undefined,
      undefined,
      videoRecorder,
    );
    const created = await service.create({
      clientRequestId: "request-video-lifecycle",
      packageName: "com.example.game",
      deviceSerial: serial,
      leaderVideoEnabled: true,
      actorSessionId: "session-1",
    });
    await service.preflight(created.session.id);
    await service.start(created.session.id);
    await service.complete(created.session.id, {
      state: "FINISHED",
      reason: "operator-finished",
    });

    expect(videoRecorder.start).toHaveBeenCalledWith({
      runId: created.session.id,
      serial,
      enabled: true,
    });
    expect(videoRecorder.stop).toHaveBeenCalledWith(created.session.id);
  });
});

async function createDatabase(): Promise<Database.Database> {
  const projectRoot = win32.normalize(process.cwd());
  const paths = createRuntimePaths(
    projectRoot,
    win32.join(projectRoot, "data", "tests", `session-runtime-${randomUUID()}`),
  );
  roots.push(paths.dataRoot);
  await ensureRuntimeDirectories(paths);
  const database = openDatabase(paths);
  databases.push(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    SESSION_API_MIGRATION,
    ACTION_COMMANDS_MIGRATION,
    RUN_FAILURE_POLICY_MIGRATION,
    SESSION_BRIDGE_MODE_MIGRATION,
  ]);
  return database;
}
