import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { win32 } from "node:path";

import { describe, expect, it } from "vitest";

import type { ProcessResult, ProcessSpec } from "./process-runner.js";
import { createDefaultEnvironmentProbes, verifyDirectoryWritable } from "./default-probes.js";
import { GIBIBYTE } from "./probes/drive-probe.js";
import { runEnvironmentDiagnostic } from "./run-diagnostic.js";

const projectRoot = "E:\\Projects\\TestCenter";
const dataRoot = `${projectRoot}\\data`;
const unityRoot = "D:\\Unity\\Editor";
const nodePath = `${projectRoot}\\tools\\node\\22.23.1\\node.exe`;
const adbPath = `${unityRoot}\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe`;
const javaPath = `${unityRoot}\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK\\bin\\java.exe`;
const unityPath = `${unityRoot}\\Unity.exe`;
const appiumPath = `${projectRoot}\\node_modules\\appium\\build\\lib\\main.js`;
const uiautomator2Path = `${projectRoot}\\node_modules\\appium-uiautomator2-driver\\package.json`;

describe("verifyDirectoryWritable", () => {
  it("proves create/write/delete access and rejects an existing non-directory target", async () => {
    const parent = win32.join(process.cwd(), "data", "tests");
    await mkdir(parent, { recursive: true });
    const sandbox = await mkdtemp(`${parent}\\write-probe-`);

    try {
      expect(await verifyDirectoryWritable(win32.join(sandbox, "future", "reports"))).toBe(true);
      expect(await readdir(sandbox)).toEqual([]);

      const filePath = win32.join(sandbox, "not-a-directory");
      await writeFile(filePath, "fixture", "utf8");
      expect(await verifyDirectoryWritable(filePath)).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe("createDefaultEnvironmentProbes", () => {
  it("uses project-local and verified Unity tools while keeping PATH diagnostic-only", async () => {
    const existing = createExistingPaths();
    const runner = new RecordingRunner();
    const probes = createDefaultEnvironmentProbes({
      projectRoot,
      dataRoot,
      unityEditorRoot: unityRoot,
      environment: {},
      pathValue: "C:\\Untrusted",
      pathExtensions: ".EXE",
      fileExists: async (path) =>
        existing.has(path.toLowerCase()) || path.toLowerCase() === "c:\\untrusted\\scrcpy.exe",
      pathExists: async (path) => existing.has(path.toLowerCase()),
      collectDriveSnapshot: async () => ({
        driveRoot: "E:\\",
        dataRoot,
        exists: true,
        freeBytes: 40 * GIBIBYTE,
        dataRootWritable: true,
      }),
      readPackageVersion: async () => undefined,
      checkPort: async () => true,
      runner,
    });

    const diagnostic = await runEnvironmentDiagnostic({
      probes,
      generatedAt: () => new Date("2026-08-04T00:00:00.000Z"),
    });

    expect(diagnostic.probes.map((probe) => probe.id)).toEqual([
      "adb",
      "appium",
      "bundletool",
      "drive",
      "java",
      "node",
      "ports",
      "scrcpy",
      "uiautomator2",
      "unity",
    ]);
    expect(findProbe(diagnostic, "node")).toMatchObject({
      severity: "HEALTHY",
      resolvedPath: nodePath,
    });
    expect(findProbe(diagnostic, "adb")).toMatchObject({
      severity: "HEALTHY",
      resolvedPath: adbPath,
      facts: { onlineCount: 1 },
    });
    expect(findProbe(diagnostic, "java")).toMatchObject({
      severity: "HEALTHY",
      resolvedPath: javaPath,
    });
    expect(findProbe(diagnostic, "unity")).toMatchObject({
      severity: "HEALTHY",
      resolvedPath: unityPath,
    });
    expect(findProbe(diagnostic, "scrcpy")).toMatchObject({
      severity: "DEGRADED",
      facts: { diagnosticPaths: ["C:\\Untrusted\\scrcpy.exe"] },
      errors: [{ category: "PATH_UNRESOLVED" }],
    });
    expect(
      runner.specs.some((spec) => spec.executablePath?.startsWith("C:\\Untrusted") === true),
    ).toBe(false);
    expect(
      runner.specs.every(
        (spec) => spec.executablePath !== undefined && win32.isAbsolute(spec.executablePath),
      ),
    ).toBe(true);
  });

  it("runs Appium's JavaScript entry through the pinned Node executable", async () => {
    const existing = createExistingPaths(appiumPath, uiautomator2Path);
    const runner = new RecordingRunner();
    const probes = createDefaultEnvironmentProbes({
      projectRoot,
      dataRoot,
      unityEditorRoot: unityRoot,
      environment: {},
      fileExists: async (path) => existing.has(path.toLowerCase()),
      pathExists: async (path) => existing.has(path.toLowerCase()),
      collectDriveSnapshot: async () => ({
        driveRoot: "E:\\",
        dataRoot,
        exists: true,
        freeBytes: 40 * GIBIBYTE,
        dataRootWritable: true,
      }),
      readPackageVersion: async (path) =>
        path.toLowerCase() === uiautomator2Path.toLowerCase() ? "8.2.2" : undefined,
      checkPort: async () => true,
      runner,
    });

    const diagnostic = await runEnvironmentDiagnostic({ probes });
    const appiumSpec = runner.specs.find((spec) => spec.executableId === "appium");

    expect(findProbe(diagnostic, "appium")).toMatchObject({ severity: "HEALTHY" });
    expect(findProbe(diagnostic, "uiautomator2")).toMatchObject({ severity: "HEALTHY" });
    expect(appiumSpec).toMatchObject({
      executablePath: nodePath,
      args: [appiumPath, "--version"],
      serialRequirement: "forbidden",
    });
    expect(appiumSpec?.executablePath?.endsWith(".cmd")).toBe(false);
  });
});

class RecordingRunner {
  public readonly specs: ProcessSpec[] = [];

  public async run(spec: ProcessSpec): Promise<ProcessResult> {
    this.specs.push(spec);
    const output = getOutput(spec);
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      durationMs: 1,
      stdout: output.stdout ?? "",
      stderr: output.stderr ?? "",
      stdoutTruncated: false,
      stderrTruncated: false,
      command: {
        executableId: spec.executableId,
        executablePath: spec.executablePath ?? "",
        args: [...spec.args],
      },
    };
  }
}

function getOutput(spec: ProcessSpec): { readonly stdout?: string; readonly stderr?: string } {
  if (spec.executableId === "node") {
    return { stdout: "v22.23.1\r\n" };
  }
  if (spec.executableId === "adb" && spec.args[0] === "version") {
    return {
      stdout: "Android Debug Bridge version 1.0.41\r\nVersion 35.0.0-11411520\r\n",
    };
  }
  if (spec.executableId === "adb" && spec.args[0] === "devices") {
    return { stdout: "List of devices attached\r\nSERIAL\tdevice model:SM-S9280\r\n" };
  }
  if (spec.executableId === "java") {
    return { stderr: 'openjdk version "17.0.19" 2026-04-21\r\n' };
  }
  if (spec.executableId === "powershell-file-version") {
    return { stdout: "2022.3.62f2_7670c08855a9\r\n" };
  }
  if (spec.executableId === "appium") {
    return { stdout: "3.6.0\r\n" };
  }
  throw new Error(`Unexpected process spec: ${spec.executableId} ${spec.args.join(" ")}`);
}

function createExistingPaths(...extra: readonly string[]): Set<string> {
  return new Set(
    [
      nodePath,
      adbPath,
      javaPath,
      unityPath,
      `${unityRoot}\\Data\\PlaybackEngines\\AndroidPlayer`,
      `${unityRoot}\\Data\\PlaybackEngines\\AndroidPlayer\\SDK`,
      `${unityRoot}\\Data\\PlaybackEngines\\AndroidPlayer\\NDK`,
      `${unityRoot}\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK`,
      ...extra,
    ].map((path) => path.toLowerCase()),
  );
}

function findProbe(diagnostic: Awaited<ReturnType<typeof runEnvironmentDiagnostic>>, id: string) {
  return diagnostic.probes.find((probe) => probe.id === id);
}
