import { describe, expect, it } from "vitest";

import { GIBIBYTE } from "./storage-policy.js";
import { StoragePressureMonitor } from "./storage-pressure-monitor.js";

describe("storage pressure monitor", () => {
  it("samples free space and computes a recent write rate", async () => {
    const monitor = new StoragePressureMonitor(
      { readFreeBytes: async () => 10 * GIBIBYTE },
      { now: () => 10_000, windowMs: 10_000 },
    );
    monitor.recordWrite(1_000, 0);
    monitor.recordWrite(3_000, 5_000);

    await expect(monitor.sample()).resolves.toMatchObject({
      measuredAtMs: 10_000,
      freeBytes: 10 * GIBIBYTE,
      pressure: "WARNING",
      writeRateBytesPerSecond: 400,
    });
  });

  it("drops writes outside the configured rolling window", async () => {
    const monitor = new StoragePressureMonitor(
      { readFreeBytes: async () => 30 * GIBIBYTE },
      { now: () => 20_000, windowMs: 10_000 },
    );
    monitor.recordWrite(10_000, 1_000);
    monitor.recordWrite(2_000, 15_000);

    await expect(monitor.sample()).resolves.toMatchObject({
      writeRateBytesPerSecond: 400,
    });
  });

  it("fails closed when the free-space source throws", async () => {
    const monitor = new StoragePressureMonitor({
      readFreeBytes: async () => {
        throw new Error("drive probe failed");
      },
    });

    await expect(monitor.sample(1_000)).resolves.toMatchObject({
      measuredAtMs: 1_000,
      pressure: "BLOCKED",
      sourceError: "FREE_SPACE_UNAVAILABLE",
      writeRateBytesPerSecond: 0,
    });
  });

  it("rejects negative and non-integer write samples", () => {
    const monitor = new StoragePressureMonitor({ readFreeBytes: async () => 1 });

    expect(() => monitor.recordWrite(-1, 0)).toThrow(/bytes/i);
    expect(() => monitor.recordWrite(1.5, 0)).toThrow(/bytes/i);
  });
});
