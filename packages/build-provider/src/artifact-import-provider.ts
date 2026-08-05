import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { win32 } from "node:path";

import type { ArtifactMetadata, SourceArtifact } from "@test-center/contracts/artifact";
import type {
  ArtifactPublishResult,
  SourceArtifactInput,
  StagedContent,
} from "@test-center/artifacts";

import {
  AppArtifactRefSchema,
  BuildProviderError,
  BuildRequestSchema,
  type BuildEvent,
  type BuildEventSink,
  type BuildProvider,
  BuildProviderRegistry,
  type BuildRequest,
  type BuildResult,
  type BuildValidation,
  type BuildValidationIssue,
  isBuildProviderErrorCode,
} from "./build-provider.js";

export interface ArtifactImportFileRequest {
  readonly kind: "APK" | "AAB";
  readonly importSource: string;
  readonly artifactPath: string;
  readonly originalName: string;
}

export interface ArtifactImportService {
  /** The service owns partial-file cleanup if the signal aborts while staging. */
  stage(request: ArtifactImportFileRequest, signal: AbortSignal): Promise<StagedContent>;
  parse(
    request: ArtifactImportFileRequest,
    staged: StagedContent,
    signal: AbortSignal,
  ): Promise<ArtifactMetadata>;
  publish(staged: StagedContent, input: SourceArtifactInput): Promise<ArtifactPublishResult>;
  discard(staged: StagedContent): Promise<void>;
}

interface ValidatedImportRequest extends ArtifactImportFileRequest {
  readonly sourceRealPath: string;
  readonly fileRealPath: string;
}

export class ArtifactImportProvider implements BuildProvider {
  public readonly id = "artifact-import";
  private readonly activeBuilds = new Map<string, AbortController>();

  public constructor(private readonly service: ArtifactImportService) {}

  public async validate(request: BuildRequest): Promise<BuildValidation> {
    const parsed = BuildRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        valid: false,
        errors: [
          {
            code: "INVALID_REQUEST",
            message: parsed.error.issues.map((issue) => issue.message).join("; "),
          },
        ],
      };
    }
    const issues = await this.collectValidationIssues(parsed.data);
    return { valid: issues.length === 0, errors: issues };
  }

  public async build(request: BuildRequest, events: BuildEventSink): Promise<BuildResult> {
    const buildId = randomUUID();
    const controller = new AbortController();
    this.activeBuilds.set(buildId, controller);
    let staged: StagedContent | undefined;
    let published = false;
    try {
      const validation = await this.validate(request);
      if (!validation.valid) {
        await this.emit(events, {
          buildId,
          phase: "validate",
          status: "failed",
          at: new Date().toISOString(),
          message: validation.errors.map((issue) => issue.message).join("; "),
        });
        const validationErrorCode = validation.errors[0]?.code ?? "";
        throw new BuildProviderError(
          isBuildProviderErrorCode(validationErrorCode) ? validationErrorCode : "INVALID_REQUEST",
          validation.errors[0]?.message ?? "Build request is invalid.",
        );
      }
      const normalized = await this.resolveValidatedRequest(request);
      this.throwIfCancelled(controller.signal);
      await this.emit(events, {
        buildId,
        phase: "validate",
        status: "completed",
        at: new Date().toISOString(),
      });

      staged = await this.service.stage(normalized, controller.signal);
      this.throwIfCancelled(controller.signal);
      await this.emit(events, {
        buildId,
        phase: "hash",
        status: "completed",
        at: new Date().toISOString(),
        sha256: staged.sha256,
        sizeBytes: staged.sizeBytes,
      });

      const metadata = await this.service.parse(normalized, staged, controller.signal);
      this.throwIfCancelled(controller.signal);
      await this.emit(events, {
        buildId,
        phase: "parse",
        status: "completed",
        at: new Date().toISOString(),
      });

      const publishedResult = await this.service.publish(staged, {
        kind: normalized.kind,
        metadata,
      });
      published = true;
      const artifact = toArtifactRef(publishedResult);
      await this.emit(events, {
        buildId,
        phase: "publish",
        status: "completed",
        at: new Date().toISOString(),
        artifactId: artifact.artifactId,
        publishState: artifact.publishState,
      });
      return { buildId, artifact };
    } catch (error) {
      if (staged !== undefined && !published) {
        await this.service.discard(staged).catch(() => undefined);
      }
      if (controller.signal.aborted) {
        throw new BuildProviderError("CANCELLED", `Build '${buildId}' was cancelled.`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      this.activeBuilds.delete(buildId);
    }
  }

  public async cancel(buildId: string): Promise<void> {
    this.activeBuilds.get(buildId)?.abort();
  }

  private async collectValidationIssues(request: BuildRequest): Promise<BuildValidationIssue[]> {
    const issues: BuildValidationIssue[] = [];
    if (request.providerId !== this.id) {
      issues.push({
        code: "PROVIDER_ID_MISMATCH",
        message: `Request providerId must be '${this.id}'.`,
      });
    }
    if (!win32.isAbsolute(request.importSource)) {
      issues.push({
        code: "IMPORT_SOURCE_NOT_ABSOLUTE",
        message: "importSource must be an absolute Windows path.",
      });
    }
    if (!win32.isAbsolute(request.artifactPath)) {
      issues.push({
        code: "PATH_NOT_ABSOLUTE",
        message: "artifactPath must be an absolute Windows path.",
      });
    }
    if (issues.length > 0) return issues;

    const sourcePath = win32.normalize(request.importSource);
    const artifactPath = win32.normalize(request.artifactPath);
    let sourceStats;
    try {
      sourceStats = await stat(sourcePath);
    } catch {
      issues.push({ code: "IMPORT_SOURCE_NOT_FOUND", message: "importSource does not exist." });
      return issues;
    }
    if (!sourceStats.isDirectory()) {
      issues.push({
        code: "IMPORT_SOURCE_NOT_DIRECTORY",
        message: "importSource must be a directory.",
      });
      return issues;
    }

    const relativePath = win32.relative(sourcePath, artifactPath);
    if (
      relativePath.length === 0 ||
      win32.isAbsolute(relativePath) ||
      relativePath === ".." ||
      relativePath.startsWith(`..${win32.sep}`)
    ) {
      issues.push({
        code: "PATH_OUTSIDE_IMPORT_SOURCE",
        message: "artifactPath must remain below the selected importSource.",
      });
      return issues;
    }

    let artifactStats;
    try {
      artifactStats = await stat(artifactPath);
    } catch {
      issues.push({ code: "PATH_NOT_FOUND", message: "artifactPath does not exist." });
      return issues;
    }
    if (!artifactStats.isFile()) {
      issues.push({ code: "PATH_NOT_FILE", message: "artifactPath must point to a file." });
      return issues;
    }

    const [sourceRealPath, fileRealPath] = await Promise.all([
      realpath(sourcePath),
      realpath(artifactPath),
    ]);
    const realRelativePath = win32.relative(sourceRealPath, fileRealPath);
    if (
      realRelativePath.length === 0 ||
      win32.isAbsolute(realRelativePath) ||
      realRelativePath === ".." ||
      realRelativePath.startsWith(`..${win32.sep}`)
    ) {
      issues.push({
        code: "PATH_OUTSIDE_IMPORT_SOURCE",
        message: "artifactPath resolves outside the selected importSource.",
      });
      return issues;
    }

    const expectedExtension = request.kind === "APK" ? ".apk" : ".aab";
    if (win32.extname(fileRealPath).toLowerCase() !== expectedExtension) {
      issues.push({
        code: "KIND_EXTENSION_MISMATCH",
        message: `${request.kind} imports require a ${expectedExtension} file.`,
      });
    }
    return issues;
  }

  private async resolveValidatedRequest(request: BuildRequest): Promise<ValidatedImportRequest> {
    const parsed = BuildRequestSchema.parse(request);
    const validation = await this.validate(parsed);
    if (!validation.valid) {
      throw new BuildProviderError(
        "INVALID_REQUEST",
        validation.errors[0]?.message ?? "Build request is invalid.",
      );
    }
    const sourcePath = win32.normalize(parsed.importSource);
    const artifactPath = win32.normalize(parsed.artifactPath);
    const [sourceRealPath, fileRealPath] = await Promise.all([
      realpath(sourcePath),
      realpath(artifactPath),
    ]);
    return {
      kind: parsed.kind,
      importSource: sourcePath,
      artifactPath,
      originalName: parsed.originalName ?? win32.basename(fileRealPath),
      sourceRealPath,
      fileRealPath,
    };
  }

  private async emit(events: BuildEventSink, event: BuildEvent): Promise<void> {
    await events(event);
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new BuildProviderError("CANCELLED", "Build was cancelled.");
    }
  }
}

export function createDefaultBuildProviderRegistry(
  service: ArtifactImportService,
): BuildProviderRegistry {
  return new BuildProviderRegistry([new ArtifactImportProvider(service)]);
}

function toArtifactRef(result: ArtifactPublishResult) {
  const artifact = result.artifact as SourceArtifact;
  return AppArtifactRefSchema.parse({
    artifactId: artifact.id,
    kind: artifact.kind,
    sha256: artifact.sha256,
    ...(artifact.packageName === undefined ? {} : { packageName: artifact.packageName }),
    ...(artifact.versionName === undefined ? {} : { versionName: artifact.versionName }),
    ...(artifact.versionCode === undefined ? {} : { versionCode: artifact.versionCode }),
    publishState: result.state,
  });
}
