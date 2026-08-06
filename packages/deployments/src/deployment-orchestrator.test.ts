import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import {
  DEPLOYMENT_CONTROLS_MIGRATION,
  DEPLOYMENTS_MIGRATION,
  DEVICES_MIGRATION,
  ARTIFACTS_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database";

import {
  DeploymentOrchestrator,
  type DeploymentArtifact,
  type DeploymentActions,
  type InstallationMutationStore,
} from "./deployment-orchestrator.js";
import type { DestructiveConfirmationService } from "@test-center/security";

const databases: Database.Database[] = [];
const serial = parseDeviceSerial("R5CX211TXNT");
const artifact: DeploymentArtifact = {
  id: "artifact-1",
  kind: "APK",
  packageName: "com.example.game",
  versionName: "1.0.0",
  versionCode: 7,
  signerSha256: "a".repeat(64),
  storedPath: "E:\\Artifacts\\game.apk",
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createHarness(actions: DeploymentActions = happyActions()): DeploymentOrchestrator {
  const database = new Database(":memory:");
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
  database
    .prepare(
      "INSERT INTO artifact_contents (sha256, size_bytes, stored_path, original_name, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run("b".repeat(64), 1, artifact.storedPath, "game.apk", "2026-01-01");
  database
    .prepare(
      "INSERT INTO artifacts (id, kind, sha256, package_name, version_name, version_code, signer_sha256, created_at) VALUES (?, 'APK', ?, ?, ?, ?, ?, ?)",
    )
    .run(
      artifact.id,
      "b".repeat(64),
      artifact.packageName,
      artifact.versionName,
      artifact.versionCode,
      artifact.signerSha256,
      "2026-01-01",
    );
  databases.push(database);
  return new DeploymentOrchestrator(database, {
    artifact: (id) => (id === artifact.id ? artifact : undefined),
    deviceState: () => "ONLINE",
    actions,
    now: () => "2026-01-01T00:00:00.000Z",
  });
}

function createHarnessWithOptions(options: {
  actions?: DeploymentActions;
  confirmations?: DestructiveConfirmationService;
  installation?: InstallationMutationStore;
}): DeploymentOrchestrator {
  const database = new Database(":memory:");
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
  database
    .prepare(
      "INSERT INTO artifact_contents (sha256, size_bytes, stored_path, original_name, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run("b".repeat(64), 1, artifact.storedPath, "game.apk", "2026-01-01");
  database
    .prepare(
      "INSERT INTO artifacts (id, kind, sha256, package_name, version_name, version_code, signer_sha256, created_at) VALUES (?, 'APK', ?, ?, ?, ?, ?, ?)",
    )
    .run(
      artifact.id,
      "b".repeat(64),
      artifact.packageName,
      artifact.versionName,
      artifact.versionCode,
      artifact.signerSha256,
      "2026-01-01",
    );
  databases.push(database);
  return new DeploymentOrchestrator(database, {
    artifact: (id) => (id === artifact.id ? artifact : undefined),
    deviceState: () => "ONLINE",
    actions: options.actions ?? happyActions(),
    ...(options.confirmations === undefined ? {} : { confirmations: options.confirmations }),
    ...(options.installation === undefined ? {} : { installation: options.installation }),
    now: () => "2026-01-01T00:00:00.000Z",
  });
}

function happyActions(log: string[] = []): DeploymentActions {
  return {
    installApk: async () => {
      log.push("install");
    },
    installAab: async () => {
      log.push("install");
    },
    clearData: async () => {
      log.push("clear");
    },
    uninstallReinstall: async () => {
      log.push("uninstall");
    },
    collectIdentity: async () => ({ ...artifact, launchActivity: "com.example.game.MainActivity" }),
    startActivity: async () => {
      log.push("launch");
    },
    foregroundActivity: async () => "com.example.game/.MainActivity",
    packagePid: async () => 1234,
  };
}

describe("single-device deployment orchestrator", () => {
  it("runs APK install, identity verification, and launch through the persisted steps", async () => {
    const log: string[] = [];
    const orchestrator = createHarness(happyActions(log));
    const created = await orchestrator.create({
      clientRequestId: "request-1",
      artifactId: artifact.id,
      deviceSerial: serial,
    });
    const result = await orchestrator.run(created.id);
    expect(result.state).toBe("COMPLETED");
    expect(log).toEqual(["install", "launch"]);
    expect(
      (
        await orchestrator.create({
          clientRequestId: "request-1",
          artifactId: artifact.id,
          deviceSerial: serial,
        })
      ).id,
    ).toBe(created.id);
  });

  it("marks signer mismatch as failed and retries only from the failed step", async () => {
    let collectCount = 0;
    const actions = happyActions();
    actions.collectIdentity = async () => {
      collectCount += 1;
      return {
        ...artifact,
        signerSha256: collectCount === 1 ? "b".repeat(64) : artifact.signerSha256,
        launchActivity: "com.example.game.MainActivity",
      };
    };
    const orchestrator = createHarness(actions);
    const created = await orchestrator.create({
      clientRequestId: "request-2",
      artifactId: artifact.id,
      deviceSerial: serial,
    });
    expect((await orchestrator.run(created.id)).state).toBe("FAILED");
    expect((await orchestrator.retry(created.id)).state).toBe("COMPLETED");
    expect(collectCount).toBe(2);
  });

  it("rejects an offline or duplicate active target and cancels before install", async () => {
    const orchestrator = createHarness();
    const created = await orchestrator.create({
      clientRequestId: "request-3",
      artifactId: artifact.id,
      deviceSerial: serial,
    });
    await expect(
      orchestrator.create({
        clientRequestId: "request-4",
        artifactId: artifact.id,
        deviceSerial: serial,
      }),
    ).rejects.toThrow(/active/i);
    expect((await orchestrator.cancel(created.id)).state).toBe("CANCELLED");
    await expect(
      orchestrator.create({
        clientRequestId: "request-5",
        artifactId: artifact.id,
        deviceSerial: serial,
      }),
    ).resolves.toMatchObject({ state: "QUEUED" });
  });

  it("records a destructive mutation once and marks an interrupted step after restart", async () => {
    const confirmation = { consume: vi.fn() } as unknown as DestructiveConfirmationService;
    const mutationId = "mutation-1";
    const installation: InstallationMutationStore = {
      recordDataMutation: vi.fn(() => ({ lastMutationId: mutationId })),
      recordMutationResult: vi.fn(),
    };
    const orchestrator = createHarnessWithOptions({ confirmations: confirmation, installation });
    const created = await orchestrator.create({
      clientRequestId: "request-mutation",
      artifactId: artifact.id,
      deviceSerial: serial,
      mutation: "CLEAR_DATA",
      confirmationNonce: "nonce-1",
      sessionId: "session-1",
    });
    expect((await orchestrator.run(created.id)).state).toBe("COMPLETED");
    expect(installation.recordDataMutation).toHaveBeenCalledTimes(1);
    expect(installation.recordMutationResult).toHaveBeenCalledWith(
      serial,
      artifact.packageName,
      mutationId,
      "SUCCEEDED",
    );
    expect(confirmation.consume).toHaveBeenCalledTimes(1);

    const interrupted = await orchestrator.create({
      clientRequestId: "request-interrupted",
      artifactId: artifact.id,
      deviceSerial: serial,
    });
    const database = databases[databases.length - 1]!;
    database
      .prepare("UPDATE deployments SET state = 'INSTALL', current_step = 'INSTALL' WHERE id = ?")
      .run(interrupted.id);
    expect(orchestrator.recoverInterrupted()[0]).toMatchObject({
      id: interrupted.id,
      state: "FAILED",
      failedStep: "INSTALL",
    });
  });
});
