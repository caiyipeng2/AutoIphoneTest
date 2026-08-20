import { createHash } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type {
  ImmutableReportAction,
  ImmutableReportActionTarget,
  ImmutableReportDevice,
  ImmutableReportModel,
} from "./report-model.js";

export interface JunitRenderResult {
  readonly content: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface JunitPublishResult extends JunitRenderResult {
  readonly finalPath: string;
}

interface TestCaseResult {
  readonly name: string;
  readonly action: ImmutableReportAction;
  readonly target?: ImmutableReportActionTarget;
  readonly device?: ImmutableReportDevice;
  readonly outcome: "passed" | "failure" | "error" | "skipped";
  readonly message?: string;
}

/** Renders only sanitized report state and evidence metadata as JUnit XML. */
export class JunitReportExporter {
  public render(model: ImmutableReportModel): JunitRenderResult {
    const testCases = createTestCases(model);
    const failures = testCases.filter((testCase) => testCase.outcome === "failure").length;
    const errors = testCases.filter((testCase) => testCase.outcome === "error").length;
    const skipped = testCases.filter((testCase) => testCase.outcome === "skipped").length;
    const evidenceMetadata = model.evidence
      .filter(
        (entry) =>
          entry.state === "READY" &&
          entry.finalRelativePath !== undefined &&
          entry.sha256 !== undefined,
      )
      .map((entry) => `${entry.id}: ${entry.finalRelativePath} sha256=${entry.sha256}`)
      .join("\n");
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuite name="${escapeXmlAttribute(model.run.id)}" tests="${testCases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" timestamp="${escapeXmlAttribute(model.run.createdAt)}" time="${formatDuration(model)}">`,
      "  <properties>",
      `    <property name="artifact" value="${escapeXmlAttribute(model.run.packageName)}"/>`,
      `    <property name="run_id" value="${escapeXmlAttribute(model.run.id)}"/>`,
      "  </properties>",
      ...testCases.map((testCase) => renderTestCase(testCase)),
      ...(evidenceMetadata === ""
        ? []
        : [`  <system-out>${escapeXmlText(evidenceMetadata)}</system-out>`]),
      "</testsuite>",
      "",
    ];
    const content = lines.join("\n");
    const bytes = Buffer.from(content, "utf8");
    return {
      content,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
    };
  }

  public async publish(
    model: ImmutableReportModel,
    finalPath: string,
  ): Promise<JunitPublishResult> {
    if (!isAbsolute(finalPath)) throw new TypeError("JUnit export finalPath must be absolute.");
    const rendered = this.render(model);
    const partialPath = `${finalPath}.partial`;
    await rm(partialPath, { force: true });
    try {
      await writeFile(partialPath, rendered.content, "utf8");
      await rename(partialPath, finalPath);
    } catch (error) {
      await rm(partialPath, { force: true });
      throw error;
    }
    return { ...rendered, finalPath };
  }
}

function createTestCases(model: ImmutableReportModel): readonly TestCaseResult[] {
  const testCases: TestCaseResult[] = [];
  for (const action of model.actions) {
    if (action.targets.length === 0) {
      testCases.push({
        name: `action-${action.actionSeq}:${action.type}:no-target`,
        action,
        outcome: "skipped",
        message: "NO_TARGET",
      });
      continue;
    }
    for (const target of action.targets) {
      const device = model.devices.find((candidate) => candidate.serial === target.serial);
      const outcome = mapOutcome(action.state, target.state);
      testCases.push({
        name: `action-${action.actionSeq}:${action.type}:${target.serial}`,
        action,
        target,
        ...(device === undefined ? {} : { device }),
        outcome,
        ...(outcome === "failure"
          ? { message: "TARGET_FAILED" }
          : outcome === "error"
            ? { message: "UNKNOWN" }
            : outcome === "skipped"
              ? { message: "CANCELLED" }
              : {}),
      });
    }
  }
  return testCases;
}

function mapOutcome(
  actionState: ImmutableReportAction["state"],
  targetState: ImmutableReportActionTarget["state"],
): TestCaseResult["outcome"] {
  if (targetState === "FAILED") return "failure";
  if (targetState === "UNKNOWN") return "error";
  if (targetState === "CANCELLED" || actionState === "CANCELLED") return "skipped";
  if (targetState === "SUCCEEDED") return "passed";
  return "error";
}

function renderTestCase(testCase: TestCaseResult): string {
  const attributes = [`name="${escapeXmlAttribute(testCase.name)}"`, `time="0.000"`];
  const properties = [
    `    <property name="action_id" value="${escapeXmlAttribute(testCase.action.id)}"/>`,
    `    <property name="action_type" value="${escapeXmlAttribute(testCase.action.type)}"/>`,
  ];
  if (testCase.target !== undefined) {
    properties.push(
      `    <property name="serial" value="${escapeXmlAttribute(testCase.target.serial)}"/>`,
    );
  }
  if (testCase.device !== undefined) {
    properties.push(
      `    <property name="uid" value="${escapeXmlAttribute(testCase.device.uid ?? "")}"/>`,
      `    <property name="generation" value="${testCase.device.generation}"/>`,
    );
  }
  const body = [
    `  <testcase ${attributes.join(" ")}>`,
    "  <properties>",
    ...properties,
    "  </properties>",
    ...(testCase.outcome === "failure"
      ? [`  <failure type="TARGET_FAILED">Target action failed.</failure>`]
      : testCase.outcome === "error"
        ? [`  <error type="UNKNOWN">Target action outcome is unknown.</error>`]
        : testCase.outcome === "skipped"
          ? [`  <skipped message="${escapeXmlAttribute(testCase.message ?? "CANCELLED")}"/>`]
          : []),
    "  </testcase>",
  ];
  return body.join("\n");
}

function formatDuration(model: ImmutableReportModel): string {
  const started = Date.parse(model.run.createdAt);
  const finished = Date.parse(model.run.updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return "0.000";
  return Math.max(0, (finished - started) / 1000).toFixed(3);
}

function escapeXmlText(value: string): string {
  return normalizeXmlCharacters(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function normalizeXmlCharacters(value: string): string {
  let normalized = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const valid =
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    normalized += valid ? character : " ";
  }
  return normalized;
}
