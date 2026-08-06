import { describe, expect, it } from "vitest";

import { canonicalizeDeviceSpec, hashDeviceSpec } from "./device-spec.js";

describe("bundletool device spec", () => {
  it("canonicalizes object key order and hashes equivalent specs identically", () => {
    const first = { supportedAbis: ["arm64-v8a"], sdkVersion: 35, screenDensity: 420 };
    const second = { screenDensity: 420, sdkVersion: 35, supportedAbis: ["arm64-v8a"] };

    expect(canonicalizeDeviceSpec(first)).toBe(canonicalizeDeviceSpec(second));
    expect(hashDeviceSpec(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDeviceSpec(first)).toBe(hashDeviceSpec(second));
  });

  it("preserves array order because ABI preference is device-specific", () => {
    expect(canonicalizeDeviceSpec({ supportedAbis: ["arm64-v8a", "armeabi-v7a"] })).not.toBe(
      canonicalizeDeviceSpec({ supportedAbis: ["armeabi-v7a", "arm64-v8a"] }),
    );
  });
});
