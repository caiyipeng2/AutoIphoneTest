// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageOverviewSnapshot } from "../../state/api";
import { StorageOverviewPanel } from "./StorageOverviewPanel";

const snapshot: StorageOverviewSnapshot = {
  measuredAt: "2026-08-20T08:00:00.000Z",
  pressure: "WARNING",
  freeBytes: 12 * 1024 ** 3,
  warningBytes: 20 * 1024 ** 3,
  dangerBytes: 5 * 1024 ** 3,
  writeRateBytesPerSecond: 2_000,
  estimatedSecondsUntilBlocked: 3_758_096,
  activeRunCount: 2,
};

describe("StorageOverviewPanel", () => {
  afterEach(() => cleanup());

  it("shows free space, pressure, write rate, estimate, and active run impact", () => {
    render(
      <StorageOverviewPanel snapshot={snapshot} loading={false} error={null} onRefresh={vi.fn()} />,
    );

    expect(screen.getByText("注意")).toBeInTheDocument();
    expect(screen.getByText("12.0 GiB")).toBeInTheDocument();
    expect(screen.getByText("2.0 KiB/秒")).toBeInTheDocument();
    expect(screen.getByText("43 天")).toBeInTheDocument();
    expect(screen.getByText("2 个会话")).toBeInTheDocument();
  });

  it("announces loading and allows retry from an unavailable state", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <StorageOverviewPanel snapshot={null} loading={true} error={null} onRefresh={onRefresh} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("正在读取磁盘状态");

    rerender(
      <StorageOverviewPanel
        snapshot={null}
        loading={false}
        error="存储状态暂不可用。"
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("存储状态暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
