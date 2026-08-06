import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import Database from "better-sqlite3";
import { FOUNDATION_MIGRATION, INSTALL_SETS_MIGRATION, migrate } from "@test-center/database";
import type { ProcessResult, ProcessSpec } from "@test-center/environment/process-runner";
import { parseDeviceSerial } from "@test-center/contracts/device";

import {
  InstallSetRepository,
  executeDeviceSpecificInstallSet,
  assertInstalledIdentityMatches,
  verifyInstalledIdentity,
} from "./install-set-executor.js";

const roots: string[] = [];
const databases: Database.Database[] = [];
const serial = parseDeviceSerial("R5CX211TXNT");

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
  for (const database of databases.splice(0)) database.close();
});

function result(spec: ProcessSpec): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 1,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    command: { executableId: spec.executableId, executablePath: spec.executablePath ?? "", args: spec.args },
  };
}

describe("device-specific AAB install-set executor", () => {
  it("runs get-device-spec, builds to .partial, publishes, persists, then installs", async () => {
    const root = win32.join(process.cwd(), "data", "tests", `executor-${randomUUID()}`);
    roots.push(root);
    await mkdir(root, { recursive: true });
    const specPath = win32.join(root, "device-spec.json");
    const partialPath = win32.join(root, "game.apks.partial");
    const finalPath = win32.join(root, "game.apks");
    const calls: ProcessSpec[] = [];
    const runner = {
      run: async (spec: ProcessSpec) => {
        calls.push(spec);
        if (spec.args.includes("get-device-spec")) await writeFile(specPath, '{"supportedAbis":["arm64-v8a"],"sdkVersion":34}');
        if (spec.args.includes("build-apks")) await writeFile(partialPath, "apks-content");
        return result(spec);
      },
    };
    const database = new Database(":memory:");
    migrate(database, [FOUNDATION_MIGRATION, INSTALL_SETS_MIGRATION]);
    databases.push(database);
    const repository = new InstallSetRepository(database);
    const commandInput = {
      serial,
      javaPath: "D:\\Tools\\java\\bin\\java.exe",
      bundletoolJarPath: "E:\\Tools\\bundletool.jar",
      adbPath: "D:\\Android\\platform-tools\\adb.exe",
      bundlePath: "E:\\Artifacts\\game.aab",
      deviceSpecPath: specPath,
      installSetPath: partialPath,
      signing: {
        keystorePath: "E:\\Secrets\\qa.keystore",
        alias: "qa",
        storePasswordFile: "E:\\Temp\\store-password.txt",
        keyPasswordFile: "E:\\Temp\\key-password.txt",
      },
    };

    const execution = await executeDeviceSpecificInstallSet({
      serial,
      commandInput,
      finalPath,
      bundleSha256: "a".repeat(64),
      signerSha256: "b".repeat(64),
      bundletoolVersion: "1.18.3",
      repository,
      runner,
    });

    expect(calls.map((call) => call.args.find((arg) => ["get-device-spec", "build-apks", "install-apks"].includes(arg)))).toEqual([
      "get-device-spec",
      "build-apks",
      "install-apks",
    ]);
    expect(execution.installSetPath).toBe(finalPath);
    expect(repository.findByCacheKey(execution.cacheKey)?.archiveSha256).toBe(
      createHash("sha256").update("apks-content").digest("hex"),
    );
    calls.length = 0;
    const cached = await executeDeviceSpecificInstallSet({
      serial,
      commandInput,
      finalPath,
      bundleSha256: "a".repeat(64),
      signerSha256: "b".repeat(64),
      bundletoolVersion: "1.18.3",
      repository,
      runner,
    });
    expect(cached.cacheHit).toBe(true);
    expect(calls.map((call) => call.args.find((arg) => ["get-device-spec", "build-apks", "install-apks"].includes(arg)))).toEqual([
      "get-device-spec",
      "install-apks",
    ]);
  });

  it("rejects an installed identity when package, version, or signer differs", () => {
    expect(() =>
      assertInstalledIdentityMatches(
        { packageName: "com.example.game", versionName: "1.0.0", versionCode: 7, signerSha256: "a".repeat(64) },
        { packageName: "com.example.game", versionName: "1.0.1", versionCode: 7, signerSha256: "a".repeat(64) },
      ),
    ).toThrow(/versionName/);
  });

  it("accepts the installed identity only after the collector matches", async () => {
    const observed = await verifyInstalledIdentity({
      expected: {
        packageName: "com.example.game",
        versionName: "1.0.0",
        versionCode: 7,
        signerSha256: "a".repeat(64),
      },
      collect: async () => ({
        packageName: "com.example.game",
        versionName: "1.0.0",
        versionCode: 7,
        signerSha256: "a".repeat(64),
      }),
    });
    expect(observed.versionCode).toBe(7);
  });
});
