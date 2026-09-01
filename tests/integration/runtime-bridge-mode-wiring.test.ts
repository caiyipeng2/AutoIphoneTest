import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..", "..");

describe("runtime bridge mode wiring", () => {
  it("passes the parsed default bridge mode into session route construction", async () => {
    const source = await readFile(
      join(repositoryRoot, "apps", "server", "src", "device-runtime.ts"),
      "utf8",
    );
    expect(source).toMatch(/leaderVideoRecorder,\s*\n\s*bridgeMode,\s*\n\s*\);/);
  });
});
