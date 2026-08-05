import type { BootstrapSessionStore } from "@test-center/security/bootstrap-session";
import type { DeviceRegistry } from "@test-center/devices";
import type { ArtifactRouteService } from "./artifacts.js";

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
  readonly artifacts?: ArtifactRouteService;
}
