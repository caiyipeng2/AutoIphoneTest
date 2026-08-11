import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import {
  configureDatabase,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
  RUN_ACTIONS_MIGRATION,
  SESSION_API_MIGRATION,
} from "../packages/database/dist/index.js";
import {
  ActionDispatcher,
  ActionOutbox,
  AppiumActionExecutor,
  AppiumPreflightProbe,
  RunActionRepository,
} from "../packages/sessions/dist/index.js";
import { RuntimeSessionRouteService } from "../apps/server/dist/session-runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serial = process.env.ANDROID_SERIAL ?? "R5CX211TXNT";
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const baseUrl = process.env.TEST_CENTER_APPIUM_URL ?? "http://127.0.0.1:4723";
const systemPort = Number(process.env.TEST_CENTER_APPIUM_SYSTEM_PORT ?? 8201);
const mjpegServerPort = Number(process.env.TEST_CENTER_APPIUM_MJPEG_PORT ?? 7811);
const clientRequestId = `hardware-session-${Date.now()}`;
const actionRequestId = `hardware-action-${Date.now()}`;
const runId = `m6-session-action-${Date.now()}`;
const runRoot = path.join(projectRoot, "data", "runs", runId);
const acceptancePath = path.join(runRoot, "acceptance.json");
const viewport = readViewport(serial);
const database = new Database(":memory:");
configureDatabase(database);
migrate(database, [
  FOUNDATION_MIGRATION,
  DEVICES_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  SESSION_API_MIGRATION,
]);
database
  .prepare(
    `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
  )
  .run(serial, "now", "now", "now", "now");

await mkdir(runRoot, { recursive: true });
const startedAt = new Date().toISOString();
let evidence;
try {
  const repository = new RunActionRepository(database);
  const outbox = new ActionOutbox(database);
  const dispatcher = new ActionDispatcher(
    repository,
    outbox,
    () => new AppiumActionExecutor({ baseUrl, systemPort, mjpegServerPort, viewport }),
    `hardware-acceptance-${process.pid}`,
  );
  const registry = { get: () => ({ state: "ONLINE" }) };
  const probe = new AppiumPreflightProbe({ baseUrl, systemPort, mjpegServerPort });
  const service = new RuntimeSessionRouteService(database, registry, probe, repository, dispatcher);
  const created = await service.create({
    clientRequestId,
    packageName,
    deviceSerial: serial,
    leaderVideoEnabled: true,
    actorSessionId: "hardware-acceptance",
  });
  const preflight = await service.preflight(created.session.id);
  const started = await service.start(created.session.id);
  const action = await service.submitAction(created.session.id, "hardware-acceptance", {
    clientRequestId: actionRequestId,
    type: "tap",
    payload: { kind: "tap", x: 0.5, y: 0.5 },
    sourceMetricsEpoch: started.currentEpoch,
    sourceFrameId: `hardware-frame-${Date.now()}`,
  });
  const resultRows = database
    .prepare(
      "SELECT action_id, serial, state, result_json FROM device_action_results WHERE action_id = ?",
    )
    .all(action.action.id);
  const outboxRow = database
    .prepare("SELECT action_id, state, attempt_count FROM action_outbox WHERE action_id = ?")
    .get(action.action.id);
  evidence = {
    schemaVersion: 1,
    runId,
    serial,
    packageName,
    packageDisplayName: "Idle Weapon Shop Tycoon",
    session: {
      id: created.session.id,
      createdState: created.state,
      preflightState: preflight.state,
      startedState: started.state,
    },
    action: {
      id: action.action.id,
      requestId: actionRequestId,
      state: action.action.state,
      targets: action.action.targets,
    },
    deviceActionResults: resultRows,
    outbox: outboxRow,
    viewport,
    appium: { baseUrl, systemPort, mjpegServerPort },
    startedAt,
    completedAt: new Date().toISOString(),
    passed:
      preflight.state === "PREFLIGHT" &&
      started.state === "RUNNING" &&
      action.action.state === "SUCCEEDED" &&
      resultRows.length === 1 &&
      resultRows[0].state === "SUCCEEDED" &&
      outboxRow?.state === "ACKED",
    acceptancePath,
  };
} catch (cause) {
  evidence = {
    schemaVersion: 1,
    runId,
    serial,
    packageName,
    packageDisplayName: "Idle Weapon Shop Tycoon",
    viewport,
    appium: { baseUrl, systemPort, mjpegServerPort },
    startedAt,
    completedAt: new Date().toISOString(),
    passed: false,
    error: cause instanceof Error ? cause.message : String(cause),
    acceptancePath,
  };
} finally {
  database.close();
}

await writeFile(acceptancePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.passed) process.exitCode = 1;

function readViewport(deviceSerial) {
  const adbPath =
    process.env.TEST_CENTER_ADB_PATH ??
    "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
  const result = spawnSync(adbPath, ["-s", deviceSerial, "shell", "wm", "size"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const match = result.stdout.match(/(?:Physical size|Override size):\s*(\d+)x(\d+)/i);
  if (match === null) {
    throw new Error(`Could not read device viewport from adb: ${result.stderr.trim()}`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}
