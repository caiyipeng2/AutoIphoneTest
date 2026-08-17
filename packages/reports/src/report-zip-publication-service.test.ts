import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

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
import { EvidenceZipPublisher } from "./evidence-zip.js";
import { EvidenceZipVerifier } from "./evidence-zip-verifier.js";
import { ReportExportRepository } from "./report-export-repository.js";
import { ReportZipPublicationService } from "./report-zip-publication-service.js";
import { createZipManifest } from "./zip-manifest.js";

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

function fixture() {
  const html = "<html>report</html>\n";
  const log = "2026-08-14Z\n";
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  return {
    html,
    log,
    manifest: createZipManifest({
      html: {
        relativePath: "reports/report.html",
        sha256: digest(html),
        sizeBytes: Buffer.byteLength(html),
      },
      evidence: [
        {
          id: "ev-log",
          kind: "LOGCAT_SEGMENT",
          state: "READY",
          finalRelativePath: "evidence/log.txt",
          sha256: digest(log),
          sizeBytes: Buffer.byteLength(log),
        },
      ],
    }),
  };
}

function createService(database: Database.Database, root: string): ReportZipPublicationService {
  return new ReportZipPublicationService(
    new ReportExportRepository(database, { runRoot: root }),
    new EvidenceZipPublisher({ runRoot: root }),
    new EvidenceZipVerifier({ runRoot: root }),
  );
}

describe("report ZIP publication service", () => {
  it("publishes, independently verifies, and records the ZIP as READY", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-zip-service-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });
    const service = createService(database, root);
    repository.create({ id: "zip-1", runId: "run-1", format: "ZIP", attempt: 1 });
    const { html, log, manifest } = fixture();

    const ready = await service.publish("zip-1", {
      relativePath: "reports/evidence.zip",
      attempt: 1,
      manifest,
      entries: [
        {
          path: "reports/report.html",
          associationId: "report-html",
          source: Readable.from([html]),
        },
        {
          path: "evidence/log.txt",
          associationId: "ev-log",
          source: Readable.from([log]),
        },
      ],
    });

    expect(ready).toMatchObject({
      state: "READY",
      format: "ZIP",
      finalRelativePath: "reports/evidence.zip",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect((await readFile(join(root, "reports", "evidence.zip"))).byteLength).toBe(
      ready.sizeBytes,
    );
  });

  it("records VERIFY_FAILED when the archive bytes disagree with the manifest", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-zip-service-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });
    const service = createService(database, root);
    repository.create({ id: "zip-2", runId: "run-1", format: "ZIP", attempt: 1 });
    const { html, log, manifest } = fixture();
    const invalidManifest = createZipManifest({
      html: {
        relativePath: "reports/report.html",
        sha256: "f".repeat(64),
        sizeBytes: manifest.entries.find((entry) => entry.associationId === "report-html")!
          .sizeBytes,
      },
      evidence: [
        {
          id: "ev-log",
          kind: "LOGCAT_SEGMENT",
          state: "READY",
          finalRelativePath: "evidence/log.txt",
          sha256: manifest.entries.find((entry) => entry.associationId === "ev-log")!.sha256,
          sizeBytes: manifest.entries.find((entry) => entry.associationId === "ev-log")!.sizeBytes,
        },
      ],
    });

    await expect(
      service.publish("zip-2", {
        relativePath: "reports/evidence.zip",
        attempt: 1,
        manifest: invalidManifest,
        entries: [
          {
            path: "reports/report.html",
            associationId: "report-html",
            source: Readable.from([html]),
          },
          {
            path: "evidence/log.txt",
            associationId: "ev-log",
            source: Readable.from([log]),
          },
        ],
      }),
    ).rejects.toThrow(/hash|size/i);
    expect(repository.get("zip-2")).toMatchObject({
      state: "FAILED",
      errorCategory: "VERIFY_FAILED",
    });
    await expect(readFile(join(root, "reports", "evidence.zip"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects an HTML export and attempt mismatch before filesystem publication", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-report-zip-service-"));
    roots.push(root);
    const repository = new ReportExportRepository(database, { runRoot: root });
    const service = createService(database, root);
    repository.create({ id: "html-1", runId: "run-1", format: "HTML", attempt: 1 });
    repository.create({ id: "zip-3", runId: "run-1", format: "ZIP", attempt: 2 });
    const { manifest } = fixture();

    await expect(
      service.publish("html-1", {
        relativePath: "reports/evidence.zip",
        attempt: 1,
        manifest,
        entries: [],
      }),
    ).rejects.toThrow(/format/i);
    await expect(
      service.publish("zip-3", {
        relativePath: "reports/evidence.zip",
        attempt: 1,
        manifest,
        entries: [],
      }),
    ).rejects.toThrow(/attempt/i);
    expect(repository.get("html-1")).toMatchObject({ state: "PENDING" });
    expect(repository.get("zip-3")).toMatchObject({ state: "PENDING" });
  });
});
