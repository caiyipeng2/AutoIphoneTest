import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  DEVICES_MIGRATION,
  EVIDENCE_REPORTS_MIGRATION,
  FOUNDATION_MIGRATION,
  INCIDENTS_MIGRATION,
  migrate,
  RUN_ACTIONS_MIGRATION,
  RUN_FAILURE_POLICY_MIGRATION,
  RUN_MEMBERSHIP_MIGRATION,
  SESSION_API_MIGRATION,
} from "@test-center/database/migrations";
import { EvidenceRepository } from "./evidence-repository.js";

const databases: Database.Database[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function openDatabase(runId = "run-1"): Database.Database {
  const database = new Database(":memory:");
  databases.push(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    SESSION_API_MIGRATION,
    ACTION_COMMANDS_MIGRATION,
    INCIDENTS_MIGRATION,
    RUN_MEMBERSHIP_MIGRATION,
    RUN_FAILURE_POLICY_MIGRATION,
    EVIDENCE_REPORTS_MIGRATION,
  ]);
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, 'com.example.game', 'FINISHED', 1, 'nonce', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
    )
    .run(runId);
  return database;
}

describe("evidence repository", () => {
  it("creates pending evidence and marks it ready with immutable publication metadata", () => {
    const database = openDatabase();
    const repository = new EvidenceRepository(database, { now: () => "2026-08-14T01:00:00.000Z" });

    const pending = repository.create({
      id: "ev-1",
      runId: "run-1",
      kind: "CURRENT_SCREENSHOT",
      tempRelativePath: "device-1/capture.partial-1",
      attempt: 1,
    });
    expect(pending).toMatchObject({
      id: "ev-1",
      state: "PENDING",
      attempt: 1,
      tempRelativePath: "device-1/capture.partial-1",
    });

    const ready = repository.markReady("ev-1", {
      finalRelativePath: "device-1/capture.png",
      sha256: "a".repeat(64),
      sizeBytes: 128,
      capturedAt: "2026-08-14T00:59:59.000Z",
    });
    expect(ready).toMatchObject({
      state: "READY",
      finalRelativePath: "device-1/capture.png",
      sha256: "a".repeat(64),
      sizeBytes: 128,
      capturedAt: "2026-08-14T00:59:59.000Z",
    });
    expect(repository.get("ev-1")).toEqual(ready);
  });

  it("rejects invalid publication metadata and never overwrites a terminal state", () => {
    const database = openDatabase();
    const repository = new EvidenceRepository(database);
    repository.create({ id: "ev-2", runId: "run-1", kind: "TIMING", attempt: 1 });

    expect(() =>
      repository.markReady("ev-2", {
        finalRelativePath: "timing.json",
        sha256: "not-a-hash",
        sizeBytes: 1,
      }),
    ).toThrow(/sha256/);
    expect(() =>
      repository.markReady("ev-2", {
        finalRelativePath: "timing.json",
        sha256: "b".repeat(64),
        sizeBytes: -1,
      }),
    ).toThrow(/sizeBytes/);

    const failed = repository.markFailed("ev-2", { category: "CAPTURE_ERROR" });
    expect(failed.state).toBe("FAILED");
    expect(() =>
      repository.markReady("ev-2", {
        finalRelativePath: "timing.json",
        sha256: "b".repeat(64),
        sizeBytes: 1,
      }),
    ).toThrow(/terminal|FAILED/);
  });

  it("records an explicit missing reason and rejects a second terminal transition", () => {
    const database = openDatabase();
    const repository = new EvidenceRepository(database);
    repository.create({ id: "ev-3", runId: "run-1", kind: "CURRENT_SCREENSHOT", attempt: 1 });

    const missing = repository.markMissing("ev-3", { reason: "DEVICE_DISCONNECTED" });
    expect(missing).toMatchObject({ state: "MISSING", unavailableReason: "DEVICE_DISCONNECTED" });
    expect(() => repository.markFailed("ev-3", { category: "DEVICE_DISCONNECTED" })).toThrow(
      /terminal|MISSING/,
    );
  });

  it("reconciles orphaned pending rows as failed and never promotes final or partial files", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-evidence-repository-"));
    roots.push(root);
    await writeFile(join(root, "existing.png"), "already published", "utf8");
    await writeFile(join(root, "missing.partial-1"), "partial", "utf8");
    const repository = new EvidenceRepository(database, { runRoot: root });
    repository.create({
      id: "ev-4",
      runId: "run-1",
      kind: "CURRENT_SCREENSHOT",
      tempRelativePath: "capture.partial-1",
      finalRelativePath: "existing.png",
      attempt: 1,
    });
    repository.create({
      id: "ev-5",
      runId: "run-1",
      kind: "TIMING",
      tempRelativePath: "missing.partial-1",
      attempt: 1,
    });

    const reconciled = await repository.reconcilePending("run-1");
    expect(reconciled).toHaveLength(2);
    expect(reconciled.every((record) => record.state === "FAILED")).toBe(true);
    expect(reconciled.map((record) => record.id)).toEqual(["ev-4", "ev-5"]);
    expect(repository.get("ev-4")).toMatchObject({
      state: "FAILED",
      captureErrorCategory: "ORPHANED_PENDING",
    });
    expect(repository.get("ev-5")).toMatchObject({
      state: "FAILED",
      captureErrorCategory: "ORPHANED_PARTIAL",
    });
  });
});
