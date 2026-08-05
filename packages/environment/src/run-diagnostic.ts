import { performance } from "node:perf_hooks";

import {
  EnvironmentDiagnosticSchema,
  ProbeResultSchema,
  type EnvironmentDiagnostic,
  type ProbeResult,
  type ProbeSeverity,
} from "@test-center/contracts/environment";

export interface EnvironmentProbe {
  readonly id: string;
  collect(): Promise<ProbeResult>;
}

export interface RunEnvironmentDiagnosticOptions {
  readonly probes: readonly EnvironmentProbe[];
  readonly generatedAt?: () => Date;
}

const severityRank: Readonly<Record<ProbeSeverity, number>> = {
  HEALTHY: 0,
  DEGRADED: 1,
  FATAL: 2,
};
const probeIdPattern = /^[a-z][a-z0-9-]*$/;

export async function runEnvironmentDiagnostic(
  options: RunEnvironmentDiagnosticOptions,
): Promise<EnvironmentDiagnostic> {
  if (options.probes.length === 0) {
    throw new TypeError("At least one environment probe is required.");
  }
  validateProbeDefinitions(options.probes);

  const results = await Promise.all(options.probes.map(async (probe) => await collectProbe(probe)));
  results.sort((left, right) => compareProbeIds(left.id, right.id));

  return EnvironmentDiagnosticSchema.parse({
    schemaVersion: 1,
    generatedAt: (options.generatedAt ?? (() => new Date()))().toISOString(),
    overall: results.reduce<ProbeSeverity>(
      (current, result) =>
        severityRank[result.severity] > severityRank[current] ? result.severity : current,
      "HEALTHY",
    ),
    probes: results,
  });
}

async function collectProbe(probe: EnvironmentProbe): Promise<ProbeResult> {
  const startedAt = performance.now();
  try {
    const result = await probe.collect();
    if (result.id !== probe.id) {
      return failedProbe(
        probe.id,
        performance.now() - startedAt,
        "PROBE_ID_MISMATCH",
        `Probe '${probe.id}' returned result id '${result.id}'.`,
      );
    }
    const parsed = ProbeResultSchema.safeParse(result);
    if (!parsed.success) {
      return failedProbe(
        probe.id,
        performance.now() - startedAt,
        "INVALID_PROBE_RESULT",
        `Probe '${probe.id}' returned a result that violates the diagnostic contract.`,
        { issueCount: parsed.error.issues.length },
      );
    }
    return parsed.data;
  } catch (error) {
    const detail =
      error instanceof Error ? { name: error.name, message: error.message } : undefined;
    return failedProbe(
      probe.id,
      performance.now() - startedAt,
      "PROBE_COLLECTION_FAILED",
      `Probe '${probe.id}' failed during collection.`,
      detail,
    );
  }
}

function failedProbe(
  id: string,
  durationMs: number,
  category: string,
  message: string,
  detail?: Readonly<Record<string, string | number>>,
): ProbeResult {
  return {
    id,
    severity: "FATAL",
    durationMs: Math.max(0, Math.round(durationMs)),
    facts: {},
    errors: [
      {
        category,
        message,
        ...(detail === undefined ? {} : { detail }),
      },
    ],
  };
}

function validateProbeDefinitions(probes: readonly EnvironmentProbe[]): void {
  const ids = new Set<string>();
  for (const probe of probes) {
    if (!probeIdPattern.test(probe.id)) {
      throw new TypeError(`Invalid environment probe id '${probe.id}'.`);
    }
    if (ids.has(probe.id)) {
      throw new TypeError(`Duplicate environment probe id '${probe.id}'.`);
    }
    ids.add(probe.id);
  }
}

function compareProbeIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
