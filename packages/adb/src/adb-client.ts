import { win32 } from "node:path";

import {
  ProcessRunner,
  type ProcessResult,
  type ProcessSpec,
} from "@test-center/environment/process-runner";
import type { AdbCommand } from "./commands.js";
import { commandSerial, renderProcessArguments } from "./commands.js";

export interface AdbProcessRunner {
  run(spec: ProcessSpec): Promise<ProcessResult>;
}

export interface AdbClientOptions {
  readonly adbPath: string;
  readonly cwd: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs?: number;
  readonly runner?: AdbProcessRunner;
}

export class AdbClient {
  private readonly adbPath: string;
  private readonly cwd: string;
  private readonly env: Readonly<NodeJS.ProcessEnv>;
  private readonly timeoutMs: number;
  private readonly runner: AdbProcessRunner;

  public constructor(options: AdbClientOptions) {
    if (!win32.isAbsolute(options.adbPath)) {
      throw new TypeError("adbPath must be an absolute Windows path.");
    }
    if (!win32.isAbsolute(options.cwd)) {
      throw new TypeError("cwd must be an absolute Windows path.");
    }
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new TypeError("timeoutMs must be greater than zero.");
    }
    this.adbPath = win32.normalize(options.adbPath);
    this.cwd = win32.normalize(options.cwd);
    this.env = options.env ?? process.env;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.runner = options.runner ?? new ProcessRunner();
  }

  public async execute(command: AdbCommand): Promise<ProcessResult> {
    const serial = commandSerial(command);
    const spec: ProcessSpec = {
      executableId: "adb",
      executablePath: this.adbPath,
      args: renderProcessArguments(command),
      cwd: this.cwd,
      env: this.env,
      timeoutMs: this.timeoutMs,
      serialRequirement: serial === undefined ? "optional" : "required",
      ...(serial === undefined ? {} : { serial }),
    };
    return await this.runner.run(spec);
  }
}
