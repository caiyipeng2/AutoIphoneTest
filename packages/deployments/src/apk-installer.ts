import { win32 } from "node:path";

import type { AdbClient, AdbDeploymentCommand } from "@test-center/adb";
import type { DeviceSerial } from "@test-center/contracts/device";
import type { ProcessResult } from "@test-center/environment/process-runner";

export interface ApkInstallCommandInput {
  readonly serial: DeviceSerial;
  readonly apkPath: string;
  readonly artifactRoot: string;
}

export function createApkInstallCommand(input: ApkInstallCommandInput): AdbDeploymentCommand {
  const artifactRoot = requireAbsolute(input.artifactRoot, "artifactRoot");
  const apkPath = requireAbsolute(input.apkPath, "apkPath");
  const relative = win32.relative(artifactRoot, apkPath);
  if (relative === "" || relative.startsWith("..") || win32.isAbsolute(relative)) {
    throw new TypeError("APK path must remain below the artifact root.");
  }
  if (!apkPath.toLowerCase().endsWith(".apk")) {
    throw new TypeError("APK path must end with .apk.");
  }
  return { kind: "installApk", serial: input.serial, apkPath };
}

export async function installApk(
  client: AdbClient,
  input: ApkInstallCommandInput,
): Promise<ProcessResult> {
  return await client.execute(createApkInstallCommand(input));
}

function requireAbsolute(value: string, name: string): string {
  if (!win32.isAbsolute(value)) throw new TypeError(`${name} must be an absolute Windows path.`);
  return win32.normalize(value);
}
