export interface HealthSnapshot {
  schemaVersion: 1;
  service: { state: "STARTING" | "READY" | "DEGRADED" | "STOPPING" };
  environment: { overall: "healthy" | "degraded" | "danger" | "unknown"; generatedAt: string };
  updatedAt: string;
}

export interface SettingsSnapshot {
  version: number;
  values: Record<string, unknown>;
}

export type StorageOverviewPressure = "NORMAL" | "WARNING" | "BLOCKED";

export interface StorageOverviewSnapshot {
  measuredAt: string;
  pressure: StorageOverviewPressure;
  freeBytes?: number;
  warningBytes: number;
  dangerBytes: number;
  writeRateBytesPerSecond: number;
  estimatedSecondsUntilBlocked?: number;
  activeRunCount: number;
  sourceError?: "FREE_SPACE_UNAVAILABLE";
}

export interface StorageOverviewResponse {
  schemaVersion: 1;
  overview: StorageOverviewSnapshot;
}

export type CleanupPreviewState =
  "FINISHED" | "FAILED" | "INTERRUPTED" | "COMPLETED" | "FINALIZATION_FAILED" | "ABORTED";

export interface CleanupPreviewCandidate {
  runId: string;
  state: CleanupPreviewState;
  completedAt: string;
  estimatedBytes: number;
}

export interface CleanupPreviewResponse {
  schemaVersion: 1;
  retentionDays: number;
  preview: {
    cutoffAt: string;
    candidates: CleanupPreviewCandidate[];
    totalEstimatedBytes: number;
  };
}

export interface CleanupConfirmation {
  nonce: string;
  expiresAt: string;
}

export interface CleanupExecutionResult {
  cleanupId: string;
  state: "DELETED" | "RECOVERY_REQUIRED";
  moved: Array<{ runId: string; sourcePath: string; trashPath: string }>;
  deleted: string[];
  restored: string[];
  unresolved: string[];
  errorMessage?: string;
}

export type CleanupAuditEventKind =
  "STARTED" | "RUN_MOVED" | "RUN_RESTORED" | "MOVE_FAILED" | "COMPLETED" | "ROLLED_BACK";

export interface CleanupAuditEvent {
  sequence: number;
  cleanupId: string;
  kind: CleanupAuditEventKind;
  runId?: string;
  sourcePath?: string;
  trashPath?: string;
  errorMessage?: string;
  createdAt: string;
}

export type DeviceState = "ONLINE" | "UNAUTHORIZED" | "OFFLINE" | "UNKNOWN";
export interface DeviceRecord {
  serial: string;
  state: DeviceState;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  connectionSeq: number;
  tags: Array<{ key: string; label: string }>;
  group?: { key: string; label: string };
}

export interface DevicesSnapshot {
  schemaVersion: 1;
  devices: DeviceRecord[];
}

export type SessionState =
  "CREATED" | "PREFLIGHT" | "RUNNING" | "PAUSED" | "FINISHED" | "INTERRUPTED" | "FAILED";

export interface SessionDevice {
  serial: string;
  role: "LEADER" | "FOLLOWER";
  membershipState: "ACTIVE" | "QUARANTINED" | "RECOVERING" | "LEFT";
  epoch: number;
  generation: number;
}

export interface SessionView {
  id: string;
  clientRequestId: string;
  packageName: string;
  state: SessionState;
  currentEpoch: number;
  leaderVideoEnabled: boolean;
  failurePolicy: "PAUSE_ALL" | "QUARANTINE_FAILED_DEVICE";
  leader: SessionDevice & { role: "LEADER" };
  devices: SessionDevice[];
}

export interface SessionMutationResponse {
  schemaVersion: 1;
  state: "CREATED" | "DEDUPLICATED";
  session: SessionView;
}

export type IncidentCategory =
  | "ADB_DISCONNECTED"
  | "APPIUM_SESSION_LOST"
  | "APP_CRASH_OR_ANR"
  | "WRONG_FOREGROUND"
  | "BRIDGE_TIMEOUT"
  | "BRIDGE_STATE_MISMATCH"
  | "TEXT_FOCUS_MISMATCH"
  | "METRICS_CHANGED"
  | "LOW_DISK";

export interface IncidentRecord {
  schemaVersion: 1;
  incidentId: string;
  runId: string;
  serial?: string;
  category: IncidentCategory;
  generation?: number;
  detectedAtRealtimeMs: number;
  detectedAt: string;
  source: string;
  evidenceRef?: string;
  details: Record<string, string>;
}

export interface RecoveryRecord {
  id: string;
  incidentId: string;
  runId: string;
  action: "PAUSE_ALL" | "QUARANTINE_DEVICE";
  targetSerial?: string;
  reason: string;
  deadlineRealtimeMs: number;
  status: "STARTED" | "SUCCEEDED" | "FAILED";
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface IncidentTimeline {
  runId: string;
  incidents: IncidentRecord[];
  recoveries: RecoveryRecord[];
}

export type ReportRunState = "FINISHED" | "FAILED" | "INTERRUPTED";
export type ReportExportFormat = "HTML" | "ZIP";
export type ReportExportState = "PENDING" | "READY" | "FAILED" | "MISSING";
export type ReportFinalizationState =
  "FINALIZING" | "COMPLETED" | "FINALIZATION_FAILED" | "ABORTED" | "INTERRUPTED";

export interface ReportHistoryDevice {
  serial: string;
  role: "LEADER" | "FOLLOWER";
  uid?: string;
}

export interface ReportExportRecord {
  id: string;
  runId: string;
  format: ReportExportFormat;
  state: ReportExportState;
  tempRelativePath?: string;
  finalRelativePath?: string;
  sha256?: string;
  sizeBytes?: number;
  errorCategory?: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReportFinalizationRecord {
  runId: string;
  state: ReportFinalizationState;
  attempt: number;
  errorCategory?: string;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
}

export interface ReportHistoryItem {
  runId: string;
  packageName: string;
  state: ReportRunState;
  currentEpoch: number;
  createdAt: string;
  updatedAt: string;
  devices: ReportHistoryDevice[];
  exports: ReportExportRecord[];
  finalization?: ReportFinalizationRecord;
}

export interface ResultsResponse {
  schemaVersion: 1;
  results: ReportHistoryItem[];
}

export interface ResultDetailResponse {
  schemaVersion: 1;
  result: ReportHistoryItem;
}

export type BridgeHealthStatus = "READY" | "DEGRADED" | "UNAVAILABLE";
export interface UidSnapshot {
  installation: {
    serial: string;
    packageName: string;
    installGeneration: number;
    appDataGeneration: number;
    currentUid: string | null;
    updatedAt: string;
  };
  uid: {
    uid: string;
    source: "BRIDGE_AUTO" | "MANUAL" | "UNKNOWN";
    actor: string;
    buildId: string;
    installGeneration: number;
    appDataGeneration: number;
    observedAt: string;
  } | null;
  bridge: {
    status: BridgeHealthStatus;
    bridgeInstanceId?: string;
    bootId?: string;
    buildId?: string;
    stateSeq?: number;
    lastStateAt?: string;
    reason?: string;
  };
}

export const demoHealth: HealthSnapshot = {
  schemaVersion: 1,
  service: { state: "READY" },
  environment: { overall: "healthy", generatedAt: new Date().toISOString() },
  updatedAt: new Date().toISOString(),
};

export async function fetchHealth(signal?: AbortSignal): Promise<HealthSnapshot> {
  const response = await fetch("/api/health", signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`health:${response.status}`);
  return (await response.json()) as HealthSnapshot;
}

export async function fetchSettings(signal?: AbortSignal): Promise<SettingsSnapshot> {
  const response = await fetch("/api/settings", signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`settings:${response.status}`);
  return (await response.json()) as SettingsSnapshot;
}

export async function fetchStorageOverview(signal?: AbortSignal): Promise<StorageOverviewSnapshot> {
  const response = await fetch("/api/storage/overview", signal ? { signal } : undefined);
  const payload = (await response.json()) as Partial<StorageOverviewResponse> & { error?: string };
  if (!response.ok || payload.overview === undefined) {
    throw new Error(payload.error ?? `storage-overview:${response.status}`);
  }
  return payload.overview;
}

export async function patchSettings(
  patch: Record<string, unknown>,
  expectedVersion: number,
): Promise<SettingsSnapshot> {
  const csrf = readCsrfToken();
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": `"${expectedVersion}"`,
      ...(csrf === undefined ? {} : { "x-test-center-csrf": csrf }),
    },
    body: JSON.stringify(patch),
  });
  const payload = (await response.json()) as SettingsSnapshot & { error?: string };
  if (!response.ok || payload.version === undefined) {
    throw new Error(payload.error ?? `settings:${response.status}`);
  }
  return payload;
}

export async function fetchCleanupPreview(
  retentionDays: number,
  signal?: AbortSignal,
): Promise<CleanupPreviewResponse> {
  const response = await fetch(
    `/api/cleanup/preview?retentionDays=${encodeURIComponent(String(retentionDays))}`,
    signal ? { signal } : undefined,
  );
  const payload = (await response.json()) as CleanupPreviewResponse & { error?: string };
  if (!response.ok || payload.preview === undefined) {
    throw new Error(payload.error ?? `cleanup-preview:${response.status}`);
  }
  return payload;
}

export async function issueCleanupConfirmation(
  runIds: string[],
  expectedBytes: number,
): Promise<CleanupConfirmation> {
  const csrfToken = readCsrfToken();
  const response = await fetch("/api/cleanup/confirmations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(csrfToken === undefined ? {} : { "x-test-center-csrf": csrfToken }),
    },
    body: JSON.stringify({ runIds, expectedBytes }),
  });
  const payload = (await response.json()) as {
    confirmation?: CleanupConfirmation;
    error?: string;
  };
  if (!response.ok || payload.confirmation === undefined) {
    throw new Error(payload.error ?? `cleanup-confirmation:${response.status}`);
  }
  return payload.confirmation;
}

export async function executeCleanup(input: {
  cleanupId: string;
  nonce: string;
  runIds: string[];
  expectedBytes: number;
}): Promise<CleanupExecutionResult> {
  const csrfToken = readCsrfToken();
  const response = await fetch("/api/cleanup/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(csrfToken === undefined ? {} : { "x-test-center-csrf": csrfToken }),
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { result?: CleanupExecutionResult; error?: string };
  if (!response.ok || payload.result === undefined) {
    throw new Error(payload.error ?? `cleanup-execute:${response.status}`);
  }
  return payload.result;
}

export async function fetchCleanupEvents(cleanupId: string): Promise<{
  cleanupId: string;
  events: CleanupAuditEvent[];
}> {
  const response = await fetch(`/api/cleanup/${encodeURIComponent(cleanupId)}/events`, undefined);
  const payload = (await response.json()) as {
    cleanupId?: string;
    events?: CleanupAuditEvent[];
    error?: string;
  };
  if (!response.ok || payload.cleanupId === undefined || !Array.isArray(payload.events)) {
    throw new Error(payload.error ?? `cleanup-events:${response.status}`);
  }
  return { cleanupId: payload.cleanupId, events: payload.events };
}

export async function fetchDevices(signal?: AbortSignal): Promise<DevicesSnapshot> {
  const response = await fetch("/api/devices", signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`devices:${response.status}`);
  return (await response.json()) as DevicesSnapshot;
}

export async function createSession(input: {
  clientRequestId: string;
  packageName: string;
  deviceSerials: string[];
  leaderVideoEnabled: boolean;
  failurePolicy?: "PAUSE_ALL" | "QUARANTINE_FAILED_DEVICE";
}): Promise<SessionMutationResponse> {
  return await sessionMutation("/api/sessions", input);
}

export async function fetchSession(id: string, signal?: AbortSignal): Promise<SessionView> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(id)}`,
    signal ? { signal } : undefined,
  );
  const body = (await response.json()) as { session?: SessionView; error?: string };
  if (!response.ok || body.session === undefined) {
    throw new Error(body.error ?? `session:${response.status}`);
  }
  return body.session;
}

export async function fetchIncidentTimeline(
  id: string,
  signal?: AbortSignal,
): Promise<IncidentTimeline> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(id)}/incidents`,
    signal ? { signal } : undefined,
  );
  const body = (await response.json()) as { timeline?: IncidentTimeline; error?: string };
  if (!response.ok || body.timeline === undefined) {
    throw new Error(body.error ?? `incidents:${response.status}`);
  }
  return body.timeline;
}

export async function fetchResults(
  filter: { state?: ReportRunState; serial?: string; uid?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ReportHistoryItem[]> {
  const params = new URLSearchParams();
  if (filter.state !== undefined) params.set("state", filter.state);
  if (filter.serial !== undefined && filter.serial.trim() !== "") {
    params.set("serial", filter.serial.trim());
  }
  if (filter.uid !== undefined && filter.uid.trim() !== "") {
    params.set("uid", filter.uid.trim());
  }
  params.set("limit", String(filter.limit ?? 50));
  const response = await fetch(
    `/api/results?${params.toString()}`,
    signal ? { signal } : undefined,
  );
  const body = (await response.json()) as Partial<ResultsResponse> & { error?: string };
  if (!response.ok || !Array.isArray(body.results)) {
    throw new Error(body.error ?? `results:${response.status}`);
  }
  return body.results;
}

export async function fetchResultDetail(
  runId: string,
  signal?: AbortSignal,
): Promise<ReportHistoryItem> {
  const response = await fetch(
    `/api/results/${encodeURIComponent(runId)}`,
    signal ? { signal } : undefined,
  );
  const body = (await response.json()) as Partial<ResultDetailResponse> & { error?: string };
  if (!response.ok || body.result === undefined) {
    throw new Error(body.error ?? `result:${response.status}`);
  }
  return body.result;
}

export async function retryResultFinalization(
  runId: string,
  idempotencyKey: string,
): Promise<ReportHistoryItem> {
  const csrf = readCsrfToken();
  const response = await fetch(`/api/results/${encodeURIComponent(runId)}/retry-finalization`, {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      ...(csrf === undefined ? {} : { "x-test-center-csrf": csrf }),
    },
  });
  const body = (await response.json()) as Partial<ResultDetailResponse> & { error?: string };
  if (!response.ok || body.result === undefined) {
    throw new Error(body.error ?? `result-retry:${response.status}`);
  }
  return body.result;
}

export async function preflightSession(id: string): Promise<SessionView> {
  return await sessionPhase(id, "preflight");
}

export async function startSession(id: string): Promise<SessionView> {
  return await sessionPhase(id, "start");
}

export async function fetchDeviceBridge(
  serial: string,
  packageName: string,
  signal?: AbortSignal,
): Promise<UidSnapshot> {
  const response = await fetch(
    `/api/devices/${encodeURIComponent(serial)}/bridge?packageName=${encodeURIComponent(packageName)}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw new Error(`device-bridge:${response.status}`);
  return (await response.json()) as UidSnapshot;
}

export async function issueUidConfirmation(serial: string, packageName: string): Promise<string> {
  const csrf = readCsrfToken();
  const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/uid/confirmations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(csrf === undefined ? {} : { "x-test-center-csrf": csrf }),
    },
    body: JSON.stringify({ packageName }),
  });
  if (!response.ok) throw new Error(`uid-confirmation:${response.status}`);
  return ((await response.json()) as { nonce: string }).nonce;
}

export async function updateManualUid(
  serial: string,
  packageName: string,
  uid: string,
  confirmationNonce: string,
): Promise<UidSnapshot> {
  const csrf = readCsrfToken();
  const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/uid`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(csrf === undefined ? {} : { "x-test-center-csrf": csrf }),
    },
    body: JSON.stringify({ packageName, uid, confirmationNonce }),
  });
  if (!response.ok) throw new Error(`uid-update:${response.status}`);
  return (await response.json()) as UidSnapshot;
}

export async function updateDeviceTags(
  serial: string,
  tags: string[],
  group: string,
): Promise<DeviceRecord> {
  const csrf = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("tc_csrf="))
    ?.slice("tc_csrf=".length);
  const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/tags`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(csrf === undefined ? {} : { "x-test-center-csrf": decodeURIComponent(csrf) }),
    },
    body: JSON.stringify({ tags, ...(group.trim() === "" ? {} : { group: group.trim() }) }),
  });
  if (!response.ok) throw new Error(`device-tags:${response.status}`);
  return ((await response.json()) as { device: DeviceRecord }).device;
}

export function exchangeBootstrapCode(code: string): Promise<Response> {
  return fetch("/api/bootstrap/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

function readCsrfToken(): string | undefined {
  const value = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("tc_csrf="))
    ?.slice("tc_csrf=".length);
  return value === undefined ? undefined : decodeURIComponent(value);
}

async function sessionMutation(
  url: string,
  body: Record<string, unknown>,
): Promise<SessionMutationResponse> {
  const csrf = readCsrfToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(csrf === undefined ? {} : { "x-test-center-csrf": csrf }),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Partial<SessionMutationResponse> & { error?: string };
  if (!response.ok || payload.session === undefined || payload.state === undefined) {
    throw new Error(payload.error ?? `session:${response.status}`);
  }
  return payload as SessionMutationResponse;
}

async function sessionPhase(id: string, phase: "preflight" | "start"): Promise<SessionView> {
  const csrf = readCsrfToken();
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/${phase}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(csrf === undefined ? {} : { "x-test-center-csrf": csrf }),
    },
  });
  const payload = (await response.json()) as { session?: SessionView; error?: string };
  if (!response.ok || payload.session === undefined) {
    throw new Error(payload.error ?? `session-${phase}:${response.status}`);
  }
  return payload.session;
}
