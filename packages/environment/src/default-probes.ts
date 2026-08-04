import { randomUUID } from "node:crypto";
import { readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { win32 } from "node:path";

import { ProcessRunner, type ProcessResult, type ProcessSpec } from "./process-runner.js";
import { createAdbProbe, type AdbSnapshot } from "./probes/adb-probe.js";
import {
  createAppiumProbe,
  createUiAutomator2Probe,
  type NpmToolSnapshot,
} from "./probes/appium-probe.js";
import { createBundletoolProbe, type BundletoolSnapshot } from "./probes/bundletool-probe.js";
import { createDriveProbe, type DriveSnapshot } from "./probes/drive-probe.js";
import { createJavaProbe, type JavaSnapshot } from "./probes/java-probe.js";
import { createNodeProbe, type NodeSnapshot } from "./probes/node-probe.js";
import { createPortProbe } from "./probes/port-probe.js";
import { createScrcpyProbe, type ScrcpySnapshot } from "./probes/scrcpy-probe.js";
import { createUnityProbe, type UnitySnapshot } from "./probes/unity-probe.js";
import type { EnvironmentProbe } from "./run-diagnostic.js";
import { ToolResolver, type ToolResolution, type ToolResolutionRequest } from "./tool-resolver.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_UNITY_EDITOR_ROOT = "D:\\Unity\\Editor";

export interface ProcessRunnerLike {
  run(spec: ProcessSpec): Promise<ProcessResult>;
}

export interface ToolResolverLike {
  resolve(request: ToolResolutionRequest): Promise<ToolResolution>;
}

export interface DefaultEnvironmentProbeOptions {
  readonly projectRoot: string;
  readonly dataRoot: string;
  readonly unityEditorRoot?: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly pathValue?: string;
  readonly pathExtensions?: string;
  readonly timeoutMs?: number;
  readonly runner?: ProcessRunnerLike;
  readonly resolver?: ToolResolverLike;
  readonly fileExists?: (path: string) => Promise<boolean>;
  readonly pathExists?: (path: string) => Promise<boolean>;
  readonly collectDriveSnapshot?: () => Promise<DriveSnapshot>;
  readonly readPackageVersion?: (packageJsonPath: string) => Promise<string | undefined>;
  readonly checkPort?: (host: string, port: number) => Promise<boolean>;
}

interface CommandOutcome {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export function createDefaultEnvironmentProbes(
  options: DefaultEnvironmentProbeOptions,
): EnvironmentProbe[] {
  if (!win32.isAbsolute(options.projectRoot) || !win32.isAbsolute(options.dataRoot)) {
    throw new TypeError("Default environment probes require absolute Windows project/data paths.");
  }

  const projectRoot = win32.normalize(options.projectRoot);
  const dataRoot = win32.normalize(options.dataRoot);
  const driveRoot = win32.parse(dataRoot).root;
  const unityRoot = win32.normalize(options.unityEditorRoot ?? DEFAULT_UNITY_EDITOR_ROOT);
  const unityPath = win32.join(unityRoot, "Unity.exe");
  const androidRoot = win32.join(unityRoot, "Data", "PlaybackEngines", "AndroidPlayer");
  const environment = { ...(options.environment ?? process.env) };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fileExists = options.fileExists ?? isFile;
  const pathExists = options.pathExists ?? exists;
  const runner = options.runner ?? new ProcessRunner();
  const resolver =
    options.resolver ??
    new ToolResolver({
      projectRoot,
      ...(options.pathValue === undefined ? {} : { pathValue: options.pathValue }),
      ...(options.pathExtensions === undefined ? {} : { pathExtensions: options.pathExtensions }),
      fileExists,
    });
  const readPackageVersion = options.readPackageVersion ?? readVersionFromPackageJson;
  const checkPort = options.checkPort ?? isPortAvailable;
  const collectDrive =
    options.collectDriveSnapshot ??
    (async () => await collectWindowsDriveSnapshot(driveRoot, dataRoot));

  const resolveNode = async () =>
    await resolver.resolve({
      toolId: "node",
      projectLocalPaths: ["tools\\node\\22.23.1\\node.exe"],
      unityEmbeddedPaths: [],
      pathExecutableName: "node.exe",
    });
  const resolveJava = async () =>
    await resolver.resolve({
      toolId: "java",
      projectLocalPaths: [
        "tools\\java\\jdk-17.0.19+10\\bin\\java.exe",
        "tools\\java\\17.0.19+10\\bin\\java.exe",
      ],
      unityEmbeddedPaths: [
        {
          path: win32.join(androidRoot, "OpenJDK", "bin", "java.exe"),
          verified: true,
        },
      ],
      pathExecutableName: "java.exe",
    });
  const resolveAdb = async () =>
    await resolver.resolve({
      toolId: "adb",
      projectLocalPaths: ["tools\\android-sdk\\platform-tools\\adb.exe"],
      unityEmbeddedPaths: [
        {
          path: win32.join(androidRoot, "SDK", "platform-tools", "adb.exe"),
          verified: true,
        },
      ],
      pathExecutableName: "adb.exe",
    });

  return [
    createDriveProbe({ collectSnapshot: collectDrive }),
    createNodeProbe({
      collectSnapshot: async (): Promise<NodeSnapshot> => {
        const resolution = await resolveNode();
        if (resolution.selectedPath === undefined) {
          return { present: false, ...diagnosticResolutionFacts(resolution) };
        }
        const outcome = await runCommand(runner, {
          executableId: "node",
          executablePath: resolution.selectedPath,
          args: ["--version"],
          cwd: projectRoot,
          env: environment,
          timeoutMs,
          serialRequirement: "forbidden",
        });
        return {
          present: true,
          resolvedPath: resolution.selectedPath,
          versionOutput: combineOutput(outcome),
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
        };
      },
    }),
    createAdbProbe({
      collectSnapshot: async (): Promise<AdbSnapshot> => {
        const resolution = await resolveAdb();
        if (resolution.selectedPath === undefined) {
          return { present: false, ...diagnosticResolutionFacts(resolution) };
        }
        const version = await runCommand(runner, {
          executableId: "adb",
          executablePath: resolution.selectedPath,
          args: ["version"],
          cwd: projectRoot,
          env: environment,
          timeoutMs,
          serialRequirement: "forbidden",
        });
        const devices = await runCommand(runner, {
          executableId: "adb",
          executablePath: resolution.selectedPath,
          args: ["devices", "-l"],
          cwd: projectRoot,
          env: environment,
          timeoutMs,
          serialRequirement: "forbidden",
        });
        return {
          present: true,
          resolvedPath: resolution.selectedPath,
          versionOutput: combineOutput(version),
          versionExitCode: version.exitCode,
          devicesOutput: combineOutput(devices),
          devicesExitCode: devices.exitCode,
          timedOut: version.timedOut || devices.timedOut,
        };
      },
    }),
    createJavaProbe({
      collectSnapshot: async (): Promise<JavaSnapshot> => {
        const resolution = await resolveJava();
        if (resolution.selectedPath === undefined) {
          return { present: false, ...diagnosticResolutionFacts(resolution) };
        }
        const outcome = await runCommand(runner, {
          executableId: "java",
          executablePath: resolution.selectedPath,
          args: ["-version"],
          cwd: projectRoot,
          env: environment,
          timeoutMs,
          serialRequirement: "forbidden",
        });
        return {
          present: true,
          resolvedPath: resolution.selectedPath,
          versionOutput: combineOutput(outcome),
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
        };
      },
    }),
    createAppiumProbe({
      collectSnapshot: async (): Promise<NpmToolSnapshot> => {
        const [node, appium] = await Promise.all([
          resolveNode(),
          resolver.resolve({
            toolId: "appium",
            projectLocalPaths: [
              "node_modules\\appium\\build\\lib\\main.js",
              "node_modules\\appium\\index.js",
            ],
            unityEmbeddedPaths: [],
          }),
        ]);
        if (appium.selectedPath === undefined) {
          return { present: false };
        }
        if (node.selectedPath === undefined) {
          return { present: true, resolvedPath: appium.selectedPath, exitCode: null };
        }
        const outcome = await runCommand(runner, {
          executableId: "appium",
          executablePath: node.selectedPath,
          args: [appium.selectedPath, "--version"],
          cwd: projectRoot,
          env: environment,
          timeoutMs,
          serialRequirement: "forbidden",
        });
        return {
          present: true,
          resolvedPath: appium.selectedPath,
          versionOutput: combineOutput(outcome),
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
        };
      },
    }),
    createUiAutomator2Probe({
      collectSnapshot: async (): Promise<NpmToolSnapshot> => {
        const resolution = await resolver.resolve({
          toolId: "uiautomator2",
          projectLocalPaths: ["node_modules\\appium-uiautomator2-driver\\package.json"],
          unityEmbeddedPaths: [],
        });
        if (resolution.selectedPath === undefined) {
          return { present: false };
        }
        const version = await readPackageVersion(resolution.selectedPath);
        return {
          present: true,
          resolvedPath: resolution.selectedPath,
          ...(version === undefined ? {} : { versionOutput: version }),
          exitCode: version === undefined ? null : 0,
          timedOut: false,
        };
      },
    }),
    createBundletoolProbe({
      collectSnapshot: async (): Promise<BundletoolSnapshot> => {
        const [java, bundletool] = await Promise.all([
          resolveJava(),
          resolver.resolve({
            toolId: "bundletool",
            projectLocalPaths: [
              "tools\\bundletool\\bundletool-all-1.18.3.jar",
              "tools\\bundletool\\1.18.3\\bundletool-all-1.18.3.jar",
            ],
            unityEmbeddedPaths: [],
          }),
        ]);
        if (bundletool.selectedPath === undefined) {
          return { present: false };
        }
        if (java.selectedPath === undefined) {
          return { present: true, resolvedPath: bundletool.selectedPath, exitCode: null };
        }
        const outcome = await runCommand(runner, {
          executableId: "bundletool",
          executablePath: java.selectedPath,
          args: ["-jar", bundletool.selectedPath, "version"],
          cwd: projectRoot,
          env: environment,
          timeoutMs,
          serialRequirement: "forbidden",
        });
        return {
          present: true,
          resolvedPath: bundletool.selectedPath,
          javaPath: java.selectedPath,
          versionOutput: combineOutput(outcome),
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
        };
      },
    }),
    createScrcpyProbe({
      collectSnapshot: async (): Promise<ScrcpySnapshot> => {
        const resolution = await resolver.resolve({
          toolId: "scrcpy",
          projectLocalPaths: [
            "tools\\scrcpy\\scrcpy-win64-v3.1\\scrcpy.exe",
            "tools\\scrcpy\\3.1\\scrcpy.exe",
          ],
          unityEmbeddedPaths: [],
          pathExecutableName: "scrcpy.exe",
        });
        if (resolution.selectedPath === undefined) {
          return { present: false, ...diagnosticResolutionFacts(resolution) };
        }
        const outcome = await runCommand(runner, {
          executableId: "scrcpy",
          executablePath: resolution.selectedPath,
          args: ["--version"],
          cwd: projectRoot,
          env: environment,
          timeoutMs,
          serialRequirement: "forbidden",
        });
        return {
          present: true,
          resolvedPath: resolution.selectedPath,
          versionOutput: combineOutput(outcome),
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
        };
      },
    }),
    createUnityProbe({
      collectSnapshot: async (): Promise<UnitySnapshot> => {
        if (!(await fileExists(unityPath))) {
          return { present: false };
        }
        const version = await readUnityProductVersion(
          runner,
          projectRoot,
          unityPath,
          environment,
          timeoutMs,
        );
        return {
          present: true,
          editorPath: unityPath,
          ...(version === undefined ? {} : { version }),
          androidModules: {
            androidPlayer: await pathExists(androidRoot),
            sdk: await pathExists(win32.join(androidRoot, "SDK")),
            adb: await fileExists(win32.join(androidRoot, "SDK", "platform-tools", "adb.exe")),
            jdk: await pathExists(win32.join(androidRoot, "OpenJDK")),
            ndk: await pathExists(win32.join(androidRoot, "NDK")),
          },
        };
      },
    }),
    createPortProbe({
      collectSnapshot: async () => ({
        ports: [
          {
            name: "appium",
            host: "127.0.0.1",
            port: 4723,
            available: await checkPort("127.0.0.1", 4723),
          },
        ],
      }),
    }),
  ];
}

async function runCommand(runner: ProcessRunnerLike, spec: ProcessSpec): Promise<CommandOutcome> {
  try {
    const result = await runner.run(spec);
    return {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      exitCode: null,
      timedOut: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Process execution failed.",
    };
  }
}

function combineOutput(outcome: CommandOutcome): string {
  return [outcome.stdout, outcome.stderr].filter(Boolean).join("\n").trim();
}

function diagnosticResolutionFacts(resolution: ToolResolution): {
  readonly diagnosticPaths?: readonly string[];
} {
  const diagnosticPaths = [
    ...new Set(
      resolution.candidates
        .filter((candidate) => candidate.exists && !candidate.runtimeEligible)
        .map((candidate) => candidate.path),
    ),
  ];
  return diagnosticPaths.length === 0 ? {} : { diagnosticPaths };
}

async function readUnityProductVersion(
  runner: ProcessRunnerLike,
  projectRoot: string,
  unityPath: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  timeoutMs: number,
): Promise<string | undefined> {
  const systemRoot = environment.SystemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
  const powershellPath = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const scriptPath = win32.join(projectRoot, "scripts", "read-file-version.ps1");
  // Use a trusted script file and argument array so Unity metadata is read without
  // launching the editor or constructing an executable PowerShell command string.
  const outcome = await runCommand(runner, {
    executableId: "powershell-file-version",
    executablePath: powershellPath,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-LiteralPath",
      unityPath,
    ],
    cwd: projectRoot,
    env: environment,
    timeoutMs,
    serialRequirement: "forbidden",
  });
  if (outcome.exitCode !== 0 || outcome.timedOut) {
    return undefined;
  }
  return combineOutput(outcome).match(/(\d+\.\d+\.\d+f\d+)/i)?.[1];
}

async function collectWindowsDriveSnapshot(
  driveRoot: string,
  dataRoot: string,
): Promise<DriveSnapshot> {
  try {
    const drive = await stat(driveRoot);
    if (!drive.isDirectory()) {
      return { driveRoot, dataRoot, exists: false };
    }
    const driveStats = await statfs(driveRoot);
    return {
      driveRoot,
      dataRoot,
      exists: true,
      freeBytes: driveStats.bavail * driveStats.bsize,
      dataRootWritable: await verifyDirectoryWritable(dataRoot),
    };
  } catch {
    return { driveRoot, dataRoot, exists: false };
  }
}

export async function verifyDirectoryWritable(path: string): Promise<boolean> {
  let candidate = win32.normalize(path);
  while (true) {
    try {
      const candidateStat = await stat(candidate);
      if (!candidateStat.isDirectory()) {
        return false;
      }

      // fs.access(W_OK) does not evaluate Windows ACLs reliably. A same-directory
      // exclusive create/write/delete proves that diagnostic publication can work.
      const markerPath = win32.join(candidate, `.test-center-write-probe-${randomUUID()}.tmp`);
      let created = false;
      try {
        await writeFile(markerPath, "write-probe\n", { encoding: "utf8", flag: "wx" });
        created = true;
        await rm(markerPath);
        return true;
      } catch {
        if (created) {
          await rm(markerPath, { force: true }).catch(() => undefined);
        }
        return false;
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        return false;
      }
      const parent = win32.dirname(candidate);
      if (parent === candidate) {
        return false;
      }
      candidate = parent;
    }
  }
}

async function readVersionFromPackageJson(path: string): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return isRecord(value) && typeof value.version === "string" ? value.version : undefined;
  } catch {
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => resolve(error === undefined));
    });
  });
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
