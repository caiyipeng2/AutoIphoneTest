/* global console, process */

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value?.startsWith("--")) throw new Error(`Unexpected argument: ${value ?? ""}`);
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
  args.set(value.slice(2), next);
  index += 1;
}

const root = resolve(args.get("root") ?? process.cwd());
const output = resolve(args.get("output") ?? join(root, "manifest.sha256.json"));
const files = [];

async function visit(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name, "en-US"),
  );
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).replaceAll(sep, "/");
    if (relativePath === "manifest.sha256.json") continue;
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Portable output must not contain symbolic links: ${relativePath}`);
    }
    if (metadata.isDirectory()) {
      await visit(absolutePath);
      continue;
    }
    if (!metadata.isFile()) throw new Error(`Unsupported portable entry: ${relativePath}`);
    const bytes = await readFile(absolutePath);
    files.push({
      path: relativePath,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      licenseComponent: licenseComponent(relativePath),
    });
  }
}

function licenseComponent(path) {
  if (path.startsWith("tools/node/")) return "Node.js 22.23.1";
  if (path.startsWith("tools/java/")) return "Eclipse Temurin JDK 17";
  if (path.startsWith("tools/bundletool/")) return "Android bundletool 1.18.3";
  if (path.startsWith("tools/scrcpy/")) return "scrcpy 3.1";
  if (path.startsWith("data/tools/ms-playwright/")) return "Playwright Chromium";
  if (path.startsWith("node_modules/")) return "npm production dependency";
  if (path.startsWith("data/appium-home/")) return "Appium UiAutomator2 extension";
  return "Unity Multi-Device Test Center";
}

await visit(root);
files.sort((left, right) => left.path.localeCompare(right.path, "en-US"));
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  root: "portable-windows",
  files,
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${files.length} file hashes to ${output}`);
