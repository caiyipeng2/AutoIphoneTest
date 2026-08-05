import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureDatabase,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database/migrations";
import { parseDeviceSerial } from "@test-center/contracts/device";
import { DeviceRepository, DeviceRegistry } from "@test-center/devices";

import { createApp } from "../app.js";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("device routes", () => {
  it("requires a session for reads and persists same-origin tag changes", async () => {
    const database = new Database(":memory:");
    configureDatabase(database);
    migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION]);
    databases.push(database);
    const repository = new DeviceRepository(database);
    const serial = parseDeviceSerial("R5CX211TXNT");
    repository.upsert({ serial, state: "ONLINE", metadata: { model: "SM-S9280" } });
    const registry = new DeviceRegistry(repository, { discover: async () => [] });
    const app = await createApp({
      port: 4781,
      bootstrapCode: "devices-bootstrap",
      launchSecret: "devices-secret",
      deviceRegistry: registry,
    });
    const headers = { host: "127.0.0.1:4781", origin: "http://127.0.0.1:4781" };
    const denied = await app.inject({ method: "GET", url: "/api/devices", headers });
    expect(denied.statusCode).toBe(401);
    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "devices-bootstrap" },
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
    const list = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { ...headers, cookie: cookieHeader },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().devices[0]).toMatchObject({ serial: "R5CX211TXNT", state: "ONLINE" });
    const patched = await app.inject({
      method: "PATCH",
      url: "/api/devices/R5CX211TXNT/tags",
      headers: { ...headers, cookie: cookieHeader, "x-test-center-csrf": csrf },
      payload: { tags: ["Nightly", "Android"], group: "Samsung" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().device).toMatchObject({
      tags: [{ key: "android" }, { key: "nightly" }],
      group: { key: "samsung" },
    });
    await app.close();
  });
});
