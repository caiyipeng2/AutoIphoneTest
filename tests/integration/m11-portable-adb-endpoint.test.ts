import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const scriptPath = join(repositoryRoot, "tests", "hardware", "m11-portable-smoke.ts");

describe("M11 portable ADB endpoint", () => {
  it("propagates the configured shared ADB port to direct discovery and package checks", async () => {
    const source = await readFile(scriptPath, "utf8");
    expect(source).toContain("TEST_CENTER_APPIUM_ADB_PORT");
    expect(source).toContain("ANDROID_ADB_SERVER_PORT");
    expect(source).toContain("ADB_SERVER_SOCKET");
    expect(source).toContain("createAdbEnvironment");
    expect(source).toContain("env: adbEnv");
  });
});
