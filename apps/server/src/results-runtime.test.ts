import { describe, expect, it, vi } from "vitest";

import type { ReportHistoryItem } from "@test-center/reports";
import { RuntimeResultsRouteService } from "./results-runtime.js";

const result: ReportHistoryItem = {
  runId: "run-1",
  packageName: "Idle Weapon Shop Tycoon",
  state: "FAILED",
  currentEpoch: 1,
  createdAt: "2026-08-18T01:00:00.000Z",
  updatedAt: "2026-08-18T01:05:00.000Z",
  devices: [],
  exports: [],
  finalization: {
    runId: "run-1",
    state: "COMPLETED",
    attempt: 2,
    startedAt: "2026-08-18T01:05:00.000Z",
    completedAt: "2026-08-18T01:05:01.000Z",
    updatedAt: "2026-08-18T01:05:01.000Z",
  },
};

describe("RuntimeResultsRouteService", () => {
  it("refreshes history after report-only retry without exposing worker calls", async () => {
    const retryFinalization = vi.fn(async () => result.finalization!);
    const service = new RuntimeResultsRouteService(
      { list: () => [result], get: () => result },
      { retryFinalization },
    );

    await expect(service.retryFinalization("run-1", "retry-1")).resolves.toEqual(result);
    expect(retryFinalization).toHaveBeenCalledWith("run-1", "retry-1");
  });
});
