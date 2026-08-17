import type Database from "better-sqlite3";

import type {
  ReportActionInput,
  ReportActionTargetInput,
  ReportDeviceInput,
  ReportEvidenceInput,
  ReportIncidentInput,
  ReportModelInput,
  ReportRecoveryInput,
  ReportUnavailableReason,
} from "./report-model.js";
import { createImmutableReportModel, type ImmutableReportModel } from "./report-model.js";

interface RunRow {
  readonly id: string;
  readonly package_name: string;
  readonly state: string;
  readonly current_epoch: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface DeviceRow {
  readonly serial: string;
  readonly uid: string | null;
  readonly role: ReportDeviceInput["role"];
  readonly membership_state: ReportDeviceInput["membershipState"];
  readonly generation: number;
}

interface ActionRow {
  readonly id: string;
  readonly action_seq: number;
  readonly action_type: ReportActionInput["type"];
  readonly state: ReportActionInput["state"];
}

interface TargetRow {
  readonly action_id: string;
  readonly serial: string;
  readonly state: ReportActionTargetInput["state"];
}

interface EvidenceRow {
  readonly id: string;
  readonly kind: ReportEvidenceInput["kind"];
  readonly state: ReportEvidenceInput["state"];
  readonly serial: string | null;
  readonly final_relative_path: string | null;
  readonly sha256: string | null;
  readonly size_bytes: number | null;
  readonly capture_error_category: string | null;
  readonly unavailable_reason: ReportUnavailableReason | null;
}

interface IncidentRow {
  readonly incident_id: string;
  readonly serial: string | null;
  readonly category: ReportIncidentInput["category"];
  readonly generation: number | null;
  readonly detected_at_realtime_ms: number;
  readonly detected_at: string;
  readonly source: string;
  readonly evidence_ref: string | null;
  readonly details_json: string;
}

interface RecoveryRow {
  readonly id: string;
  readonly incident_id: string;
  readonly action: ReportRecoveryInput["action"];
  readonly target_serial: string | null;
  readonly reason: string;
  readonly deadline_realtime_ms: number;
  readonly status: ReportRecoveryInput["status"];
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly error_message: string | null;
}

/** Reads the report-owned snapshot without exposing a live database handle to renderers. */
export class ReportSnapshotRepository {
  public constructor(private readonly database: Database.Database) {}

  public load(runId: string): ImmutableReportModel {
    if (!runId.trim()) throw new TypeError("Report runId is required.");
    const readSnapshot = this.database.transaction(() => {
      const run = this.database
        .prepare(
          `SELECT id, package_name, state, current_epoch, created_at, updated_at
           FROM test_runs WHERE id = ?`,
        )
        .get(runId) as RunRow | undefined;
      if (run === undefined) throw new Error("Report run not found.");

      const devices = this.database
        .prepare(
          `SELECT rd.serial, rd.role, rd.membership_state, rd.generation,
                  (SELECT uid FROM device_uid_observations AS uid_observation
                   WHERE uid_observation.serial = rd.serial
                     AND uid_observation.package_name = ?
                   ORDER BY uid_observation.observed_at DESC, uid_observation.id DESC
                   LIMIT 1) AS uid
           FROM run_devices AS rd
           WHERE rd.run_id = ? AND rd.epoch = ?
           ORDER BY rd.serial ASC`,
        )
        .all(run.package_name, run.id, run.current_epoch) as readonly DeviceRow[];

      const actions = this.database
        .prepare(
          `SELECT id, action_seq, action_type, state
           FROM actions WHERE run_id = ? ORDER BY action_seq ASC, id ASC`,
        )
        .all(run.id) as readonly ActionRow[];
      const targets = this.database
        .prepare(
          `SELECT action_targets.action_id, action_targets.serial, action_targets.state
           FROM action_targets
           INNER JOIN actions ON actions.id = action_targets.action_id
           WHERE actions.run_id = ?
           ORDER BY action_targets.action_id ASC, action_targets.serial ASC`,
        )
        .all(run.id) as readonly TargetRow[];
      const targetsByAction = groupTargets(targets);

      const evidence = this.database
        .prepare(
          `SELECT id, kind, state, serial, final_relative_path, sha256, size_bytes,
                  capture_error_category, unavailable_reason
           FROM evidence_records WHERE run_id = ? ORDER BY id ASC`,
        )
        .all(run.id) as readonly EvidenceRow[];
      const incidents = this.database
        .prepare(
          `SELECT incident_id, serial, category, generation, detected_at_realtime_ms,
                  detected_at, source, evidence_ref, details_json
           FROM incidents WHERE run_id = ?
           ORDER BY detected_at_realtime_ms ASC, detected_at ASC, incident_id ASC`,
        )
        .all(run.id) as readonly IncidentRow[];
      const recoveries = this.database
        .prepare(
          `SELECT id, incident_id, action, target_serial, reason, deadline_realtime_ms,
                  status, started_at, completed_at, error_message
           FROM recovery_attempts WHERE run_id = ?
           ORDER BY started_at ASC, id ASC`,
        )
        .all(run.id) as readonly RecoveryRow[];

      const input: ReportModelInput = {
        schemaVersion: 1,
        run: {
          id: run.id,
          packageName: run.package_name,
          state: run.state as ReportModelInput["run"]["state"],
          currentEpoch: run.current_epoch,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
        },
        devices: devices.map((device) => ({
          serial: device.serial,
          ...(device.uid === null ? {} : { uid: device.uid }),
          role: device.role,
          membershipState: device.membership_state,
          generation: device.generation,
        })),
        actions: actions.map((action) => ({
          id: action.id,
          actionSeq: action.action_seq,
          type: action.action_type,
          state: action.state,
          label: action.action_type,
          targets: targetsByAction.get(action.id) ?? [],
        })),
        evidence: evidence.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          state: entry.state,
          ...(entry.serial === null ? {} : { serial: entry.serial }),
          ...(entry.final_relative_path === null
            ? {}
            : { finalRelativePath: entry.final_relative_path }),
          ...(entry.sha256 === null ? {} : { sha256: entry.sha256 }),
          ...(entry.size_bytes === null ? {} : { sizeBytes: entry.size_bytes }),
          ...(entry.capture_error_category === null
            ? {}
            : { errorCategory: entry.capture_error_category }),
          ...(entry.unavailable_reason === null
            ? {}
            : { unavailableReason: entry.unavailable_reason }),
        })),
        incidents: incidents.map((incident) => ({
          incidentId: incident.incident_id,
          category: incident.category,
          ...(incident.serial === null ? {} : { serial: incident.serial }),
          ...(incident.generation === null ? {} : { generation: incident.generation }),
          detectedAtRealtimeMs: incident.detected_at_realtime_ms,
          detectedAt: incident.detected_at,
          source: incident.source,
          ...(incident.evidence_ref === null ? {} : { evidenceRef: incident.evidence_ref }),
          details: JSON.parse(incident.details_json) as Record<string, string>,
        })),
        recoveries: recoveries.map((recovery) => ({
          id: recovery.id,
          incidentId: recovery.incident_id,
          action: recovery.action,
          ...(recovery.target_serial === null ? {} : { targetSerial: recovery.target_serial }),
          reason: recovery.reason,
          deadlineRealtimeMs: recovery.deadline_realtime_ms,
          status: recovery.status,
          startedAt: recovery.started_at,
          ...(recovery.completed_at === null ? {} : { completedAt: recovery.completed_at }),
          ...(recovery.error_message === null ? {} : { errorMessage: recovery.error_message }),
        })),
      };
      return createImmutableReportModel(input);
    });
    return readSnapshot();
  }
}

function groupTargets(
  rows: readonly TargetRow[],
): ReadonlyMap<string, readonly ReportActionTargetInput[]> {
  const grouped = new Map<string, ReportActionTargetInput[]>();
  for (const row of rows) {
    const targets = grouped.get(row.action_id) ?? [];
    targets.push({ serial: row.serial, state: row.state });
    grouped.set(row.action_id, targets);
  }
  return grouped;
}
