// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CleanupPreviewPanel } from "./CleanupPreviewPanel";

describe("CleanupPreviewPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the read-only retention summary and candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          retentionDays: 30,
          preview: {
            cutoffAt: "2026-07-19T00:00:00.000Z",
            candidates: [
              {
                runId: "run-old",
                state: "FINISHED",
                completedAt: "2026-07-01T00:00:00.000Z",
                estimatedBytes: 300,
              },
            ],
            totalEstimatedBytes: 300,
          },
        }),
      }),
    );

    render(<CleanupPreviewPanel retentionDays={30} reloadToken={0} />);

    expect(screen.getByRole("status")).toHaveTextContent("读取清理预览");
    expect(await screen.findByText("run-old")).toBeInTheDocument();
    expect(screen.getByText("1 个候选运行")).toBeInTheDocument();
    expect(screen.getAllByText("300 B")).toHaveLength(2);
    expect(screen.getByText("只读预览，不会执行删除")).toBeInTheDocument();
  });

  it("announces an empty preview and request errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          retentionDays: 30,
          preview: { cutoffAt: "2026-07-19T00:00:00.000Z", candidates: [], totalEstimatedBytes: 0 },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<CleanupPreviewPanel retentionDays={30} reloadToken={0} />);
    expect(await screen.findByText("没有符合条件的运行")).toBeInTheDocument();

    rerender(<CleanupPreviewPanel retentionDays={30} reloadToken={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取清理预览");
  });

  it("selects exact candidates before opening the destructive dialog", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        retentionDays: 30,
        preview: {
          cutoffAt: "2026-07-19T00:00:00.000Z",
          candidates: [
            {
              runId: "run-old",
              state: "FINISHED",
              completedAt: "2026-07-01T00:00:00.000Z",
              estimatedBytes: 300,
            },
          ],
          totalEstimatedBytes: 300,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CleanupPreviewPanel retentionDays={30} reloadToken={0} />);
    await screen.findByText("run-old");
    expect(screen.getByRole("button", { name: "清理选中" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择清理 run-old" }));
    expect(screen.getByRole("button", { name: "清理选中" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "清理选中" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("run-old");
    expect(screen.getByRole("dialog")).toHaveTextContent("300 B");
  });
});
