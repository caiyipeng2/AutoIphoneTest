import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("authenticated local control plane", () => {
  it("exchanges a one-time bootstrap code and rejects replay", async () => {
    const app = await createApp({
      port: 4780,
      bootstrapCode: "bootstrap-1",
      launchSecret: "secret-1",
    });
    const headers = { host: "127.0.0.1:4780", origin: "http://127.0.0.1:4780" };
    const first = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "bootstrap-1" },
    });
    expect(first.statusCode).toBe(204);
    expect(first.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringMatching(/HttpOnly/)]),
    );

    const replay = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "bootstrap-1" },
    });
    expect(replay.statusCode).toBe(401);
    await app.close();
  });

  it("returns a health snapshot and protects settings mutations with origin and CSRF", async () => {
    const app = await createApp({
      port: 4780,
      bootstrapCode: "bootstrap-2",
      launchSecret: "secret-2",
    });
    const headers = { host: "127.0.0.1:4780", origin: "http://127.0.0.1:4780" };
    const health = await app.inject({ method: "GET", url: "/api/health", headers });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ schemaVersion: 1, service: { state: "READY" } });

    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "bootstrap-2" },
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

    const settings = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { ...headers, cookie: cookieHeader },
    });
    expect(settings.statusCode).toBe(200);
    const denied = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: {
        ...headers,
        cookie: cookieHeader,
        origin: "http://evil.example",
        "x-test-center-csrf": csrf,
      },
      payload: { retentionDays: 30 },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: { retentionDays: 30 },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });
});
