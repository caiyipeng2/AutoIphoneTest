import { describe, expect, it } from "vitest";

import { createInstallSetCacheKey, createInstallSetCommands } from "./aab-install-set.js";
import { parseDeviceSerial } from "@test-center/contracts/device";

const baseInput = {
  bundleSha256: "a".repeat(64),
  signerSha256: "b".repeat(64),
  bundletoolVersion: "1.18.3",
  mode: "DEVICE_SPECIFIC" as const,
  deviceSpecSha256: "c".repeat(64),
};

describe("device-specific AAB install set cache", () => {
  it("includes every artifact, signer, bundletool, mode, and device-spec identity", () => {
    const key = createInstallSetCacheKey(baseInput);

    expect(key).toContain(baseInput.bundleSha256);
    expect(key).toContain(baseInput.signerSha256);
    expect(key).toContain(baseInput.bundletoolVersion);
    expect(key).toContain(baseInput.mode);
    expect(key).toContain(baseInput.deviceSpecSha256);
  });

  it("does not reuse a set for another ABI, density, or SDK device spec", () => {
    expect(createInstallSetCacheKey({ ...baseInput, deviceSpecSha256: "d".repeat(64) })).not.toBe(
      createInstallSetCacheKey(baseInput),
    );
    expect(createInstallSetCacheKey({ ...baseInput, bundletoolVersion: "1.17.0" })).not.toBe(
      createInstallSetCacheKey(baseInput),
    );
  });

  it("uses explicit Java, bundletool, adb, and device id arguments", () => {
    const commands = createInstallSetCommands({
      serial: parseDeviceSerial("R5CX211TXNT"),
      javaPath: "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK\\bin\\java.exe",
      bundletoolJarPath: "E:\\Tools\\bundletool\\bundletool.jar",
      adbPath:
        "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe",
      bundlePath: "E:\\Artifacts\\game.aab",
      deviceSpecPath: "E:\\Artifacts\\device-spec.json",
      installSetPath: "E:\\Artifacts\\game.apks",
      signing: {
        keystorePath: "E:\\Secrets\\qa.keystore",
        alias: "qa",
        storePasswordFile: "E:\\Temp\\store-password.txt",
        keyPasswordFile: "E:\\Temp\\key-password.txt",
      },
    });

    expect(commands.deviceSpec.args).toEqual([
      "-jar",
      "E:\\Tools\\bundletool\\bundletool.jar",
      "get-device-spec",
      "--adb",
      "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe",
      "--device-id",
      "R5CX211TXNT",
      "--output",
      "E:\\Artifacts\\device-spec.json",
    ]);
    expect(commands.buildApks.args).toContain("--device-spec=E:\\Artifacts\\device-spec.json");
    expect(commands.buildApks.args).toContain("--ks-pass=file:E:\\Temp\\store-password.txt");
    expect(commands.installApks.args).toEqual([
      "-jar",
      "E:\\Tools\\bundletool\\bundletool.jar",
      "install-apks",
      "--apks=E:\\Artifacts\\game.apks",
      "--device-id=R5CX211TXNT",
      "--adb=D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe",
    ]);
    expect(JSON.stringify(commands)).not.toContain("secret-value");
  });
});
