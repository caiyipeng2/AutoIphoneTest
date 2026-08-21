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
  OPTIONAL_REPORT_EXPORTS_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  RUN_FAILURE_POLICY_MIGRATION,
  RUN_MEMBERSHIP_MIGRATION,
  SESSION_API_MIGRATION,
} from "@test-center/database/migrations";
import type { ImmutableReportModel } from "./report-model.js";
import { ReportExportRepository } from "./report-export-repository.js";
import {
  ReportExportService,
  type ReportExportPublisher,
  type ReportOptionalExportFormat,
} from "./export-service.js";

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
    OPTIONAL_REPORT_EXPORTS_MIGRATION,
  ]);
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES ('run-export', 'Idle Weapon Shop Tycoon', 'FINISHED', 1, 'nonce', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')`,
    )
    .run();
  return database;
}

const model: ImmutableReportModel = {
  schemaVersion: 1,
  run: {
    id: "run-export",
    packageName: "Idle Weapon Shop Tycoon",
    state: "FINISHED",
    currentEpoch: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:05:00.000Z",
  },
  devices: [],
  actions: [],
  evidence: [],
  incidents: [],
  recoveries: [],
};

describe("ReportExportService", () => {
  it("queues optional formats idempotently with one PDF and two other slots", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-export-service-"));
    roots.push(root);
    const repository = new ReportExportRepository(openDatabase(), { runRoot: root });
    const publisher = new ControlledPublisher();
    const service = new ReportExportService({
      repository,
      runRoot: root,
      loadModel: () => model,
      publishers: {
        EXCEL: publisher,
        PDF: publisher,
        JUNIT: publisher,
      },
    });

    const requested = service.request("run-export", ["EXCEL", "PDF", "JUNIT"], "export-key");
    expect(requested.map((job) => job.format)).toEqual(["EXCEL", "PDF", "JUNIT"]);
    expect(service.request("run-export", ["JUNIT", "PDF", "EXCEL"], "export-key")).toEqual(
      requested,
    );

    await publisher.waitForStarted(3);
    expect(publisher.maxActive("PDF")).toBe(1);
    expect(publisher.maxActive("EXCEL")).toBeLessThanOrEqual(2);
    expect(publisher.maxActive("JUNIT")).toBeLessThanOrEqual(2);
    publisher.release();
    await service.whenIdle();

    expect(repository.list("run-export").map((job) => job.state)).toEqual([
      "READY",
      "READY",
      "READY",
    ]);
    expect(repository.list("run-export").every((job) => job.sha256 === "a".repeat(64))).toBe(true);
  });

  it("records publisher failure without changing the immutable run state", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-export-failure-"));
    roots.push(root);
    const repository = new ReportExportRepository(openDatabase(), { runRoot: root });
    const service = new ReportExportService({
      repository,
      runRoot: root,
      loadModel: () => model,
      publishers: {
        EXCEL: {
          publish: async () => {
            throw new Error("renderer unavailable");
          },
        },
        PDF: new ControlledPublisher(),
        JUNIT: new ControlledPublisher(),
      },
    });

    service.request("run-export", ["EXCEL"], "failure-key");
    await service.whenIdle();

    expect(repository.get("optional-run-export-EXCEL-1")?.state).toBe("FAILED");
    expect(model.run.state).toBe("FINISHED");
  });
});

class ControlledPublisher implements ReportExportPublisher {
  private readonly started: ReportOptionalExportFormat[] = [];
  private readonly active = new Map<ReportOptionalExportFormat, number>();
  private readonly peak = new Map<ReportOptionalExportFormat, number>();
  private releaseGate: (() => void) | undefined;
  private readonly releasePromise = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });

  public async publish(
    modelInput: ImmutableReportModel,
    finalPath: string,
  ): Promise<{
    readonly finalPath: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  }> {
    const format = finalPath.includes("pdf")
      ? "PDF"
      : finalPath.includes("junit")
        ? "JUNIT"
        : "EXCEL";
    this.started.push(format);
    const active = (this.active.get(format) ?? 0) + 1;
    this.active.set(format, active);
    this.peak.set(format, Math.max(this.peak.get(format) ?? 0, active));
    await this.releasePromise;
    this.active.set(format, active - 1);
    void modelInput;
    return { finalPath, sha256: "a".repeat(64), sizeBytes: 1 };
  }

  public async waitForStarted(count: number): Promise<void> {
    for (let attempts = 0; this.started.length < count && attempts < 100; attempts += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(this.started.length).toBe(count);
  }

  public maxActive(format: ReportOptionalExportFormat): number {
    return this.peak.get(format) ?? 0;
  }

  public release(): void {
    this.releaseGate?.();
  }
}
