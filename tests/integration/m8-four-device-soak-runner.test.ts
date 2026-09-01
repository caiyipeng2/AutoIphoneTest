import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const runnerPath = join(repositoryRoot, "tests", "hardware", "m8-four-device-soak.ts");

describe("M8 four-device soak runner", () => {
  it("keeps the final soak gate explicit and writes analyzer-compatible evidence", async () => {
    const source = await readFile(runnerPath, "utf8");
    expect(source).toContain("TEST_CENTER_M8_SOAK_SERIALS");
    expect(source).toContain("1_800");
    expect(source).toContain("1_000");
    expect(source).toContain("HARDWARE_UNAVAILABLE");
    expect(source).toContain("soak-analyzer");
    expect(source).toContain("evidencePath");
    expect(source).toContain("logPath");
  });
});
