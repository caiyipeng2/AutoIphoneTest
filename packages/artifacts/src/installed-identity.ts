import { createHash } from "node:crypto";

import type { AdbClient, AdbCommand, AdbPackageCommand, AdbExecuteOptions } from "@test-center/adb";
import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

export interface InstalledCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

export interface InstalledIdentityExecutor {
  execute(command: AdbCommand): Promise<InstalledCommandResult>;
  stream(
    command: AdbPackageCommand,
    onChunk: (chunk: Buffer) => void,
  ): Promise<InstalledCommandResult>;
}

export interface InstalledPathRecord {
  readonly path: string;
  readonly pathRole: "BASE" | "SPLIT";
}

export interface InstalledIdentity {
  readonly deviceSerial: DeviceSerial;
  readonly packageName: string;
  readonly versionName: string;
  readonly versionCode: number;
  readonly minSdk?: number;
  readonly targetSdk?: number;
  readonly launchActivity?: string;
  readonly signerSha256: string;
  readonly installedSetSha256: string;
  readonly observedAt: string;
}

export function parsePackagePaths(output: string): InstalledPathRecord[] {
  const records: InstalledPathRecord[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("package:"))
      throw new Error("UNSUPPORTED_METADATA: Unexpected pm path output.");
    const path = trimmed.slice("package:".length);
    if (!isSafePackagePath(path))
      throw new Error("UNSUPPORTED_METADATA: pm path escaped /data/app/.");
    if (seen.has(path)) continue;
    seen.add(path);
    const fileName = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    records.push({ path, pathRole: fileName === "base.apk" ? "BASE" : "SPLIT" });
  }
  if (records.length === 0 || records.filter((record) => record.pathRole === "BASE").length !== 1) {
    throw new Error("UNSUPPORTED_METADATA: pm path did not return exactly one base APK.");
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

export async function collectInstalledIdentity(
  serial: DeviceSerial,
  packageName: string,
  executor: InstalledIdentityExecutor,
  observedAt = new Date().toISOString(),
): Promise<InstalledIdentity> {
  const validatedSerial = parseDeviceSerial(serial);
  const validatedPackage = parseAndroidPackageName(packageName);
  const pathsResult = await executor.execute({
    kind: "packagePaths",
    serial: validatedSerial,
    packageName: validatedPackage,
  });
  assertSuccess(pathsResult, "pm path");
  const paths = parsePackagePaths(pathsResult.stdout);
  const detailsResult = await executor.execute({
    kind: "packageDetails",
    serial: validatedSerial,
    packageName: validatedPackage,
  });
  assertSuccess(detailsResult, "dumpsys package");
  const details = parsePackageDetails(detailsResult.stdout, validatedPackage);
  const activityResult = await executor.execute({
    kind: "resolveActivity",
    serial: validatedSerial,
    packageName: validatedPackage,
  });
  assertSuccess(activityResult, "resolve activity");
  const launchActivity = parseActivity(activityResult.stdout);
  const hashes: Array<{ pathRole: InstalledPathRecord["pathRole"]; sha256: string }> = [];
  for (const record of paths) {
    const hash = createHash("sha256");
    const streamResult = await executor.stream(
      {
        kind: "streamPackageFile",
        serial: validatedSerial,
        packageName: validatedPackage,
        filePath: record.path,
      },
      (chunk) => hash.update(chunk),
    );
    assertSuccess(streamResult, `stream ${record.path}`);
    hashes.push({ pathRole: record.pathRole, sha256: hash.digest("hex") });
  }
  hashes.sort(
    (left, right) =>
      left.pathRole.localeCompare(right.pathRole) || left.sha256.localeCompare(right.sha256),
  );
  return {
    deviceSerial: validatedSerial,
    packageName: validatedPackage,
    versionName: details.versionName,
    versionCode: details.versionCode,
    ...(details.minSdk === undefined ? {} : { minSdk: details.minSdk }),
    ...(details.targetSdk === undefined ? {} : { targetSdk: details.targetSdk }),
    ...(launchActivity === undefined ? {} : { launchActivity }),
    signerSha256: details.signerSha256,
    installedSetSha256: createHash("sha256").update(JSON.stringify(hashes)).digest("hex"),
    observedAt,
  };
}

export function createAdbInstalledIdentityExecutor(client: AdbClient): InstalledIdentityExecutor {
  return {
    execute: async (command) => toInstalledResult(await client.execute(command)),
    stream: async (command, onChunk) => {
      const options: AdbExecuteOptions = { maxOutputBytes: 1, stdoutSink: onChunk };
      return toInstalledResult(await client.execute(command, options));
    },
  };
}

function parsePackageDetails(
  output: string,
  packageName: string,
): {
  versionName: string;
  versionCode: number;
  minSdk?: number;
  targetSdk?: number;
  signerSha256: string;
} {
  const header = output.match(/Package\s+\[([^\]]+)\]/i)?.[1];
  if (header !== packageName)
    throw new Error("UNSUPPORTED_METADATA: dumpsys package returned a different package.");
  const versionName = output.match(/\bversionName=([^\s]+)/i)?.[1];
  const versionCode = parseInteger(output.match(/\bversionCode=(\d+)/i)?.[1]);
  const minSdk = parseInteger(output.match(/\bminSdk(?:Version)?=(\d+)/i)?.[1]);
  const targetSdk = parseInteger(output.match(/\btargetSdk(?:Version)?=(\d+)/i)?.[1]);
  const digest = output.match(/(?:Signature\{|SHA-256\s+digest[:=])\s*([0-9a-f]{64})/i)?.[1];
  if (versionName === undefined || versionCode === undefined || digest === undefined) {
    throw new Error("UNSUPPORTED_METADATA: dumpsys package metadata is incomplete.");
  }
  return {
    versionName,
    versionCode,
    ...(minSdk === undefined ? {} : { minSdk }),
    ...(targetSdk === undefined ? {} : { targetSdk }),
    signerSha256: digest.toLowerCase(),
  };
}

function parseActivity(output: string): string | undefined {
  if (/No activity found/i.test(output)) return undefined;
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("/"));
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function isSafePackagePath(path: string): boolean {
  return (
    path.startsWith("/data/app/") &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.includes("\0")
  );
}

function assertSuccess(result: InstalledCommandResult, operation: string): void {
  if (result.timedOut || result.exitCode !== 0)
    throw new Error(`TOOL_FAILURE: ${operation} failed: ${result.stderr.trim()}`);
}

function toInstalledResult(result: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}): InstalledCommandResult {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  };
}
