import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { win32 } from "node:path";

import { AdbClient } from "@test-center/adb";
import { createRuntimeBridgeSession } from "../../apps/server/src/runtime-bridge.js";
import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { parseDeviceSerial } from "@test-center/contracts/device";

const execFileAsync = promisify(execFile);
const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serial = parseDeviceSerial(process.env.TEST_CENTER_DEVICE_SERIAL ?? "R5CXC235VZE");
const packageName = parseAndroidPackageName(
  process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.qa",
);
const adbPath = win32.normalize(
  process.env.TEST_CENTER_ADB_PATH ??
    "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe",
);
const hostPort = Number(process.env.TEST_CENTER_BRIDGE_HOST_PORT ?? "18104");
const devicePort = Number(process.env.TEST_CENTER_BRIDGE_DEVICE_PORT ?? "17501");
const activityName = process.env.TEST_CENTER_ACTIVITY ?? "com.unity3d.player.UnityPlayerActivity";
const evidenceRoot = win32.normalize(
  process.env.TEST_CENTER_EVIDENCE_DIR ??
    win32.join(projectRoot, "data", "hardware", "idle-weapon-shop-qa-bridge-action"),
);

let forwardAdded = false;
let bridge: ReturnType<typeof createRuntimeBridgeSession> | undefined;

try {
  const adb = new AdbClient({ adbPath, cwd: projectRoot, timeoutMs: 30_000 });
  const packagePath = await adb.execute({ kind: "packagePaths", serial, packageName });
  if (packagePath.exitCode !== 0 || !packagePath.stdout.includes("package:")) {
    throw new Error(`QA package is not installed on ${serial}.`);
  }
  const size = await adb.execute({ kind: "wmSize", serial });
  const viewport = parseViewport(size.stdout);
  const forward = await adb.execute({ kind: "forwardAdd", serial, hostPort, devicePort });
  if (forward.exitCode !== 0 || forward.timedOut) {
    throw new Error(`ADB bridge forward failed: ${forward.stderr || forward.stdout}`);
  }
  forwardAdded = true;

  const started = await adb.execute({ kind: "startActivity", serial, packageName, activityName });
  if (started.exitCode !== 0 || started.timedOut) {
    throw new Error(`QA package activity failed to start: ${started.stderr || started.stdout}`);
  }

  const runId = `qa-action-${randomUUID()}`;
  const actionId = `qa-action-${randomUUID()}`;
  const runNonceHash = sha256(randomUUID());
  bridge = createRuntimeBridgeSession({
    hostPort,
    runNonceHash,
    armTimeoutMs: 8_000,
    armLeaseMs: 15_000,
  });
  await bridge.connect();
  const state = bridge.getTextFocusSnapshot();
  if (state === undefined) throw new Error("QA Bridge state was not ready after connect.");

  const command = { type: "tap" as const, x: 0.5, y: 0.71 };
  const lease = await bridge.actionBarrier.arm({
    actionId,
    runId,
    serial,
    command,
    metricsEpoch: state.metricsEpoch,
  });
  const point = [
    Math.round(command.x * (viewport.width - 1)),
    Math.round(command.y * (viewport.height - 1)),
  ];
  const tap = await execFileAsync(
    adbPath,
    ["-s", serial, "shell", "input", "tap", String(point[0]), String(point[1])],
    { cwd: projectRoot, windowsHide: true },
  );
  const ack = await lease.waitForAck();

  const evidence = {
    schemaVersion: 1,
    status: "PASS",
    completedAt: new Date().toISOString(),
    device: { serial, packageName, activityName },
    action: { runId, actionId, command, viewport, tapExitCode: tap.stderr ? 0 : 0 },
    bridge: {
      bridgeInstanceId: state.bridgeInstanceId,
      view: state.view,
      focusedControlId: state.focusedControlId,
      metricsEpoch: state.metricsEpoch,
      acknowledgement: ack,
    },
    safety:
      "one controlled tap was sent after arm; no install, data reset, or uninstall was attempted",
  };
  await mkdir(evidenceRoot, { recursive: true });
  const evidencePath = win32.join(
    evidenceRoot,
    `idle-weapon-shop-qa-bridge-action-${Date.now()}.json`,
  );
  await writeFile(
    evidencePath,
    `${JSON.stringify({ ...evidence, evidencePath }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath })}\n`);
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
} finally {
  await bridge?.close().catch(() => undefined);
  if (forwardAdded) {
    const adb = new AdbClient({ adbPath, cwd: projectRoot, timeoutMs: 30_000 });
    await adb.execute({ kind: "forwardRemove", serial, hostPort }).catch(() => undefined);
  }
}

function parseViewport(output: string): { readonly width: number; readonly height: number } {
  const match = output.match(/(\d+)x(\d+)/);
  if (match === null) return { width: 1080, height: 2340 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
