import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { win32 } from "node:path";

import type { AdbClient, AdbCommand, AdbPackageCommand, AdbExecuteOptions } from "@test-center/adb";
import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";
import {
  ProcessRunner,
  type ProcessResult,
  type ProcessSpec,
} from "@test-center/environment/process-runner";
import { parseApkCertificates } from "./apk-metadata.js";
import { renderArtifactToolCommand } from "./tool-commands.js";

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
  signerSha256?: (input: {
    readonly serial: DeviceSerial;
    readonly packageName: string;
    readonly basePath: string;
  }) => Promise<string>;
}

export interface ApksignerSignerResolverOptions {
  readonly apksignerPath: string;
  readonly javaPath?: string;
  readonly apksignerJarPath?: string;
  readonly cwd: string;
  readonly tempRoot: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs?: number;
  readonly runner?: { run(spec: ProcessSpec): Promise<ProcessResult> };
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
  const basePath = paths.find((record) => record.pathRole === "BASE")?.path;
  if (basePath === undefined) throw new Error("UNSUPPORTED_METADATA: Base APK path is missing.");
  const signerSha256 =
    details.signerSha256 ??
    (executor.signerSha256 === undefined
      ? undefined
      : await executor.signerSha256({
          serial: validatedSerial,
          packageName: validatedPackage,
          basePath,
        }));
  if (signerSha256 === undefined) {
    throw new Error(
      "SIGNER_UNAVAILABLE: dumpsys package did not expose a certificate digest and no host signer resolver was configured.",
    );
  }
  assertSignerSha256(signerSha256);
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
    signerSha256: signerSha256.toLowerCase(),
    installedSetSha256: createHash("sha256").update(JSON.stringify(hashes)).digest("hex"),
    observedAt,
  };
}

export function createAdbInstalledIdentityExecutor(
  client: AdbClient,
  options: Pick<InstalledIdentityExecutor, "signerSha256"> = {},
): InstalledIdentityExecutor {
  return {
    execute: async (command) => toInstalledResult(await client.execute(command)),
    stream: async (command, onChunk) => {
      const options: AdbExecuteOptions = { maxOutputBytes: 1, stdoutSink: onChunk };
      return toInstalledResult(await client.execute(command, options));
    },
    ...(options.signerSha256 === undefined ? {} : { signerSha256: options.signerSha256 }),
  };
}

export function createApksignerSignerResolver(
  client: AdbClient,
  options: ApksignerSignerResolverOptions,
): NonNullable<InstalledIdentityExecutor["signerSha256"]> {
  const apksignerPath = requireAbsolutePath(options.apksignerPath, "apksignerPath");
  const cwd = requireAbsolutePath(options.cwd, "cwd");
  const tempRoot = requireAbsolutePath(options.tempRoot, "tempRoot");
  const runner = options.runner ?? new ProcessRunner();
  const timeoutMs = options.timeoutMs ?? 30_000;

  return async ({ serial, packageName, basePath }) => {
    const scratch = win32.join(tempRoot, `signer-${randomUUID()}`);
    await mkdir(scratch, { recursive: true });
    const apkPath = win32.join(scratch, "base.apk");
    const output = createWriteStream(apkPath, { flags: "wx" });
    try {
      const adbResult = await client.execute(
        { kind: "streamPackageFile", serial, packageName, filePath: basePath },
        {
          maxOutputBytes: 1,
          stdoutSink: (chunk) => output.write(chunk),
        },
      );
      output.end();
      await finished(output);
      if (adbResult.timedOut || adbResult.exitCode !== 0) {
        throw new Error(`TOOL_FAILURE: stream ${basePath} failed.`);
      }

      const command = renderArtifactToolCommand({
        kind: "apksignerCerts",
        executablePath: apksignerPath,
        apkPath,
      });
      const processCommand = createHostSignerProcess(apksignerPath, command, options);
      const result = await runner.run({
        executableId: "apksigner",
        executablePath: processCommand.executablePath,
        args: processCommand.args,
        cwd,
        env: options.env ?? process.env,
        timeoutMs,
        serialRequirement: "forbidden",
        maxOutputBytes: 1024 * 1024,
      });
      if (result.timedOut || result.exitCode !== 0) {
        throw new Error(`TOOL_FAILURE: apksigner failed: ${result.stderr.trim()}`);
      }
      return parseApkCertificates(result.stdout);
    } finally {
      output.destroy();
      await finished(output, { cleanup: true }).catch(() => undefined);
      await rm(scratch, { recursive: true, force: true });
    }
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
  signerSha256?: string;
} {
  const header = output.match(/Package\s+\[([^\]]+)\]/i)?.[1];
  if (header !== packageName)
    throw new Error("UNSUPPORTED_METADATA: dumpsys package returned a different package.");
  const versionName = output.match(/\bversionName=([^\s]+)/i)?.[1];
  const versionCode = parseInteger(output.match(/\bversionCode=(\d+)/i)?.[1]);
  const minSdk = parseInteger(output.match(/\bminSdk(?:Version)?=(\d+)/i)?.[1]);
  const targetSdk = parseInteger(output.match(/\btargetSdk(?:Version)?=(\d+)/i)?.[1]);
  const digest = output.match(/(?:Signature\{|SHA-256\s+digest[:=])\s*([0-9a-f]{64})/i)?.[1];
  if (versionName === undefined || versionCode === undefined) {
    throw new Error("UNSUPPORTED_METADATA: dumpsys package metadata is incomplete.");
  }
  return {
    versionName,
    versionCode,
    ...(minSdk === undefined ? {} : { minSdk }),
    ...(targetSdk === undefined ? {} : { targetSdk }),
    ...(digest === undefined ? {} : { signerSha256: digest.toLowerCase() }),
  };
}

function assertSignerSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(
      "UNSUPPORTED_METADATA: Host signer resolver returned an invalid certificate digest.",
    );
  }
}

function requireAbsolutePath(value: string, name: string): string {
  if (!win32.isAbsolute(value)) throw new TypeError(`${name} must be an absolute Windows path.`);
  return win32.normalize(value);
}

function createHostSignerProcess(
  apksignerPath: string,
  command: ReturnType<typeof renderArtifactToolCommand>,
  options: ApksignerSignerResolverOptions,
): { readonly executablePath: string; readonly args: readonly string[] } {
  const extension = win32.extname(apksignerPath).toLowerCase();
  if (extension !== ".bat" && extension !== ".cmd") {
    return { executablePath: command.executablePath, args: [...command.args] };
  }
  if (options.javaPath !== undefined && options.apksignerJarPath !== undefined) {
    return {
      executablePath: requireAbsolutePath(options.javaPath, "javaPath"),
      args: [
        "-jar",
        requireAbsolutePath(options.apksignerJarPath, "apksignerJarPath"),
        ...command.args,
      ],
    };
  }
  throw new Error(
    "APKSIGNER_WRAPPER_UNSUPPORTED: .bat/.cmd apksigner paths require explicit javaPath and apksignerJarPath.",
  );
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
