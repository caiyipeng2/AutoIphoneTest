import { win32 } from "node:path";

import { AdbClient } from "../../packages/adb/src/index.js";
import {
  AppiumService,
  AppiumW3cClient,
  type SessionFence,
} from "../../packages/appium/src/index.js";
import { parseDeviceSerial } from "../../packages/contracts/src/device.js";
import { createCommandPointerActions } from "../../packages/sessions/src/appium-action.js";

const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serial = process.env.TEST_CENTER_DEVICE_SERIAL ?? "192.168.22.73:5555";
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const appiumPort = Number(process.env.TEST_CENTER_M9_APPIUM_PORT ?? 4723);
const systemPort = Number(process.env.TEST_CENTER_M9_SYSTEM_PORT ?? 8200);
const mjpegPort = Number(process.env.TEST_CENTER_M9_MJPEG_PORT ?? 7810);
const adbPort = readOptionalPort(
  process.env.TEST_CENTER_APPIUM_ADB_PORT ?? process.env.TEST_CENTER_ADB_SERVER_PORT,
);
const adbPath = win32.normalize(
  process.env.TEST_CENTER_ADB_PATH ??
    "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe",
);
const adbEnv = createAdbEnvironment(adbPort);
const dataRoot = win32.join(projectRoot, "data", "hardware-m9-longpress-drag");
const logPath = win32.join(dataRoot, "appium.log");
const appiumHome = win32.join(projectRoot, "data", "appium-home");
const appiumEntry = win32.join(projectRoot, "node_modules", "appium", "build", "lib", "main.js");

const service = new AppiumService({
  executablePath: process.execPath,
  executableArgs: [appiumEntry],
  appiumHome,
  port: appiumPort,
  logPath,
  readinessTimeoutMs: 60_000,
  cwd: projectRoot,
});
const client = new AppiumW3cClient({
  baseUrl: `http://127.0.0.1:${String(appiumPort)}`,
  serial,
  generation: 1,
});
const adb = new AdbClient({ adbPath, cwd: projectRoot, env: adbEnv, timeoutMs: 30_000 });

let fence: SessionFence | undefined;
try {
  await service.start();
  fence = await client.createSession({
    platformName: "Android",
    automationName: "UiAutomator2",
    udid: serial,
    systemPort,
    mjpegServerPort: mjpegPort,
    ...(adbPort === undefined ? {} : { adbPort }),
    ...(adbPort === undefined ? {} : { suppressKillServer: true }),
    noReset: true,
    newCommandTimeout: 60,
  });
  await client.activateApp(fence, packageName);
  const foregroundPackage = await waitForPackage(client, fence, packageName);
  const size = await adb.execute({ kind: "wmSize", serial: parseDeviceSerial(serial) });
  if (size.exitCode !== 0 || size.timedOut) {
    throw new Error(`ADB wm size failed: ${size.stderr || size.stdout}`);
  }
  const viewport = parseViewport(size.stdout);
  const longPress = createCommandPointerActions(
    { type: "longPress", x: 0.5, y: 0.5, durationMs: 300 },
    viewport,
  );
  const drag = createCommandPointerActions(
    {
      type: "drag",
      path: [
        [0.25, 0.5],
        [0.5, 0.5],
        [0.75, 0.5],
      ],
      durationMs: 501,
    },
    viewport,
  );
  await client.performActions(fence, longPress);
  await client.performActions(fence, drag);
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      serial,
      packageName,
      sessionId: fence.sessionId,
      foregroundPackage,
      longPressActions: longPress[0]?.actions.length ?? 0,
      dragActions: drag[0]?.actions.length ?? 0,
      appiumPort,
      systemPort,
      mjpegPort,
    })}\n`,
  );
} finally {
  if (fence !== undefined) await client.deleteSession(fence).catch(() => undefined);
  await service.stop().catch(() => undefined);
}

function readOptionalPort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`Invalid Appium ADB port: ${value}.`);
  }
  return parsed;
}

function parseViewport(output: string): { readonly width: number; readonly height: number } {
  const match = output.match(/(\d+)x(\d+)/);
  if (match === null) throw new Error(`Unable to parse device viewport from wm size: ${output}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2) {
    throw new Error(`Invalid device viewport from wm size: ${output}`);
  }
  return { width, height };
}

function createAdbEnvironment(port: number | undefined): NodeJS.ProcessEnv {
  if (port === undefined) return process.env;
  return {
    ...process.env,
    ADB_SERVER_SOCKET: `tcp:127.0.0.1:${String(port)}`,
    ANDROID_ADB_SERVER_PORT: String(port),
  };
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
  if (current !== expectedPackage) {
    throw new Error(`Foreground package mismatch: ${current}.`);
  }
  return current;
}
