import type Database from "better-sqlite3";

import type { ReportRunState } from "./report-model.js";
import type {
  ReportFinalizationRecord,
  ReportFinalizationState,
} from "./report-finalization-service.js";
import type {
  ReportExportFormat,
  ReportExportRecord,
  ReportExportState,
} from "./report-export-repository.js";

export interface ReportHistoryFilter {
  readonly state?: ReportRunState;
  readonly serial?: string;
  readonly uid?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface ReportHistoryDevice {
  readonly serial: string;
  readonly role: "LEADER" | "FOLLOWER";
  readonly uid?: string;
}

export interface ReportHistoryItem {
  readonly runId: string;
  readonly packageName: string;
  readonly state: ReportRunState;
  readonly currentEpoch: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly devices: readonly ReportHistoryDevice[];
  readonly exports: readonly ReportExportRecord[];
  readonly finalization?: ReportFinalizationRecord;
}

interface RunRow {
  readonly id: string;
  readonly package_name: string;
  readonly state: ReportRunState;
  readonly current_epoch: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface DeviceRow {
  readonly serial: string;
  readonly role: ReportHistoryDevice["role"];
  readonly uid: string | null;
}

interface ExportRow {
  readonly id: string;
  readonly run_id: string;
  readonly format: ReportExportFormat;
  readonly state: ReportExportState;
  readonly temp_relative_path: string | null;
  readonly final_relative_path: string | null;
  readonly sha256: string | null;
  readonly size_bytes: number | null;
  readonly error_category: string | null;
  readonly attempt: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface FinalizationRow {
  readonly run_id: string;
  readonly state: ReportFinalizationState;
  readonly attempt: number;
  readonly error_category: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly updated_at: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** Provides immutable, read-only run history without exposing a database handle. */
export class ReportHistoryRepository {
  public constructor(private readonly database: Database.Database) {}

  public list(filter: ReportHistoryFilter = {}): readonly ReportHistoryItem[] {
    const { where, params, limit } = buildFilter(filter);
    const rows = this.database
      .prepare(
        `SELECT id, package_name, state, current_epoch, created_at, updated_at
         FROM test_runs
         WHERE state IN ('FINISHED', 'FAILED', 'INTERRUPTED')${where}
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...params, limit) as readonly RunRow[];
    return rows.map((row) => this.readItem(row));
  }

  public get(runId: string): ReportHistoryItem | undefined {
    if (!runId.trim()) throw new TypeError("Report runId is required.");
    const row = this.database
      .prepare(
        `SELECT id, package_name, state, current_epoch, created_at, updated_at
         FROM test_runs WHERE id = ? AND state IN ('FINISHED', 'FAILED', 'INTERRUPTED')`,
      )
      .get(runId) as RunRow | undefined;
    return row === undefined ? undefined : this.readItem(row);
  }

  private readItem(row: RunRow): ReportHistoryItem {
    const devices = this.database
      .prepare(
        `SELECT rd.serial, rd.role,
                (SELECT observation.uid
                 FROM device_uid_observations AS observation
                 WHERE observation.serial = rd.serial
                   AND observation.package_name = ?
                 ORDER BY observation.observed_at DESC, observation.id DESC
                 LIMIT 1) AS uid
         FROM run_devices AS rd
         WHERE rd.run_id = ? AND rd.epoch = ?
         ORDER BY rd.serial ASC`,
      )
      .all(row.package_name, row.id, row.current_epoch) as readonly DeviceRow[];
    const exports = this.database
      .prepare("SELECT * FROM report_exports WHERE run_id = ? ORDER BY format ASC, attempt ASC")
      .all(row.id) as readonly ExportRow[];
    const finalization = this.database
      .prepare("SELECT * FROM run_finalizations WHERE run_id = ?")
      .get(row.id) as FinalizationRow | undefined;
    return {
      runId: row.id,
      packageName: row.package_name,
      state: row.state,
      currentEpoch: row.current_epoch,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      devices: devices.map((device) => ({
        serial: device.serial,
        role: device.role,
        ...(device.uid === null ? {} : { uid: device.uid }),
      })),
      exports: exports.map(toExportRecord),
      ...(finalization === undefined ? {} : { finalization: toFinalizationRecord(finalization) }),
    };
  }
}

function buildFilter(filter: ReportHistoryFilter): {
  readonly where: string;
  readonly params: readonly unknown[];
  readonly limit: number;
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.state !== undefined) {
    if (!isReportRunState(filter.state)) throw new TypeError("Report history state is invalid.");
    clauses.push(" AND state = ?");
    params.push(filter.state);
  }
  if (filter.serial !== undefined) {
    if (!filter.serial.trim()) throw new TypeError("Report history serial is required.");
    clauses.push(
      " AND EXISTS (SELECT 1 FROM run_devices AS filter_device WHERE filter_device.run_id = test_runs.id AND filter_device.epoch = test_runs.current_epoch AND filter_device.serial = ?)",
    );
    params.push(filter.serial);
  }
  if (filter.uid !== undefined) {
    if (!filter.uid.trim()) throw new TypeError("Report history UID is required.");
    clauses.push(
      " AND EXISTS (SELECT 1 FROM run_devices AS filter_device INNER JOIN device_uid_observations AS filter_uid ON filter_uid.serial = filter_device.serial AND filter_uid.package_name = test_runs.package_name WHERE filter_device.run_id = test_runs.id AND filter_device.epoch = test_runs.current_epoch AND filter_uid.uid = ?)",
    );
    params.push(filter.uid);
  }
  if (filter.from !== undefined) {
    assertTimestamp(filter.from, "from");
    clauses.push(" AND created_at >= ?");
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    assertTimestamp(filter.to, "to");
    clauses.push(" AND created_at <= ?");
    params.push(filter.to);
  }
  const limit = filter.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError(`Report history limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
  return { where: clauses.join(""), params, limit };
}

function assertTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)))
    throw new TypeError(`Report history ${field} is invalid.`);
}

function isReportRunState(value: string): value is ReportRunState {
  return value === "FINISHED" || value === "FAILED" || value === "INTERRUPTED";
}

function toExportRecord(row: ExportRow): ReportExportRecord {
  return {
    id: row.id,
    runId: row.run_id,
    format: row.format,
    state: row.state,
    ...(row.temp_relative_path === null ? {} : { tempRelativePath: row.temp_relative_path }),
    ...(row.final_relative_path === null ? {} : { finalRelativePath: row.final_relative_path }),
    ...(row.sha256 === null ? {} : { sha256: row.sha256 }),
    ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
    ...(row.error_category === null ? {} : { errorCategory: row.error_category }),
    attempt: row.attempt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFinalizationRecord(row: FinalizationRow): ReportFinalizationRecord {
  return {
    runId: row.run_id,
    state: row.state,
    attempt: row.attempt,
    ...(row.error_category === null ? {} : { errorCategory: row.error_category }),
    startedAt: row.started_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    updatedAt: row.updated_at,
  };
}
