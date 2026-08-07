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

import { InstallationRepository } from "./installation-repository.js";
import { UidService, type UidServiceEvent } from "./uid-service.js";

const serial = parseDeviceSerial("R5CX211TXNT");
const packageName = "com.hg.idleweaponshoptycoon.android";
const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createService(): { service: UidService; installations: InstallationRepository } {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    DEPLOYMENTS_MIGRATION,
    UID_BRIDGE_MIGRATION,
  ]);
  databases.push(database);
  const installations = new InstallationRepository(database);
  return {
    service: new UidService(database, installations, { now: () => "2026-08-07T12:00:00.000Z" }),
    installations,
  };
}

function state(overrides: Partial<Parameters<UidService["observeBridgeState"]>[0]> = {}) {
  return {
    serial,
    packageName,
    bridgeInstanceId: "bridge-a",
    bootId: "boot-1",
    buildId: "qa-1",
    uid: "UID-1001",
    installGeneration: 1,
    appDataGeneration: 1,
    stateSeq: 1,
    ...overrides,
  };
}

describe("UidService", () => {
  it("binds automatic UID to the current installation generation and bridge identity", () => {
    const { service } = createService();
    const first = service.observeBridgeState(state());

    expect(first).toMatchObject({
      installation: { installGeneration: 1, appDataGeneration: 1, currentUid: "UID-1001" },
      uid: {
        uid: "UID-1001",
        source: "BRIDGE_AUTO",
        actor: "bridge:bridge-a",
        buildId: "qa-1",
      },
      bridge: { status: "READY", bridgeInstanceId: "bridge-a", stateSeq: 1 },
    });
    expect(() => service.observeBridgeState(state())).toThrow(/stale bridge state/i);
  });

  it("degrades stale generation state and accepts fresh UID after destructive mutation", () => {
    const { service, installations } = createService();
    service.observeBridgeState(state());
    const mutation = installations.recordDataMutation({ serial, packageName, kind: "CLEAR_DATA" });
    const stale = service.observeBridgeState(
      state({ appDataGeneration: 1, stateSeq: 2, uid: "UID-stale" }),
    );
    expect(stale.bridge).toMatchObject({ status: "DEGRADED" });
    expect(stale.installation.currentUid).toBeNull();

    installations.recordMutationResult(serial, packageName, mutation.lastMutationId!, "SUCCEEDED");
    const fresh = service.observeBridgeState(
      state({ appDataGeneration: 2, stateSeq: 3, uid: "UID-fresh" }),
    );
    expect(fresh).toMatchObject({
      installation: { appDataGeneration: 2, currentUid: "UID-fresh" },
      uid: { source: "BRIDGE_AUTO", uid: "UID-fresh" },
      bridge: { status: "READY" },
    });
  });

  it("requires a session-bound one-time confirmation for manual UID correction", () => {
    const { service } = createService();
    const confirmation = service.issueManualUidConfirmation({
      sessionId: "session-a",
      serial,
      packageName,
    });
    const corrected = service.setManualUid({
      sessionId: "session-a",
      serial,
      packageName,
      uid: "UID-manual",
      confirmationNonce: confirmation.nonce,
    });
    expect(corrected.uid).toMatchObject({
      uid: "UID-manual",
      source: "MANUAL",
      actor: "session:session-a",
    });
    expect(() =>
      service.setManualUid({
        sessionId: "session-a",
        serial,
        packageName,
        uid: "UID-replay",
        confirmationNonce: confirmation.nonce,
      }),
    ).toThrow(/confirmation/i);
    expect(() =>
      service.setManualUid({
        sessionId: "session-b",
        serial,
        packageName,
        uid: "UID-other",
        confirmationNonce: service.issueManualUidConfirmation({
          sessionId: "session-a",
          serial,
          packageName,
        }).nonce,
      }),
    ).toThrow(/confirmation/i);
  });

  it("reports unavailable bridge health without deleting the current UID", () => {
    const { service } = createService();
    service.observeBridgeState(state());
    service.markBridgeUnavailable(serial, packageName);
    expect(service.get(serial, packageName)).toMatchObject({
      uid: { uid: "UID-1001" },
      bridge: { status: "UNAVAILABLE" },
    });
  });

  it("publishes current-generation UID and bridge events", () => {
    const { service } = createService();
    const events: UidServiceEvent[] = [];
    service.subscribe((event) => events.push(event));

    service.observeBridgeState(state());
    service.markBridgeUnavailable(serial, packageName, "test disconnect");

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "bridge.updated",
      serial,
      packageName,
      snapshot: { uid: { uid: "UID-1001" }, bridge: { status: "READY" } },
    });
    expect(events[1]).toMatchObject({
      type: "bridge.updated",
      snapshot: { bridge: { status: "UNAVAILABLE", reason: "test disconnect" } },
    });
  });
});
