/* global process, console, URL, Buffer */
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createRuntimeDeviceRegistry } from "../apps/server/dist/device-runtime.js";

const projectRoot = new URL("..", import.meta.url).pathname
  .replace(/^\//, "")
  .replaceAll("/", "\\");
const serial = process.env.TEST_CENTER_DEVICE_SERIAL ?? "192.168.22.73:5555";
const packageName = process.env.TEST_CENTER_GAME_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const adbPath =
  process.env.TEST_CENTER_ADB_PATH ??
  "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
const evidenceRoot = win32.join(projectRoot, "data", "hardware-m11-runtime-screenshot-fallback");
const dataRoot = win32.join(evidenceRoot, "runtime-data");
const invalidServerPath = win32.join(evidenceRoot, "invalid-scrcpy-server");
const evidencePath = win32.join(evidenceRoot, "runtime-screenshot-fallback.json");

process.env.TEST_CENTER_DATA_ROOT = dataRoot;
process.env.TEST_CENTER_ADB_PATH = adbPath;
process.env.TEST_CENTER_APPIUM_NODE = process.execPath;
process.env.TEST_CENTER_APPIUM_ENTRY = win32.join(
  projectRoot,
  "node_modules",
  "appium",
  "build",
  "lib",
  "main.js",
);
process.env.TEST_CENTER_APPIUM_HOME = win32.join(projectRoot, "data", "appium-home");
process.env.TEST_CENTER_APPIUM_READINESS_TIMEOUT_MS = "90000";
process.env.TEST_CENTER_SCRCPY_SERVER_PATH = invalidServerPath;
process.env.TEST_CENTER_BRIDGE_MODE = "appium_only";

await mkdir(evidenceRoot, { recursive: true });
await writeFile(invalidServerPath, Buffer.from("invalid scrcpy fixture\n"));

let runtime;
let sessionId;
let failure;
let finalSessionState;
const evidence = {
  schemaVersion: 1,
  serial,
  packageName,
  provider: {},
  session: {},
  frame: {},
  video: {},
  cleanup: {},
};

try {
  runtime = await createRuntimeDeviceRegistry(projectRoot);
  await runtime.registry.poll();
  const device = runtime.registry
    .list()
    .find((candidate) => candidate.serial === serial && candidate.state === "ONLINE");
  if (device === undefined) throw new Error(`Online device not found: ${serial}.`);

  const created = await runtime.sessionService.create({
    clientRequestId: `m11-runtime-screenshot-fallback-${String(Date.now())}`,
    packageName,
    deviceSerials: [device.serial],
    leaderVideoEnabled: true,
    failurePolicy: "PAUSE_ALL",
  });
  sessionId = created.session.id;
  await runtime.sessionService.preflight(sessionId);
  const running = await runtime.sessionService.start(sessionId);
  evidence.session = { runId: running.id, state: running.state };

  const provider = runtime.videoCoordinator?.providers.get(device.serial);
  if (provider === undefined) throw new Error("Configured runtime video provider is unavailable.");
  await provider.start();
  const frame = provider.getLatestFrame();
  if (frame === undefined) throw new Error("Screenshot fallback did not publish a frame.");
  evidence.provider = {
    kind: provider.kind,
    degraded: provider.degraded,
    state: provider.state,
  };
  evidence.frame = {
    frameId: frame.frameId,
    provider: frame.provider,
    degraded: frame.degraded,
    degradedReason: frame.degradedReason,
    format: frame.format,
    width: frame.width,
    height: frame.height,
    byteSize: frame.data.byteLength,
  };
  await delay(3_000);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (runtime !== undefined && sessionId !== undefined) {
    const session = runtime.sessionService.get(sessionId);
    if (session?.state === "RUNNING" || session?.state === "PAUSED") {
      await runtime.sessionService
        .complete(sessionId, { state: "FINISHED", reason: "M11_SCREENSHOT_FALLBACK_SMOKE" })
        .catch(() => undefined);
    }
    finalSessionState = runtime.sessionService.get(sessionId)?.state;
  }
  if (runtime !== undefined) await runtime.close().catch(() => undefined);
  if (sessionId !== undefined) {
    const videoPath = win32.join(dataRoot, "runs", sessionId, "video", "leader.mp4");
    try {
      const video = await stat(videoPath);
      evidence.video = { path: videoPath, exists: video.isFile(), sizeBytes: video.size };
      if (!video.isFile() || video.size <= 0) failure ??= "Leader video recording is empty.";
    } catch {
      evidence.video = { path: videoPath, exists: false, sizeBytes: 0 };
      failure ??= "Leader video recording was not published.";
    }
  }
  await rm(invalidServerPath, { force: true });
  evidence.cleanup = {
    runtimeClosed: runtime !== undefined,
    invalidServerRemoved: true,
    ...(finalSessionState === undefined ? {} : { finalSessionState }),
  };
  if (failure !== undefined) evidence.error = failure;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ evidencePath, ...evidence }, null, 2));
if (failure !== undefined) process.exitCode = 1;
