import { performance } from "node:perf_hooks";
import { win32 } from "node:path";

import type { ProbeResult } from "@test-center/contracts/environment";

import type { EnvironmentProbe } from "../run-diagnostic.js";

export const EXPECTED_JAVA_VERSION = "17.0.19";

export interface JavaSnapshot {
  readonly present: boolean;
  readonly resolvedPath?: string;
  readonly diagnosticPaths?: readonly string[];
  readonly versionOutput?: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
}

export interface JavaProbeOptions {
  readonly collectSnapshot: () => Promise<JavaSnapshot>;
  readonly expectedVersion?: string;
  readonly now?: () => number;
}

export function createJavaProbe(options: JavaProbeOptions): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id: "java",
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyJavaSnapshot(
        snapshot,
        Math.max(0, Math.round(now() - startedAt)),
        options.expectedVersion,
      );
    },
  };
}

export function classifyJavaSnapshot(
  snapshot: JavaSnapshot,
  durationMs: number,
  expectedVersion = EXPECTED_JAVA_VERSION,
): ProbeResult {
  const version = snapshot.versionOutput?.match(/\b(?:openjdk|java) version "([^"]+)"/i)?.[1];
  return classifyVersionedRuntime({
    id: "java",
    label: "Java",
    snapshot,
    durationMs,
    expectedVersion,
    ...(version === undefined ? {} : { version }),
    fatal: false,
  });
}

export interface VersionedRuntimeOptions {
  readonly id: string;
  readonly label: string;
  readonly snapshot: JavaSnapshot;
  readonly durationMs: number;
  readonly expectedVersion: string;
  readonly version?: string;
  readonly fatal: boolean;
}

export function classifyVersionedRuntime(options: VersionedRuntimeOptions): ProbeResult {
  const severity = options.fatal ? "FATAL" : "DEGRADED";
  const base = {
    id: options.id,
    durationMs: options.durationMs,
    ...(options.snapshot.resolvedPath === undefined
      ? {}
      : { resolvedPath: options.snapshot.resolvedPath }),
    facts: {
      expectedVersion: options.expectedVersion,
      ...(options.snapshot.diagnosticPaths === undefined
        ? {}
        : { diagnosticPaths: [...options.snapshot.diagnosticPaths] }),
    },
  };
  if (!options.snapshot.present) {
    const diagnosticOnly = (options.snapshot.diagnosticPaths?.length ?? 0) > 0;
    return {
      ...base,
      severity,
      errors: [
        {
          category: diagnosticOnly ? "PATH_UNRESOLVED" : "NOT_FOUND",
          message: diagnosticOnly
            ? `${options.label} was found only at diagnostic-only paths and is not trusted for execution.`
            : `${options.label} was not found.`,
        },
      ],
    };
  }
  if (
    options.snapshot.resolvedPath === undefined ||
    !win32.isAbsolute(options.snapshot.resolvedPath)
  ) {
    return {
      ...base,
      severity,
      errors: [
        {
          category: "PATH_UNRESOLVED",
          message: `${options.label} does not have a trusted absolute executable path.`,
        },
      ],
    };
  }
  if (options.snapshot.timedOut === true) {
    return {
      ...base,
      severity,
      errors: [
        {
          category: "COMMAND_TIMEOUT",
          message: `${options.label} version detection timed out.`,
        },
      ],
    };
  }
  if (options.snapshot.exitCode !== 0 || options.version === undefined) {
    return {
      ...base,
      severity,
      errors: [
        {
          category: "UNUSABLE_RUNTIME",
          message: `${options.label} could not report a valid version.`,
        },
      ],
    };
  }
  if (options.version !== options.expectedVersion) {
    return {
      ...base,
      severity,
      version: options.version,
      errors: [
        {
          category: "VERSION_MISMATCH",
          message: `Expected ${options.label} ${options.expectedVersion}, found ${options.version}.`,
        },
      ],
    };
  }
  return {
    ...base,
    severity: "HEALTHY",
    version: options.version,
    errors: [],
  };
}
