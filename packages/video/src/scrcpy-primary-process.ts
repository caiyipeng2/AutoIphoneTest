import { spawn, type SpawnOptions } from "node:child_process";

import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

export type ScrcpyPrimaryProcessState = "STOPPED" | "STARTING" | "READY" | "ERROR";
export type ScrcpyProcessEvent = "spawn" | "error" | "exit";
export type ScrcpyRecordFormat = "mkv" | "mp4";

export interface ScrcpyProcessHandle {
  once(event: ScrcpyProcessEvent, listener: (...args: unknown[]) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type ScrcpyProcessSpawner = (
  executablePath: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ScrcpyProcessHandle;

export interface ScrcpyPrimaryProcessOptions {
  readonly serial: string;
  readonly executablePath: string;
  readonly recordPath: string;
  readonly spawnProcess?: ScrcpyProcessSpawner;
  readonly stopTimeoutMs?: number;
  readonly recordFormat?: ScrcpyRecordFormat;
}

const DEFAULT_SCRCPY_ARGS = [
  "--no-window",
  "--no-control",
  "--no-audio",
  "--no-clipboard-autosync",
  "--video-codec=h264",
] as const;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

/**
 * Owns one serial-bound scrcpy process. This is deliberately separate from
 * ViewProvider until the raw H.264 socket decoder is wired in; it gives the
 * primary path a testable process boundary and prevents cross-device reuse.
 */
export class ScrcpyPrimaryProcess {
  public readonly serial: DeviceSerial;
  public readonly executablePath: string;
  public readonly args: readonly string[];
  public readonly spawnProcess: ScrcpyProcessSpawner;
  private readonly stopTimeoutMs: number;
  private child: ScrcpyProcessHandle | undefined;
  private _state: ScrcpyPrimaryProcessState = "STOPPED";

  public constructor(options: ScrcpyPrimaryProcessOptions) {
    this.serial = parseDeviceSerial(options.serial);
    this.executablePath = options.executablePath;
    this.args = [
      `--serial=${this.serial}`,
      ...DEFAULT_SCRCPY_ARGS,
      `--record=${options.recordPath}`,
      `--record-format=${options.recordFormat ?? "mkv"}`,
    ];
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.stopTimeoutMs) || this.stopTimeoutMs < 1) {
      throw new TypeError("scrcpy stop timeout must be a positive safe integer.");
    }
  }

  public get state(): ScrcpyPrimaryProcessState {
    return this._state;
  }

  public async start(): Promise<void> {
    if (this._state === "READY") return;
    if (this._state === "STARTING") throw new Error("scrcpy process is already starting");
    this._state = "STARTING";
    const child = this.spawnProcess(this.executablePath, this.args, {
      stdio: "ignore",
      windowsHide: true,
    });
    this.child = child;
    try {
      await waitForSpawn(child);
      this._state = "READY";
    } catch (error) {
      this.child = undefined;
      this._state = "ERROR";
      throw new Error("scrcpy process failed to start", { cause: error });
    }
  }

  public async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child !== undefined) await terminateProcess(child, this.stopTimeoutMs);
    this._state = "STOPPED";
  }
}

function defaultSpawnProcess(
  executablePath: string,
  args: readonly string[],
  options?: SpawnOptions,
): ScrcpyProcessHandle {
  return spawn(executablePath, [...args], options ?? {}) as unknown as ScrcpyProcessHandle;
}

function waitForSpawn(child: ScrcpyProcessHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", (error) => reject(error ?? new Error("unknown spawn error")));
  });
}

function terminateProcess(child: ScrcpyProcessHandle, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once("exit", finish);
    child.kill();
  });
}
