import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { parseDevicesOutput } from "./parse-devices.js";

describe("adb device list parser", () => {
  it("normalizes online output, ignores daemon banners, and keeps metadata tokens", async () => {
    const output = await readFile("tests/fixtures/adb/devices-online.txt", "utf8");
    expect(parseDevicesOutput(output)).toEqual([
      expect.objectContaining({
        serial: "R5CX211TXNT",
        state: "ONLINE",
        model: "SM-S9280",
        product: "epic6",
        device: "e3q",
      }),
    ]);
  });

  it("returns stable states and one row per serial for mixed duplicate output", async () => {
    const output = await readFile("tests/fixtures/adb/devices-mixed.txt", "utf8");
    expect(parseDevicesOutput(output)).toEqual([
      expect.objectContaining({ serial: "R5CX211TXNT", state: "ONLINE" }),
      expect.objectContaining({ serial: "emulator-5554", state: "UNAUTHORIZED" }),
      expect.objectContaining({ serial: "ZX1G22OFF", state: "OFFLINE" }),
    ]);
    expect(parseDevicesOutput(output).map((device) => device.serial)).toEqual([
      "R5CX211TXNT",
      "emulator-5554",
      "ZX1G22OFF",
    ]);
  });
});
