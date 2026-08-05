import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { win32 } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import {
  createApksignerSignerResolver,
  parsePackagePaths,
  collectInstalledIdentity,
  type InstalledIdentityExecutor,
} from "./installed-identity.js";
import type { AdbClient } from "@test-center/adb";

const serial = parseDeviceSerial("R5CX211TXNT");
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../tests/fixtures/adb/${name}`, import.meta.url));

function result(stdout: string, exitCode = 0) {
  return { stdout, stderr: "", exitCode, timedOut: false };
}

describe("installed identity", () => {
  it("parses pm paths, details, resolves activity, and hashes sorted base/split bytes", async () => {
    const paths = await readFile(fixture("pm-path.txt"), "utf8");
    const details = await readFile(fixture("dumpsys-package.txt"), "utf8");
    const files = new Map([
      ["/data/app/~~abc/com.example.game-abc/base.apk", Buffer.from("base")],
      ["/data/app/~~abc/com.example.game-abc/split_config.arm64_v8a.apk", Buffer.from("split")],
    ]);
    const executor: InstalledIdentityExecutor = {
      execute: async (command) => {
        switch (command.kind) {
          case "packagePaths":
            return result(paths);
          case "packageDetails":
            return result(details);
          case "resolveActivity":
            return result(
              "priority=0 preferredOrder=0 match=0x108000\ncom.example.game/.MainActivity\n",
            );
          default:
            throw new Error(`unexpected ${command.kind}`);
        }
      },
      stream: async (command, onChunk) => {
        if (command.kind !== "streamPackageFile") return result("", 1);
        const bytes = files.get(command.filePath);
        if (bytes === undefined) return result("", 1);
        onChunk(bytes);
        return result("", 0);
      },
    };
    const identity = await collectInstalledIdentity(
      serial,
      "com.example.game",
      executor,
      "2026-08-05T10:00:00.000Z",
    );
    const records = [
      { pathRole: "BASE", sha256: createHash("sha256").update("base").digest("hex") },
      { pathRole: "SPLIT", sha256: createHash("sha256").update("split").digest("hex") },
    ];
    expect(identity).toMatchObject({
      deviceSerial: serial,
      packageName: "com.example.game",
      versionName: "1.4.2",
      versionCode: 42,
      launchActivity: "com.example.game/.MainActivity",
      signerSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      installedSetSha256: createHash("sha256").update(JSON.stringify(records)).digest("hex"),
    });
  });

  it("rejects mixed or disappeared package paths", () => {
    expect(() =>
      parsePackagePaths("package:/data/app/one/base.apk\npackage:/data/app/../escape.apk"),
    ).toThrow();
  });

  it("uses a host signer resolver when Android exposes only a short dumpsys token", async () => {
    const paths = await readFile(fixture("pm-path.txt"), "utf8");
    const details = (await readFile(fixture("dumpsys-package.txt"), "utf8")).replace(
      /[0-9a-f]{64}/,
      "9ec2a544",
    );
    const executor = {
      execute: async (command: { kind: string }) => {
        if (command.kind === "packagePaths") return result(paths);
        if (command.kind === "packageDetails") return result(details);
        if (command.kind === "resolveActivity") return result("com.example.game/.MainActivity\n");
        throw new Error(`unexpected ${command.kind}`);
      },
      stream: async (_command: unknown, onChunk: (chunk: Buffer) => void) => {
        onChunk(Buffer.from("package"));
        return result("");
      },
      signerSha256: async () => "a".repeat(64),
    } as InstalledIdentityExecutor & {
      signerSha256: () => Promise<string>;
    };

    const identity = await collectInstalledIdentity(serial, "com.example.game", executor);
    expect(identity.signerSha256).toBe("a".repeat(64));
  });

  it("extracts a certificate digest from a streamed base APK with apksigner", async () => {
    const tempRoot = win32.join(process.cwd(), "data", `task6-apksigner-${randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    try {
      const client = {
        execute: async (
          _command: unknown,
          options: { stdoutSink?: (chunk: Buffer) => void } = {},
        ) => {
          options.stdoutSink?.(Buffer.from("apk-bytes"));
          return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
        },
      } as unknown as AdbClient;
      const resolver = createApksignerSignerResolver(client, {
        apksignerPath: "D:\\Android\\build-tools\\34.0.0\\apksigner.bat",
        javaPath: "D:\\Android\\OpenJDK\\bin\\java.exe",
        apksignerJarPath: "D:\\Android\\build-tools\\34.0.0\\lib\\apksigner.jar",
        cwd: tempRoot,
        tempRoot,
        runner: {
          run: async (spec) => {
            expect(spec.executableId).toBe("apksigner");
            expect(spec.executablePath?.toLowerCase()).toMatch(/java\.exe$/);
            expect(spec.args).toContain("-jar");
            expect(spec.args).toContain("--print-certs");
            return {
              exitCode: 0,
              signal: null,
              timedOut: false,
              durationMs: 1,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdout:
                "Signer #1 certificate SHA-256 digest: e5:8c:fe:35:44:fd:61:23:7a:10:f6:ae:dc:d8:f0:e1:17:d4:76:f4:39:95:fd:69:71:7a:96:0a:6d:a5:8b:ec",
              stderr: "",
              command: {
                executableId: "apksigner",
                executablePath: "D:\\Android\\build-tools\\34.0.0\\apksigner.bat",
                args: [],
              },
            };
          },
        },
      });

      await expect(
        resolver({
          serial,
          packageName: "com.example.game",
          basePath: "/data/app/~~abc/com.example.game-abc/base.apk",
        }),
      ).resolves.toBe("e58cfe3544fd61237a10f6aedcd8f0e117d476f43995fd69717a960a6da58bec");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("cleans the signer scratch directory when ADB streaming fails", async () => {
    const tempRoot = win32.join(process.cwd(), "data", `task6-apksigner-failure-${randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    try {
      const client = {
        execute: async () => {
          throw new Error("simulated ADB stream failure");
        },
      } as unknown as AdbClient;
      const resolver = createApksignerSignerResolver(client, {
        apksignerPath: "D:\\Android\\build-tools\\34.0.0\\apksigner.bat",
        javaPath: "D:\\Android\\OpenJDK\\bin\\java.exe",
        apksignerJarPath: "D:\\Android\\build-tools\\34.0.0\\lib\\apksigner.jar",
        cwd: tempRoot,
        tempRoot,
      });

      await expect(
        resolver({
          serial,
          packageName: "com.example.game",
          basePath: "/data/app/~~abc/com.example.game-abc/base.apk",
        }),
      ).rejects.toThrow("simulated ADB stream failure");
      await expect(readdir(tempRoot)).resolves.toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
