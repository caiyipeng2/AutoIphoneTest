import { createHash } from "node:crypto";
import { readFile, rename, rm } from "node:fs/promises";
import { win32 } from "node:path";

import type { DeviceSerial } from "@test-center/contracts/device";

export interface BundletoolProcess {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly serialRequirement: "forbidden";
}

export interface InstallSetCommandInput {
  readonly serial: DeviceSerial;
  readonly javaPath: string;
  readonly bundletoolJarPath: string;
  readonly adbPath: string;
  readonly bundlePath: string;
  readonly deviceSpecPath: string;
  readonly installSetPath: string;
  readonly signing: {
    readonly keystorePath: string;
    readonly alias: string;
    readonly storePasswordFile: string;
    readonly keyPasswordFile: string;
  };
  readonly cwd?: string;
}

export interface InstallSetCommands {
  readonly deviceSpec: BundletoolProcess;
  readonly buildApks: BundletoolProcess;
  readonly installApks: BundletoolProcess;
}

export interface InstallSetCacheKeyInput {
  readonly bundleSha256: string;
  readonly signerSha256: string;
  readonly bundletoolVersion: string;
  readonly mode: "DEVICE_SPECIFIC";
  readonly deviceSpecSha256: string;
}

export function createInstallSetCacheKey(input: InstallSetCacheKeyInput): string {
  assertSha256(input.bundleSha256, "bundleSha256");
  assertSha256(input.signerSha256, "signerSha256");
  assertSha256(input.deviceSpecSha256, "deviceSpecSha256");
  if (!input.bundletoolVersion.trim()) throw new TypeError("bundletoolVersion is required.");
  return [
    "aab-install-set",
    input.bundleSha256,
    input.signerSha256,
    input.bundletoolVersion,
    input.mode,
    input.deviceSpecSha256,
  ].join(":");
}

export function createInstallSetCommands(input: InstallSetCommandInput): InstallSetCommands {
  const javaPath = requireAbsolute(input.javaPath, "javaPath");
  const jar = requireAbsolute(input.bundletoolJarPath, "bundletoolJarPath");
  const adb = requireAbsolute(input.adbPath, "adbPath");
  const bundle = requireAbsolute(input.bundlePath, "bundlePath");
  const spec = requireAbsolute(input.deviceSpecPath, "deviceSpecPath");
  const installSet = requireAbsolute(input.installSetPath, "installSetPath");
  const cwd = requireAbsolute(input.cwd ?? win32.dirname(jar), "cwd");
  const common = ["-jar", jar];
  return {
    deviceSpec: {
      executablePath: javaPath,
      args: [
        ...common,
        "get-device-spec",
        "--adb",
        adb,
        "--device-id",
        input.serial,
        "--output",
        spec,
      ],
      cwd,
      serialRequirement: "forbidden",
    },
    buildApks: {
      executablePath: javaPath,
      args: [
        ...common,
        "build-apks",
        `--bundle=${bundle}`,
        `--output=${installSet}`,
        `--device-spec=${spec}`,
        `--ks=${requireAbsolute(input.signing.keystorePath, "keystorePath")}`,
        `--ks-key-alias=${input.signing.alias}`,
        `--ks-pass=file:${requireAbsolute(input.signing.storePasswordFile, "storePasswordFile")}`,
        `--key-pass=file:${requireAbsolute(input.signing.keyPasswordFile, "keyPasswordFile")}`,
      ],
      cwd,
      serialRequirement: "forbidden",
    },
    installApks: {
      executablePath: javaPath,
      args: [
        ...common,
        "install-apks",
        `--apks=${installSet}`,
        `--device-id=${input.serial}`,
        `--adb=${adb}`,
      ],
      cwd,
      serialRequirement: "forbidden",
    },
  };
}

export interface PublishedInstallSet {
  readonly finalPath: string;
  readonly sha256: string;
}

export async function publishInstallSet(input: {
  readonly partialPath: string;
  readonly finalPath: string;
  readonly expectedSha256: string;
}): Promise<PublishedInstallSet> {
  const partialPath = requireAbsolute(input.partialPath, "partialPath");
  const finalPath = requireAbsolute(input.finalPath, "finalPath");
  if (!partialPath.endsWith(".partial")) throw new TypeError("partialPath must end with .partial.");
  if (win32.dirname(partialPath) !== win32.dirname(finalPath)) {
    throw new TypeError("partialPath and finalPath must share a directory.");
  }
  const content = await readFile(partialPath);
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (sha256 !== input.expectedSha256) {
    await rm(partialPath, { force: true });
    throw new Error("Install set SHA-256 does not match expected content.");
  }
  await rename(partialPath, finalPath);
  return { finalPath, sha256 };
}

function assertSha256(value: string, name: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${name} must be lowercase SHA-256 hex.`);
}

function requireAbsolute(value: string, name: string): string {
  if (!win32.isAbsolute(value)) throw new TypeError(`${name} must be an absolute Windows path.`);
  return win32.normalize(value);
}
