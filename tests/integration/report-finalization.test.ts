import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceZipVerifier } from "../../packages/reports/src/evidence-zip-verifier.js";
import { renderOfflineReport } from "../../packages/reports/src/html-renderer.js";
import { ReportSnapshotRepository } from "../../packages/reports/src/report-snapshot-repository.js";
import { createZipManifest } from "../../packages/reports/src/zip-manifest.js";
import { createReportFixture, type ReportFixture } from "./report-fixtures.js";

const fixtures: ReportFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("M10 report finalization fixtures", () => {
  it("finalizes normal, multi-device failure, and interrupted reports for offline use", async () => {
    for (const scenario of ["normal", "failure", "interrupted"] as const) {
      const fixture = await createReportFixture(scenario);
      fixtures.push(fixture);

      const result = await fixture.finalize();
      expect(result).toMatchObject({ state: "COMPLETED", attempt: 1 });

      const runId = `fixture-${scenario}`;
      const htmlPath = join(fixture.runRoot, runId, "reports", "report-1.html");
      const html = await readFile(htmlPath, "utf8");
      const state =
        scenario === "normal" ? "FINISHED" : scenario === "failure" ? "FAILED" : "INTERRUPTED";
      expect(html).toContain(`run <span class="mono">${runId}</span>`);
      expect(html).toContain(`>${state}</span>`);
      expect(html).toContain("default-src 'none'");
      expect(html).not.toContain("<script");

      const model = new ReportSnapshotRepository(fixture.database).load(runId);
      const reportHtml = renderOfflineReport(model);
      const reportHtmlSha256 = createHash("sha256").update(reportHtml).digest("hex");
      const manifest = createZipManifest({
        html: {
          relativePath: "reports/report-1.html",
          sha256: reportHtmlSha256,
          sizeBytes: Buffer.byteLength(reportHtml),
        },
        evidence: model.evidence.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          state: entry.state,
          ...(entry.serial === undefined ? {} : { serial: entry.serial }),
          ...(entry.finalRelativePath === undefined
            ? {}
            : { finalRelativePath: entry.finalRelativePath.replaceAll("\\", "/") }),
          ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 }),
          ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
          ...(entry.errorCategory === undefined ? {} : { errorCategory: entry.errorCategory }),
          ...(entry.unavailableReason === undefined
            ? {}
            : { unavailableReason: entry.unavailableReason }),
        })),
      });
      const verified = await new EvidenceZipVerifier({ runRoot: fixture.runRoot }).verify({
        relativePath: `${runId}/reports/evidence-1.zip`,
        manifest,
      });
      expect(verified.state).toBe("VERIFIED");
      expect(verified.entries.some((entry) => entry.path === "reports/report-1.html")).toBe(true);
    }
  });

  it("keeps the failure fixture bound to two devices and an explicit recovery record", async () => {
    const fixture = await createReportFixture("failure");
    fixtures.push(fixture);

    const model = new ReportSnapshotRepository(fixture.database).load("fixture-failure");
    expect(model.devices).toHaveLength(2);
    expect(model.actions[0]).toMatchObject({ state: "FAILED" });
    expect(model.incidents[0]).toMatchObject({ category: "APP_CRASH_OR_ANR" });
    expect(model.recoveries[0]).toMatchObject({ action: "QUARANTINE_DEVICE", status: "SUCCEEDED" });
    expect(model.evidence.some((entry) => entry.state === "MISSING")).toBe(true);
  });
});
