import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LogcatStream, parseLogcatLine, type LogcatProcess } from "./logcat-stream.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class FakeLogcatProcess implements LogcatProcess {
  public readonly pid = 4321;
  public readonly startToken = "fake-start-token";
  public readonly args: readonly string[];
  private stdoutListener: ((chunk: Buffer) => void) | undefined;
  private closeListener: (() => void) | undefined;
  public terminated = false;

  public constructor(args: readonly string[]) {
    this.args = args;
  }
  public onStdout(listener: (chunk: Buffer) => void): () => void {
    this.stdoutListener = listener;
    return () => {
      this.stdoutListener = undefined;
    };
  }
  public onClose(listener: () => void): () => void {
    this.closeListener = listener;
    return () => {
      this.closeListener = undefined;
    };
  }
  public emit(chunk: string): void {
    this.stdoutListener?.(Buffer.from(chunk));
  }
  public async terminate(): Promise<void> {
    this.terminated = true;
    this.closeListener?.();
  }
}

describe("logcat stream", () => {
  it("parses threadtime records and binds the closed command to one serial", async () => {
    const parsed = parseLogcatLine("08-10 10:11:12.345  123  456 I Unity: hello");
    expect(parsed?.parsed).toMatchObject({
      pid: 123,
      tid: 456,
      level: "I",
      tag: "Unity",
      message: "hello",
    });

    const directory = await mkdtemp(join(tmpdir(), "test-center-logcat-"));
    temporaryDirectories.push(directory);
    let process: FakeLogcatProcess | undefined;
    const stream = new LogcatStream({
      serial: "serial-a",
      adbPath: "C:\\Android\\platform-tools\\adb.exe",
      cwd: directory,
      runDirectory: directory,
      processFactory: (spec) => {
        process = new FakeLogcatProcess(spec.args);
        return process;
      },
      now: () => 100,
    });

    await stream.start();
    expect(process?.args).toEqual(["-s", "serial-a", "logcat", "-v", "threadtime"]);
    expect(stream.getProcessIdentity()).toEqual({
      pid: 4321,
      startToken: "fake-start-token",
      serial: "serial-a",
    });
    process?.emit("08-10 10:11:12.345  123  456 I Unity: hello\n");
    await stream.flush();
    expect(stream.getRingBuffer()).toHaveLength(1);
    expect(stream.getRingBuffer()[0]?.serial).toBe("serial-a");
  });

  it("evicts the ring buffer, rotates segments, hashes closed files, and stops only its process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "test-center-logcat-"));
    temporaryDirectories.push(directory);
    const process = new FakeLogcatProcess(["-s", "serial-a", "logcat", "-v", "threadtime"]);
    const closed: unknown[] = [];
    const stream = new LogcatStream({
      serial: "serial-a",
      adbPath: "C:\\Android\\platform-tools\\adb.exe",
      cwd: directory,
      runDirectory: directory,
      maxRingRecords: 1,
      maxSegmentBytes: 60,
      processFactory: () => process,
      segmentSink: (event) => closed.push(event),
    });

    await stream.start();
    process.emit(
      "08-10 10:11:12.345  123  456 I Unity: first\n08-10 10:11:13.345  123  456 I Unity: second\n",
    );
    await stream.flush();
    await stream.stop();

    expect(stream.getRingBuffer()).toHaveLength(1);
    expect(process.terminated).toBe(true);
    expect(closed.length).toBeGreaterThanOrEqual(1);
    expect(
      closed.every((event) => typeof event === "object" && event !== null && "sha256" in event),
    ).toBe(true);
  });

  it("recovers an unfinished partial segment before opening a new one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "test-center-logcat-"));
    temporaryDirectories.push(directory);
    const partialPath = join(directory, "logcat-0001.raw.partial");
    await writeFile(partialPath, "recovered\n", "utf8");
    const closed: unknown[] = [];
    const process = new FakeLogcatProcess([]);
    const stream = new LogcatStream({
      serial: "serial-a",
      adbPath: "C:\\Android\\platform-tools\\adb.exe",
      cwd: directory,
      runDirectory: directory,
      processFactory: () => process,
      segmentSink: (event) => closed.push(event),
    });

    await stream.start();
    await stream.stop();

    expect(
      closed.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "recovered" in event &&
          event.recovered === true,
      ),
    ).toBe(true);
  });
});
