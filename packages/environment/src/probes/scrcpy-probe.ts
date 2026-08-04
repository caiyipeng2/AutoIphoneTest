import { performance } from "node:perf_hooks";
import { win32 } from "node:path";

import type { ProbeResult } from "@test-center/contracts/environment";

import type { EnvironmentProbe } from "../run-diagnostic.js";

export const EXPECTED_SCRCPY_VERSION = "scrcpy 3.1";

export interface ScrcpySnapshot {
  readonly present: boolean;
  readonly resolvedPath?: string;
  readonly versionOutput?: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
}

export interface ScrcpyProbeOptions {
  readonly collectSnapshot: () => Promise<ScrcpySnapshot>;
  readonly expectedVersion?: string;
  readonly now?: () => number;
}

export function createScrcpyProbe(options: ScrcpyProbeOptions): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id: "scrcpy",
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyScrcpySnapshot(
        snapshot,
        Math.max(0, Math.round(now() - startedAt)),
        options.expectedVersion,
      );
    },
  };
}

export function classifyScrcpySnapshot(
  snapshot: ScrcpySnapshot,
  durationMs: number,
  expectedVersion = EXPECTED_SCRCPY_VERSION,
): ProbeResult {
  const version = snapshot.versionOutput?.match(/\bscrcpy\s+\d+\.\d+(?:\.\d+)?\b/i)?.[0];
  const facts = { expectedVersion };

  if (!snapshot.present) {
    return degraded(durationMs, facts, "NOT_FOUND", "scrcpy was not found.");
  }
  if (snapshot.resolvedPath === undefined || !win32.isAbsolute(snapshot.resolvedPath)) {
    return degraded(
      durationMs,
      facts,
      "PATH_UNRESOLVED",
      "scrcpy does not have a trusted absolute executable path.",
    );
  }
  if (snapshot.timedOut === true) {
    return degraded(
      durationMs,
      facts,
      "COMMAND_TIMEOUT",
      "scrcpy version detection timed out.",
      snapshot.resolvedPath,
    );
  }
  if (snapshot.exitCode !== 0 || !version) {
    return degraded(
      durationMs,
      facts,
      "UNUSABLE_RUNTIME",
      "scrcpy could not report a valid version.",
      snapshot.resolvedPath,
    );
  }
  if (version !== expectedVersion) {
    return {
      id: "scrcpy",
      severity: "DEGRADED",
      durationMs,
      ...(snapshot.resolvedPath === undefined ? {} : { resolvedPath: snapshot.resolvedPath }),
      version,
      facts,
      errors: [
        {
          category: "VERSION_MISMATCH",
          message: `Expected ${expectedVersion}, found ${version}.`,
        },
      ],
    };
  }
  return {
    id: "scrcpy",
    severity: "HEALTHY",
    durationMs,
    ...(snapshot.resolvedPath === undefined ? {} : { resolvedPath: snapshot.resolvedPath }),
    version,
    facts,
    errors: [],
  };
}

function degraded(
  durationMs: number,
  facts: Readonly<Record<string, string>>,
  category: string,
  message: string,
  resolvedPath?: string,
): ProbeResult {
  return {
    id: "scrcpy",
    severity: "DEGRADED",
    durationMs,
    ...(resolvedPath === undefined ? {} : { resolvedPath }),
    facts,
    errors: [{ category, message }],
  };
}
