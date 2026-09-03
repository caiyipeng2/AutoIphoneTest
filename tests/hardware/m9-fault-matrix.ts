import { win32 } from "node:path";
import { AdbClient } from "../../packages/adb/src/index.js";
const serial = process.env.TEST_CENTER_DEVICE_SERIAL?.trim();
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const adbPath =
  process.env.TEST_CENTER_ADB_PATH ??
  "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
const adbPort = readOptionalPort(
  process.env.TEST_CENTER_APPIUM_ADB_PORT ?? process.env.TEST_CENTER_ADB_SERVER_PORT,
);
const adbEnv = createAdbEnvironment(adbPort);
const confirmed = process.env.TEST_CENTER_M9_FAULT_CONFIRM === "I_UNDERSTAND";
if (!serial) throw new Error("Set TEST_CENTER_DEVICE_SERIAL before running the fault matrix.");
if (!confirmed) {
  process.stdout.write(
    `${JSON.stringify({ status: "DRY_RUN", serial, packageName, actions: ["force-stop-game", "foreground-drift-observation"], message: "Set TEST_CENTER_M9_FAULT_CONFIRM=I_UNDERSTAND to force-stop the game." })}\n`,
  );
  process.exit(0);
}
const adb = new AdbClient({
  adbPath,
  cwd: win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd()),
  env: adbEnv,
});
const forceStopResult = await adb.execute({
  kind: "forceStop",
  serial: serial as never,
  packageName,
});
if (forceStopResult.timedOut || forceStopResult.exitCode !== 0) {
  throw new Error(
    `Force-stop injection failed for ${serial}: exitCode=${String(forceStopResult.exitCode)} stderr=${forceStopResult.stderr.trim()}`,
  );
}
process.stdout.write(
  `${JSON.stringify({ status: "PASS", serial, packageName, injected: "APP_CRASH_OR_ANR", forceStopDurationMs: forceStopResult.durationMs, note: "This script never replays actions." })}\n`,
);

function readOptionalPort(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`Invalid M9 fault matrix ADB server port: ${value}.`);
  }
  return String(parsed);
}

function createAdbEnvironment(port: string | undefined): NodeJS.ProcessEnv {
  if (port === undefined) return { ...process.env };
  return {
    ...process.env,
    ADB_SERVER_SOCKET: `tcp:127.0.0.1:${port}`,
    ANDROID_ADB_SERVER_PORT: port,
  };
}
