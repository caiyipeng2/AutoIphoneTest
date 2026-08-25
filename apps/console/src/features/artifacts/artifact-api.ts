export interface SourceArtifactRecord {
  id: string;
  kind: "APK" | "AAB";
  sha256: string;
  sizeBytes: number;
  storedPath: string;
  originalName: string;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  signerSha256?: string;
  createdAt: string;
}

export interface InstalledArtifactRecord {
  id: string;
  kind: "INSTALLED";
  deviceSerial: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  signerSha256: string;
  installedSetSha256: string;
  observedAt: string;
  createdAt: string;
}

export type ArtifactRecord = SourceArtifactRecord | InstalledArtifactRecord;

export interface ArtifactsSnapshot {
  schemaVersion: 1;
  artifacts: ArtifactRecord[];
}

export interface ArtifactImportResponse {
  schemaVersion: 1;
  state: "CREATED" | "DEDUPLICATED";
  buildId: string;
  artifact: {
    artifactId: string;
    kind: "APK" | "AAB";
    sha256: string;
    packageName?: string;
    versionName?: string;
    versionCode?: number;
    publishState: "CREATED" | "DEDUPLICATED";
  };
  events?: BuildEventRecord[];
}

export interface BuildProviderRecord {
  id: string;
  default: boolean;
}

export interface BuildProvidersSnapshot {
  schemaVersion: 1;
  providers: BuildProviderRecord[];
}

export interface BuildEventRecord {
  buildId: string;
  phase: "validate" | "build" | "hash" | "parse" | "publish";
  status: "completed" | "failed";
  at: string;
  message?: string;
  sha256?: string;
  sizeBytes?: number;
  artifactId?: string;
  publishState?: "CREATED" | "DEDUPLICATED";
}

export interface BuildValidationIssueRecord {
  code: string;
  message: string;
}

export interface BuildValidationResponse {
  schemaVersion: 1;
  providerId: string;
  valid: boolean;
  errors: BuildValidationIssueRecord[];
}

export interface InstalledRegistrationResponse {
  schemaVersion: 1;
  state: "CREATED" | "DEDUPLICATED";
  artifact: InstalledArtifactRecord;
}

export async function fetchArtifacts(
  options: { kind?: ArtifactRecord["kind"]; query?: string; signal?: AbortSignal } = {},
): Promise<ArtifactsSnapshot> {
  const params = new URLSearchParams();
  if (options.kind !== undefined) params.set("kind", options.kind);
  if (options.query !== undefined && options.query.trim() !== "") params.set("q", options.query);
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  const response = await fetch(
    `/api/artifacts${suffix}`,
    options.signal ? { signal: options.signal } : undefined,
  );
  if (!response.ok) throw await apiError(response, "artifacts");
  return (await response.json()) as ArtifactsSnapshot;
}

export async function fetchBuildProviders(signal?: AbortSignal): Promise<BuildProvidersSnapshot> {
  const response = await fetch(
    "/api/artifacts/providers",
    signal === undefined ? undefined : { signal },
  );
  if (!response.ok) throw await apiError(response, "artifact-providers");
  const payload = (await response.json()) as Partial<BuildProvidersSnapshot>;
  return {
    schemaVersion: 1,
    providers: Array.isArray(payload.providers) ? payload.providers : [],
  };
}

export async function importArtifact(
  file: File,
  kind: "APK" | "AAB",
  importSource: string,
  signal?: AbortSignal,
): Promise<ArtifactImportResponse> {
  const form = new FormData();
  form.append("kind", kind);
  if (importSource.trim() !== "") form.append("importSource", importSource.trim());
  form.append("file", file, file.name);
  const response = await fetch("/api/artifacts/import", {
    method: "POST",
    headers: csrfHeaders(),
    body: form,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await apiError(response, "artifact-import");
  return (await response.json()) as ArtifactImportResponse;
}

export async function buildArtifact(
  input: {
    providerId: string;
    kind: "APK" | "AAB";
    artifactPath: string;
    importSource: string;
    originalName: string;
  },
  signal?: AbortSignal,
): Promise<ArtifactImportResponse> {
  const response = await fetch("/api/artifacts/build", {
    method: "POST",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(input),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await apiError(response, "artifact-build");
  return (await response.json()) as ArtifactImportResponse;
}

export async function validateBuildArtifact(
  input: {
    providerId: string;
    kind: "APK" | "AAB";
    artifactPath: string;
    importSource: string;
    originalName: string;
  },
  signal?: AbortSignal,
): Promise<BuildValidationResponse> {
  const response = await fetch("/api/artifacts/build/validate", {
    method: "POST",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(input),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await apiError(response, "artifact-build-validate");
  return (await response.json()) as BuildValidationResponse;
}

export async function registerInstalledArtifact(
  deviceSerial: string,
  packageName: string,
): Promise<InstalledRegistrationResponse> {
  const response = await fetch("/api/artifacts/installed", {
    method: "POST",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ deviceSerial, packageName }),
  });
  if (!response.ok) throw await apiError(response, "artifact-installed");
  return (await response.json()) as InstalledRegistrationResponse;
}

function csrfHeaders(): Record<string, string> {
  const token = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("tc_csrf="))
    ?.slice("tc_csrf=".length);
  return token === undefined ? {} : { "x-test-center-csrf": decodeURIComponent(token) };
}

async function apiError(response: Response, prefix: string): Promise<Error> {
  const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return new Error(
    `${prefix}:${response.status}${body?.error === undefined ? "" : ` ${body.error}`}`,
  );
}
