import { createHash } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import ExcelJS from "exceljs";

import type {
  ImmutableReportAction,
  ImmutableReportDevice,
  ImmutableReportEvidence,
  ImmutableReportModel,
} from "./report-model.js";
import { safeSpreadsheetText } from "./spreadsheet-value.js";

export interface ExcelRenderResult {
  readonly content: Buffer;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly sanitizedValueCount: number;
}

export interface ExcelPublishResult extends ExcelRenderResult {
  readonly finalPath: string;
}

/** Renders and atomically publishes the optional Excel representation of an M10 report. */
export class ExcelReportExporter {
  public async render(model: ImmutableReportModel): Promise<ExcelRenderResult> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Unity Multi-Device Test Center";
    workbook.created = new Date(model.run.createdAt);
    workbook.modified = new Date(model.run.updatedAt);

    const builder = new SpreadsheetBuilder();
    addSummarySheet(workbook, model, builder);
    addDevicesSheet(workbook, model.devices, builder);
    addActionsSheet(workbook, model.actions, builder);
    addIncidentsSheet(workbook, model, builder);
    addEvidenceSheet(workbook, model.evidence, builder);

    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: content.byteLength,
      sanitizedValueCount: builder.sanitizedValueCount,
    };
  }

  public async publish(
    model: ImmutableReportModel,
    finalPath: string,
  ): Promise<ExcelPublishResult> {
    if (!isAbsolute(finalPath)) throw new TypeError("Excel export finalPath must be absolute.");
    const rendered = await this.render(model);
    const partialPath = `${finalPath}.partial`;
    await rm(partialPath, { force: true });
    try {
      await writeFile(partialPath, rendered.content);
      await rename(partialPath, finalPath);
    } catch (error) {
      await rm(partialPath, { force: true });
      throw error;
    }
    return { ...rendered, finalPath };
  }
}

class SpreadsheetBuilder {
  public sanitizedValueCount = 0;

  public text(value: string): string {
    const result = safeSpreadsheetText(value);
    if (result.sanitized) this.sanitizedValueCount += 1;
    return result.value;
  }

  public textList(values: readonly string[]): string {
    return values.map((value) => this.text(value)).join(", ");
  }
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  model: ImmutableReportModel,
  builder: SpreadsheetBuilder,
): void {
  const sheet = workbook.addWorksheet("Summary");
  configureSheet(sheet, ["Field", "Value"]);
  sheet.addRows([
    [builder.text("Package"), builder.text(model.run.packageName)],
    [builder.text("Run ID"), builder.text(model.run.id)],
    [builder.text("State"), builder.text(model.run.state)],
    [builder.text("Current epoch"), model.run.currentEpoch],
    [builder.text("Created at"), new Date(model.run.createdAt)],
    [builder.text("Updated at"), new Date(model.run.updatedAt)],
    [builder.text("Device count"), model.devices.length],
    [builder.text("Action count"), model.actions.length],
    [builder.text("Incident count"), model.incidents.length],
    [builder.text("Evidence count"), model.evidence.length],
  ]);
  applyDateFormat(sheet, [6, 7]);
}

function addDevicesSheet(
  workbook: ExcelJS.Workbook,
  devices: readonly ImmutableReportDevice[],
  builder: SpreadsheetBuilder,
): void {
  const sheet = workbook.addWorksheet("Devices");
  configureSheet(sheet, ["Serial", "UID", "Role", "Membership", "Generation"]);
  sheet.addRows(
    devices.map((device) => [
      builder.text(device.serial),
      builder.text(device.uid ?? ""),
      builder.text(device.role),
      builder.text(device.membershipState),
      device.generation,
    ]),
  );
}

function addActionsSheet(
  workbook: ExcelJS.Workbook,
  actions: readonly ImmutableReportAction[],
  builder: SpreadsheetBuilder,
): void {
  const sheet = workbook.addWorksheet("Actions");
  configureSheet(sheet, ["Sequence", "Action ID", "Type", "Label", "State", "Targets"]);
  sheet.addRows(
    actions.map((action) => [
      action.actionSeq,
      builder.text(action.id),
      builder.text(action.type),
      builder.text(action.label ?? action.type),
      builder.text(action.state),
      builder.textList(action.targets.map((target) => `${target.serial}: ${target.state}`)),
    ]),
  );
}

function addIncidentsSheet(
  workbook: ExcelJS.Workbook,
  model: ImmutableReportModel,
  builder: SpreadsheetBuilder,
): void {
  const sheet = workbook.addWorksheet("Incidents");
  configureSheet(sheet, [
    "Incident ID",
    "Category",
    "Serial",
    "Generation",
    "Detected at",
    "Source",
    "Evidence ref",
    "Details",
  ]);
  sheet.addRows(
    model.incidents.map((incident) => [
      builder.text(incident.incidentId),
      builder.text(incident.category),
      builder.text(incident.serial ?? ""),
      incident.generation ?? null,
      new Date(incident.detectedAt),
      builder.text(incident.source),
      builder.text(incident.evidenceRef ?? ""),
      builder.text(
        Object.entries(incident.details)
          .map(([key, value]) => `${key}: ${value}`)
          .join("; "),
      ),
    ]),
  );
  applyDateFormat(sheet, [5]);
}

function addEvidenceSheet(
  workbook: ExcelJS.Workbook,
  evidence: readonly ImmutableReportEvidence[],
  builder: SpreadsheetBuilder,
): void {
  const sheet = workbook.addWorksheet("Evidence");
  configureSheet(sheet, [
    "Evidence ID",
    "Kind",
    "State",
    "Serial",
    "Relative path",
    "SHA-256",
    "Size bytes",
    "Error category",
    "Unavailable reason",
  ]);
  sheet.addRows(
    evidence.map((entry) => [
      builder.text(entry.id),
      builder.text(entry.kind),
      builder.text(entry.state),
      builder.text(entry.serial ?? ""),
      builder.text(entry.finalRelativePath ?? ""),
      builder.text(entry.sha256 ?? ""),
      entry.sizeBytes ?? null,
      builder.text(entry.errorCategory ?? ""),
      builder.text(entry.unavailableReason ?? ""),
    ]),
  );
}

function configureSheet(sheet: ExcelJS.Worksheet, headers: readonly string[]): void {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns = headers.map((header) => ({ header, key: header, width: boundedWidth(header) }));
  sheet.autoFilter = { from: "A1", to: `${columnName(headers.length)}1` };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
}

function applyDateFormat(sheet: ExcelJS.Worksheet, rows: readonly number[]): void {
  for (const rowNumber of rows) sheet.getCell(`B${rowNumber}`).numFmt = "yyyy-mm-dd hh:mm:ss";
}

function boundedWidth(header: string): number {
  return Math.min(42, Math.max(14, header.length + 4));
}

function columnName(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
