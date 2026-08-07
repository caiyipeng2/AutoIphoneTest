import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureDatabase,
  DEPLOYMENTS_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
  UID_BRIDGE_MIGRATION,
} from "@test-center/database/migrations";
import { parseDeviceSerial } from "@test-center/contracts/device";
import { DeviceRegistry, DeviceRepository, UidService } from "@test-center/devices";

import { createApp } from "../app.js";

const serial = parseDeviceSerial("R5CX211TXNT");
const packageName = "com.hg.idleweaponshoptycoon.android";
const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("device bridge routes", () => {
  it("exposes current UID/bridge health and protects manual correction", async () => {
    const database = new Database(":memory:");
    configureDatabase(database);
    migrate(database, [
      FOUNDATION_MIGRATION,
      DEVICES_MIGRATION,
      DEPLOYMENTS_MIGRATION,
      UID_BRIDGE_MIGRATION,
    ]);
    databases.push(database);
    const uidService = new UidService(database);
    uidService.observeBridgeState({
      serial,
      packageName,
      bridgeInstanceId: "bridge-a",
      bootId: "boot-1",
      buildId: "qa-1",
      uid: "UID-1001",
      installGeneration: 1,
      appDataGeneration: 1,
      stateSeq: 1,
    });
    const app = await createApp({
      port: 4782,
      bootstrapCode: "bridge-bootstrap",
      launchSecret: "bridge-secret",
      deviceRegistry: new DeviceRegistry(new DeviceRepository(database), {
        discover: async () => [],
      }),
      uidService,
    });
    const headers = { host: "127.0.0.1:4782", origin: "http://127.0.0.1:4782" };
    const denied = await app.inject({
      method: "GET",
      url: `/api/devices/${serial}/bridge?packageName=${packageName}`,
      headers,
    });
    expect(denied.statusCode).toBe(401);

    const exchange = await app.inject({
      method: "POST",
      url: "/api/bootstrap/exchange",
      headers,
      payload: { code: "bridge-bootstrap" },
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
    const sessionHeaders = { ...headers, cookie: cookieHeader };
    const bridge = await app.inject({
      method: "GET",
      url: `/api/devices/${serial}/bridge?packageName=${packageName}`,
      headers: sessionHeaders,
    });
    expect(bridge.statusCode).toBe(200);
    expect(bridge.json()).toMatchObject({ uid: { uid: "UID-1001" }, bridge: { status: "READY" } });

    const confirmation = await app.inject({
      method: "POST",
      url: `/api/devices/${serial}/uid/confirmations`,
      headers: { ...sessionHeaders, "x-test-center-csrf": csrf },
      payload: { packageName },
    });
    expect(confirmation.statusCode).toBe(200);
    const corrected = await app.inject({
      method: "PATCH",
      url: `/api/devices/${serial}/uid`,
      headers: { ...sessionHeaders, "x-test-center-csrf": csrf },
      payload: { packageName, uid: "UID-manual", confirmationNonce: confirmation.json().nonce },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({ uid: { uid: "UID-manual", source: "MANUAL" } });
    await app.close();
  });
});
