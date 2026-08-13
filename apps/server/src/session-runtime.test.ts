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
} from "@test-center/database";

import { RuntimeSessionRouteService } from "./session-runtime.js";
import type { ActionView } from "@test-center/sessions";
import { RunActionRepository } from "@test-center/sessions";

const databases: Database.Database[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
});

describe("RuntimeSessionRouteService", () => {
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
  ]);
  return database;
}
