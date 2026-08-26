import { win32 } from "node:path";

import {
  AppiumService,
  AppiumW3cClient,
  type SessionFence,
} from "../../packages/appium/src/index.js";
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
  cwd: projectRoot,
});
const client = new AppiumW3cClient({
  baseUrl: `http://127.0.0.1:${String(appiumPort)}`,
  serial,
  generation: 1,
});

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
  const viewport = { width: 1080, height: 2340 };
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
