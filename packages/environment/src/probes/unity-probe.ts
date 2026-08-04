import { performance } from "node:perf_hooks";
import { win32 } from "node:path";

import type { ProbeResult } from "@test-center/contracts/environment";

import type { EnvironmentProbe } from "../run-diagnostic.js";

export const EXPECTED_UNITY_VERSION = "2022.3.62f2";

export interface UnityAndroidModules {
  readonly androidPlayer: boolean;
  readonly sdk: boolean;
  readonly adb: boolean;
  readonly jdk: boolean;
  readonly ndk: boolean;
}

export interface UnitySnapshot {
  readonly present: boolean;
  readonly editorPath?: string;
  readonly version?: string;
  readonly androidModules?: UnityAndroidModules;
}

export interface UnityProbeOptions {
  readonly collectSnapshot: () => Promise<UnitySnapshot>;
  readonly expectedVersion?: string;
  readonly now?: () => number;
}

export function createUnityProbe(options: UnityProbeOptions): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id: "unity",
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyUnitySnapshot(
        snapshot,
        Math.max(0, Math.round(now() - startedAt)),
        options.expectedVersion,
      );
    },
  };
}

export function classifyUnitySnapshot(
  snapshot: UnitySnapshot,
  durationMs: number,
  expectedVersion = EXPECTED_UNITY_VERSION,
): ProbeResult {
  if (!snapshot.present) {
    return {
      id: "unity",
      severity: "DEGRADED",
      durationMs,
      facts: { expectedVersion },
      errors: [{ category: "NOT_FOUND", message: "Unity Editor was not found." }],
    };
  }

  const errors: ProbeResult["errors"] = [];
  if (snapshot.editorPath === undefined || !win32.isAbsolute(snapshot.editorPath)) {
    errors.push({
      category: "PATH_UNRESOLVED",
      message: "Unity Editor does not have a trusted absolute executable path.",
    });
  }
  if (snapshot.version !== expectedVersion) {
    errors.push({
      category: snapshot.version === undefined ? "VERSION_UNAVAILABLE" : "VERSION_MISMATCH",
      message:
        snapshot.version === undefined
          ? "Unity Editor did not expose a version."
          : `Expected Unity ${expectedVersion}, found ${snapshot.version}.`,
    });
  }
  const missingModules = Object.entries(snapshot.androidModules ?? {})
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (snapshot.androidModules === undefined || missingModules.length > 0) {
    errors.push({
      category: "ANDROID_MODULE_MISSING",
      message: "Unity Android Build Support is incomplete.",
      detail: {
        missingModules: snapshot.androidModules === undefined ? ["androidModules"] : missingModules,
      },
    });
  }

  return {
    id: "unity",
    severity: errors.length === 0 ? "HEALTHY" : "DEGRADED",
    durationMs,
    ...(snapshot.editorPath === undefined ? {} : { resolvedPath: snapshot.editorPath }),
    ...(snapshot.version === undefined ? {} : { version: snapshot.version }),
    facts: {
      expectedVersion,
      androidModules:
        snapshot.androidModules === undefined
          ? {}
          : {
              androidPlayer: snapshot.androidModules.androidPlayer,
              sdk: snapshot.androidModules.sdk,
              adb: snapshot.androidModules.adb,
              jdk: snapshot.androidModules.jdk,
              ndk: snapshot.androidModules.ndk,
            },
    },
    errors,
  };
}
