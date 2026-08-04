import { AdbClient } from "@test-center/adb";
import {
  configureDatabase,
  DEVICES_MIGRATION,
  ensureRuntimeDirectories,
  FOUNDATION_MIGRATION,
  migrate,
  openDatabase,
  createRuntimePaths,
} from "@test-center/database";
import { createAdbDiscoverySource, DeviceRegistry, DeviceRepository } from "@test-center/devices";

export interface RuntimeDeviceRegistry {
  readonly registry: DeviceRegistry;
  readonly close: () => void;
}

export async function createRuntimeDeviceRegistry(
  projectRoot: string,
): Promise<RuntimeDeviceRegistry> {
  const paths = createRuntimePaths(projectRoot, process.env.TEST_CENTER_DATA_ROOT);
  await ensureRuntimeDirectories(paths);
  const database = openDatabase(paths);
  configureDatabase(database);
  migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION]);
  const adbPath =
    process.env.TEST_CENTER_ADB_PATH ??
    "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
  const client = new AdbClient({ adbPath, cwd: projectRoot });
  return {
    registry: new DeviceRegistry(new DeviceRepository(database), createAdbDiscoverySource(client)),
    close: () => database.close(),
  };
}
