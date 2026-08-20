// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("saves the controlled retention window and reports success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          retentionDays: 30,
          preview: { cutoffAt: "2026-07-19T00:00:00.000Z", candidates: [], totalEstimatedBytes: 0 },
        }),
      }),
    );
    const onSave = vi.fn().mockResolvedValue({
      version: 3,
      values: { retentionDays: 45 },
    });

    render(
      <SettingsPage settings={{ version: 2, values: { retentionDays: 30 } }} onSave={onSave} />,
    );

    const input = screen.getByLabelText("保留天数");
    expect(input).toHaveValue(30);
    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ retentionDays: 45 }));
    const message = await screen.findByText("设置已保存");
    expect(message).toHaveAttribute("role", "status");
  });
});
