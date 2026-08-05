import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureDatabase,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database/migrations";
import { parseDeviceSerial } from "@test-center/contracts/device";

import { DeviceRepository } from "./device-repository.js";
import { DeviceRegistry, type DeviceDiscoverySource } from "./device-registry.js";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createRegistry(source: DeviceDiscoverySource): DeviceRegistry {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION]);
  databases.push(database);
  return new DeviceRegistry(new DeviceRepository(database), source, {
    now: (() => {
      let index = 0;
      return () => `2026-08-04T10:00:0${index++}.000Z`;
    })(),
  });
}

describe("device registry", () => {
  it("emits deterministic events and marks an absent device offline", async () => {
    let round = 0;
    const serial = parseDeviceSerial("R5CX211TXNT");
    const registry = createRegistry({
      discover: async () =>
        round++ === 0 ? [{ serial, state: "ONLINE", metadata: { model: "SM-S9280" } }] : [],
    });
    const events: string[] = [];
    registry.subscribe((event) =>
      events.push(`${event.eventSeq}:${event.type}:${event.device.state}`),
    );

    await registry.poll();
    await registry.poll();

    expect(events).toEqual([
      "1:device.upserted:ONLINE",
      "2:device.connectionChanged:ONLINE",
      "3:device.upserted:OFFLINE",
      "4:device.connectionChanged:OFFLINE",
    ]);
    expect(registry.get(serial)).toMatchObject({ state: "OFFLINE", connectionSeq: 2 });
  });
});
