import { performance } from "node:perf_hooks";
import { win32 } from "node:path";

import type { ProbeResult } from "@test-center/contracts/environment";

import type { EnvironmentProbe } from "../run-diagnostic.js";

export const EXPECTED_BUNDLETOOL_VERSION = "1.18.3";

export interface BundletoolSnapshot {
  readonly present: boolean;
  readonly resolvedPath?: string;
  readonly javaPath?: string;
  readonly versionOutput?: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
}

export interface BundletoolProbeOptions {
  readonly collectSnapshot: () => Promise<BundletoolSnapshot>;
  readonly expectedVersion?: string;
  readonly now?: () => number;
}

export function createBundletoolProbe(options: BundletoolProbeOptions): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id: "bundletool",
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyBundletoolSnapshot(
        snapshot,
        Math.max(0, Math.round(now() - startedAt)),
        options.expectedVersion,
      );
    },
  };
}

export function classifyBundletoolSnapshot(
  snapshot: BundletoolSnapshot,
  durationMs: number,
  expectedVersion = EXPECTED_BUNDLETOOL_VERSION,
): ProbeResult {
  const version = extractVersion(snapshot.versionOutput);
  const facts = {
    expectedVersion,
    ...(snapshot.javaPath === undefined ? {} : { javaPath: snapshot.javaPath }),
  };

  if (!snapshot.present) {
    return degraded(durationMs, facts, "NOT_FOUND", "bundletool was not found.");
  }
  if (snapshot.resolvedPath === undefined || !win32.isAbsolute(snapshot.resolvedPath)) {
    return degraded(
      durationMs,
      facts,
      "PATH_UNRESOLVED",
      "bundletool does not have a trusted absolute JAR path.",
    );
  }
  if (snapshot.timedOut === true) {
    return degraded(
      durationMs,
      facts,
      "COMMAND_TIMEOUT",
      "bundletool version detection timed out.",
      snapshot.resolvedPath,
    );
  }
  if (snapshot.exitCode !== 0 || version === undefined) {
    return degraded(
      durationMs,
      facts,
      "UNUSABLE_RUNTIME",
      "bundletool could not report a valid version.",
      snapshot.resolvedPath,
    );
  }
  if (version !== expectedVersion) {
    return {
      id: "bundletool",
      severity: "DEGRADED",
      durationMs,
      ...(snapshot.resolvedPath === undefined ? {} : { resolvedPath: snapshot.resolvedPath }),
      version,
      facts,
      errors: [
        {
          category: "VERSION_MISMATCH",
          message: `Expected bundletool ${expectedVersion}, found ${version}.`,
        },
      ],
    };
  }
  return {
    id: "bundletool",
    severity: "HEALTHY",
    durationMs,
    ...(snapshot.resolvedPath === undefined ? {} : { resolvedPath: snapshot.resolvedPath }),
    version,
    facts,
    errors: [],
  };
}

function extractVersion(output?: string): string | undefined {
  return output?.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
}

function degraded(
  durationMs: number,
  facts: Readonly<Record<string, string>>,
  category: string,
  message: string,
  resolvedPath?: string,
): ProbeResult {
  return {
    id: "bundletool",
    severity: "DEGRADED",
    durationMs,
    ...(resolvedPath === undefined ? {} : { resolvedPath }),
    facts,
    errors: [{ category, message }],
  };
}
