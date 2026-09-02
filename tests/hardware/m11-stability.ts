import { createHmac, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { win32 } from "node:path";

import { analyzeStability, type StabilitySample } from "./stability-analyzer.js";

interface ProductProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly bootstrapCode: string;
}

interface ApiClient {
  readonly call: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  readonly csrf: () => string;
}

interface ResultView {
  readonly finalization?: { readonly state: string };
  readonly exports?: readonly { readonly format: string; readonly state: string }[];
}

type JsonObject = Record<string, unknown>;

const root = win32.normalize(
  process.env.TEST_CENTER_PORTABLE_ROOT ?? "E:\\M11-Portable-Verify-20260821",
);
const serials = (process.env.TEST_CENTER_M11_SERIALS ?? "R5CX211TXNT,t4vswkqcs4uc8pob")
  .split(",")
  .map((serial) => serial.trim())
  .filter(Boolean);
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const durationSeconds = positiveInteger(process.env.TEST_CENTER_M11_STABILITY_SECONDS, 3_600);
const intervalSeconds = positiveInteger(process.env.TEST_CENTER_M11_SAMPLE_INTERVAL_SECONDS, 10);
const warmupSeconds = positiveInteger(process.env.TEST_CENTER_M11_WARMUP_SECONDS, 600);
const checkpointIntervalSeconds = positiveInteger(
  process.env.TEST_CENTER_M11_CHECKPOINT_INTERVAL_SECONDS,
  30,
);
const adbPath = win32.join(root, "tools", "scrcpy", "3.1", "adb.exe");
const adbPort = readOptionalPort(
  process.env.TEST_CENTER_APPIUM_ADB_PORT ?? process.env.TEST_CENTER_ADB_SERVER_PORT,
);
const adbEnv = createAdbEnvironment(adbPort);
const nodePath = win32.join(root, "tools", "node", "22.23.1", "node.exe");
const serverPath = win32.join(root, "apps", "server", "dist", "main.js");
const dataRoot = win32.join(root, "data");
const evidenceRoot = win32.normalize(
  process.env.TEST_CENTER_M11_EVIDENCE_ROOT ??
    win32.join(process.cwd(), "data", "hardware-m11-stability"),
);
const startedAt = new Date().toISOString();
const samples: StabilitySample[] = [];
const actionErrors: string[] = [];
const stayAwakeState = new Map<string, boolean>();
const cleanupErrors: string[] = [];
let product: ProductProcess | undefined;
let sessionId: string | undefined;
let evidence: Record<string, unknown> = { status: "NOT_STARTED" };

if (serials.length < 1 || serials.length > 4)
  throw new Error("M11 stability requires 1-4 serials.");
if (durationSeconds < warmupSeconds + intervalSeconds * 2) {
  throw new Error("Stability duration must exceed warmup plus two samples.");
}

try {
  product = await startProduct();
  const client = await exchangeBootstrap(product);
  const devices = await waitForDevices(client);
  const selected = devices.devices.filter((device) => serials.includes(device.serial));
  if (selected.length !== serials.length || selected.some((device) => device.state !== "ONLINE")) {
    throw new Error(`Selected devices are not online: ${JSON.stringify(selected)}.`);
  }
  for (const serial of serials) {
    // Long unattended runs can cross the Android display timeout. Preserve the
    // operator's prior setting, keep the USB-connected device awake for the
    // duration, and restore it even when the run fails before session creation.
    const previousStayAwake = await readStayAwakeState(serial);
    await setStayAwake(serial, true);
    stayAwakeState.set(serial, previousStayAwake);
  }
  const created = await client.call<{ session: { id: string } }>(
    "/api/sessions",
    jsonRequest(
      {
        clientRequestId: `m11-stability-${randomUUID()}`,
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

  const deadline = Date.now() + durationSeconds * 1_000;
  let nextActionAt = Date.now();
  let sampleIndex = 0;
  while (Date.now() < deadline) {
    const elapsedSeconds = Math.min(
      durationSeconds,
      Math.round((durationSeconds * 1_000 - (deadline - Date.now())) / 1_000),
    );
    const metrics = await readMetrics(product.child.pid ?? 0);
    samples.push({
      elapsedSeconds,
      processTreePrivateBytes: metrics.privateBytes,
      processTreeHandles: metrics.handles,
      processTreeThreads: metrics.threads,
      maxQueueDepth: metrics.queueDepth,
      walBytes: metrics.walBytes,
      crashCount: metrics.crashCount,
      restartCount: metrics.restartCount,
      workerCount: metrics.workerCount,
      portLeaseCount: metrics.portLeaseCount,
      forwardCount: metrics.forwardCount,
      cpuPercent: metrics.cpuPercent,
      rssBytes: metrics.rssBytes,
      openFileCount: metrics.handles,
      openSocketCount: metrics.socketCount,
      temperatureCelsius: metrics.temperatureCelsius,
    });
    process.stdout.write(
      `${JSON.stringify({ event: "sample", index: sampleIndex, elapsedSeconds, privateBytes: metrics.privateBytes, queueDepth: metrics.queueDepth, walBytes: metrics.walBytes })}\n`,
    );
    sampleIndex += 1;

    if (Date.now() >= nextActionAt) {
      try {
        await submitSafeCheckpoint(client, sessionId, running.session.currentEpoch);
      } catch (error) {
        actionErrors.push(error instanceof Error ? error.message : String(error));
      }
      nextActionAt = Date.now() + checkpointIntervalSeconds * 1_000;
    }
    await delay(Math.max(100, Math.min(intervalSeconds * 1_000, deadline - Date.now())));
  }

  const completed = await client.call<{ session: { state: string } }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/complete`,
    jsonRequest({ state: "FINISHED", reason: "M11_PORTABLE_60_MINUTE_STABILITY" }, client),
  );
  const result = await waitForResult(client, sessionId);
  const cleanupMetrics = await readMetrics(product.child.pid ?? 0);
  const cleanup = {
    workerCount: cleanupMetrics.workerCount,
    portLeaseCount: cleanupMetrics.portLeaseCount,
    forwardCount: cleanupMetrics.forwardCount,
  };
  const analysis = analyzeStability(samples, {
    warmupSeconds,
    expectedWorkers: serials.length,
    cleanup,
  });
  evidence = {
    status: analysis.status === "PASS" && actionErrors.length === 0 ? "PASS" : "FAIL",
    analyzerVersion: analysis.analyzerVersion,
    startedAt,
    completedAt: new Date().toISOString(),
    cleanRoot: root,
    serials,
    packageName,
    durationSeconds,
    intervalSeconds,
    checkpointIntervalSeconds,
    warmupSeconds,
    sessionId,
    completedState: completed.session.state,
    result,
    cleanup,
    actionErrors,
    analysis,
    sampleCount: samples.length,
    samples,
    cleanupErrors,
  };
  if (evidence.status !== "PASS") process.exitCode = 1;
} catch (error) {
  evidence = {
    status: "FAIL",
    startedAt,
    completedAt: new Date().toISOString(),
    cleanRoot: root,
    serials,
    packageName,
    durationSeconds,
    intervalSeconds,
    warmupSeconds,
    sessionId,
    actionErrors,
    sampleCount: samples.length,
    samples,
    cleanupErrors,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  process.exitCode = 1;
} finally {
  const restoreErrors = await restoreStayAwake(stayAwakeState);
  cleanupErrors.push(...restoreErrors);
  if (restoreErrors.length > 0 && evidence.status === "PASS") {
    evidence = { ...evidence, status: "FAIL", cleanupErrors };
  }
  await stopProduct(product);
  await mkdir(evidenceRoot, { recursive: true });
  const evidencePath = win32.join(evidenceRoot, "m11-stability.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath })}\n`);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error("M11 stability timing must be a positive integer.");
  return parsed;
}

async function startProduct(): Promise<ProductProcess> {
  const port = 5180 + Math.floor(Math.random() * 400);
  const bootstrapCode = randomUUID();
  const launchSecret = randomUUID();
  const child = spawn(nodePath, [serverPath], {
    cwd: root,
    env: {
      ...process.env,
      TEST_CENTER_DATA_ROOT: dataRoot,
      TEST_CENTER_ADB_PATH: adbPath,
      TEST_CENTER_APPIUM_NODE: nodePath,
      TEST_CENTER_APPIUM_ENTRY: win32.join(
        root,
        "node_modules",
        "appium",
        "build",
        "lib",
        "main.js",
      ),
      TEST_CENTER_APPIUM_HOME: win32.join(dataRoot, "appium-home"),
      TEST_CENTER_JAVA_PATH: win32.join(root, "tools", "java", "17.0.19+10", "bin", "java.exe"),
      TEST_CENTER_BUNDLETOOL_PATH: win32.join(
        root,
        "tools",
        "bundletool",
        "1.18.3",
        "bundletool-all-1.18.3.jar",
      ),
      TEST_CENTER_PDF_EXECUTABLE_PATH: win32.join(
        root,
        "data",
        "tools",
        "ms-playwright",
        "chromium-1187",
        "chrome-win",
        "chrome.exe",
      ),
      TEST_CENTER_BRIDGE_MODE: "APPIUM_ONLY",
      ...adbEnv,
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

async function readJsonLine(
  stdout: NodeJS.ReadableStream,
  stderr: NodeJS.ReadableStream,
): Promise<JsonObject> {
  const lines = createInterface({ input: stdout });
  const errorLines: string[] = [];
  stderr.on("data", (chunk) => errorLines.push(String(chunk)));
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Portable server did not become ready. ${errorLines.join("")}`)),
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

async function exchangeBootstrap(productProcess: ProductProcess): Promise<ApiClient> {
  let cookie = "";
  let csrf = "";
  const baseUrl = `http://127.0.0.1:${String(productProcess.port)}`;
  const call = async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("host", `127.0.0.1:${String(productProcess.port)}`);
    headers.set("origin", baseUrl);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const setCookies =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const setCookie of setCookies) {
      const pair = setCookie.split(";", 1)[0];
      const [name, value] = pair.split("=", 2);
      cookie = `${cookie ? `${cookie}; ` : ""}${name}=${value}`;
      if (name === "tc_csrf") csrf = value ?? "";
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as T) : (undefined as T);
    if (!response.ok)
      throw new Error(
        `${init.method ?? "GET"} ${path} ${response.status}: ${JSON.stringify(payload)}`,
      );
    return payload;
  };
  await call("/api/bootstrap/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: productProcess.bootstrapCode }),
  });
  if (!csrf) throw new Error("Portable bootstrap exchange did not return CSRF cookie.");
  return { call, csrf: () => csrf };
}

function jsonRequest(body: unknown, client: ApiClient): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-center-csrf": client.csrf() },
    body: JSON.stringify(body),
  };
}

async function waitForDevices(
  client: ApiClient,
): Promise<{ devices: Array<{ serial: string; state: string }> }> {
  const deadline = Date.now() + 30_000;
  let latest: { devices: Array<{ serial: string; state: string }> } = { devices: [] };
  while (Date.now() < deadline) {
    latest = await client.call<typeof latest>("/api/devices");
    const selected = latest.devices.filter((device) => serials.includes(device.serial));
    if (selected.length === serials.length && selected.every((device) => device.state === "ONLINE"))
      return latest;
    await delay(500);
  }
  return latest;
}

async function submitSafeCheckpoint(client: ApiClient, id: string, epoch: number): Promise<void> {
  const payload = {
    clientRequestId: `m11-stability-checkpoint-${randomUUID()}`,
    type: "tap",
    payload: { kind: "tap", x: 0.01, y: 0.01 },
    sourceMetricsEpoch: epoch,
    sourceFrameId: "m11-stability-checkpoint",
  };
  const result = await client.call<{
    action: { state: string; targets: Array<{ state: string }> };
  }>(`/api/sessions/${encodeURIComponent(id)}/actions`, jsonRequest(payload, client));
  if (
    result.action.state !== "SUCCEEDED" ||
    result.action.targets.some((target) => target.state !== "SUCCEEDED")
  ) {
    throw new Error(`Checkpoint action failed: ${JSON.stringify(result)}`);
  }
}

async function waitForResult(client: ApiClient, id: string): Promise<ResultView> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const payload = await client.call<{ result: ResultView }>(
      `/api/results/${encodeURIComponent(id)}`,
    );
    if (
      payload.result.finalization?.state === "COMPLETED" &&
      payload.result.exports?.some((item) => item.format === "HTML" && item.state === "READY")
    )
      return payload.result;
    await delay(1_000);
  }
  throw new Error("Timed out waiting for stability report finalization.");
}

async function readMetrics(rootPid: number): Promise<{
  privateBytes: number;
  rssBytes: number;
  handles: number;
  threads: number;
  cpuPercent: number;
  queueDepth: number;
  walBytes: number;
  workerCount: number;
  portLeaseCount: number;
  forwardCount: number;
  socketCount: number;
  temperatureCelsius: number;
  crashCount: number;
  restartCount: number;
}> {
  const processStats = readProcessStats(rootPid);
  const runtimeStats = readRuntimeStats();
  const forwardResult = await runAdb(["forward", "--list"]);
  const forwardCount = forwardResult.stdout.split(/\r?\n/).filter((line) => line.trim()).length;
  const temperatures = await Promise.all(
    serials.map(async (serial) =>
      parseTemperature((await runAdb(["-s", serial, "shell", "dumpsys", "battery"])).stdout),
    ),
  );
  return {
    ...processStats,
    ...runtimeStats,
    forwardCount,
    socketCount: processStats.handles,
    temperatureCelsius: Math.max(...temperatures.filter((value) => Number.isFinite(value)), 0),
  };
}

function readProcessStats(rootPid: number): {
  privateBytes: number;
  rssBytes: number;
  handles: number;
  threads: number;
  cpuPercent: number;
} {
  const script = `$root=[int]$env:TC_ROOT_PID;$all=@(Get-CimInstance Win32_Process);$ids=New-Object System.Collections.Generic.HashSet[int];[void]$ids.Add($root);$changed=$true;while($changed){$changed=$false;foreach($item in $all){if($ids.Contains([int]$item.ParentProcessId)-and $ids.Add([int]$item.ProcessId)){$changed=$true}}};$items=@($ids|ForEach-Object{Get-Process -Id $_ -ErrorAction SilentlyContinue});[pscustomobject]@{privateBytes=[int64](($items|Measure-Object PrivateMemorySize64 -Sum).Sum);rssBytes=[int64](($items|Measure-Object WorkingSet64 -Sum).Sum);handles=[int](($items|Measure-Object HandleCount -Sum).Sum);threads=[int](($items|ForEach-Object{$_.Threads.Count}|Measure-Object -Sum).Sum);cpuSeconds=[double](($items|ForEach-Object{$_.TotalProcessorTime.TotalSeconds}|Measure-Object -Sum).Sum)}|ConvertTo-Json -Compress`;
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", script], {
    env: { ...process.env, TC_ROOT_PID: String(rootPid) },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Process metrics failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as {
    privateBytes: number;
    rssBytes: number;
    handles: number;
    threads: number;
    cpuSeconds: number;
  };
  return {
    privateBytes: parsed.privateBytes ?? 0,
    rssBytes: parsed.rssBytes ?? 0,
    handles: parsed.handles ?? 0,
    threads: parsed.threads ?? 0,
    cpuPercent: parsed.cpuSeconds ?? 0,
  };
}

function readRuntimeStats(): {
  queueDepth: number;
  walBytes: number;
  workerCount: number;
  portLeaseCount: number;
  crashCount: number;
  restartCount: number;
} {
  const script = `const fs=require('node:fs');const Database=require('better-sqlite3');const db=new Database(process.env.TC_DB,{readonly:true});const queue=db.prepare("SELECT COUNT(*) AS count FROM action_outbox WHERE state IN ('QUEUED','LEASED','DISPATCHING')").get().count;db.close();const readArray=(path)=>{try{const value=JSON.parse(fs.readFileSync(path,'utf8'));return Array.isArray(value)?value:[]}catch{return []}};const wal=(()=>{try{return fs.statSync(process.env.TC_DB+'-wal').size}catch{return 0}})();const workers=readArray(process.env.TC_WORKERS);const leases=readArray(process.env.TC_LEASES);console.log(JSON.stringify({queueDepth:Number(queue),walBytes:wal,workerCount:workers.length,portLeaseCount:leases.length,crashCount:0,restartCount:0}));`;
  const result = spawnSync(nodePath, ["-e", script], {
    cwd: root,
    env: {
      ...process.env,
      TC_DB: win32.join(dataRoot, "test-center.sqlite"),
      TC_WORKERS: win32.join(dataRoot, "runs", "worker-resources.json"),
      TC_LEASES: win32.join(dataRoot, "port-leases.json"),
    },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Runtime metrics failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim()) as {
    queueDepth: number;
    walBytes: number;
    workerCount: number;
    portLeaseCount: number;
    crashCount: number;
    restartCount: number;
  };
}

async function runAdb(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(adbPath, [...args], { cwd: root, env: adbEnv, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function readStayAwakeState(serial: string): Promise<boolean> {
  const result = await runAdb(["-s", serial, "shell", "dumpsys", "power"]);
  if (result.code !== 0) {
    throw new Error(
      `Unable to read Android stay-awake state for ${serial}: ${result.stderr.trim()}`,
    );
  }
  const match = result.stdout.match(/mStayOn=(true|false)/i);
  if (match === null) {
    throw new Error(`Android power output did not expose mStayOn for ${serial}.`);
  }
  return match[1].toLowerCase() === "true";
}

async function setStayAwake(serial: string, enabled: boolean): Promise<void> {
  const result = await runAdb([
    "-s",
    serial,
    "shell",
    "svc",
    "power",
    "stayon",
    enabled ? "true" : "false",
  ]);
  if (result.code !== 0) {
    throw new Error(
      `Unable to ${enabled ? "enable" : "restore"} Android stay-awake for ${serial}: ${result.stderr.trim()}`,
    );
  }
}

async function restoreStayAwake(state: ReadonlyMap<string, boolean>): Promise<string[]> {
  const errors: string[] = [];
  for (const [serial, previous] of state) {
    try {
      await setStayAwake(serial, previous);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}

function readOptionalPort(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`Invalid stability ADB server port: ${value}.`);
  }
  return String(parsed);
}

function createAdbEnvironment(port: string | undefined): NodeJS.ProcessEnv {
  if (port === undefined) return { ...process.env };
  return {
    ...process.env,
    ADB_SERVER_SOCKET: `tcp:127.0.0.1:${port}`,
    ANDROID_ADB_SERVER_PORT: port,
  };
}

function parseTemperature(output: string): number {
  const match = output.match(/temperature:\s*(-?\d+)/i);
  return match === null ? Number.NaN : Number(match[1]) / 10;
}

async function stopProduct(productProcess: ProductProcess | undefined): Promise<void> {
  if (productProcess === undefined) return;
  if (!productProcess.child.killed) productProcess.child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    productProcess.child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
