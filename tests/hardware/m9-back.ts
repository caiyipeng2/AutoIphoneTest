import { win32 } from "node:path";

import {
  AppiumService,
  AppiumW3cClient,
  type SessionFence,
} from "../../packages/appium/src/index.js";

const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serial = process.env.TEST_CENTER_DEVICE_SERIAL ?? "192.168.22.73:5555";
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const appiumPort = Number(process.env.TEST_CENTER_M9_BACK_APPIUM_PORT ?? 4724);
const systemPort = Number(process.env.TEST_CENTER_M9_BACK_SYSTEM_PORT ?? 8201);
const mjpegPort = Number(process.env.TEST_CENTER_M9_BACK_MJPEG_PORT ?? 7811);
const adbPort = readOptionalPort(
  process.env.TEST_CENTER_APPIUM_ADB_PORT ?? process.env.TEST_CENTER_ADB_SERVER_PORT,
);
const dataRoot = win32.join(projectRoot, "data", "hardware-m9-back");
const service = new AppiumService({
  executablePath: process.execPath,
  executableArgs: [win32.join(projectRoot, "node_modules", "appium", "build", "lib", "main.js")],
  appiumHome: win32.join(projectRoot, "data", "appium-home"),
  port: appiumPort,
  logPath: win32.join(dataRoot, "appium.log"),
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
  const foregroundBefore = await client.currentPackage(fence);
  await client.pressKey(fence, 4);
  const foregroundAfter = await client.currentPackage(fence);
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      serial,
      packageName,
      sessionId: fence.sessionId,
      foregroundBefore,
      foregroundAfter,
      keycode: 4,
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
