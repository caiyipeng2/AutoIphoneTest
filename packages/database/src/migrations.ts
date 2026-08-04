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
