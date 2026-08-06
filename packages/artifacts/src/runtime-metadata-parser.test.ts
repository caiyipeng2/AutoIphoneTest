import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProcessResult, ProcessSpec } from "@test-center/environment/process-runner";

import {
  ArtifactMetadataParser,
  type ArtifactMetadataToolPaths,
  type ArtifactToolProcessRunner,
} from "./runtime-metadata-parser.js";

const roots: string[] = [];
const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function paths(): ArtifactMetadataToolPaths {
  return {
    aapt2Path: "D:\\Android\\build-tools\\35.0.0\\aapt2.exe",
    apksignerPath: "D:\\Android\\build-tools\\35.0.0\\apksigner.bat",
    apksignerJarPath: "D:\\Android\\build-tools\\35.0.0\\lib\\apksigner.jar",
    javaPath: "E:\\Tools\\java\\bin\\java.exe",
    bundletoolPath: "E:\\Tools\\bundletool\\bundletool-all-1.18.3.jar",
    jarsignerPath: "E:\\Tools\\java\\bin\\jarsigner.exe",
    cwd: "E:\\Projects\\UnityMultiDeviceTestCenter",
  };
}

function result(spec: ProcessSpec, stdout: string): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 1,
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    command: {
      executableId: spec.executableId,
      executablePath: spec.executablePath ?? "",
      args: spec.args,
    },
  };
}

describe("ArtifactMetadataParser", () => {
  it("parses an APK through explicit aapt2 and apksigner commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-runtime-parser-"));
    roots.push(root);
    const artifactPath = win32.join(root, "game.partial");
    await writeFile(artifactPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const calls: ProcessSpec[] = [];
    const runner: ArtifactToolProcessRunner = {
      run: async (spec) => {
        calls.push(spec);
        if (spec.executableId === "aapt2")
          return result(
            spec,
            "package: name='com.example.game' versionCode='42' versionName='1.4.2'\n" +
              "sdkVersion:'26'\ntargetSdkVersion:'35'\n" +
              "launchable-activity: name='com.example.game.MainActivity'\n" +
              "native-code: 'arm64-v8a'\n",
          );
        return result(spec, `Signer #1 certificate SHA-256 digest: ${digest}\n`);
      },
    };

    const metadata = await new ArtifactMetadataParser(paths(), runner).parse({
      kind: "APK",
      artifactPath,
    });

    expect(metadata).toEqual({
      packageName: "com.example.game",
      versionName: "1.4.2",
      versionCode: 42,
      signerSha256: digest,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      executableId: "aapt2",
      executablePath: paths().aapt2Path,
      args: ["dump", "badging", artifactPath],
      serialRequirement: "forbidden",
    });
    expect(calls[1]).toMatchObject({
      executableId: "apksigner",
      executablePath: paths().javaPath,
      args: ["-jar", paths().apksignerJarPath, "verify", "--print-certs", artifactPath],
      serialRequirement: "forbidden",
    });
  });

  it("parses an AAB through explicit bundletool and jarsigner commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-runtime-parser-"));
    roots.push(root);
    const artifactPath = win32.join(root, "game.partial");
    await writeFile(artifactPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const calls: ProcessSpec[] = [];
    const runner: ArtifactToolProcessRunner = {
      run: async (spec) => {
        calls.push(spec);
        if (spec.executableId === "bundletool")
          return result(
            spec,
            '<manifest package="com.example.game" android:versionCode="42" android:versionName="1.4.2">' +
              '<uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35" />' +
              "</manifest>",
          );
        return result(spec, `jar verified, signer certificate SHA256: ${digest}\n`);
      },
    };

    const metadata = await new ArtifactMetadataParser(paths(), runner).parse({
      kind: "AAB",
      artifactPath,
    });

    expect(metadata).toEqual({
      packageName: "com.example.game",
      versionName: "1.4.2",
      versionCode: 42,
      signerSha256: digest,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      executableId: "bundletool",
      executablePath: paths().javaPath,
      args: ["-jar", paths().bundletoolPath, "dump", "manifest", "--bundle", artifactPath],
      serialRequirement: "forbidden",
    });
    expect(calls[1]).toMatchObject({
      executableId: "jarsigner",
      executablePath: paths().jarsignerPath,
      args: ["-verify", "-certs", artifactPath],
      serialRequirement: "forbidden",
    });
  });

  it("rejects non-absolute paths and invalid ZIP input before spawning tools", async () => {
    const runner: ArtifactToolProcessRunner = {
      run: async () => {
        throw new Error("spawned");
      },
    };
    const parser = new ArtifactMetadataParser(paths(), runner);
    await expect(parser.parse({ kind: "APK", artifactPath: "relative.apk" })).rejects.toThrow(
      "absolute",
    );

    const root = await mkdtemp(join(tmpdir(), "test-center-runtime-parser-"));
    roots.push(root);
    const invalidPath = win32.join(root, "game.partial");
    await writeFile(invalidPath, "not a zip");
    await expect(parser.parse({ kind: "AAB", artifactPath: invalidPath })).rejects.toThrow(
      "INVALID_FORMAT",
    );
  });

  it("classifies a failed tool process without publishing metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-runtime-parser-"));
    roots.push(root);
    const artifactPath = win32.join(root, "game.partial");
    await writeFile(artifactPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const runner: ArtifactToolProcessRunner = {
      run: async (spec) => ({ ...result(spec, ""), exitCode: 1, stderr: "tool failed" }),
    };
    await expect(
      new ArtifactMetadataParser(paths(), runner).parse({ kind: "APK", artifactPath }),
    ).rejects.toThrow("TOOL_FAILURE");
  });
});
