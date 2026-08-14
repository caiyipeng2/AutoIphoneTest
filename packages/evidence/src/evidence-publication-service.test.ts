import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import { EvidencePublicationService } from "./evidence-publication-service.js";
import { EvidenceRepository } from "./evidence-repository.js";

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

describe("evidence publication service", () => {
  it("publishes the file and writes its measured metadata as READY", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-publication-service-"));
    roots.push(root);
    const repository = new EvidenceRepository(database, { runRoot: root });
    const service = new EvidencePublicationService(
      repository,
      new AtomicEvidencePublisher({ runRoot: root }),
    );
    repository.create({
      id: "ev-1",
      runId: "run-1",
      kind: "RUN_EVENT",
      tempRelativePath: "events/event.partial-1",
      attempt: 1,
    });

    const ready = await service.publish("ev-1", {
      relativePath: "events/event.jsonl",
      attempt: 1,
      content: ['{"event":"finished"}\n'],
      capturedAt: "2026-08-14T01:00:00.000Z",
    });

    expect(ready).toMatchObject({
      state: "READY",
      finalRelativePath: "events/event.jsonl",
      sizeBytes: 21,
      sha256: "13b8f7d496ece6c7dbb603d25e3c3a682c5c23c6700c6c0bd13a9fd008da3dce",
      capturedAt: "2026-08-14T01:00:00.000Z",
    });
    expect(await readFile(join(root, "events", "event.jsonl"), "utf8")).toBe(
      '{"event":"finished"}\n',
    );
  });

  it("records a durable failure and rethrows when the publisher stream fails", async () => {
    const database = openDatabase();
    const root = await mkdtemp(join(tmpdir(), "test-center-publication-service-"));
    roots.push(root);
    const repository = new EvidenceRepository(database, { runRoot: root });
    const service = new EvidencePublicationService(
      repository,
      new AtomicEvidencePublisher({ runRoot: root }),
    );
    repository.create({
      id: "ev-2",
      runId: "run-1",
      kind: "LOGCAT_SEGMENT",
      tempRelativePath: "logs/log.partial-1",
      attempt: 1,
    });

    await expect(
      service.publish("ev-2", {
        relativePath: "logs/log.txt",
        attempt: 1,
        content: (async function* () {
          yield "not complete";
          throw new Error("stream interrupted");
        })(),
      }),
    ).rejects.toThrow("stream interrupted");
    expect(repository.get("ev-2")).toMatchObject({
      state: "FAILED",
      captureErrorCategory: "PUBLISH_FAILED",
    });
  });
});
