import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { win32 } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import { AdbClient } from "@test-center/adb";
import {
  FOUNDATION_MIGRATION,
  DEPLOYMENTS_MIGRATION,
  DEPLOYMENT_CONTROLS_MIGRATION,
  DEVICES_MIGRATION,
  UID_BRIDGE_MIGRATION,
  configureDatabase,
  migrate,
} from "@test-center/database";
import {
  BridgeClient,
  BridgeProtocolParser,
  ClockCalibrator,
  createTcpBridgeTransport,
  type BridgeMessage,
} from "@test-center/bridge";
import { BridgeStateIngestor, UidService } from "@test-center/devices";
import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { parseDeviceSerial } from "@test-center/contracts/device";

const execFileAsync = promisify(execFile);
const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serialText = process.env.TEST_CENTER_DEVICE_SERIAL;
const packageText = process.env.TEST_CENTER_PACKAGE;
const adbPath =
  process.env.TEST_CENTER_ADB_PATH ??
  "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
const hostPort = Number(process.env.TEST_CENTER_BRIDGE_HOST_PORT ?? "18101");
const devicePort = Number(process.env.TEST_CENTER_BRIDGE_DEVICE_PORT ?? "17501");

if (serialText === undefined || packageText === undefined) {
  process.stdout.write(
    "M5_HARDWARE_SKIPPED TEST_CENTER_DEVICE_SERIAL and TEST_CENTER_PACKAGE are required; no install, clear, or launch was attempted.\n",
  );
  process.exitCode = 2;
} else {
  await runAcceptance(parseDeviceSerial(serialText), parseAndroidPackageName(packageText));
}

async function runAcceptance(serial: ReturnType<typeof parseDeviceSerial>, packageName: string) {
  const adb = new AdbClient({ adbPath, cwd: projectRoot, timeoutMs: 30_000 });
  const startedAt = new Date().toISOString();
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    DEPLOYMENTS_MIGRATION,
    DEPLOYMENT_CONTROLS_MIGRATION,
    UID_BRIDGE_MIGRATION,
  ]);
  const uidService = new UidService(database);
  const errors: string[] = [];
  let ingestor: BridgeStateIngestor | undefined;
  let reconnectIngestor: BridgeStateIngestor | undefined;
  let client: BridgeClient | undefined;
  let reconnectClient: BridgeClient | undefined;
  let deviceClockOffsetMs = 0;
  let forwardAdded = false;
  const received: BridgeMessage[] = [];

  try {
    const forward = await adb.execute({ kind: "forwardAdd", serial, hostPort, devicePort });
    if (forward.exitCode !== 0 || forward.timedOut) {
      throw new Error(`adb forward failed: ${forward.stderr || forward.stdout}`);
    }
    forwardAdded = true;

    const source = createClient(
      (message) => received.push(message),
      () => performance.now() + deviceClockOffsetMs,
    );
    client = source.client;
    ingestor = new BridgeStateIngestor({
      serial,
      packageName,
      source: client,
      uidService,
      onError: (error) => errors.push(error.message),
    });
    ingestor.start();
    await client.connect();

    const calibration = await new ClockCalibrator(client, { sampleCount: 9 }).calibrate();
    deviceClockOffsetMs = calibration.offsetMs;
    await waitForStates(received, 9);
    const firstSnapshot = client.getSnapshot();
    const bridge = firstSnapshot.hello;
    if (bridge === undefined || firstSnapshot.state === undefined) {
      throw new Error("Bridge handshake completed without QA_HELLO and QA_STATE.");
    }

    const armEvidence = await exerciseArm(
      adb,
      serial,
      client,
      firstSnapshot.state.metricsEpoch,
      calibration.offsetMs,
    );
    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const reconnect = createClient(
      (message) => received.push(message),
      () => performance.now() + deviceClockOffsetMs,
    );
    reconnectClient = reconnect.client;
    reconnectIngestor = new BridgeStateIngestor({
      serial,
      packageName,
      source: reconnectClient,
      uidService,
      onError: (error) => errors.push(error.message),
    });
    reconnectIngestor.start();
    await reconnectClient.connect();
    const reconnected = reconnectClient.getSnapshot();
    if (reconnected.status !== "ready" || reconnected.hello === undefined) {
      throw new Error("Bridge did not reconnect to ready state.");
    }
    await waitForStates(
      received,
      received.filter((message) => message.type === "QA_STATE").length + 2,
    );

    const snapshot = uidService.get(serial, packageName);
    const completed = armEvidence.armed && armEvidence.acked && armEvidence.rejected;
    const evidence = {
      schemaVersion: 1,
      status:
        errors.length === 0 && completed && snapshot.bridge.status === "READY" ? "PASS" : "FAIL",
      startedAt,
      completedAt: new Date().toISOString(),
      device: { serial, packageName },
      bridge: {
        status: firstSnapshot.status,
        bridgeInstanceId: bridge.bridgeInstanceId,
        bootId: bridge.bootId,
        buildId: bridge.buildId,
        stateSeqFirst: firstSnapshot.state.stateSeq,
        stateSeqLast: received.filter((message) => message.type === "QA_STATE").at(-1)?.stateSeq,
        safeArea: firstSnapshot.state.safeArea,
        calibration: {
          sampleCount: calibration.samples.length,
          selectedRttMs: calibration.selectedSample.rttMs,
          uncertaintyMs: calibration.uncertaintyMs,
          offsetMs: calibration.offsetMs,
        },
        reconnectStatus: reconnected.status,
      },
      uid: snapshot.uid,
      bridgeHealth: snapshot.bridge,
      arm: armEvidence,
      messages: {
        helloCount: received.filter((message) => message.type === "QA_HELLO").length,
        stateCount: received.filter((message) => message.type === "QA_STATE").length,
        pongCount: received.filter((message) => message.type === "QA_PONG").length,
        ackCount: received.filter((message) => message.type === "QA_ACK").length,
        rejectionCount: received.filter((message) => message.type === "QA_REJECTED").length,
      },
      errors,
      safety:
        "read-only bridge observation plus a controlled fixture tap; no install, clear, or uninstall",
    };
    const evidenceRoot = win32.normalize(
      process.env.TEST_CENTER_EVIDENCE_DIR ?? win32.join(projectRoot, "data", "milestones"),
    );
    await mkdir(evidenceRoot, { recursive: true });
    const evidencePath = win32.join(evidenceRoot, `m5-unity-bridge-${Date.now()}.json`);
    await writeFile(
      evidencePath,
      `${JSON.stringify({ ...evidence, evidencePath }, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath })}\n`);
    if (evidence.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  } finally {
    ingestor?.stop();
    reconnectIngestor?.stop();
    await reconnectClient?.close().catch(() => undefined);
    await client?.close().catch(() => undefined);
    if (forwardAdded) await adb.execute({ kind: "forwardRemove", serial, hostPort });
    database.close();
  }
}

function createClient(onMessage: (message: BridgeMessage) => void, nowRealtimeMs: () => number) {
  const client = new BridgeClient({
    transport: createTcpBridgeTransport({ port: hostPort, connectTimeoutMs: 5_000 }),
    parser: new BridgeProtocolParser({ nowRealtimeMs }),
    handshakeTimeoutMs: 8_000,
  });
  client.onMessage(onMessage);
  return { client };
}

async function waitForStates(received: readonly BridgeMessage[], count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (received.filter((message) => message.type === "QA_STATE").length < count) {
    if (Date.now() >= deadline)
      throw new Error(`Expected ${count} QA_STATE messages before timeout.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function exerciseArm(
  adb: AdbClient,
  serial: ReturnType<typeof parseDeviceSerial>,
  client: BridgeClient,
  metricsEpoch: number,
  offsetMs: number,
) {
  const descriptorHash = hashDescriptor(metricsEpoch);
  const actionId = `m5-${randomUUID()}`;
  const expiresAtRealtimeMs = String(Math.round(performance.now() + offsetMs + 30_000));
  const messages: BridgeMessage[] = [];
  const remove = client.onMessage((message) => messages.push(message));
  client.send({
    type: "QA_ARM",
    schemaVersion: 1,
    runNonceHash: sha256(randomUUID()),
    actionId,
    descriptorHash,
    expectedEventShapeHash: descriptorHash,
    expectedView: "MainHUD",
    expectedFocus: null,
    metricsEpoch,
    expiresAtRealtimeMs,
  });
  await waitForMessage(
    messages,
    (message) => message.type === "QA_ARMED",
    2_000,
    () => JSON.stringify(client.getSnapshot()),
  );
  const tap = await execFileAsync(adbPath, ["-s", serial, "shell", "input", "tap", "250", "1000"], {
    windowsHide: true,
    cwd: projectRoot,
  });
  let ackError: string | undefined;
  const ack = await waitForMessage(
    messages,
    (message) => message.type === "QA_ACK",
    2_000,
    () => JSON.stringify(client.getSnapshot()),
  ).catch((error: unknown) => {
    ackError = error instanceof Error ? error.message : String(error);
    return undefined;
  });
  client.send({
    type: "QA_ARM",
    schemaVersion: 1,
    runNonceHash: sha256(randomUUID()),
    actionId: `${actionId}-invalid`,
    descriptorHash,
    expectedEventShapeHash: descriptorHash,
    expectedView: "MainHUD",
    expectedFocus: null,
    metricsEpoch,
    expiresAtRealtimeMs: "1",
  });
  const rejected = await waitForMessage(
    messages,
    (message) => message.type === "QA_REJECTED",
    2_000,
  ).catch(() => undefined);
  remove();
  return {
    armed: messages.some((message) => message.type === "QA_ARMED"),
    acked: ack !== undefined,
    rejected: rejected !== undefined,
    rejectionCodes: messages
      .filter((message) => message.type === "QA_REJECTED")
      .map((message) => message.code),
    ackError,
    tapExitCode: tap.stdout === undefined ? null : 0,
  };
}

async function waitForMessage(
  messages: readonly BridgeMessage[],
  predicate: (message: BridgeMessage) => boolean,
  timeoutMs: number,
  context: () => string = () => "{}",
): Promise<BridgeMessage> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const message = messages.find(predicate);
    if (message !== undefined) return message;
    if (Date.now() >= deadline) {
      throw new Error(
        `Expected bridge message before timeout; observed=${JSON.stringify(messages.slice(-5))}; context=${context()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function hashDescriptor(metricsEpoch: number): string {
  return sha256(
    `{"actionType":"tap","expectedFocus":null,"expectedView":"MainHUD","metricsEpoch":${metricsEpoch},"normalizedShape":{"kind":"tap","target":"TapTarget100"}}`,
  );
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
