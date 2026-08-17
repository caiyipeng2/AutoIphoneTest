import { mkdtemp, rm } from "node:fs/promises";
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
import { ReportExportRepository } from "./report-export-repository.js";

const databases: Database.Database[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function openDatabase(): Database.Database {
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
       VALUES ('run-1', 'Idle Weapon Shop Tycoon', 'FINISHED', 1, 'nonce', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
    )
    .run();
  return database;
}

describe("report export repository", () => {
  it("creates HTML and ZIP attempts idempotently and lists pending exports", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-exports-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });

    const html = repository.create({
      id: "export-html-1",
      runId: "run-1",
      format: "HTML",
      tempRelativePath: "reports/report.html.partial-1",
      attempt: 1,
    });
    expect(
      repository.create({
        id: "export-html-1",
        runId: "run-1",
        format: "HTML",
        tempRelativePath: "reports/report.html.partial-1",
        attempt: 1,
      }),
    ).toEqual(html);
    repository.create({
      id: "export-zip-1",
      runId: "run-1",
      format: "ZIP",
      tempRelativePath: "reports/evidence.zip.partial-1",
      attempt: 1,
    });

    expect(repository.listPending("run-1").map((entry) => entry.format)).toEqual(["HTML", "ZIP"]);
    expect(() =>
      repository.create({
        id: "export-bad",
        runId: "run-1",
        format: "HTML",
        finalRelativePath: "../outside.html",
        attempt: 1,
      }),
    ).toThrow(/relative path/i);
  });

  it("records READY metadata and enforces terminal transitions", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-exports-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });
    repository.create({ id: "export-html-2", runId: "run-1", format: "HTML", attempt: 2 });

    const ready = repository.markReady("export-html-2", {
      finalRelativePath: "reports/report.html",
      sha256: "a".repeat(64),
      sizeBytes: 128,
    });
    expect(ready).toMatchObject({
      state: "READY",
      format: "HTML",
      finalRelativePath: "reports/report.html",
      sha256: "a".repeat(64),
      sizeBytes: 128,
    });
    expect(() => repository.markFailed("export-html-2", { category: "RETRY" })).toThrow(
      /terminal/i,
    );
  });

  it("persists FAILED and MISSING outcomes with explicit categories", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-exports-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });
    repository.create({ id: "export-html-3", runId: "run-1", format: "HTML", attempt: 1 });
    repository.create({ id: "export-zip-3", runId: "run-1", format: "ZIP", attempt: 1 });

    expect(repository.markFailed("export-html-3", { category: "RENDER_FAILED" })).toMatchObject({
      state: "FAILED",
      errorCategory: "RENDER_FAILED",
    });
    expect(repository.markMissing("export-zip-3", { category: "SOURCE_NOT_READY" })).toMatchObject({
      state: "MISSING",
      errorCategory: "SOURCE_NOT_READY",
    });
  });
});
