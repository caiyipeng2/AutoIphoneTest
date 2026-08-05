import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureDatabase,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database/migrations";
import { parseDeviceSerial } from "@test-center/contracts/device";
import { DeviceRepository, type DeviceObservation } from "./device-repository.js";

const openDatabases: Database.Database[] = [];
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

function createRepository(): DeviceRepository {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION]);
  openDatabases.push(database);
  return new DeviceRepository(database);
}

function observation(
  state: DeviceObservation["state"],
  metadata?: DeviceObservation["metadata"],
): DeviceObservation {
  return {
    serial: parseDeviceSerial("R5CX211TXNT"),
    state,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

describe("device repository lifecycle", () => {
  it("keeps one identity row, increments connectionSeq only on state changes, and records history", () => {
    const repository = createRepository();
    const first = repository.upsert(
      observation("ONLINE", { model: "SM-S9280" }),
      "2026-08-04T10:00:00.000Z",
    );
    const unchanged = repository.upsert(observation("ONLINE"), "2026-08-04T10:00:02.000Z");
    const offline = repository.upsert(observation("OFFLINE"), "2026-08-04T10:00:04.000Z");
    const reconnected = repository.upsert(
      observation("ONLINE", { androidRelease: "16" }),
      "2026-08-04T10:00:06.000Z",
    );

    expect(first.connectionChanged).toBe(true);
    expect(unchanged.connectionChanged).toBe(false);
    expect(unchanged.changed).toBe(false);
    expect(offline.record.connectionSeq).toBe(2);
    expect(reconnected.record.connectionSeq).toBe(3);
    expect(reconnected.record.metadata).toMatchObject({ model: "SM-S9280", androidRelease: "16" });
    expect(repository.list().map((device) => device.serial)).toEqual(["R5CX211TXNT"]);
    expect(repository.history(parseDeviceSerial("R5CX211TXNT"))).toHaveLength(3);
  });

  it("marks missing online identities offline without erasing known metadata", () => {
    const repository = createRepository();
    repository.upsert(observation("ONLINE", { model: "Known" }), "2026-08-04T10:00:00.000Z");
    const changed = repository.markMissing(new Set(), "2026-08-04T10:00:02.000Z");
    expect(changed).toHaveLength(1);
    expect(repository.get(parseDeviceSerial("R5CX211TXNT"))).toMatchObject({
      state: "OFFLINE",
      metadata: { model: "Known" },
      connectionSeq: 2,
    });
  });
});
