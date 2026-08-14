// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IncidentTimeline } from "./IncidentTimeline";

describe("IncidentTimeline", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("filters incidents by category and expands details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 1,
          timeline: {
            runId: "run-1",
            incidents: [
              {
                schemaVersion: 1,
                incidentId: "inc-crash",
                runId: "run-1",
                serial: "device-a",
                category: "APP_CRASH_OR_ANR",
                detectedAtRealtimeMs: 1,
                detectedAt: "2026-08-13T10:00:00.000Z",
                source: "logcat",
                evidenceRef: "runs/run-1/crash.log",
                details: { message: "FATAL EXCEPTION", packageName: "com.example.game" },
              },
              {
                schemaVersion: 1,
                incidentId: "inc-bridge",
                runId: "run-1",
                serial: "device-b",
                category: "BRIDGE_TIMEOUT",
                detectedAtRealtimeMs: 2,
                detectedAt: "2026-08-13T10:00:01.000Z",
                source: "device-worker",
                details: { message: "bridge timeout" },
              },
            ],
            recoveries: [],
          },
        }),
      })),
    );

    render(<IncidentTimeline sessionId="run-1" />);
    await waitFor(() => {
      const articles = screen.getAllByRole("article");
      expect(articles).toHaveLength(2);
      const firstArticle = articles[0];
      if (!firstArticle) throw new Error("Expected the first incident article to be rendered");
      expect(within(firstArticle).getByText("游戏崩溃 / ANR")).toBeInTheDocument();
    });
    const articles = screen.getAllByRole("article");
    const secondArticle = articles[1];
    if (!secondArticle) throw new Error("Expected the second incident article to be rendered");
    expect(within(secondArticle).getByText("Bridge 超时")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "故障类别" }), {
      target: { value: "APP_CRASH_OR_ANR" },
    });
    expect(within(screen.getByRole("article")).getByText("游戏崩溃 / ANR")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(within(screen.getByRole("article")).queryByText("Bridge 超时")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开故障详情 inc-crash" }));
    expect(screen.getByText("runs/run-1/crash.log")).toBeInTheDocument();
    expect(screen.getByText("packageName：com.example.game")).toBeInTheDocument();
  });
});
