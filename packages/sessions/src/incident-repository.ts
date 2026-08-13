import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import { parseIncident, type Incident } from "@test-center/contracts/incident";

export interface IncidentRecordResult {
  readonly state: "CREATED" | "DEDUPLICATED";
  readonly incident: Incident;
}

export interface RecoveryAttempt {
  readonly id: string;
  readonly incidentId: string;
  readonly runId: string;
  readonly action: "PAUSE_ALL" | "QUARANTINE_DEVICE";
  readonly targetSerial?: string;
  readonly reason: string;
  readonly deadlineRealtimeMs: number;
  readonly status: "STARTED" | "SUCCEEDED" | "FAILED";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly errorMessage?: string;
}

export interface StartRecoveryInput {
  readonly incidentId: string;
  readonly action: RecoveryAttempt["action"];
  readonly reason: string;
  readonly targetSerial?: string;
  readonly deadlineRealtimeMs: number;
}

export interface FinishRecoveryInput {
  readonly status: "SUCCEEDED" | "FAILED";
  readonly completedAt: string;
  readonly errorMessage?: string;
}

interface IncidentRow {
  readonly incident_id: string;
  readonly run_id: string;
  readonly serial: string | null;
  readonly schema_version: number;
  readonly category: Incident["category"];
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
  readonly run_id: string;
  readonly action: RecoveryAttempt["action"];
  readonly target_serial: string | null;
  readonly reason: string;
  readonly deadline_realtime_ms: number;
  readonly status: RecoveryAttempt["status"];
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly error_message: string | null;
}

export class IncidentRepository {
  public constructor(private readonly database: Database.Database) {}

  public record(incident: Incident): IncidentRecordResult {
    const existing = this.database
      .prepare("SELECT * FROM incidents WHERE incident_id = ?")
      .get(incident.incidentId) as IncidentRow | undefined;
    if (existing !== undefined) {
      const stored = this.toIncident(existing);
      if (canonicalJson(stored) !== canonicalJson(incident)) {
        throw new Error("Incident id already exists with different content.");
      }
      return { state: "DEDUPLICATED", incident: stored };
    }

    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO incidents
         (incident_id, run_id, serial, schema_version, category, generation, detected_at_realtime_ms,
          detected_at, source, evidence_ref, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        incident.incidentId,
        incident.runId,
        incident.serial ?? null,
        incident.schemaVersion,
        incident.category,
        incident.generation ?? null,
        incident.detectedAtRealtimeMs,
        incident.detectedAt,
        incident.source,
        incident.evidenceRef ?? null,
        JSON.stringify(incident.details),
        now,
      );
    return { state: "CREATED", incident: freezeIncident(incident) };
  }

  public get(incidentId: string): Incident | undefined {
    const row = this.database
      .prepare("SELECT * FROM incidents WHERE incident_id = ?")
      .get(incidentId) as IncidentRow | undefined;
    return row === undefined ? undefined : this.toIncident(row);
  }

  public list(runId: string): readonly Incident[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM incidents
         WHERE run_id = ?
         ORDER BY detected_at_realtime_ms ASC, detected_at ASC, incident_id ASC`,
      )
      .all(runId) as readonly IncidentRow[];
    return rows.map((row) => this.toIncident(row));
  }

  public startRecovery(input: StartRecoveryInput): RecoveryAttempt {
    if (!Number.isFinite(input.deadlineRealtimeMs) || input.deadlineRealtimeMs < 0) {
      throw new TypeError("Recovery deadlineRealtimeMs must be a non-negative finite number.");
    }
    if (!input.reason.trim()) throw new TypeError("Recovery reason is required.");
    const incident = this.database
      .prepare("SELECT run_id FROM incidents WHERE incident_id = ?")
      .get(input.incidentId) as { run_id: string } | undefined;
    if (incident === undefined) throw new Error("Incident not found.");
    const attempt: RecoveryAttempt = {
      id: `recovery-${randomUUID()}`,
      incidentId: input.incidentId,
      runId: incident.run_id,
      action: input.action,
      ...(input.targetSerial === undefined ? {} : { targetSerial: input.targetSerial }),
      reason: input.reason,
      deadlineRealtimeMs: input.deadlineRealtimeMs,
      status: "STARTED",
      startedAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        `INSERT INTO recovery_attempts
         (id, incident_id, run_id, action, target_serial, reason, deadline_realtime_ms, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'STARTED', ?)`,
      )
      .run(
        attempt.id,
        attempt.incidentId,
        attempt.runId,
        attempt.action,
        attempt.targetSerial ?? null,
        attempt.reason,
        attempt.deadlineRealtimeMs,
        attempt.startedAt,
      );
    return Object.freeze(attempt);
  }

  public finishRecovery(id: string, input: FinishRecoveryInput): RecoveryAttempt {
    const current = this.readRecovery(id);
    if (current === undefined) throw new Error("Recovery attempt not found.");
    if (current.status !== "STARTED") throw new Error("Recovery attempt is already finished.");
    this.database
      .prepare(
        `UPDATE recovery_attempts
         SET status = ?, completed_at = ?, error_message = ?
         WHERE id = ? AND status = 'STARTED'`,
      )
      .run(input.status, input.completedAt, input.errorMessage ?? null, id);
    const updated = this.readRecovery(id);
    if (updated === undefined) throw new Error("Recovery attempt could not be read back.");
    return updated;
  }

  public listUnfinishedRecovery(runId: string): readonly RecoveryAttempt[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM recovery_attempts
         WHERE run_id = ? AND status = 'STARTED'
         ORDER BY started_at ASC, id ASC`,
      )
      .all(runId) as readonly RecoveryRow[];
    return rows.map((row) => this.toRecovery(row));
  }

  private readRecovery(id: string): RecoveryAttempt | undefined {
    const row = this.database.prepare("SELECT * FROM recovery_attempts WHERE id = ?").get(id) as
      RecoveryRow | undefined;
    return row === undefined ? undefined : this.toRecovery(row);
  }

  private toIncident(row: IncidentRow): Incident {
    return freezeIncident(
      parseIncident({
        schemaVersion: row.schema_version,
        incidentId: row.incident_id,
        runId: row.run_id,
        ...(row.serial === null ? {} : { serial: row.serial }),
        category: row.category,
        ...(row.generation === null ? {} : { generation: row.generation }),
        detectedAtRealtimeMs: row.detected_at_realtime_ms,
        detectedAt: row.detected_at,
        source: row.source,
        ...(row.evidence_ref === null ? {} : { evidenceRef: row.evidence_ref }),
        details: JSON.parse(row.details_json) as Record<string, string>,
      }),
    );
  }

  private toRecovery(row: RecoveryRow): RecoveryAttempt {
    return Object.freeze({
      id: row.id,
      incidentId: row.incident_id,
      runId: row.run_id,
      action: row.action,
      ...(row.target_serial === null ? {} : { targetSerial: row.target_serial }),
      reason: row.reason,
      deadlineRealtimeMs: row.deadline_realtime_ms,
      status: row.status,
      startedAt: row.started_at,
      ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
      ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    });
  }
}

function freezeIncident(incident: Incident): Incident {
  return Object.freeze({ ...incident, details: Object.freeze({ ...incident.details }) });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
