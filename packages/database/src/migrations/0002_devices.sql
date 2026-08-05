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
