import { describe, expect, it, vi } from "vitest";
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
  finalization: {
    runId: "run-1",
    state: "FINALIZATION_FAILED",
    attempt: 1,
    errorCategory: "EXPORT_FAILED",
    startedAt: "2026-08-15T02:05:00.000Z",
    updatedAt: "2026-08-15T02:05:01.000Z",
  },
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

  it("serves the newest export attempt for a retried report", async () => {
    const root = await mkdtemp(
      join(process.env.TEMP ?? process.cwd(), "test-center-results-retry-"),
    );
    await mkdir(join(root, "reports"), { recursive: true });
    await writeFile(join(root, "reports", "evidence-2.zip"), Buffer.from("PK\x05\x06"));
    const retryItem: ReportHistoryItem = {
      ...item,
      runId: "run-retry",
      exports: [
        {
          ...item.exports[0]!,
          runId: "run-retry",
          state: "READY",
          attempt: 1,
        },
        {
          id: "zip-1",
          runId: "run-retry",
          format: "ZIP",
          state: "FAILED",
          attempt: 1,
          createdAt: item.updatedAt,
          updatedAt: item.updatedAt,
        },
        {
          ...item.exports[1]!,
          id: "zip-2",
          runId: "run-retry",
          state: "READY",
          finalRelativePath: "reports/evidence-2.zip",
          attempt: 2,
        },
      ],
    };
    const port = 4802;
    const app = await createApp({
      port,
      bootstrapCode: "results-retry-export-code",
      launchSecret: "results-retry-export-secret",
      resultsExportRoot: root,
      resultsService: {
        list: () => [retryItem],
        get: (runId) => (runId === retryItem.runId ? retryItem : undefined),
      },
    });
    const base = headers(port);
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: base,
      payload: { code: "results-retry-export-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const response = await app.inject({
      method: "GET",
      url: "/api/results/run-retry/exports/ZIP",
      headers: { ...base, cookie: cookieHeader },
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from("PK\x05\x06"));
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("guards finalization retry with CSRF, idempotency, and terminal state", async () => {
    const port = 4801;
    const completedItem: ReportHistoryItem = {
      ...item,
      runId: "run-completed",
      finalization: {
        ...item.finalization!,
        runId: "run-completed",
        state: "COMPLETED",
        completedAt: "2026-08-15T02:05:02.000Z",
      },
    };
    const retry = vi.fn(async (runId: string, idempotencyKey: string) => {
      expect(runId).toBe("run-1");
      expect(idempotencyKey).toBe("retry-1");
      return item;
    });
    const app = await createApp({
      port,
      bootstrapCode: "results-retry-code",
      launchSecret: "results-retry-secret",
      resultsService: {
        list: () => [item],
        get: (runId) =>
          runId === item.runId ? item : runId === completedItem.runId ? completedItem : undefined,
        retryFinalization: retry,
      },
    });
    const base = headers(port);
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/results/run-1/retry-finalization",
      headers: base,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers: base,
      payload: { code: "results-retry-code" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const csrf = cookieHeader?.match(/(?:^|; )tc_csrf=([^;]+)/)?.[1];
    const authenticated = { ...base, cookie: cookieHeader };
    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/results/run-1/retry-finalization",
      headers: { ...authenticated, "idempotency-key": "retry-1" },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const missingIdempotency = await app.inject({
      method: "POST",
      url: "/api/results/run-1/retry-finalization",
      headers: { ...authenticated, "x-test-center-csrf": csrf },
    });
    expect(missingIdempotency.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/results/run-1/retry-finalization",
      headers: {
        ...authenticated,
        "x-test-center-csrf": csrf,
        "idempotency-key": "retry-1",
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ schemaVersion: 1, result: item });
    expect(retry).toHaveBeenCalledOnce();

    const terminal = await app.inject({
      method: "POST",
      url: "/api/results/run-completed/retry-finalization",
      headers: {
        ...authenticated,
        "x-test-center-csrf": csrf,
        "idempotency-key": "retry-terminal",
      },
    });
    expect(terminal.statusCode).toBe(409);
    expect(retry).toHaveBeenCalledOnce();
    await app.close();
  });
});
