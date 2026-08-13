import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { IncidentRouteService } from "./incidents.js";

const service: IncidentRouteService = {
  getTimeline: (runId) =>
    runId === "run-1"
      ? {
          runId,
          incidents: [
            {
              schemaVersion: 1,
              incidentId: "inc-a",
              runId,
              serial: "device-a",
              category: "APPIUM_SESSION_LOST",
              detectedAtRealtimeMs: 20,
              detectedAt: "2026-08-13T10:00:02.000Z",
              source: "appium-action",
              details: { actionId: "action-1" },
            },
          ],
          recoveries: [
            {
              id: "recovery-a",
              incidentId: "inc-a",
              runId,
              action: "PAUSE_ALL",
              reason: "leader failed",
              deadlineRealtimeMs: 2_020,
              status: "SUCCEEDED",
              startedAt: "2026-08-13T10:00:02.100Z",
              completedAt: "2026-08-13T10:00:02.200Z",
            },
          ],
        }
      : undefined,
};

describe("incident timeline route", () => {
  it("requires a bootstrap session and returns incidents with recoveries", async () => {
    const app = await createApp({
      port: 4796,
      bootstrapCode: "incident-bootstrap",
      launchSecret: "incident-secret",
      incidentService: service,
    });
    const headers = { host: "127.0.0.1:4796", origin: "http://127.0.0.1:4796" };
    expect(
      (await app.inject({ method: "GET", url: "/api/sessions/run-1/incidents", headers }))
        .statusCode,
    ).toBe(401);
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "incident-bootstrap" },
    });
    const cookies = exchange.headers["set-cookie"] as string[];
    const cookie = cookies.map((value) => value.split(";", 1)[0]).join("; ");
    const result = await app.inject({
      method: "GET",
      url: "/api/sessions/run-1/incidents",
      headers: { ...headers, cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ schemaVersion: 1, timeline: service.getTimeline("run-1") });
  });

  it("returns 404 when the run has no incident timeline", async () => {
    const app = await createApp({ port: 4797, incidentService: service });
    const result = await app.inject({
      method: "GET",
      url: "/api/sessions/missing/incidents",
      headers: { host: "127.0.0.1:4797" },
    });
    expect(result.statusCode).toBe(401);
  });
});
