import { describe, expect, it } from "vitest";

import { StoragePressureMonitor, type StoragePressureSample } from "./storage-pressure-monitor.js";
import { StoragePressurePoller, type StoragePollScheduler } from "./storage-pressure-poller.js";

class FakeScheduler implements StoragePollScheduler {
  public callback: (() => void) | undefined;
  public intervalMs: number | undefined;
  public cleared = false;
  public setCalls = 0;

  public setInterval(callback: () => void, intervalMs: number): unknown {
    this.callback = callback;
    this.intervalMs = intervalMs;
    this.setCalls += 1;
    this.cleared = false;
    return "poll-handle";
  }

  public clearInterval(handle: unknown): void {
    expect(handle).toBe("poll-handle");
    this.cleared = true;
  }

  public tick(): void {
    this.callback?.();
  }
}

describe("storage pressure poller", () => {
  it("samples immediately, schedules the interval, and emits later samples", async () => {
    const scheduler = new FakeScheduler();
    let reads = 0;
    const samples: StoragePressureSample[] = [];
    const monitor = new StoragePressureMonitor(
      {
        readFreeBytes: async () => {
          reads += 1;
          return reads * 1024;
        },
      },
      { now: () => 1_000 },
    );
    const poller = new StoragePressurePoller(monitor, {
      intervalMs: 5_000,
      scheduler,
      onSample: (sample) => samples.push(sample),
    });

    await poller.start();
    scheduler.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(reads).toBe(2);
    expect(scheduler.intervalMs).toBe(5_000);
    expect(samples).toHaveLength(2);
  });

  it("does not overlap samples when a previous poll is still pending", async () => {
    const scheduler = new FakeScheduler();
    let release!: () => void;
    let reads = 0;
    const monitor = new StoragePressureMonitor({
      readFreeBytes: async () => {
        reads += 1;
        if (reads === 2) await new Promise<void>((resolve) => (release = resolve));
        return 1024;
      },
    });
    const poller = new StoragePressurePoller(monitor, { intervalMs: 1_000, scheduler });

    await poller.start();
    scheduler.tick();
    scheduler.tick();
    expect(reads).toBe(2);
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("stops the interval and makes repeated start calls idempotent", async () => {
    const scheduler = new FakeScheduler();
    const monitor = new StoragePressureMonitor({ readFreeBytes: async () => 1024 });
    const poller = new StoragePressurePoller(monitor, { intervalMs: 1_000, scheduler });

    await poller.start();
    await poller.start();
    await poller.stop();

    expect(scheduler.cleared).toBe(true);
    expect(poller.isRunning()).toBe(false);
  });

  it("shares a pending first sample across concurrent starts", async () => {
    const scheduler = new FakeScheduler();
    let release!: () => void;
    const monitor = new StoragePressureMonitor({
      readFreeBytes: async () =>
        await new Promise<number>((resolve) => (release = () => resolve(1024))),
    });
    const poller = new StoragePressurePoller(monitor, { intervalMs: 1_000, scheduler });

    const first = poller.start();
    const second = poller.start();
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(scheduler.setCalls).toBe(1);
  });

  it("waits for a pending first sample when stopping", async () => {
    const scheduler = new FakeScheduler();
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const monitor = new StoragePressureMonitor({
      readFreeBytes: async () => {
        markStarted();
        return new Promise<number>((resolve) => (release = () => resolve(1024)));
      },
    });
    const poller = new StoragePressurePoller(monitor, { intervalMs: 1_000, scheduler });

    const start = poller.start();
    await started;
    let stopped = false;
    const stop = poller.stop().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([start, stop]);

    expect(stopped).toBe(true);
    expect(scheduler.setCalls).toBe(0);
    expect(poller.isRunning()).toBe(false);
  });
});
