import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { win32 } from "node:path";

import type Database from "better-sqlite3";
import type { DeviceSerial } from "@test-center/contracts/device";
import { ProcessRunner, type ProcessResult, type ProcessSpec } from "@test-center/environment/process-runner";

import {
  createInstallSetCacheKey,
  createInstallSetCommands,
  publishInstallSet,
  type InstallSetCommandInput,
} from "./aab-install-set.js";

export interface InstallSetRecord {
  readonly id: string;
  readonly cacheKey: string;
  readonly bundleSha256: string;
  readonly signerSha256: string;
  readonly bundletoolVersion: string;
  readonly mode: "DEVICE_SPECIFIC";
  readonly deviceSpecSha256: string;
  readonly storedPath: string;
  readonly archiveSha256: string;
  readonly metadataJson: string;
  readonly createdAt: string;
}

export class InstallSetRepository {
  public constructor(private readonly database: Database.Database) {}

  public findByCacheKey(cacheKey: string): InstallSetRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM install_sets WHERE cache_key = ?")
      .get(cacheKey) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : fromRow(row);
  }

  public save(record: InstallSetRecord): void {
    this.database
      .prepare(
        `INSERT INTO install_sets
          (id, cache_key, bundle_sha256, signer_sha256, bundletool_version, mode,
           device_spec_sha256, stored_path, archive_sha256, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           stored_path = excluded.stored_path,
           archive_sha256 = excluded.archive_sha256,
           metadata_json = excluded.metadata_json`,
      )
      .run(
        record.id,
        record.cacheKey,
        record.bundleSha256,
        record.signerSha256,
        record.bundletoolVersion,
        record.mode,
        record.deviceSpecSha256,
        record.storedPath,
        record.archiveSha256,
        record.metadataJson,
        record.createdAt,
      );
  }
}

export interface ExpectedInstalledIdentity {
  readonly packageName: string;
  readonly versionName: string;
  readonly versionCode: number;
  readonly signerSha256: string;
}

export type ObservedInstalledIdentity = ExpectedInstalledIdentity;

export function assertInstalledIdentityMatches(
  expected: ExpectedInstalledIdentity,
  observed: ObservedInstalledIdentity,
): void {
  for (const field of ["packageName", "versionName", "versionCode", "signerSha256"] as const) {
    if (expected[field] !== observed[field]) {
      throw new Error(`INSTALL_IDENTITY_MISMATCH: ${field} does not match expected artifact.`);
    }
  }
}

export async function verifyInstalledIdentity(input: {
  readonly expected: ExpectedInstalledIdentity;
  readonly collect: () => Promise<ObservedInstalledIdentity>;
}): Promise<ObservedInstalledIdentity> {
  const observed = await input.collect();
  assertInstalledIdentityMatches(input.expected, observed);
  return observed;
}

export interface InstallSetExecutionInput {
  readonly serial: DeviceSerial;
  readonly commandInput: InstallSetCommandInput;
  readonly finalPath: string;
  readonly bundleSha256: string;
  readonly signerSha256: string;
  readonly bundletoolVersion: string;
  readonly repository?: InstallSetRepository;
  readonly runner?: InstallSetProcessRunner;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs?: number;
}

export interface InstallSetExecutionResult {
  readonly cacheKey: string;
  readonly deviceSpecSha256: string;
  readonly installSetPath: string;
  readonly archiveSha256: string;
  readonly cacheHit: boolean;
}

export interface InstallSetProcessRunner {
  run(spec: ProcessSpec): Promise<ProcessResult>;
}

export async function executeDeviceSpecificInstallSet(
  input: InstallSetExecutionInput,
): Promise<InstallSetExecutionResult> {
  const finalPath = requireAbsolute(input.finalPath, "finalPath");
  const partialPath = requirePartialPath(input.commandInput.installSetPath);
  if (win32.dirname(partialPath) !== win32.dirname(finalPath)) {
    throw new TypeError("partialPath and finalPath must share a directory.");
  }
  const commands = createInstallSetCommands(input.commandInput);
  const runner = input.runner ?? new ProcessRunner();
  const deviceSpec = await runTool(runner, commands.deviceSpec, input);
  if (deviceSpec.exitCode !== 0 || deviceSpec.timedOut) throw toolFailure("get-device-spec", deviceSpec);
  const specJson = await readFile(input.commandInput.deviceSpecPath, "utf8");
  const deviceSpecValue: unknown = JSON.parse(specJson);
  const deviceSpecSha256 = createHash("sha256").update(canonicalJson(deviceSpecValue), "utf8").digest("hex");
  const cacheKey = createInstallSetCacheKey({
    bundleSha256: input.bundleSha256,
    signerSha256: input.signerSha256,
    bundletoolVersion: input.bundletoolVersion,
    mode: "DEVICE_SPECIFIC",
    deviceSpecSha256,
  });

  const cached = input.repository?.findByCacheKey(cacheKey);
  let archiveSha256: string | undefined;
  let cacheHit = false;
  if (cached !== undefined && cached.storedPath === finalPath) {
    try {
      archiveSha256 = hashBytes(await readFile(finalPath));
      if (archiveSha256 === cached.archiveSha256) cacheHit = true;
    } catch {
      // Rebuild when the cached file is missing or unreadable.
    }
  }
  if (!cacheHit) {
    await rm(partialPath, { force: true });
    const build = await runTool(runner, createInstallSetCommands({ ...input.commandInput, installSetPath: partialPath }).buildApks, input);
    if (build.exitCode !== 0 || build.timedOut) throw toolFailure("build-apks", build);
    archiveSha256 = hashBytes(await readFile(partialPath));
    await publishInstallSet({ partialPath, finalPath, expectedSha256: archiveSha256 });
    input.repository?.save({
      id: `install-set-${cacheKey.slice(-24)}`,
      cacheKey,
      bundleSha256: input.bundleSha256,
      signerSha256: input.signerSha256,
      bundletoolVersion: input.bundletoolVersion,
      mode: "DEVICE_SPECIFIC",
      deviceSpecSha256,
      storedPath: finalPath,
      archiveSha256,
      metadataJson: JSON.stringify({ serial: input.serial }),
      createdAt: new Date().toISOString(),
    });
  }

  const install = await runTool(
    runner,
    createInstallSetCommands({ ...input.commandInput, installSetPath: finalPath }).installApks,
    input,
  );
  if (install.exitCode !== 0 || install.timedOut) throw toolFailure("install-apks", install);
  if (archiveSha256 === undefined) throw new Error("INSTALL_SET_UNAVAILABLE: archive hash is missing.");
  return { cacheKey, deviceSpecSha256, installSetPath: finalPath, archiveSha256, cacheHit };
}

function fromRow(row: Record<string, unknown>): InstallSetRecord {
  return {
    id: String(row.id),
    cacheKey: String(row.cache_key),
    bundleSha256: String(row.bundle_sha256),
    signerSha256: String(row.signer_sha256),
    bundletoolVersion: String(row.bundletool_version),
    mode: "DEVICE_SPECIFIC",
    deviceSpecSha256: String(row.device_spec_sha256),
    storedPath: String(row.stored_path),
    archiveSha256: String(row.archive_sha256),
    metadataJson: String(row.metadata_json),
    createdAt: String(row.created_at),
  };
}

async function runTool(runner: InstallSetProcessRunner, command: { executablePath: string; args: readonly string[]; cwd: string; serialRequirement: "forbidden" }, input: InstallSetExecutionInput): Promise<ProcessResult> {
  return await runner.run({
    executableId: "bundletool",
    executablePath: command.executablePath,
    args: command.args,
    cwd: command.cwd,
    env: input.env ?? process.env,
    timeoutMs: input.timeoutMs ?? 120_000,
    serialRequirement: command.serialRequirement,
    redactedArgumentIndexes: command.args.reduce<number[]>((indexes, argument, index) => {
      if (argument.startsWith("--ks-pass=") || argument.startsWith("--key-pass=")) indexes.push(index);
      return indexes;
    }, []),
  });
}

function toolFailure(operation: string, result: ProcessResult): Error {
  return new Error(`TOOL_FAILURE: ${operation} failed: ${result.stderr.trim()}`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashBytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireAbsolute(value: string, name: string): string {
  if (!win32.isAbsolute(value)) throw new TypeError(`${name} must be an absolute Windows path.`);
  return win32.normalize(value);
}

function requirePartialPath(value: string): string {
  const normalized = requireAbsolute(value, "partialPath");
  if (!normalized.endsWith(".partial")) throw new TypeError("partialPath must end with .partial.");
  return normalized;
}
