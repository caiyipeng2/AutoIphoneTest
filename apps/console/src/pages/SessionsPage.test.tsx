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
      bridgeMode: "REQUIRED",
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
      if (url.endsWith("/actions")) return jsonResponse({ schemaVersion: 1, actions: [] });
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

  it("submits and displays an explicit Appium-only session mode", async () => {
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
    ];
    const session = (state: "CREATED" | "PREFLIGHT" | "RUNNING") => ({
      id: "run-appium-only",
      clientRequestId: "request-appium-only",
      packageName: "com.hg.idleweaponshoptycoon.android",
      state,
      currentEpoch: 1,
      leaderVideoEnabled: true,
      bridgeMode: "APPIUM_ONLY" as const,
      leader: {
        serial: "R5CX211TXNT",
        role: "LEADER" as const,
        membershipState: "ACTIVE" as const,
        epoch: 1,
        generation: 1,
      },
      devices: [
        {
          serial: "R5CX211TXNT",
          role: "LEADER" as const,
          membershipState: "ACTIVE" as const,
          epoch: 1,
          generation: 1,
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/devices") return jsonResponse({ schemaVersion: 1, devices });
      if (url === "/api/sessions" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({ bridgeMode: "APPIUM_ONLY" });
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
          timeline: { runId: "run-appium-only", incidents: [], recoveries: [] },
        });
      if (url.endsWith("/actions")) return jsonResponse({ schemaVersion: 1, actions: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /R5CX211TXNT/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /R5CX211TXNT/ }));
    fireEvent.click(screen.getByRole("button", { name: /Appium-only/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建同步会话" }));

    await waitFor(() => expect(screen.getByText("Appium-only · 非注入同步")).toBeInTheDocument());
  });

  it("pauses and resumes the active session from the console", async () => {
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
    ];
    const session = (state: "CREATED" | "PREFLIGHT" | "RUNNING" | "PAUSED", epoch = 1) => ({
      id: "run-controls",
      clientRequestId: "request-controls",
      packageName: "com.hg.idleweaponshoptycoon.android",
      state,
      currentEpoch: epoch,
      leaderVideoEnabled: true,
      bridgeMode: "APPIUM_ONLY" as const,
      failurePolicy: "PAUSE_ALL" as const,
      leader: {
        serial: "R5CX211TXNT",
        role: "LEADER" as const,
        membershipState: "ACTIVE" as const,
        epoch,
        generation: epoch,
      },
      devices: [
        {
          serial: "R5CX211TXNT",
          role: "LEADER" as const,
          membershipState: "ACTIVE" as const,
          epoch,
          generation: epoch,
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/devices") return jsonResponse({ schemaVersion: 1, devices });
      if (url === "/api/sessions" && init?.method === "POST") {
        return jsonResponse(
          { schemaVersion: 1, state: "CREATED", session: session("CREATED") },
          201,
        );
      }
      if (url === "/api/sessions/run-controls" && (!init || init.method === undefined))
        return jsonResponse({ schemaVersion: 1, session: session("RUNNING") });
      if (url.endsWith("/preflight"))
        return jsonResponse({ schemaVersion: 1, session: session("PREFLIGHT") });
      if (url.endsWith("/start"))
        return jsonResponse({ schemaVersion: 1, session: session("RUNNING") });
      if (url.endsWith("/pause")) {
        expect(JSON.parse(String(init?.body))).toEqual({ reason: "operator-console" });
        return jsonResponse({ schemaVersion: 1, session: session("PAUSED") });
      }
      if (url.endsWith("/resume")) {
        expect(JSON.parse(String(init?.body))).toEqual({ reason: "operator-console" });
        return jsonResponse({ schemaVersion: 1, session: session("RUNNING", 2) });
      }
      if (url.endsWith("/incidents"))
        return jsonResponse({
          schemaVersion: 1,
          timeline: { runId: "run-controls", incidents: [], recoveries: [] },
        });
      if (url.endsWith("/actions")) return jsonResponse({ schemaVersion: 1, actions: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /R5CX211TXNT/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /R5CX211TXNT/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建同步会话" }));
    await waitFor(() => expect(screen.getByText("会话 运行中")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "刷新会话状态" }));
    await waitFor(() => expect(screen.getByText("会话 运行中")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "暂停会话" }));
    await waitFor(() => expect(screen.getByText("会话 已暂停")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "继续运行" }));
    await waitFor(() => expect(screen.getByText("会话 运行中")).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/run-controls/pause",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/run-controls/resume",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a failed action retry control and displays the linked child action", async () => {
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
    ];
    const session = {
      id: "run-retry-ui",
      clientRequestId: "request-retry-ui",
      packageName: "com.hg.idleweaponshoptycoon.android",
      state: "RUNNING" as const,
      currentEpoch: 1,
      leaderVideoEnabled: true,
      bridgeMode: "APPIUM_ONLY" as const,
      failurePolicy: "PAUSE_ALL" as const,
      leader: {
        serial: "R5CX211TXNT",
        role: "LEADER" as const,
        membershipState: "ACTIVE" as const,
        epoch: 1,
        generation: 1,
      },
      devices: [
        {
          serial: "R5CX211TXNT",
          role: "LEADER" as const,
          membershipState: "ACTIVE" as const,
          epoch: 1,
          generation: 1,
        },
      ],
    };
    const parent = {
      id: "act-parent-ui",
      runId: session.id,
      clientRequestId: "action-parent-ui",
      actionSeq: 1,
      type: "tap",
      parentActionId: undefined,
      sourceMetricsEpoch: 1,
      state: "FAILED",
      targets: [{ serial: "R5CX211TXNT", state: "FAILED" }],
    };
    const child = {
      ...parent,
      id: "act-child-ui",
      clientRequestId: "action-child-ui",
      actionSeq: 2,
      parentActionId: parent.id,
      state: "SUCCEEDED",
      targets: [{ serial: "R5CX211TXNT", state: "SUCCEEDED" }],
    };
    let actionListCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/devices") return jsonResponse({ schemaVersion: 1, devices });
      if (url === "/api/sessions" && init?.method === "POST")
        return jsonResponse({ schemaVersion: 1, state: "CREATED", session }, 201);
      if (url.endsWith("/preflight")) return jsonResponse({ schemaVersion: 1, session });
      if (url.endsWith("/start")) return jsonResponse({ schemaVersion: 1, session });
      if (url.endsWith("/incidents"))
        return jsonResponse({
          schemaVersion: 1,
          timeline: { runId: session.id, incidents: [], recoveries: [] },
        });
      if (url.endsWith("/actions") && (!init || init.method === undefined)) {
        actionListCalls += 1;
        return jsonResponse({
          schemaVersion: 1,
          actions: actionListCalls === 1 ? [parent] : [parent, child],
        });
      }
      if (url.endsWith("/retry")) {
        const body = JSON.parse(String(init?.body)) as { clientRequestId: string };
        expect(body.clientRequestId).toMatch(/^retry-/);
        return jsonResponse({ schemaVersion: 1, state: "CREATED", action: child }, 201);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /R5CX211TXNT/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /R5CX211TXNT/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建同步会话" }));
    await waitFor(() => expect(screen.getByText("失败")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重试 action 1" }));
    await waitFor(() => expect(screen.getByText(/父 action: act-parent-ui/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/run-retry-ui/actions/act-parent-ui/retry",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
