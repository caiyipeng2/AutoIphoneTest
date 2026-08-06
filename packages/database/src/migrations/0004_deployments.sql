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
