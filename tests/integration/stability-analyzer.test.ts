import { describe, expect, it } from "vitest";

import { analyzeStability, type StabilitySample } from "../../tests/hardware/stability-analyzer.js";

function sample(overrides: Partial<StabilitySample> = {}): StabilitySample {
  return {
    elapsedSeconds: 0,
    processTreePrivateBytes: 256 * 1024 * 1024,
    processTreeHandles: 420,
    processTreeThreads: 18,
    maxQueueDepth: 0,
    walBytes: 1024 * 1024,
    crashCount: 0,
    restartCount: 0,
    workerCount: 1,
    portLeaseCount: 1,
    forwardCount: 1,
    ...overrides,
  };
}

describe("M11 stability analyzer", () => {
  it("passes a stable post-warmup sample set", () => {
    const samples = Array.from({ length: 12 }, (_, index) =>
      sample({ elapsedSeconds: index * 60 }),
    );

    const result = analyzeStability(samples, {
      warmupSeconds: 120,
      expectedWorkers: 1,
      cleanup: { workerCount: 0, portLeaseCount: 0, forwardCount: 0 },
    });

    expect(result.status).toBe("PASS");
    expect(result.thresholds).toEqual(
      expect.objectContaining({
        queueDepth: "PASS",
        walBytes: "PASS",
        privateBytesSlope: "PASS",
        handlesSlope: "PASS",
        threadsSlope: "PASS",
      }),
    );
  });

  it("accepts the two-forward-per-device runtime shape when counts stay stable", () => {
    const samples = Array.from({ length: 12 }, (_, index) =>
      sample({ elapsedSeconds: index * 60, portLeaseCount: 2, forwardCount: 4 }),
    );

    const result = analyzeStability(samples, { warmupSeconds: 120, expectedWorkers: 1 });

    expect(result.status).toBe("PASS");
    expect(result.thresholds.events).toBe("PASS");
  });

  it("fails when resources remain after the session completes", () => {
    const samples = Array.from({ length: 4 }, (_, index) => sample({ elapsedSeconds: index * 60 }));

    const result = analyzeStability(samples, {
      warmupSeconds: 60,
      expectedWorkers: 1,
      cleanup: { workerCount: 0, portLeaseCount: 1, forwardCount: 0 },
    });

    expect(result.status).toBe("FAIL");
    expect(result.thresholds.events).toBe("FAIL");
    expect(result.failures).toContain("EVENT_OR_RESOURCE_LEAK");
  });

  it("fails a private-byte trend with monotonicity and final-delta evidence", () => {
    const samples = Array.from({ length: 12 }, (_, index) =>
      sample({
        elapsedSeconds: index * 60,
        processTreePrivateBytes: 256 * 1024 * 1024 + index * 2 * 1024 * 1024,
      }),
    );

    const result = analyzeStability(samples, { warmupSeconds: 120, expectedWorkers: 1 });

    expect(result.status).toBe("FAIL");
    expect(result.thresholds.privateBytesSlope).toBe("FAIL");
    expect(result.metrics.privateBytesSlopeMiBPerMinute).toBeGreaterThan(1);
    expect(result.metrics.privateBytesKendallTau).toBeGreaterThanOrEqual(0.5);
  });

  it("fails a sustained queue and oversized WAL checkpoint", () => {
    const samples = Array.from({ length: 8 }, (_, index) =>
      sample({
        elapsedSeconds: index * 10,
        maxQueueDepth: index >= 2 ? 3 : 0,
        walBytes: index >= 2 ? 65 * 1024 * 1024 : 1024 * 1024,
      }),
    );

    const result = analyzeStability(samples, { warmupSeconds: 0, expectedWorkers: 1 });

    expect(result.status).toBe("FAIL");
    expect(result.thresholds.queueDepth).toBe("FAIL");
    expect(result.thresholds.walBytes).toBe("FAIL");
  });
});
