import { stat } from "node:fs/promises";
import { win32 } from "node:path";

export type ToolCandidateSource = "explicit" | "project-local" | "unity-embedded" | "path";

export type ToolCandidateReason =
  | "EXPLICIT_SETTING"
  | "INVALID_ABSOLUTE_PATH"
  | "PATH_DIAGNOSTIC_ONLY"
  | "PROJECT_LOCAL"
  | "UNVERIFIED_UNITY_EMBEDDED"
  | "VERIFIED_UNITY_EMBEDDED";

export interface UnityEmbeddedCandidate {
  readonly path: string;
  readonly verified: boolean;
}

export interface ToolResolutionRequest {
  readonly toolId: string;
  readonly explicitPath?: string;
  readonly projectLocalPaths: readonly string[];
  readonly unityEmbeddedPaths: readonly UnityEmbeddedCandidate[];
  readonly pathExecutableName?: string;
}

export interface ToolCandidate {
  readonly source: ToolCandidateSource;
  readonly path: string;
  readonly exists: boolean;
  readonly runtimeEligible: boolean;
  readonly reason: ToolCandidateReason;
}

export interface ToolResolution {
  readonly toolId: string;
  readonly candidates: readonly ToolCandidate[];
  readonly selectedPath?: string;
  readonly selectedReason?: ToolCandidateReason;
}

export interface ToolResolverOptions {
  readonly projectRoot: string;
  readonly pathValue?: string;
  readonly pathExtensions?: string;
  readonly fileExists?: (candidate: string) => Promise<boolean>;
}

export class ToolResolverError extends Error {
  public readonly code = "NO_TRUSTED_RUNTIME";

  public constructor(toolId: string) {
    super(`No trusted runtime path is available for '${toolId}'.`);
    this.name = "ToolResolverError";
  }
}

export class ToolResolver {
  private readonly projectRoot: string;
  private readonly pathValue: string;
  private readonly pathExtensions: string;
  private readonly fileExists: (candidate: string) => Promise<boolean>;

  public constructor(options: ToolResolverOptions) {
    if (!win32.isAbsolute(options.projectRoot)) {
      throw new TypeError("ToolResolver projectRoot must be an absolute Windows path.");
    }
    this.projectRoot = win32.normalize(options.projectRoot);
    this.pathValue = options.pathValue ?? process.env.PATH ?? "";
    this.pathExtensions = options.pathExtensions ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
    this.fileExists = options.fileExists ?? isFile;
  }

  public async resolve(request: ToolResolutionRequest): Promise<ToolResolution> {
    const candidates: ToolCandidate[] = [];

    if (request.explicitPath !== undefined) {
      candidates.push(
        await this.createCandidate("explicit", request.explicitPath, "EXPLICIT_SETTING", true),
      );
    }

    for (const projectLocalPath of request.projectLocalPaths) {
      const resolvedPath = win32.isAbsolute(projectLocalPath)
        ? win32.normalize(projectLocalPath)
        : win32.resolve(this.projectRoot, projectLocalPath);
      candidates.push(
        await this.createCandidate("project-local", resolvedPath, "PROJECT_LOCAL", true),
      );
    }

    for (const unityCandidate of request.unityEmbeddedPaths) {
      candidates.push(
        await this.createCandidate(
          "unity-embedded",
          unityCandidate.path,
          unityCandidate.verified ? "VERIFIED_UNITY_EMBEDDED" : "UNVERIFIED_UNITY_EMBEDDED",
          unityCandidate.verified,
        ),
      );
    }

    if (request.pathExecutableName !== undefined) {
      for (const pathCandidate of await this.findOnPath(request.pathExecutableName)) {
        candidates.push({
          source: "path",
          path: pathCandidate,
          exists: true,
          runtimeEligible: false,
          reason: "PATH_DIAGNOSTIC_ONLY",
        });
      }
    }

    const selected = candidates.find((candidate) => candidate.exists && candidate.runtimeEligible);
    if (selected === undefined) {
      return { toolId: request.toolId, candidates };
    }
    return {
      toolId: request.toolId,
      candidates,
      selectedPath: selected.path,
      selectedReason: selected.reason,
    };
  }

  public requireRuntimePath(resolution: ToolResolution): string {
    if (resolution.selectedPath === undefined) {
      throw new ToolResolverError(resolution.toolId);
    }
    return resolution.selectedPath;
  }

  private async createCandidate(
    source: ToolCandidateSource,
    candidatePath: string,
    reason: ToolCandidateReason,
    trustedSource: boolean,
  ): Promise<ToolCandidate> {
    const absolute = win32.isAbsolute(candidatePath);
    const normalizedPath = absolute ? win32.normalize(candidatePath) : candidatePath;
    const exists = absolute && (await this.fileExists(normalizedPath));
    return {
      source,
      path: normalizedPath,
      exists,
      runtimeEligible: exists && trustedSource,
      reason: absolute ? reason : "INVALID_ABSOLUTE_PATH",
    };
  }

  private async findOnPath(executableName: string): Promise<string[]> {
    const names = getPathExecutableNames(executableName, this.pathExtensions);
    const found: string[] = [];
    const seen = new Set<string>();

    for (const rawDirectory of this.pathValue.split(win32.delimiter)) {
      const directory = rawDirectory.trim().replace(/^"|"$/g, "");
      if (!directory) {
        continue;
      }
      const resolvedDirectory = win32.isAbsolute(directory)
        ? win32.normalize(directory)
        : win32.resolve(directory);
      for (const name of names) {
        const candidate = win32.join(resolvedDirectory, name);
        const key = candidate.toLowerCase();
        if (!seen.has(key) && (await this.fileExists(candidate))) {
          seen.add(key);
          found.push(candidate);
        }
      }
    }
    return found;
  }
}

function getPathExecutableNames(executableName: string, pathExtensions: string): string[] {
  if (win32.extname(executableName)) {
    return [executableName];
  }
  return pathExtensions
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => `${executableName}${extension.toLowerCase()}`);
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}
