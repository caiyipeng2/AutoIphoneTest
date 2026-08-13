import { describe, expect, it, vi } from "vitest";

import type { FailurePolicyMember } from "./failure-policy.js";
import {
  RuntimeFaultMonitor,
  type RuntimeFaultEvent,
  type RuntimeFaultRun,
} from "./runtime-fault-monitor.js";

const members: readonly FailurePolicyMember[] = [
  { serial: "leader-a", role: "LEADER", membershipState: "ACTIVE" },
  { serial: "follower-b", role: "FOLLOWER", membershipState: "ACTIVE" },
];

function event(
  category: RuntimeFaultEvent["category"],
  faultId: string,
  serial = "follower-b",
): RuntimeFaultEvent {
  return {
    runId: "run-a",
    serial,
    generation: 2,
    faultId,
    category,
    source: "device-worker",
    message: `${category} happened`,
    detectedAt: "2026-08-13T10:00:00.000Z",
    detectedAtRealtimeMs: 42,
  };
}

describe("RuntimeFaultMonitor", () => {
  it("maps Appium session loss to an incident for the active member", async () => {
    let emit: ((fault: RuntimeFaultEvent) => void) | undefined;
    const handleIncident = vi.fn(async () => undefined);
    const monitor = new RuntimeFaultMonitor({
      subscribe: (listener) => {
        emit = listener;
        return () => undefined;
      },
      listRuns: () => [{ runId: "run-a", policy: "QUARANTINE_FAILED_DEVICE", members }],
      handleIncident,
    });

    monitor.start();
    emit!(event("APPIUM_SESSION_LOST", "fault-1"));
    await monitor.flush();

    expect(handleIncident).toHaveBeenCalledWith({
      incident: expect.objectContaining({
        incidentId: "inc-appium-session-lost-run-a-follower-b-fault-1",
        runId: "run-a",
        serial: "follower-b",
        category: "APPIUM_SESSION_LOST",
        generation: 2,
        source: "device-worker",
        evidenceRef: "fault:fault-1",
        details: { message: "APPIUM_SESSION_LOST happened", faultId: "fault-1" },
      }),
      policy: "QUARANTINE_FAILED_DEVICE",
      members,
    });
  });

  it.each(["BRIDGE_TIMEOUT", "BRIDGE_STATE_MISMATCH"] as const)(
    "maps %s without changing the policy",
    async (category) => {
      let emit: ((fault: RuntimeFaultEvent) => void) | undefined;
      const handleIncident = vi.fn(async () => undefined);
      const run: RuntimeFaultRun = {
        runId: "run-a",
        policy: "PAUSE_ALL",
        members,
      };
      const monitor = new RuntimeFaultMonitor({
        subscribe: (listener) => {
          emit = listener;
          return () => undefined;
        },
        listRuns: () => [run],
        handleIncident,
      });

      monitor.start();
      emit!(event(category, "fault-2"));
      await monitor.flush();

      expect(handleIncident).toHaveBeenCalledWith({
        incident: expect.objectContaining({ category }),
        policy: run.policy,
        members,
      });
    },
  );

  it("ignores inactive members and deduplicates a fault id per run", async () => {
    let emit: ((fault: RuntimeFaultEvent) => void) | undefined;
    const handleIncident = vi.fn(async () => undefined);
    const monitor = new RuntimeFaultMonitor({
      subscribe: (listener) => {
        emit = listener;
        return () => undefined;
      },
      listRuns: () => [
        {
          runId: "run-a",
          policy: "QUARANTINE_FAILED_DEVICE",
          members: members.map((member) =>
            member.serial === "follower-b"
              ? { ...member, membershipState: "QUARANTINED" as const }
              : member,
          ),
        },
      ],
      handleIncident,
    });

    monitor.start();
    emit!(event("BRIDGE_TIMEOUT", "fault-3"));
    await monitor.flush();
    expect(handleIncident).not.toHaveBeenCalled();

    const activeMonitor = new RuntimeFaultMonitor({
      subscribe: (listener) => {
        emit = listener;
        return () => undefined;
      },
      listRuns: () => [{ runId: "run-a", policy: "QUARANTINE_FAILED_DEVICE", members }],
      handleIncident,
    });
    activeMonitor.start();
    emit!(event("BRIDGE_TIMEOUT", "fault-4"));
    emit!(event("BRIDGE_TIMEOUT", "fault-4"));
    await activeMonitor.flush();
    expect(handleIncident).toHaveBeenCalledTimes(1);
  });
});
