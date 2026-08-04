import { describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import { renderAdbCommand, type AdbCommand } from "./commands.js";
import { AdbClient } from "./adb-client.js";

const serial = parseDeviceSerial("R5CX211TXNT");

describe("serial-bound adb commands", () => {
  it("renders devices -l without a target serial", () => {
    expect(renderAdbCommand({ kind: "devices" })).toEqual(["devices", "-l"]);
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
});
