import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";

import {
  ACTION_COMMANDS_MIGRATION,
  configureDatabase,
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
  UID_BRIDGE_MIGRATION,
} from "../../packages/database/src/index.js";
import {
  ReportFinalizationExecutor,
  type ReportFinalizationRecord,
} from "../../packages/reports/src/index.js";

export type ReportFixtureScenario = "normal" | "failure" | "interrupted";

export interface ReportFixture {
  readonly database: Database.Database;
  readonly runRoot: string;
  finalize(): Promise<ReportFinalizationRecord>;
  close(): Promise<void>;
}

interface FixtureDevice {
  readonly serial: string;
  readonly role: "LEADER" | "FOLLOWER";
  readonly membershipState: "ACTIVE" | "QUARANTINED" | "RECOVERING" | "LEFT";
  readonly generation: number;
}

interface FixtureEvidence {
  readonly id: string;
  readonly serial: string;
  readonly kind: "RUN_EVENT" | "REDACTED_LOGCAT" | "CURRENT_SCREENSHOT";
  readonly state: "READY" | "FAILED" | "MISSING";
  readonly relativePath?: string;
  readonly content?: string;
  readonly errorCategory?: string;
  readonly unavailableReason?: "DEVICE_DISCONNECTED";
}

/** Creates a fully local report fixture without requiring an Android device or a server process. */
export async function createReportFixture(scenario: ReportFixtureScenario): Promise<ReportFixture> {
  const runRoot = await mkdtemp(join(tmpdir(), "test-center-m10-report-"));
  const database = new Database(":memory:");
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    UID_BRIDGE_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    SESSION_API_MIGRATION,
    ACTION_COMMANDS_MIGRATION,
    INCIDENTS_MIGRATION,
    RUN_MEMBERSHIP_MIGRATION,
    RUN_FAILURE_POLICY_MIGRATION,
    EVIDENCE_REPORTS_MIGRATION,
    REPORT_FINALIZATION_MIGRATION,
  ]);

  try {
    await seedReportFixture(database, runRoot, scenario);
    const executor = new ReportFinalizationExecutor(database, { runRoot });
    let closed = false;
    return {
      database,
      runRoot,
      finalize: async () => await executor.startFinalization(`fixture-${scenario}`),
      close: async () => {
        if (closed) return;
        closed = true;
        database.close();
        await rm(runRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    database.close();
    await rm(runRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Seeds a deterministic report run into either an in-memory or persistent database. */
export async function seedReportFixture(
  database: Database.Database,
  runRoot: string,
  scenario: ReportFixtureScenario,
  runId = `fixture-${scenario}`,
): Promise<void> {
  await seedFixture(database, runRoot, scenario, scenarioSeed(scenario), runId);
}

function scenarioSeed(scenario: ReportFixtureScenario): {
  readonly state: "FINISHED" | "FAILED" | "INTERRUPTED";
  readonly devices: readonly FixtureDevice[];
  readonly actionState: "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly targetState: "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly evidence: readonly FixtureEvidence[];
} {
  const leader: FixtureDevice = {
    serial: "ABC1234567",
    role: "LEADER",
    membershipState: scenario === "interrupted" ? "RECOVERING" : "ACTIVE",
    generation: scenario === "interrupted" ? 2 : 1,
  };
  if (scenario === "normal") {
    return {
      state: "FINISHED",
      devices: [leader],
      actionState: "SUCCEEDED",
      targetState: "SUCCEEDED",
      evidence: [
        {
          id: "evidence-normal-event",
          serial: leader.serial,
          kind: "RUN_EVENT",
          state: "READY",
          relativePath: "evidence/normal-event.txt",
          content: "normal fixture event\n",
        },
      ],
    };
  }

  const follower: FixtureDevice = {
    serial: "ZX2G22B7F8",
    role: "FOLLOWER",
    membershipState: scenario === "failure" ? "QUARANTINED" : "LEFT",
    generation: 1,
  };
  return {
    state: scenario === "failure" ? "FAILED" : "INTERRUPTED",
    devices: [leader, follower],
    actionState: scenario === "failure" ? "FAILED" : "CANCELLED",
    targetState: scenario === "failure" ? "FAILED" : "CANCELLED",
    evidence:
      scenario === "failure"
        ? [
            {
              id: "evidence-failure-logcat",
              serial: leader.serial,
              kind: "REDACTED_LOGCAT",
              state: "READY",
              relativePath: "evidence/failure-logcat.txt",
              content: "APP_CRASH_OR_ANR fixture\n",
            },
            {
              id: "evidence-failure-screenshot",
              serial: follower.serial,
              kind: "CURRENT_SCREENSHOT",
              state: "MISSING",
              unavailableReason: "DEVICE_DISCONNECTED",
            },
          ]
        : [
            {
              id: "evidence-interrupted-screenshot",
              serial: follower.serial,
              kind: "CURRENT_SCREENSHOT",
              state: "MISSING",
              unavailableReason: "DEVICE_DISCONNECTED",
            },
          ],
  };
}

async function seedFixture(
  database: Database.Database,
  runRoot: string,
  scenario: ReportFixtureScenario,
  seed: ReturnType<typeof scenarioSeed>,
  runId: string,
): Promise<void> {
  const timestamp = "2026-08-20T00:00:00.000Z";
  database
    .prepare(
      `INSERT INTO test_runs
       (id, package_name, state, current_epoch, run_nonce_hash, created_at, updated_at)
       VALUES (?, 'Idle Weapon Shop Tycoon', ?, 1, 'fixture-nonce', ?, ?)`,
    )
    .run(runId, seed.state, timestamp, timestamp);

  for (const device of seed.devices) {
    database
      .prepare(
        `INSERT INTO devices
         (serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq, created_at, updated_at)
         VALUES (?, 'ONLINE', '{}', ?, ?, 1, ?, ?)`,
      )
      .run(device.serial, timestamp, timestamp, timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO run_devices
         (run_id, serial, role, membership_state, epoch, generation, joined_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        runId,
        device.serial,
        device.role,
        device.membershipState,
        device.generation,
        timestamp,
        timestamp,
      );
    database
      .prepare(
        `INSERT INTO device_uid_observations
         (serial, package_name, install_generation, app_data_generation, uid, source, actor, build_id, observed_at)
         VALUES (?, 'Idle Weapon Shop Tycoon', 1, 1, ?, 'BRIDGE_AUTO', 'fixture', 'fixture-build', ?)`,
      )
      .run(device.serial, `UID-${scenario}-${device.serial}`, timestamp);
  }

  const actionId = `action-${scenario}`;
  database
    .prepare(
      `INSERT INTO actions
       (id, run_id, action_seq, client_request_id, action_type, payload_json, state, metrics_epoch, created_at, updated_at)
       VALUES (?, ?, 1, ?, 'tap', '{"x":1,"y":1}', ?, 1, ?, ?)`,
    )
    .run(actionId, runId, `request-${scenario}`, seed.actionState, timestamp, timestamp);
  for (const device of seed.devices) {
    database
      .prepare(
        `INSERT INTO action_targets
         (action_id, serial, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(actionId, device.serial, seed.targetState, timestamp, timestamp);
  }

  for (const evidence of seed.evidence) {
    const content = evidence.content;
    const sha256 =
      content === undefined ? undefined : createHash("sha256").update(content).digest("hex");
    if (content !== undefined && evidence.relativePath !== undefined) {
      const absolutePath = join(runRoot, runId, evidence.relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
    }
    database
      .prepare(
        `INSERT INTO evidence_records
         (id, run_id, action_id, serial, kind, state, final_relative_path, sha256, size_bytes,
          capture_error_category, unavailable_reason, attempt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        evidence.id,
        runId,
        actionId,
        evidence.serial,
        evidence.kind,
        evidence.state,
        evidence.relativePath ?? null,
        sha256 ?? null,
        content === undefined ? null : Buffer.byteLength(content),
        evidence.errorCategory ?? null,
        evidence.unavailableReason ?? null,
        timestamp,
        timestamp,
      );
  }

  if (scenario === "failure") {
    database
      .prepare(
        `INSERT INTO incidents
         (incident_id, run_id, serial, schema_version, category, generation, detected_at_realtime_ms,
          detected_at, source, evidence_ref, details_json, created_at)
         VALUES ('incident-failure', ?, 'ABC1234567', 1, 'APP_CRASH_OR_ANR', 1, 100,
                 ?, 'fixture-watchdog', 'evidence-failure-logcat', '{"message":"fixture crash"}', ?)`,
      )
      .run(runId, timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO recovery_attempts
         (id, incident_id, run_id, action, target_serial, reason, deadline_realtime_ms, status,
          started_at, completed_at, error_message)
         VALUES ('recovery-failure', 'incident-failure', ?, 'QUARANTINE_DEVICE', 'ZX2G22B7F8',
                 'fixture isolation', 500, 'SUCCEEDED', ?, ?, NULL)`,
      )
      .run(runId, timestamp, timestamp);
  }
}
