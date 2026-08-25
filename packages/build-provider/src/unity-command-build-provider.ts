import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { win32 } from "node:path";

import {
  BuildProviderError,
  BuildRequestSchema,
  isBuildProviderErrorCode,
  type BuildEvent,
  type BuildEventSink,
  type BuildProvider,
  type BuildRequest,
  type BuildResult,
  type BuildValidation,
  type BuildValidationIssue,
} from "./build-provider.js";

export interface UnityCommandExecutionInput {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal;
}

export interface UnityCommandExecution {
  execute(input: UnityCommandExecutionInput): Promise<void>;
}

export interface UnityCommandBuildOptions {
  /** The absolute Unity executable to invoke; shell lookup is deliberately not used. */
  readonly executablePath: string;
  /** The Unity project directory used as the child process working directory. */
  readonly projectPath: string;
  /** Arguments are passed directly to spawn, so user-controlled paths never enter a shell. */
  readonly args: readonly string[] | ((request: BuildRequest) => readonly string[]);
  readonly execute?: UnityCommandExecution["execute"];
}

export interface UnityCommandArgumentTemplateConfig {
  readonly projectPath: string;
  readonly argumentTemplates: readonly string[];
}

export function createUnityCommandArgumentBuilder(
  config: UnityCommandArgumentTemplateConfig,
): (request: BuildRequest) => readonly string[] {
  return (request) =>
    config.argumentTemplates.map((template) =>
      template.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
        if (key === "artifactPath") return request.artifactPath;
        if (key === "importSource") return request.importSource;
        if (key === "kind") return request.kind;
        if (key === "originalName") return request.originalName ?? "";
        if (key === "projectPath") return config.projectPath;
        throw new TypeError(`Unsupported Unity command argument placeholder '${match}'.`);
      }),
    );
}

interface ActiveBuild {
  readonly controller: AbortController;
  delegatedBuildId?: string;
}

export class UnityCommandBuildProvider implements BuildProvider {
  public readonly id = "unity-command";
  private readonly activeBuilds = new Map<string, ActiveBuild>();
  private readonly execute: UnityCommandExecution["execute"];

  public constructor(
    private readonly artifactProvider: BuildProvider,
    private readonly options: UnityCommandBuildOptions,
  ) {
    this.execute = options.execute ?? executeUnityCommand;
  }

  public async validate(request: BuildRequest): Promise<BuildValidation> {
    const parsed = BuildRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        valid: false,
        errors: [{ code: "INVALID_REQUEST", message: parsed.error.message }],
      };
    }

    const issues: BuildValidationIssue[] = [];
    if (parsed.data.providerId !== this.id) {
      issues.push({
        code: "PROVIDER_ID_MISMATCH",
        message: `Request providerId must be '${this.id}'.`,
      });
    }
    if (!win32.isAbsolute(this.options.executablePath)) {
      issues.push({
        code: "UNITY_EXECUTABLE_NOT_ABSOLUTE",
        message: "Unity executablePath must be an absolute Windows path.",
      });
    }
    if (!win32.isAbsolute(this.options.projectPath)) {
      issues.push({
        code: "UNITY_PROJECT_NOT_ABSOLUTE",
        message: "Unity projectPath must be an absolute Windows path.",
      });
    }
    if (!win32.isAbsolute(parsed.data.importSource)) {
      issues.push({
        code: "IMPORT_SOURCE_NOT_ABSOLUTE",
        message: "importSource must be an absolute Windows path.",
      });
    }
    if (!win32.isAbsolute(parsed.data.artifactPath)) {
      issues.push({
        code: "BUILD_OUTPUT_NOT_ABSOLUTE",
        message: "artifactPath must be an absolute Windows path.",
      });
    }
    if (issues.length > 0) return { valid: false, errors: issues };

    const executableStats = await stat(this.options.executablePath).catch(() => undefined);
    if (executableStats === undefined) {
      issues.push({
        code: "UNITY_EXECUTABLE_NOT_FOUND",
        message: "Unity executablePath does not exist.",
      });
    } else if (!executableStats.isFile()) {
      issues.push({
        code: "UNITY_EXECUTABLE_NOT_FILE",
        message: "Unity executablePath must point to a file.",
      });
    }

    const projectStats = await stat(this.options.projectPath).catch(() => undefined);
    if (projectStats === undefined) {
      issues.push({
        code: "UNITY_PROJECT_NOT_FOUND",
        message: "Unity projectPath does not exist.",
      });
    } else if (!projectStats.isDirectory()) {
      issues.push({
        code: "UNITY_PROJECT_NOT_DIRECTORY",
        message: "Unity projectPath must point to a directory.",
      });
    }

    const sourceStats = await stat(parsed.data.importSource).catch(() => undefined);
    if (sourceStats === undefined) {
      issues.push({ code: "IMPORT_SOURCE_NOT_FOUND", message: "importSource does not exist." });
    } else if (!sourceStats.isDirectory()) {
      issues.push({
        code: "IMPORT_SOURCE_NOT_DIRECTORY",
        message: "importSource must be a directory.",
      });
    }

    if (issues.length === 0 && !isWithin(parsed.data.importSource, parsed.data.artifactPath)) {
      issues.push({
        code: "BUILD_OUTPUT_OUTSIDE_IMPORT_SOURCE",
        message: "artifactPath must remain below the selected importSource.",
      });
    }
    return { valid: issues.length === 0, errors: issues };
  }

  public async build(request: BuildRequest, events: BuildEventSink): Promise<BuildResult> {
    const buildId = randomUUID();
    const active: ActiveBuild = { controller: new AbortController() };
    this.activeBuilds.set(buildId, active);
    let validationFailed = false;
    try {
      const validation = await this.validate(request);
      if (!validation.valid) {
        validationFailed = true;
        await this.emit(events, {
          buildId,
          phase: "validate",
          status: "failed",
          at: new Date().toISOString(),
          message: validation.errors.map((issue) => issue.message).join("; "),
        });
        const code = validation.errors[0]?.code;
        throw new BuildProviderError(
          code !== undefined && isBuildProviderErrorCode(code) ? code : "INVALID_REQUEST",
          validation.errors[0]?.message ?? "Build request is invalid.",
        );
      }
      await this.emit(events, {
        buildId,
        phase: "validate",
        status: "completed",
        at: new Date().toISOString(),
      });

      const args =
        typeof this.options.args === "function" ? this.options.args(request) : this.options.args;
      await this.execute({
        executablePath: this.options.executablePath,
        args: [...args],
        cwd: this.options.projectPath,
        signal: active.controller.signal,
      });
      this.throwIfCancelled(active.controller.signal);
      await this.emit(events, {
        buildId,
        phase: "build",
        status: "completed",
        at: new Date().toISOString(),
      });

      const imported = await this.artifactProvider.build(
        { ...request, providerId: this.artifactProvider.id },
        async (event) => {
          active.delegatedBuildId = event.buildId;
          if (event.phase === "validate") return;
          await this.emit(events, { ...event, buildId });
        },
      );
      this.throwIfCancelled(active.controller.signal);
      return { buildId, artifact: imported.artifact };
    } catch (error) {
      if (validationFailed) throw error;
      const cancelled = active.controller.signal.aborted || isCancelled(error);
      if (cancelled) {
        await this.emit(events, {
          buildId,
          phase: "build",
          status: "failed",
          at: new Date().toISOString(),
          message: `Build '${buildId}' was cancelled.`,
        }).catch(() => undefined);
        throw new BuildProviderError("CANCELLED", `Build '${buildId}' was cancelled.`, {
          cause: error,
        });
      }
      if (
        error instanceof BuildProviderError &&
        error.code !== "COMMAND_FAILED" &&
        error.code !== "COMMAND_NOT_FOUND"
      ) {
        await this.emit(events, {
          buildId,
          phase: "build",
          status: "failed",
          at: new Date().toISOString(),
          message: error.message,
        }).catch(() => undefined);
        throw error;
      }
      const failure =
        error instanceof BuildProviderError
          ? error
          : new BuildProviderError(
              "COMMAND_FAILED",
              error instanceof Error ? error.message : "Unity command failed.",
              {
                cause: error,
              },
            );
      await this.emit(events, {
        buildId,
        phase: "build",
        status: "failed",
        at: new Date().toISOString(),
        message: failure.message,
      }).catch(() => undefined);
      throw failure;
    } finally {
      this.activeBuilds.delete(buildId);
    }
  }

  public async cancel(buildId: string): Promise<void> {
    const active = this.activeBuilds.get(buildId);
    if (active === undefined) return;
    active.controller.abort();
    if (active.delegatedBuildId !== undefined) {
      await this.artifactProvider.cancel(active.delegatedBuildId);
    }
  }

  private async emit(events: BuildEventSink, event: BuildEvent): Promise<void> {
    await events(event);
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new BuildProviderError("CANCELLED", "Build was cancelled.");
  }
}

async function executeUnityCommand(input: UnityCommandExecutionInput): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.executablePath, [...input.args], {
      cwd: input.cwd,
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", onAbort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onAbort = (): void => {
      child.kill();
      finish(new BuildProviderError("CANCELLED", "Unity command was cancelled."));
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      finish(new BuildProviderError("COMMAND_NOT_FOUND", error.message, { cause: error }));
    });
    child.once("exit", (code) => {
      if (code === 0) finish();
      else
        finish(
          new BuildProviderError(
            "COMMAND_FAILED",
            `Unity command exited with code ${code ?? "unknown"}.`,
          ),
        );
    });
  });
}

function isCancelled(error: unknown): boolean {
  return error instanceof BuildProviderError && error.code === "CANCELLED";
}

function isWithin(root: string, candidate: string): boolean {
  const relative = win32.relative(win32.normalize(root), win32.normalize(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${win32.sep}`) && relative !== ".." && !win32.isAbsolute(relative))
  );
}
