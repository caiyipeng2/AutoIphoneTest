import { performance } from "node:perf_hooks";

import type { ProbeResult } from "@test-center/contracts/environment";

import { classifyVersionedRuntime } from "./java-probe.js";
import type { EnvironmentProbe } from "../run-diagnostic.js";

export const EXPECTED_NODE_VERSION = "v22.23.1";

export interface NodeSnapshot {
  readonly present: boolean;
  readonly resolvedPath?: string;
  readonly versionOutput?: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
}

export interface NodeProbeOptions {
  readonly collectSnapshot: () => Promise<NodeSnapshot>;
  readonly expectedVersion?: string;
  readonly now?: () => number;
}

export function createNodeProbe(options: NodeProbeOptions): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id: "node",
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyNodeSnapshot(
        snapshot,
        Math.max(0, Math.round(now() - startedAt)),
        options.expectedVersion,
      );
    },
  };
}

export function classifyNodeSnapshot(
  snapshot: NodeSnapshot,
  durationMs: number,
  expectedVersion = EXPECTED_NODE_VERSION,
): ProbeResult {
  const version = snapshot.versionOutput?.trim().match(/^v\d+\.\d+\.\d+$/)?.[0];
  return classifyVersionedRuntime({
    id: "node",
    label: "Node.js",
    snapshot,
    durationMs,
    expectedVersion,
    ...(version === undefined ? {} : { version }),
    fatal: true,
  });
}
