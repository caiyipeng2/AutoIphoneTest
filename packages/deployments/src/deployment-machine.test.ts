import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import {
  ARTIFACTS_MIGRATION,
  configureDatabase,
  DEPLOYMENTS_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database/migrations";

import { DeploymentMachine, type DeploymentStepKind } from "./deployment-machine.js";
import { DeploymentRepository } from "./deployment-repository.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("deployment state machine", () => {
  it("walks one device through the ordered deployment steps", () => {
    const machine = new DeploymentMachine();

    expect(machine.snapshot.state).toBe("QUEUED");
    for (const expected of ["PRECHECK", "PREPARE", "INSTALL", "VERIFY", "LAUNCH"] as const) {
      machine.dispatch({ type: "START_OR_ADVANCE" });
      expect(machine.snapshot.state).toBe(expected);
    }
    machine.dispatch({ type: "START_OR_ADVANCE" });
    expect(machine.snapshot.state).toBe("COMPLETED");
  });

  it("cancels before a destructive step and does not allow terminal transitions", () => {
    const machine = new DeploymentMachine();
    machine.dispatch({ type: "START_OR_ADVANCE" });
    machine.dispatch({ type: "CANCEL" });

    expect(machine.snapshot.state).toBe("CANCELLED");
    expect(() => machine.dispatch({ type: "START_OR_ADVANCE" })).toThrow(/terminal/i);
    expect(() => machine.dispatch({ type: "RETRY" })).toThrow(/terminal/i);
  });

  it("does not cancel while install or launch execution may still be in flight", () => {
    const machine = new DeploymentMachine();
    machine.dispatch({ type: "START_OR_ADVANCE" });
    machine.dispatch({ type: "START_OR_ADVANCE" });
    machine.dispatch({ type: "START_OR_ADVANCE" });
    expect(machine.snapshot.state).toBe("INSTALL");
    expect(() => machine.dispatch({ type: "CANCEL" })).toThrow(/executing/i);
  });

  it("retries from the failed step and keeps the failed attempt visible", () => {
    const machine = new DeploymentMachine();
    machine.dispatch({ type: "START_OR_ADVANCE" });
    machine.dispatch({ type: "START_OR_ADVANCE" });
    machine.dispatch({ type: "START_OR_ADVANCE" });
    machine.dispatch({ type: "FAIL", step: "INSTALL", message: "adb exit 1" });

    expect(machine.snapshot).toMatchObject({
      state: "FAILED",
      failedStep: "INSTALL",
      failureMessage: "adb exit 1",
    });
    machine.dispatch({ type: "RETRY" });
    expect(machine.snapshot).toMatchObject({ state: "INSTALL", attempt: 2 });
    expect(machine.snapshot.attempts).toEqual([
      expect.objectContaining({ step: "INSTALL", outcome: "FAILED" }),
    ]);
  });

  it("rejects retry after successful completion", () => {
    const machine = new DeploymentMachine();
    while (machine.snapshot.state !== "COMPLETED") {
      machine.dispatch({ type: "START_OR_ADVANCE" });
    }
    expect(() => machine.dispatch({ type: "RETRY" })).toThrow(/terminal/i);
  });

  it("accepts only the known step kinds", () => {
    const steps: readonly DeploymentStepKind[] = [
      "PRECHECK",
      "PREPARE",
      "INSTALL",
      "VERIFY",
      "LAUNCH",
    ];
    expect(steps).toHaveLength(5);
  });

  it("persists transitions and step attempts so a restart can read current state", () => {
    const database = new Database(":memory:");
    configureDatabase(database);
    migrate(database, [
      FOUNDATION_MIGRATION,
      DEVICES_MIGRATION,
      ARTIFACTS_MIGRATION,
      DEPLOYMENTS_MIGRATION,
    ]);
    const serial = parseDeviceSerial("R5CX211TXNT");
    database
      .prepare(
        `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at)
         VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
      )
      .run(
        serial,
        "2026-08-06T10:00:00.000Z",
        "2026-08-06T10:00:00.000Z",
        "2026-08-06T10:00:00.000Z",
        "2026-08-06T10:00:00.000Z",
      );
    databases.push(database);
    const repository = new DeploymentRepository(database, "deployment-1", serial);
    repository.create({ packageName: "com.hg.idleweaponshoptycoon.android" });
    const machine = new DeploymentMachine({
      persistence: repository,
      now: () => "2026-08-06T10:00:01.000Z",
    });

    machine.dispatch({ type: "START_OR_ADVANCE" });

    expect(repository.get()).toMatchObject({ state: "PRECHECK", currentStep: "PRECHECK" });
    expect(
      database
        .prepare("SELECT state FROM deployment_steps WHERE deployment_id = ?")
        .get("deployment-1"),
    ).toEqual({ state: "RUNNING" });

    const reloaded = new DeploymentMachine({ initialSnapshot: repository.getSnapshot() });
    expect(reloaded.snapshot).toMatchObject({ state: "PRECHECK", currentStep: "PRECHECK" });
  });
});
