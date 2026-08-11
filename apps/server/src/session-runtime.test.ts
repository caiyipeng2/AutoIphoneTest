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
} from "@test-center/database";

import { RuntimeSessionRouteService } from "./session-runtime.js";

const databases: Database.Database[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
});

describe("RuntimeSessionRouteService", () => {
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
  ]);
  return database;
}
