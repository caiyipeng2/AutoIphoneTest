import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const actionScripts = [
  "m9-activate.ts",
  "m9-back.ts",
  "m9-longpress-drag.ts",
  "m9-terminate.ts",
  "m9-restart.ts",
];
const longPressDragScript = join(repositoryRoot, "tests", "hardware", "m9-longpress-drag.ts");

describe("M9 hardware action readiness", () => {
  it("gives every cold Appium action start the managed 60-second readiness window", async () => {
    for (const script of actionScripts) {
      const source = await readFile(join(repositoryRoot, "tests", "hardware", script), "utf8");
      expect(source, script).toContain("readinessTimeoutMs: 60_000");
    }
  });

  it("uses the connected device viewport for pointer coordinates", async () => {
    const source = await readFile(longPressDragScript, "utf8");
    expect(source).toContain('kind: "wmSize"');
    expect(source).not.toContain("const viewport = { width: 1080, height: 2340 }");
  });
});
