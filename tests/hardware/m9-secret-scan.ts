import { readFile, readdir } from "node:fs/promises";
import { join, win32 } from "node:path";
const root = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const needle = process.env.TEST_CENTER_M9_TEXT?.trim();
const roots = [
  win32.join(root, "data"),
  win32.join(root, "output"),
  win32.join(root, "TestResults"),
];
const files: string[] = [];
for (const directory of roots) await collect(directory, files);
const hits: string[] = [];
if (needle)
  for (const file of files)
    if ((await readFile(file, "utf8").catch(() => "")).includes(needle)) hits.push(file);
process.stdout.write(
  `${JSON.stringify({ status: hits.length === 0 ? "PASS" : "FAIL", scannedFiles: files.length, plaintextHits: hits })}\n`,
);
if (hits.length > 0) process.exitCode = 1;
async function collect(directory: string, target: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, target);
    else if (entry.isFile()) target.push(path);
  }
}
