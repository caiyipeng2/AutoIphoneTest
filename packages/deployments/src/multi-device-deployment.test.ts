import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import {
  ARTIFACTS_MIGRATION,
  DEPLOYMENT_CONTROLS_MIGRATION,
  DEPLOYMENTS_MIGRATION,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database";

import {
  DeploymentOrchestrator,
  type DeploymentActions,
  type DeploymentArtifact,
} from "./deployment-orchestrator.js";

const artifact: DeploymentArtifact = {
  id: "artifact-1",
  kind: "APK",
  packageName: "com.example.game",
  versionName: "1.0.0",
  versionCode: 7,
  signerSha256: "a".repeat(64),
  storedPath: "E:\\Artifacts\\game.apk",
  launchActivity: "com.example.game.MainActivity",
};
const serials = ["R5CX211TXNT", "R5CWB17PN0Y", "emulator-5554", "ZX1G22A1"];
const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createHarness(actions = happyActions()) {
  const database = new Database(":memory:");
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    ARTIFACTS_MIGRATION,
    DEPLOYMENTS_MIGRATION,
    DEPLOYMENT_CONTROLS_MIGRATION,
  ]);
  for (const serial of serials) {
    database
      .prepare(
        "INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, 'ONLINE', ?, ?, ?, ?)",
      )
      .run(serial, "2026-01-01", "2026-01-01", "2026-01-01", "2026-01-01");
  }
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

function happyActions(log: string[] = []): DeploymentActions {
  return {
    installApk: async ({ serial }) => {
      log.push(`install:${serial}`);
    },
    installAab: async ({ serial }) => {
      log.push(`install:${serial}`);
    },
    clearData: async ({ serial }) => {
      log.push(`clear:${serial}`);
    },
    uninstallReinstall: async ({ serial }) => {
      log.push(`uninstall:${serial}`);
    },
    collectIdentity: async () => ({
      packageName: artifact.packageName,
      versionName: artifact.versionName,
      versionCode: artifact.versionCode,
      signerSha256: artifact.signerSha256,
      launchActivity: artifact.launchActivity!,
    }),
    startActivity: async ({ serial }) => {
      log.push(`launch:${serial}`);
    },
    foregroundActivity: async () => "com.example.game/.MainActivity",
    packagePid: async () => 1234,
  };
}

describe("multi-device deployment capacity", () => {
  it("creates every capacity from one through four and keeps legacy single-device input", async () => {
    const orchestrator = createHarness();

    for (let count = 1; count <= 4; count += 1) {
      const selected = serials.slice(0, count).map(parseDeviceSerial);
      const created = await orchestrator.create({
        clientRequestId: `capacity-${count}`,
        artifactId: artifact.id,
        deviceSerials: selected,
      });
      expect(created.deviceSerials).toEqual(selected);
      expect(created.devices.map((device) => device.serial)).toEqual(selected);
      expect(created.devices[0]?.role).toBe("LEADER");
      expect(created.devices.slice(1).every((device) => device.role === "FOLLOWER")).toBe(true);
      expect((await orchestrator.run(created.id)).state).toBe("COMPLETED");
    }

    const legacy = await orchestrator.create({
      clientRequestId: "legacy-single",
      artifactId: artifact.id,
      deviceSerial: parseDeviceSerial("R5CX211TXNT"),
    });
    expect(legacy.deviceSerial).toBe(parseDeviceSerial("R5CX211TXNT"));
    expect(legacy.deviceSerials).toEqual([parseDeviceSerial("R5CX211TXNT")]);
  });

  it("rejects duplicate and five-device selections before inserting a deployment", async () => {
    const orchestrator = createHarness();
    await expect(
      orchestrator.create({
        clientRequestId: "duplicate",
        artifactId: artifact.id,
        deviceSerials: [parseDeviceSerial(serials[0]!), parseDeviceSerial(serials[0]!)],
      }),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      orchestrator.create({
        clientRequestId: "too-many",
        artifactId: artifact.id,
        deviceSerials: [...serials, "another-device"].map(parseDeviceSerial),
      }),
    ).rejects.toThrow(/four|4/i);
    expect(orchestrator.list()).toHaveLength(0);
  });

  it("isolates one target failure and retries only that target", async () => {
    const log: string[] = [];
    let mismatchSerial = parseDeviceSerial("R5CWB17PN0Y");
    const actions = happyActions(log);
    actions.collectIdentity = async ({ serial }) => ({
      packageName: artifact.packageName,
      versionName: artifact.versionName,
      versionCode: artifact.versionCode,
      signerSha256: serial === mismatchSerial ? "b".repeat(64) : artifact.signerSha256,
      launchActivity: artifact.launchActivity!,
    });
    const orchestrator = createHarness(actions);
    const created = await orchestrator.create({
      clientRequestId: "isolated-failure",
      artifactId: artifact.id,
      deviceSerials: serials.slice(0, 2).map(parseDeviceSerial),
    });

    const failed = await orchestrator.run(created.id);
    expect(failed.devices).toMatchObject([
      { serial: serials[0], state: "COMPLETED" },
      { serial: serials[1], state: "FAILED", failedStep: "VERIFY" },
    ]);
    expect(failed.state).toBe("FAILED");
    expect(log).toContain(`launch:${serials[0]}`);
    expect(log).not.toContain(`launch:${serials[1]}`);

    mismatchSerial = parseDeviceSerial("unused");
    const retried = await orchestrator.retry(created.id);
    expect(retried.devices).toMatchObject([
      { serial: serials[0], state: "COMPLETED" },
      { serial: serials[1], state: "COMPLETED" },
    ]);
  });
});
