import { describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import type { DeploymentRouteService } from "./deployments.js";
import type { DeploymentView } from "@test-center/deployments";
import { createApp } from "../app.js";

const serial = parseDeviceSerial("R5CX211TXNT");

function view() {
  return {
    id: "deployment-1",
    clientRequestId: "request-1",
    artifactId: "artifact-1",
    deviceSerial: serial,
    deviceSerials: [serial],
    devices: [
      {
        serial,
        role: "LEADER" as const,
        state: "QUEUED" as const,
        currentStep: null,
        failedStep: null,
        failureMessage: null,
      },
    ],
    packageName: "com.example.game",
    mutation: "NONE" as const,
    state: "QUEUED" as const,
    currentStep: null,
    failedStep: null,
    failureMessage: null,
  };
}

describe("deployment routes", () => {
  it("enforces session and CSRF before exposing the single-device controls", async () => {
    let confirmationSession: string | undefined;
    const service: DeploymentRouteService = {
      list: () => [view()],
      get: () => view(),
      issueConfirmation: ({ sessionId }) => {
        confirmationSession = sessionId;
        return { nonce: "nonce-1", expiresAt: "2026-08-06T00:01:00.000Z" };
      },
      create: async () => view(),
      run: async () => view(),
      cancel: async () => ({ ...view(), state: "CANCELLED" }),
      retry: async () => view(),
    };
    const app = await createApp({
      port: 4790,
      bootstrapCode: "deployment-bootstrap",
      launchSecret: "deployment-secret",
      deploymentService: service,
    });
    const headers = { host: "127.0.0.1:4790", origin: "http://127.0.0.1:4790" };
    expect((await app.inject({ method: "GET", url: "/api/deployments", headers })).statusCode).toBe(
      401,
    );

    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "deployment-bootstrap" },
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
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/deployments/confirmations",
          headers: { ...headers, cookie: cookieHeader },
          payload: { artifactId: "artifact-1", deviceSerial: serial, operationKind: "CLEAR_DATA" },
        })
      ).statusCode,
    ).toBe(403);

    const confirmation = await app.inject({
      method: "POST",
      url: "/api/deployments/confirmations",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: { artifactId: "artifact-1", deviceSerial: serial, operationKind: "CLEAR_DATA" },
    });
    expect(confirmation.statusCode).toBe(200);
    expect(confirmation.json()).toMatchObject({ schemaVersion: 1, nonce: "nonce-1" });
    expect(confirmationSession).toBeTruthy();

    const created = await app.inject({
      method: "POST",
      url: "/api/deployments",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: { clientRequestId: "request-1", artifactId: "artifact-1", deviceSerial: serial },
    });
    expect(created.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/deployments",
          headers: { ...headers, cookie: cookieHeader },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });

  it("passes a selected 1-4 serial set to the deployment service", async () => {
    const selected = [serial, parseDeviceSerial("R5CWB17PN0Y")];
    let received: DeploymentView | undefined;
    const service: DeploymentRouteService = {
      list: () => [],
      get: () => view(),
      issueConfirmation: () => ({ nonce: "nonce-1", expiresAt: "2026-08-06T00:01:00.000Z" }),
      create: async (input) => {
        expect(input.deviceSerials).toEqual(selected);
        expect(input.deviceSerial).toBeUndefined();
        received = view();
        return received;
      },
      run: async () => view(),
      cancel: async () => view(),
      retry: async () => view(),
    };
    const app = await createApp({
      port: 4791,
      bootstrapCode: "deployment-bootstrap-group",
      launchSecret: "deployment-secret",
      deploymentService: service,
    });
    const headers = { host: "127.0.0.1:4791", origin: "http://127.0.0.1:4791" };
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "deployment-bootstrap-group" },
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
      url: "/api/deployments",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: {
        clientRequestId: "group-request",
        artifactId: "artifact-1",
        deviceSerials: selected,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(received?.deviceSerials).toEqual([serial]);
    await app.close();
  });
});
