import { win32 } from "node:path";

import { AdbClient } from "../../packages/adb/src/index.js";
import {
  AppiumService,
  AppiumW3cClient,
  type SessionFence,
} from "../../packages/appium/src/index.js";

const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serial = process.env.TEST_CENTER_DEVICE_SERIAL ?? "192.168.22.73:5555";
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const adbPath =
  process.env.TEST_CENTER_ADB_PATH ??
  "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
const appiumPort = Number(process.env.TEST_CENTER_M9_RESTART_APPIUM_PORT ?? 4727);
const systemPort = Number(process.env.TEST_CENTER_M9_RESTART_SYSTEM_PORT ?? 8204);
const mjpegPort = Number(process.env.TEST_CENTER_M9_RESTART_MJPEG_PORT ?? 7814);
const dataRoot = win32.join(projectRoot, "data", "hardware-m9-restart");
const service = new AppiumService({
  executablePath: process.execPath,
  executableArgs: [win32.join(projectRoot, "node_modules", "appium", "build", "lib", "main.js")],
  appiumHome: win32.join(projectRoot, "data", "appium-home"),
  port: appiumPort,
  logPath: win32.join(dataRoot, "appium.log"),
  readinessTimeoutMs: 60_000,
  cwd: projectRoot,
});
const client = new AppiumW3cClient({
  baseUrl: `http://127.0.0.1:${String(appiumPort)}`,
  serial,
  generation: 1,
});
const adb = new AdbClient({ adbPath, cwd: projectRoot });

let fence: SessionFence | undefined;
try {
  await service.start();
  fence = await client.createSession({
    platformName: "Android",
    automationName: "UiAutomator2",
    udid: serial,
    systemPort,
    mjpegServerPort: mjpegPort,
    noReset: true,
    newCommandTimeout: 60,
  });
  await client.activateApp(fence, packageName);
  await waitForPackage(client, fence, packageName);
  const pidBefore = await readPid();
  if (pidBefore === undefined) throw new Error("Game process did not start before restart.");
  await client.terminateApp(fence, packageName);
  await waitForAbsent();
  await client.activateApp(fence, packageName);
  const foregroundAfter = await waitForPackage(client, fence, packageName);
  const pidAfter = await waitForPid();
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      serial,
      packageName,
      sessionId: fence.sessionId,
      pidBefore,
      pidAfter,
      foregroundAfter,
      appiumPort,
      systemPort,
      mjpegPort,
    })}\n`,
  );
} finally {
  if (fence !== undefined) await client.deleteSession(fence).catch(() => undefined);
  await service.stop().catch(() => undefined);
}

async function readPid(): Promise<string | undefined> {
  const result = await adb.execute({ kind: "packagePid", serial: serial as never, packageName });
  const pid = result.stdout.trim();
  return pid.length === 0 ? undefined : pid;
}

async function waitForPid(): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const pid = await readPid();
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Game process did not return after restart.");
}

async function waitForAbsent(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while ((await readPid()) !== undefined) {
    if (Date.now() >= deadline) throw new Error("Game process did not exit during restart.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForPackage(
  actionClient: AppiumW3cClient,
  sessionFence: SessionFence,
  expectedPackage: string,
): Promise<string> {
  const deadline = Date.now() + 5_000;
  let current = await actionClient.currentPackage(sessionFence);
  while (current !== expectedPackage && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    current = await actionClient.currentPackage(sessionFence);
  }
  if (current !== expectedPackage) throw new Error(`Foreground package mismatch: ${current}.`);
  return current;
}
