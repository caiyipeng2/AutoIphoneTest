import { spawn } from "node:child_process";
import { win32 } from "node:path";

const root = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serials = (process.env.TEST_CENTER_M9_SERIALS ?? process.env.TEST_CENTER_DEVICE_SERIAL ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const scripts = [
  "m9-activate.ts",
  "m9-back.ts",
  "m9-longpress-drag.ts",
  "m9-terminate.ts",
  "m9-restart.ts",
] as const;
if (serials.length === 0) throw new Error("Set TEST_CENTER_M9_SERIALS to one or more ADB serials.");
const results: Array<{ script: string; serial: string; status: "PASS" | "FAIL" }> = [];
for (const serial of serials)
  for (const script of scripts) {
    const status = await runScript(script, serial);
    results.push({ script, serial, status });
    if (status === "FAIL") process.exitCode = 1;
  }
process.stdout.write(
  `${JSON.stringify({ status: process.exitCode ? "FAIL" : "PASS", results })}\n`,
);
async function runScript(script: string, serial: string): Promise<"PASS" | "FAIL"> {
  return await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", win32.join(root, "tests", "hardware", script)],
      {
        cwd: root,
        env: { ...process.env, TEST_CENTER_PROJECT_ROOT: root, TEST_CENTER_DEVICE_SERIAL: serial },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("exit", (code) => resolve(code === 0 ? "PASS" : "FAIL"));
    child.once("error", () => resolve("FAIL"));
  });
}
