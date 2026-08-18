import { describe, expect, it } from "vitest";

import { GIBIBYTE, StoragePolicy, type StorageOperation } from "./storage-policy.js";

describe("storage policy", () => {
  it.each([
    ["healthy boundary", 20 * GIBIBYTE, "NORMAL"],
    ["warning range", 10 * GIBIBYTE, "WARNING"],
    ["danger boundary", 5 * GIBIBYTE, "WARNING"],
    ["blocked range", 5 * GIBIBYTE - 1, "BLOCKED"],
  ] as const)("classifies %s as %s", (_name, freeBytes, pressure) => {
    const policy = new StoragePolicy();

    expect(policy.classify(freeBytes)).toBe(pressure);
  });

  it("treats an unknown free-space reading as blocked", () => {
    expect(new StoragePolicy().classify(undefined)).toBe("BLOCKED");
  });

  it.each(["START_RUN", "START_VIDEO"] as const)(
    "blocks %s below the danger threshold",
    (operation) => {
      const decision = new StoragePolicy().decide(operation, 5 * GIBIBYTE - 1);

      expect(decision).toMatchObject({
        operation,
        pressure: "BLOCKED",
        allowed: false,
        incident: { category: "STORAGE_PRESSURE", severity: "BLOCKED" },
      });
    },
  );

  it.each(["ACTION_WRITE", "EVIDENCE_WRITE", "REPORT_WRITE"] as const)(
    "allows %s under pressure but returns an incident",
    (operation) => {
      const decision = new StoragePolicy().decide(operation, 5 * GIBIBYTE - 1);

      expect(decision).toMatchObject({
        operation,
        pressure: "BLOCKED",
        allowed: true,
        incident: { category: "STORAGE_PRESSURE", severity: "BLOCKED" },
      });
    },
  );

  it("rejects invalid threshold ordering", () => {
    expect(
      () => new StoragePolicy({ warningBytes: 5 * GIBIBYTE, dangerBytes: 20 * GIBIBYTE }),
    ).toThrow(/dangerBytes.*warningBytes/i);
  });

  it("keeps the operation union explicit at compile time", () => {
    const operations: readonly StorageOperation[] = [
      "START_RUN",
      "START_VIDEO",
      "ACTION_WRITE",
      "EVIDENCE_WRITE",
      "REPORT_WRITE",
    ];

    expect(operations).toHaveLength(5);
  });
});
