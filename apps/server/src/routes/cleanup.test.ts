import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import type { CleanupRouteService } from "./cleanup.js";

function headers(port: number) {
  return { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
}

function service(): CleanupRouteService {
  return {
    issueConfirmation: vi.fn(() => ({ nonce: "nonce-1", expiresAt: "2026-08-19T01:01:00.000Z" })),
    execute: vi.fn(async (input) => ({
      cleanupId: input.cleanupId,
      state: "DELETED" as const,
      moved: [],
      deleted: input.runIds,
      restored: [],
      unresolved: [],
    })),
    listEvents: vi.fn(() => [
      {
        sequence: 1,
        cleanupId: "cleanup-1",
        kind: "COMPLETED" as const,
        createdAt: "2026-08-19T01:00:00.000Z",
      },
    ]),
    preview: vi.fn((retentionDays) => ({
      retentionDays,
      preview: {
        cutoffAt: "2026-07-19T00:00:00.000Z",
        candidates: [],
        totalEstimatedBytes: 0,
      },
    })),
  };
}

describe("cleanup routes", () => {
  it("protects confirmation and execution with bootstrap session and CSRF", async () => {
    const port = 4810;
    const cleanupService = service();
    const app = await createApp({
      port,
      bootstrapCode: "cleanup-route-code",
      launchSecret: "cleanup-route-secret",
      cleanupService,
    });
    const base = headers(port);

    const unauthenticatedPreview = await app.inject({
      method: "GET",
      url: "/api/cleanup/preview?retentionDays=30",
      headers: base,
    });
    expect(unauthenticatedPreview.statusCode).toBe(401);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/cleanup/confirmations",
          headers: base,
          payload: {},
        })
      ).statusCode,
    ).toBe(401);

    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: base,
      payload: { code: "cleanup-route-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookie = Array.isArray(cookies)
      ? cookies.map((value) => value.split(";", 1)[0]).join("; ")
      : cookies;
    const authenticated = { ...base, cookie };
    const csrf = cookie?.match(/(?:^|; )tc_csrf=([^;]+)/)?.[1];

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/cleanup/confirmations",
      headers: authenticated,
      payload: { runIds: ["run-a"], expectedBytes: 10 },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const confirmation = await app.inject({
      method: "POST",
      url: "/api/cleanup/confirmations",
      headers: { ...authenticated, "x-test-center-csrf": csrf },
      payload: { runIds: ["run-a"], expectedBytes: 10 },
    });
    expect(confirmation.statusCode).toBe(200);
    expect(confirmation.json()).toEqual({
      schemaVersion: 1,
      confirmation: { nonce: "nonce-1", expiresAt: "2026-08-19T01:01:00.000Z" },
    });

    const execution = await app.inject({
      method: "POST",
      url: "/api/cleanup/execute",
      headers: { ...authenticated, "x-test-center-csrf": csrf },
      payload: {
        cleanupId: "cleanup-1",
        nonce: "nonce-1",
        runIds: ["run-a"],
        expectedBytes: 10,
      },
    });
    expect(execution.statusCode).toBe(200);
    expect(execution.json().result.state).toBe("DELETED");
    expect(cleanupService.execute).toHaveBeenCalledWith({
      cleanupId: "cleanup-1",
      nonce: "nonce-1",
      runIds: ["run-a"],
      expectedBytes: 10,
    });

    const events = await app.inject({
      method: "GET",
      url: "/api/cleanup/cleanup-1/events",
      headers: authenticated,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().events).toHaveLength(1);

    const preview = await app.inject({
      method: "GET",
      url: "/api/cleanup/preview?retentionDays=30",
      headers: authenticated,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({
      schemaVersion: 1,
      retentionDays: 30,
      preview: {
        cutoffAt: "2026-07-19T00:00:00.000Z",
        candidates: [],
        totalEstimatedBytes: 0,
      },
    });

    const invalidPreview = await app.inject({
      method: "GET",
      url: "/api/cleanup/preview?retentionDays=0",
      headers: authenticated,
    });
    expect(invalidPreview.statusCode).toBe(400);
    expect(cleanupService.preview).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects unsafe identifiers before invoking the cleanup service", async () => {
    const port = 4811;
    const cleanupService = service();
    const app = await createApp({
      port,
      bootstrapCode: "cleanup-route-invalid-code",
      launchSecret: "cleanup-route-invalid-secret",
      cleanupService,
    });
    const base = headers(port);
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: base,
      payload: { code: "cleanup-route-invalid-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookie = Array.isArray(cookies)
      ? cookies.map((value) => value.split(";", 1)[0]).join("; ")
      : cookies;
    const csrf = cookie?.match(/(?:^|; )tc_csrf=([^;]+)/)?.[1];
    const result = await app.inject({
      method: "POST",
      url: "/api/cleanup/execute",
      headers: { ...base, cookie, "x-test-center-csrf": csrf },
      payload: {
        cleanupId: "../escape",
        nonce: "nonce-1",
        runIds: ["run-a"],
        expectedBytes: 10,
      },
    });
    expect(result.statusCode).toBe(400);
    expect(cleanupService.execute).not.toHaveBeenCalled();
    await app.close();
  });
});
