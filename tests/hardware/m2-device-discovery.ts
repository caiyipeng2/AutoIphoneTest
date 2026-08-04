import Database from "better-sqlite3";

import { AdbClient } from "@test-center/adb";
import { parseDeviceSerial } from "@test-center/contracts/device";
import {
  configureDatabase,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database";
import { createAdbDiscoverySource, DeviceRegistry, DeviceRepository } from "@test-center/devices";

const serialText = process.env.TEST_CENTER_DEVICE_SERIAL;
if (serialText === undefined)
  throw new Error("TEST_CENTER_DEVICE_SERIAL is required for hardware acceptance.");
const serial = parseDeviceSerial(serialText);
const adbPath =
  process.env.TEST_CENTER_ADB_PATH ??
  "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
const projectRoot = process.cwd();
const client = new AdbClient({ adbPath, cwd: projectRoot });
const source = createAdbDiscoverySource(client);
const observations = await source.discover();
const observation = observations.find((item) => item.serial === serial);
if (observation === undefined) throw new Error(`Expected ${serial} in ADB discovery output.`);
if (observation.state !== "ONLINE")
  throw new Error(`Expected ${serial} to be ONLINE, got ${observation.state}.`);

const database = new Database(":memory:");
configureDatabase(database);
migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION]);
const registry = new DeviceRegistry(new DeviceRepository(database), {
  discover: async () => observations,
});
const mutations = await registry.poll();
const device = registry.get(serial);
if (device === undefined || device.state !== "ONLINE")
  throw new Error(`Registry did not persist ${serial} as ONLINE.`);
if (typeof device.metadata.model !== "string")
  throw new Error("Device metadata did not include model.");

process.stdout.write(
  `${JSON.stringify({
    serial,
    state: device.state,
    model: device.metadata.model,
    androidRelease: device.metadata.androidRelease,
    apiLevel: device.metadata.apiLevel,
    batteryPercentage: device.metadata.batteryPercentage,
    orientation: device.metadata.orientation,
    mutations: mutations.length,
    connectionSeq: device.connectionSeq,
  })}\n`,
);
database.close();
