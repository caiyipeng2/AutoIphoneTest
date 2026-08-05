import { spawn } from "node:child_process";
import { resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDefaultEnvironmentProbes } from "@test-center/environment/default-probes";
import {
  getDiagnosticExitCode,
  publishDiagnostic as publishEnvironmentDiagnostic,
  type PublishedDiagnostic,
} from "@test-center/environment/publish-diagnostic";
import {
  runEnvironmentDiagnostic,
  type EnvironmentProbe,
} from "@test-center/environment/run-diagnostic";

interface ParsedSelfCheckArgs {
  readonly open: boolean;
  readonly outputDirectory?: string;
}

export interface SelfCheckDependencies {
  readonly projectRoot: string;
  readonly now?: () => Date;
  readonly createProbes?: (options: {
    readonly projectRoot: string;
    readonly dataRoot: string;
  }) => readonly EnvironmentProbe[];
  readonly runDiagnostic?: typeof runEnvironmentDiagnostic;
  readonly publishDiagnostic?: typeof publishEnvironmentDiagnostic;
  readonly openReport?: (htmlPath: string) => Promise<void>;
  readonly writeLine?: (line: string) => void;
}

export function parseSelfCheckArgs(args: readonly string[]): ParsedSelfCheckArgs {
  let open = false;
  let outputDirectory: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--open") {
      if (open) {
        throw new TypeError("--open cannot be specified more than once.");
      }
      open = true;
      continue;
    }
    if (argument === "--output") {
      if (outputDirectory !== undefined) {
        throw new TypeError("--output cannot be specified more than once.");
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new TypeError("--output requires an absolute Windows directory.");
      }
      if (!isFullyQualifiedWindowsPath(value)) {
        throw new TypeError("--output must be a fully qualified absolute Windows path.");
      }
      outputDirectory = win32.normalize(value);
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown self-check argument '${argument ?? ""}'.`);
  }

  return {
    open,
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
  };
}

export function createDefaultOutputDirectory(projectRoot: string, now: Date): string {
  if (!isFullyQualifiedWindowsPath(projectRoot)) {
    throw new TypeError("Self-check projectRoot must be a fully qualified Windows path.");
  }
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("Self-check output timestamp is invalid.");
  }
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return win32.join(projectRoot, "data", "diagnostics", timestamp);
}

function isFullyQualifiedWindowsPath(value: string): boolean {
  if (!win32.isAbsolute(value)) {
    return false;
  }
  const root = win32.parse(value).root;
  return root !== "\\" && root !== "/";
}

export async function runSelfCheck(
  args: readonly string[],
  dependencies: SelfCheckDependencies,
): Promise<0 | 2 | 3> {
  const parsed = parseSelfCheckArgs(args);
  const now = (dependencies.now ?? (() => new Date()))();
  const projectRoot = win32.normalize(dependencies.projectRoot);
  const outputDirectory = parsed.outputDirectory ?? createDefaultOutputDirectory(projectRoot, now);
  const dataRoot = win32.join(projectRoot, "data");
  const createProbes = dependencies.createProbes ?? createDefaultEnvironmentProbes;
  const runDiagnostic = dependencies.runDiagnostic ?? runEnvironmentDiagnostic;
  const publishDiagnostic = dependencies.publishDiagnostic ?? publishEnvironmentDiagnostic;
  const probes = createProbes({ projectRoot, dataRoot });
  const diagnostic = await runDiagnostic({ probes, generatedAt: () => now });
  const published = await publishDiagnostic(diagnostic, { outputDirectory });

  writeEvidence(published, diagnostic.overall, dependencies.writeLine ?? console.log);
  if (parsed.open) {
    await (dependencies.openReport ?? openHtmlReport)(published.htmlPath);
  }
  return getDiagnosticExitCode(diagnostic.overall);
}

async function openHtmlReport(htmlPath: string): Promise<void> {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const explorerPath = win32.join(systemRoot, "explorer.exe");
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const child = spawn(explorerPath, [htmlPath], {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", rejectOpen);
    child.once("spawn", () => {
      child.unref();
      resolveOpen();
    });
  });
}

function writeEvidence(
  published: PublishedDiagnostic,
  severity: "HEALTHY" | "DEGRADED" | "FATAL",
  writeLine: (line: string) => void,
): void {
  writeLine(`环境自检结果：${severity}`);
  writeLine(`JSON：${published.jsonPath}`);
  writeLine(`HTML：${published.htmlPath}`);
  writeLine(`SHA-256：${published.jsonSha256}`);
}

function getProjectRoot(): string {
  return win32.normalize(fileURLToPath(new URL("../../../../", import.meta.url)));
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<0 | 2 | 3> {
  try {
    return await runSelfCheck(args, { projectRoot: getProjectRoot() });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown environment self-check error.";
    console.error(`环境自检失败：${message}`);
    return 3;
  }
}

function isDirectInvocation(moduleUrl: string, argvEntry: string | undefined): boolean {
  return argvEntry !== undefined && pathToFileURL(resolve(argvEntry)).href === moduleUrl;
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  process.exitCode = await main();
}
