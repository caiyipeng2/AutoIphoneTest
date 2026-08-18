import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { CLEANUP_CONFIRMATIONS_MIGRATION, configureDatabase, migrate } from "@test-center/database";

import { CleanupConfirmationService } from "./cleanup-confirmation.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createService(now = 1_000, ttlMs = 60_000): CleanupConfirmationService {
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [CLEANUP_CONFIRMATIONS_MIGRATION]);
  databases.push(database);
  return new CleanupConfirmationService(database, { now: () => now, ttlMs });
}

describe("cleanup confirmation", () => {
  it("binds a one-time nonce to sorted run IDs and expected bytes", () => {
    const service = createService();
    const target = { runIds: ["run-b", "run-a"], expectedBytes: 300 };

    const issued = service.issue(target);
    expect(issued.nonce).not.toContain("run-a");
    expect(() =>
      service.consume({ ...target, runIds: ["run-a", "run-b"], nonce: issued.nonce }),
    ).not.toThrow();
    expect(() => service.consume({ ...target, nonce: issued.nonce })).toThrow(/reused/i);
  });

  it("rejects changed run sets, byte estimates, and duplicate IDs", () => {
    const service = createService();
    const target = { runIds: ["run-a", "run-b"], expectedBytes: 300 };
    const issued = service.issue(target);

    expect(() => service.consume({ ...target, expectedBytes: 301, nonce: issued.nonce })).toThrow(
      /target/i,
    );
    expect(() =>
      service.consume({ ...target, runIds: ["run-a", "run-c"], nonce: issued.nonce }),
    ).toThrow(/target/i);
    expect(() => service.issue({ runIds: ["run-a", "run-a"], expectedBytes: 1 })).toThrow(
      /duplicate/i,
    );
  });

  it("rejects expired confirmations", () => {
    const service = createService(2_000, 1_000);
    const issued = service.issue({ runIds: ["run-a"], expectedBytes: 1 }, 1_000);

    expect(() =>
      service.consume({ runIds: ["run-a"], expectedBytes: 1, nonce: issued.nonce }),
    ).toThrow(/expired/i);
  });
});
