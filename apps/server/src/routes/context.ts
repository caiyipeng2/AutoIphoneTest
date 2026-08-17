import type { BootstrapSessionStore } from "@test-center/security/bootstrap-session";
import type { DeviceRegistry, UidService } from "@test-center/devices";
import type { ArtifactRouteService } from "./artifacts.js";
import type { DeploymentRouteService } from "./deployments.js";
import type { ViewProvider } from "@test-center/video";
import type { SessionRouteService } from "./sessions.js";
import type { IncidentRouteService } from "./incidents.js";
import type { ResultsRouteService } from "./results.js";

export interface ServerSession {
  readonly csrfToken: string;
  readonly createdAt: number;
}

export interface SettingsState {
  version: number;
  readonly values: Record<string, unknown>;
}

export interface ServerContext {
  readonly port: number;
  readonly bootstrapStore: BootstrapSessionStore;
  readonly sessions: Map<string, ServerSession>;
  readonly settings: SettingsState;
  readonly devices?: DeviceRegistry;
  readonly uids?: UidService;
  readonly artifacts?: ArtifactRouteService;
  readonly deployments?: DeploymentRouteService;
  readonly views?: ReadonlyMap<string, ViewProvider>;
  readonly sessionService?: SessionRouteService;
  readonly incidentService?: IncidentRouteService;
  readonly resultsService?: ResultsRouteService;
  readonly resultsExportRoot?: string;
}
