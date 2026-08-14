import { win32 } from "node:path";
import { AdbClient } from "../../packages/adb/src/index.js";
const serial = process.env.TEST_CENTER_DEVICE_SERIAL?.trim();
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const adbPath =
  process.env.TEST_CENTER_ADB_PATH ??
  "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
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
});
await adb.execute({ kind: "forceStop", serial: serial as never, packageName });
process.stdout.write(
  `${JSON.stringify({ status: "PASS", serial, packageName, injected: "APP_CRASH_OR_ANR", note: "This script never replays actions." })}\n`,
);
