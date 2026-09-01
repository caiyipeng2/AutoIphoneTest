import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { win32 } from "node:path";

interface CapacityResult {
  readonly capacity: number;
  readonly serials: readonly string[];
  readonly status: "PASS" | "FAIL" | "HARDWARE_UNAVAILABLE";
  readonly reason?: string;
  readonly evidencePath?: string;
  readonly logPath?: string;
  readonly sessionId?: string;
}

interface ChildEvidence {
  readonly status?: string;
  readonly sessionId?: string;
  readonly evidencePath?: string;
}

const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const portableRoot = win32.normalize(
  process.env.TEST_CENTER_PORTABLE_ROOT ?? win32.join(projectRoot, "dist", "portable"),
);
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const evidenceRoot = win32.normalize(
  process.env.TEST_CENTER_M8_EVIDENCE_ROOT ??
    win32.join(projectRoot, "data", "hardware-m8-capacity-matrix"),
);
const serials = parseSerials(process.env.TEST_CENTER_M8_SERIALS);
const requireFour = parseBoolean(process.env.TEST_CENTER_M8_REQUIRE_FOUR);
const adbPort = process.env.TEST_CENTER_M8_ADB_PORT ?? process.env.TEST_CENTER_ADB_SERVER_PORT;
const timeoutMs = parseTimeout(process.env.TEST_CENTER_M8_CAPACITY_TIMEOUT_MS);
const runner = win32.join(projectRoot, "tests", "hardware", "m11-portable-smoke.ts");
const nodePath = process.env.TEST_CENTER_NODE_PATH ?? process.execPath;

await mkdir(evidenceRoot, { recursive: true });

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  packageName,
  portableRoot,
  requireFour,
  serials,
  capacities: [] as CapacityResult[],
};

if (serials.length === 0) {
  report.capacities.push({
    capacity: 0,
    serials,
    status: "FAIL",
    reason: "TEST_CENTER_M8_SERIALS must contain 1-4 explicit serials.",
  });
} else if (requireFour && serials.length !== 4) {
  report.capacities.push({
    capacity: 4,
    serials,
    status: "HARDWARE_UNAVAILABLE",
    reason: `Strict four-device gate requires 4 online serials; received ${String(serials.length)}.`,
  });
} else {
  for (let capacity = 1; capacity <= 4; capacity += 1) {
    const selected = serials.slice(0, capacity);
    if (selected.length !== capacity) {
      report.capacities.push({
        capacity,
        serials: selected,
        status: "HARDWARE_UNAVAILABLE",
        reason: `Capacity ${String(capacity)} requires ${String(capacity)} explicit online serials.`,
      });
      continue;
    }
    report.capacities.push(await runCapacity(capacity, selected));
  }
}

const hasFailure = report.capacities.some((result) => result.status === "FAIL");
const hasHardwareGap = report.capacities.some((result) => result.status === "HARDWARE_UNAVAILABLE");
const status = hasFailure ? "FAIL" : hasHardwareGap ? "PARTIAL" : "PASS";
const output = {
  ...report,
  status,
  completedAt: new Date().toISOString(),
};
const reportPath = win32.join(evidenceRoot, "m8-capacity-matrix.json");
await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ...output, evidencePath: reportPath })}\n`);
process.exitCode = hasFailure ? 1 : hasHardwareGap ? 2 : 0;

async function runCapacity(capacity: number, selected: readonly string[]): Promise<CapacityResult> {
  const capacityRoot = win32.join(evidenceRoot, `capacity-${String(capacity)}`);
  const logPath = win32.join(capacityRoot, "m11-portable-smoke.log");
  await mkdir(capacityRoot, { recursive: true });
  const child = spawn(nodePath, ["--import", "tsx", runner], {
    cwd: projectRoot,
    env: {
      ...process.env,
      TEST_CENTER_PROJECT_ROOT: projectRoot,
      TEST_CENTER_PORTABLE_ROOT: portableRoot,
      TEST_CENTER_M11_SERIALS: selected.join(","),
      TEST_CENTER_PACKAGE: packageName,
      TEST_CENTER_M11_EVIDENCE_ROOT: capacityRoot,
      ...(adbPort === undefined
        ? {}
        : {
            TEST_CENTER_APPIUM_ADB_PORT: adbPort,
            TEST_CENTER_ADB_SERVER_PORT: adbPort,
            ANDROID_ADB_SERVER_PORT: adbPort,
            ADB_SERVER_SOCKET: `tcp:127.0.0.1:${adbPort}`,
          }),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const result = await waitForChild(child, timeoutMs);
  const log = `${stdout.join("")}\n${stderr.join("")}`;
  await writeFile(logPath, log, "utf8");
  const childEvidence = parseLastJsonLine(stdout.join(""));
  const evidencePath = childEvidence?.evidencePath;
  return {
    capacity,
    serials: selected,
    status: result.code === 0 && childEvidence?.status === "PASS" ? "PASS" : "FAIL",
    ...(evidencePath === undefined ? {} : { evidencePath }),
    logPath,
    ...(childEvidence?.sessionId === undefined ? {} : { sessionId: childEvidence.sessionId }),
    ...(result.code === 0 && childEvidence?.status === "PASS"
      ? {}
      : { reason: `Portable smoke exited with code ${String(result.code)}.` }),
  };
}

function parseSerials(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  const parsed = value
    .split(",")
    .map((serial) => serial.trim())
    .filter(Boolean);
  if (parsed.length < 1 || parsed.length > 4) {
    throw new Error("TEST_CENTER_M8_SERIALS must contain 1-4 explicit serials.");
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error("TEST_CENTER_M8_SERIALS must contain unique serials.");
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value?.trim().toLowerCase() === "true";
}

function parseTimeout(value: string | undefined): number {
  const timeout = Number(value ?? 180_000);
  if (!Number.isSafeInteger(timeout) || timeout < 30_000) {
    throw new TypeError("TEST_CENTER_M8_CAPACITY_TIMEOUT_MS must be at least 30000.");
  }
  return timeout;
}

function parseLastJsonLine(value: string): ChildEvidence | undefined {
  const lines = value.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) return parsed as ChildEvidence;
    } catch {
      // Appium child output can contain non-JSON diagnostics before its final evidence line.
    }
  }
  return undefined;
}

function waitForChild(
  child: ReturnType<typeof spawn>,
  timeout: number,
): Promise<{ readonly code: number | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null });
    }, timeout);
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: 1 });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
}
