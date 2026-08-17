import { describe, expect, it } from "vitest";

import { createImmutableReportModel, type ReportModelInput } from "./report-model.js";
import { renderOfflineReport } from "./html-renderer.js";

function createFixture(): ReportModelInput {
  return {
    schemaVersion: 1,
    run: {
      id: "run-html-1",
      packageName: "<script>alert(1)</script>",
      state: "FAILED",
      currentEpoch: 1,
      createdAt: "2026-08-14T01:00:00.000Z",
      updatedAt: "2026-08-14T01:05:00.000Z",
    },
    devices: [
      {
        serial: "ABC1234567",
        uid: 'UID-1" onmouseover="alert(1)',
        role: "LEADER",
        membershipState: "ACTIVE",
        generation: 1,
      },
    ],
    actions: [
      {
        id: "act-1",
        actionSeq: 1,
        type: "tap",
        state: "FAILED",
        label: '<img src=x onerror="alert(1)">',
        targets: [{ serial: "ABC1234567", state: "FAILED" }],
      },
    ],
    evidence: [
      {
        id: "ev-ready",
        kind: "REDACTED_LOGCAT",
        state: "READY",
        serial: "ABC1234567",
        finalRelativePath: 'evidence/logcat-1".txt',
        sha256: "a".repeat(64),
        sizeBytes: 12,
      },
      {
        id: "ev-missing",
        kind: "CURRENT_SCREENSHOT",
        state: "MISSING",
        unavailableReason: "DEVICE_DISCONNECTED",
      },
      {
        id: "ev-failed",
        kind: "VIDEO",
        state: "FAILED",
        errorCategory: "capture <failed>",
      },
    ],
    incidents: [
      {
        incidentId: "inc-1",
        category: "APP_CRASH_OR_ANR",
        serial: "ABC1234567",
        detectedAtRealtimeMs: 100,
        detectedAt: "2026-08-14T01:03:00.000Z",
        source: "watchdog",
        details: { message: "crash <detected>" },
      },
    ],
    recoveries: [
      {
        id: "recovery-1",
        incidentId: "inc-1",
        action: "QUARANTINE_DEVICE",
        targetSerial: "ABC1234567",
        reason: "isolate device",
        deadlineRealtimeMs: 500,
        status: "FAILED",
        startedAt: "2026-08-14T01:03:01.000Z",
        completedAt: "2026-08-14T01:03:02.000Z",
        errorMessage: "recovery <failed>",
      },
    ],
  };
}

describe("offline HTML report renderer", () => {
  it("renders a self-contained report with summary, device, action, and evidence sections", () => {
    const html = renderOfflineReport(createImmutableReportModel(createFixture()));

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain("run-html-1");
    expect(html).toContain("ABC1234567");
    expect(html).toContain("REDACTED_LOGCAT");
    expect(html).toContain("DEVICE_DISCONNECTED");
    expect(html).toContain("Incident log");
    expect(html).toContain("Recovery attempts");
    expect(html).toContain('href="evidence/logcat-1&quot;.txt"');
    expect(html).toContain("inline-style");
  });

  it("escapes hostile values and emits no executable or network content", () => {
    const html = renderOfflineReport(createImmutableReportModel(createFixture()));

    expect(html).not.toContain("<script");
    expect(html).not.toContain('onmouseover="');
    expect(html).not.toContain('onerror="');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;failed&gt;");
    expect(html).toContain("crash &lt;detected&gt;");
    expect(html).toContain("recovery &lt;failed&gt;");
    expect(html).not.toMatch(/(?:https?:|data:|javascript:)/i);
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
  });

  it("includes print and narrow-screen layout rules without JavaScript", () => {
    const html = renderOfflineReport(createImmutableReportModel(createFixture()));

    expect(html).toContain("@media print");
    expect(html).toContain("@media (max-width: 720px)");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });
});
