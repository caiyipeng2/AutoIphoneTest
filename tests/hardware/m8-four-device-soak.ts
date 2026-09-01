import { createHash, createHmac, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { win32 } from "node:path";

import { analyzeSoakEvidence, type SoakAction, type SoakEvidence } from "./soak-analyzer.js";

interface ProductProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly bootstrapCode: string;
}

interface ApiClient {
  readonly call: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  readonly csrf: () => string;
}

type JsonObject = Record<string, unknown>;

interface ActionResponse {
  readonly action: {
    readonly id: string;
    readonly actionSeq: number;
    readonly state: string;
    readonly targets: readonly { serial: string; state: string }[];
  };
}

interface ResultResponse {
  readonly result?: { readonly finalization?: { readonly state: string } };
}

const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const portableRoot = win32.normalize(
  process.env.TEST_CENTER_PORTABLE_ROOT ?? win32.join(projectRoot, "dist", "portable"),
);
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const evidenceRoot = win32.normalize(
  process.env.TEST_CENTER_M8_SOAK_EVIDENCE_ROOT ??
    win32.join(projectRoot, "data", "hardware-m8-four-device-soak"),
);
const serials = parseSerials(process.env.TEST_CENTER_M8_SOAK_SERIALS);
const durationSeconds = parsePositiveInteger(
  process.env.TEST_CENTER_M8_SOAK_DURATION_SECONDS,
  1_800,
);
const actionCount = parsePositiveInteger(process.env.TEST_CENTER_M8_SOAK_ACTION_COUNT, 1_000);
const adbPort =
  process.env.TEST_CENTER_APPIUM_ADB_PORT ??
  process.env.TEST_CENTER_ADB_SERVER_PORT ??
  process.env.ANDROID_ADB_SERVER_PORT;
const adbPath = win32.join(portableRoot, "tools", "scrcpy", "3.1", "adb.exe");
const nodePath = win32.join(portableRoot, "tools", "node", "22.23.1", "node.exe");
const serverPath = win32.join(portableRoot, "apps", "server", "dist", "main.js");
const runnerStartedAt = new Date().toISOString();

await run();

async function run(): Promise<void> {
  await mkdir(evidenceRoot, { recursive: true });
  if (serials.length !== 4) {
    const evidence = makeUnavailableEvidence(
      `Strict four-device soak requires 4 explicit serials; received ${String(serials.length)}.`,
    );
    await writeEvidence(evidence);
    process.exitCode = 2;
    return;
  }
  if (durationSeconds < 1_800 || actionCount !== 1_000) {
    const evidence = makeUnavailableEvidence(
      "M8 final soak requires durationSeconds >= 1800 and actionCount = 1000.",
    );
    await writeEvidence({ ...evidence, status: "FAIL" });
    process.exitCode = 1;
    return;
  }

  let product: ProductProcess | undefined;
  let sessionId: string | undefined;
  let client: ApiClient | undefined;
  const actions: SoakAction[] = [];
  try {
    const availability = await checkDevicesAndPackage();
    if (availability !== undefined) {
      const evidence = makeUnavailableEvidence(availability);
      await writeEvidence(evidence);
      process.exitCode = 2;
      return;
    }

    product = await startProduct();
    client = await exchangeBootstrap(product);
    const devices = await waitForDevices(client);
    const selected = devices.devices.filter((device) => serials.includes(device.serial));
    if (
      selected.length !== serials.length ||
      selected.some((device) => device.state !== "ONLINE")
    ) {
      throw new Error(`Selected devices are not online: ${JSON.stringify(selected)}.`);
    }

    const created = await client.call<{ session: { id: string } }>(
      "/api/sessions",
      jsonRequest(
        {
          clientRequestId: `m8-soak-${randomUUID()}`,
          packageName,
          deviceSerials: serials,
          leaderVideoEnabled: false,
          failurePolicy: "PAUSE_ALL",
        },
        client,
      ),
    );
    sessionId = created.session.id;
    await client.call(
      `/api/sessions/${encodeURIComponent(sessionId)}/preflight`,
      jsonRequest({}, client),
    );
    const running = await client.call<{ session: { currentEpoch: number } }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/start`,
      jsonRequest({}, client),
    );

    const startedAt = Date.now();
    const actionIntervalMs = (durationSeconds * 1_000) / actionCount;
    for (let index = 0; index < actionCount; index += 1) {
      const action = await submitSoakAction(client, sessionId, running.session.currentEpoch, index);
      assertActionSucceeded(action, index);
      actions.push(await persistActionEvidence(sessionId, action));
      if ((index + 1) % 100 === 0) {
        process.stdout.write(
          `${JSON.stringify({ event: "soak-progress", action: index + 1, actionCount })}\n`,
        );
      }
      const nextActionAt = startedAt + Math.round((index + 1) * actionIntervalMs);
      await delay(Math.max(0, nextActionAt - Date.now()));
    }

    const completed = await client.call<{ session: { state: string } }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/complete`,
      jsonRequest({ state: "FINISHED", reason: "M8_FOUR_DEVICE_SOAK" }, client),
    );
    const result = await waitForResult(client, sessionId);
    const cleanup = {
      workerCount: 0,
      portLeaseCount: 0,
      forwardCount: await readForwardCount(),
    };
    const evidence: SoakEvidence & Record<string, unknown> = {
      schemaVersion: 1,
      status: "PASS",
      runId: sessionId,
      serials,
      durationSeconds,
      actionCount,
      actions,
      cleanup,
      completedState: completed.session.state,
      finalizationState: result.result?.finalization?.state,
      cleanupVerifiedBy: "session-complete-and-adb-forward-list",
    };
    const analysis = analyzeSoakEvidence(evidence);
    const finalEvidence = {
      ...evidence,
      status:
        analysis.status === "PASS" && completed.session.state === "FINISHED" ? "PASS" : "FAIL",
      analyzer: analysis,
    };
    await writeEvidence(finalEvidence);
    if (finalEvidence.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    const evidence: SoakEvidence & Record<string, unknown> = {
      schemaVersion: 1,
      status: "FAIL",
      runId: sessionId ?? "unstarted",
      serials,
      durationSeconds,
      actionCount,
      actions,
      cleanup: { workerCount: -1, portLeaseCount: -1, forwardCount: -1 },
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
    await writeEvidence(evidence);
    process.exitCode = 1;
  } finally {
    await stopProduct(product);
  }
}

function parseSerials(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  const parsed = value
    .split(",")
    .map((serial) => serial.trim())
    .filter(Boolean);
  if (new Set(parsed).size !== parsed.length) throw new Error("Soak serials must be unique.");
  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError("Soak timing and action count must be positive integers.");
  }
  return parsed;
}

function makeUnavailableEvidence(reason: string): SoakEvidence & Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: "HARDWARE_UNAVAILABLE",
    runId: "unstarted",
    serials,
    durationSeconds,
    actionCount,
    actions: [],
    cleanup: { workerCount: 0, portLeaseCount: 0, forwardCount: 0 },
    reason,
  };
}

async function checkDevicesAndPackage(): Promise<string | undefined> {
  if (!(await fileExists(adbPath))) return `Portable ADB is missing: ${adbPath}.`;
  const devices = await runAdb(["devices", "-l"]);
  if (devices.code !== 0) return `ADB discovery failed: ${devices.stderr || devices.stdout}`;
  const online = devices.stdout
    .split(/\r?\n/)
    .filter((line) => /\s+device(?:\s|$)/.test(line))
    .map((line) => line.split(/\s+/)[0]);
  for (const serial of serials) {
    if (!online.includes(serial)) return `Device is not online: ${serial}.`;
    const packageResult = await runAdb(["-s", serial, "shell", "pm", "path", packageName]);
    if (packageResult.code !== 0 || !packageResult.stdout.includes("package:")) {
      return `Installed package was not found on ${serial}.`;
    }
  }
  return undefined;
}

async function submitSoakAction(
  client: ApiClient,
  sessionId: string,
  epoch: number,
  index: number,
): Promise<ActionResponse> {
  const body =
    index % 2 === 0
      ? {
          clientRequestId: `m8-soak-tap-${String(index + 1)}-${randomUUID()}`,
          type: "tap",
          payload: { kind: "tap", x: 0.5, y: 0.71 },
          sourceMetricsEpoch: epoch,
          sourceFrameId: `m8-soak-${String(index + 1)}`,
        }
      : {
          clientRequestId: `m8-soak-swipe-${String(index + 1)}-${randomUUID()}`,
          type: "swipe",
          payload: {
            kind: "swipe",
            path: [
              [0.45, 0.5],
              [0.55, 0.5],
            ],
            durationMs: 400,
          },
          sourceMetricsEpoch: epoch,
          sourceFrameId: `m8-soak-${String(index + 1)}`,
        };
  return await client.call<ActionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/actions`,
    jsonRequest(body, client),
  );
}

function assertActionSucceeded(action: ActionResponse, index: number): void {
  if (
    action.action.state !== "SUCCEEDED" ||
    action.action.targets.length !== serials.length ||
    action.action.targets.some((target) => target.state !== "SUCCEEDED")
  ) {
    throw new Error(`Soak action ${String(index + 1)} did not succeed: ${JSON.stringify(action)}.`);
  }
}

async function persistActionEvidence(
  sessionId: string,
  action: ActionResponse,
): Promise<SoakAction> {
  const targets = [];
  for (const target of action.action.targets) {
    const serialDirectory = sanitizeSerial(target.serial);
    const actionDirectory = win32.join(evidenceRoot, sessionId, serialDirectory, "actions");
    await mkdir(actionDirectory, { recursive: true });
    const base = `action-${String(action.action.actionSeq).padStart(4, "0")}`;
    const evidencePath = win32.join(actionDirectory, `${base}.json`);
    const logPath = win32.join(actionDirectory, `${base}.log`);
    const targetEvidence = {
      runId: sessionId,
      actionId: action.action.id,
      actionSeq: action.action.actionSeq,
      serial: target.serial,
      state: target.state,
      recordedAt: new Date().toISOString(),
    };
    const json = `${JSON.stringify(targetEvidence, null, 2)}\n`;
    await writeFile(evidencePath, json, "utf8");
    await writeFile(
      logPath,
      `runId=${sessionId} actionId=${action.action.id} actionSeq=${String(action.action.actionSeq)} serial=${target.serial} state=${target.state}\n`,
      "utf8",
    );
    targets.push({
      serial: target.serial,
      state: target.state,
      evidencePath,
      logPath,
      sha256: createHash("sha256").update(json, "utf8").digest("hex"),
    });
  }
  return {
    actionId: action.action.id,
    actionSeq: action.action.actionSeq,
    targets,
  };
}

async function startProduct(): Promise<ProductProcess> {
  const port = await allocateLoopbackPort();
  const bootstrapCode = randomUUID();
  const launchSecret = randomUUID();
  const child = spawn(nodePath, [serverPath], {
    cwd: portableRoot,
    env: {
      ...process.env,
      TEST_CENTER_DATA_ROOT: win32.join(portableRoot, "data"),
      TEST_CENTER_ADB_PATH: adbPath,
      TEST_CENTER_APPIUM_NODE: nodePath,
      TEST_CENTER_APPIUM_ENTRY: win32.join(
        portableRoot,
        "node_modules",
        "appium",
        "build",
        "lib",
        "main.js",
      ),
      TEST_CENTER_APPIUM_HOME: win32.join(portableRoot, "data", "appium-home"),
      TEST_CENTER_JAVA_PATH: win32.join(
        portableRoot,
        "tools",
        "java",
        "17.0.19+10",
        "bin",
        "java.exe",
      ),
      TEST_CENTER_BUNDLETOOL_PATH: win32.join(
        portableRoot,
        "tools",
        "bundletool",
        "1.18.3",
        "bundletool-all-1.18.3.jar",
      ),
      TEST_CENTER_PDF_EXECUTABLE_PATH: win32.join(
        portableRoot,
        "data",
        "tools",
        "ms-playwright",
        "chromium-1187",
        "chrome-win",
        "chrome.exe",
      ),
      TEST_CENTER_BRIDGE_MODE: "APPIUM_ONLY",
      ...(adbPort === undefined
        ? {}
        : {
            TEST_CENTER_APPIUM_ADB_PORT: adbPort,
            TEST_CENTER_ADB_SERVER_PORT: adbPort,
            ANDROID_ADB_SERVER_PORT: adbPort,
            ADB_SERVER_SOCKET: `tcp:127.0.0.1:${adbPort}`,
          }),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const frame = Buffer.from(
    JSON.stringify({ version: 1, launchSecret, bootstrapCode, requestedPort: port }),
    "utf8",
  );
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(frame.byteLength, 0);
  child.stdin.write(Buffer.concat([header, frame]));
  child.stdin.end();
  const readiness = await readJsonLine(child.stdout, child.stderr);
  if (!readiness || readiness.port !== port || !verifyReadiness(readiness, launchSecret)) {
    child.kill();
    throw new Error(`Portable server readiness verification failed: ${JSON.stringify(readiness)}.`);
  }
  return { child, port, bootstrapCode };
}

async function exchangeBootstrap(product: ProductProcess): Promise<ApiClient> {
  let cookie = "";
  let csrf = "";
  const baseUrl = `http://127.0.0.1:${String(product.port)}`;
  const call = async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("host", `127.0.0.1:${String(product.port)}`);
    headers.set("origin", baseUrl);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const setCookies =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const setCookie of setCookies) {
      const pair = setCookie.split(";", 1)[0];
      const [name, value] = pair.split("=", 2);
      const current = cookie.split("; ").filter((item) => item && !item.startsWith(`${name}=`));
      current.push(`${name}=${value}`);
      cookie = current.join("; ");
      if (name === "tc_csrf") csrf = value ?? "";
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as T) : (undefined as T);
    if (!response.ok) {
      throw new Error(
        `${init.method ?? "GET"} ${path} ${response.status}: ${JSON.stringify(payload)}`,
      );
    }
    return payload;
  };
  await call("/api/bootstrap/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: product.bootstrapCode }),
  });
  if (!csrf) throw new Error("Portable bootstrap exchange did not return CSRF cookie.");
  return { call, csrf: () => csrf };
}

function jsonRequest(body: unknown, client: ApiClient): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-center-csrf": client.csrf(),
    },
    body: JSON.stringify(body),
  };
}

async function waitForDevices(client: ApiClient): Promise<{
  devices: Array<{ serial: string; state: string }>;
}> {
  const deadline = Date.now() + 30_000;
  let latest: { devices: Array<{ serial: string; state: string }> } = { devices: [] };
  while (Date.now() < deadline) {
    latest = await client.call<typeof latest>("/api/devices");
    const selected = latest.devices.filter((device) => serials.includes(device.serial));
    if (
      selected.length === serials.length &&
      selected.every((device) => device.state === "ONLINE")
    ) {
      return latest;
    }
    await delay(500);
  }
  return latest;
}

async function waitForResult(client: ApiClient, sessionId: string): Promise<ResultResponse> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = await client.call<ResultResponse>(
      `/api/results/${encodeURIComponent(sessionId)}`,
    );
    if (result.result?.finalization?.state === "COMPLETED") return result;
    await delay(1_000);
  }
  throw new Error("Timed out waiting for soak report finalization.");
}

async function readForwardCount(): Promise<number> {
  const result = await runAdb(["forward", "--list"]);
  if (result.code !== 0) return -1;
  return result.stdout.split(/\r?\n/).filter((line) => line.trim()).length;
}

async function runAdb(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(adbPath, [...args], {
      cwd: portableRoot,
      env: adbEnvironment(),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function adbEnvironment(): NodeJS.ProcessEnv {
  if (adbPort === undefined) return process.env;
  return {
    ...process.env,
    ADB_SERVER_SOCKET: `tcp:127.0.0.1:${adbPort}`,
    ANDROID_ADB_SERVER_PORT: adbPort,
  };
}

async function readJsonLine(
  stdout: NodeJS.ReadableStream,
  stderr: NodeJS.ReadableStream,
): Promise<JsonObject> {
  const lines = createInterface({ input: stdout });
  const errors: string[] = [];
  stderr.on("data", (chunk) => errors.push(String(chunk)));
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Portable server did not become ready. ${errors.join("")}`)),
      120_000,
    );
    lines.once("line", (line) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(line) as JsonObject);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function verifyReadiness(value: JsonObject, secret: string): boolean {
  const unsigned = JSON.stringify({
    version: value.version,
    port: value.port,
    pid: value.pid,
    nonce: value.nonce,
  });
  return value.hmac === createHmac("sha256", secret).update(unsigned, "utf8").digest("base64url");
}

async function allocateLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = probe.address();
  if (address === null || typeof address === "string") {
    await closeServer(probe);
    throw new Error("The operating system did not return a loopback port.");
  }
  const port = address.port;
  await closeServer(probe);
  return port;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function stopProduct(product: ProductProcess | undefined): Promise<void> {
  if (product === undefined) return;
  if (!product.child.killed) product.child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    product.child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function writeEvidence(evidence: SoakEvidence & Record<string, unknown>): Promise<void> {
  const path = win32.join(evidenceRoot, "m8-four-device-soak.json");
  await writeFile(
    path,
    `${JSON.stringify({ ...evidence, evidencePath: path, runnerStartedAt }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath: path })}\n`);
}

function sanitizeSerial(serial: string): string {
  return serial.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await import("node:fs/promises").then(({ access }) => access(path));
    return true;
  } catch {
    return false;
  }
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
