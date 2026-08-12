import { win32 } from "node:path";

import {
  AppiumService,
  AppiumW3cClient,
  type SessionFence,
} from "../../packages/appium/src/index.js";

const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serial = process.env.TEST_CENTER_DEVICE_SERIAL ?? "192.168.22.73:5555";
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const appiumPort = Number(process.env.TEST_CENTER_M9_ACTIVATE_APPIUM_PORT ?? 4725);
const systemPort = Number(process.env.TEST_CENTER_M9_ACTIVATE_SYSTEM_PORT ?? 8202);
const mjpegPort = Number(process.env.TEST_CENTER_M9_ACTIVATE_MJPEG_PORT ?? 7812);
const dataRoot = win32.join(projectRoot, "data", "hardware-m9-activate");
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
    noReset: true,
    newCommandTimeout: 60,
  });
  await client.activateApp(fence, packageName);
  const foregroundPackage = await waitForPackage(client, fence, packageName);
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      serial,
      packageName,
      sessionId: fence.sessionId,
      foregroundPackage,
      pointerActionsSent: 0,
      appiumPort,
      systemPort,
      mjpegPort,
    })}\n`,
  );
} finally {
  if (fence !== undefined) await client.deleteSession(fence).catch(() => undefined);
  await service.stop().catch(() => undefined);
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
