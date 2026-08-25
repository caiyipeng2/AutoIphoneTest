// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsPage } from "./SessionsPage";

describe("SessionsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("connects the selected serial to the leader viewport", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ schemaVersion: 1, devices: [] })),
    );
    vi.stubGlobal("VideoDecoder", undefined);
    render(<SessionsPage />);

    fireEvent.change(screen.getByRole("textbox", { name: "Android 设备串号" }), {
      target: { value: "R5CX211TXNT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接主视图" }));

    expect(screen.getByRole("heading", { name: "主设备画面" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在建立降级截图通道");
  });

  it("creates and starts a synchronized session for two online devices", async () => {
    const devices = [
      {
        serial: "R5CX211TXNT",
        state: "ONLINE",
        metadata: { model: "SM-S9280" },
        firstSeenAt: "now",
        lastSeenAt: "now",
        connectionSeq: 1,
        tags: [],
      },
      {
        serial: "R5CWB17PN0Y",
        state: "ONLINE",
        metadata: { model: "SM-A5460" },
        firstSeenAt: "now",
        lastSeenAt: "now",
        connectionSeq: 1,
        tags: [],
      },
    ];
    const session = (state: "CREATED" | "PREFLIGHT" | "RUNNING") => ({
      id: "run-2",
      clientRequestId: "request-2",
      packageName: "com.hg.idleweaponshoptycoon.android",
      state,
      currentEpoch: 1,
      leaderVideoEnabled: true,
      leader: {
        serial: "R5CX211TXNT",
        role: "LEADER",
        membershipState: "ACTIVE",
        epoch: 1,
        generation: 1,
      },
      devices: [
        {
          serial: "R5CX211TXNT",
          role: "LEADER",
          membershipState: "ACTIVE",
          epoch: 1,
          generation: 1,
        },
        {
          serial: "R5CWB17PN0Y",
          role: "FOLLOWER",
          membershipState: "ACTIVE",
          epoch: 1,
          generation: 1,
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/devices") return jsonResponse({ schemaVersion: 1, devices });
      if (url === "/api/sessions" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          deviceSerials: ["R5CX211TXNT", "R5CWB17PN0Y"],
        });
        return jsonResponse(
          { schemaVersion: 1, state: "CREATED", session: session("CREATED") },
          201,
        );
      }
      if (url.endsWith("/preflight"))
        return jsonResponse({ schemaVersion: 1, session: session("PREFLIGHT") });
      if (url.endsWith("/start"))
        return jsonResponse({ schemaVersion: 1, session: session("RUNNING") });
      if (url.endsWith("/incidents"))
        return jsonResponse({
          schemaVersion: 1,
          timeline: { runId: "run-2", incidents: [], recoveries: [] },
        });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /R5CX211TXNT/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /R5CX211TXNT/ }));
    fireEvent.click(screen.getByRole("button", { name: /R5CWB17PN0Y/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建同步会话" }));

    await waitFor(() => expect(screen.getByText(/2 台设备已绑定/)).toBeInTheDocument());
    expect(screen.getByText("Follower")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
