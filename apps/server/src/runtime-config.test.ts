import { describe, expect, it } from "vitest";

import { parseBridgeMode } from "./runtime-config.js";

describe("parseBridgeMode", () => {
  it("defaults to required bridge mode", () => {
    expect(parseBridgeMode({})).toBe("REQUIRED");
  });

  it("accepts explicit Appium-only mode for production packages without QA Bridge", () => {
    expect(parseBridgeMode({ TEST_CENTER_BRIDGE_MODE: "optional" })).toBe("APPIUM_ONLY");
  });

  it("rejects unknown values instead of silently weakening synchronization guarantees", () => {
    expect(() => parseBridgeMode({ TEST_CENTER_BRIDGE_MODE: "anything" })).toThrow(
      "TEST_CENTER_BRIDGE_MODE",
    );
  });
});
