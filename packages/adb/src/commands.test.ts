import { describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import { renderAdbCommand, type AdbCommand } from "./commands.js";
import { AdbClient } from "./adb-client.js";

const serial = parseDeviceSerial("R5CX211TXNT");

describe("serial-bound adb commands", () => {
  it("renders devices -l without a target serial", () => {
    expect(renderAdbCommand({ kind: "devices" })).toEqual(["devices", "-l"]);
  });

  it("renders serial-owned bridge forwarding commands", () => {
    expect(renderAdbCommand({ kind: "forwardAdd", serial, hostPort: 18101, devicePort: 17501 })).toEqual([
      "-s",
      serial,
      "forward",
      "tcp:18101",
      "tcp:17501",
    ]);
    expect(renderAdbCommand({ kind: "forwardList", serial })).toEqual([
      "-s",
      serial,
      "forward",
      "--list",
    ]);
    expect(renderAdbCommand({ kind: "forwardRemove", serial, hostPort: 18101 })).toEqual([
      "-s",
      serial,
      "forward",
      "--remove",
      "tcp:18101",
    ]);
  });

  it("rejects invalid bridge forwarding ports", () => {
    expect(() => renderAdbCommand({ kind: "forwardAdd", serial, hostPort: 0, devicePort: 17501 })).toThrow(
      /port/i,
    );
    expect(() => renderAdbCommand({ kind: "forwardRemove", serial, hostPort: 65_536 })).toThrow(
      /port/i,
    );
  });

  it.each([
    [{ kind: "getState", serial }, ["-s", serial, "get-state"]],
    [{ kind: "getSerialno", serial }, ["-s", serial, "get-serialno"]],
    [
      { kind: "getProp", serial, key: "ro.build.version.sdk" },
      ["-s", serial, "shell", "getprop", "ro.build.version.sdk"],
    ],
    [{ kind: "wmSize", serial }, ["-s", serial, "shell", "wm", "size"]],
    [{ kind: "wmDensity", serial }, ["-s", serial, "shell", "wm", "density"]],
    [{ kind: "dumpsysBattery", serial }, ["-s", serial, "shell", "dumpsys", "battery"]],
    [{ kind: "dumpsysDisplay", serial }, ["-s", serial, "shell", "dumpsys", "display"]],
  ] as const)("renders %j", (command, expected) => {
    expect(renderAdbCommand(command as AdbCommand)).toEqual(expected);
  });

  it("rejects blank serials and unknown getprop keys", () => {
    expect(() => parseDeviceSerial("  ")).toThrow();
    expect(() => parseDeviceSerial("serial with spaces")).toThrow();
    expect(() => renderAdbCommand({ kind: "getProp", serial, key: "ro.unknown" } as never)).toThrow(
      /allowlisted/i,
    );
  });

  it("passes the serial through ProcessSpec and never exposes a raw shell command", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = new AdbClient({
      adbPath: "E:\\Android\\Sdk\\platform-tools\\adb.exe",
      cwd: "E:\\Projects\\UnityMultiDeviceTestCenter",
      runner: {
        run: async (spec) => {
          calls.push(spec as unknown as Record<string, unknown>);
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            durationMs: 1,
            stdout: "device",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
            command: { executableId: "adb", executablePath: "adb.exe", args: [] },
          };
        },
      },
    });

    await client.execute({ kind: "getState", serial });
    expect(calls[0]).toMatchObject({ executableId: "adb", args: ["get-state"], serial });
    expect(calls[0]?.args).not.toContain("-s");
  });

  it("renders package identity commands with explicit serial and package", () => {
    expect(
      renderAdbCommand({ kind: "packagePaths", serial, packageName: "com.example.game" }),
    ).toEqual(["-s", serial, "shell", "pm", "path", "com.example.game"]);
    expect(
      renderAdbCommand({ kind: "packageDetails", serial, packageName: "com.example.game" }),
    ).toEqual(["-s", serial, "shell", "dumpsys", "package", "com.example.game"]);
    expect(
      renderAdbCommand({ kind: "resolveActivity", serial, packageName: "com.example.game" }),
    ).toEqual([
      "-s",
      serial,
      "shell",
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      "com.example.game",
    ]);
    expect(
      renderAdbCommand({
        kind: "streamPackageFile",
        serial,
        packageName: "com.example.game",
        filePath: "/data/app/x/base.apk",
      }),
    ).toEqual(["-s", serial, "exec-out", "cat", "/data/app/x/base.apk"]);
  });

  it("renders closed APK install and lifecycle commands", () => {
    expect(
      renderAdbCommand({
        kind: "installApk",
        serial,
        apkPath: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\artifacts\\qa.apk",
      }),
    ).toEqual([
      "-s",
      serial,
      "install",
      "-r",
      "-t",
      "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\artifacts\\qa.apk",
    ]);
    expect(
      renderAdbCommand({ kind: "clearPackageData", serial, packageName: "com.example.game" }),
    ).toEqual(["-s", serial, "shell", "pm", "clear", "com.example.game"]);
    expect(
      renderAdbCommand({ kind: "uninstallPackage", serial, packageName: "com.example.game" }),
    ).toEqual(["-s", serial, "uninstall", "com.example.game"]);
    expect(
      renderAdbCommand({
        kind: "startActivity",
        serial,
        packageName: "com.example.game",
        activityName: "com.example.game.MainActivity",
      }),
    ).toEqual([
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-n",
      "com.example.game/com.example.game.MainActivity",
    ]);
    expect(
      renderAdbCommand({ kind: "forceStop", serial, packageName: "com.example.game" }),
    ).toEqual(["-s", serial, "shell", "am", "force-stop", "com.example.game"]);
    expect(renderAdbCommand({ kind: "foregroundActivity", serial })).toEqual([
      "-s",
      serial,
      "shell",
      "dumpsys",
      "activity",
      "activities",
    ]);
    expect(
      renderAdbCommand({ kind: "packagePid", serial, packageName: "com.example.game" }),
    ).toEqual(["-s", serial, "shell", "pidof", "com.example.game"]);
  });

  it("rejects invalid package names and paths outside the package directory", () => {
    expect(() =>
      renderAdbCommand({ kind: "packagePaths", serial, packageName: "bad package" }),
    ).toThrow();
    expect(() =>
      renderAdbCommand({
        kind: "streamPackageFile",
        serial,
        packageName: "com.example.game",
        filePath: "/sdcard/game.apk",
      }),
    ).toThrow(/data\/app/);
    expect(() =>
      renderAdbCommand({
        kind: "streamPackageFile",
        serial,
        packageName: "com.example.game",
        filePath: "/data/app/../secret.apk",
      }),
    ).toThrow(/data\/app/);
  });
});
