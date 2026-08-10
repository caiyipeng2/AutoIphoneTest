import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  AppiumW3cClient,
  AppiumW3cClientError,
  type SessionFence,
  type W3cAction,
} from "./w3c-client.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      async (server) =>
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function createFakeServer(
  handler: (request: string, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks).toString("utf8");
    const port = (server.address() as AddressInfo).port;
    const result = await handler(`http://127.0.0.1:${String(port)}${request.url ?? "/"}`, {
      method: request.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries(request.headers).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, Array.isArray(value) ? value.join(",") : value]],
        ),
      ),
      ...(body === undefined ? {} : { body }),
    });
    response.statusCode = result.status;
    result.headers.forEach((value, key) => response.setHeader(key, value));
    response.end(await result.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake server did not bind");
  return `http://127.0.0.1:${String(address.port)}`;
}

function capabilities() {
  return {
    platformName: "Android" as const,
    automationName: "UiAutomator2" as const,
    udid: "serial-a",
    systemPort: 8200,
    mjpegServerPort: 7810,
    noReset: true as const,
    newCommandTimeout: 60,
  };
}

async function createClient(
  baseUrl: string,
): Promise<{ client: AppiumW3cClient; fence: SessionFence }> {
  const client = new AppiumW3cClient({ baseUrl, serial: "serial-a", generation: 7 });
  const fence = await client.createSession(capabilities());
  return { client, fence };
}

describe("AppiumW3cClient", () => {
  it("creates a serial-bound UiAutomator2 session with explicit ports and timings", async () => {
    let requestBody = "";
    const baseUrl = await createFakeServer(async (_request, init) => {
      requestBody = String(init?.body ?? "");
      return Response.json({
        sessionId: "session-a",
        value: { sessionId: "session-a", capabilities: capabilities() },
      });
    });
    const client = new AppiumW3cClient({ baseUrl, serial: "serial-a", generation: 7 });

    const fence = await client.createSession(capabilities());

    expect(fence).toEqual({ sessionId: "session-a", serial: "serial-a", generation: 7 });
    expect(JSON.parse(requestBody)).toEqual({
      capabilities: { alwaysMatch: capabilities(), firstMatch: [{}] },
    });
    expect(client.getLastTiming()?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("supports only the narrow product endpoints and preserves the fence on responses", async () => {
    const requests: string[] = [];
    const baseUrl = await createFakeServer(async (request) => {
      requests.push(request);
      const url = new URL(request);
      if (url.pathname === "/session")
        return Response.json({
          sessionId: "session-a",
          value: { sessionId: "session-a", capabilities: capabilities() },
        });
      if (url.pathname.endsWith("/screenshot")) return Response.json({ value: "base64-png" });
      if (url.pathname.endsWith("/current_package"))
        return Response.json({ value: "com.example.game" });
      if (url.pathname.endsWith("/current_activity"))
        return Response.json({ value: ".MainActivity" });
      return Response.json({ value: {} });
    });
    const { client, fence } = await createClient(baseUrl);
    const actions: W3cAction[] = [
      {
        type: "pointer",
        id: "finger1",
        actions: [{ type: "pointerMove", duration: 0, x: 10, y: 20 }],
      },
    ];

    await client.performActions(fence, actions);
    expect(await client.screenshot(fence)).toBe("base64-png");
    expect(await client.currentPackage(fence)).toBe("com.example.game");
    expect(await client.currentActivity(fence)).toBe(".MainActivity");
    await client.activateApp(fence, "com.example.game");
    await client.terminateApp(fence, "com.example.game");
    await client.pressKey(fence, 4);
    await client.typeText(fence, "hello");
    await client.updateSettings(fence, { ignoreUnimportantViews: true });
    await client.deleteSession(fence);

    expect(requests.some((request) => request.includes("execute"))).toBe(false);
    expect(requests).toContain(`${baseUrl}/session/session-a/appium/device/activate_app`);
    expect(requests).toContain(`${baseUrl}/session/session-a/appium/device/terminate_app`);
    expect(requests).toContain(`${baseUrl}/session/session-a/appium/device/press_keycode`);
    expect(requests).toContain(`${baseUrl}/session/session-a/appium/device/keys`);
    expect(requests).toContain(`${baseUrl}/session/session-a/appium/settings`);
  });

  it("rejects stale generation, serial, and session responses before dispatch", async () => {
    const baseUrl = await createFakeServer(async (request) => {
      if (new URL(request).pathname === "/session")
        return Response.json({
          sessionId: "session-a",
          value: { sessionId: "session-a", capabilities: capabilities() },
        });
      return Response.json({ value: "ok" });
    });
    const { client, fence } = await createClient(baseUrl);

    await expect(client.currentPackage({ ...fence, generation: 8 })).rejects.toMatchObject({
      code: "FENCE_MISMATCH",
    });
    await expect(client.currentPackage({ ...fence, serial: "serial-b" })).rejects.toMatchObject({
      code: "FENCE_MISMATCH",
    });
    await expect(client.currentPackage({ ...fence, sessionId: "session-b" })).rejects.toMatchObject(
      { code: "FENCE_MISMATCH" },
    );
  });

  it("rejects a response carrying a different worker generation", async () => {
    const baseUrl = await createFakeServer(async (request) => {
      if (new URL(request).pathname === "/session")
        return Response.json({
          sessionId: "session-a",
          value: { sessionId: "session-a", capabilities: capabilities() },
        });
      return new Response(JSON.stringify({ value: "com.example.game" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-test-center-session-id": "session-a",
          "x-test-center-serial": "serial-a",
          "x-test-center-generation": "8",
        },
      });
    });
    const { client, fence } = await createClient(baseUrl);

    await expect(client.currentPackage(fence)).rejects.toMatchObject({ code: "FENCE_MISMATCH" });
  });

  it("maps Appium errors and rejects oversized responses", async () => {
    const errorBaseUrl = await createFakeServer(async (request) => {
      if (new URL(request).pathname === "/session")
        return Response.json({
          sessionId: "session-a",
          value: { sessionId: "session-a", capabilities: capabilities() },
        });
      return new Response(
        JSON.stringify({ value: { error: "invalid session id", message: "gone" } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    });
    const errorClient = new AppiumW3cClient({
      baseUrl: errorBaseUrl,
      serial: "serial-a",
      generation: 7,
    });
    const fence = await errorClient.createSession(capabilities());
    await expect(errorClient.currentPackage(fence)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      httpStatus: 404,
    });

    const hugeBaseUrl = await createFakeServer(async (request) => {
      if (new URL(request).pathname === "/session")
        return Response.json({
          sessionId: "session-a",
          value: { sessionId: "session-a", capabilities: capabilities() },
        });
      return new Response(JSON.stringify({ value: "x".repeat(1_000) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const hugeClient = new AppiumW3cClient({
      baseUrl: hugeBaseUrl,
      serial: "serial-a",
      generation: 7,
      maxResponseBytes: 512,
    });
    const hugeFence = await hugeClient.createSession(capabilities());
    await expect(hugeClient.currentPackage(hugeFence)).rejects.toBeInstanceOf(AppiumW3cClientError);
    await expect(hugeClient.currentPackage(hugeFence)).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });
});
