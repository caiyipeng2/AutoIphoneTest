import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const scriptPath = join(repositoryRoot, "tests", "hardware", "m8-capacity-matrix.ts");

describe("M8 capacity matrix runner", () => {
  it("requires explicit serials and exposes a strict four-device gate", async () => {
    const source = await readFile(scriptPath, "utf8");
    expect(source).toContain("TEST_CENTER_M8_SERIALS");
    expect(source).toContain("TEST_CENTER_M8_REQUIRE_FOUR");
    expect(source).toContain("m11-portable-smoke.ts");
    expect(source).toContain("HARDWARE_UNAVAILABLE");
  });
});
