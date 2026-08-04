// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { NAV_ITEMS } from "./state/navigation";

describe("console shell", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("exposes all seven operator pages and announces the active page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<App />);
    expect(NAV_ITEMS).toHaveLength(7);
    for (const item of NAV_ITEMS)
      expect(screen.getByRole("link", { name: item.label })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "设备" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "设备" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "设备" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the health banner in the same status region when degraded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          service: { state: "DEGRADED" },
          environment: { overall: "degraded", generatedAt: new Date().toISOString() },
          updatedAt: new Date().toISOString(),
        }),
      }),
    );
    render(<App />);
    expect(await screen.findByText("环境降级")).toBeInTheDocument();
    expect(screen.getByTestId("health-banner")).toHaveClass("health-banner");
  });
});
