// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReportHistoryItem } from "@test-center/reports";
import { retryResultFinalization } from "./api";

const result = {
  runId: "run-1",
  packageName: "Idle Weapon Shop Tycoon",
  state: "FAILED" as const,
  currentEpoch: 1,
  createdAt: "2026-08-15T02:00:00.000Z",
  updatedAt: "2026-08-15T02:05:00.000Z",
  devices: [],
  exports: [],
} satisfies ReportHistoryItem;

describe("retryResultFinalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "";
  });

  it("sends the CSRF token and idempotency key", async () => {
    document.cookie = "tc_csrf=csrf-token";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ schemaVersion: 1, result }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(retryResultFinalization("run/1", "retry-1")).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith("/api/results/run%2F1/retry-finalization", {
      method: "POST",
      headers: {
        "idempotency-key": "retry-1",
        "x-test-center-csrf": "csrf-token",
      },
    });
  });

  it("surfaces the server rejection message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: "Result finalization is not retryable." }),
      })),
    );

    await expect(retryResultFinalization("run-1", "retry-1")).rejects.toThrow(
      "Result finalization is not retryable.",
    );
  });
});
