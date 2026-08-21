// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReportHistoryItem } from "@test-center/reports";
import {
  executeCleanup,
  fetchCleanupEvents,
  issueCleanupConfirmation,
  requestResultExports,
  retryResultFinalization,
} from "./api";

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

describe("requestResultExports", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "";
  });

  it("sends selected optional formats with CSRF and idempotency", async () => {
    document.cookie = "tc_csrf=export-csrf";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ schemaVersion: 1, result }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestResultExports("run/1", ["PDF", "JUNIT"], "export-1")).resolves.toEqual(
      result,
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/results/run%2F1/exports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "export-1",
        "x-test-center-csrf": "export-csrf",
      },
      body: JSON.stringify({ formats: ["PDF", "JUNIT"] }),
    });
  });
});

describe("cleanup mutation API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "";
  });

  it("binds cleanup confirmation and execution to the selected runs and bytes", async () => {
    document.cookie = "tc_csrf=cleanup-csrf";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 1,
          confirmation: { nonce: "nonce-1", expiresAt: "2026-08-20T09:00:00.000Z" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 1,
          result: {
            cleanupId: "cleanup-1",
            state: "DELETED",
            moved: [],
            deleted: ["run-a", "run-b"],
            restored: [],
            unresolved: [],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(issueCleanupConfirmation(["run-b", "run-a"], 900)).resolves.toEqual({
      nonce: "nonce-1",
      expiresAt: "2026-08-20T09:00:00.000Z",
    });
    await expect(
      executeCleanup({
        cleanupId: "cleanup-1",
        nonce: "nonce-1",
        runIds: ["run-a", "run-b"],
        expectedBytes: 900,
      }),
    ).resolves.toMatchObject({ state: "DELETED" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/cleanup/confirmations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-center-csrf": "cleanup-csrf" },
      body: JSON.stringify({ runIds: ["run-b", "run-a"], expectedBytes: 900 }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/cleanup/execute", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-center-csrf": "cleanup-csrf" },
      body: JSON.stringify({
        cleanupId: "cleanup-1",
        nonce: "nonce-1",
        runIds: ["run-a", "run-b"],
        expectedBytes: 900,
      }),
    });
  });

  it("loads append-only cleanup events and surfaces server errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        schemaVersion: 1,
        cleanupId: "cleanup-1",
        events: [
          {
            sequence: 1,
            cleanupId: "cleanup-1",
            kind: "STARTED",
            createdAt: "2026-08-20T08:00:00.000Z",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCleanupEvents("cleanup/1")).resolves.toMatchObject({
      cleanupId: "cleanup-1",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/cleanup/cleanup%2F1/events", undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "Cleanup failed." }),
      }),
    );
    await expect(fetchCleanupEvents("cleanup-2")).rejects.toThrow("Cleanup failed.");
  });
});
