import { describe, expect, it, vi } from "vitest";

import type { SessionRouteService, SessionView } from "./sessions.js";
import { createApp } from "../app.js";
import { parseDeviceSerial } from "@test-center/contracts/device";
import type { ActionView } from "@test-center/sessions";

const view: SessionView = {
  id: "run-1",
  clientRequestId: "create-1",
  packageName: "com.example.game",
  state: "CREATED",
  currentEpoch: 1,
  leaderVideoEnabled: true,
  failurePolicy: "PAUSE_ALL",
  bridgeMode: "REQUIRED",
  leader: {
    serial: parseDeviceSerial("R5CX211TXNT"),
    role: "LEADER",
    membershipState: "ACTIVE",
    epoch: 1,
    generation: 1,
  },
  devices: [
    {
      serial: parseDeviceSerial("R5CX211TXNT"),
      role: "LEADER",
      membershipState: "ACTIVE",
      epoch: 1,
      generation: 1,
    },
  ],
};

const action: ActionView = {
  id: "act-1",
  runId: "run-1",
  clientRequestId: "action-1",
  actionSeq: 1,
  type: "tap",
  command: { type: "tap", x: 0.5, y: 0.5 },
  payload: { kind: "tap", x: 0.5, y: 0.5 },
  sourceMetricsEpoch: 1,
  state: "QUEUED",
  targets: [{ serial: view.leader.serial, state: "QUEUED" }],
};

function service(): SessionRouteService {
  return {
    create: async (input) => ({
      session: { ...view, bridgeMode: input.bridgeMode ?? view.bridgeMode },
      state: "CREATED",
    }),
    get: (id) => (id === view.id ? view : undefined),
    preflight: async () => ({ ...view, state: "PREFLIGHT" }),
    start: async () => ({ ...view, state: "RUNNING" }),
    submitAction: async () => ({ state: "CREATED", action }),
    pause: async () => ({ ...view, state: "PAUSED" }),
    complete: async () => ({ ...view, state: "FINISHED" }),
  };
}

describe("session create/detail routes", () => {
  it("requires auth and CSRF, then creates and reads one leader session", async () => {
    const app = await createApp({
      port: 4795,
      bootstrapCode: "session-bootstrap",
      launchSecret: "session-secret",
      sessionService: service(),
    });
    const headers = { host: "127.0.0.1:4795", origin: "http://127.0.0.1:4795" };
    expect(
      (await app.inject({ method: "GET", url: "/api/sessions/run-1", headers })).statusCode,
    ).toBe(401);

    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "session-bootstrap" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const csrf = Array.isArray(cookies)
      ? cookies
          .find((cookie) => cookie.startsWith("tc_csrf="))
          ?.split("=", 2)[1]
          ?.split(";", 1)[0]
      : undefined;
    expect(cookieHeader).toBeTruthy();
    expect(csrf).toBeTruthy();

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { ...headers, cookie: cookieHeader },
      payload: {
        clientRequestId: "create-1",
        packageName: view.packageName,
        deviceSerial: view.leader.serial,
      },
    });
    expect(missingCsrf.statusCode).toBe(403);
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: {
        clientRequestId: "create-1",
        packageName: view.packageName,
        deviceSerials: [view.leader.serial],
        leaderVideoEnabled: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ schemaVersion: 1, state: "CREATED", session: view });

    const appiumOnly = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: {
        clientRequestId: "create-appium-only",
        packageName: view.packageName,
        deviceSerials: [view.leader.serial],
        leaderVideoEnabled: true,
        bridgeMode: "APPIUM_ONLY",
      },
    });
    expect(appiumOnly.statusCode).toBe(201);
    expect(appiumOnly.json()).toMatchObject({
      schemaVersion: 1,
      session: { ...view, bridgeMode: "APPIUM_ONLY" },
    });

    const preflight = await app.inject({
      method: "POST",
      url: "/api/sessions/run-1/preflight",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflight.json()).toMatchObject({
      schemaVersion: 1,
      session: { ...view, state: "PREFLIGHT" },
    });
    const started = await app.inject({
      method: "POST",
      url: "/api/sessions/run-1/start",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      schemaVersion: 1,
      session: { ...view, state: "RUNNING" },
    });

    const actionResponse = await app.inject({
      method: "POST",
      url: "/api/sessions/run-1/actions",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: {
        clientRequestId: "action-1",
        type: "tap",
        payload: { kind: "tap", x: 0.5, y: 0.5 },
        sourceMetricsEpoch: 1,
      },
    });
    expect(actionResponse.statusCode).toBe(201);
    expect(actionResponse.json()).toMatchObject({ schemaVersion: 1, state: "CREATED", action });

    const detail = await app.inject({
      method: "GET",
      url: "/api/sessions/run-1",
      headers: { ...headers, cookie: cookieHeader },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ schemaVersion: 1, session: view });
    await app.close();
  });

  it("maps an idempotent create retry to 200 and missing sessions to 404", async () => {
    const app = await createApp({
      port: 4796,
      bootstrapCode: "session-bootstrap-2",
      launchSecret: "session-secret-2",
      sessionService: {
        create: async () => ({ session: view, state: "DEDUPLICATED" }),
        get: () => undefined,
        preflight: async () => ({ ...view, state: "PREFLIGHT" }),
        start: async () => ({ ...view, state: "RUNNING" }),
        submitAction: async () => ({ state: "DEDUPLICATED", action }),
        pause: async () => ({ ...view, state: "PAUSED" }),
      },
    });
    const headers = { host: "127.0.0.1:4796", origin: "http://127.0.0.1:4796" };
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "session-bootstrap-2" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const csrf = Array.isArray(cookies)
      ? cookies
          .find((cookie) => cookie.startsWith("tc_csrf="))
          ?.split("=", 2)[1]
          ?.split(";", 1)[0]
      : undefined;
    const retry = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: {
        clientRequestId: "create-1",
        packageName: view.packageName,
        deviceSerial: view.leader.serial,
      },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ state: "DEDUPLICATED" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/sessions/missing",
          headers: { ...headers, cookie: cookieHeader },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("exposes a protected pause endpoint", async () => {
    const pause = { pause: async () => ({ ...view, state: "PAUSED" as const }) };
    const app = await createApp({
      port: 4797,
      bootstrapCode: "session-bootstrap-3",
      launchSecret: "session-secret-3",
      sessionService: { ...service(), ...pause },
    });
    const headers = { host: "127.0.0.1:4797", origin: "http://127.0.0.1:4797" };
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "session-bootstrap-3" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const csrf = Array.isArray(cookies)
      ? cookies
          .find((cookie) => cookie.startsWith("tc_csrf="))
          ?.split("=", 2)[1]
          ?.split(";", 1)[0]
      : undefined;
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/run-1/pause",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: { reason: "fault-monitor" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: 1, session: { state: "PAUSED" } });
    await app.close();
  });

  it("exposes a protected completion endpoint that accepts a terminal outcome", async () => {
    const complete = async () => ({ ...view, state: "FAILED" as const });
    const app = await createApp({
      port: 4798,
      bootstrapCode: "session-bootstrap-4",
      launchSecret: "session-secret-4",
      sessionService: { ...service(), complete },
    });
    const headers = { host: "127.0.0.1:4798", origin: "http://127.0.0.1:4798" };
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "session-bootstrap-4" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const csrf = Array.isArray(cookies)
      ? cookies
          .find((cookie) => cookie.startsWith("tc_csrf="))
          ?.split("=", 2)[1]
          ?.split(";", 1)[0]
      : undefined;

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/run-1/complete",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: { state: "FAILED", reason: "operator-failure" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      session: { ...view, state: "FAILED" },
    });
    await app.close();
  });

  it("exposes a protected resume endpoint for paused sessions", async () => {
    const resume = vi.fn(async (id: string, reason: string) => {
      expect(id).toBe("run-1");
      expect(reason).toBe("operator-rebuild");
      return { ...view, state: "RUNNING" as const, currentEpoch: 2 };
    });
    const app = await createApp({
      port: 4799,
      bootstrapCode: "session-bootstrap-5",
      launchSecret: "session-secret-5",
      sessionService: { ...service(), resume },
    });
    const headers = { host: "127.0.0.1:4799", origin: "http://127.0.0.1:4799" };
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "session-bootstrap-5" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const csrf = Array.isArray(cookies)
      ? cookies
          .find((cookie) => cookie.startsWith("tc_csrf="))
          ?.split("=", 2)[1]
          ?.split(";", 1)[0]
      : undefined;

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/run-1/resume",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: { reason: "operator-rebuild" },
    });

    expect(response.statusCode).toBe(200);
    expect(resume).toHaveBeenCalledWith("run-1", "operator-rebuild");
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      session: { state: "RUNNING", currentEpoch: 2 },
    });
    await app.close();
  });

  it("exposes a protected action retry endpoint with a new parent-linked action", async () => {
    const retryAction = vi.fn(
      async (id: string, actor: string, actionId: string, input: { clientRequestId: string }) => {
        expect([id, actor, actionId]).toEqual(["run-1", expect.any(String), "act-parent"]);
        return {
          state: "CREATED" as const,
          action: {
            ...action,
            id: "act-retry",
            clientRequestId: input.clientRequestId,
            actionSeq: 2,
            parentActionId: "act-parent",
          },
        };
      },
    );
    const app = await createApp({
      port: 4800,
      bootstrapCode: "session-bootstrap-6",
      launchSecret: "session-secret-6",
      sessionService: { ...service(), retryAction },
    });
    const headers = { host: "127.0.0.1:4800", origin: "http://127.0.0.1:4800" };
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "session-bootstrap-6" },
    });
    const cookies = exchange.headers["set-cookie"];
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
      : cookies;
    const csrf = Array.isArray(cookies)
      ? cookies
          .find((cookie) => cookie.startsWith("tc_csrf="))
          ?.split("=", 2)[1]
          ?.split(";", 1)[0]
      : undefined;

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/run-1/actions/act-parent/retry",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: { clientRequestId: "action-retry-1", sourceMetricsEpoch: 2 },
    });

    expect(response.statusCode).toBe(201);
    expect(retryAction).toHaveBeenCalledWith("run-1", expect.any(String), "act-parent", {
      clientRequestId: "action-retry-1",
      sourceMetricsEpoch: 2,
    });
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      state: "CREATED",
      action: { id: "act-retry", parentActionId: "act-parent" },
    });
    await app.close();
  });
});
