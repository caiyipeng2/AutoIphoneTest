import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";
import { join, win32 } from "node:path";

import {
  LogcatRecordSchema,
  LogcatSegmentClosedSchema,
  type LogcatRecord,
  type LogcatSegmentClosed,
} from "@test-center/contracts/logcat";
import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

const MAX_LINE_BYTES = 16 * 1024;
const DEFAULT_RING_RECORDS = 200;
const DEFAULT_RING_BYTES = 512 * 1024;
const DEFAULT_SEGMENT_BYTES = 8 * 1024 * 1024;
const DEFAULT_SEGMENT_DURATION_MS = 5 * 60 * 1000;

export interface LogcatProcessSpec {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

export interface LogcatProcess {
  readonly pid: number;
  readonly startToken: string;
  onStdout(listener: (chunk: Buffer) => void): () => void;
  onClose(listener: () => void): () => void;
  terminate(): Promise<void>;
}

export interface LogcatSegmentSink {
  (event: LogcatSegmentClosed): void;
}

export interface LogcatRecordSink {
  (record: LogcatRecord): void;
}

export interface LogcatStreamOptions {
  readonly serial: string;
  readonly adbPath: string;
  readonly cwd: string;
  readonly runDirectory: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly maxRingRecords?: number;
  readonly maxRingBytes?: number;
  readonly maxSegmentBytes?: number;
  readonly maxSegmentDurationMs?: number;
  readonly processFactory?: (spec: LogcatProcessSpec) => LogcatProcess;
  readonly segmentSink?: LogcatSegmentSink;
  readonly recordSink?: LogcatRecordSink;
  readonly now?: () => number;
}

interface SegmentState {
  readonly index: number;
  readonly partialPath: string;
  readonly startedAtMonotonicMs: number;
  byteSize: number;
  recordCount: number;
}

export function parseLogcatLine(
  line: string,
  serial = "unknown",
  receivedAtMonotonicMs = performance.now(),
): LogcatRecord {
  const rawLine = line.replace(/\r$/, "");
  const truncated = Buffer.byteLength(rawLine, "utf8") > MAX_LINE_BYTES;
  const boundedLine = truncated
    ? Buffer.from(rawLine, "utf8").subarray(0, MAX_LINE_BYTES).toString("utf8")
    : rawLine;
  const match =
    /^(\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]{1,128}): ?(.*)$/.exec(
      boundedLine,
    );
  const parsed =
    match === null
      ? null
      : {
          monthDay: match[1] as string,
          time: match[2] as string,
          pid: Number(match[3]),
          tid: Number(match[4]),
          level: match[5] as "V" | "D" | "I" | "W" | "E" | "F",
          tag: (match[6] as string).trim(),
          message: match[7] as string,
        };
  return LogcatRecordSchema.parse({
    schemaVersion: 1,
    serial: parseDeviceSerial(serial),
    receivedAtMonotonicMs: Math.max(0, receivedAtMonotonicMs),
    rawLine: boundedLine,
    truncated,
    parsed,
  });
}

export class LogcatStream {
  private readonly serial: DeviceSerial;
  private readonly adbPath: string;
  private readonly cwd: string;
  private readonly runDirectory: string;
  private readonly env: Readonly<NodeJS.ProcessEnv>;
  private readonly maxRingRecords: number;
  private readonly maxRingBytes: number;
  private readonly maxSegmentBytes: number;
  private readonly maxSegmentDurationMs: number;
  private readonly processFactory: (spec: LogcatProcessSpec) => LogcatProcess;
  private readonly segmentSink: LogcatSegmentSink;
  private readonly recordSink: LogcatRecordSink;
  private readonly now: () => number;
  private readonly ring: LogcatRecord[] = [];
  private ringBytes = 0;
  private inputBuffer = "";
  private processing = Promise.resolve();
  private process: LogcatProcess | undefined;
  private removeStdoutListener: (() => void) | undefined;
  private removeCloseListener: (() => void) | undefined;
  private segment: SegmentState | undefined;
  private closePromise: Promise<void> | undefined;
  private nextSegmentIndex = 1;
  private started = false;

  public constructor(options: LogcatStreamOptions) {
    this.serial = parseDeviceSerial(options.serial);
    if (
      !win32.isAbsolute(options.adbPath) ||
      !win32.isAbsolute(options.cwd) ||
      !win32.isAbsolute(options.runDirectory)
    ) {
      throw new TypeError("adbPath, cwd, and runDirectory must be absolute Windows paths.");
    }
    this.adbPath = win32.normalize(options.adbPath);
    this.cwd = win32.normalize(options.cwd);
    this.runDirectory = win32.normalize(options.runDirectory);
    this.env = options.env ?? process.env;
    this.maxRingRecords = options.maxRingRecords ?? DEFAULT_RING_RECORDS;
    this.maxRingBytes = options.maxRingBytes ?? DEFAULT_RING_BYTES;
    this.maxSegmentBytes = options.maxSegmentBytes ?? DEFAULT_SEGMENT_BYTES;
    this.maxSegmentDurationMs = options.maxSegmentDurationMs ?? DEFAULT_SEGMENT_DURATION_MS;
    if (
      ![
        this.maxRingRecords,
        this.maxRingBytes,
        this.maxSegmentBytes,
        this.maxSegmentDurationMs,
      ].every((value) => Number.isSafeInteger(value) && value > 0)
    ) {
      throw new TypeError("Logcat bounds must be positive safe integers.");
    }
    this.processFactory = options.processFactory ?? createLogcatProcess;
    this.segmentSink = options.segmentSink ?? (() => undefined);
    this.recordSink = options.recordSink ?? (() => undefined);
    this.now = options.now ?? (() => performance.now());
  }

  public async start(): Promise<void> {
    if (this.started) throw new Error("Logcat stream is already running.");
    this.started = true;
    await mkdir(this.runDirectory, { recursive: true });
    await this.recoverPartials();
    this.nextSegmentIndex = await findNextSegmentIndex(this.runDirectory);
    const process = this.processFactory({
      executablePath: this.adbPath,
      args: ["-s", this.serial, "logcat", "-v", "threadtime"],
      cwd: this.cwd,
      env: this.env,
    });
    if (!Number.isSafeInteger(process.pid) || process.pid <= 0 || !process.startToken)
      throw new Error("Logcat process identity is invalid.");
    this.process = process;
    this.removeStdoutListener = process.onStdout((chunk) => this.handleChunk(chunk));
    this.removeCloseListener = process.onClose(() => {
      void this.handleProcessClose();
    });
  }

  public async stop(): Promise<void> {
    const process = this.process;
    if (process === undefined) return;
    this.removeStdoutListener?.();
    this.removeCloseListener?.();
    this.removeStdoutListener = undefined;
    this.removeCloseListener = undefined;
    await process.terminate();
    await this.flush();
    await this.closeSegment();
    this.process = undefined;
    this.started = false;
  }

  public async flush(): Promise<void> {
    await this.processing;
  }

  public getRingBuffer(): readonly LogcatRecord[] {
    return this.ring.map((record) => ({
      ...record,
      parsed: record.parsed === null ? null : { ...record.parsed },
    }));
  }

  public getProcessIdentity():
    | { readonly pid: number; readonly startToken: string; readonly serial: DeviceSerial }
    | undefined {
    const process = this.process;
    return process === undefined
      ? undefined
      : { pid: process.pid, startToken: process.startToken, serial: this.serial };
  }

  private handleChunk(chunk: Buffer): void {
    this.inputBuffer += chunk.toString("utf8");
    const lines = this.inputBuffer.split(/\n/);
    this.inputBuffer = lines.pop() ?? "";
    for (const line of lines)
      this.processing = this.processing.then(
        async () => await this.appendRecord(parseLogcatLine(line, this.serial, this.now())),
      );
  }

  private async handleProcessClose(): Promise<void> {
    if (this.inputBuffer.length > 0) {
      this.processing = this.processing.then(
        async () =>
          await this.appendRecord(parseLogcatLine(this.inputBuffer, this.serial, this.now())),
      );
      this.inputBuffer = "";
    }
    await this.flush();
    await this.closeSegment();
  }

  private async appendRecord(record: LogcatRecord): Promise<void> {
    const recordBytes = Buffer.byteLength(`${record.rawLine}\n`, "utf8");
    this.ring.push(record);
    this.recordSink(record);
    this.ringBytes += recordBytes;
    while (this.ring.length > this.maxRingRecords || this.ringBytes > this.maxRingBytes) {
      const removed = this.ring.shift();
      if (removed !== undefined)
        this.ringBytes -= Buffer.byteLength(`${removed.rawLine}\n`, "utf8");
    }
    const segment = this.segment ?? this.openSegment();
    const elapsed = this.now() - segment.startedAtMonotonicMs;
    if (
      segment.recordCount > 0 &&
      (segment.byteSize + recordBytes > this.maxSegmentBytes ||
        elapsed >= this.maxSegmentDurationMs)
    ) {
      await this.closeSegment();
      this.segment = this.openSegment();
    }
    await appendFile(this.segment?.partialPath ?? "", `${record.rawLine}\n`, "utf8");
    if (this.segment === undefined) throw new Error("Logcat segment was not opened.");
    this.segment.byteSize += recordBytes;
    this.segment.recordCount += 1;
  }

  private openSegment(): SegmentState {
    const index = this.nextSegmentIndex++;
    const partialPath = join(
      this.runDirectory,
      `logcat-${String(index).padStart(4, "0")}.raw.partial`,
    );
    this.segment = {
      index,
      partialPath,
      startedAtMonotonicMs: this.now(),
      byteSize: 0,
      recordCount: 0,
    };
    return this.segment;
  }

  private async closeSegment(): Promise<void> {
    if (this.closePromise !== undefined) return await this.closePromise;
    this.closePromise = this.closeSegmentOnce();
    try {
      await this.closePromise;
    } finally {
      this.closePromise = undefined;
    }
  }

  private async closeSegmentOnce(): Promise<void> {
    const segment = this.segment;
    if (segment === undefined || segment.recordCount === 0) {
      this.segment = undefined;
      return;
    }
    const bytes = await readFile(segment.partialPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const finalPath = segment.partialPath.replace(/\.partial$/, "");
    await rename(segment.partialPath, finalPath);
    const event = LogcatSegmentClosedSchema.parse({
      schemaVersion: 1,
      serial: this.serial,
      path: finalPath,
      sha256,
      byteSize: bytes.byteLength,
      recordCount: segment.recordCount,
      startedAtMonotonicMs: segment.startedAtMonotonicMs,
      endedAtMonotonicMs: this.now(),
      recovered: false,
    });
    this.segment = undefined;
    this.segmentSink(event);
  }

  private async recoverPartials(): Promise<void> {
    for (const name of await readdir(this.runDirectory)) {
      if (!name.endsWith(".raw.partial")) continue;
      const partialPath = join(this.runDirectory, name);
      const bytes = await readFile(partialPath);
      const finalPath = partialPath.replace(/\.partial$/, ".recovered");
      await rename(partialPath, finalPath);
      const event = LogcatSegmentClosedSchema.parse({
        schemaVersion: 1,
        serial: this.serial,
        path: finalPath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.byteLength,
        recordCount:
          bytes.byteLength === 0 ? 0 : bytes.toString("utf8").split(/\r?\n/).filter(Boolean).length,
        startedAtMonotonicMs: this.now(),
        endedAtMonotonicMs: this.now(),
        recovered: true,
      });
      this.segmentSink(event);
    }
  }
}

async function findNextSegmentIndex(directory: string): Promise<number> {
  const indexes = (await readdir(directory)).flatMap((name) => {
    const match = /^logcat-(\d{4})\.raw\./.exec(name);
    return match === null ? [] : [Number(match[1])];
  });
  return Math.max(0, ...indexes) + 1;
}

function createLogcatProcess(spec: LogcatProcessSpec): LogcatProcess {
  const child = spawn(spec.executablePath, [...spec.args], {
    cwd: spec.cwd,
    env: { ...spec.env },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (child.pid === undefined || child.stdout === null)
    throw new Error("Failed to start owned logcat process.");
  const startToken = `${String(child.pid)}-${randomUUID()}`;
  return wrapLogcatChild(child, startToken);
}

function wrapLogcatChild(child: ChildProcess, startToken: string): LogcatProcess {
  return {
    pid: child.pid as number,
    startToken,
    onStdout: (listener) => {
      child.stdout?.on("data", listener);
      return () => {
        child.stdout?.off("data", listener);
      };
    },
    onClose: (listener) => {
      child.once("close", listener);
      return () => undefined;
    },
    terminate: async () => {
      if (!child.killed) child.kill();
    },
  };
}
