import type { FailurePolicy, Incident, IncidentCategory } from "@test-center/contracts/incident";

export type FailurePolicyAction = "PAUSE_ALL" | "QUARANTINE_DEVICE";

export interface FailurePolicyMember {
  readonly serial: string;
  readonly role: "LEADER" | "FOLLOWER";
  readonly membershipState: "ACTIVE" | "RECOVERING";
}

export interface FailurePolicyInput {
  readonly policy: FailurePolicy;
  readonly incident: Incident;
  readonly members: readonly FailurePolicyMember[];
  readonly nowRealtimeMs?: number;
}

export interface FailurePolicyDecision {
  readonly action: FailurePolicyAction;
  readonly incident: Incident;
  readonly serial?: string;
  readonly reason: string;
  readonly responseBudgetMs: 2_000;
  readonly deadlineRealtimeMs: number;
}

const ALWAYS_PAUSE: ReadonlySet<IncidentCategory> = new Set(["LOW_DISK"]);

export function decideFailurePolicy(input: FailurePolicyInput): FailurePolicyDecision {
  const now = input.nowRealtimeMs ?? input.incident.detectedAtRealtimeMs;
  if (!Number.isFinite(now) || now < input.incident.detectedAtRealtimeMs) {
    throw new TypeError("nowRealtimeMs must be at or after incident detection.");
  }
  const members = input.members.filter((member) => member.membershipState === "ACTIVE");
  const failed =
    input.incident.serial === undefined
      ? undefined
      : members.find((member) => member.serial === input.incident.serial);
  const leader = members.find((member) => member.role === "LEADER");
  const mustPause =
    input.policy === "PAUSE_ALL" ||
    ALWAYS_PAUSE.has(input.incident.category) ||
    failed === undefined ||
    failed.role === "LEADER" ||
    members.length <= 1;
  const action: FailurePolicyAction = mustPause ? "PAUSE_ALL" : "QUARANTINE_DEVICE";
  const reason =
    action === "PAUSE_ALL"
      ? explainPause(input, failed, leader)
      : `Active follower ${failed!.serial} is eligible for quarantine.`;
  return Object.freeze({
    action,
    incident: Object.freeze({
      ...input.incident,
      details: Object.freeze({ ...input.incident.details }),
    }),
    ...(action === "QUARANTINE_DEVICE" ? { serial: failed!.serial } : {}),
    reason,
    responseBudgetMs: 2_000 as const,
    deadlineRealtimeMs: input.incident.detectedAtRealtimeMs + 2_000,
  });
}

function explainPause(
  input: FailurePolicyInput,
  failed: FailurePolicyMember | undefined,
  leader: FailurePolicyMember | undefined,
): string {
  if (input.policy === "PAUSE_ALL") return "Configured PAUSE_ALL policy requires a run pause.";
  if (input.incident.category === "LOW_DISK") return "Low disk is a run-wide safety incident.";
  if (failed === undefined) return "Incident has no active member eligible for quarantine.";
  if (failed.role === "LEADER") return `Leader ${failed.serial} failed; quarantine is not allowed.`;
  if (leader === undefined) return "Run has no active leader; quarantine is not allowed.";
  return "The remaining active membership cannot safely continue after this incident.";
}
