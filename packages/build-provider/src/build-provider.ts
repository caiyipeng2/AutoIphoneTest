import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 must be lowercase hex.");

export const BuildRequestSchema = z.object({
  providerId: z.string().min(1),
  kind: z.enum(["APK", "AAB"]),
  importSource: z.string().min(1),
  artifactPath: z.string().min(1),
  originalName: z.string().min(1).max(128).optional(),
});
export type BuildRequest = z.infer<typeof BuildRequestSchema>;

export const BuildValidationIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});
export type BuildValidationIssue = z.infer<typeof BuildValidationIssueSchema>;

export const BuildValidationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(BuildValidationIssueSchema),
});
export type BuildValidation = z.infer<typeof BuildValidationSchema>;

export const BuildEventSchema = z.object({
  buildId: z.string().min(1),
  phase: z.enum(["validate", "build", "hash", "parse", "publish"]),
  status: z.enum(["completed", "failed"]),
  at: z.string().datetime({ offset: true }),
  message: z.string().optional(),
  sha256: Sha256Schema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  artifactId: z.string().min(1).optional(),
  publishState: z.enum(["CREATED", "DEDUPLICATED"]).optional(),
});
export type BuildEvent = z.infer<typeof BuildEventSchema>;
export type BuildEventSink = (event: BuildEvent) => void | Promise<void>;

export const AppArtifactRefSchema = z.object({
  artifactId: z.string().min(1),
  kind: z.enum(["APK", "AAB"]),
  sha256: Sha256Schema,
  packageName: z.string().min(1).optional(),
  versionName: z.string().min(1).optional(),
  versionCode: z.number().int().nonnegative().optional(),
  publishState: z.enum(["CREATED", "DEDUPLICATED"]),
});
export type AppArtifactRef = z.infer<typeof AppArtifactRefSchema>;

export interface BuildResult {
  readonly buildId: string;
  readonly artifact: AppArtifactRef;
}

export interface BuildProvider {
  readonly id: string;
  validate(request: BuildRequest): Promise<BuildValidation> | BuildValidation;
  build(request: BuildRequest, events: BuildEventSink): Promise<BuildResult>;
  cancel(buildId: string): Promise<void>;
}

export type BuildProviderErrorCode =
  | "UNKNOWN_PROVIDER"
  | "DUPLICATE_PROVIDER"
  | "INVALID_REQUEST"
  | "PROVIDER_ID_MISMATCH"
  | "IMPORT_SOURCE_NOT_ABSOLUTE"
  | "IMPORT_SOURCE_NOT_FOUND"
  | "IMPORT_SOURCE_NOT_DIRECTORY"
  | "PATH_NOT_ABSOLUTE"
  | "PATH_OUTSIDE_IMPORT_SOURCE"
  | "PATH_NOT_FOUND"
  | "PATH_NOT_FILE"
  | "KIND_EXTENSION_MISMATCH"
  | "UNITY_EXECUTABLE_NOT_ABSOLUTE"
  | "UNITY_EXECUTABLE_NOT_FOUND"
  | "UNITY_EXECUTABLE_NOT_FILE"
  | "UNITY_PROJECT_NOT_ABSOLUTE"
  | "UNITY_PROJECT_NOT_FOUND"
  | "UNITY_PROJECT_NOT_DIRECTORY"
  | "BUILD_OUTPUT_NOT_ABSOLUTE"
  | "BUILD_OUTPUT_OUTSIDE_IMPORT_SOURCE"
  | "COMMAND_NOT_FOUND"
  | "COMMAND_FAILED"
  | "CANCELLED";

const BUILD_PROVIDER_ERROR_CODES: ReadonlySet<string> = new Set([
  "UNKNOWN_PROVIDER",
  "DUPLICATE_PROVIDER",
  "INVALID_REQUEST",
  "PROVIDER_ID_MISMATCH",
  "IMPORT_SOURCE_NOT_ABSOLUTE",
  "IMPORT_SOURCE_NOT_FOUND",
  "IMPORT_SOURCE_NOT_DIRECTORY",
  "PATH_NOT_ABSOLUTE",
  "PATH_OUTSIDE_IMPORT_SOURCE",
  "PATH_NOT_FOUND",
  "PATH_NOT_FILE",
  "KIND_EXTENSION_MISMATCH",
  "UNITY_EXECUTABLE_NOT_ABSOLUTE",
  "UNITY_EXECUTABLE_NOT_FOUND",
  "UNITY_EXECUTABLE_NOT_FILE",
  "UNITY_PROJECT_NOT_ABSOLUTE",
  "UNITY_PROJECT_NOT_FOUND",
  "UNITY_PROJECT_NOT_DIRECTORY",
  "BUILD_OUTPUT_NOT_ABSOLUTE",
  "BUILD_OUTPUT_OUTSIDE_IMPORT_SOURCE",
  "COMMAND_NOT_FOUND",
  "COMMAND_FAILED",
  "CANCELLED",
]);

export function isBuildProviderErrorCode(value: string): value is BuildProviderErrorCode {
  return BUILD_PROVIDER_ERROR_CODES.has(value);
}

export class BuildProviderError extends Error {
  public readonly code: BuildProviderErrorCode;

  public constructor(code: BuildProviderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BuildProviderError";
    this.code = code;
  }
}

export class BuildProviderRegistry {
  private readonly providers: ReadonlyMap<string, BuildProvider>;

  public constructor(providers: readonly BuildProvider[]) {
    const registry = new Map<string, BuildProvider>();
    for (const provider of providers) {
      if (registry.has(provider.id)) {
        throw new BuildProviderError(
          "DUPLICATE_PROVIDER",
          `Build provider '${provider.id}' is registered more than once.`,
        );
      }
      registry.set(provider.id, provider);
    }
    this.providers = registry;
  }

  public get(id: string): BuildProvider {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      throw new BuildProviderError("UNKNOWN_PROVIDER", `Unknown build provider '${id}'.`);
    }
    return provider;
  }

  public list(): readonly BuildProvider[] {
    return [...this.providers.values()];
  }
}
