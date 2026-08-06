import { win32 } from "node:path";

import { ArtifactMetadataSchema, type ArtifactMetadata } from "@test-center/contracts/artifact";
import {
  ProcessRunner,
  type ProcessResult,
  type ProcessSpec,
} from "@test-center/environment/process-runner";

import { parseAabCertificates, parseAabManifest } from "./aab-metadata.js";
import { assertZipInput, parseApkBadging, parseApkCertificates } from "./apk-metadata.js";
import { renderArtifactToolCommand } from "./tool-commands.js";

export interface ArtifactMetadataToolPaths {
  readonly aapt2Path: string;
  readonly apksignerPath: string;
  readonly apksignerJarPath?: string;
  readonly javaPath: string;
  readonly bundletoolPath: string;
  readonly jarsignerPath: string;
  readonly cwd: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs?: number;
}

export interface ArtifactToolProcessRunner {
  run(spec: ProcessSpec): Promise<ProcessResult>;
}

export interface ArtifactMetadataParseRequest {
  readonly kind: "APK" | "AAB";
  readonly artifactPath: string;
}

export class ArtifactMetadataParser {
  private readonly paths: ArtifactMetadataToolPaths;
  private readonly runner: ArtifactToolProcessRunner;

  public constructor(
    paths: ArtifactMetadataToolPaths,
    runner: ArtifactToolProcessRunner = new ProcessRunner(),
  ) {
    this.paths = validatePaths(paths);
    this.runner = runner;
  }

  public async parse(request: ArtifactMetadataParseRequest): Promise<ArtifactMetadata> {
    const artifactPath = requireAbsolutePath(request.artifactPath, "artifactPath");
    await assertZipInput(artifactPath);
    if (request.kind === "APK") return await this.parseApk(artifactPath);
    return await this.parseAab(artifactPath);
  }

  private async parseApk(artifactPath: string): Promise<ArtifactMetadata> {
    const badgingResult = await this.runTool({
      executableId: "aapt2",
      ...renderArtifactToolCommand({
        kind: "aapt2Badging",
        executablePath: this.paths.aapt2Path,
        apkPath: artifactPath,
      }),
    });
    const signerResult = await this.runTool({
      executableId: "apksigner",
      ...this.renderApksignerCommand(artifactPath),
    });
    const metadata = parseApkBadging(badgingResult.stdout);
    return ArtifactMetadataSchema.parse({
      packageName: metadata.packageName,
      versionName: metadata.versionName,
      versionCode: metadata.versionCode,
      signerSha256: parseApkCertificates(signerResult.stdout),
    });
  }

  private async parseAab(artifactPath: string): Promise<ArtifactMetadata> {
    const manifestResult = await this.runTool({
      executableId: "bundletool",
      ...renderArtifactToolCommand({
        kind: "bundletoolManifest",
        javaPath: this.paths.javaPath,
        bundletoolPath: this.paths.bundletoolPath,
        bundlePath: artifactPath,
      }),
    });
    const signerResult = await this.runTool({
      executableId: "jarsigner",
      ...renderArtifactToolCommand({
        kind: "jarsignerVerify",
        executablePath: this.paths.jarsignerPath,
        bundlePath: artifactPath,
      }),
    });
    const metadata = parseAabManifest(manifestResult.stdout);
    return ArtifactMetadataSchema.parse({
      packageName: metadata.packageName,
      ...(metadata.versionName === undefined ? {} : { versionName: metadata.versionName }),
      ...(metadata.versionCode === undefined ? {} : { versionCode: metadata.versionCode }),
      signerSha256: parseAabCertificates(signerResult.stdout),
    });
  }

  private renderApksignerCommand(artifactPath: string): {
    readonly executablePath: string;
    readonly args: readonly string[];
  } {
    const extension = win32.extname(this.paths.apksignerPath).toLowerCase();
    if (extension === ".bat" || extension === ".cmd") {
      if (this.paths.apksignerJarPath === undefined) {
        throw new Error(
          "APKSIGNER_WRAPPER_UNSUPPORTED: .bat/.cmd apksigner paths require apksignerJarPath.",
        );
      }
      return {
        executablePath: this.paths.javaPath,
        args: ["-jar", this.paths.apksignerJarPath, "verify", "--print-certs", artifactPath],
      };
    }
    return renderArtifactToolCommand({
      kind: "apksignerCerts",
      executablePath: this.paths.apksignerPath,
      apkPath: artifactPath,
    });
  }

  private async runTool(command: {
    readonly executableId: string;
    readonly executablePath: string;
    readonly args: readonly string[];
  }): Promise<ProcessResult> {
    const spec: ProcessSpec = {
      executableId: command.executableId,
      executablePath: command.executablePath,
      args: command.args,
      cwd: this.paths.cwd,
      env: this.paths.env ?? process.env,
      timeoutMs: this.paths.timeoutMs ?? 30_000,
      serialRequirement: "forbidden",
      maxOutputBytes: 4 * 1024 * 1024,
    };
    const result = await this.runner.run(spec);
    if (result.timedOut || result.exitCode !== 0) {
      const detail = result.stderr.trim();
      throw new Error(
        `TOOL_FAILURE: ${command.executableId} failed${detail.length === 0 ? "." : `: ${detail}`}`,
      );
    }
    return result;
  }
}

function validatePaths(paths: ArtifactMetadataToolPaths): ArtifactMetadataToolPaths {
  const keys: Array<keyof ArtifactMetadataToolPaths> = [
    "aapt2Path",
    "apksignerPath",
    "javaPath",
    "bundletoolPath",
    "jarsignerPath",
    "cwd",
  ];
  for (const key of keys) requireAbsolutePath(paths[key] as string, key);
  if (paths.apksignerJarPath !== undefined)
    requireAbsolutePath(paths.apksignerJarPath, "apksignerJarPath");
  return {
    ...paths,
    aapt2Path: win32.normalize(paths.aapt2Path),
    apksignerPath: win32.normalize(paths.apksignerPath),
    ...(paths.apksignerJarPath === undefined
      ? {}
      : { apksignerJarPath: win32.normalize(paths.apksignerJarPath) }),
    javaPath: win32.normalize(paths.javaPath),
    bundletoolPath: win32.normalize(paths.bundletoolPath),
    jarsignerPath: win32.normalize(paths.jarsignerPath),
    cwd: win32.normalize(paths.cwd),
  };
}

function requireAbsolutePath(value: string, label: string): string {
  if (!win32.isAbsolute(value)) throw new TypeError(`${label} must be an absolute Windows path.`);
  return win32.normalize(value);
}
