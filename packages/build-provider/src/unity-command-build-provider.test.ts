import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  BuildProviderError,
  type BuildEvent,
  type BuildProvider,
  type BuildRequest,
  type BuildResult,
} from "./build-provider.js";
import {
  UnityCommandBuildProvider,
  createUnityCommandArgumentBuilder,
  type UnityCommandExecution,
  type UnityCommandExecutionInput,
} from "./unity-command-build-provider.js";

const artifact = {
  artifactId: "artifact-1",
  kind: "APK" as const,
  sha256: "a".repeat(64),
  publishState: "CREATED" as const,
};

async function fixture(): Promise<{ root: string; projectPath: string; executablePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "test-center-unity-command-"));
  const projectPath = join(root, "unity-project");
  const executablePath = join(root, "Unity.exe");
  await mkdir(projectPath);
  await writeFile(executablePath, "fixture");
  return { root, projectPath, executablePath };
}

function request(root: string): BuildRequest {
  return {
    providerId: "unity-command",
    kind: "APK",
    importSource: root,
    artifactPath: join(root, "Builds", "game.apk"),
    originalName: "game.apk",
  };
}

function importProvider(events: BuildEvent[] = []): BuildProvider {
  return {
    id: "artifact-import",
    validate: () => ({ valid: true, errors: [] }),
    build: async (input, sink): Promise<BuildResult> => {
      expect(input.providerId).toBe("artifact-import");
      const buildId = "import-build-1";
      for (const event of [
        { buildId, phase: "validate", status: "completed", at: new Date().toISOString() },
        {
          buildId,
          phase: "hash",
          status: "completed",
          at: new Date().toISOString(),
          sha256: artifact.sha256,
          sizeBytes: 4,
        },
        { buildId, phase: "parse", status: "completed", at: new Date().toISOString() },
        {
          buildId,
          phase: "publish",
          status: "completed",
          at: new Date().toISOString(),
          artifactId: artifact.artifactId,
        },
      ] as BuildEvent[]) {
        events.push(event);
        await sink(event);
      }
      return { buildId, artifact };
    },
    cancel: vi.fn(async () => undefined),
  };
}

function executor(run: (input: UnityCommandExecutionInput) => Promise<void>) {
  return { execute: vi.fn(run) } satisfies UnityCommandExecution;
}

describe("unity command build provider", () => {
  it("expands only the documented argument placeholders without invoking a shell", () => {
    const buildArgs = createUnityCommandArgumentBuilder({
      projectPath: "E:\\Games\\IdleWeaponShopTycoon",
      argumentTemplates: [
        "-batchmode",
        "-projectPath",
        "${projectPath}",
        "-buildPath",
        "${artifactPath}",
        "${kind}",
        "${originalName}",
      ],
    });

    expect(
      buildArgs({
        providerId: "unity-command",
        kind: "APK",
        importSource: "E:\\Imports",
        artifactPath: "E:\\Imports\\Builds\\game.apk",
        originalName: "game.apk",
      }),
    ).toEqual([
      "-batchmode",
      "-projectPath",
      "E:\\Games\\IdleWeaponShopTycoon",
      "-buildPath",
      "E:\\Imports\\Builds\\game.apk",
      "APK",
      "game.apk",
    ]);
  });

  it("rejects unknown argument placeholders before spawning Unity", () => {
    const buildArgs = createUnityCommandArgumentBuilder({
      projectPath: "E:\\Games\\IdleWeaponShopTycoon",
      argumentTemplates: ["-method", "${unknown}"],
    });

    expect(() =>
      buildArgs({
        providerId: "unity-command",
        kind: "APK",
        importSource: "E:\\Imports",
        artifactPath: "E:\\Imports\\game.apk",
      }),
    ).toThrow("Unsupported Unity command argument placeholder");
  });

  it("runs a configured argument-array command and republishes through artifact-import", async () => {
    const { root, projectPath, executablePath } = await fixture();
    const imported: BuildEvent[] = [];
    const command = executor(async () => undefined);
    const provider = new UnityCommandBuildProvider(importProvider(imported), {
      executablePath,
      projectPath,
      args: (input) => [
        "-batchmode",
        "-projectPath",
        projectPath,
        "-buildMethod",
        "CI.Build",
        input.artifactPath,
      ],
      execute: command.execute,
    });
    const events: BuildEvent[] = [];

    const result = await provider.build(request(root), (event) => {
      events.push(event);
    });

    expect(result).toMatchObject({ buildId: expect.any(String), artifact });
    expect(command.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath,
        cwd: projectPath,
        args: [
          "-batchmode",
          "-projectPath",
          projectPath,
          "-buildMethod",
          "CI.Build",
          join(root, "Builds", "game.apk"),
        ],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(events.map((event) => event.phase)).toEqual([
      "validate",
      "build",
      "hash",
      "parse",
      "publish",
    ]);
    expect(events.every((event) => event.buildId === result.buildId)).toBe(true);
    expect(imported).toHaveLength(4);
  });

  it("reports command failures as typed build failures", async () => {
    const { root, projectPath, executablePath } = await fixture();
    const command = executor(async () => {
      throw new Error("Unity exited with code 17");
    });
    const provider = new UnityCommandBuildProvider(importProvider(), {
      executablePath,
      projectPath,
      args: [],
      execute: command.execute,
    });
    const events: BuildEvent[] = [];

    await expect(
      provider.build(request(root), (event) => void events.push(event)),
    ).rejects.toMatchObject({
      code: "COMMAND_FAILED",
    });
    expect(events.map((event) => [event.phase, event.status])).toEqual([
      ["validate", "completed"],
      ["build", "failed"],
    ]);
  });

  it("cancels an in-flight command and does not publish an artifact", async () => {
    const { root, projectPath, executablePath } = await fixture();
    let started: (() => void) | undefined;
    const command = executor(
      ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          started = () => undefined;
          signal.addEventListener(
            "abort",
            () => reject(new BuildProviderError("CANCELLED", "aborted")),
            {
              once: true,
            },
          );
        }),
    );
    const imported: BuildProvider = importProvider();
    const provider = new UnityCommandBuildProvider(imported, {
      executablePath,
      projectPath,
      args: [],
      execute: command.execute,
    });
    const events: BuildEvent[] = [];
    const build = provider.build(request(root), (event) => {
      events.push(event);
      if (event.phase === "validate") started?.();
    });
    while (started === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    const buildId = events[0]?.buildId;
    expect(buildId).toBeDefined();

    await provider.cancel(buildId!);
    await expect(build).rejects.toMatchObject({ code: "CANCELLED" });
    expect(events.at(-1)).toMatchObject({ phase: "build", status: "failed" });
  });

  it("rejects unsafe or unavailable command configuration during validation", async () => {
    const { root, projectPath } = await fixture();
    const provider = new UnityCommandBuildProvider(importProvider(), {
      executablePath: "Unity.exe",
      projectPath,
      args: [],
      execute: executor(async () => undefined).execute,
    });

    await expect(provider.validate(request(root))).resolves.toMatchObject({
      valid: false,
      errors: [{ code: "UNITY_EXECUTABLE_NOT_ABSOLUTE" }],
    });
  });
});
