// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResultsPage } from "./ResultsPage";

const results = [
  {
    runId: "run-finished",
    packageName: "Idle Weapon Shop Tycoon",
    state: "FINISHED" as const,
    currentEpoch: 1,
    createdAt: "2026-08-15T02:00:00.000Z",
    updatedAt: "2026-08-15T02:05:00.000Z",
    devices: [{ serial: "R5CX211TXNT", role: "LEADER" as const, uid: "UID-LEADER" }],
    exports: [
      {
        id: "html-1",
        runId: "run-finished",
        format: "HTML" as const,
        state: "READY" as const,
        finalRelativePath: "reports/report.html",
        attempt: 1,
        createdAt: "2026-08-15T02:05:00.000Z",
        updatedAt: "2026-08-15T02:05:00.000Z",
      },
      {
        id: "zip-1",
        runId: "run-finished",
        format: "ZIP" as const,
        state: "READY" as const,
        finalRelativePath: "reports/evidence.zip",
        attempt: 1,
        createdAt: "2026-08-15T02:05:00.000Z",
        updatedAt: "2026-08-15T02:05:00.000Z",
      },
    ],
    finalization: {
      runId: "run-finished",
      state: "COMPLETED" as const,
      attempt: 1,
      startedAt: "2026-08-15T02:05:00.000Z",
      completedAt: "2026-08-15T02:05:01.000Z",
      updatedAt: "2026-08-15T02:05:01.000Z",
    },
  },
  {
    runId: "run-failed",
    packageName: "Idle Weapon Shop Tycoon",
    state: "FAILED" as const,
    currentEpoch: 1,
    createdAt: "2026-08-14T02:00:00.000Z",
    updatedAt: "2026-08-14T02:05:00.000Z",
    devices: [{ serial: "R5CX211TXNT", role: "LEADER" as const, uid: "UID-LEADER" }],
    exports: [],
    finalization: {
      runId: "run-failed",
      state: "FINALIZATION_FAILED" as const,
      attempt: 1,
      errorCategory: "EXPORT_FAILED",
      startedAt: "2026-08-14T02:05:00.000Z",
      updatedAt: "2026-08-14T02:05:01.000Z",
    },
  },
];

describe("ResultsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads a dense history table and filters by status and search text", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/results?limit=50");
      return jsonResponse({ schemaVersion: 1, results });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ResultsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取报告历史");
    await waitFor(() => expect(screen.getByText("run-finished")).toBeInTheDocument());
    expect(screen.getByText("HTML + ZIP 已就绪")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "报告状态" }), {
      target: { value: "FAILED" },
    });
    await waitFor(() => expect(screen.getByText("仅显示失败")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索报告历史" }), {
      target: { value: "run-failed" },
    });
    expect(screen.getByText("run-failed")).toBeInTheDocument();
    expect(screen.queryByText("run-finished")).not.toBeInTheDocument();
  });

  it("announces a recoverable API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Results service unavailable." }, 503)),
    );
    render(<ResultsPage />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Results service unavailable."),
    );
    expect(screen.getByRole("button", { name: "重新读取" })).toBeInTheDocument();
  });

  it("opens a read-only result detail and returns to history", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/results?limit=50") return jsonResponse({ schemaVersion: 1, results });
      if (url === "/api/results/run-finished") {
        return jsonResponse({ schemaVersion: 1, result: results[0] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ResultsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "查看报告 run-finished" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "查看报告 run-finished" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "报告详情" })).toBeInTheDocument(),
    );
    expect(screen.getByText("UID-LEADER")).toBeInTheDocument();
    expect(screen.getByText("HTML + ZIP 已就绪")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开 HTML" })).toHaveAttribute(
      "href",
      "/api/results/run-finished/exports/HTML",
    );
    expect(screen.getByRole("link", { name: "下载 ZIP" })).toHaveAttribute(
      "href",
      "/api/results/run-finished/exports/ZIP",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/results/run-finished", undefined);

    fireEvent.click(screen.getByRole("button", { name: "返回报告历史" }));
    expect(screen.getByRole("heading", { name: "报告" })).toBeInTheDocument();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
