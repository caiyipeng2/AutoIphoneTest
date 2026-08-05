import type { ApkMetadata } from "./apk-metadata.js";

export function parseAabManifest(output: string): Omit<
  ApkMetadata,
  "signerSha256" | "versionName" | "versionCode"
> & {
  readonly versionName?: string;
  readonly versionCode?: number;
} {
  const manifest = output.match(/<manifest\b[^>]*>/i)?.[0];
  if (manifest === undefined) throw new Error("UNSUPPORTED_METADATA: Missing manifest element.");
  const packageName = xmlAttribute(manifest, "package");
  if (packageName === undefined) throw new Error("UNSUPPORTED_METADATA: Missing manifest package.");
  const usesSdk = output.match(/<uses-sdk\b[^>]*>/i)?.[0];
  const application = output.match(/<application\b[^>]*>/i)?.[0];
  const activity = output.match(/<activity(?:-alias)?\b[^>]*>/i)?.[0];
  const versionCode = xmlNumber(manifest, "android:versionCode");
  const versionName = xmlAttribute(manifest, "android:versionName");
  const launchActivity =
    activity === undefined ? undefined : xmlAttribute(activity, "android:name");
  const minSdk = usesSdk === undefined ? undefined : xmlNumber(usesSdk, "android:minSdkVersion");
  const targetSdk =
    usesSdk === undefined ? undefined : xmlNumber(usesSdk, "android:targetSdkVersion");
  return {
    packageName,
    supportedAbis: [],
    debuggable:
      application !== undefined && xmlAttribute(application, "android:debuggable") === "true",
    ...(versionName === undefined ? {} : { versionName }),
    ...(versionCode === undefined ? {} : { versionCode }),
    ...(minSdk === undefined ? {} : { minSdk }),
    ...(targetSdk === undefined ? {} : { targetSdk }),
    ...(launchActivity === undefined ? {} : { launchActivity }),
  };
}

export function parseAabCertificates(output: string): string {
  const match =
    output.match(/SHA256:\s*([0-9a-f:\s]+)/i) ??
    output.match(/SHA-256\s+digest:\s*([0-9a-f:\s]+)/i);
  if (match === null) throw new Error("UNSIGNED: AAB signing certificate was not found.");
  const digest = match[1]!.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new Error("UNSUPPORTED_METADATA: Invalid certificate digest.");
  return digest;
}

function xmlAttribute(element: string, key: string): string | undefined {
  return element.match(new RegExp(`${key.replace(":", "\\:")}=["']([^"']*)["']`))?.[1];
}

function xmlNumber(element: string, key: string): number | undefined {
  const value = xmlAttribute(element, key);
  if (value === undefined) return undefined;
  const parsed = Number(value.replace(/^@integer\//, ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
