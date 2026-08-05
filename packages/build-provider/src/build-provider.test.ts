import { describe, expect, it } from "vitest";

import {
  AppArtifactRefSchema,
  BuildProviderError,
  BuildProviderRegistry,
  type AppArtifactRef,
  type BuildProvider,
  type BuildRequest,
} from "./build-provider.js";

const request: BuildRequest = {
  providerId: "fake-provider",
  kind: "APK",
  importSource: "D:\\Imports",
  artifactPath: "D:\\Imports\\game.apk",
};

const artifact: AppArtifactRef = AppArtifactRefSchema.parse({
  artifactId: "artifact-1",
  kind: "APK",
  sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  publishState: "DEDUPLICATED",
});

describe("build provider registry", () => {
  it("returns a provider by id and keeps consumers provider-agnostic", async () => {
    const fake: BuildProvider = {
      id: "fake-provider",
      validate: () => ({ valid: true, errors: [] }),
      build: async () => ({ buildId: "build-1", artifact }),
      cancel: async () => undefined,
    };
    const registry = new BuildProviderRegistry([fake]);
    const selected = registry.get(request.providerId);
    const result = await selected.build(request, () => undefined);
    expect(result.artifact).toEqual(artifact);
    expect(result.artifact.kind).toBe("APK");
  });

  it("rejects unknown provider ids", () => {
    const registry = new BuildProviderRegistry([]);
    expect(() => registry.get("missing")).toThrowError(
      expect.objectContaining<Partial<BuildProviderError>>({ code: "UNKNOWN_PROVIDER" }),
    );
  });
});
