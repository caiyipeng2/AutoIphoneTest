import { describe, expect, it } from "vitest";

import type { ReportHistoryItem } from "@test-center/reports";
import { createApp } from "../app.js";

const item: ReportHistoryItem = {
  runId: "run-1",
  packageName: "Idle Weapon Shop Tycoon",
  state: "FINISHED",
  currentEpoch: 1,
  createdAt: "2026-08-15T02:00:00.000Z",
  updatedAt: "2026-08-15T02:05:00.000Z",
  devices: [{ serial: "R5CX211TXNT", role: "LEADER", uid: "UID-1" }],
  exports: [],
};

function headers(port: number) {
  return { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
}

async function appFor(port: number, code: string) {
  return await createApp({
    port,
    bootstrapCode: code,
    launchSecret: `${code}-secret`,
    resultsService: {
      list: () => [item],
      get: (runId) => (runId === item.runId ? item : undefined),
    },
  });
}

describe("results routes", () => {
  it("requires authentication and serves filtered history and detail", async () => {
    const port = 4798;
    const app = await appFor(port, "results-route-code");
    const base = headers(port);
    expect(
      (await app.inject({ method: "GET", url: "/api/results", headers: base })).statusCode,
    ).toBe(401);
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: base,
      payload: { code: "results-route-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const authenticated = { ...base, cookie: cookieHeader };

    const list = await app.inject({
      method: "GET",
      url: "/api/results?state=FINISHED&serial=R5CX211TXNT&limit=10",
      headers: authenticated,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ schemaVersion: 1, results: [item] });

    const detail = await app.inject({
      method: "GET",
      url: "/api/results/run-1",
      headers: authenticated,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual({ schemaVersion: 1, result: item });
    await app.close();
  });

  it("returns 503 when history is not configured", async () => {
    const port = 4799;
    const app = await createApp({
      port,
      bootstrapCode: "results-unavailable-code",
      launchSecret: "results-unavailable-secret",
    });
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: headers(port),
      payload: { code: "results-unavailable-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const response = await app.inject({
      method: "GET",
      url: "/api/results",
      headers: { ...headers(port), cookie: cookieHeader },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
