import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  exports: [
    {
      id: "html-1",
      runId: "run-1",
      format: "HTML",
      state: "READY",
      finalRelativePath: "reports/report.html",
      sha256: "a".repeat(64),
      sizeBytes: 21,
      attempt: 1,
      createdAt: "2026-08-15T02:05:00.000Z",
      updatedAt: "2026-08-15T02:05:00.000Z",
    },
    {
      id: "zip-1",
      runId: "run-1",
      format: "ZIP",
      state: "READY",
      finalRelativePath: "reports/evidence.zip",
      sha256: "b".repeat(64),
      sizeBytes: 8,
      attempt: 1,
      createdAt: "2026-08-15T02:05:00.000Z",
      updatedAt: "2026-08-15T02:05:00.000Z",
    },
  ],
};

const unsafeItem: ReportHistoryItem = {
  ...item,
  runId: "run-unsafe",
  exports: item.exports.map((reportExport) => ({
    ...reportExport,
    id: `${reportExport.id}-unsafe`,
    runId: "run-unsafe",
    finalRelativePath: "../outside.html",
  })),
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
      get: (runId) =>
        runId === item.runId ? item : runId === unsafeItem.runId ? unsafeItem : undefined,
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

  it("serves only ready exports from the configured run root", async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "test-center-results-"));
    await mkdir(join(root, "reports"), { recursive: true });
    await writeFile(join(root, "reports", "report.html"), "<h1>run-1</h1>");
    await writeFile(join(root, "reports", "evidence.zip"), Buffer.from("PK\x03\x04"));
    const port = 4800;
    const app = await createApp({
      port,
      bootstrapCode: "results-export-code",
      launchSecret: "results-export-secret",
      resultsExportRoot: root,
      resultsService: {
        list: () => [item],
        get: (runId) =>
          runId === item.runId ? item : runId === unsafeItem.runId ? unsafeItem : undefined,
      },
    });
    const base = headers(port);
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: base,
      payload: { code: "results-export-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const authenticated = { ...base, cookie: cookieHeader };

    const html = await app.inject({
      method: "GET",
      url: "/api/results/run-1/exports/HTML",
      headers: authenticated,
    });
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.headers["content-disposition"]).toContain("inline");
    expect(html.body).toContain("<h1>run-1</h1>");

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/results/run-1/exports/HTML",
      headers: base,
    });
    expect(unauthorized.statusCode).toBe(401);

    const unsafe = await app.inject({
      method: "GET",
      url: "/api/results/run-unsafe/exports/HTML",
      headers: authenticated,
    });
    expect(unsafe.statusCode).toBe(404);

    const zip = await app.inject({
      method: "GET",
      url: "/api/results/run-1/exports/ZIP",
      headers: authenticated,
    });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers["content-type"]).toContain("application/zip");
    expect(zip.headers["content-disposition"]).toContain("attachment");
    expect(zip.rawPayload).toEqual(Buffer.from("PK\x03\x04"));

    await app.close();
    await rm(root, { recursive: true, force: true });
  });
});
