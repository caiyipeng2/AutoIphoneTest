import type Database from "better-sqlite3";
import {
  DEFAULT_STORAGE_THRESHOLDS,
  type StoragePressureMonitor,
  type StoragePressureSample,
} from "@test-center/evidence";

import type { StorageOverviewRouteService, StorageOverviewSnapshot } from "./routes/storage.js";

interface ActiveRunCountRow {
  readonly count: number;
}

/** Adapts the sampled storage signal and database state to the read-only Overview contract. */
export function createStorageOverviewService(
  database: Database.Database,
  monitor: StoragePressureMonitor,
): StorageOverviewRouteService {
  return {
    getOverview: async () => {
      const sample = monitor.getLatest() ?? (await monitor.sample());
      return createStorageOverviewSnapshot(database, sample);
    },
  };
}

export function createStorageOverviewSnapshot(
  database: Database.Database,
  sample: StoragePressureSample,
): StorageOverviewSnapshot {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM test_runs
       WHERE state IN ('CREATED', 'PREFLIGHT', 'RUNNING', 'PAUSED')`,
    )
    .get() as ActiveRunCountRow;
  const estimatedSecondsUntilBlocked = estimateSecondsUntilBlocked(
    sample.freeBytes,
    sample.writeRateBytesPerSecond,
  );
  return {
    measuredAt: new Date(sample.measuredAtMs).toISOString(),
    pressure: sample.pressure,
    ...(sample.freeBytes === undefined ? {} : { freeBytes: sample.freeBytes }),
    warningBytes: DEFAULT_STORAGE_THRESHOLDS.warningBytes,
    dangerBytes: DEFAULT_STORAGE_THRESHOLDS.dangerBytes,
    writeRateBytesPerSecond: sample.writeRateBytesPerSecond,
    ...(estimatedSecondsUntilBlocked === undefined ? {} : { estimatedSecondsUntilBlocked }),
    activeRunCount: row.count,
    ...(sample.sourceError === undefined ? {} : { sourceError: sample.sourceError }),
  };
}

export function estimateSecondsUntilBlocked(
  freeBytes: number | undefined,
  writeRateBytesPerSecond: number,
): number | undefined {
  if (freeBytes === undefined || writeRateBytesPerSecond <= 0) return undefined;
  if (freeBytes <= DEFAULT_STORAGE_THRESHOLDS.dangerBytes) return 0;
  return Math.floor((freeBytes - DEFAULT_STORAGE_THRESHOLDS.dangerBytes) / writeRateBytesPerSecond);
}
