import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const scriptPath = join(repositoryRoot, "tests", "hardware", "m11-portable-smoke.ts");
const stabilityScriptPath = join(repositoryRoot, "tests", "hardware", "m11-stability.ts");

describe("M11 portable ADB endpoint", () => {
  it("propagates the configured shared ADB port to direct discovery and package checks", async () => {
    const source = await readFile(scriptPath, "utf8");
    expect(source).toContain("TEST_CENTER_APPIUM_ADB_PORT");
    expect(source).toContain("ANDROID_ADB_SERVER_PORT");
    expect(source).toContain("ADB_SERVER_SOCKET");
    expect(source).toContain("createAdbEnvironment");
    expect(source).toContain("env: adbEnv");
  });

  it("propagates the configured shared ADB port to stability metrics and checkpoints", async () => {
    const source = await readFile(stabilityScriptPath, "utf8");
    expect(source).toContain("TEST_CENTER_APPIUM_ADB_PORT");
    expect(source).toContain("ANDROID_ADB_SERVER_PORT");
    expect(source).toContain("ADB_SERVER_SOCKET");
    expect(source).toContain("createAdbEnvironment");
    expect(source).toContain("env: adbEnv");
  });

  it("keeps selected devices awake for unattended stability runs and restores their state", async () => {
    const source = await readFile(stabilityScriptPath, "utf8");
    expect(source).toContain('"stayon"');
    expect(source).toContain("readStayAwakeState");
    expect(source).toContain("restoreStayAwake");
  });

  it("allows the stability runner to exercise the explicit quarantine policy", async () => {
    const source = await readFile(stabilityScriptPath, "utf8");
    expect(source).toContain("TEST_CENTER_M11_FAILURE_POLICY");
    expect(source).toContain("QUARANTINE_FAILED_DEVICE");
  });
});
