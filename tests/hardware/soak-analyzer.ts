import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SoakTarget {
  serial: string;
  state: string;
  evidencePath: string;
  logPath: string;
  sha256: string;
}

export interface SoakAction {
  actionId: string;
  actionSeq: number;
  targets: SoakTarget[];
}

export interface SoakEvidence {
  schemaVersion: number;
  status: string;
  runId: string;
  serials: readonly string[];
  durationSeconds: number;
  actionCount: number;
  actions: SoakAction[];
  cleanup: {
    workerCount: number;
    portLeaseCount: number;
    forwardCount: number;
  };
}

export interface SoakAnalysis {
  readonly analyzerVersion: "m8-soak-analyzer-v1";
  readonly status: "PASS" | "FAIL";
  readonly expectedDeviceCount: 4;
  readonly expectedActionCount: 1_000;
  readonly observedDeviceCount: number;
  readonly observedActionCount: number;
  readonly durationSeconds: number;
  readonly failures: readonly string[];
  readonly metrics: {
    readonly targetRows: number;
    readonly succeededTargets: number;
    readonly uniqueActionIds: number;
    readonly uniqueEvidencePaths: number;
    readonly uniqueLogPaths: number;
    readonly uniqueHashes: number;
    readonly cleanupPass: boolean;
  };
}

const ANALYZER_VERSION = "m8-soak-analyzer-v1" as const;
const EXPECTED_DEVICE_COUNT = 4;
const EXPECTED_ACTION_COUNT = 1_000;
const MIN_DURATION_SECONDS = 30 * 60;

export function analyzeSoakEvidence(input: SoakEvidence): SoakAnalysis {
  const failures: string[] = [];
  const serials = [...input.serials];
  const uniqueSerials = new Set(serials);
  if (serials.length !== EXPECTED_DEVICE_COUNT || uniqueSerials.size !== serials.length) {
    failures.push("DEVICE_CARDINALITY");
  }
  if (
    input.actionCount !== EXPECTED_ACTION_COUNT ||
    input.actions.length !== EXPECTED_ACTION_COUNT
  ) {
    failures.push("ACTION_COUNT");
  }
  if (input.durationSeconds < MIN_DURATION_SECONDS) failures.push("DURATION_BELOW_30_MINUTES");

  const actionIds = new Set<string>();
  const evidencePaths = new Set<string>();
  const logPaths = new Set<string>();
  const hashes = new Set<string>();
  let targetRows = 0;
  let succeededTargets = 0;

  for (const action of input.actions) {
    if (actionIds.has(action.actionId)) failures.push("ACTION_ID_COLLISION");
    actionIds.add(action.actionId);
    if (!Number.isSafeInteger(action.actionSeq) || action.actionSeq < 1) {
      failures.push("ACTION_SEQUENCE_INVALID");
    }
    if (action.targets.length !== serials.length) failures.push("ACTION_TARGET_CARDINALITY");
    const actionSerials = new Set<string>();
    for (const target of action.targets) {
      targetRows += 1;
      if (actionSerials.has(target.serial) || !uniqueSerials.has(target.serial)) {
        failures.push("TARGET_SERIAL_MISMATCH");
      }
      actionSerials.add(target.serial);
      if (target.state !== "SUCCEEDED") failures.push("TARGET_NOT_SUCCEEDED");
      else succeededTargets += 1;
      recordUnique(evidencePaths, target.evidencePath, failures, "PATH_COLLISION");
      recordUnique(logPaths, target.logPath, failures, "PATH_COLLISION");
      recordUnique(hashes, target.sha256, failures, "HASH_COLLISION");
      if (!pathContainsSerial(target.evidencePath, target.serial))
        failures.push("EVIDENCE_SERIAL_MISSING");
      if (!pathContainsSerial(target.logPath, target.serial)) failures.push("LOG_SERIAL_MISSING");
    }
    if (actionSerials.size !== serials.length) failures.push("TARGET_SERIAL_MISMATCH");
  }

  const cleanupPass =
    input.cleanup.workerCount === 0 &&
    input.cleanup.portLeaseCount === 0 &&
    input.cleanup.forwardCount === 0;
  if (!cleanupPass) failures.push("RESOURCE_LEAK");

  const uniqueFailures = [...new Set(failures)];
  return {
    analyzerVersion: ANALYZER_VERSION,
    status: uniqueFailures.length === 0 ? "PASS" : "FAIL",
    expectedDeviceCount: EXPECTED_DEVICE_COUNT,
    expectedActionCount: EXPECTED_ACTION_COUNT,
    observedDeviceCount: serials.length,
    observedActionCount: input.actions.length,
    durationSeconds: input.durationSeconds,
    failures: uniqueFailures,
    metrics: {
      targetRows,
      succeededTargets,
      uniqueActionIds: actionIds.size,
      uniqueEvidencePaths: evidencePaths.size,
      uniqueLogPaths: logPaths.size,
      uniqueHashes: hashes.size,
      cleanupPass,
    },
  };
}

function recordUnique(set: Set<string>, value: string, failures: string[], failure: string): void {
  if (set.has(value)) failures.push(failure);
  set.add(value);
}

function pathContainsSerial(path: string, serial: string): boolean {
  return path.includes(serial) || path.includes(sanitizeSerial(serial));
}

function sanitizeSerial(serial: string): string {
  return serial.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function runCli(): Promise<void> {
  const inputPath = process.argv[2] ?? process.env.TEST_CENTER_M8_SOAK_EVIDENCE;
  if (inputPath === undefined || inputPath.trim() === "") {
    process.stderr.write("Usage: soak-analyzer.ts <soak-evidence.json>\n");
    process.exitCode = 2;
    return;
  }
  try {
    const evidence = JSON.parse(await readFile(resolve(inputPath), "utf8")) as SoakEvidence;
    const analysis = analyzeSoakEvidence(evidence);
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    process.exitCode = analysis.status === "PASS" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  await runCli();
}
