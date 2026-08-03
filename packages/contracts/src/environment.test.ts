import { describe, expect, it } from "vitest";

import { EnvironmentDiagnosticSchema, ProbeErrorSchema, ProbeResultSchema } from "./environment.js";

const absoluteAdbPath = "E:\\Android\\Sdk\\platform-tools\\adb.exe";

function createProbe(severity: "HEALTHY" | "DEGRADED" | "FATAL") {
  return {
    id: "adb",
    severity,
    durationMs: 4,
    resolvedPath: absoluteAdbPath,
    version: "Android Debug Bridge version 1.0.41",
    facts: { deviceCount: 1 },
    errors: [],
  };
}

function createDiagnostic(overall: "HEALTHY" | "DEGRADED" | "FATAL") {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-31T00:00:00.000Z",
    overall,
    probes: [createProbe(overall)],
  };
}

describe("EnvironmentDiagnosticSchema", () => {
  it.each(["HEALTHY", "DEGRADED", "FATAL"] as const)(
    "accepts an explicit %s diagnostic",
    (severity) => {
      expect(EnvironmentDiagnosticSchema.parse(createDiagnostic(severity)).overall).toBe(severity);
    },
  );

  it("rejects an unknown severity", () => {
    expect(() =>
      EnvironmentDiagnosticSchema.parse({
        ...createDiagnostic("HEALTHY"),
        overall: "UNKNOWN",
      }),
    ).toThrow();
  });

  it("rejects a relative executable path", () => {
    expect(() =>
      EnvironmentDiagnosticSchema.parse({
        ...createDiagnostic("DEGRADED"),
        probes: [{ ...createProbe("DEGRADED"), resolvedPath: "adb.exe" }],
      }),
    ).toThrow();
  });

  it("rejects an empty optional executable path", () => {
    expect(() =>
      ProbeResultSchema.parse({
        ...createProbe("DEGRADED"),
        resolvedPath: "",
      }),
    ).toThrow();
  });

  it("preserves probe duration and categorized errors", () => {
    const error = ProbeErrorSchema.parse({
      category: "NOT_FOUND",
      message: "adb.exe was not found",
    });
    const parsed = ProbeResultSchema.parse({
      ...createProbe("DEGRADED"),
      durationMs: 37,
      errors: [error],
    });

    expect(parsed.durationMs).toBe(37);
    expect(parsed.errors).toEqual([error]);
  });
});
