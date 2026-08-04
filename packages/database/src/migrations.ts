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
