import { mkdir, writeFile } from "node:fs/promises";
import { win32 } from "node:path";

import { AdbClient } from "../../packages/adb/src/index.js";
import {
  collectInstalledIdentity,
  createAdbInstalledIdentityExecutor,
} from "../../packages/artifacts/src/index.js";
import { parseAndroidPackageName } from "../../packages/contracts/src/artifact.js";
import { parseDeviceSerial } from "../../packages/contracts/src/device.js";

const serialText = process.env.TEST_CENTER_DEVICE_SERIAL;
const packageText = process.env.TEST_CENTER_PACKAGE;
if (serialText === undefined || packageText === undefined) {
  process.stdout.write(
    "M3_HARDWARE_SKIPPED TEST_CENTER_DEVICE_SERIAL and TEST_CENTER_PACKAGE are required; no install, clear, or launch was attempted.\n",
  );
  process.exitCode = 2;
} else {
  const serial = parseDeviceSerial(serialText);
  const packageName = parseAndroidPackageName(packageText);
  const adbPath =
    process.env.TEST_CENTER_ADB_PATH ??
    "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
  const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
  const client = new AdbClient({ adbPath, cwd: projectRoot, timeoutMs: 30_000 });
  const executor = createAdbInstalledIdentityExecutor(client);
  const identity = await collectInstalledIdentity(serial, packageName, executor);
  const [paths, details, activity] = await Promise.all([
    client.execute({ kind: "packagePaths", serial, packageName }),
    client.execute({ kind: "packageDetails", serial, packageName }),
    client.execute({ kind: "resolveActivity", serial, packageName }),
  ]);
  if ([paths, details, activity].some((result) => result.exitCode !== 0 || result.timedOut)) {
    throw new Error("M3 direct diagnostics did not complete successfully.");
  }
  const evidence = {
    collectedAt: identity.observedAt,
    serial: identity.deviceSerial,
    packageName: identity.packageName,
    identity,
    directDiagnostics: {
      packagePathsExitCode: paths.exitCode,
      packageDetailsExitCode: details.exitCode,
      resolveActivityExitCode: activity.exitCode,
      packagePathsBytes: Buffer.byteLength(paths.stdout),
      packageDetailsBytes: Buffer.byteLength(details.stdout),
      resolveActivityBytes: Buffer.byteLength(activity.stdout),
    },
    safety:
      "read-only: pm path, dumpsys package, resolve-activity, and run-as-less APK streaming only",
  };
  const evidenceRoot = win32.normalize(
    process.env.TEST_CENTER_EVIDENCE_DIR ?? win32.join(projectRoot, "data", "milestones"),
  );
  await mkdir(evidenceRoot, { recursive: true });
  const evidencePath = win32.join(evidenceRoot, `m3-installed-identity-${Date.now()}.json`);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath })}\n`);
}
