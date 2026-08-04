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
