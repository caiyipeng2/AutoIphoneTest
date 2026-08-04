import { performance } from "node:perf_hooks";

import type { ProbeResult } from "@test-center/contracts/environment";

import type { EnvironmentProbe } from "../run-diagnostic.js";

export const GIBIBYTE = 1024 ** 3;
const FATAL_FREE_BYTES = 5 * GIBIBYTE;
const HEALTHY_FREE_BYTES = 20 * GIBIBYTE;

export interface DriveSnapshot {
  readonly driveRoot: string;
  readonly dataRoot: string;
  readonly exists: boolean;
  readonly freeBytes?: number;
  readonly dataRootWritable?: boolean;
}

export interface DriveProbeOptions {
  readonly collectSnapshot: () => Promise<DriveSnapshot>;
  readonly now?: () => number;
}

export function createDriveProbe(options: DriveProbeOptions): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id: "drive",
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyDriveSnapshot(snapshot, Math.max(0, Math.round(now() - startedAt)));
    },
  };
}

export function classifyDriveSnapshot(snapshot: DriveSnapshot, durationMs: number): ProbeResult {
  const facts = {
    driveRoot: snapshot.driveRoot,
    dataRoot: snapshot.dataRoot,
    exists: snapshot.exists,
    ...(snapshot.freeBytes === undefined ? {} : { freeBytes: snapshot.freeBytes }),
    ...(snapshot.dataRootWritable === undefined
      ? {}
      : { dataRootWritable: snapshot.dataRootWritable }),
    fatalBelowBytes: FATAL_FREE_BYTES,
    healthyAtBytes: HEALTHY_FREE_BYTES,
  };

  if (!snapshot.exists) {
    return result("FATAL", durationMs, facts, [
      { category: "DRIVE_NOT_FOUND", message: `${snapshot.driveRoot} is not available.` },
    ]);
  }

  const errors: ProbeResult["errors"] = [];
  let severity: ProbeResult["severity"] = "HEALTHY";
  if (snapshot.freeBytes === undefined || snapshot.freeBytes < FATAL_FREE_BYTES) {
    severity = "FATAL";
    errors.push({
      category: "FREE_SPACE_CRITICAL",
      message: `${snapshot.driveRoot} requires at least 5 GiB of free space.`,
    });
  } else if (snapshot.freeBytes < HEALTHY_FREE_BYTES) {
    severity = "DEGRADED";
    errors.push({
      category: "FREE_SPACE_LOW",
      message: `${snapshot.driveRoot} has fewer than 20 GiB free.`,
    });
  }
  if (snapshot.dataRootWritable !== true) {
    severity = "FATAL";
    errors.push({
      category: "DATA_ROOT_UNWRITABLE",
      message: `${snapshot.dataRoot} is not writable.`,
    });
  }

  return result(severity, durationMs, facts, errors, snapshot.driveRoot);
}

function result(
  severity: ProbeResult["severity"],
  durationMs: number,
  facts: ProbeResult["facts"],
  errors: ProbeResult["errors"],
  resolvedPath?: string,
): ProbeResult {
  return {
    id: "drive",
    severity,
    durationMs,
    ...(resolvedPath === undefined ? {} : { resolvedPath }),
    facts,
    errors,
  };
}
