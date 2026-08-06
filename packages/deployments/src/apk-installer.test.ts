import { describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import { AdbClient } from "@test-center/adb";

import { createApkInstallCommand, installApk } from "./apk-installer.js";

const serial = parseDeviceSerial("R5CX211TXNT");

describe("APK installation command", () => {
  it("requires an APK below the configured artifact root", () => {
    expect(
      createApkInstallCommand({
        serial,
        apkPath: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\artifacts\\qa.apk",
        artifactRoot: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\artifacts",
      }),
    ).toEqual({
      kind: "installApk",
      serial,
      apkPath: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\artifacts\\qa.apk",
    });
    expect(() =>
      createApkInstallCommand({
        serial,
        apkPath: "E:\\Temp\\qa.apk",
        artifactRoot: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\artifacts",
      }),
    ).toThrow(/artifact root/i);
  });

  it("executes the serial-bound install command through AdbClient", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = new AdbClient({
      adbPath:
        "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe",
      cwd: "E:\\Projects\\UnityMultiDeviceTestCenter",
      runner: {
        run: async (spec) => {
          calls.push(spec as unknown as Record<string, unknown>);
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            durationMs: 1,
            stdout: "Success",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
            command: { executableId: "adb", executablePath: "adb.exe", args: [] },
          };
        },
      },
    });

    await installApk(client, {
      serial,
      apkPath: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\artifacts\\qa.apk",
      artifactRoot: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\artifacts",
    });
    expect(calls[0]).toMatchObject({ serial, args: ["install", "-r", "-t", expect.any(String)] });
  });
});
