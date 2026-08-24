import { createHash, createHmac, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { win32 } from "node:path";

interface ProductProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly bootstrapCode: string;
  readonly launchSecret: string;
}

interface ApiClient {
  readonly call: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  readonly download: (path: string) => Promise<Buffer>;
  readonly csrf: () => string;
}

interface ResultExport {
  readonly format: "HTML" | "ZIP" | "EXCEL" | "PDF" | "JUNIT";
  readonly state: string;
}

interface ResultView {
  readonly finalization?: { readonly state: string };
  readonly exports?: readonly ResultExport[];
}

const root = win32.normalize(
  process.env.TEST_CENTER_PORTABLE_ROOT ?? "E:\\M11-Portable-Verify-20260821",
);
const serials = (process.env.TEST_CENTER_M11_SERIALS ?? "R5CX211TXNT,t4vswkqcs4uc8pob")
  .split(",")
  .map((serial) => serial.trim())
  .filter(Boolean);
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";
const adbPath = win32.join(root, "tools", "scrcpy", "3.1", "adb.exe");
const nodePath = win32.join(root, "tools", "node", "22.23.1", "node.exe");
const serverPath = win32.join(root, "apps", "server", "dist", "main.js");
const evidenceRoot = win32.normalize(
  process.env.TEST_CENTER_M11_EVIDENCE_ROOT ??
    win32.join(process.cwd(), "data", "hardware-m11-portable-smoke"),
);

if (serials.length < 1 || serials.length > 4) throw new Error("M11 smoke requires 1-4 serials.");

const startedAt = new Date().toISOString();
let product: ProductProcess | undefined;
let sessionId: string | undefined;
let evidence: Record<string, unknown> = { status: "NOT_STARTED" };

try {
  await assertDevicesOnline();
  product = await startProduct();
  const client = await exchangeBootstrap(product);
  const devices = await waitForDevices(client);
  const selected = devices.devices.filter((device) => serials.includes(device.serial));
  if (selected.length !== serials.length || selected.some((device) => device.state !== "ONLINE")) {
    throw new Error(`Selected devices are not online: ${JSON.stringify(selected)}.`);
  }

  const created = await client.call<{
    session: { id: string; currentEpoch: number; state: string };
  }>(
    "/api/sessions",
    jsonRequest(
      {
        clientRequestId: `m11-portable-${randomUUID()}`,
        packageName,
        deviceSerials: serials,
        leaderVideoEnabled: false,
        failurePolicy: "PAUSE_ALL",
      },
      client,
    ),
  );
  sessionId = created.session.id;
  const preflight = await client.call<{ session: { state: string } }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/preflight`,
    jsonRequest({}, client),
  );
  const running = await client.call<{ session: { state: string; currentEpoch: number } }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/start`,
    jsonRequest({}, client),
  );
  if (preflight.session.state !== "PREFLIGHT" || running.session.state !== "RUNNING") {
    throw new Error(`Unexpected session transition: ${JSON.stringify({ preflight, running })}.`);
  }

  const tap = await submitAction(client, sessionId, {
    clientRequestId: `m11-portable-tap-${randomUUID()}`,
    type: "tap",
    payload: { kind: "tap", x: 0.5, y: 0.71 },
    sourceMetricsEpoch: running.session.currentEpoch,
    sourceFrameId: "m11-portable-launch-screen",
  });
  const swipe = await submitAction(client, sessionId, {
    clientRequestId: `m11-portable-swipe-${randomUUID()}`,
    type: "swipe",
    payload: {
      kind: "swipe",
      path: [
        [0.45, 0.5],
        [0.55, 0.5],
      ],
      durationMs: 400,
    },
    sourceMetricsEpoch: running.session.currentEpoch,
    sourceFrameId: "m11-portable-post-tap",
  });
  assertSucceededAction(tap, "tap");
  assertSucceededAction(swipe, "swipe");

  const completed = await client.call<{ session: { state: string } }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/complete`,
    jsonRequest({ state: "FINISHED", reason: "M11_PORTABLE_CLEAN_EXTRACTION_SMOKE" }, client),
  );
  if (completed.session.state !== "FINISHED") throw new Error("Portable session did not finish.");

  const initialResult = await waitForResult(
    client,
    sessionId,
    (result) =>
      result.finalization?.state === "COMPLETED" &&
      result.exports?.some((item) => item.format === "HTML" && item.state === "READY") === true &&
      result.exports?.some((item) => item.format === "ZIP" && item.state === "READY") === true,
  );
  await client.call(
    `/api/results/${encodeURIComponent(sessionId)}/exports`,
    jsonRequest({ formats: ["EXCEL", "PDF", "JUNIT"] }, client, {
      "Idempotency-Key": `m11-portable-exports-${randomUUID()}`,
    }),
  );
  const finalResult = await waitForResult(client, sessionId, (result) =>
    ["HTML", "ZIP", "EXCEL", "PDF", "JUNIT"].every(
      (format) =>
        result.exports?.some((item) => item.format === format && item.state === "READY") === true,
    ),
  );
  const downloads = await downloadExports(client, sessionId);
  evidence = {
    status: "PASS",
    startedAt,
    completedAt: new Date().toISOString(),
    cleanRoot: root,
    serials,
    packageName,
    artifactSelection: { kind: "INSTALLED", packageName, verifiedWithAdb: true },
    sessionId,
    preflightState: preflight.session.state,
    runningState: running.session.state,
    completedState: completed.session.state,
    actions: { tap, swipe },
    initialResult,
    finalResult,
    downloads,
    runtimeNode: nodePath,
    runtimeServer: serverPath,
  };
} catch (error) {
  evidence = {
    status: "FAIL",
    startedAt,
    completedAt: new Date().toISOString(),
    cleanRoot: root,
    serials,
    packageName,
    sessionId,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  process.exitCode = 1;
} finally {
  await stopProduct(product);
  await mkdir(evidenceRoot, { recursive: true });
  const evidencePath = win32.join(evidenceRoot, "m11-portable-smoke.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath })}\n`);
}

async function assertDevicesOnline(): Promise<void> {
  const result = await runAdb(["devices", "-l"]);
  if (result.code !== 0) throw new Error(`ADB discovery failed: ${result.stderr}`);
  const online = result.stdout
    .split(/\r?\n/)
    .filter((line) => /\s+device(?:\s|$)/.test(line))
    .map((line) => line.split(/\s+/)[0]);
  for (const serial of serials) {
    if (!online.includes(serial)) throw new Error(`Device is not online: ${serial}.`);
  }
  for (const serial of serials) {
    const packageResult = await runAdb(["-s", serial, "shell", "pm", "path", packageName]);
    if (packageResult.code !== 0 || !packageResult.stdout.includes("package:")) {
      throw new Error(`Installed package was not found on ${serial}: ${packageResult.stdout}`);
    }
  }
}

async function runAdb(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(adbPath, [...args], { cwd: root, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function startProduct(): Promise<ProductProcess> {
  const port = 4780 + Math.floor(Math.random() * 400);
  const bootstrapCode = randomUUID();
  const launchSecret = randomUUID();
  const child = spawn(nodePath, [serverPath], {
    cwd: root,
    env: {
      ...process.env,
      TEST_CENTER_DATA_ROOT: win32.join(root, "data"),
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
      TEST_CENTER_APPIUM_HOME: win32.join(root, "data", "appium-home"),
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
  return { child, port, bootstrapCode, launchSecret };
}

async function readJsonLine(
  stdout: NodeJS.ReadableStream,
  stderr: NodeJS.ReadableStream,
): Promise<Record<string, unknown>> {
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
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function verifyReadiness(value: Record<string, unknown>, secret: string): boolean {
  const unsigned = JSON.stringify({
    version: value.version,
    port: value.port,
    pid: value.pid,
    nonce: value.nonce,
  });
  const expected = createHmac("sha256", secret).update(unsigned, "utf8").digest("base64url");
  return value.hmac === expected;
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
      const current = cookie.split("; ").filter((item) => item && !item.startsWith(`${name}=`));
      current.push(`${name}=${value}`);
      cookie = current.join("; ");
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
  const download = async (path: string): Promise<Buffer> => {
    const headers = new Headers();
    headers.set("host", `127.0.0.1:${String(productProcess.port)}`);
    headers.set("origin", baseUrl);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${baseUrl}${path}`, { headers });
    if (!response.ok) throw new Error(`GET ${path} ${response.status}: ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  };
  await call("/api/bootstrap/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: productProcess.bootstrapCode }),
  });
  if (!csrf) throw new Error("Portable bootstrap exchange did not return CSRF cookie.");
  return { call, download, csrf: () => csrf };
}

function jsonRequest(
  body: unknown,
  client: ApiClient,
  extraHeaders: Record<string, string> = {},
): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-center-csrf": client.csrf(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

async function submitAction(client: ApiClient, id: string, body: Record<string, unknown>) {
  return await client.call<{ action: { state: string; targets: Array<{ state: string }> } }>(
    `/api/sessions/${encodeURIComponent(id)}/actions`,
    jsonRequest(body, client),
  );
}

function assertSucceededAction(
  result: { action: { state: string; targets: Array<{ state: string }> } },
  name: string,
): void {
  if (
    result.action.state !== "SUCCEEDED" ||
    result.action.targets.some((target) => target.state !== "SUCCEEDED")
  ) {
    throw new Error(`${name} action did not succeed: ${JSON.stringify(result)}.`);
  }
}

async function waitForResult(
  client: ApiClient,
  id: string,
  predicate: (result: ResultView) => boolean,
): Promise<ResultView> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const payload = await client.call<{ result: ResultView }>(
      `/api/results/${encodeURIComponent(id)}`,
    );
    if (predicate(payload.result)) return payload.result;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for portable result finalization/export.");
}

async function waitForDevices(client: ApiClient): Promise<{
  devices: Array<{ serial: string; state: string; metadata?: unknown }>;
}> {
  const deadline = Date.now() + 30_000;
  let latest: { devices: Array<{ serial: string; state: string; metadata?: unknown }> } = {
    devices: [],
  };
  while (Date.now() < deadline) {
    latest = await client.call<typeof latest>("/api/devices");
    const selected = latest.devices.filter((device) => serials.includes(device.serial));
    if (
      selected.length === serials.length &&
      selected.every((device) => device.state === "ONLINE")
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return latest;
}

async function downloadExports(
  client: ApiClient,
  id: string,
): Promise<Array<Record<string, unknown>>> {
  const targetRoot = win32.join(evidenceRoot, id, "exports");
  await mkdir(targetRoot, { recursive: true });
  const outputs: Array<Record<string, unknown>> = [];
  for (const format of ["HTML", "ZIP", "EXCEL", "PDF", "JUNIT"] as const) {
    const bytes = await client.download(`/api/results/${encodeURIComponent(id)}/exports/${format}`);
    const fileName =
      format === "HTML"
        ? "report.html"
        : format === "ZIP"
          ? "evidence.zip"
          : format === "EXCEL"
            ? "report.xlsx"
            : format === "PDF"
              ? "report.pdf"
              : "report.xml";
    const path = win32.join(targetRoot, fileName);
    await writeFile(path, bytes);
    outputs.push({
      format,
      path,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return outputs;
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
