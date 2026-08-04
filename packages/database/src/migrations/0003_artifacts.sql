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
