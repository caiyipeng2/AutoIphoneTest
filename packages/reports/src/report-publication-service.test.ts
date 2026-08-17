import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
import { AtomicEvidencePublisher } from "@test-center/evidence";
import { ReportExportRepository } from "./report-export-repository.js";
import { ReportPublicationService } from "./report-publication-service.js";

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

describe("report publication service", () => {
  it("publishes HTML atomically and records measured READY metadata", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-publication-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });
    const service = new ReportPublicationService(
      repository,
      new AtomicEvidencePublisher({ runRoot: root }),
    );
    repository.create({
      id: "export-html-1",
      runId: "run-1",
      format: "HTML",
      tempRelativePath: "reports/report.html.partial-1",
      attempt: 1,
    });

    const ready = await service.publish("export-html-1", {
      relativePath: "reports/report.html",
      attempt: 1,
      content: ["<!doctype html><title>report</title>"],
    });

    expect(ready).toMatchObject({
      state: "READY",
      format: "HTML",
      finalRelativePath: "reports/report.html",
      sizeBytes: 36,
      sha256: "477eac5d6e46e935a06a34dba9792516415b32876c2b7f9c90708a029db405cf",
    });
    expect(await readFile(join(root, "reports", "report.html"), "utf8")).toBe(
      "<!doctype html><title>report</title>",
    );
    expect(await readdir(join(root, "reports"))).toEqual(["report.html"]);
  });

  it("records a durable failure, rethrows, and removes the partial HTML file", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-publication-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });
    const service = new ReportPublicationService(
      repository,
      new AtomicEvidencePublisher({ runRoot: root }),
    );
    repository.create({
      id: "export-html-2",
      runId: "run-1",
      format: "HTML",
      tempRelativePath: "reports/report.html.partial-1",
      attempt: 1,
    });

    await expect(
      service.publish("export-html-2", {
        relativePath: "reports/report.html",
        attempt: 1,
        content: (async function* () {
          yield "<!doctype html>";
          throw new Error("renderer interrupted");
        })(),
      }),
    ).rejects.toThrow("renderer interrupted");
    expect(repository.get("export-html-2")).toMatchObject({
      state: "FAILED",
      errorCategory: "PUBLISH_FAILED",
    });
    expect(await readdir(join(root, "reports"))).toEqual([]);
  });

  it("rejects an attempt mismatch before creating the output directory", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-publication-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });
    const service = new ReportPublicationService(
      repository,
      new AtomicEvidencePublisher({ runRoot: root }),
    );
    repository.create({ id: "export-html-3", runId: "run-1", format: "HTML", attempt: 2 });

    await expect(
      service.publish("export-html-3", {
        relativePath: "reports/report.html",
        attempt: 1,
        content: ["should not publish"],
      }),
    ).rejects.toThrow(/attempt does not match/i);
    expect(repository.get("export-html-3")).toMatchObject({ state: "PENDING", attempt: 2 });
    await expect(readdir(join(root, "reports"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
