import { mkdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { console } from "node:console";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serial = process.env.ANDROID_SERIAL ?? "R5CX211TXNT";
const executablePath = path.join(projectRoot, "tools", "scrcpy", "3.1", "scrcpy.exe");
const runId = `scrcpy-primary-${Date.now()}`;
const runsRoot = path.join(projectRoot, "data", "runs", runId);
const recordPath = path.join(runsRoot, "screen.mkv");
const acceptancePath = path.join(runsRoot, "acceptance.json");
const args = [
  `--serial=${serial}`,
  "--no-window",
  "--no-control",
  "--no-audio",
  "--no-clipboard-autosync",
  "--video-codec=h264",
  `--record=${recordPath}`,
  "--record-format=mkv",
];

await mkdir(runsRoot, { recursive: true });
const child = spawn(executablePath, args, {
  cwd: projectRoot,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let spawned = false;
let spawnError;
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
  if (stderr.length > 4096) stderr = stderr.slice(-4096);
});
child.once("spawn", () => {
  spawned = true;
});
child.once("error", (error) => {
  spawnError = error;
});

const close = new Promise((resolve) => {
  child.once("close", (code, signal) => resolve({ code, signal }));
});
await delay(8000);
const aliveAfterWarmup = child.exitCode === null;
if (aliveAfterWarmup) child.kill();
const termination = await close;
let recordBytes = 0;
try {
  recordBytes = (await stat(recordPath)).size;
} catch {
  // A missing recording is represented by the initialized zero-byte value.
}

const evidence = {
  schemaVersion: 1,
  runId,
  serial,
  executablePath,
  args,
  spawned,
  aliveAfterWarmup,
  spawnError: spawnError?.message,
  termination,
  recordPath,
  recordBytes,
  stderr,
  cleanup: !aliveAfterWarmup || termination.signal === "SIGTERM",
};
await writeFile(acceptancePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...evidence, acceptancePath }, null, 2));

if (!spawned || !aliveAfterWarmup || recordBytes <= 0) {
  process.exitCode = 1;
}
