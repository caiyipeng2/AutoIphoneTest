import type { FailurePolicy, Incident } from "@test-center/contracts/incident";

import {
  decideFailurePolicy,
  type FailurePolicyDecision,
  type FailurePolicyMember,
} from "./failure-policy.js";
import { IncidentRepository, type RecoveryAttempt } from "./incident-repository.js";

export interface IncidentExecutor {
  pauseAll(runId: string, reason: string): Promise<void>;
  quarantineDevice(runId: string, serial: string, reason: string): Promise<void>;
}

export interface HandleIncidentInput {
  readonly incident: Incident;
  readonly policy: FailurePolicy;
  readonly members: readonly FailurePolicyMember[];
  readonly nowRealtimeMs?: number;
}

export interface HandleIncidentResult {
  readonly incident: Incident;
  readonly decision: FailurePolicyDecision;
  readonly recovery: RecoveryAttempt;
}

export class IncidentMonitor {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly executor: IncidentExecutor,
  ) {}

  public async handle(input: HandleIncidentInput): Promise<HandleIncidentResult> {
    const recorded = this.repository.record(input.incident);
    const existing = this.repository.getLatestRecoveryForIncident(input.incident.incidentId);
    if (recorded.state === "DEDUPLICATED" && existing === undefined) {
      throw new Error("Incident was already recorded without an unfinished recovery attempt.");
    }
    const decisionInput = {
      policy: input.policy,
      incident: recorded.incident,
      members: input.members,
      ...(input.nowRealtimeMs === undefined ? {} : { nowRealtimeMs: input.nowRealtimeMs }),
    };
    const decision = decideFailurePolicy(decisionInput);
    if (existing !== undefined) {
      return { incident: recorded.incident, decision, recovery: existing };
    }

    const recoveryInput = {
      incidentId: recorded.incident.incidentId,
      action: decision.action,
      reason: decision.reason,
      deadlineRealtimeMs: decision.deadlineRealtimeMs,
      ...(decision.serial === undefined ? {} : { targetSerial: decision.serial }),
    };
    const recovery = this.repository.startRecovery(recoveryInput);
    try {
      if (decision.action === "PAUSE_ALL") {
        await this.executor.pauseAll(recorded.incident.runId, decision.reason);
      } else {
        await this.executor.quarantineDevice(
          recorded.incident.runId,
          decision.serial!,
          decision.reason,
        );
      }
      return {
        incident: recorded.incident,
        decision,
        recovery: this.repository.finishRecovery(recovery.id, {
          status: "SUCCEEDED",
          completedAt: new Date().toISOString(),
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recovery execution failed.";
      const failed = this.repository.finishRecovery(recovery.id, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        errorMessage: message,
      });
      return { incident: recorded.incident, decision, recovery: failed };
    }
  }
}
