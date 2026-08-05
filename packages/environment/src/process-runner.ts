import { spawn } from "node:child_process";
import { win32 } from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TASKKILL_TIMEOUT_MS = 5_000;
const REDACTED_ARGUMENT = "[REDACTED]";

const ADB_HOST_COMMANDS = new Set([
  "connect",
  "devices",
  "disconnect",
  "help",
  "host-features",
  "kill-server",
  "server-status",
  "start-server",
  "track-devices",
  "version",
]);

export type ProcessRunnerErrorCode =
  | "EXECUTABLE_PATH_REQUIRED"
  | "INVALID_PROCESS_SPEC"
  | "PROCESS_SPAWN_FAILED"
  | "PROCESS_TERMINATION_FAILED"
  | "SERIAL_ARGUMENT_FORBIDDEN"
  | "SERIAL_FORBIDDEN"
  | "SERIAL_REQUIRED";

export class ProcessRunnerError extends Error {
  public readonly code: ProcessRunnerErrorCode;

  public constructor(code: ProcessRunnerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProcessRunnerError";
    this.code = code;
  }
}

export interface ProcessSpec {
  readonly executableId: string;
  readonly executablePath?: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs: number;
  readonly serial?: string;
  readonly serialRequirement?: "required" | "optional" | "forbidden";
  readonly redactedArgumentIndexes?: readonly number[];
  readonly maxOutputBytes?: number;
  readonly stdoutSink?: (chunk: Buffer) => void;
}

export interface ProcessCommandMetadata {
  readonly executableId: string;
  readonly executablePath: string;
  readonly args: readonly string[];
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly command: ProcessCommandMetadata;
}

export interface ProcessRunnerOptions {
  readonly maxOutputBytes?: number;
  readonly terminateProcessTree?: (processId: number) => Promise<void>;
}

interface HostProcessSpec {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

class CappedOutput {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;
  public truncated = false;

  public constructor(private readonly maximumBytes: number) {}

  public append(chunk: Buffer): void {
    const remainingBytes = this.maximumBytes - this.byteLength;
    if (remainingBytes <= 0) {
      this.truncated = true;
      return;
    }

    const acceptedChunk =
      chunk.byteLength <= remainingBytes ? chunk : chunk.subarray(0, remainingBytes);
    this.chunks.push(acceptedChunk);
    this.byteLength += acceptedChunk.byteLength;
    if (acceptedChunk.byteLength < chunk.byteLength) {
      this.truncated = true;
    }
  }

  public toString(): string {
    return Buffer.concat(this.chunks, this.byteLength).toString("utf8");
  }
}

export class ProcessRunner {
  private readonly maximumOutputBytes: number;
  private readonly terminateProcessTree: (processId: number) => Promise<void>;

  public constructor(options: ProcessRunnerOptions = {}) {
    this.maximumOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isSafeInteger(this.maximumOutputBytes) || this.maximumOutputBytes <= 0) {
      throw new ProcessRunnerError(
        "INVALID_PROCESS_SPEC",
        "maxOutputBytes must be a positive safe integer.",
      );
    }
    this.terminateProcessTree = options.terminateProcessTree ?? terminateWindowsProcessTree;
  }

  public async run(spec: ProcessSpec): Promise<ProcessResult> {
    const serialRequirement = getSerialRequirement(spec);
    if (serialRequirement === "required" && !spec.serial) {
      throw new ProcessRunnerError(
        "SERIAL_REQUIRED",
        `Executable '${spec.executableId}' requires an explicit device serial.`,
      );
    }
    if (serialRequirement === "forbidden" && spec.serial) {
      throw new ProcessRunnerError(
        "SERIAL_FORBIDDEN",
        `Executable '${spec.executableId}' does not accept a device serial.`,
      );
    }
    if (spec.executableId === "adb" && spec.args.some((argument) => argument === "-s")) {
      throw new ProcessRunnerError(
        "SERIAL_ARGUMENT_FORBIDDEN",
        "ADB serial selection must use ProcessSpec.serial instead of a raw -s argument.",
      );
    }

    if (!spec.executablePath || !win32.isAbsolute(spec.executablePath)) {
      throw new ProcessRunnerError(
        "EXECUTABLE_PATH_REQUIRED",
        `Executable '${spec.executableId}' requires an absolute executablePath.`,
      );
    }
    if (!win32.isAbsolute(spec.cwd)) {
      throw new ProcessRunnerError("INVALID_PROCESS_SPEC", "Process cwd must be an absolute path.");
    }
    if (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs <= 0) {
      throw new ProcessRunnerError(
        "INVALID_PROCESS_SPEC",
        "Process timeoutMs must be greater than zero.",
      );
    }

    const effectiveArguments = buildEffectiveArguments(spec);
    const command = buildCommandMetadata(spec, effectiveArguments);
    const stdout = new CappedOutput(spec.maxOutputBytes ?? this.maximumOutputBytes);
    const stderr = new CappedOutput(this.maximumOutputBytes);
    const startedAt = performance.now();
    let timedOut = false;
    let terminationFailure: unknown;
    let terminationPromise: Promise<void> | undefined;

    const child = spawn(spec.executablePath, effectiveArguments, {
      cwd: spec.cwd,
      env: { ...spec.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      spec.stdoutSink?.(chunk);
      stdout.append(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));

    return await new Promise<ProcessResult>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        if (child.pid === undefined) {
          child.kill();
          return;
        }

        terminationPromise = this.terminateProcessTree(child.pid).catch((error: unknown) => {
          terminationFailure = error;
          child.kill();
        });
      }, spec.timeoutMs);

      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(
          new ProcessRunnerError(
            "PROCESS_SPAWN_FAILED",
            `Failed to start '${spec.executableId}': ${error.message}`,
            { cause: error },
          ),
        );
      });

      child.once("close", async (exitCode, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        await terminationPromise;

        if (terminationFailure !== undefined) {
          reject(
            new ProcessRunnerError(
              "PROCESS_TERMINATION_FAILED",
              `Timed-out process '${spec.executableId}' could not be terminated as a tree.`,
              { cause: terminationFailure },
            ),
          );
          return;
        }

        resolve({
          exitCode,
          signal,
          timedOut,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
          command,
        });
      });
    });
  }
}

function getSerialRequirement(spec: ProcessSpec): "required" | "optional" | "forbidden" {
  if (spec.serialRequirement !== undefined) {
    return spec.serialRequirement;
  }
  if (spec.executableId !== "adb") {
    return "optional";
  }

  const command = spec.args[0]?.toLowerCase();
  return command !== undefined && ADB_HOST_COMMANDS.has(command) ? "optional" : "required";
}

function buildEffectiveArguments(spec: ProcessSpec): string[] {
  const argumentsCopy = [...spec.args];
  if (spec.executableId === "adb" && spec.serial) {
    return ["-s", spec.serial, ...argumentsCopy];
  }
  return argumentsCopy;
}

function buildCommandMetadata(
  spec: ProcessSpec,
  effectiveArguments: readonly string[],
): ProcessCommandMetadata {
  const redactedIndexes = new Set(spec.redactedArgumentIndexes ?? []);
  const serialPrefixLength = spec.executableId === "adb" && spec.serial ? 2 : 0;
  const redactedArguments = effectiveArguments.map((argument, effectiveIndex) => {
    const originalIndex = effectiveIndex - serialPrefixLength;
    return originalIndex >= 0 && redactedIndexes.has(originalIndex) ? REDACTED_ARGUMENT : argument;
  });

  return {
    executableId: spec.executableId,
    executablePath: spec.executablePath as string,
    args: redactedArguments,
  };
}

async function terminateWindowsProcessTree(processId: number): Promise<void> {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const taskkillPath = win32.join(systemRoot, "System32", "taskkill.exe");
  const exitCode = await runHostProcess({
    executablePath: taskkillPath,
    args: ["/PID", String(processId), "/T", "/F"],
    timeoutMs: TASKKILL_TIMEOUT_MS,
  });
  if (exitCode !== 0) {
    throw new Error(`taskkill.exe exited with code ${String(exitCode)}.`);
  }
}

async function runHostProcess(spec: HostProcessSpec): Promise<number | null> {
  return await new Promise<number | null>((resolve, reject) => {
    const child = spawn(spec.executablePath, spec.args, {
      env: { ...process.env },
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    const timeout = setTimeout(() => child.kill(), spec.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });
}
