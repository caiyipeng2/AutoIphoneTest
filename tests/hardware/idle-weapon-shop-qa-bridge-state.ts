import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { win32 } from "node:path";

import {
  BridgeClient,
  BridgeProtocolParser,
  ClockCalibrator,
  createTcpBridgeTransport,
  type BridgeMessage,
} from "@test-center/bridge";
import { AdbClient } from "@test-center/adb";
import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { parseDeviceSerial } from "@test-center/contracts/device";

const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serial = parseDeviceSerial(process.env.TEST_CENTER_DEVICE_SERIAL ?? "R5CX211TXNT");
const packageName = parseAndroidPackageName(
  process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.qa",
);
const adbPath = win32.normalize(
  process.env.TEST_CENTER_ADB_PATH ??
    "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe",
);
const hostPort = Number(process.env.TEST_CENTER_BRIDGE_HOST_PORT ?? "18102");
const devicePort = Number(process.env.TEST_CENTER_BRIDGE_DEVICE_PORT ?? "17501");
const activityName = process.env.TEST_CENTER_ACTIVITY ?? "com.unity3d.player.UnityPlayerActivity";
const evidenceRoot = win32.normalize(
  process.env.TEST_CENTER_EVIDENCE_DIR ?? win32.join(projectRoot, "data", "milestones"),
);

const messages: BridgeMessage[] = [];
let forwardAdded = false;
let client: BridgeClient | undefined;

try {
  const adb = new AdbClient({ adbPath, cwd: projectRoot, timeoutMs: 30_000 });
  const forward = await adb.execute({ kind: "forwardAdd", serial, hostPort, devicePort });
  if (forward.exitCode !== 0 || forward.timedOut) {
    throw new Error(`ADB forward failed: ${forward.stderr || forward.stdout}`);
  }
  forwardAdded = true;

  const started = await adb.execute({ kind: "startActivity", serial, packageName, activityName });
  if (started.exitCode !== 0 || started.timedOut) {
    throw new Error(`QA package activity failed to start: ${started.stderr || started.stdout}`);
  }

  client = new BridgeClient({
    transport: createTcpBridgeTransport({ port: hostPort, connectTimeoutMs: 8_000 }),
    parser: new BridgeProtocolParser({ nowRealtimeMs: () => performance.now() }),
    handshakeTimeoutMs: 15_000,
  });
  client.onMessage((message) => messages.push(message));
  await client.connect();

  const calibration = await new ClockCalibrator(client, {
    sampleCount: 9,
    pingTimeoutMs: 1_000,
  }).calibrate();
  await waitForStates(messages, 3);
  const snapshot = client.getSnapshot();
  if (snapshot.status !== "ready" || snapshot.hello === undefined || snapshot.state === undefined) {
    throw new Error(`QA bridge did not reach ready state: ${JSON.stringify(snapshot)}`);
  }

  const evidence = {
    schemaVersion: 1,
    status: "PASS",
    completedAt: new Date().toISOString(),
    device: { serial, packageName, activityName },
    bridge: {
      status: snapshot.status,
      bridgeInstanceId: snapshot.hello.bridgeInstanceId,
      bootId: snapshot.hello.bootId,
      buildId: snapshot.hello.buildId,
      uid: snapshot.state.uid,
      installGeneration: snapshot.state.installGeneration,
      appDataGeneration: snapshot.state.appDataGeneration,
      view: snapshot.state.view,
      focusedControlId: snapshot.state.focusedControlId ?? null,
      metricsEpoch: snapshot.state.metricsEpoch,
      stateSeqFirst: snapshot.state.stateSeq,
      stateSeqLast: messages.filter((message) => message.type === "QA_STATE").at(-1)?.stateSeq,
      safeArea: snapshot.state.safeArea,
      orientation: snapshot.state.orientation,
    },
    calibration: {
      sampleCount: calibration.samples.length,
      selectedRttMs: calibration.selectedSample.rttMs,
      uncertaintyMs: calibration.uncertaintyMs,
      offsetMs: calibration.offsetMs,
    },
    messages: {
      helloCount: messages.filter((message) => message.type === "QA_HELLO").length,
      stateCount: messages.filter((message) => message.type === "QA_STATE").length,
      pongCount: messages.filter((message) => message.type === "QA_PONG").length,
    },
    safety: "state/clock observation only; no gameplay input was injected",
  };
  await mkdir(evidenceRoot, { recursive: true });
  const evidencePath = win32.join(evidenceRoot, `idle-weapon-shop-qa-bridge-${Date.now()}.json`);
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
  await client?.close().catch(() => undefined);
  if (forwardAdded) {
    const adb = new AdbClient({ adbPath, cwd: projectRoot, timeoutMs: 30_000 });
    await adb.execute({ kind: "forwardRemove", serial, hostPort }).catch(() => undefined);
  }
}

async function waitForStates(received: readonly BridgeMessage[], count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (received.filter((message) => message.type === "QA_STATE").length < count) {
    if (Date.now() >= deadline) {
      throw new Error(`Expected ${count} QA_STATE messages before timeout.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
