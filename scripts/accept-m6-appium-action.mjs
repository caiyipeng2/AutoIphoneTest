import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { AppiumActionExecutor } from "../packages/sessions/dist/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serial = process.env.ANDROID_SERIAL ?? "R5CX211TXNT";
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const baseUrl = process.env.TEST_CENTER_APPIUM_URL ?? "http://127.0.0.1:4723";
const systemPort = Number(process.env.TEST_CENTER_APPIUM_SYSTEM_PORT ?? 8201);
const mjpegServerPort = Number(process.env.TEST_CENTER_APPIUM_MJPEG_PORT ?? 7811);
const actionKind = process.env.TEST_CENTER_ACTION_KIND ?? "tap";
const runId = `m6-appium-action-${Date.now()}`;
const runRoot = path.join(projectRoot, "data", "runs", runId);
const acceptancePath = path.join(runRoot, "acceptance.json");
await mkdir(runRoot, { recursive: true });

const viewport = readViewport(serial);
const payload =
  actionKind === "swipe"
    ? {
        kind: "swipe",
        path: [
          [0.5, 0.4],
          [0.5, 0.45],
        ],
        durationMs: 300,
      }
    : { kind: "tap", x: 0.5, y: 0.5 };
const startedAt = new Date().toISOString();
let result;
let error;
try {
  const executor = new AppiumActionExecutor({
    baseUrl,
    systemPort,
    mjpegServerPort,
    viewport,
  });
  result = await executor.execute({ serial, packageName, payload });
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
}

const evidence = {
  schemaVersion: 1,
  runId,
  serial,
  packageName,
  action: { kind: actionKind, payload },
  viewport,
  appium: { baseUrl, systemPort, mjpegServerPort },
  startedAt,
  completedAt: new Date().toISOString(),
  passed: error === undefined,
  result,
  error,
  acceptancePath,
};
await writeFile(acceptancePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.passed) process.exitCode = 1;

function readViewport(deviceSerial) {
  const adbPath = process.env.TEST_CENTER_ADB_PATH ?? "D:\\ADB\\platform-tools\\adb.exe";
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
