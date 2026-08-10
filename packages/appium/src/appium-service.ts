import { spawn } from "node:child_process";

export interface ChildProcessLike {
  readonly pid?: number | undefined;
  once(event: string, listener: (...args: unknown[]) => void): this;
  kill(): boolean;
}

export interface AppiumStatus {
  readonly ready: boolean;
  readonly value?: { readonly build?: { readonly version?: string } };
}

export interface AppiumServiceOptions {
  readonly executablePath: string;
  readonly executableArgs?: readonly string[];
  readonly appiumHome: string;
  readonly port: number;
  readonly logPath: string;
  readonly readinessTimeoutMs?: number;
  readonly cwd?: string;
  readonly spawnProcess?: (
    executablePath: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd?: string,
  ) => ChildProcessLike;
  readonly requestStatus?: () => Promise<AppiumStatus>;
  readonly terminateProcessTree?: (pid: number) => Promise<void>;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

export interface AppiumStartResult {
  readonly version?: string;
  readonly pid: number;
}

export class AppiumService {
  public readonly args: readonly string[];
  public readonly executablePath: string;
  public readonly environment: NodeJS.ProcessEnv;
  private readonly executableArgs: readonly string[];
  private readonly readinessTimeoutMs: number;
  private readonly spawnProcess: NonNullable<AppiumServiceOptions["spawnProcess"]>;
  private readonly requestStatus: NonNullable<AppiumServiceOptions["requestStatus"]>;
  private readonly terminateProcessTree: NonNullable<AppiumServiceOptions["terminateProcessTree"]>;
  private readonly sleep: NonNullable<AppiumServiceOptions["sleep"]>;
  private readonly cwd: string | undefined;
  private child: ChildProcessLike | undefined;

  public constructor(options: AppiumServiceOptions) {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
      throw new TypeError("Appium port is invalid.");
    this.executablePath = options.executablePath;
    this.executableArgs = options.executableArgs ?? [];
    this.cwd = options.cwd;
    this.args = [
      "--address",
      "127.0.0.1",
      "--port",
      String(options.port),
      "--base-path",
      "/",
      "--log",
      options.logPath,
    ];
    this.environment = { ...process.env, APPIUM_HOME: options.appiumHome };
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 15_000;
    if (this.readinessTimeoutMs <= 0) throw new TypeError("readinessTimeoutMs must be positive.");
    this.spawnProcess =
      options.spawnProcess ??
      ((executablePath, args, env, cwd) => defaultSpawn(executablePath, args, env, cwd));
    this.requestStatus = options.requestStatus ?? (() => requestStatus(options.port));
    this.terminateProcessTree = options.terminateProcessTree ?? defaultTerminateProcessTree;
    this.sleep =
      options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  public async start(): Promise<AppiumStartResult> {
    if (this.child !== undefined) throw new Error("Appium service is already running.");
    const child = this.spawnProcess(
      this.executablePath,
      [...this.executableArgs, ...this.args],
      this.environment,
      this.cwd,
    );
    if (child.pid === undefined) throw new Error("Appium child did not expose a PID.");
    this.child = child;
    const deadline = Date.now() + this.readinessTimeoutMs;
    try {
      let status: AppiumStatus | undefined;
      while (Date.now() < deadline) {
        try {
          status = await this.requestStatus();
          if (status.ready)
            return {
              pid: child.pid,
              ...(status.value?.build?.version === undefined
                ? {}
                : { version: status.value.build.version }),
            };
        } catch {
          // The server can refuse status requests while its driver registry is starting.
        }
        await this.sleep(Math.min(50, Math.max(1, deadline - Date.now())));
      }
      throw new Error("Appium readiness timeout.");
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child?.pid === undefined) return;
    await this.terminateProcessTree(child.pid);
  }
}

function defaultSpawn(
  executablePath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): ChildProcessLike {
  return spawn(executablePath, [...args], {
    ...(cwd === undefined ? {} : { cwd }),
    env,
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
}

async function requestStatus(port: number): Promise<AppiumStatus> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/status`);
  if (!response.ok) throw new Error(`Appium status returned HTTP ${String(response.status)}.`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("value" in body)) return { ready: false };
  const value = (body as { value?: unknown }).value;
  if (typeof value !== "object" || value === null) return { ready: false };
  const ready = (value as { ready?: unknown }).ready === true;
  const build = (value as { build?: unknown }).build;
  const version =
    typeof build === "object" &&
    build !== null &&
    typeof (build as { version?: unknown }).version === "string"
      ? (build as { version: string }).version
      : undefined;
  return { ready, value: { ...(version === undefined ? {} : { build: { version } }) } };
}

async function defaultTerminateProcessTree(pid: number): Promise<void> {
  const taskkill = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\taskkill.exe`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (exitCode) =>
      exitCode === 0
        ? resolve()
        : reject(new Error(`taskkill exited with code ${String(exitCode)}.`)),
    );
  });
}
