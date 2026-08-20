import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { StorageOverviewRouteService } from "./storage.js";

function headers(port: number) {
  return { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
}

function overviewService(): StorageOverviewRouteService {
  return {
    getOverview: async () => ({
      measuredAt: "2026-08-20T08:00:00.000Z",
      pressure: "WARNING",
      freeBytes: 12 * 1024 ** 3,
      warningBytes: 20 * 1024 ** 3,
      dangerBytes: 5 * 1024 ** 3,
      writeRateBytesPerSecond: 2_000,
      estimatedSecondsUntilBlocked: 3_758_096,
      activeRunCount: 2,
    }),
  };
}

describe("storage overview route", () => {
  it("requires a bootstrap session and returns the current pressure snapshot", async () => {
    const port = 4820;
    const service = overviewService();
    const app = await createApp({
      port,
      bootstrapCode: "storage-overview-code",
      launchSecret: "storage-overview-secret",
      storageService: service,
    });
    const base = headers(port);

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/storage/overview",
      headers: base,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: base,
      payload: { code: "storage-overview-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookie = Array.isArray(cookies)
      ? cookies.map((value) => value.split(";", 1)[0]).join("; ")
      : cookies;
    const authenticated = await app.inject({
      method: "GET",
      url: "/api/storage/overview",
      headers: { ...base, cookie },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual({
      schemaVersion: 1,
      overview: {
        measuredAt: "2026-08-20T08:00:00.000Z",
        pressure: "WARNING",
        freeBytes: 12 * 1024 ** 3,
        warningBytes: 20 * 1024 ** 3,
        dangerBytes: 5 * 1024 ** 3,
        writeRateBytesPerSecond: 2_000,
        estimatedSecondsUntilBlocked: 3_758_096,
        activeRunCount: 2,
      },
    });
    await app.close();
  });

  it("reports an unavailable service without exposing runtime details", async () => {
    const port = 4821;
    const app = await createApp({
      port,
      bootstrapCode: "storage-unavailable-code",
      launchSecret: "storage-unavailable-secret",
    });
    const base = headers(port);
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: base,
      payload: { code: "storage-unavailable-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookie = Array.isArray(cookies)
      ? cookies.map((value) => value.split(";", 1)[0]).join("; ")
      : cookies;
    const response = await app.inject({
      method: "GET",
      url: "/api/storage/overview",
      headers: { ...base, cookie },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Storage overview service unavailable." });
    await app.close();
  });
});
