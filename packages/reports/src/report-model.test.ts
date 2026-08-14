import { describe, expect, it } from "vitest";

import { createImmutableReportModel, type ReportModelInput } from "./report-model.js";

describe("immutable offline report model", () => {
  it("normalizes ordering and deep-freezes the report snapshot", () => {
    const input = {
      schemaVersion: 1 as const,
      run: {
        id: "run-normal",
        packageName: "Idle Weapon Shop Tycoon",
        state: "FINISHED" as const,
        currentEpoch: 2,
        createdAt: "2026-08-14T01:00:00.000Z",
        updatedAt: "2026-08-14T01:05:00.000Z",
      },
      devices: [
        {
          serial: "ZX2G22B7F8",
          uid: "uid-follower",
          role: "FOLLOWER" as const,
          membershipState: "ACTIVE" as const,
          generation: 1,
        },
        {
          serial: "ABC1234567",
          uid: "uid-leader",
          role: "LEADER" as const,
          membershipState: "ACTIVE" as const,
          generation: 3,
        },
      ],
      actions: [
        {
          id: "act-2",
          actionSeq: 2,
          type: "tap" as const,
          state: "SUCCEEDED" as const,
          label: "升级武器",
          targets: [{ serial: "ZX2G22B7F8", state: "SUCCEEDED" as const }],
        },
        {
          id: "act-1",
          actionSeq: 1,
          type: "tap" as const,
          state: "FAILED" as const,
          label: "打开商店",
          targets: [{ serial: "ABC1234567", state: "FAILED" as const }],
        },
      ],
      evidence: [
        {
          id: "ev-2",
          kind: "REDACTED_LOGCAT" as const,
          state: "READY" as const,
          serial: "ZX2G22B7F8",
          finalRelativePath: "evidence/logcat-2.txt",
          sha256: "a".repeat(64),
          sizeBytes: 20,
        },
        {
          id: "ev-1",
          kind: "CURRENT_SCREENSHOT" as const,
          state: "MISSING" as const,
          unavailableReason: "DEVICE_DISCONNECTED" as const,
        },
      ],
    };

    const model = createImmutableReportModel(input);
    expect(model.devices.map((device) => device.serial)).toEqual(["ABC1234567", "ZX2G22B7F8"]);
    expect(model.actions.map((action) => action.id)).toEqual(["act-1", "act-2"]);
    expect(model.evidence.map((entry) => entry.id)).toEqual(["ev-1", "ev-2"]);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.devices)).toBe(true);
    expect(Object.isFrozen(model.devices[0]!)).toBe(true);
    expect(Object.isFrozen(model.actions[0]!.targets)).toBe(true);
    expect(() => {
      (model.run as { packageName: string }).packageName = "tampered";
    }).toThrow(TypeError);
    expect(input.devices[0]?.serial).toBe("ZX2G22B7F8");
  });

  it("accepts failed and interrupted runs while rejecting live states", () => {
    const base = {
      schemaVersion: 1 as const,
      run: {
        id: "run-status",
        packageName: "Idle Weapon Shop Tycoon",
        state: "FAILED" as const,
        currentEpoch: 1,
        createdAt: "2026-08-14T01:00:00.000Z",
        updatedAt: "2026-08-14T01:01:00.000Z",
      },
      devices: [],
      actions: [],
      evidence: [],
    };

    expect(createImmutableReportModel(base).run.state).toBe("FAILED");
    expect(
      createImmutableReportModel({
        ...base,
        run: { ...base.run, state: "INTERRUPTED" },
      }).run.state,
    ).toBe("INTERRUPTED");
    expect(() =>
      createImmutableReportModel({
        ...base,
        run: { ...base.run, state: "RUNNING" },
      } as unknown as ReportModelInput),
    ).toThrow(/terminal|reportable|state/i);
  });

  it("rejects duplicate identities and unsafe evidence paths", () => {
    const base = {
      schemaVersion: 1 as const,
      run: {
        id: "run-invalid",
        packageName: "Idle Weapon Shop Tycoon",
        state: "FINISHED" as const,
        currentEpoch: 1,
        createdAt: "2026-08-14T01:00:00.000Z",
        updatedAt: "2026-08-14T01:01:00.000Z",
      },
      devices: [
        {
          serial: "ABC1234567",
          role: "LEADER" as const,
          membershipState: "ACTIVE" as const,
          generation: 1,
        },
        {
          serial: "ABC1234567",
          role: "FOLLOWER" as const,
          membershipState: "ACTIVE" as const,
          generation: 1,
        },
      ],
      actions: [],
      evidence: [],
    };
    expect(() => createImmutableReportModel(base)).toThrow(/serial|duplicate/i);

    expect(() =>
      createImmutableReportModel({
        ...base,
        devices: [],
        evidence: [
          {
            id: "ev-unsafe",
            kind: "REDACTED_LOGCAT" as const,
            state: "READY" as const,
            finalRelativePath: "../raw.log",
            sha256: "b".repeat(64),
            sizeBytes: 1,
          },
        ],
      }),
    ).toThrow(/relative|path/i);
  });
});
