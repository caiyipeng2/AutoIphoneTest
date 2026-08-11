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
  leader: SessionDevice & { role: "LEADER" };
  devices: SessionDevice[];
}

export interface SessionMutationResponse {
  schemaVersion: 1;
  state: "CREATED" | "DEDUPLICATED";
  session: SessionView;
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
