import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureDatabase,
  DEPLOYMENTS_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database/migrations";
import { parseDeviceSerial } from "@test-center/contracts/device";

import { InstallationRepository } from "./installation-repository.js";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createRepository(): InstallationRepository {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION, DEPLOYMENTS_MIGRATION]);
  databases.push(database);
  return new InstallationRepository(database);
}

const serial = parseDeviceSerial("R5CX211TXNT");
const packageName = "com.hg.idleweaponshoptycoon.android";

describe("installation generations", () => {
  it("creates append-only deployment and generation tables", () => {
    const repository = createRepository();
    expect(repository).toBeInstanceOf(InstallationRepository);
    const database = databases[0]!;
    const names = database
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('deployments', 'deployment_devices', 'deployment_steps', 'device_app_installations', 'device_uids') ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(names).toEqual([
      "deployment_devices",
      "deployment_steps",
      "deployments",
      "device_app_installations",
      "device_uids",
    ]);
  });

  it("starts at generation one and stores the device UID", () => {
    const repository = createRepository();
    repository.ensure(serial, packageName);
    repository.setCurrentUid(serial, packageName, "UID-1001");

    expect(repository.get(serial, packageName)).toMatchObject({
      installGeneration: 1,
      appDataGeneration: 1,
      currentUid: "UID-1001",
    });
  });

  it("clears data by atomically advancing appDataGeneration and invalidating UID", () => {
    const repository = createRepository();
    repository.ensure(serial, packageName);
    repository.setCurrentUid(serial, packageName, "UID-1001");

    const before = repository.get(serial, packageName);
    const after = repository.recordDataMutation({ serial, packageName, kind: "CLEAR_DATA" });

    expect(after.appDataGeneration).toBe(before.appDataGeneration + 1);
    expect(after.installGeneration).toBe(before.installGeneration);
    expect(after.currentUid).toBeNull();
    expect(after.lastMutationId).toEqual(expect.any(String));
  });

  it("advances both generations for uninstall/reinstall and invalidates UID", () => {
    const repository = createRepository();
    repository.ensure(serial, packageName);
    repository.setCurrentUid(serial, packageName, "UID-1001");

    const after = repository.recordDataMutation({
      serial,
      packageName,
      kind: "UNINSTALL_REINSTALL",
    });

    expect(after.installGeneration).toBe(2);
    expect(after.appDataGeneration).toBe(2);
    expect(after.currentUid).toBeNull();
  });

  it("does not reuse an invalidated UID after a failed mutation", () => {
    const repository = createRepository();
    repository.ensure(serial, packageName);
    repository.setCurrentUid(serial, packageName, "UID-1001");

    const mutation = repository.recordDataMutation({ serial, packageName, kind: "CLEAR_DATA" });
    repository.recordMutationResult(
      serial,
      packageName,
      mutation.lastMutationId!,
      "FAILED",
      "adb exit 1",
    );

    expect(repository.get(serial, packageName)).toMatchObject({
      currentUid: null,
      lastMutationStatus: "FAILED",
      lastMutationError: "adb exit 1",
    });
    expect(() => repository.setCurrentUid(serial, packageName, "UID-stale")).toThrow(
      /fresh installation/i,
    );
  });

  it("rejects stale mutation results and requires a matching fresh observation", () => {
    const repository = createRepository();
    repository.ensure(serial, packageName);
    const first = repository.recordDataMutation({ serial, packageName, kind: "CLEAR_DATA" });
    const second = repository.recordDataMutation({ serial, packageName, kind: "CLEAR_DATA" });

    expect(() =>
      repository.recordMutationResult(serial, packageName, first.lastMutationId!, "FAILED"),
    ).toThrow(/stale/i);
    repository.recordMutationResult(serial, packageName, second.lastMutationId!, "SUCCEEDED");
    const observed = repository.recordInstallationObservation(
      serial,
      packageName,
      second.lastMutationId!,
      "UID-fresh",
    );
    expect(observed.currentUid).toBe("UID-fresh");
    expect(observed.lastMutationStatus).toBeNull();
  });
});
