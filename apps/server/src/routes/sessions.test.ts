import { describe, expect, it } from "vitest";

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
    create: async () => ({ session: view, state: "CREATED" }),
    get: (id) => (id === view.id ? view : undefined),
    preflight: async () => ({ ...view, state: "PREFLIGHT" }),
    start: async () => ({ ...view, state: "RUNNING" }),
    submitAction: async () => ({ state: "CREATED", action }),
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
});
