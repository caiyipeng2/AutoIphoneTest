import type { DeviceSerial } from "@test-center/contracts/device";
import { parseDeviceSerial } from "@test-center/contracts/device";
import { toSafeRelativeHref } from "./html-escape.js";

export type ReportRunState = "FINISHED" | "FAILED" | "INTERRUPTED";
export type ReportDeviceRole = "LEADER" | "FOLLOWER";
export type ReportMembershipState = "ACTIVE" | "QUARANTINED" | "RECOVERING" | "LEFT";
export type ReportActionType = "tap" | "swipe";
export type ReportActionState =
  "QUEUED" | "LEASED" | "DISPATCHING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";
export type ReportTargetState =
  "QUEUED" | "DISPATCHING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";
export type ReportEvidenceState = "PENDING" | "READY" | "FAILED" | "MISSING";
export type ReportUnavailableReason =
  "DEVICE_DISCONNECTED" | "PROCESS_ABSENT" | "SOURCE_NOT_APPLICABLE";
export type ReportEvidenceKind =
  | "ACTION_LOG"
  | "LOGCAT_SEGMENT"
  | "RUN_EVENT"
  | "SCREENSHOT"
  | "TIMING"
  | "VIDEO"
  | "CURRENT_SCREENSHOT"
  | "FOREGROUND_PROCESS"
  | "REDACTED_LOGCAT"
  | "MAPPED_INPUT"
  | "APPIUM_TIMING"
  | "BRIDGE_STATE"
  | "BRIDGE_ARM"
  | "BRIDGE_ACK"
  | "BUFFERED_LOGCAT";
export type ReportIncidentCategory =
  | "ADB_DISCONNECTED"
  | "APPIUM_SESSION_LOST"
  | "APP_CRASH_OR_ANR"
  | "WRONG_FOREGROUND"
  | "BRIDGE_TIMEOUT"
  | "BRIDGE_STATE_MISMATCH"
  | "TEXT_FOCUS_MISMATCH"
  | "METRICS_CHANGED"
  | "LOW_DISK";
export type ReportRecoveryAction = "PAUSE_ALL" | "QUARANTINE_DEVICE";
export type ReportRecoveryState = "STARTED" | "SUCCEEDED" | "FAILED";

export interface ReportRunInput {
  readonly id: string;
  readonly packageName: string;
  readonly state: ReportRunState;
  readonly currentEpoch: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReportDeviceInput {
  readonly serial: string;
  readonly uid?: string;
  readonly role: ReportDeviceRole;
  readonly membershipState: ReportMembershipState;
  readonly generation: number;
}

export interface ReportActionTargetInput {
  readonly serial: string;
  readonly state: ReportTargetState;
}

export interface ReportActionInput {
  readonly id: string;
  readonly actionSeq: number;
  readonly type: ReportActionType;
  readonly state: ReportActionState;
  readonly label?: string;
  readonly targets: readonly ReportActionTargetInput[];
}

export interface ReportEvidenceInput {
  readonly id: string;
  readonly kind: ReportEvidenceKind;
  readonly state: ReportEvidenceState;
  readonly serial?: string;
  readonly finalRelativePath?: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly errorCategory?: string;
  readonly unavailableReason?: ReportUnavailableReason;
}

export interface ReportIncidentInput {
  readonly incidentId: string;
  readonly category: ReportIncidentCategory;
  readonly serial?: string;
  readonly generation?: number;
  readonly detectedAtRealtimeMs: number;
  readonly detectedAt: string;
  readonly source: string;
  readonly evidenceRef?: string;
  readonly details: Readonly<Record<string, string>>;
}

export interface ReportRecoveryInput {
  readonly id: string;
  readonly incidentId: string;
  readonly action: ReportRecoveryAction;
  readonly targetSerial?: string;
  readonly reason: string;
  readonly deadlineRealtimeMs: number;
  readonly status: ReportRecoveryState;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly errorMessage?: string;
}

export interface ReportModelInput {
  readonly schemaVersion: 1;
  readonly run: ReportRunInput;
  readonly devices: readonly ReportDeviceInput[];
  readonly actions: readonly ReportActionInput[];
  readonly evidence: readonly ReportEvidenceInput[];
  readonly incidents?: readonly ReportIncidentInput[];
  readonly recoveries?: readonly ReportRecoveryInput[];
}

export interface ImmutableReportModel {
  readonly schemaVersion: 1;
  readonly run: Readonly<ReportRunInput>;
  readonly devices: readonly ImmutableReportDevice[];
  readonly actions: readonly ImmutableReportAction[];
  readonly evidence: readonly ImmutableReportEvidence[];
  readonly incidents: readonly ImmutableReportIncident[];
  readonly recoveries: readonly ImmutableReportRecovery[];
}

export interface ImmutableReportDevice {
  readonly serial: DeviceSerial;
  readonly uid?: string;
  readonly role: ReportDeviceRole;
  readonly membershipState: ReportMembershipState;
  readonly generation: number;
}

export interface ImmutableReportActionTarget {
  readonly serial: DeviceSerial;
  readonly state: ReportTargetState;
}

export interface ImmutableReportAction {
  readonly id: string;
  readonly actionSeq: number;
  readonly type: ReportActionType;
  readonly state: ReportActionState;
  readonly label?: string;
  readonly targets: readonly ImmutableReportActionTarget[];
}

export interface ImmutableReportEvidence {
  readonly id: string;
  readonly kind: ReportEvidenceKind;
  readonly state: ReportEvidenceState;
  readonly serial?: DeviceSerial;
  readonly finalRelativePath?: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly errorCategory?: string;
  readonly unavailableReason?: ReportUnavailableReason;
}

export interface ImmutableReportIncident {
  readonly incidentId: string;
  readonly category: ReportIncidentCategory;
  readonly serial?: DeviceSerial;
  readonly generation?: number;
  readonly detectedAtRealtimeMs: number;
  readonly detectedAt: string;
  readonly source: string;
  readonly evidenceRef?: string;
  readonly details: Readonly<Record<string, string>>;
}

export interface ImmutableReportRecovery {
  readonly id: string;
  readonly incidentId: string;
  readonly action: ReportRecoveryAction;
  readonly targetSerial?: DeviceSerial;
  readonly reason: string;
  readonly deadlineRealtimeMs: number;
  readonly status: ReportRecoveryState;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly errorMessage?: string;
}

export function createImmutableReportModel(input: ReportModelInput): ImmutableReportModel {
  if (input.schemaVersion !== 1) throw new TypeError("Unsupported report schema version.");
  const run = normalizeRun(input.run);
  const devices = normalizeDevices(input.devices);
  const actions = normalizeActions(input.actions);
  const evidence = normalizeEvidence(input.evidence);
  const incidents = normalizeIncidents(input.incidents ?? []);
  const recoveries = normalizeRecoveries(input.recoveries ?? []);
  return deepFreeze({
    schemaVersion: 1 as const,
    run,
    devices,
    actions,
    evidence,
    incidents,
    recoveries,
  });
}

function normalizeRun(input: ReportRunInput): ReportRunInput {
  requireText(input.id, "run.id");
  requireText(input.packageName, "run.packageName");
  requireText(input.createdAt, "run.createdAt");
  requireText(input.updatedAt, "run.updatedAt");
  requirePositiveInteger(input.currentEpoch, "run.currentEpoch");
  if (!isReportRunState(input.state)) throw new TypeError("Run state is not reportable.");
  return { ...input };
}

function normalizeDevices(input: readonly ReportDeviceInput[]): readonly ImmutableReportDevice[] {
  const serials = new Set<string>();
  let leaderCount = 0;
  const devices = input.map((device) => {
    const serial = parseDeviceSerial(device.serial);
    if (serials.has(serial)) throw new Error(`Duplicate device serial: ${serial}`);
    serials.add(serial);
    if (device.role === "LEADER") leaderCount += 1;
    if (device.role !== "LEADER" && device.role !== "FOLLOWER") {
      throw new TypeError("Device role is invalid.");
    }
    if (!isMembershipState(device.membershipState)) {
      throw new TypeError("Device membership state is invalid.");
    }
    requirePositiveInteger(device.generation, `device ${serial} generation`);
    return {
      serial,
      ...(device.uid === undefined ? {} : { uid: requireText(device.uid, `device ${serial} uid`) }),
      role: device.role,
      membershipState: device.membershipState,
      generation: device.generation,
    };
  });
  if (leaderCount > 1) throw new Error("Report cannot contain multiple leader devices.");
  return devices.sort((left, right) => left.serial.localeCompare(right.serial));
}

function normalizeActions(input: readonly ReportActionInput[]): readonly ImmutableReportAction[] {
  const actionIds = new Set<string>();
  return input
    .map((action) => {
      requireText(action.id, "action.id");
      if (actionIds.has(action.id)) throw new Error(`Duplicate action id: ${action.id}`);
      actionIds.add(action.id);
      requirePositiveInteger(action.actionSeq, `action ${action.id} actionSeq`);
      if (action.type !== "tap" && action.type !== "swipe") {
        throw new TypeError(`Action ${action.id} type is invalid.`);
      }
      if (!isActionState(action.state))
        throw new TypeError(`Action ${action.id} state is invalid.`);
      const serials = new Set<string>();
      const targets = action.targets
        .map((target) => {
          const serial = parseDeviceSerial(target.serial);
          if (serials.has(serial)) throw new Error(`Duplicate target serial: ${serial}`);
          serials.add(serial);
          if (!isTargetState(target.state)) throw new TypeError("Action target state is invalid.");
          return { serial, state: target.state };
        })
        .sort((left, right) => left.serial.localeCompare(right.serial));
      return {
        id: action.id,
        actionSeq: action.actionSeq,
        type: action.type,
        state: action.state,
        ...(action.label === undefined ? {} : { label: requireText(action.label, "action.label") }),
        targets,
      };
    })
    .sort((left, right) => left.actionSeq - right.actionSeq || left.id.localeCompare(right.id));
}

function normalizeEvidence(
  input: readonly ReportEvidenceInput[],
): readonly ImmutableReportEvidence[] {
  const evidenceIds = new Set<string>();
  return input
    .map((entry) => {
      requireText(entry.id, "evidence.id");
      if (evidenceIds.has(entry.id)) throw new Error(`Duplicate evidence id: ${entry.id}`);
      evidenceIds.add(entry.id);
      if (!isEvidenceKind(entry.kind)) throw new TypeError(`Evidence ${entry.id} kind is invalid.`);
      if (!isEvidenceState(entry.state))
        throw new TypeError(`Evidence ${entry.id} state is invalid.`);
      if (entry.serial !== undefined) parseDeviceSerial(entry.serial);
      if (entry.finalRelativePath !== undefined) toSafeRelativeHref(entry.finalRelativePath);
      if (entry.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(entry.sha256)) {
        throw new TypeError(`Evidence ${entry.id} sha256 is invalid.`);
      }
      if (entry.sizeBytes !== undefined) {
        if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
          throw new TypeError(`Evidence ${entry.id} sizeBytes is invalid.`);
        }
      }
      if (
        entry.state === "READY" &&
        (entry.finalRelativePath === undefined || entry.sha256 === undefined)
      ) {
        throw new Error(`READY evidence ${entry.id} is missing publication metadata.`);
      }
      if (entry.state === "MISSING" && entry.unavailableReason === undefined) {
        throw new Error(`MISSING evidence ${entry.id} is missing an unavailable reason.`);
      }
      return {
        id: entry.id,
        kind: entry.kind,
        state: entry.state,
        ...(entry.serial === undefined ? {} : { serial: parseDeviceSerial(entry.serial) }),
        ...(entry.finalRelativePath === undefined
          ? {}
          : { finalRelativePath: entry.finalRelativePath }),
        ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 }),
        ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
        ...(entry.errorCategory === undefined
          ? {}
          : {
              errorCategory: requireText(entry.errorCategory, `evidence ${entry.id} errorCategory`),
            }),
        ...(entry.unavailableReason === undefined
          ? {}
          : { unavailableReason: entry.unavailableReason }),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeIncidents(
  input: readonly ReportIncidentInput[],
): readonly ImmutableReportIncident[] {
  const ids = new Set<string>();
  return input
    .map((incident) => {
      requireText(incident.incidentId, "incident.incidentId");
      if (ids.has(incident.incidentId)) {
        throw new Error(`Duplicate incident id: ${incident.incidentId}`);
      }
      ids.add(incident.incidentId);
      if (!isIncidentCategory(incident.category))
        throw new TypeError("Incident category is invalid.");
      if (incident.serial !== undefined) parseDeviceSerial(incident.serial);
      if (incident.generation !== undefined) {
        requirePositiveInteger(incident.generation, `incident ${incident.incidentId} generation`);
      }
      if (!Number.isFinite(incident.detectedAtRealtimeMs) || incident.detectedAtRealtimeMs < 0) {
        throw new TypeError(`Incident ${incident.incidentId} realtime timestamp is invalid.`);
      }
      requireText(incident.detectedAt, `incident ${incident.incidentId} detectedAt`);
      requireText(incident.source, `incident ${incident.incidentId} source`);
      const details = normalizeDetails(incident.details, `incident ${incident.incidentId} details`);
      return {
        incidentId: incident.incidentId,
        category: incident.category,
        ...(incident.serial === undefined ? {} : { serial: parseDeviceSerial(incident.serial) }),
        ...(incident.generation === undefined ? {} : { generation: incident.generation }),
        detectedAtRealtimeMs: incident.detectedAtRealtimeMs,
        detectedAt: incident.detectedAt,
        source: incident.source,
        ...(incident.evidenceRef === undefined
          ? {}
          : { evidenceRef: requireText(incident.evidenceRef, "incident.evidenceRef") }),
        details,
      };
    })
    .sort(
      (left, right) =>
        left.detectedAtRealtimeMs - right.detectedAtRealtimeMs ||
        left.detectedAt.localeCompare(right.detectedAt) ||
        left.incidentId.localeCompare(right.incidentId),
    );
}

function normalizeRecoveries(
  input: readonly ReportRecoveryInput[],
): readonly ImmutableReportRecovery[] {
  const ids = new Set<string>();
  return input
    .map((recovery) => {
      requireText(recovery.id, "recovery.id");
      if (ids.has(recovery.id)) throw new Error(`Duplicate recovery id: ${recovery.id}`);
      ids.add(recovery.id);
      requireText(recovery.incidentId, `recovery ${recovery.id} incidentId`);
      if (recovery.action !== "PAUSE_ALL" && recovery.action !== "QUARANTINE_DEVICE") {
        throw new TypeError(`Recovery ${recovery.id} action is invalid.`);
      }
      if (recovery.targetSerial !== undefined) parseDeviceSerial(recovery.targetSerial);
      requireText(recovery.reason, `recovery ${recovery.id} reason`);
      if (!Number.isFinite(recovery.deadlineRealtimeMs) || recovery.deadlineRealtimeMs < 0) {
        throw new TypeError(`Recovery ${recovery.id} deadline is invalid.`);
      }
      if (!isRecoveryState(recovery.status))
        throw new TypeError(`Recovery ${recovery.id} state is invalid.`);
      requireText(recovery.startedAt, `recovery ${recovery.id} startedAt`);
      if (recovery.completedAt !== undefined)
        requireText(recovery.completedAt, "recovery.completedAt");
      if (recovery.errorMessage !== undefined)
        requireText(recovery.errorMessage, "recovery.errorMessage");
      return {
        id: recovery.id,
        incidentId: recovery.incidentId,
        action: recovery.action,
        ...(recovery.targetSerial === undefined
          ? {}
          : { targetSerial: parseDeviceSerial(recovery.targetSerial) }),
        reason: recovery.reason,
        deadlineRealtimeMs: recovery.deadlineRealtimeMs,
        status: recovery.status,
        startedAt: recovery.startedAt,
        ...(recovery.completedAt === undefined ? {} : { completedAt: recovery.completedAt }),
        ...(recovery.errorMessage === undefined ? {} : { errorMessage: recovery.errorMessage }),
      };
    })
    .sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id),
    );
}

function normalizeDetails(
  details: Readonly<Record<string, string>>,
  field: string,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(details).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    requireText(key, `${field} key`);
    normalized[key] = requireText(value, `${field}.${key}`);
  }
  return normalized;
}

function requireText(value: string, field: string): string {
  if (value.trim().length === 0) throw new TypeError(`${field} is required.`);
  return value;
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be positive.`);
}

function isReportRunState(value: string): value is ReportRunState {
  return value === "FINISHED" || value === "FAILED" || value === "INTERRUPTED";
}

function isMembershipState(value: string): value is ReportMembershipState {
  return (
    value === "ACTIVE" || value === "QUARANTINED" || value === "RECOVERING" || value === "LEFT"
  );
}

function isActionState(value: string): value is ReportActionState {
  return [
    "QUEUED",
    "LEASED",
    "DISPATCHING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "UNKNOWN",
  ].includes(value);
}

function isTargetState(value: string): value is ReportTargetState {
  return ["QUEUED", "DISPATCHING", "SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"].includes(value);
}

function isEvidenceState(value: string): value is ReportEvidenceState {
  return value === "PENDING" || value === "READY" || value === "FAILED" || value === "MISSING";
}

function isEvidenceKind(value: string): value is ReportEvidenceKind {
  return [
    "ACTION_LOG",
    "LOGCAT_SEGMENT",
    "RUN_EVENT",
    "SCREENSHOT",
    "TIMING",
    "VIDEO",
    "CURRENT_SCREENSHOT",
    "FOREGROUND_PROCESS",
    "REDACTED_LOGCAT",
    "MAPPED_INPUT",
    "APPIUM_TIMING",
    "BRIDGE_STATE",
    "BRIDGE_ARM",
    "BRIDGE_ACK",
    "BUFFERED_LOGCAT",
  ].includes(value);
}

function isIncidentCategory(value: string): value is ReportIncidentCategory {
  return [
    "ADB_DISCONNECTED",
    "APPIUM_SESSION_LOST",
    "APP_CRASH_OR_ANR",
    "WRONG_FOREGROUND",
    "BRIDGE_TIMEOUT",
    "BRIDGE_STATE_MISMATCH",
    "TEXT_FOCUS_MISMATCH",
    "METRICS_CHANGED",
    "LOW_DISK",
  ].includes(value);
}

function isRecoveryState(value: string): value is ReportRecoveryState {
  return value === "STARTED" || value === "SUCCEEDED" || value === "FAILED";
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
