import { readFile } from "node:fs/promises";

import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export interface ApkMetadata {
  readonly packageName: string;
  readonly versionName: string;
  readonly versionCode: number;
  readonly minSdk?: number;
  readonly targetSdk?: number;
  readonly launchActivity?: string;
  readonly supportedAbis: readonly string[];
  readonly debuggable: boolean;
  readonly signerSha256?: string;
}

export function parseApkBadging(output: string): Omit<ApkMetadata, "signerSha256"> {
  const packageLine = findLine(output, "package:");
  const packageName = requiredAttribute(packageLine, "name");
  const versionName = requiredAttribute(packageLine, "versionName");
  const versionCode = numberAttribute(packageLine, "versionCode");
  const sdkLine = findOptionalLine(output, "sdkVersion:");
  const targetSdkLine = findOptionalLine(output, "targetSdkVersion:");
  const launchLine = findOptionalLine(output, "launchable-activity:");
  const nativeLine = findOptionalLine(output, "native-code:");
  const launchActivity =
    launchLine === undefined ? undefined : optionalAttribute(launchLine, "name");
  const parsed = {
    packageName,
    versionName,
    versionCode,
    ...(sdkLine === undefined ? {} : { minSdk: numberFromLine(sdkLine, "sdkVersion") }),
    ...(targetSdkLine === undefined
      ? {}
      : { targetSdk: numberFromLine(targetSdkLine, "targetSdkVersion") }),
    ...(launchActivity === undefined ? {} : { launchActivity }),
    supportedAbis:
      nativeLine === undefined
        ? []
        : [...nativeLine.matchAll(/'([^']+)'/g)].map((match) => match[1]!).filter(Boolean),
    debuggable: /^application-debuggable(?:$|:)/m.test(output),
  };
  return parsed;
}

export function parseApkCertificates(output: string): string {
  const match = output.match(/certificate\s+SHA-256\s+digest:\s*([0-9a-f:\s]+)/i);
  if (match === null) throw new Error("UNSIGNED: APK signing certificate was not found.");
  const digest = match[1]!.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return Sha256Schema.parse(digest);
}

export async function assertZipInput(path: string): Promise<void> {
  const header = await readFile(path, { encoding: null }).then((value) => value.subarray(0, 4));
  if (header.length < 4 || header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new Error("INVALID_FORMAT: Android package is not a ZIP archive.");
  }
}

function findLine(output: string, prefix: string): string {
  const line = findOptionalLine(output, prefix);
  if (line === undefined) throw new Error(`UNSUPPORTED_METADATA: Missing ${prefix} output.`);
  return line;
}

function findOptionalLine(output: string, prefix: string): string | undefined {
  return output.split(/\r?\n/).find((line) => line.trimStart().startsWith(prefix));
}

function requiredAttribute(line: string, key: string): string {
  const value = optionalAttribute(line, key);
  if (value === undefined || value.length === 0)
    throw new Error(`UNSUPPORTED_METADATA: Missing ${key}.`);
  return value;
}

function optionalAttribute(line: string, key: string): string | undefined {
  return line.match(new RegExp(`${key}='([^']*)'`))?.[1];
}

function numberAttribute(line: string, key: string): number {
  const value = Number(requiredAttribute(line, key));
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`UNSUPPORTED_METADATA: Invalid ${key}.`);
  return value;
}

function numberFromLine(line: string, key: string): number {
  const value = Number(
    line
      .split(":", 2)[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, ""),
  );
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`UNSUPPORTED_METADATA: Invalid ${key}.`);
  return value;
}
