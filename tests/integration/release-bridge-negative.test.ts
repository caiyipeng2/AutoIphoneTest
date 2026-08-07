import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());
const artifactRoot = process.env.TEST_CENTER_FIXTURE_APK_DIR
  ? resolve(process.env.TEST_CENTER_FIXTURE_APK_DIR)
  : join(projectRoot, "TestResults", "m5-fixture");
const qaApk = join(artifactRoot, "qa-bridge-fixture.apk");
const releaseApk = join(artifactRoot, "release-no-bridge.apk");
const artifactsAvailable = existsSync(qaApk) && existsSync(releaseApk);

type ExtractedApk = {
  root: string;
  entries: string[];
};

function extractApk(apkPath: string): ExtractedApk {
  const root = mkdtempSync(join(tmpdir(), "test-center-apk-"));
  execFileSync(process.env.TEST_CENTER_TAR_PATH ?? "tar", ["-xf", apkPath, "-C", root], {
    stdio: "ignore",
  });
  const entries = listFiles(root).map((path) => path.slice(root.length + 1).replaceAll("\\", "/"));
  return { root, entries };
}

function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function containsMarker(root: string, marker: string): boolean {
  return listFiles(root)
    .filter((path) => /assets[\\/]bin[\\/]Data[\\/]Managed[\\/](Assembly-CSharp|TestCenter\.QaBridge)\.dll$/i.test(path))
    .some((path) => readFileSync(path).includes(Buffer.from(marker, "utf8")));
}

describe.skipIf(!artifactsAvailable)("Unity bridge release-negative APK inspection", () => {
  it("includes the bridge assembly in the QA artifact", () => {
    const extracted = extractApk(qaApk);
    try {
      const assembliesPath = join(extracted.root, "assets", "bin", "Data", "ScriptingAssemblies.json");
      expect(readFileSync(assembliesPath, "utf8")).toContain("TestCenter.QaBridge.dll");
    } finally {
      rmSync(extracted.root, { recursive: true, force: true });
    }
  });

  it("omits bridge assemblies, listener configuration, and QA messages from release", () => {
    const extracted = extractApk(releaseApk);
    try {
      expect(extracted.entries).not.toContain("assets/bin/Data/Managed/TestCenter.QaBridge.dll");
      const assembliesPath = join(extracted.root, "assets", "bin", "Data", "ScriptingAssemblies.json");
      expect(readFileSync(assembliesPath, "utf8")).not.toContain("TestCenter.QaBridge.dll");
      for (const marker of [
        "TestCenter.QaBridge",
        "QaBridgeServer",
        "QA_STATE",
        "QA_ARMED",
        "QA_ACK",
        "17501",
      ]) {
        expect(containsMarker(extracted.root, marker), marker).toBe(false);
      }
    } finally {
      rmSync(extracted.root, { recursive: true, force: true });
    }
  });
});
