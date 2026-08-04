import type { BootstrapSessionStore } from "@test-center/security/bootstrap-session";

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
}
