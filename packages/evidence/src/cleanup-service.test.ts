import { describe, expect, it } from "vitest";

import { CleanupService, type CleanupRun, type CleanupStorageEntry } from "./cleanup-service.js";

const now = "2026-08-18T00:00:00.000Z";

function run(overrides: Partial<CleanupRun> = {}): CleanupRun {
  return {
    runId: "run-1",
    state: "COMPLETED",
    completedAt: "2026-07-18T00:00:00.000Z",
    protected: false,
    storage: [],
    ...overrides,
  };
}

function entry(
  kind: CleanupStorageEntry["kind"],
  sizeBytes: number,
  state: CleanupStorageEntry["state"] = "READY",
): CleanupStorageEntry {
  return { kind, state, sizeBytes };
}

describe("cleanup service retention preview", () => {
  it("selects expired terminal runs and sums only owned evidence and reports", () => {
    const service = new CleanupService({ retentionDays: 30 });

    const preview = service.preview(
      [
        run({
          storage: [
            entry("EVIDENCE", 100),
            entry("REPORT", 200),
            entry("IMPORTED_ARTIFACT", 9_999),
            entry("EVIDENCE", 50, "FAILED"),
          ],
        }),
        run({
          runId: "protected-run",
          protected: true,
          storage: [entry("EVIDENCE", 500)],
        }),
        run({
          runId: "active-run",
          state: "RUNNING",
          storage: [entry("EVIDENCE", 700)],
        }),
        run({
          runId: "finalizing-run",
          state: "FINALIZING",
          storage: [entry("REPORT", 800)],
        }),
      ],
      now,
    );

    expect(preview).toEqual({
      cutoffAt: "2026-07-19T00:00:00.000Z",
      candidates: [
        {
          runId: "run-1",
          state: "COMPLETED",
          completedAt: "2026-07-18T00:00:00.000Z",
          estimatedBytes: 300,
        },
      ],
      totalEstimatedBytes: 300,
    });
  });

  it("includes failed and interrupted terminal runs only when older than the cutoff", () => {
    const service = new CleanupService({ retentionDays: 30 });

    const preview = service.preview(
      [
        run({ runId: "failed-run", state: "FAILED" }),
        run({
          runId: "interrupted-run",
          state: "INTERRUPTED",
          completedAt: "2026-07-19T00:00:00.000Z",
        }),
      ],
      now,
    );

    expect(preview.candidates.map((candidate) => candidate.runId)).toEqual(["failed-run"]);
  });

  it("rejects invalid retention settings and storage sizes", () => {
    expect(() => new CleanupService({ retentionDays: 0 })).toThrow(/retentionDays/);
    const service = new CleanupService({ retentionDays: 30 });
    expect(() => service.preview([run({ storage: [entry("REPORT", -1)] })], now)).toThrow(
      /sizeBytes/,
    );
  });
});
