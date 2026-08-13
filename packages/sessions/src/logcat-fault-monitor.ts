import type { LogcatRecord } from "@test-center/contracts/logcat";
import type { FailurePolicy, Incident } from "@test-center/contracts/incident";

import type { FailurePolicyMember } from "./failure-policy.js";

export interface LogcatFaultRun {
  readonly runId: string;
  readonly serial: string;
  readonly policy: FailurePolicy;
  readonly members: readonly FailurePolicyMember[];
}

export interface LogcatFaultIncidentInput {
  readonly incident: Incident;
  readonly policy: FailurePolicy;
  readonly members: readonly FailurePolicyMember[];
}

export interface LogcatFaultMonitorOptions {
  readonly subscribe: (listener: (record: LogcatRecord) => void) => () => void;
  readonly listRuns: () => readonly LogcatFaultRun[];
  readonly handleIncident: (input: LogcatFaultIncidentInput) => Promise<unknown>;
  readonly nowRealtimeMs?: () => number;
}

export class LogcatFaultMonitor {
  private readonly options: LogcatFaultMonitorOptions;
  private removeSubscription: (() => void) | undefined;
  private chain = Promise.resolve();
  private readonly handledRecords = new Set<string>();

  public constructor(options: LogcatFaultMonitorOptions) {
    this.options = options;
  }

  public start(): void {
    if (this.removeSubscription !== undefined)
      throw new Error("Logcat fault monitor is already running.");
    this.removeSubscription = this.options.subscribe((record) => {
      this.chain = this.chain.then(async () => await this.handleRecord(record));
    });
  }

  public stop(): void {
    this.removeSubscription?.();
    this.removeSubscription = undefined;
  }

  public async flush(): Promise<void> {
    await this.chain;
  }

  private async handleRecord(record: LogcatRecord): Promise<void> {
    const parsed = record.parsed;
    if (parsed === null) return;
    const category = classify(parsed.tag, parsed.level, parsed.message);
    if (category === undefined) return;
    const runs = this.options
      .listRuns()
      .filter(
        (run) =>
          run.serial === record.serial &&
          run.members.some(
            (member) => member.serial === record.serial && member.membershipState === "ACTIVE",
          ),
      );
    for (const run of runs) {
      const key = `${run.runId}:${record.serial}:${record.receivedAtMonotonicMs}:${record.rawLine}`;
      if (this.handledRecords.has(key)) continue;
      this.handledRecords.add(key);
      const incident: Incident = {
        schemaVersion: 1,
        incidentId: `inc-logcat-${run.runId}-${record.serial}-${Math.trunc(record.receivedAtMonotonicMs)}`,
        runId: run.runId,
        serial: record.serial,
        category,
        detectedAtRealtimeMs: Math.max(0, this.options.nowRealtimeMs?.() ?? 0),
        detectedAt: new Date().toISOString(),
        source: "logcat",
        details: {
          tag: parsed.tag,
          level: parsed.level,
          messageClass:
            category === "APP_CRASH_OR_ANR" ? classifyMessage(parsed.message) : "unknown",
          receivedAtMonotonicMs: String(record.receivedAtMonotonicMs),
        },
      };
      await this.options.handleIncident({ incident, policy: run.policy, members: run.members });
    }
  }
}

function classify(
  tag: string,
  level: "V" | "D" | "I" | "W" | "E" | "F" | "UNKNOWN",
  message: string,
): "APP_CRASH_OR_ANR" | undefined {
  if (tag === "AndroidRuntime" && level === "F" && /FATAL EXCEPTION/i.test(message)) {
    return "APP_CRASH_OR_ANR";
  }
  if (tag === "ActivityManager" && /\bANR\s+in\b/i.test(message)) return "APP_CRASH_OR_ANR";
  return undefined;
}

function classifyMessage(message: string): "FATAL_EXCEPTION" | "ANR" | "UNKNOWN" {
  if (/FATAL EXCEPTION/i.test(message)) return "FATAL_EXCEPTION";
  if (/\bANR\s+in\b/i.test(message)) return "ANR";
  return "UNKNOWN";
}
