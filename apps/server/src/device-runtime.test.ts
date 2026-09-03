import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { AdbClient } from "@test-center/adb";
import { ContentStore } from "@test-center/artifacts";
import {
  configureDatabase,
  FOUNDATION_MIGRATION,
  ARTIFACTS_MIGRATION,
  migrate,
} from "@test-center/database";

import { createAppiumSdkEnvironment, RuntimeArtifactRouteService } from "./device-runtime.js";

const roots: string[] = [];
const databases: Database.Database[] = [];
const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("RuntimeArtifactRouteService", () => {
  it("derives a shared Appium SDK root from the runtime ADB executable", () => {
    expect(createAppiumSdkEnvironment("E:\\tools\\scrcpy\\3.1\\adb.exe")).toEqual({
      ANDROID_HOME: "E:\\tools\\scrcpy\\3.1",
      ANDROID_SDK_ROOT: "E:\\tools\\scrcpy\\3.1",
    });
    expect(createAppiumSdkEnvironment("D:\\Android\\platform-tools\\adb.exe")).toEqual({
      ANDROID_HOME: "D:\\Android",
      ANDROID_SDK_ROOT: "D:\\Android",
    });
  });

  it("persists parsed APK metadata from the staged path", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-runtime-artifact-"));
    roots.push(root);
    const database = new Database(":memory:");
    databases.push(database);
    configureDatabase(database);
    migrate(database, [FOUNDATION_MIGRATION, ARTIFACTS_MIGRATION]);
    const artifactPath = win32.join(root, "game.apk");
    await writeFile(artifactPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const service = new RuntimeArtifactRouteService(
      database,
      new ContentStore({ rootPath: win32.join(root, "artifacts") }),
      new AdbClient({
        adbPath: "D:\\Android\\platform-tools\\adb.exe",
        cwd: root,
        runner: {
          run: async () => {
            throw new Error("ADB should not run");
          },
        },
      }),
      root,
      win32.join(root, "temp"),
      {
        parse: async ({ kind, artifactPath: stagedPath }) => {
          expect(kind).toBe("APK");
          expect(stagedPath).toMatch(/\.partial$/i);
          return {
            packageName: "com.example.game",
            versionName: "1.4.2",
            versionCode: 42,
            signerSha256: digest,
          };
        },
      },
    );

    const result = await service.provider.build(
      {
        providerId: "artifact-import",
        kind: "APK",
        importSource: root,
        artifactPath,
      },
      async () => undefined,
    );

    expect(result.artifact).toMatchObject({
      kind: "APK",
      packageName: "com.example.game",
      versionName: "1.4.2",
      versionCode: 42,
    });
    expect(service.get(result.artifact.artifactId)).toMatchObject({
      packageName: "com.example.game",
      signerSha256: digest,
    });
  });

  it("registers the optional Unity command provider only with explicit configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-runtime-unity-provider-"));
    roots.push(root);
    const database = new Database(":memory:");
    databases.push(database);
    configureDatabase(database);
    migrate(database, [FOUNDATION_MIGRATION, ARTIFACTS_MIGRATION]);
    const service = new RuntimeArtifactRouteService(
      database,
      new ContentStore({ rootPath: win32.join(root, "artifacts") }),
      new AdbClient({
        adbPath: "D:\\Android\\platform-tools\\adb.exe",
        cwd: root,
        runner: {
          run: async () => {
            throw new Error("ADB should not run");
          },
        },
      }),
      root,
      win32.join(root, "temp"),
      undefined,
      {
        executablePath: "D:\\Unity\\Editor\\Unity.exe",
        projectPath: root,
        argumentTemplates: ["-batchmode", "-projectPath", "${projectPath}", "${artifactPath}"],
      },
    );

    expect(service.providers.map((provider) => provider.id)).toEqual([
      "artifact-import",
      "unity-command",
    ]);
  });
});
