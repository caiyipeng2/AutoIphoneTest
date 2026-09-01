import { describe, expect, it } from "vitest";

import { analyzeSoakEvidence, type SoakEvidence } from "../hardware/soak-analyzer.js";

const serials = ["leader-a", "follower-b", "follower-c", "follower-d"];

function makeEvidence(): SoakEvidence {
  return {
    schemaVersion: 1,
    status: "PASS",
    runId: "run-soak-1",
    serials,
    durationSeconds: 1_800,
    actionCount: 1_000,
    actions: Array.from({ length: 1_000 }, (_, index) => ({
      actionId: `action-${String(index)}`,
      actionSeq: index + 1,
      targets: serials.map((serial, targetIndex) => ({
        serial,
        state: "SUCCEEDED" as const,
        evidencePath: `runs/run-soak-1/${serial}/action-${String(index)}.json`,
        logPath: `runs/run-soak-1/${serial}/action-${String(index)}.log`,
        sha256: `${String(index * serials.length + targetIndex).padStart(64, "0")}`,
      })),
    })),
    cleanup: { workerCount: 0, portLeaseCount: 0, forwardCount: 0 },
  };
}

describe("M8 four-device soak analyzer", () => {
  it("passes a complete 1000-action four-device evidence set", () => {
    const result = analyzeSoakEvidence(makeEvidence());
    expect(result.status).toBe("PASS");
    expect(result.failures).toEqual([]);
  });

  it("rejects missing target rows and incomplete duration", () => {
    const evidence = makeEvidence();
    evidence.actions[12]!.targets = evidence.actions[12]!.targets.slice(0, 3);
    evidence.durationSeconds = 1_799;
    const result = analyzeSoakEvidence(evidence);
    expect(result.status).toBe("FAIL");
    expect(result.failures).toEqual(
      expect.arrayContaining(["ACTION_TARGET_CARDINALITY", "DURATION_BELOW_30_MINUTES"]),
    );
  });

  it("rejects cross-serial path reuse and duplicate target hashes", () => {
    const evidence = makeEvidence();
    evidence.actions[0]!.targets[1]!.evidencePath = evidence.actions[0]!.targets[0]!.evidencePath;
    evidence.actions[1]!.targets[1]!.sha256 = evidence.actions[1]!.targets[0]!.sha256;
    const result = analyzeSoakEvidence(evidence);
    expect(result.status).toBe("FAIL");
    expect(result.failures).toEqual(expect.arrayContaining(["PATH_COLLISION", "HASH_COLLISION"]));
  });
});
