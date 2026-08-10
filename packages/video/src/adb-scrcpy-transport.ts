import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer, type Socket } from "node:net";
import { win32 } from "node:path";

import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

import type { ScrcpyVideoTransport } from "./tango-scrcpy-provider.js";

const DEFAULT_REMOTE_SERVER_PATH = "/data/local/tmp/test-center-scrcpy-server.jar";
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export interface AdbScrcpyVideoTransportOptions {
  readonly serial: string;
  readonly adbPath: string;
  readonly serverPath: string;
  readonly remoteServerPath?: string;
  readonly localPort?: number;
  readonly scid?: string;
  readonly maxSize?: number;
  readonly connectTimeoutMs?: number;
}

export interface ScrcpyServerArgumentOptions {
  readonly serial: string;
  readonly serverPath: string;
  readonly remoteServerPath: string;
  readonly scid: string;
  readonly maxSize?: number;
  readonly localPort?: number;
}

export interface ScrcpyServerArguments {
  readonly adbArgs: readonly string[];
  readonly pushArgs: readonly string[];
  readonly forwardArgs: readonly string[];
}

export function buildScrcpyServerArguments(
  options: ScrcpyServerArgumentOptions,
): ScrcpyServerArguments {
  const serial = parseDeviceSerial(options.serial);
  if (!win32.isAbsolute(options.serverPath)) throw new TypeError("serverPath must be absolute.");
  if (!/^[0-9a-f]{8}$/i.test(options.scid))
    throw new TypeError("scrcpy scid must be eight hexadecimal characters.");
  const port = options.localPort ?? 27_183;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new TypeError("localPort is invalid.");
  const adbArgs = [
    "-s",
    serial,
    "shell",
    `CLASSPATH=${options.remoteServerPath}`,
    "app_process",
    "/",
    "com.genymobile.scrcpy.Server",
    "3.1",
    "tunnel_forward=true",
    `scid=${options.scid.toLowerCase()}`,
    "audio=false",
    "control=false",
    "cleanup=true",
    "send_device_meta=false",
    "send_dummy_byte=false",
    "video_codec=h264",
  ];
  if (options.maxSize !== undefined) adbArgs.push(`max_size=${options.maxSize}`);
  return {
    adbArgs,
    pushArgs: ["-s", serial, "push", options.serverPath, options.remoteServerPath],
    forwardArgs: [
      "-s",
      serial,
      "forward",
      `tcp:${port}`,
      `localabstract:scrcpy_${options.scid.toLowerCase()}`,
    ],
  };
}

export class AdbScrcpyVideoTransport implements ScrcpyVideoTransport {
  private readonly serial: DeviceSerial;
  private readonly adbPath: string;
  private readonly serverPath: string;
  private readonly remoteServerPath: string;
  private readonly requestedPort: number | undefined;
  private readonly scid: string;
  private readonly maxSize: number | undefined;
  private readonly connectTimeoutMs: number;
  private socket: Socket | undefined;
  private serverProcess: ChildProcess | undefined;
  private localPort: number | undefined;

  public constructor(options: AdbScrcpyVideoTransportOptions) {
    this.serial = parseDeviceSerial(options.serial);
    if (!win32.isAbsolute(options.adbPath) || !win32.isAbsolute(options.serverPath)) {
      throw new TypeError("adbPath and serverPath must be absolute Windows paths.");
    }
    this.adbPath = win32.normalize(options.adbPath);
    this.serverPath = win32.normalize(options.serverPath);
    this.remoteServerPath = options.remoteServerPath ?? DEFAULT_REMOTE_SERVER_PATH;
    this.requestedPort = options.localPort;
    this.scid = options.scid ?? randomScid();
    this.maxSize = options.maxSize;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.connectTimeoutMs) || this.connectTimeoutMs < 1) {
      throw new TypeError("scrcpy connect timeout must be a positive safe integer.");
    }
  }

  public async open(): Promise<AsyncIterable<Uint8Array>> {
    if (this.socket !== undefined) throw new Error("scrcpy transport is already open.");
    const port = this.requestedPort ?? (await findFreePort());
    const args = buildScrcpyServerArguments({
      serial: this.serial,
      serverPath: this.serverPath,
      remoteServerPath: this.remoteServerPath,
      scid: this.scid,
      localPort: port,
      ...(this.maxSize === undefined ? {} : { maxSize: this.maxSize }),
    });
    try {
      await runAdb(this.adbPath, args.pushArgs);
      await runAdb(this.adbPath, args.forwardArgs);
      this.localPort = port;
      this.serverProcess = spawn(this.adbPath, args.adbArgs, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      this.serverProcess.stderr?.resume();
      this.socket = await connectSocket(port, this.connectTimeoutMs);
      return this.socket;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.socket?.destroy();
    this.socket = undefined;
    if (this.serverProcess !== undefined && this.serverProcess.exitCode === null) {
      this.serverProcess.kill();
    }
    this.serverProcess = undefined;
    if (this.localPort !== undefined) {
      await runAdb(this.adbPath, [
        "-s",
        this.serial,
        "forward",
        "--remove",
        `tcp:${this.localPort}`,
      ]).catch(() => undefined);
      this.localPort = undefined;
    }
  }
}

async function runAdb(adbPath: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(adbPath, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Uint8Array) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr?.on("data", (chunk: Uint8Array) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`adb command failed (${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string")
    throw new Error("Could not allocate a TCP port.");
  return address.port;
}

function connectSocket(port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out connecting to scrcpy video socket."));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function randomScid(): string {
  return Math.floor(Math.random() * 0x80000000)
    .toString(16)
    .padStart(8, "0");
}
