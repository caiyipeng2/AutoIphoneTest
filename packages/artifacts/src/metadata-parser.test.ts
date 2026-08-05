import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseAabCertificates, parseAabManifest } from "./aab-metadata.js";
import { assertZipInput, parseApkBadging, parseApkCertificates } from "./apk-metadata.js";
import { renderArtifactToolCommand } from "./tool-commands.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../tests/fixtures/artifacts/${name}`, import.meta.url));

describe("artifact metadata parsers", () => {
  it("parses APK badging and signing output", async () => {
    const badging = await readFile(fixture("apk-badging.txt"), "utf8");
    const certs = await readFile(fixture("apk-certs.txt"), "utf8");
    expect(parseApkBadging(badging)).toEqual({
      packageName: "com.example.unitygame",
      versionName: "1.4.2",
      versionCode: 42,
      minSdk: 26,
      targetSdk: 35,
      launchActivity: "com.example.unitygame.MainActivity",
      supportedAbis: ["arm64-v8a", "armeabi-v7a"],
      debuggable: true,
    });
    expect(parseApkCertificates(certs)).toBe(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
  });

  it("parses AAB manifest and signer without inventing ABI or launch metadata", async () => {
    const manifest = await readFile(fixture("aab-manifest.xml"), "utf8");
    const certs = await readFile(fixture("aab-certs.txt"), "utf8");
    expect(parseAabManifest(manifest)).toMatchObject({
      packageName: "com.example.unitygame",
      versionName: "1.4.2",
      versionCode: 42,
      minSdk: 26,
      targetSdk: 35,
      launchActivity: "com.example.unitygame.MainActivity",
      supportedAbis: [],
      debuggable: false,
    });
    expect(parseAabCertificates(certs)).toBe(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
  });

  it("renders only explicit tool arguments and rejects non-ZIP input", async () => {
    expect(
      renderArtifactToolCommand({
        kind: "bundletoolManifest",
        javaPath: "D:\\Tools\\java.exe",
        bundletoolPath: "E:\\Tools\\bundletool.jar",
        bundlePath: "E:\\Imports\\game.aab",
      }),
    ).toEqual({
      executablePath: "D:\\Tools\\java.exe",
      args: [
        "-jar",
        "E:\\Tools\\bundletool.jar",
        "dump",
        "manifest",
        "--bundle",
        "E:\\Imports\\game.aab",
      ],
    });
    await expect(assertZipInput(fixture("invalid.bin"))).rejects.toThrow("INVALID_FORMAT");
  });

  it("classifies missing launch activity as unavailable instead of inferring one", () => {
    const parsed = parseApkBadging(
      "package: name='com.example.game' versionCode='1' versionName='1.0'\n",
    );
    expect(parsed).toMatchObject({
      packageName: "com.example.game",
      supportedAbis: [],
    });
    expect(parsed).not.toHaveProperty("launchActivity");
  });
});
