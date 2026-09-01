import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const scriptPath = new URL("../../scripts/build-portable.ps1", import.meta.url);

describe("portable build script", () => {
  it("resolves script-relative defaults after PowerShell parameter binding", async () => {
    const source = await readFile(scriptPath, "utf8");

    expect(source).not.toContain("$ProjectRoot = (Join-Path $PSScriptRoot");
    expect(source).not.toContain("$OutputRoot = (Join-Path $PSScriptRoot");
    expect(source).not.toContain("$ReleaseRoot = (Join-Path $PSScriptRoot");
    expect(source).toContain("IsNullOrWhiteSpace($ProjectRoot)");
    expect(source).toContain("IsNullOrWhiteSpace($OutputRoot)");
    expect(source).toContain("IsNullOrWhiteSpace($ReleaseRoot)");
  });
});
