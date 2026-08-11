// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionsPage } from "./SessionsPage";

describe("SessionsPage", () => {
  it("connects the selected serial to the leader viewport", () => {
    vi.stubGlobal("VideoDecoder", undefined);
    render(<SessionsPage />);

    fireEvent.change(screen.getByRole("textbox", { name: "Android 设备串号" }), {
      target: { value: "R5CX211TXNT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接主视图" }));

    expect(screen.getByRole("heading", { name: "主设备画面" })).toBeInTheDocument();
    expect(screen.getByText("浏览器不支持 H.264 解码")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
