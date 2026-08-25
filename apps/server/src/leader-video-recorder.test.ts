import { readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, win32 } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AtomicEvidencePublisher,
  EvidencePublicationService,
  EvidenceRepository,
} from "@test-center/evidence";
import {
  configureDatabase,
  DEVICES_MIGRATION,
  EVIDENCE_REPORTS_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
  RUN_ACTIONS_MIGRATION,
  SESSION_API_MIGRATION,
} from "@test-center/database";
import { LeaderVideoRecorder, type LeaderVideoRecorderProcess } from "./leader-video-recorder.js";

const roots: string[] = [];
const databases: Database.Database[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
});

describe("LeaderVideoRecorder", () => {
  it("creates VIDEO evidence and publishes the finalized leader recording", async () => {
    const { database, root, repository, publicationFactory } = await createFixture();
    let process: FakeProcess | undefined;
    const recorder = new LeaderVideoRecorder({
      runRoot: root,
      executablePath: "E:\\tools\\scrcpy\\3.1\\scrcpy.exe",
      evidenceRepository: repository,
      publicationServiceFactory: publicationFactory,
      processFactory: (input) => {
        process = new FakeProcess(input.recordPath);
        return process;
      },
    });

    await recorder.start({ runId: "run-1", serial: "R5CX211TXNT", enabled: true });

    const pending = repository.listPending("run-1");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: "video-run-1-leader",
      kind: "VIDEO",
      serial: "R5CX211TXNT",
      state: "PENDING",
      tempRelativePath: "video/leader.mp4.partial",
    });
    expect(process?.start).toHaveBeenCalledOnce();

    const result = await recorder.stop("run-1");

    expect(result).toMatchObject({ state: "READY", evidence: { kind: "VIDEO", state: "READY" } });
    expect(process?.stop).toHaveBeenCalledOnce();
    expect(await readFile(join(root, "run-1", "video", "leader.mp4"), "utf8")).toBe("mkv-data");
    expect(repository.get("video-run-1-leader")?.state).toBe("READY");
    expect(database.prepare("SELECT COUNT(*) AS count FROM evidence_records").get()).toEqual({
      count: 1,
    });
  });

  it("does not create evidence when leader recording is disabled", async () => {
    const { repository, root, publicationFactory } = await createFixture();
    const processFactory = vi.fn(() => {
      throw new Error("must not start scrcpy");
    });
    const recorder = new LeaderVideoRecorder({
      runRoot: root,
      executablePath: "scrcpy.exe",
      evidenceRepository: repository,
      publicationServiceFactory: publicationFactory,
      processFactory,
    });

    await recorder.start({ runId: "run-1", serial: "R5CX211TXNT", enabled: false });

    expect(processFactory).not.toHaveBeenCalled();
    expect(repository.listPending("run-1")).toEqual([]);
    expect(await recorder.stop("run-1")).toBeUndefined();
  });

  it("marks a failed process start without throwing into the session lifecycle", async () => {
    const { repository, root, publicationFactory } = await createFixture();
    const recorder = new LeaderVideoRecorder({
      runRoot: root,
      executablePath: "scrcpy.exe",
      evidenceRepository: repository,
      publicationServiceFactory: publicationFactory,
      processFactory: () => ({
        start: vi.fn(async () => {
          throw new Error("scrcpy unavailable");
        }),
        stop: vi.fn(async () => undefined),
      }),
    });

    await expect(
      recorder.start({ runId: "run-1", serial: "R5CX211TXNT", enabled: true }),
    ).resolves.toBeUndefined();

    expect(repository.get("video-run-1-leader")).toMatchObject({
      state: "FAILED",
      captureErrorCategory: "START_FAILED",
    });
    expect(await recorder.stop("run-1")).toBeUndefined();
  });
});

class FakeProcess implements LeaderVideoRecorderProcess {
  public readonly start = vi.fn(async () => {
    await writeFile(this.recordPath, "mkv-data", "utf8");
  });
  public readonly stop = vi.fn(async () => undefined);

  public constructor(private readonly recordPath: string) {}
}

async function createFixture(): Promise<{
  readonly database: Database.Database;
  readonly root: string;
  readonly repository: EvidenceRepository;
  readonly publicationFactory: (runId: string) => EvidencePublicationService;
}> {
  const root = win32.join(process.cwd(), "data", "tests", `leader-video-${randomUUID()}`);
  roots.push(root);
  const database = new Database(":memory:");
  databases.push(database);
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    SESSION_API_MIGRATION,
    EVIDENCE_REPORTS_MIGRATION,
  ]);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO devices (serial, state, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?, 'ONLINE', ?, ?, ?, ?)`,
    )
    .run("R5CX211TXNT", now, now, now, now);
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, client_request_id,
        leader_video_enabled, created_at, updated_at)
       VALUES (?, ?, 'RUNNING', 1, ?, ?, 1, ?, ?)`,
    )
    .run("run-1", "com.example.game", "nonce", "request-1", now, now);
  const repository = new EvidenceRepository(database, { runRoot: root });
  const publicationFactory = (runId: string) =>
    new EvidencePublicationService(
      repository,
      new AtomicEvidencePublisher({ runRoot: join(root, runId) }),
    );
  return { database, root, repository, publicationFactory };
}
