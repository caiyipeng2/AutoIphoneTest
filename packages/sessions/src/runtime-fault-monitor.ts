import type { FailurePolicy, Incident, IncidentCategory } from "@test-center/contracts/incident";

import type { FailurePolicyMember } from "./failure-policy.js";

export type RuntimeFaultCategory =
  "APPIUM_SESSION_LOST" | "BRIDGE_TIMEOUT" | "BRIDGE_STATE_MISMATCH";

export interface RuntimeFaultEvent {
  readonly runId: string;
  readonly serial: string;
  readonly generation: number;
  readonly faultId: string;
  readonly category: RuntimeFaultCategory;
  readonly source: string;
  readonly message: string;
  readonly detectedAt: string;
  readonly detectedAtRealtimeMs: number;
}

export interface RuntimeFaultRun {
  readonly runId: string;
  readonly policy: FailurePolicy;
  readonly members: readonly FailurePolicyMember[];
}

export interface RuntimeFaultIncidentInput {
  readonly incident: Incident;
  readonly policy: FailurePolicy;
  readonly members: readonly FailurePolicyMember[];
}

export interface RuntimeFaultMonitorOptions {
  readonly subscribe: (listener: (event: RuntimeFaultEvent) => void) => () => void;
  readonly listRuns: () => readonly RuntimeFaultRun[];
  readonly handleIncident: (input: RuntimeFaultIncidentInput) => Promise<unknown>;
  readonly nowRealtimeMs?: () => number;
}

export class RuntimeFaultMonitor {
  private readonly subscribe: RuntimeFaultMonitorOptions["subscribe"];
  private readonly listRuns: RuntimeFaultMonitorOptions["listRuns"];
  private readonly handleIncident: RuntimeFaultMonitorOptions["handleIncident"];
  private readonly nowRealtimeMs: () => number;
  private removeSubscription: (() => void) | undefined;
  private chain = Promise.resolve();
  private readonly handledFaults = new Set<string>();

  public constructor(options: RuntimeFaultMonitorOptions) {
    this.subscribe = options.subscribe;
    this.listRuns = options.listRuns;
    this.handleIncident = options.handleIncident;
    this.nowRealtimeMs = options.nowRealtimeMs ?? (() => 0);
  }

  public start(): void {
    if (this.removeSubscription !== undefined)
      throw new Error("Runtime fault monitor is already running.");
    this.removeSubscription = this.subscribe((event) => {
      this.chain = this.chain.then(async () => await this.handleEvent(event));
    });
  }

  public stop(): void {
    this.removeSubscription?.();
    this.removeSubscription = undefined;
  }

  public async flush(): Promise<void> {
    await this.chain;
  }

  private async handleEvent(event: RuntimeFaultEvent): Promise<void> {
    if (!Number.isSafeInteger(event.generation) || event.generation <= 0) return;
    if (!Number.isFinite(event.detectedAtRealtimeMs) || event.detectedAtRealtimeMs < 0) return;
    if (!event.runId.trim() || !event.serial.trim() || !event.faultId.trim()) return;
    const runs = this.listRuns().filter(
      (run) =>
        run.runId === event.runId &&
        run.members.some(
          (member) => member.serial === event.serial && member.membershipState === "ACTIVE",
        ),
    );
    for (const run of runs) {
      const dedupeKey = `${run.runId}:${event.serial}:${event.faultId}`;
      if (this.handledFaults.has(dedupeKey)) continue;
      this.handledFaults.add(dedupeKey);
      const incident: Incident = {
        schemaVersion: 1,
        incidentId: `inc-${toIncidentSlug(event.category)}-${toIncidentIdPart(run.runId)}-${toIncidentIdPart(event.serial)}-${toIncidentIdPart(event.faultId)}`,
        runId: run.runId,
        serial: event.serial,
        category: event.category as IncidentCategory,
        generation: event.generation,
        detectedAtRealtimeMs: Math.max(0, this.nowRealtimeMs(), event.detectedAtRealtimeMs),
        detectedAt: event.detectedAt,
        source: event.source,
        evidenceRef: `fault:${event.faultId}`,
        details: { message: event.message, faultId: event.faultId },
      };
      await this.handleIncident({ incident, policy: run.policy, members: run.members });
    }
  }
}

function toIncidentSlug(category: RuntimeFaultCategory): string {
  return category.toLowerCase().replaceAll("_", "-");
}

function toIncidentIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 96);
}
