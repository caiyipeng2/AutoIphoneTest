import { createHash } from "node:crypto";

import Database from "better-sqlite3";

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export interface MigrationResult {
  readonly applied: readonly string[];
}

export const FOUNDATION_MIGRATION: Migration = {
  id: "0001_foundation",
  sql: `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS launcher_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  secret_hash TEXT NOT NULL,
  bootstrap_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`.trim(),
};

export const DEVICES_MIGRATION: Migration = {
  id: "0002_devices",
  sql: `
CREATE TABLE IF NOT EXISTS devices (
  serial TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ONLINE', 'UNAUTHORIZED', 'OFFLINE', 'UNKNOWN')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  connection_seq INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT NOT NULL REFERENCES devices(serial) ON DELETE CASCADE,
  connection_seq INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ONLINE', 'UNAUTHORIZED', 'OFFLINE', 'UNKNOWN')),
  observed_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_devices_state_last_seen ON devices(state, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_device_connections_serial_observed ON device_connections(serial, observed_at);

CREATE TABLE IF NOT EXISTS device_tags (
  serial TEXT NOT NULL REFERENCES devices(serial) ON DELETE CASCADE,
  tag_key TEXT NOT NULL,
  tag_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (serial, tag_key)
);

CREATE TABLE IF NOT EXISTS device_groups (
  serial TEXT PRIMARY KEY NOT NULL REFERENCES devices(serial) ON DELETE CASCADE,
  group_key TEXT NOT NULL,
  group_label TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`.trim(),
};

export const ARTIFACTS_MIGRATION: Migration = {
  id: "0003_artifacts",
  sql: `
CREATE TABLE IF NOT EXISTS artifact_contents (
  sha256 TEXT PRIMARY KEY NOT NULL,
  size_bytes INTEGER NOT NULL,
  stored_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('APK', 'AAB', 'INSTALLED')),
  sha256 TEXT REFERENCES artifact_contents(sha256),
  device_serial TEXT,
  package_name TEXT,
  version_name TEXT,
  version_code INTEGER,
  signer_sha256 TEXT,
  installed_set_sha256 TEXT,
  observed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK ((kind IN ('APK', 'AAB') AND sha256 IS NOT NULL AND device_serial IS NULL)
    OR (kind = 'INSTALLED' AND sha256 IS NULL AND device_serial IS NOT NULL AND observed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_source_hash ON artifacts(kind, sha256) WHERE sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_installed_identity
  ON artifacts(device_serial, package_name, version_code, signer_sha256, installed_set_sha256)
  WHERE kind = 'INSTALLED';

CREATE TABLE IF NOT EXISTS artifact_import_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  original_name TEXT,
  sha256 TEXT,
  state TEXT NOT NULL CHECK (state IN ('STAGED', 'PUBLISHED', 'DEDUPLICATED', 'FAILED')),
  error_message TEXT,
  created_at TEXT NOT NULL
);
`.trim(),
};

export const DEPLOYMENTS_MIGRATION: Migration = {
  id: "0004_deployments",
  sql: `
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY NOT NULL,
  artifact_id TEXT REFERENCES artifacts(id),
  package_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'PRECHECK', 'PREPARE', 'INSTALL', 'VERIFY', 'LAUNCH', 'COMPLETED', 'FAILED', 'CANCELLED')),
  current_step TEXT CHECK (current_step IS NULL OR current_step IN ('PRECHECK', 'PREPARE', 'INSTALL', 'VERIFY', 'LAUNCH')),
  failed_step TEXT CHECK (failed_step IS NULL OR failed_step IN ('PRECHECK', 'PREPARE', 'INSTALL', 'VERIFY', 'LAUNCH')),
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_devices (
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  serial TEXT NOT NULL REFERENCES devices(serial),
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'PRECHECK', 'PREPARE', 'INSTALL', 'VERIFY', 'LAUNCH', 'COMPLETED', 'FAILED', 'CANCELLED')),
  install_generation INTEGER,
  app_data_generation INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deployment_id, serial)
);

CREATE TABLE IF NOT EXISTS deployment_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  serial TEXT NOT NULL REFERENCES devices(serial),
  step_kind TEXT NOT NULL CHECK (step_kind IN ('PRECHECK', 'PREPARE', 'INSTALL', 'VERIFY', 'LAUNCH')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  parent_attempt_id INTEGER REFERENCES deployment_steps(id),
  state TEXT NOT NULL CHECK (state IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  error_category TEXT,
  log_path TEXT,
  evidence_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_deployment_steps_lookup ON deployment_steps(deployment_id, serial, step_kind, attempt_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_steps_attempt
  ON deployment_steps(deployment_id, serial, step_kind, attempt_number);

CREATE TABLE IF NOT EXISTS device_app_installations (
  serial TEXT NOT NULL,
  package_name TEXT NOT NULL,
  install_generation INTEGER NOT NULL DEFAULT 1 CHECK (install_generation > 0),
  app_data_generation INTEGER NOT NULL DEFAULT 1 CHECK (app_data_generation > 0),
  last_mutation_id TEXT,
  last_mutation_kind TEXT CHECK (last_mutation_kind IS NULL OR last_mutation_kind IN ('CLEAR_DATA', 'UNINSTALL_REINSTALL')),
  last_mutation_status TEXT CHECK (last_mutation_status IS NULL OR last_mutation_status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  last_mutation_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (serial, package_name)
);

CREATE TABLE IF NOT EXISTS device_uids (
  serial TEXT NOT NULL,
  package_name TEXT NOT NULL,
  current_uid TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (serial, package_name)
);
`.trim(),
};

export const INSTALL_SETS_MIGRATION: Migration = {
  id: "0005_install_sets",
  sql: `
CREATE TABLE IF NOT EXISTS install_sets (
  id TEXT PRIMARY KEY NOT NULL,
  cache_key TEXT NOT NULL UNIQUE,
  bundle_sha256 TEXT NOT NULL,
  signer_sha256 TEXT NOT NULL,
  bundletool_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('DEVICE_SPECIFIC')),
  device_spec_sha256 TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_install_sets_device_spec ON install_sets(device_spec_sha256, created_at);
`.trim(),
};

export const DEPLOYMENT_CONTROLS_MIGRATION: Migration = {
  id: "0006_deployment_controls",
  sql: `
ALTER TABLE deployments ADD COLUMN client_request_id TEXT;
ALTER TABLE deployments ADD COLUMN mutation_kind TEXT NOT NULL DEFAULT 'NONE'
  CHECK (mutation_kind IN ('NONE', 'CLEAR_DATA', 'UNINSTALL_REINSTALL'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_client_request
  ON deployments(client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS destructive_confirmations (
  nonce_hash TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('CLEAR_DATA', 'UNINSTALL_REINSTALL')),
  artifact_id TEXT NOT NULL,
  device_serial TEXT NOT NULL REFERENCES devices(serial),
  package_name TEXT NOT NULL,
  install_generation INTEGER NOT NULL CHECK (install_generation > 0),
  app_data_generation INTEGER NOT NULL CHECK (app_data_generation > 0),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_destructive_confirmations_expiry ON destructive_confirmations(expires_at);
`.trim(),
};

export const UID_BRIDGE_MIGRATION: Migration = {
  id: "0007_uid_bridge_observations",
  sql: `
CREATE TABLE IF NOT EXISTS device_uid_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT NOT NULL,
  package_name TEXT NOT NULL,
  install_generation INTEGER NOT NULL CHECK (install_generation > 0),
  app_data_generation INTEGER NOT NULL CHECK (app_data_generation > 0),
  uid TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('BRIDGE_AUTO', 'MANUAL')),
  actor TEXT NOT NULL,
  build_id TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_uid_observations_current
  ON device_uid_observations(serial, package_name, install_generation, app_data_generation, observed_at DESC);
`.trim(),
};

export const RUN_ACTIONS_MIGRATION: Migration = {
  id: "0008_runs_actions",
  sql: `
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY NOT NULL,
  package_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CREATED', 'PREFLIGHT', 'RUNNING', 'PAUSED', 'FINISHED', 'INTERRUPTED', 'FAILED')),
  current_epoch INTEGER NOT NULL CHECK (current_epoch > 0),
  run_nonce_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_devices (
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  serial TEXT NOT NULL REFERENCES devices(serial),
  role TEXT NOT NULL CHECK (role IN ('LEADER', 'FOLLOWER')),
  membership_state TEXT NOT NULL CHECK (membership_state IN ('ACTIVE', 'QUARANTINED', 'RECOVERING', 'LEFT')),
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  generation INTEGER NOT NULL CHECK (generation > 0),
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, serial, epoch)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_devices_active_leader
  ON run_devices(run_id, epoch)
  WHERE role = 'LEADER' AND membership_state IN ('ACTIVE', 'RECOVERING');

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  action_seq INTEGER NOT NULL CHECK (action_seq > 0),
  client_request_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('tap', 'swipe')),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'LEASED', 'DISPATCHING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')),
  metrics_epoch INTEGER NOT NULL CHECK (metrics_epoch >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, action_seq),
  UNIQUE (run_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS action_targets (
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  serial TEXT NOT NULL REFERENCES devices(serial),
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'DISPATCHING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (action_id, serial)
);

CREATE TABLE IF NOT EXISTS action_outbox (
  action_id TEXT PRIMARY KEY NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'LEASED', 'DISPATCHING', 'ACKED', 'CANCELLED')),
  lease_token TEXT,
  leased_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_action_results (
  action_id TEXT NOT NULL,
  serial TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (action_id, serial),
  FOREIGN KEY (action_id, serial) REFERENCES action_targets(action_id, serial) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actions_run_state ON actions(run_id, state, action_seq);
CREATE INDEX IF NOT EXISTS idx_action_targets_serial ON action_targets(serial, state);
CREATE INDEX IF NOT EXISTS idx_run_transitions_lookup ON run_transitions(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_action_transitions_lookup ON action_transitions(action_id, created_at);
`.trim(),
};

export const SESSION_API_MIGRATION: Migration = {
  id: "0009_session_api",
  sql: `
ALTER TABLE test_runs ADD COLUMN client_request_id TEXT;
ALTER TABLE test_runs ADD COLUMN leader_video_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (leader_video_enabled IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_runs_client_request
  ON test_runs(client_request_id) WHERE client_request_id IS NOT NULL;
`.trim(),
};

export const ACTION_COMMANDS_MIGRATION: Migration = {
  id: "0010_action_commands",
  sql: `ALTER TABLE actions ADD COLUMN command_json TEXT;`.trim(),
};

export const INCIDENTS_MIGRATION: Migration = {
  id: "0011_incidents_recovery",
  sql: `
CREATE TABLE IF NOT EXISTS incidents (
  incident_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  serial TEXT REFERENCES devices(serial),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  category TEXT NOT NULL CHECK (category IN (
    'ADB_DISCONNECTED', 'APPIUM_SESSION_LOST', 'APP_CRASH_OR_ANR', 'WRONG_FOREGROUND',
    'BRIDGE_TIMEOUT', 'BRIDGE_STATE_MISMATCH', 'TEXT_FOCUS_MISMATCH', 'METRICS_CHANGED', 'LOW_DISK'
  )),
  generation INTEGER CHECK (generation IS NULL OR generation > 0),
  detected_at_realtime_ms REAL NOT NULL CHECK (detected_at_realtime_ms >= 0),
  detected_at TEXT NOT NULL,
  source TEXT NOT NULL,
  evidence_ref TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_run_detected
  ON incidents(run_id, detected_at_realtime_ms, incident_id);

CREATE TABLE IF NOT EXISTS recovery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('PAUSE_ALL', 'QUARANTINE_DEVICE')),
  target_serial TEXT REFERENCES devices(serial),
  reason TEXT NOT NULL,
  deadline_realtime_ms REAL NOT NULL CHECK (deadline_realtime_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  CHECK ((status = 'STARTED' AND completed_at IS NULL) OR (status <> 'STARTED' AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_recovery_attempts_run_status
  ON recovery_attempts(run_id, status, started_at);
`.trim(),
};

export const RUN_MEMBERSHIP_MIGRATION: Migration = {
  id: "0012_run_membership_transitions",
  sql: `
CREATE TABLE IF NOT EXISTS run_device_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  serial TEXT NOT NULL REFERENCES devices(serial),
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  from_state TEXT NOT NULL CHECK (from_state IN ('ACTIVE', 'QUARANTINED', 'RECOVERING', 'LEFT')),
  to_state TEXT NOT NULL CHECK (to_state IN ('ACTIVE', 'QUARANTINED', 'RECOVERING', 'LEFT')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_device_transitions_lookup
  ON run_device_transitions(run_id, serial, created_at);
`.trim(),
};

export const RUN_FAILURE_POLICY_MIGRATION: Migration = {
  id: "0013_run_failure_policy",
  sql: `
ALTER TABLE test_runs ADD COLUMN failure_policy TEXT NOT NULL DEFAULT 'PAUSE_ALL'
  CHECK (failure_policy IN ('PAUSE_ALL', 'QUARANTINE_FAILED_DEVICE'));
`.trim(),
};

export const EVIDENCE_REPORTS_MIGRATION: Migration = {
  id: "0014_evidence_reports",
  sql: `
CREATE TABLE IF NOT EXISTS evidence_records (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  action_id TEXT REFERENCES actions(id) ON DELETE SET NULL,
  serial TEXT REFERENCES devices(serial),
  kind TEXT NOT NULL CHECK (kind IN (
    'ACTION_LOG', 'LOGCAT_SEGMENT', 'RUN_EVENT', 'SCREENSHOT', 'TIMING', 'VIDEO',
    'CURRENT_SCREENSHOT', 'FOREGROUND_PROCESS', 'REDACTED_LOGCAT', 'MAPPED_INPUT',
    'APPIUM_TIMING', 'BRIDGE_STATE', 'BRIDGE_ARM', 'BRIDGE_ACK', 'BUFFERED_LOGCAT'
  )),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'READY', 'FAILED', 'MISSING')),
  temp_relative_path TEXT,
  final_relative_path TEXT,
  sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  capture_error_category TEXT,
  unavailable_reason TEXT CHECK (unavailable_reason IS NULL OR unavailable_reason IN (
    'DEVICE_DISCONNECTED', 'PROCESS_ABSENT', 'SOURCE_NOT_APPLICABLE', 'CAPTURE_ERROR'
  )),
  captured_at TEXT,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_records_run_state
  ON evidence_records(run_id, state, created_at, id);
CREATE INDEX IF NOT EXISTS idx_evidence_records_pending
  ON evidence_records(state, updated_at, id) WHERE state = 'PENDING';

CREATE TABLE IF NOT EXISTS report_exports (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('HTML', 'ZIP')),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'READY', 'FAILED', 'MISSING')),
  temp_relative_path TEXT,
  final_relative_path TEXT,
  sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  error_category TEXT,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, format, attempt)
);

CREATE INDEX IF NOT EXISTS idx_report_exports_run_state
  ON report_exports(run_id, state, format, attempt);
CREATE INDEX IF NOT EXISTS idx_report_exports_pending
  ON report_exports(state, updated_at, id) WHERE state = 'PENDING';
`.trim(),
};

export function configureDatabase(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
}

export function migrate(
  database: Database.Database,
  migrations: readonly Migration[],
): MigrationResult {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied: string[] = [];
  const getExisting = database.prepare<[string], { checksum: string }>(
    "SELECT checksum FROM schema_migrations WHERE id = ?",
  );
  const insertMigration = database.prepare(
    "INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of migrations) {
    const checksum = createHash("sha256").update(migration.sql, "utf8").digest("hex");
    const existing = getExisting.get(migration.id);
    if (existing !== undefined) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration '${migration.id}' checksum mismatch.`);
      }
      continue;
    }

    const applyMigration = database.transaction(() => {
      database.exec(migration.sql);
      insertMigration.run(migration.id, checksum, new Date().toISOString());
    });
    applyMigration.immediate();
    applied.push(migration.id);
  }

  return { applied };
}
