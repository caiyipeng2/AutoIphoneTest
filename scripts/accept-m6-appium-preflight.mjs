import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { AppiumPreflightProbe } from "../packages/sessions/dist/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serial = process.env.ANDROID_SERIAL ?? "R5CX211TXNT";
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const baseUrl = process.env.TEST_CENTER_APPIUM_URL ?? "http://127.0.0.1:4723";
const systemPort = Number(process.env.TEST_CENTER_APPIUM_SYSTEM_PORT ?? 8201);
const mjpegServerPort = Number(process.env.TEST_CENTER_APPIUM_MJPEG_PORT ?? 7811);
const appiumLogPath =
  process.env.TEST_CENTER_APPIUM_LOG ??
  path.join(projectRoot, "data", "logs", "appium-m6-preflight.log");
const runId = `m6-appium-preflight-${Date.now()}`;
const runRoot = path.join(projectRoot, "data", "runs", runId);
const acceptancePath = path.join(runRoot, "acceptance.json");
await mkdir(runRoot, { recursive: true });

let error;
const startedAt = new Date().toISOString();
const probe = new AppiumPreflightProbe({ baseUrl, systemPort, mjpegServerPort });
try {
  await probe.check({ serial, packageName });
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
}

const evidence = {
  schemaVersion: 1,
  runId,
  serial,
  packageName,
  appium: { baseUrl, systemPort, mjpegServerPort },
  appiumLogPath,
  startedAt,
  completedAt: new Date().toISOString(),
  passed: error === undefined,
  error,
  acceptancePath,
};
await writeFile(acceptancePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.passed) process.exitCode = 1;
