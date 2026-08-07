import { describe, expect, it } from "vitest";

import type { BridgeMessage } from "@test-center/contracts/bridge";
import { parseDeviceSerial } from "@test-center/contracts/device";

import { BridgeStateIngestor, type BridgeMessageSource } from "./bridge-state-ingestor.js";
import { UidService } from "./uid-service.js";
import Database from "better-sqlite3";
import {
  configureDatabase,
  DEVICES_MIGRATION,
  DEPLOYMENTS_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
  UID_BRIDGE_MIGRATION,
} from "@test-center/database/migrations";

const serial = parseDeviceSerial("R5CX211TXNT");
const packageName = "com.hg.idleweaponshoptycoon.android";

class FakeBridgeSource implements BridgeMessageSource {
  private messageListener: ((message: BridgeMessage) => void) | undefined;
  private statusListener:
    ((status: "disconnected" | "connecting" | "ready" | "closed" | "error") => void) | undefined;

  public getSnapshot() {
    return { status: "disconnected" as const };
  }

  public onMessage(listener: (message: BridgeMessage) => void): () => void {
    this.messageListener = listener;
    return () => {
      if (this.messageListener === listener) this.messageListener = undefined;
    };
  }

  public onStatusChange(
    listener: (status: "disconnected" | "connecting" | "ready" | "closed" | "error") => void,
  ): () => void {
    this.statusListener = listener;
    return () => {
      if (this.statusListener === listener) this.statusListener = undefined;
    };
  }

  public emit(message: BridgeMessage): void {
    this.messageListener?.(message);
  }

  public emitStatus(status: "disconnected" | "connecting" | "ready" | "closed" | "error") {
    this.statusListener?.(status);
  }
}

function hello(): BridgeMessage {
  return {
    type: "QA_HELLO",
    schemaVersion: 1,
    bridgeInstanceId: "bridge-a",
    bootId: "boot-1",
    buildId: "qa-1",
  };
}

function state(stateSeq: number, uid = "UID-1001"): BridgeMessage {
  return {
    type: "QA_STATE",
    schemaVersion: 1,
    bridgeInstanceId: "bridge-a",
    uid,
    installGeneration: 1,
    appDataGeneration: 1,
    buildId: "qa-1",
    width: 1080,
    height: 2400,
    safeArea: [0, 80, 1080, 2260],
    orientation: "Portrait",
    metricsEpoch: 1,
    view: "MainHUD",
    focusedControlId: null,
    textInputAvailable: false,
    stateSeq,
  };
}

function createService(): { database: Database.Database; service: UidService } {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    DEPLOYMENTS_MIGRATION,
    UID_BRIDGE_MIGRATION,
  ]);
  return { database, service: new UidService(database) };
}

describe("BridgeStateIngestor", () => {
  it("projects fenced QA_HELLO/QA_STATE into the current UID service and marks disconnect", () => {
    const { database, service } = createService();
    const source = new FakeBridgeSource();
    const errors: Error[] = [];
    const ingestor = new BridgeStateIngestor({
      serial,
      packageName,
      source,
      uidService: service,
      onError: (error) => errors.push(error),
      now: () => "2026-08-07T12:00:00.000Z",
    });
    ingestor.start();

    source.emit(hello());
    source.emit(state(1));
    expect(service.get(serial, packageName)).toMatchObject({
      uid: { uid: "UID-1001", actor: "bridge:bridge-a" },
      bridge: { status: "READY", stateSeq: 1 },
    });

    source.emitStatus("closed");
    expect(service.get(serial, packageName).bridge).toMatchObject({ status: "UNAVAILABLE" });
    expect(errors).toHaveLength(0);
    ingestor.stop();
    database.close();
  });

  it("rejects state from a bridge instance that has not been introduced", () => {
    const { database, service } = createService();
    const source = new FakeBridgeSource();
    const errors: Error[] = [];
    const ingestor = new BridgeStateIngestor({
      serial,
      packageName,
      source,
      uidService: service,
      onError: (error) => errors.push(error),
    });
    service.ensure(serial, packageName);
    ingestor.start();

    source.emit({ ...state(1), bridgeInstanceId: "bridge-unknown" });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/hello|instance/i);
    expect(service.get(serial, packageName).bridge.status).toBe("UNAVAILABLE");
    ingestor.stop();
    database.close();
  });
});
