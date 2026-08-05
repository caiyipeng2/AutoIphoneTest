import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import { collectDeviceMetadata } from "./device-metadata.js";

describe("adb device metadata", () => {
  it("collects bounded metadata and parses display, battery, size, density, and orientation", async () => {
    const fixture = JSON.parse(
      await readFile("tests/fixtures/adb/device-metadata.json", "utf8"),
    ) as Record<string, unknown>;
    const serial = parseDeviceSerial("R5CX211TXNT");
    const calls: string[] = [];
    const result = await collectDeviceMetadata(serial, {
      execute: async (command) => {
        calls.push(command.kind);
        const value =
          command.kind === "getProp"
            ? (fixture.properties as Record<string, string>)[command.key]
            : command.kind === "wmSize"
              ? fixture.wmSize
              : command.kind === "wmDensity"
                ? fixture.wmDensity
                : command.kind === "dumpsysBattery"
                  ? fixture.battery
                  : fixture.display;
        return { exitCode: 0, timedOut: false, stdout: String(value), stderr: "" };
      },
    });

    expect(result).toMatchObject({
      serial,
      model: "SM-S9280",
      product: "epic6",
      device: "e3q",
      manufacturer: "samsung",
      androidRelease: "16",
      apiLevel: 36,
      abiList: ["arm64-v8a", "armeabi-v7a", "armeabi"],
      physicalSize: { width: 1440, height: 3088 },
      overrideSize: { width: 1080, height: 2400 },
      physicalDensity: 450,
      overrideDensity: 420,
      batteryPercentage: 87,
      charging: true,
      orientation: 90,
    });
    expect(calls).toHaveLength(11);
    expect(result.errors).toEqual([]);
  });

  it("keeps successful fields and attaches an error to each unavailable field", async () => {
    const serial = parseDeviceSerial("offline-1");
    const result = await collectDeviceMetadata(serial, {
      execute: async (command) => {
        if (command.kind === "getProp" && command.key === "ro.product.model") {
          return { exitCode: 0, timedOut: false, stdout: "Known Model\n", stderr: "" };
        }
        return { exitCode: 1, timedOut: false, stdout: "", stderr: "error: device offline" };
      },
    });

    expect(result.model).toBe("Known Model");
    expect(result.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining([
        "androidRelease",
        "physicalSize",
        "batteryPercentage",
        "orientation",
      ]),
    );
    expect(new Set(result.errors.map((error) => error.field)).size).toBe(result.errors.length);
  });

  it("never runs more than four metadata commands concurrently", async () => {
    let active = 0;
    let maximum = 0;
    const serial = parseDeviceSerial("bounded-1");
    await collectDeviceMetadata(serial, {
      execute: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { exitCode: 1, timedOut: false, stdout: "", stderr: "offline" };
      },
    });
    expect(maximum).toBeLessThanOrEqual(4);
  });
});
