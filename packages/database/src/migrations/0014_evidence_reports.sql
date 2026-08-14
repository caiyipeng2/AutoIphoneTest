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
