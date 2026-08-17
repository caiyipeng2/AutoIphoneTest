import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACTION_COMMANDS_MIGRATION,
  DEVICES_MIGRATION,
  EVIDENCE_REPORTS_MIGRATION,
  FOUNDATION_MIGRATION,
  INCIDENTS_MIGRATION,
  migrate,
  REPORT_FINALIZATION_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  RUN_FAILURE_POLICY_MIGRATION,
  RUN_MEMBERSHIP_MIGRATION,
  SESSION_API_MIGRATION,
} from "@test-center/database/migrations";
import type { ReportExportRecord } from "./report-export-repository.js";
import { ReportFinalizationService } from "./report-finalization-service.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function openDatabase(state: "FINISHED" | "FAILED" | "INTERRUPTED" = "FINISHED") {
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
    REPORT_FINALIZATION_MIGRATION,
  ]);
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES ('run-1', 'Idle Weapon Shop Tycoon', ?, 1, 'nonce', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
    )
    .run(state);
  return database;
}

function exportRecord(id: string): ReportExportRecord {
  return {
    id,
    runId: "run-1",
    format: id.startsWith("html") ? "HTML" : "ZIP",
    state: "READY",
    attempt: 1,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

function request() {
  return {
    runId: "run-1",
    htmlExportId: "html-1",
    html: { relativePath: "reports/report.html", attempt: 1, content: ["html"] },
    zipExportId: "zip-1",
    zip: { relativePath: "reports/evidence.zip", attempt: 1, manifest: {} as never, entries: [] },
  };
}

describe("report finalization service", () => {
  it("acquires FINALIZING, publishes HTML then ZIP, and completes the run report", async () => {
    const database = openDatabase();
    const html = vi.fn(async () => exportRecord("html-1"));
    const zip = vi.fn(async () => exportRecord("zip-1"));
    const service = new ReportFinalizationService(database, { publish: html }, { publish: zip });

    const result = await service.finalize(request());

    expect(result).toMatchObject({ state: "COMPLETED", attempt: 1, runId: "run-1" });
    expect(html).toHaveBeenCalledOnce();
    expect(zip).toHaveBeenCalledOnce();
    const htmlCallOrder = html.mock.invocationCallOrder[0];
    const zipCallOrder = zip.mock.invocationCallOrder[0];
    expect(htmlCallOrder).toBeDefined();
    expect(zipCallOrder).toBeDefined();
    expect(htmlCallOrder!).toBeLessThan(zipCallOrder!);
  });

  it("records FINALIZATION_FAILED and does not invoke ZIP after an HTML failure", async () => {
    const database = openDatabase();
    const html = vi.fn(async () => {
      throw new Error("HTML publication failed");
    });
    const zip = vi.fn(async () => exportRecord("zip-1"));
    const service = new ReportFinalizationService(database, { publish: html }, { publish: zip });

    await expect(service.finalize(request())).rejects.toThrow("HTML publication failed");
    expect(zip).not.toHaveBeenCalled();
    expect(service.get("run-1")).toMatchObject({
      state: "FINALIZATION_FAILED",
      attempt: 1,
      errorCategory: "EXPORT_FAILED",
    });
  });

  it("rejects a concurrent finalization lease and allows a report-only retry", async () => {
    const database = openDatabase();
    let releaseHtml!: () => void;
    const html = vi.fn(
      () =>
        new Promise<ReportExportRecord>((resolve) => {
          releaseHtml = () => resolve(exportRecord("html-1"));
        }),
    );
    const zip = vi.fn(async () => exportRecord("zip-1"));
    const service = new ReportFinalizationService(database, { publish: html }, { publish: zip });

    const first = service.finalize(request());
    await Promise.resolve();
    await expect(service.finalize(request())).rejects.toThrow(/FINALIZING/i);
    releaseHtml();
    await expect(first).resolves.toMatchObject({ state: "COMPLETED", attempt: 1 });
    html.mockResolvedValue(exportRecord("html-1"));

    database
      .prepare(
        "UPDATE run_finalizations SET state = 'FINALIZATION_FAILED', error_category = 'EXPORT_FAILED' WHERE run_id = 'run-1'",
      )
      .run();
    await expect(service.finalize(request())).resolves.toMatchObject({
      state: "COMPLETED",
      attempt: 2,
    });
  });
});
