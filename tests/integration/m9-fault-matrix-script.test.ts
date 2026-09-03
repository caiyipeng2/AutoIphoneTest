import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const scriptPath = new URL("../../tests/hardware/m9-fault-matrix.ts", import.meta.url);

describe("M9 physical fault matrix runner", () => {
  it("propagates the configured shared ADB endpoint to force-stop injection", async () => {
    const source = await readFile(scriptPath, "utf8");

    expect(source).toContain("TEST_CENTER_APPIUM_ADB_PORT");
    expect(source).toContain("TEST_CENTER_ADB_SERVER_PORT");
    expect(source).toContain("ADB_SERVER_SOCKET");
    expect(source).toContain("ANDROID_ADB_SERVER_PORT");
    expect(source).toContain("env: adbEnv");
    expect(source).toContain("forceStopResult.exitCode");
    expect(source).toContain("forceStopResult.timedOut");
  });
});
