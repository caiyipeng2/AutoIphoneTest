import { describe, expect, it } from "vitest";
import { win32 } from "node:path";

import { ToolResolver } from "./tool-resolver.js";

function createResolver(existingPaths: readonly string[]) {
  const existing = new Set(existingPaths.map((candidate) => candidate.toLowerCase()));
  return new ToolResolver({
    projectRoot: "E:\\Projects\\TestCenter",
    pathValue: "C:\\PathOne;C:\\PathTwo",
    pathExtensions: ".EXE;.CMD",
    fileExists: async (candidate) => existing.has(candidate.toLowerCase()),
  });
}

describe("ToolResolver", () => {
  it("selects explicit, project-local, then verified Unity candidates in order", async () => {
    const explicit = "D:\\Configured\\adb.exe";
    const projectLocal = "E:\\Projects\\TestCenter\\tools\\adb\\adb.exe";
    const unity =
      "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
    const pathCandidate = "C:\\PathOne\\adb.exe";
    const resolver = createResolver([explicit, projectLocal, unity, pathCandidate]);

    const resolution = await resolver.resolve({
      toolId: "adb",
      explicitPath: explicit,
      projectLocalPaths: ["tools\\adb\\adb.exe"],
      unityEmbeddedPaths: [{ path: unity, verified: true }],
      pathExecutableName: "adb.exe",
    });

    expect(resolution.selectedPath).toBe(explicit);
    expect(resolution.selectedReason).toBe("EXPLICIT_SETTING");
    expect(resolution.candidates.map((candidate) => candidate.source)).toEqual([
      "explicit",
      "project-local",
      "unity-embedded",
      "path",
    ]);
  });

  it("falls through missing candidates to a verified Unity path", async () => {
    const unity = "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK\\bin\\java.exe";
    const resolver = createResolver([unity]);

    const resolution = await resolver.resolve({
      toolId: "java",
      explicitPath: "D:\\Missing\\java.exe",
      projectLocalPaths: ["tools\\java\\bin\\java.exe"],
      unityEmbeddedPaths: [{ path: unity, verified: true }],
      pathExecutableName: "java.exe",
    });

    expect(resolution.selectedPath).toBe(unity);
    expect(resolution.selectedReason).toBe("VERIFIED_UNITY_EMBEDDED");
  });

  it("keeps PATH discovery diagnostic-only", async () => {
    const pathCandidate = "C:\\PathOne\\adb.exe";
    const resolver = createResolver([pathCandidate]);

    const resolution = await resolver.resolve({
      toolId: "adb",
      projectLocalPaths: ["tools\\adb\\adb.exe"],
      unityEmbeddedPaths: [],
      pathExecutableName: "adb.exe",
    });

    expect(resolution.selectedPath).toBeUndefined();
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({
        path: pathCandidate,
        source: "path",
        exists: true,
        runtimeEligible: false,
      }),
    );
    expect(() => resolver.requireRuntimePath(resolution)).toThrowError(
      expect.objectContaining({ code: "NO_TRUSTED_RUNTIME" }),
    );
  });

  it("does not trust an unverified Unity candidate", async () => {
    const unity = "D:\\Unity\\Unverified\\adb.exe";
    const resolver = createResolver([unity]);

    const resolution = await resolver.resolve({
      toolId: "adb",
      projectLocalPaths: [],
      unityEmbeddedPaths: [{ path: unity, verified: false }],
    });

    expect(resolution.selectedPath).toBeUndefined();
    expect(resolution.candidates[0]).toMatchObject({
      source: "unity-embedded",
      exists: true,
      runtimeEligible: false,
      reason: "UNVERIFIED_UNITY_EMBEDDED",
    });
  });

  it("normalizes relative PATH entries to absolute diagnostic paths", async () => {
    const expectedPath = win32.resolve("relative-tools", "adb.exe");
    const resolver = new ToolResolver({
      projectRoot: "E:\\Projects\\TestCenter",
      pathValue: "relative-tools",
      pathExtensions: ".EXE",
      fileExists: async (candidate) => candidate.toLowerCase() === expectedPath.toLowerCase(),
    });

    const resolution = await resolver.resolve({
      toolId: "adb",
      projectLocalPaths: [],
      unityEmbeddedPaths: [],
      pathExecutableName: "adb.exe",
    });

    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({ path: expectedPath, source: "path", runtimeEligible: false }),
    );
  });
});
