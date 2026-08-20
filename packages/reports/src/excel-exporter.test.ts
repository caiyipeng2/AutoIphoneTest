import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import { createImmutableReportModel, type ReportModelInput } from "./report-model.js";
import { ExcelReportExporter } from "./excel-exporter.js";

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

describe("ExcelReportExporter", () => {
  it("creates the fixed report worksheets with typed trusted fields and safe untrusted text", async () => {
    const model = createImmutableReportModel(createFixtureInput());
    const result = await new ExcelReportExporter().render(model);
    const workbook = new ExcelJS.Workbook();
    const workbookBuffer = result.content as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookBuffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Devices",
      "Actions",
      "Incidents",
      "Evidence",
    ]);
    expect(result.sanitizedValueCount).toBeGreaterThanOrEqual(2);

    const summary = workbook.getWorksheet("Summary")!;
    expect(summary.getCell("B5").value).toBe(3);
    expect(summary.getCell("B6").value).toBeInstanceOf(Date);
    expect(summary.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });

    const devices = workbook.getWorksheet("Devices")!;
    expect(devices.getCell("A2").value).toBe("ABC1234567");
    expect(devices.getCell("B2").value).toBe("'@leader");
    expect(devices.getCell("B2").type).not.toBe(ExcelJS.ValueType.Formula);
    expect(devices.getCell("E2").value).toBe(3);
    expect(devices.autoFilter).toBe("A1:E1");

    const actions = workbook.getWorksheet("Actions")!;
    expect(actions.getCell("D2").value).toBe("'=Open shop");
    expect(actions.getCell("D2").type).not.toBe(ExcelJS.ValueType.Formula);
    expect(actions.getCell("A2").value).toBe(1);
    expect(actions.getCell("F2").value).toBe("ABC1234567: SUCCEEDED");

    const evidence = workbook.getWorksheet("Evidence")!;
    expect(evidence.getCell("F2").value).toBe("a".repeat(64));
    expect(evidence.getCell("G2").value).toBe(123);
    expect(evidence.getCell("E2").value).toBe("evidence/logcat.txt");
  });

  it("publishes an atomic workbook and returns a stable hash and byte size", async () => {
    const model = createImmutableReportModel(createFixtureInput());
    const finalPath = join(tmpdir(), `test-center-excel-${Date.now()}.xlsx`);
    temporaryPaths.push(finalPath, `${finalPath}.partial`);

    const result = await new ExcelReportExporter().publish(model, finalPath);
    const bytes = await readFile(finalPath);

    expect(result.finalPath).toBe(finalPath);
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sanitizedValueCount).toBeGreaterThan(0);
    await expect(readFile(`${finalPath}.partial`)).rejects.toMatchObject({ code: "ENOENT" });

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.readFile(finalPath);
    expect(reopened.getWorksheet("Summary")?.getCell("B2").value).toBe("Idle Weapon Shop Tycoon");
  });
});

function createFixtureInput(): ReportModelInput {
  return {
    schemaVersion: 1,
    run: {
      id: "run-excel",
      packageName: "Idle Weapon Shop Tycoon",
      state: "FINISHED",
      currentEpoch: 3,
      createdAt: "2026-08-20T01:00:00.000Z",
      updatedAt: "2026-08-20T01:05:00.000Z",
    },
    devices: [
      {
        serial: "ABC1234567",
        uid: "@leader",
        role: "LEADER",
        membershipState: "ACTIVE",
        generation: 3,
      },
    ],
    actions: [
      {
        id: "action-1",
        actionSeq: 1,
        type: "tap",
        state: "SUCCEEDED",
        label: "=Open shop",
        targets: [{ serial: "ABC1234567", state: "SUCCEEDED" }],
      },
    ],
    evidence: [
      {
        id: "evidence-logcat",
        kind: "REDACTED_LOGCAT",
        state: "READY",
        serial: "ABC1234567",
        finalRelativePath: "evidence/logcat.txt",
        sha256: "a".repeat(64),
        sizeBytes: 123,
      },
    ],
    incidents: [],
    recoveries: [],
  };
}
