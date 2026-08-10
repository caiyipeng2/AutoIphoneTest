import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";

import WebSocket from "ws";

import { AppiumService, AppiumW3cClient } from "../packages/appium/dist/index.js";
import { LogcatStream } from "../packages/adb/dist/index.js";
import { MjpegViewProvider } from "../packages/video/dist/index.js";
import { createApp } from "../apps/server/dist/app.js";

const execFileAsync = promisify(execFile);
const projectRoot = new URL("..", import.meta.url).pathname
  .replace(/^\//, "")
  .replaceAll("/", "\\");
const serial = process.env.TEST_CENTER_DEVICE_SERIAL ?? "R5CX211TXNT";
const packageName = process.env.TEST_CENTER_GAME_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const nodePath = join(projectRoot, "tools", "node", "22.23.1", "node.exe");
const adbPath =
  process.env.TEST_CENTER_ADB_PATH ??
  "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
const appiumCli = join(projectRoot, "node_modules", "appium", "build", "lib", "main.js");
const appiumHome = join(projectRoot, "data", "appium-home");
const runDirectory = join(projectRoot, "data", "runs", `m6-task3-${Date.now()}`);
const appiumPort = 4723;
const systemPort = 8200;
const mjpegPort = 7810;
const gatewayPort = 4783;
const evidencePath = join(runDirectory, "acceptance.json");

await mkdir(runDirectory, { recursive: true });
const dimensions = await readDisplayDimensions();
const segmentEvents = [];
const logcat = new LogcatStream({
  serial,
  adbPath,
  cwd: projectRoot,
  runDirectory: join(runDirectory, "logcat"),
  segmentSink: (event) => segmentEvents.push(event),
});
const service = new AppiumService({
  executablePath: nodePath,
  executableArgs: [appiumCli],
  appiumHome,
  port: appiumPort,
  logPath: join(runDirectory, "appium.log"),
  cwd: projectRoot,
});
const client = new AppiumW3cClient({
  baseUrl: `http://127.0.0.1:${String(appiumPort)}`,
  serial,
  generation: 1,
});
const evidence = {
  schemaVersion: 1,
  serial,
  packageName,
  runDirectory,
  dimensions,
  appium: {},
  input: {},
  screenshot: {},
  gateway: {},
  logcat: {},
};
let fence;
let gatewayApp;
let logcatStarted = false;
let sessionDeleted = false;
let serviceStopped = false;

try {
  const started = await service.start();
  evidence.appium = { port: appiumPort, pid: started.pid, version: started.version };
  await logcat.start();
  logcatStarted = true;
  fence = await client.createSession({
    platformName: "Android",
    automationName: "UiAutomator2",
    udid: serial,
    systemPort,
    mjpegServerPort: mjpegPort,
    noReset: true,
    newCommandTimeout: 60,
  });
  evidence.appium = { ...evidence.appium, sessionId: fence.sessionId };
  const activity = await resolveLauncherActivity();
  await execFileAsync(adbPath, ["-s", serial, "shell", "am", "start", "-n", activity], {
    windowsHide: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await client.terminateApp(fence, packageName).catch(() => undefined);
  await client.activateApp(fence, packageName);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const currentPackage = await client.currentPackage(fence);
  const currentActivity = await client.currentActivity(fence);
  const adbForegroundPackage = await readForegroundPackage();
  if (adbForegroundPackage !== packageName) {
    throw new Error(
      `Target game is not foreground. Expected ${packageName}, received ${adbForegroundPackage}.`,
    );
  }
  evidence.appium = {
    ...evidence.appium,
    launcherActivity: activity,
    currentPackage,
    currentActivity,
    adbForegroundPackage,
  };

  const provider = new MjpegViewProvider({
    serial,
    captureScreenshot: async () => ({
      base64: await client.screenshot(fence),
      width: dimensions.width,
      height: dimensions.height,
    }),
  });
  const frame = await provider.captureOnce();
  evidence.screenshot = {
    frameId: frame.frameId,
    byteSize: frame.data.byteLength,
    width: frame.width,
    height: frame.height,
    degraded: frame.degraded,
    provider: frame.provider,
    degradedReason: frame.degradedReason,
  };

  gatewayApp = await createApp({
    port: gatewayPort,
    bootstrapCode: "m6-task3-gateway-bootstrap",
    launchSecret: "m6-task3-gateway-secret",
    viewProviders: new Map([[serial, provider]]),
  });
  await gatewayApp.listen({ host: "127.0.0.1", port: gatewayPort });
  const exchange = await fetch(`http://127.0.0.1:${String(gatewayPort)}/api/bootstrap/exchange`, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${String(gatewayPort)}`,
      origin: `http://127.0.0.1:${String(gatewayPort)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ code: "m6-task3-gateway-bootstrap" }),
  });
  if (!exchange.ok) throw new Error(`Gateway bootstrap failed with HTTP ${exchange.status}.`);
  const setCookie = exchange.headers.get("set-cookie") ?? "";
  const cookies = [
    /tc_session=[^;]+/.exec(setCookie)?.[0],
    /tc_csrf=[^;]+/.exec(setCookie)?.[0],
  ].filter((cookie) => cookie !== undefined);
  const gatewayFrame = await readGatewayFrame(cookies.join("; "));
  evidence.gateway = {
    port: gatewayPort,
    authenticated: true,
    serial: gatewayFrame.frame.serial,
    frameId: gatewayFrame.frame.frameId,
    degraded: gatewayFrame.frame.degraded,
    provider: gatewayFrame.frame.provider,
    payloadBytes: Buffer.byteLength(JSON.stringify(gatewayFrame), "utf8"),
  };
  await gatewayApp.close();
  gatewayApp = undefined;

  await client.pressKey(fence, 82);
  await client.performActions(fence, [
    {
      type: "pointer",
      id: "acceptance-finger",
      actions: [
        { type: "pointerMove", duration: 0, x: 5, y: 5 },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  evidence.input = { pressKeycode: 82, pointerTap: { x: 5, y: 5 } };
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  evidence.input = { ...evidence.input, adbForegroundPackage: await readForegroundPackage() };
} finally {
  if (gatewayApp !== undefined) await gatewayApp.close().catch(() => undefined);
  if (logcatStarted) await logcat.stop().catch(() => undefined);
  if (fence !== undefined) {
    await client
      .deleteSession(fence)
      .then(() => (sessionDeleted = true))
      .catch(() => undefined);
  }
  await service
    .stop()
    .then(() => (serviceStopped = true))
    .catch(() => undefined);
  evidence.logcat = {
    segmentCount: segmentEvents.length,
    records: segmentEvents.reduce((sum, event) => sum + event.recordCount, 0),
    segments: segmentEvents,
  };
  evidence.cleanup = { sessionDeleted, serviceStopped };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ evidencePath, ...evidence }, null, 2));

async function readDisplayDimensions() {
  const result = await execFileAsync(adbPath, ["-s", serial, "shell", "wm", "size"], {
    windowsHide: true,
  });
  const match = /Physical size:\s*(\d+)x(\d+)/.exec(result.stdout);
  if (match === null) throw new Error(`Unable to parse display dimensions: ${result.stdout}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function resolveLauncherActivity() {
  const result = await execFileAsync(
    adbPath,
    ["-s", serial, "shell", "cmd", "package", "resolve-activity", "--brief", packageName],
    { windowsHide: true },
  );
  const match = result.stdout.match(new RegExp(`${packageName}/[^\\s\\r\\n]+`));
  if (match === null) throw new Error(`Unable to resolve launcher activity for ${packageName}.`);
  return match[0];
}

async function readForegroundPackage() {
  const result = await execFileAsync(
    adbPath,
    ["-s", serial, "shell", "dumpsys", "activity", "activities"],
    { windowsHide: true },
  );
  const match =
    /(?:mResumedActivity|topResumedActivity|ResumedActivity)[=:][^\n]*?\s([\w.]+)\//.exec(
      result.stdout,
    );
  if (match === null) throw new Error("Unable to read foreground Android activity.");
  return match[1];
}

async function readGatewayFrame(cookieHeader) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(gatewayPort)}/ws/video/${serial}`, {
      headers: {
        Cookie: cookieHeader,
        Origin: `http://127.0.0.1:${String(gatewayPort)}`,
      },
    });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for the authenticated video frame."));
    }, 5_000);
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message?.type !== "video.frame") return;
        clearTimeout(timeout);
        socket.close();
        resolve(message);
      } catch (error) {
        clearTimeout(timeout);
        socket.close();
        reject(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
