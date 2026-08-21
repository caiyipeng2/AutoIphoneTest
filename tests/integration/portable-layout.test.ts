import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const portableRoot = process.env.TEST_CENTER_PORTABLE_ROOT
  ? resolve(process.env.TEST_CENTER_PORTABLE_ROOT)
  : undefined;

const requiredFiles = [
  "TestCenterLauncher.exe",
  "apps/server/dist/main.js",
  "apps/console/dist/index.html",
  "tools/node/22.23.1/node.exe",
  "node_modules/fastify/package.json",
  "node_modules/@test-center/server/package.json",
  "data/appium-home/node_modules/appium-uiautomator2-driver/package.json",
  "tools/java/17.0.19+10/bin/java.exe",
  "tools/bundletool/1.18.3/bundletool-all-1.18.3.jar",
  "tools/scrcpy/3.1/scrcpy.exe",
  "tools/scrcpy/3.1/scrcpy-server",
  "data/tools/ms-playwright/chromium-1187/chrome-win/chrome.exe",
  "config/settings.example.json",
  "docs/user-guide.md",
  "docs/device-onboarding.md",
  "THIRD_PARTY_NOTICES.md",
  "manifest.sha256.json",
] as const;

describe.skipIf(portableRoot === undefined)("portable Windows layout", () => {
  it("contains the self-contained runtime and verified release manifest", () => {
    const root = portableRoot!;
    for (const file of requiredFiles) {
      expect(
        statSync(join(root, ...file.split("/")), { throwIfNoEntry: false }),
        file,
      ).toBeTruthy();
    }

    const manifestPath = join(root, "manifest.sha256.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files: Array<{ path: string; sha256: string; size: number }>;
    };
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const entry of manifest.files) {
      const filePath = join(root, ...entry.path.split("/"));
      expect(statSync(filePath).isFile(), entry.path).toBe(true);
      expect(statSync(filePath).size, entry.path).toBe(entry.size);
      expect(createHash("sha256").update(readFileSync(filePath)).digest("hex"), entry.path).toBe(
        entry.sha256,
      );
    }
  }, 120_000);

  it("does not ship build-machine paths, escaping links, caches, secrets, or imported runs", () => {
    const root = portableRoot!;
    const forbiddenNames = new Set([
      ".git",
      ".codegraph",
      "coverage",
      "playwright-report",
      "TestResults",
      "node_modules/.cache",
      "data/imports",
      "data/runs",
      "data/test-center.sqlite",
    ]);
    const sourceMarkers = [
      "E:\\Projects\\UnityMultiDeviceTestCenter",
      "C:\\Users\\EDY\\Documents\\AutoIphoneTest",
      "D:\\Project\\",
    ];
    const textExtensions = new Set([".json", ".js", ".mjs", ".ts", ".html", ".md", ".txt", ".cs"]);
    const visited: string[] = [];

    function visit(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const filePath = join(directory, entry.name);
        const rel = relative(root, filePath).replaceAll(sep, "/");
        visited.push(rel);
        expect(forbiddenNames.has(rel), rel).toBe(false);
        expect(/(^|\/)(?:\.env(?:\..*)?|.*\.(?:key|p12|pfx))$/i.test(rel), rel).toBe(false);

        const stat = lstatSync(filePath);
        if (stat.isSymbolicLink()) {
          const target = realpathSync(filePath);
          expect(target.startsWith(`${root}${sep}`) || target === root, rel).toBe(true);
        }
        if (entry.isDirectory()) {
          visit(filePath);
          return;
        }
        if (textExtensions.has(filePath.slice(filePath.lastIndexOf(".")))) {
          const content = readFileSync(filePath, "utf8");
          for (const marker of sourceMarkers) expect(content, rel).not.toContain(marker);
        }
      }
    }

    visit(root);
    expect(visited).not.toContain("data/imports");
  });
});
