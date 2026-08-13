import { describe, expect, it } from "vitest";

import { parseIncident, type IncidentCategory } from "@test-center/contracts/incident";
import { decideFailurePolicy } from "./failure-policy.js";

const incident = (category: IncidentCategory, serial?: string) =>
  parseIncident({
    schemaVersion: 1,
    incidentId: "inc-test-1",
    runId: "run-1",
    ...(serial === undefined ? {} : { serial }),
    category,
    generation: 1,
    detectedAtRealtimeMs: 100,
    detectedAt: "2026-08-13T06:00:00.000Z",
    source: "test",
    details: {},
  });

const members = [
  { serial: "leader-a", role: "LEADER" as const, membershipState: "ACTIVE" as const },
  { serial: "follower-b", role: "FOLLOWER" as const, membershipState: "ACTIVE" as const },
];

describe("decideFailurePolicy", () => {
  it("pauses the whole run under the default PAUSE_ALL policy", () => {
    const result = decideFailurePolicy({
      policy: "PAUSE_ALL",
      incident: incident("ADB_DISCONNECTED", "follower-b"),
      members,
    });
    expect(result).toMatchObject({
      action: "PAUSE_ALL",
      responseBudgetMs: 2000,
      deadlineRealtimeMs: 2100,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("quarantines only an active follower when explicitly configured", () => {
    const result = decideFailurePolicy({
      policy: "QUARANTINE_FAILED_DEVICE",
      incident: incident("BRIDGE_TIMEOUT", "follower-b"),
      members,
    });
    expect(result).toMatchObject({ action: "QUARANTINE_DEVICE", serial: "follower-b" });
  });

  it.each([
    ["leader failure", incident("APPIUM_SESSION_LOST", "leader-a")],
    ["sole member", incident("BRIDGE_TIMEOUT", "leader-a")],
    ["low disk", incident("LOW_DISK", "follower-b")],
    ["unknown member", incident("ADB_DISCONNECTED", "missing")],
  ])("forces PAUSE_ALL for %s", (_label, value) => {
    const scopedMembers =
      value.serial === "leader-a" && _label === "sole member" ? [members[0]!] : members;
    expect(
      decideFailurePolicy({
        policy: "QUARANTINE_FAILED_DEVICE",
        incident: value,
        members: scopedMembers,
      }).action,
    ).toBe("PAUSE_ALL");
  });

  it("rejects a decision clock that predates detection", () => {
    expect(() =>
      decideFailurePolicy({
        policy: "PAUSE_ALL",
        incident: incident("LOW_DISK"),
        members,
        nowRealtimeMs: 99,
      }),
    ).toThrow(/at or after/);
  });
});
