import { performance } from "node:perf_hooks";

import type { ProbeResult } from "@test-center/contracts/environment";

import type { EnvironmentProbe } from "../run-diagnostic.js";

export interface PortReadiness {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly available: boolean;
  readonly required?: boolean;
}

export interface PortSnapshot {
  readonly ports: readonly PortReadiness[];
}

export interface PortProbeOptions {
  readonly collectSnapshot: () => Promise<PortSnapshot>;
  readonly now?: () => number;
}

export function createPortProbe(options: PortProbeOptions): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id: "ports",
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyPortSnapshot(snapshot, Math.max(0, Math.round(now() - startedAt)));
    },
  };
}

export function classifyPortSnapshot(snapshot: PortSnapshot, durationMs: number): ProbeResult {
  if (snapshot.ports.length === 0) {
    return {
      id: "ports",
      severity: "DEGRADED",
      durationMs,
      facts: { ports: [] },
      errors: [
        {
          category: "NO_PORTS_CONFIGURED",
          message: "No required service ports were configured for readiness checks.",
        },
      ],
    };
  }
  const occupied = snapshot.ports.filter(
    (port) => port.required !== false && port.available === false,
  );
  return {
    id: "ports",
    severity: occupied.length === 0 ? "HEALTHY" : "DEGRADED",
    durationMs,
    facts: {
      ports: snapshot.ports.map((port) => ({
        name: port.name,
        host: port.host,
        port: port.port,
        available: port.available,
        required: port.required !== false,
      })),
    },
    errors: occupied.map((port) => ({
      category: "PORT_OCCUPIED",
      message: `${port.name} port ${port.host}:${String(port.port)} is already in use.`,
      detail: { host: port.host, port: port.port },
    })),
  };
}
