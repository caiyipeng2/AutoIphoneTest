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
