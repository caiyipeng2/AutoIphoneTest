import { describe, expect, it } from "vitest";

import { parseBridgeMode, parseUnityCommandConfig } from "./runtime-config.js";

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

describe("parseUnityCommandConfig", () => {
  it("keeps the optional provider disabled until all explicit settings exist", () => {
    expect(parseUnityCommandConfig({})).toBeUndefined();
  });

  it("parses an explicit Unity executable, project, and argument template list", () => {
    expect(
      parseUnityCommandConfig({
        TEST_CENTER_UNITY_EXECUTABLE_PATH: "D:\\Unity\\Editor\\Unity.exe",
        TEST_CENTER_UNITY_PROJECT_PATH: "E:\\Games\\IdleWeaponShopTycoon",
        TEST_CENTER_UNITY_BUILD_ARGS_JSON:
          '["-batchmode","-projectPath","${projectPath}","${artifactPath}"]',
      }),
    ).toEqual({
      executablePath: "D:\\Unity\\Editor\\Unity.exe",
      projectPath: "E:\\Games\\IdleWeaponShopTycoon",
      argumentTemplates: ["-batchmode", "-projectPath", "${projectPath}", "${artifactPath}"],
    });
  });

  it("rejects partial, malformed, or empty command configuration", () => {
    expect(() =>
      parseUnityCommandConfig({
        TEST_CENTER_UNITY_EXECUTABLE_PATH: "D:\\Unity\\Editor\\Unity.exe",
      }),
    ).toThrow("must be configured together");
    expect(() =>
      parseUnityCommandConfig({
        TEST_CENTER_UNITY_EXECUTABLE_PATH: "D:\\Unity\\Editor\\Unity.exe",
        TEST_CENTER_UNITY_PROJECT_PATH: "E:\\Games\\IdleWeaponShopTycoon",
        TEST_CENTER_UNITY_BUILD_ARGS_JSON: "{}",
      }),
    ).toThrow("JSON array");
    expect(() =>
      parseUnityCommandConfig({
        TEST_CENTER_UNITY_EXECUTABLE_PATH: "D:\\Unity\\Editor\\Unity.exe",
        TEST_CENTER_UNITY_PROJECT_PATH: "E:\\Games\\IdleWeaponShopTycoon",
        TEST_CENTER_UNITY_BUILD_ARGS_JSON: "[]",
      }),
    ).toThrow("at least one argument");
  });
});
