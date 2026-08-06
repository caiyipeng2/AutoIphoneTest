import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureDatabase,
  ARTIFACTS_MIGRATION,
  DEPLOYMENT_CONTROLS_MIGRATION,
  DEPLOYMENTS_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database";
import { parseDeviceSerial } from "@test-center/contracts/device";

import { DestructiveConfirmationService } from "./destructive-confirmation.js";

const databases: Database.Database[] = [];
const serial = parseDeviceSerial("R5CX211TXNT");

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createService(
  now = 1_000,
  ttlMs = 60_000,
): { service: DestructiveConfirmationService; database: Database.Database } {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    ARTIFACTS_MIGRATION,
    DEPLOYMENTS_MIGRATION,
    DEPLOYMENT_CONTROLS_MIGRATION,
  ]);
  database
    .prepare(
      "INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)",
    )
    .run(serial, "2026-01-01", "2026-01-01", "2026-01-01", "2026-01-01");
  databases.push(database);
  return {
    service: new DestructiveConfirmationService(database, { now: () => now, ttlMs }),
    database,
  };
}

describe("destructive confirmation", () => {
  it("binds a one-time nonce to session, target, operation, and generations", () => {
    const { service } = createService();
    const target = {
      sessionId: "session-1",
      operationKind: "CLEAR_DATA" as const,
      artifactId: "artifact-1",
      deviceSerial: serial,
      packageName: "com.example.game",
      installGeneration: 2,
      appDataGeneration: 3,
    };
    const issued = service.issue(target);
    expect(issued.nonce).not.toContain(target.sessionId);
    expect(() => service.consume({ ...target, nonce: issued.nonce })).not.toThrow();
    expect(() => service.consume({ ...target, nonce: issued.nonce })).toThrow(/reused/i);
  });

  it("rejects expiry and changed targets", () => {
    const { service } = createService(2_000, 1_000);
    const target = {
      sessionId: "session-2",
      operationKind: "UNINSTALL_REINSTALL" as const,
      artifactId: "artifact-2",
      deviceSerial: serial,
      packageName: "com.example.game",
      installGeneration: 1,
      appDataGeneration: 1,
    };
    const issued = service.issue(target);
    expect(() =>
      service.consume({ ...target, packageName: "com.other.game", nonce: issued.nonce }),
    ).toThrow(/target/i);
    const expired = service.issue(target, 1_000);
    expect(() => service.consume({ ...target, nonce: expired.nonce })).toThrow(/expired/i);
  });
});
