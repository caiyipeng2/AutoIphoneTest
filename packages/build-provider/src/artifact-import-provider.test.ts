import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ArtifactMetadata, SourceArtifact } from "@test-center/contracts/artifact";
import type { ArtifactPublishResult, StagedContent } from "@test-center/artifacts";

import {
  ArtifactImportProvider,
  createDefaultBuildProviderRegistry,
  type ArtifactImportService,
} from "./artifact-import-provider.js";
import type { BuildEvent, BuildRequest } from "./build-provider.js";

const roots: string[] = [];
const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function sourceArtifact(): SourceArtifact {
  return {
    id: "artifact-1",
    kind: "APK",
    sha256: digest,
    sizeBytes: 7,
    storedPath:
      "sha256/01/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/game.apk",
    originalName: "game.apk",
    packageName: "com.example.game",
    versionName: "1.4.2",
    versionCode: 42,
    signerSha256: digest,
    createdAt: "2026-08-05T12:00:00.000Z",
  };
}

function request(root: string, artifactPath: string): BuildRequest {
  return {
    providerId: "artifact-import",
    kind: "APK",
    importSource: root,
    artifactPath,
  };
}

function createService(
  options: {
    readonly waitForAbort?: boolean;
  } = {},
): ArtifactImportService & {
  readonly calls: string[];
  readonly partialFiles: Set<string>;
  readonly finalArtifacts: SourceArtifact[];
  readonly abortStarted: Promise<void>;
} {
  const calls: string[] = [];
  const partialFiles = new Set<string>();
  const finalArtifacts: SourceArtifact[] = [];
  let notifyAbortStarted!: () => void;
  const abortStarted = new Promise<void>((resolve) => {
    notifyAbortStarted = resolve;
  });
  const staged: StagedContent = {
    sha256: digest,
    sizeBytes: 7,
    originalName: "game.apk",
    partialPath: "D:\\Imports\\.staging\\game.partial",
  };
  const published: ArtifactPublishResult = {
    artifact: sourceArtifact(),
    state: "DEDUPLICATED",
  };

  return {
    calls,
    partialFiles,
    finalArtifacts,
    abortStarted,
    async stage(_request, signal) {
      void _request;
      calls.push("stage");
      partialFiles.add(staged.partialPath);
      if (!options.waitForAbort) return staged;
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            notifyAbortStarted();
            partialFiles.delete(staged.partialPath);
            reject(new Error("CANCELLED"));
          },
          { once: true },
        );
      });
      throw new Error("unreachable");
    },
    async parse(_request, _staged, _signal): Promise<ArtifactMetadata> {
      void _request;
      void _staged;
      void _signal;
      calls.push("parse");
      return {
        packageName: "com.example.game",
        versionName: "1.4.2",
        versionCode: 42,
        signerSha256: digest,
      };
    },
    async publish(_staged, _input) {
      void _staged;
      void _input;
      calls.push("publish");
      finalArtifacts.push(published.artifact);
      return published;
    },
    async discard(_staged) {
      void _staged;
      calls.push("discard");
      partialFiles.delete(staged.partialPath);
    },
  };
}

describe("artifact import provider", () => {
  it("is the only provider in the default registry", () => {
    const provider = new ArtifactImportProvider(createService());
    const registry = createDefaultBuildProviderRegistry(createService());
    expect(registry.get(provider.id).id).toBe("artifact-import");
  });

  it("validates an existing APK only inside the selected import source", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-"));
    roots.push(root);
    const file = join(root, "game.apk");
    const outside = join(await mkdtemp(join(tmpdir(), "test-center-outside-")), "game.apk");
    roots.push(win32.dirname(outside));
    await writeFile(file, "apk");
    await writeFile(outside, "apk");
    const provider = new ArtifactImportProvider(createService());

    await expect(provider.validate(request(root, file))).resolves.toMatchObject({
      valid: true,
      errors: [],
    });
    await expect(provider.validate(request(root, outside))).resolves.toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: "PATH_OUTSIDE_IMPORT_SOURCE" })],
    });
    await expect(
      provider.validate({ ...request(root, file), artifactPath: join(root, "game.aab") }),
    ).resolves.toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: "PATH_NOT_FOUND" })],
    });
  });

  it("delegates phases and emits validate/hash/parse/publish in order", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-"));
    roots.push(root);
    const file = join(root, "game.apk");
    await writeFile(file, "apk");
    const service = createService();
    const provider = new ArtifactImportProvider(service);
    const events: BuildEvent[] = [];

    const result = await provider.build(request(root, file), (event) => {
      events.push(event);
    });

    expect(service.calls).toEqual(["stage", "parse", "publish"]);
    expect(events.map((event) => event.phase)).toEqual(["validate", "hash", "parse", "publish"]);
    expect(result.artifact.artifactId).toBe("artifact-1");
    expect(result.artifact.publishState).toBe("DEDUPLICATED");
    expect(service.finalArtifacts).toHaveLength(1);
    expect(service.partialFiles).toHaveLength(1);
  });

  it("cancels an import before publish and leaves no partial or final artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-"));
    roots.push(root);
    const file = join(root, "game.apk");
    await writeFile(file, "apk");
    const service = createService({ waitForAbort: true });
    const provider = new ArtifactImportProvider(service);
    let buildId: string | undefined;
    const buildPromise = provider.build(request(root, file), (event) => {
      buildId = event.buildId;
    });

    while (buildId === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    await provider.cancel(buildId);
    await expect(buildPromise).rejects.toMatchObject({ code: "CANCELLED" });
    await service.abortStarted;
    expect(service.calls).toEqual(["stage"]);
    expect(service.partialFiles).toHaveLength(0);
    expect(service.finalArtifacts).toHaveLength(0);
  });
});
