import type { FailurePolicy, Incident } from "@test-center/contracts/incident";

import type { FailurePolicyMember } from "./failure-policy.js";

export interface DeviceConnectionFaultEvent {
  readonly serial: string;
  readonly state: "ONLINE" | "UNAUTHORIZED" | "OFFLINE" | "UNKNOWN";
  readonly connectionSeq: number;
  readonly observedAt: string;
}

export interface DeviceConnectionFaultRun {
  readonly runId: string;
  readonly policy: FailurePolicy;
  readonly members: readonly FailurePolicyMember[];
}

export interface DeviceFaultIncidentInput {
  readonly incident: Incident;
  readonly policy: FailurePolicy;
  readonly members: readonly FailurePolicyMember[];
}

export interface DeviceConnectionFaultMonitorOptions {
  readonly subscribe: (listener: (event: DeviceConnectionFaultEvent) => void) => () => void;
  readonly listRuns: () => readonly DeviceConnectionFaultRun[];
  readonly handleIncident: (input: DeviceFaultIncidentInput) => Promise<unknown>;
  readonly nowRealtimeMs?: () => number;
}

export class DeviceConnectionFaultMonitor {
  private readonly subscribe: DeviceConnectionFaultMonitorOptions["subscribe"];
  private readonly listRuns: DeviceConnectionFaultMonitorOptions["listRuns"];
  private readonly handleIncident: DeviceConnectionFaultMonitorOptions["handleIncident"];
  private readonly nowRealtimeMs: () => number;
  private removeSubscription: (() => void) | undefined;
  private chain = Promise.resolve();
  private readonly handledSequences = new Set<string>();

  public constructor(options: DeviceConnectionFaultMonitorOptions) {
    this.subscribe = options.subscribe;
    this.listRuns = options.listRuns;
    this.handleIncident = options.handleIncident;
    this.nowRealtimeMs = options.nowRealtimeMs ?? (() => 0);
  }

  public start(): void {
    if (this.removeSubscription !== undefined)
      throw new Error("Device fault monitor is already running.");
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

  private async handleEvent(event: DeviceConnectionFaultEvent): Promise<void> {
    if (event.state === "ONLINE") return;
    if (!Number.isSafeInteger(event.connectionSeq) || event.connectionSeq <= 0) return;
    const runs = this.listRuns().filter((run) =>
      run.members.some(
        (member) => member.serial === event.serial && member.membershipState === "ACTIVE",
      ),
    );
    for (const run of runs) {
      const dedupeKey = `${run.runId}:${event.serial}:${event.connectionSeq}`;
      if (this.handledSequences.has(dedupeKey)) continue;
      this.handledSequences.add(dedupeKey);
      const incident: Incident = {
        schemaVersion: 1,
        incidentId: `inc-adb-${run.runId}-${event.serial}-${event.connectionSeq}`,
        runId: run.runId,
        serial: event.serial,
        category: "ADB_DISCONNECTED",
        generation: event.connectionSeq,
        detectedAtRealtimeMs: Math.max(0, this.nowRealtimeMs()),
        detectedAt: event.observedAt,
        source: "device-registry",
        details: { connectionState: event.state, connectionSeq: String(event.connectionSeq) },
      };
      await this.handleIncident({ incident, policy: run.policy, members: run.members });
    }
  }
}
