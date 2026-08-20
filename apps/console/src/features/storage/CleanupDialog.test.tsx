// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CleanupPreviewCandidate } from "../../state/api";
import { CleanupDialog } from "./CleanupDialog";

const candidates: CleanupPreviewCandidate[] = [
  {
    runId: "run-a",
    state: "FINISHED",
    completedAt: "2026-08-01T00:00:00.000Z",
    estimatedBytes: 700,
  },
  {
    runId: "run-b",
    state: "FAILED",
    completedAt: "2026-08-02T00:00:00.000Z",
    estimatedBytes: 200,
  },
];

describe("CleanupDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.cookie = "";
  });

  it("requires an explicit acknowledgement before executing and shows audit outcome", async () => {
    document.cookie = "tc_csrf=cleanup-csrf";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            confirmation: { nonce: "nonce-1", expiresAt: "2026-08-20T09:00:00.000Z" },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            result: {
              cleanupId: "cleanup-test",
              state: "RECOVERY_REQUIRED",
              moved: [
                { runId: "run-a", sourcePath: "E:\\runs\\run-a", trashPath: "E:\\trash\\run-a" },
              ],
              deleted: [],
              restored: [],
              unresolved: ["run-a"],
              errorMessage: "delete failed",
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            cleanupId: "cleanup-test",
            events: [
              {
                sequence: 1,
                cleanupId: "cleanup-test",
                kind: "STARTED",
                createdAt: "2026-08-20T08:00:00.000Z",
              },
              {
                sequence: 2,
                cleanupId: "cleanup-test",
                kind: "ROLLED_BACK",
                errorMessage: "delete failed",
                createdAt: "2026-08-20T08:00:01.000Z",
              },
            ],
          }),
        }),
    );
    const onClose = vi.fn();
    render(<CleanupDialog candidates={candidates} onClose={onClose} />);

    expect(screen.getByRole("dialog")).toHaveTextContent("900 B");
    const confirmButton = screen.getByRole("button", { name: "确认执行清理" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "确认清理 run-a 和 run-b" }));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("需要恢复"));
    expect(screen.getByText("run-a")).toBeInTheDocument();
    expect(screen.getAllByText("delete failed")).toHaveLength(2);
    expect(screen.getByText("已记录 2 条审计事件")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
