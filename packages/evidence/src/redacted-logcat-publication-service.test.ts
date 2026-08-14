import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { AtomicEvidencePublisher } from "./atomic-publisher.js";
import { EvidenceManifestStore } from "./evidence-manifest.js";
import { EvidencePublicationService } from "./evidence-publication-service.js";
import { EvidenceRepository } from "./evidence-repository.js";
import { RedactedLogcatPublicationService } from "./redacted-logcat-publication-service.js";

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
       VALUES ('run-1', 'com.example.game', 'FINISHED', 1, 'nonce', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
    )
    .run();
  return database;
}

async function createFixture(): Promise<{
  root: string;
  manifest: Awaited<ReturnType<EvidenceManifestStore["flush"]>>;
}> {
  const root = await mkdtemp(join(tmpdir(), "test-center-redacted-logcat-publication-"));
  roots.push(root);
  await writeFile(
    join(root, "logcat-0001.raw"),
    "08-10 10:11:12.345  123  456 I Unity: token=access-secret action=金币 ABC\n",
    "utf8",
  );
  const store = new EvidenceManifestStore({ rootPath: root, runId: "run-1" });
  await store.register({
    evidenceId: "logcat-1",
    kind: "logcat-segment",
    relativePath: "logcat-0001.raw",
    serial: "serial-a",
  });
  return { root, manifest: await store.flush() };
}

function createService(
  database: Database.Database,
  root: string,
): {
  repository: EvidenceRepository;
  service: RedactedLogcatPublicationService;
} {
  const repository = new EvidenceRepository(database, { runRoot: root });
  const publication = new EvidencePublicationService(
    repository,
    new AtomicEvidencePublisher({ runRoot: root }),
  );
  return { repository, service: new RedactedLogcatPublicationService(repository, publication) };
}

describe("redacted logcat publication service", () => {
  it("publishes only redacted content and marks the output evidence READY", async () => {
    const database = openDatabase();
    const { root, manifest } = await createFixture();
    const { repository, service } = createService(database, root);
    repository.create({
      id: "redacted-logcat-1",
      runId: "run-1",
      kind: "REDACTED_LOGCAT",
      attempt: 1,
    });

    const ready = await service.publish({
      rootPath: root,
      manifest,
      evidenceId: "logcat-1",
      serial: "serial-a",
      secrets: ["access-secret"],
      actionTexts: ["金币 ABC"],
      maxBytes: 4096,
      maxLines: 10,
      outputEvidenceId: "redacted-logcat-1",
      relativePath: "reports/redacted-logcat-1.txt",
      attempt: 1,
    });

    expect(ready).toMatchObject({
      id: "redacted-logcat-1",
      state: "READY",
      finalRelativePath: "reports/redacted-logcat-1.txt",
    });
    const output = await readFile(join(root, "reports", "redacted-logcat-1.txt"), "utf8");
    expect(output).toContain("[REDACTED_TEXT]");
    expect(output).not.toContain("access-secret");
    expect(output).not.toContain("金币 ABC");
  });

  it("marks the output FAILED with REDACTION_FAILED before publishing when source validation fails", async () => {
    const database = openDatabase();
    const { root, manifest } = await createFixture();
    await writeFile(join(root, "logcat-0001.raw"), "tampered\n", "utf8");
    const { repository, service } = createService(database, root);
    repository.create({
      id: "redacted-logcat-2",
      runId: "run-1",
      kind: "REDACTED_LOGCAT",
      attempt: 1,
    });

    await expect(
      service.publish({
        rootPath: root,
        manifest,
        evidenceId: "logcat-1",
        serial: "serial-a",
        secrets: [],
        maxBytes: 4096,
        maxLines: 10,
        outputEvidenceId: "redacted-logcat-2",
        relativePath: "reports/redacted-logcat-2.txt",
        attempt: 1,
      }),
    ).rejects.toThrow(/hash|size|changed/);
    expect(repository.get("redacted-logcat-2")).toMatchObject({
      state: "FAILED",
      captureErrorCategory: "REDACTION_FAILED",
    });
  });

  it("delegates publication failures to the shared publisher state transition", async () => {
    const database = openDatabase();
    const { root, manifest } = await createFixture();
    await writeFile(join(root, "reports-redacted-logcat-3.txt"), "existing\n", "utf8");
    const { repository, service } = createService(database, root);
    repository.create({
      id: "redacted-logcat-3",
      runId: "run-1",
      kind: "REDACTED_LOGCAT",
      attempt: 1,
    });

    await expect(
      service.publish({
        rootPath: root,
        manifest,
        evidenceId: "logcat-1",
        serial: "serial-a",
        secrets: ["access-secret"],
        maxBytes: 4096,
        maxLines: 10,
        outputEvidenceId: "redacted-logcat-3",
        relativePath: "reports-redacted-logcat-3.txt",
        attempt: 1,
      }),
    ).rejects.toThrow(/already exists/);
    expect(repository.get("redacted-logcat-3")).toMatchObject({
      state: "FAILED",
      captureErrorCategory: "PUBLISH_FAILED",
    });
  });
});
