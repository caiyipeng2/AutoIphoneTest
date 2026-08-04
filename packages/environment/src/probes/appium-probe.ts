import { performance } from "node:perf_hooks";
import { win32 } from "node:path";

import type { ProbeResult } from "@test-center/contracts/environment";

import type { EnvironmentProbe } from "../run-diagnostic.js";

export const EXPECTED_APPIUM_VERSION = "3.6.0";
export const EXPECTED_UIAUTOMATOR2_VERSION = "8.2.2";

export interface NpmToolSnapshot {
  readonly present: boolean;
  readonly resolvedPath?: string;
  readonly versionOutput?: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
}

export interface NpmToolProbeOptions {
  readonly collectSnapshot: () => Promise<NpmToolSnapshot>;
  readonly expectedVersion?: string;
  readonly now?: () => number;
}

export function createAppiumProbe(options: NpmToolProbeOptions): EnvironmentProbe {
  return createNpmToolProbe("appium", "Appium", EXPECTED_APPIUM_VERSION, options);
}

export function createUiAutomator2Probe(options: NpmToolProbeOptions): EnvironmentProbe {
  return createNpmToolProbe(
    "uiautomator2",
    "UiAutomator2 driver",
    EXPECTED_UIAUTOMATOR2_VERSION,
    options,
  );
}

export function classifyAppiumSnapshot(
  snapshot: NpmToolSnapshot,
  durationMs: number,
  expectedVersion = EXPECTED_APPIUM_VERSION,
): ProbeResult {
  return classifyNpmTool("appium", "Appium", snapshot, durationMs, expectedVersion);
}

export function classifyUiAutomator2Snapshot(
  snapshot: NpmToolSnapshot,
  durationMs: number,
  expectedVersion = EXPECTED_UIAUTOMATOR2_VERSION,
): ProbeResult {
  return classifyNpmTool(
    "uiautomator2",
    "UiAutomator2 driver",
    snapshot,
    durationMs,
    expectedVersion,
  );
}

function createNpmToolProbe(
  id: string,
  label: string,
  defaultExpectedVersion: string,
  options: NpmToolProbeOptions,
): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id,
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyNpmTool(
        id,
        label,
        snapshot,
        Math.max(0, Math.round(now() - startedAt)),
        options.expectedVersion ?? defaultExpectedVersion,
      );
    },
  };
}

function classifyNpmTool(
  id: string,
  label: string,
  snapshot: NpmToolSnapshot,
  durationMs: number,
  expectedVersion: string,
): ProbeResult {
  const version = snapshot.versionOutput?.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
  const base = {
    id,
    durationMs,
    ...(snapshot.resolvedPath === undefined ? {} : { resolvedPath: snapshot.resolvedPath }),
    facts: { expectedVersion },
  };
  if (!snapshot.present) {
    return {
      ...base,
      severity: "DEGRADED",
      errors: [{ category: "NOT_FOUND", message: `${label} was not found.` }],
    };
  }
  if (snapshot.resolvedPath === undefined || !win32.isAbsolute(snapshot.resolvedPath)) {
    return {
      ...base,
      severity: "DEGRADED",
      errors: [
        {
          category: "PATH_UNRESOLVED",
          message: `${label} does not have a trusted absolute runtime path.`,
        },
      ],
    };
  }
  if (snapshot.timedOut === true) {
    return {
      ...base,
      severity: "DEGRADED",
      errors: [{ category: "COMMAND_TIMEOUT", message: `${label} version detection timed out.` }],
    };
  }
  if (snapshot.exitCode !== 0 || version === undefined) {
    return {
      ...base,
      severity: "DEGRADED",
      errors: [
        { category: "UNUSABLE_RUNTIME", message: `${label} could not report a valid version.` },
      ],
    };
  }
  if (version !== expectedVersion) {
    return {
      ...base,
      severity: "DEGRADED",
      version,
      errors: [
        {
          category: "VERSION_MISMATCH",
          message: `Expected ${label} ${expectedVersion}, found ${version}.`,
        },
      ],
    };
  }
  return { ...base, severity: "HEALTHY", version, errors: [] };
}
