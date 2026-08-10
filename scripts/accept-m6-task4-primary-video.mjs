import { mkdir, writeFile } from "node:fs/promises";
import { console } from "node:console";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { AdbScrcpyVideoTransport, TangoScrcpyViewProvider } from "../packages/video/dist/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serial = process.env.ANDROID_SERIAL ?? "R5CX211TXNT";
const adbPath =
  process.env.ADB_PATH ??
  "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
const runId = `m6-task4-primary-video-${Date.now()}`;
const runsRoot = path.join(projectRoot, "data", "runs", runId);
const acceptancePath = path.join(runsRoot, "acceptance.json");
await mkdir(runsRoot, { recursive: true });

const transport = new AdbScrcpyVideoTransport({
  serial,
  adbPath,
  serverPath: path.join(projectRoot, "tools", "scrcpy", "3.1", "scrcpy-server"),
  maxSize: 1080,
});
const provider = new TangoScrcpyViewProvider({ serial, transport, firstFrameTimeoutMs: 10_000 });
const frames = [];
const unsubscribe = provider.subscribe((frame) => {
  frames.push({
    frameId: frame.frameId,
    serial: frame.serial,
    width: frame.width,
    height: frame.height,
    metricsEpoch: frame.metricsEpoch,
    payloadBytes: frame.data.byteLength,
    keyFrame: frame.keyFrame,
    config: frame.config,
    presentationTimestampUs: frame.presentationTimestampUs,
  });
});
let error;
try {
  await provider.start();
  await delay(1_500);
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  unsubscribe();
  await provider.stop();
}

const evidence = {
  schemaVersion: 1,
  runId,
  serial,
  adbPath,
  providerState: provider.state,
  degraded: provider.degraded,
  frameCount: frames.length,
  firstFrame: frames[0],
  lastFrame: frames.at(-1),
  error,
  cleanup: provider.state === "STOPPED",
  acceptancePath,
};
await writeFile(acceptancePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence, null, 2));

if (error !== undefined || frames.length === 0 || !evidence.cleanup) process.exitCode = 1;
