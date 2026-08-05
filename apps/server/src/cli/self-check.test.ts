import { readFile } from "node:fs/promises";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";

import type { EnvironmentDiagnostic } from "@test-center/contracts/environment";
import { describe, expect, it, vi } from "vitest";

import { createDefaultOutputDirectory, parseSelfCheckArgs, runSelfCheck } from "./self-check.js";

const projectRoot = "E:\\Projects\\UnityMultiDeviceTestCenter";
const outputDirectory = "E:\\M0\\diagnostics";
const htmlPath = `${outputDirectory}\\environment-diagnostic-test.html`;
const jsonPath = `${outputDirectory}\\environment-diagnostic-test.json`;
const launcherPath = fileURLToPath(
  new URL("../../../../scripts/run-self-check.cmd", import.meta.url),
);
const diagnostic: EnvironmentDiagnostic = {
  schemaVersion: 1,
  generatedAt: "2026-08-04T03:04:05.678Z",
  overall: "DEGRADED",
  probes: [
    {
      id: "appium",
      severity: "DEGRADED",
      durationMs: 1,
      facts: {},
      errors: [
        {
          category: "TOOL_NOT_FOUND",
          message: "Appium is not installed.",
        },
      ],
    },
  ],
};

describe("parseSelfCheckArgs", () => {
  it("accepts one absolute output directory and the optional open flag", () => {
    expect(parseSelfCheckArgs(["--output", outputDirectory, "--open"])).toEqual({
      open: true,
      outputDirectory,
    });
  });

  it.each([
    { args: ["--output"], message: "requires" },
    { args: ["--output", "relative\\path"], message: "absolute Windows path" },
    { args: ["--output", "\\reports"], message: "fully qualified" },
    { args: ["--unknown"], message: "Unknown" },
    { args: ["--open", "--open"], message: "more than once" },
    {
      args: ["--output", outputDirectory, "--output", "E:\\Other"],
      message: "more than once",
    },
  ])("rejects ambiguous or unsupported arguments: $args", ({ args, message }) => {
    expect(() => parseSelfCheckArgs(args)).toThrow(message);
  });
});

describe("createDefaultOutputDirectory", () => {
  it("creates a deterministic absolute folder beneath the repository data directory", () => {
    const result = createDefaultOutputDirectory(projectRoot, new Date("2026-08-04T03:04:05.678Z"));

    expect(result).toBe(
      "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\diagnostics\\2026-08-04T03-04-05-678Z",
    );
    expect(win32.isAbsolute(result)).toBe(true);
  });

  it("rejects a root-relative project path whose drive depends on process state", () => {
    expect(() =>
      createDefaultOutputDirectory("\\Projects\\TestCenter", new Date("2026-08-04")),
    ).toThrow("fully qualified");
  });
});

describe("run-self-check launcher", () => {
  it("maps TypeScript build failures outside the diagnostic 0/2/3 exit-code contract", async () => {
    const launcher = await readFile(launcherPath, "utf8");

    expect(launcher).toMatch(/if errorlevel 1 exit \/b 10/i);
  });
});

describe("runSelfCheck", () => {
  it("publishes one report set, prints its evidence, opens only the HTML, and returns severity 2", async () => {
    const publish = vi.fn(async () => ({
      htmlPath,
      jsonPath,
      jsonSha256: "a".repeat(64),
    }));
    const openReport = vi.fn(async () => undefined);
    const lines: string[] = [];

    const exitCode = await runSelfCheck(["--output", outputDirectory, "--open"], {
      projectRoot,
      createProbes: () => [],
      runDiagnostic: async () => diagnostic,
      publishDiagnostic: publish,
      openReport,
      writeLine: (line) => lines.push(line),
    });

    expect(exitCode).toBe(2);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(diagnostic, { outputDirectory });
    expect(openReport).toHaveBeenCalledOnce();
    expect(openReport).toHaveBeenCalledWith(htmlPath);
    expect(lines).toEqual([
      "环境自检结果：DEGRADED",
      `JSON：${jsonPath}`,
      `HTML：${htmlPath}`,
      `SHA-256：${"a".repeat(64)}`,
    ]);
  });

  it("uses the timestamped default directory and does not open a report without --open", async () => {
    const publish = vi.fn(async () => ({
      htmlPath,
      jsonPath,
      jsonSha256: "b".repeat(64),
    }));
    const openReport = vi.fn(async () => undefined);

    const exitCode = await runSelfCheck([], {
      projectRoot,
      now: () => new Date("2026-08-04T03:04:05.678Z"),
      createProbes: () => [],
      runDiagnostic: async () => ({ ...diagnostic, overall: "HEALTHY" }),
      publishDiagnostic: publish,
      openReport,
      writeLine: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(publish).toHaveBeenCalledWith(expect.anything(), {
      outputDirectory:
        "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\diagnostics\\2026-08-04T03-04-05-678Z",
    });
    expect(openReport).not.toHaveBeenCalled();
  });
});
