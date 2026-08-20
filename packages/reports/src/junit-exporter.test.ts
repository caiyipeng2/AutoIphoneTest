import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createImmutableReportModel, type ReportModelInput } from "./report-model.js";
import { JunitReportExporter } from "./junit-exporter.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map(async (path) => {
      try {
        await import("node:fs/promises").then(({ rm }) => rm(path, { force: true }));
      } catch {
        // Best effort cleanup keeps a failed assertion from hiding its evidence.
      }
    }),
  );
});

describe("JunitReportExporter", () => {
  it("maps every action target to an escaped, deterministic testcase", () => {
    const model = createImmutableReportModel(createFixtureInput());
    const result = new JunitReportExporter().render(model);

    expect(result.content).toContain('<testsuite name="run-&amp;-junit" tests="4"');
    expect(result.content).toContain('failures="1" errors="1" skipped="1"');
    expect(result.content).toContain(
      '<property name="artifact" value="Idle &amp; Weapon Shop Tycoon"',
    );
    expect(result.content).toContain('<property name="serial" value="ABC1234567"');
    expect(result.content).toContain('<property name="uid" value="UID-&lt;leader&gt;"');
    expect(result.content).toContain('<property name="generation" value="2"');
    expect(result.content).toContain('<failure type="TARGET_FAILED"');
    expect(result.content).toContain('<error type="UNKNOWN"');
    expect(result.content).toContain('<skipped message="CANCELLED"');
    expect(result.content).toContain("evidence/redacted.logcat.txt");
    expect(result.content).toContain("a".repeat(64));
    expect(result.content).not.toContain("SECRET_TOKEN");
    expect(result.content).not.toContain("<open shop>");
    expect(result.content).toMatch(/^<\?xml[\s\S]*\n<testsuite[\s\S]*<\/testsuite>\n$/);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBe(Buffer.byteLength(result.content, "utf8"));
    expect(new JunitReportExporter().render(model).content).toBe(result.content);
  });

  it("publishes atomically and removes the partial XML path", async () => {
    const model = createImmutableReportModel(createFixtureInput());
    const finalPath = join(tmpdir(), `test-center-junit-${Date.now()}.xml`);
    temporaryPaths.push(finalPath, `${finalPath}.partial`);

    const result = await new JunitReportExporter().publish(model, finalPath);
    const bytes = await readFile(finalPath, "utf8");

    expect(result.finalPath).toBe(finalPath);
    expect(result.content).toBe(bytes);
    expect(result.sizeBytes).toBe(Buffer.byteLength(bytes, "utf8"));
    await expect(readFile(`${finalPath}.partial`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function createFixtureInput(): ReportModelInput {
  return {
    schemaVersion: 1,
    run: {
      id: "run-&-junit",
      packageName: "Idle & Weapon Shop Tycoon",
      state: "FAILED",
      currentEpoch: 2,
      createdAt: "2026-08-20T02:00:00.000Z",
      updatedAt: "2026-08-20T02:01:30.000Z",
    },
    devices: [
      {
        serial: "ABC1234567",
        uid: "UID-<leader>",
        role: "LEADER",
        membershipState: "ACTIVE",
        generation: 2,
      },
      {
        serial: "ZX2G22B7F8",
        uid: "UID-follower",
        role: "FOLLOWER",
        membershipState: "QUARANTINED",
        generation: 1,
      },
    ],
    actions: [
      {
        id: "action-1",
        actionSeq: 1,
        type: "tap",
        state: "FAILED",
        label: "<open shop> SECRET_TOKEN=do-not-export",
        targets: [
          { serial: "ABC1234567", state: "SUCCEEDED" },
          { serial: "ZX2G22B7F8", state: "FAILED" },
        ],
      },
      {
        id: "action-2",
        actionSeq: 2,
        type: "swipe",
        state: "CANCELLED",
        label: "cancelled action",
        targets: [{ serial: "ZX2G22B7F8", state: "CANCELLED" }],
      },
      {
        id: "action-3",
        actionSeq: 3,
        type: "tap",
        state: "UNKNOWN",
        label: "unknown action",
        targets: [{ serial: "ABC1234567", state: "UNKNOWN" }],
      },
    ],
    evidence: [
      {
        id: "evidence-logcat",
        kind: "REDACTED_LOGCAT",
        state: "READY",
        serial: "ABC1234567",
        finalRelativePath: "evidence/redacted.logcat.txt",
        sha256: "a".repeat(64),
        sizeBytes: 11,
      },
    ],
    incidents: [],
    recoveries: [],
  };
}
