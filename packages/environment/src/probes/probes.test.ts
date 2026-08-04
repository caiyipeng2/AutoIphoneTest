import { describe, expect, it } from "vitest";

import {
  EnvironmentDiagnosticSchema,
  ProbeResultSchema,
  type ProbeResult,
} from "@test-center/contracts/environment";

import { classifyAdbSnapshot, createAdbProbe } from "./adb-probe.js";
import {
  classifyAppiumSnapshot,
  classifyUiAutomator2Snapshot,
  createAppiumProbe,
  createUiAutomator2Probe,
} from "./appium-probe.js";
import { classifyBundletoolSnapshot, createBundletoolProbe } from "./bundletool-probe.js";
import { classifyDriveSnapshot, createDriveProbe, GIBIBYTE } from "./drive-probe.js";
import { classifyJavaSnapshot, createJavaProbe } from "./java-probe.js";
import { classifyNodeSnapshot, createNodeProbe } from "./node-probe.js";
import { classifyPortSnapshot, createPortProbe } from "./port-probe.js";
import { classifyScrcpySnapshot, createScrcpyProbe } from "./scrcpy-probe.js";
import { classifyUnitySnapshot, createUnityProbe } from "./unity-probe.js";
import { runEnvironmentDiagnostic } from "../run-diagnostic.js";

const durationMs = 7;

describe("drive probe classification", () => {
  it.each([
    {
      name: "absent E drive",
      snapshot: { driveRoot: "E:\\", dataRoot: "E:\\Projects\\TestCenter\\data", exists: false },
      severity: "FATAL",
    },
    {
      name: "one byte fewer than 5 GiB",
      snapshot: {
        driveRoot: "E:\\",
        dataRoot: "E:\\Projects\\TestCenter\\data",
        exists: true,
        freeBytes: 5 * GIBIBYTE - 1,
        dataRootWritable: true,
      },
      severity: "FATAL",
    },
    {
      name: "exactly 5 GiB",
      snapshot: {
        driveRoot: "E:\\",
        dataRoot: "E:\\Projects\\TestCenter\\data",
        exists: true,
        freeBytes: 5 * GIBIBYTE,
        dataRootWritable: true,
      },
      severity: "DEGRADED",
    },
    {
      name: "one byte fewer than 20 GiB",
      snapshot: {
        driveRoot: "E:\\",
        dataRoot: "E:\\Projects\\TestCenter\\data",
        exists: true,
        freeBytes: 20 * GIBIBYTE - 1,
        dataRootWritable: true,
      },
      severity: "DEGRADED",
    },
    {
      name: "exactly 20 GiB",
      snapshot: {
        driveRoot: "E:\\",
        dataRoot: "E:\\Projects\\TestCenter\\data",
        exists: true,
        freeBytes: 20 * GIBIBYTE,
        dataRootWritable: true,
      },
      severity: "HEALTHY",
    },
  ] as const)("classifies $name as $severity", ({ snapshot, severity }) => {
    expect(classifyDriveSnapshot(snapshot, durationMs).severity).toBe(severity);
  });

  it("treats an unwritable data root as fatal", () => {
    expect(
      classifyDriveSnapshot(
        {
          driveRoot: "E:\\",
          dataRoot: "E:\\Projects\\TestCenter\\data",
          exists: true,
          freeBytes: 100 * GIBIBYTE,
          dataRootWritable: false,
        },
        durationMs,
      ).severity,
    ).toBe("FATAL");
  });
});

describe("adb probe classification", () => {
  it("degrades when adb is absent", () => {
    expect(classifyAdbSnapshot({ present: false }, durationMs).severity).toBe("DEGRADED");
  });

  it.each([
    ["no device", "List of devices attached\r\n\r\n", "NO_DEVICE"],
    ["unauthorized device", "List of devices attached\r\nABC\tunauthorized\r\n", "UNAUTHORIZED"],
    ["offline device", "List of devices attached\nABC\toffline\n", "OFFLINE"],
    [
      "device without an online transport",
      "List of devices attached\nABC\trecovery\n",
      "NO_ONLINE_DEVICE",
    ],
    [
      "device without permissions",
      "List of devices attached\nABC\tno permissions (missing udev rules)\n",
      "NO_PERMISSIONS",
    ],
  ] as const)("degrades for %s", (_name, devicesOutput, errorCategory) => {
    const result = classifyAdbSnapshot(
      {
        present: true,
        resolvedPath: "D:\\Android\\platform-tools\\adb.exe",
        versionOutput: "Android Debug Bridge version 1.0.41\r\nVersion 35.0.0-11411520",
        versionExitCode: 0,
        devicesOutput,
        devicesExitCode: 0,
        timedOut: false,
      },
      durationMs,
    );

    expect(result.severity).toBe("DEGRADED");
    expect(result.errors).toContainEqual(expect.objectContaining({ category: errorCategory }));
  });

  it("is healthy with one online device", () => {
    const result = classifyAdbSnapshot(
      {
        present: true,
        resolvedPath: "D:\\Android\\platform-tools\\adb.exe",
        versionOutput: "Android Debug Bridge version 1.0.41\r\nVersion 35.0.0-11411520",
        versionExitCode: 0,
        devicesOutput:
          "List of devices attached\r\nR5CT123\tdevice product:dm3q model:SM-S9180 transport_id:1\r\n",
        devicesExitCode: 0,
        timedOut: false,
      },
      durationMs,
    );

    expect(result.severity).toBe("HEALTHY");
    expect(result.facts).toMatchObject({ onlineCount: 1 });
  });
});

describe("versioned tool probes", () => {
  it("separates a missing Java path from a wrong Java version", () => {
    const missing = classifyJavaSnapshot({ present: false }, durationMs);
    const wrongVersion = classifyJavaSnapshot(
      {
        present: true,
        resolvedPath: "D:\\Unity\\OpenJDK\\bin\\java.exe",
        versionOutput: 'openjdk version "11.0.20"',
        exitCode: 0,
        timedOut: false,
      },
      durationMs,
    );

    expect(missing.errors[0]?.category).toBe("NOT_FOUND");
    expect(wrongVersion.errors[0]?.category).toBe("VERSION_MISMATCH");
    expect(wrongVersion.severity).toBe("DEGRADED");
  });

  it("treats an unusable Node runtime as fatal", () => {
    expect(
      classifyNodeSnapshot(
        {
          present: true,
          resolvedPath: "E:\\Projects\\TestCenter\\tools\\node\\22.23.1\\node.exe",
          versionOutput: "v20.0.0",
          exitCode: 0,
          timedOut: false,
        },
        durationMs,
      ).severity,
    ).toBe("FATAL");
  });

  it("reports missing Appium and UiAutomator2 as degraded", () => {
    expect(classifyAppiumSnapshot({ present: false }, durationMs).severity).toBe("DEGRADED");
    expect(classifyUiAutomator2Snapshot({ present: false }, durationMs).severity).toBe("DEGRADED");
  });

  it("collects pinned bundletool and scrcpy versions through injected adapters", async () => {
    const bundletool = createBundletoolProbe({
      collectSnapshot: async () => ({
        present: true,
        resolvedPath: "E:\\Projects\\TestCenter\\tools\\bundletool\\bundletool-all-1.18.3.jar",
        javaPath: "E:\\Projects\\TestCenter\\tools\\java\\bin\\java.exe",
        versionOutput: "1.18.3\r\n",
        exitCode: 0,
        timedOut: false,
      }),
      now: createClock(100, 107),
    });
    const scrcpy = createScrcpyProbe({
      collectSnapshot: async () => ({
        present: true,
        resolvedPath: "E:\\Projects\\TestCenter\\tools\\scrcpy\\scrcpy.exe",
        versionOutput: "scrcpy 3.1\r\n",
        exitCode: 0,
        timedOut: false,
      }),
      now: createClock(200, 209),
    });

    const bundletoolResult = await bundletool.collect();
    const scrcpyResult = await scrcpy.collect();

    expect(bundletoolResult).toMatchObject({ severity: "HEALTHY", durationMs: 7 });
    expect(scrcpyResult).toMatchObject({ severity: "HEALTHY", durationMs: 9 });
    expect(() => ProbeResultSchema.parse(bundletoolResult)).not.toThrow();
    expect(() => ProbeResultSchema.parse(scrcpyResult)).not.toThrow();
  });

  it("degrades missing or mismatched bundletool and scrcpy installations", () => {
    expect(classifyBundletoolSnapshot({ present: false }, durationMs).severity).toBe("DEGRADED");
    expect(
      classifyScrcpySnapshot(
        {
          present: true,
          resolvedPath: "E:\\Tools\\scrcpy.exe",
          versionOutput: "scrcpy 2.7",
          exitCode: 0,
          timedOut: false,
        },
        durationMs,
      ),
    ).toMatchObject({
      severity: "DEGRADED",
      errors: [expect.objectContaining({ category: "VERSION_MISMATCH" })],
    });
  });

  it("never reports a present tool healthy without an absolute resolved path", () => {
    const pathlessResults = [
      classifyAdbSnapshot(
        {
          present: true,
          versionOutput: "Android Debug Bridge version 1.0.41\nVersion 35.0.0-11411520",
          versionExitCode: 0,
          devicesOutput: "List of devices attached\nSERIAL\tdevice\n",
          devicesExitCode: 0,
          timedOut: false,
        },
        durationMs,
      ),
      classifyJavaSnapshot(
        {
          present: true,
          versionOutput: 'openjdk version "17.0.19"',
          exitCode: 0,
          timedOut: false,
        },
        durationMs,
      ),
      classifyNodeSnapshot(
        {
          present: true,
          versionOutput: "v22.23.1",
          exitCode: 0,
          timedOut: false,
        },
        durationMs,
      ),
      classifyAppiumSnapshot(
        { present: true, versionOutput: "3.6.0", exitCode: 0, timedOut: false },
        durationMs,
      ),
      classifyUiAutomator2Snapshot(
        { present: true, versionOutput: "8.2.2", exitCode: 0, timedOut: false },
        durationMs,
      ),
      classifyBundletoolSnapshot(
        { present: true, versionOutput: "1.18.3", exitCode: 0, timedOut: false },
        durationMs,
      ),
      classifyScrcpySnapshot(
        { present: true, versionOutput: "scrcpy 3.1", exitCode: 0, timedOut: false },
        durationMs,
      ),
      classifyUnitySnapshot(
        {
          present: true,
          version: "2022.3.62f2",
          androidModules: {
            androidPlayer: true,
            sdk: true,
            adb: true,
            jdk: true,
            ndk: true,
          },
        },
        durationMs,
      ),
    ];

    for (const result of pathlessResults) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ category: "PATH_UNRESOLVED" }),
      );
    }
    expect(pathlessResults[2]?.severity).toBe("FATAL");
    expect(pathlessResults.filter((result) => result.severity === "HEALTHY")).toHaveLength(0);
  });
});

describe("host readiness probes", () => {
  it("degrades when no required port was configured", () => {
    expect(classifyPortSnapshot({ ports: [] }, durationMs)).toMatchObject({
      severity: "DEGRADED",
      errors: [expect.objectContaining({ category: "NO_PORTS_CONFIGURED" })],
    });
  });

  it("degrades when a required port is occupied", () => {
    expect(
      classifyPortSnapshot(
        {
          ports: [{ name: "appium", host: "127.0.0.1", port: 4723, available: false }],
        },
        durationMs,
      ).severity,
    ).toBe("DEGRADED");
  });

  it("recognizes Unity 2022.3.62f2 with all Android modules", () => {
    expect(
      classifyUnitySnapshot(
        {
          present: true,
          editorPath: "D:\\Unity\\Editor\\Unity.exe",
          version: "2022.3.62f2",
          androidModules: {
            androidPlayer: true,
            sdk: true,
            adb: true,
            jdk: true,
            ndk: true,
          },
        },
        durationMs,
      ).severity,
    ).toBe("HEALTHY");
  });
});

describe("injected probe collectors", () => {
  it("collects every core snapshot through a typed adapter and returns valid contracts", async () => {
    const probes = [
      createDriveProbe({
        collectSnapshot: async () => ({
          driveRoot: "E:\\",
          dataRoot: "E:\\Projects\\TestCenter\\data",
          exists: true,
          freeBytes: 20 * GIBIBYTE,
          dataRootWritable: true,
        }),
        now: createClock(0, 1),
      }),
      createAdbProbe({
        collectSnapshot: async () => ({
          present: true,
          resolvedPath: "D:\\Android\\adb.exe",
          versionOutput: "Android Debug Bridge version 1.0.41\nVersion 35.0.0-11411520",
          versionExitCode: 0,
          devicesOutput: "List of devices attached\nSERIAL\tdevice model:SM-S9280\n",
          devicesExitCode: 0,
          timedOut: false,
        }),
        now: createClock(0, 2),
      }),
      createJavaProbe({
        collectSnapshot: async () => ({
          present: true,
          resolvedPath: "D:\\Unity\\OpenJDK\\bin\\java.exe",
          versionOutput: 'openjdk version "17.0.19"',
          exitCode: 0,
          timedOut: false,
        }),
        now: createClock(0, 3),
      }),
      createNodeProbe({
        collectSnapshot: async () => ({
          present: true,
          resolvedPath: "E:\\Projects\\TestCenter\\tools\\node\\22.23.1\\node.exe",
          versionOutput: "v22.23.1\r\n",
          exitCode: 0,
          timedOut: false,
        }),
        now: createClock(0, 4),
      }),
      createAppiumProbe({
        collectSnapshot: async () => ({
          present: true,
          resolvedPath: "E:\\Projects\\TestCenter\\node_modules\\appium\\index.js",
          versionOutput: "3.6.0",
          exitCode: 0,
          timedOut: false,
        }),
        now: createClock(0, 5),
      }),
      createUiAutomator2Probe({
        collectSnapshot: async () => ({
          present: true,
          resolvedPath:
            "E:\\Projects\\TestCenter\\node_modules\\appium-uiautomator2-driver\\package.json",
          versionOutput: "8.2.2",
          exitCode: 0,
          timedOut: false,
        }),
        now: createClock(0, 6),
      }),
      createUnityProbe({
        collectSnapshot: async () => ({
          present: true,
          editorPath: "D:\\Unity\\Editor\\Unity.exe",
          version: "2022.3.62f2",
          androidModules: {
            androidPlayer: true,
            sdk: true,
            adb: true,
            jdk: true,
            ndk: true,
          },
        }),
        now: createClock(0, 7),
      }),
      createPortProbe({
        collectSnapshot: async () => ({
          ports: [{ name: "appium", host: "127.0.0.1", port: 4723, available: true }],
        }),
        now: createClock(0, 8),
      }),
    ];

    const results = await Promise.all(probes.map(async (probe) => await probe.collect()));

    expect(results.map((result) => result.id)).toEqual([
      "drive",
      "adb",
      "java",
      "node",
      "appium",
      "uiautomator2",
      "unity",
      "ports",
    ]);
    for (const result of results) {
      expect(() => ProbeResultSchema.parse(result)).not.toThrow();
      expect(result.severity).toBe("HEALTHY");
    }
  });
});

describe("runEnvironmentDiagnostic", () => {
  it("runs probes concurrently, sorts by id, and aggregates the highest severity", async () => {
    let started = 0;
    let releaseBoth!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const createBarrierProbe = (id: string, severity: ProbeResult["severity"]) => ({
      id,
      collect: async () => {
        started += 1;
        if (started === 2) {
          releaseBoth();
        }
        await bothStarted;
        return createResult(id, severity);
      },
    });

    const diagnostic = await runEnvironmentDiagnostic({
      probes: [createBarrierProbe("zeta", "HEALTHY"), createBarrierProbe("alpha", "DEGRADED")],
      generatedAt: () => new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(started).toBe(2);
    expect(diagnostic.probes.map((probe) => probe.id)).toEqual(["alpha", "zeta"]);
    expect(diagnostic.overall).toBe("DEGRADED");
    expect(diagnostic.generatedAt).toBe("2026-07-31T00:00:00.000Z");
    expect(diagnostic.schemaVersion).toBe(1);
    expect(() => EnvironmentDiagnosticSchema.parse(diagnostic)).not.toThrow();
  });

  it("keeps a synchronously failed probe as a categorized fatal result", async () => {
    const diagnostic = await runEnvironmentDiagnostic({
      probes: [
        {
          id: "broken",
          collect: () => {
            throw new Error("adapter failed");
          },
        },
      ],
      generatedAt: () => new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(diagnostic.probes).toHaveLength(1);
    expect(diagnostic.probes[0]).toMatchObject({
      id: "broken",
      severity: "FATAL",
      errors: [expect.objectContaining({ category: "PROBE_COLLECTION_FAILED" })],
    });
  });

  it("uses FATAL over DEGRADED over HEALTHY", async () => {
    const diagnostic = await runEnvironmentDiagnostic({
      probes: [
        { id: "healthy", collect: async () => createResult("healthy", "HEALTHY") },
        { id: "degraded", collect: async () => createResult("degraded", "DEGRADED") },
        { id: "fatal", collect: async () => createResult("fatal", "FATAL") },
      ],
      generatedAt: () => new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(diagnostic.overall).toBe("FATAL");
  });

  it("rejects empty and duplicate probe definitions before collection", async () => {
    await expect(runEnvironmentDiagnostic({ probes: [] })).rejects.toThrow(/at least one/i);
    await expect(
      runEnvironmentDiagnostic({
        probes: [
          { id: "same", collect: async () => createResult("same", "HEALTHY") },
          { id: "same", collect: async () => createResult("same", "HEALTHY") },
        ],
      }),
    ).rejects.toThrow(/duplicate/i);
  });
});

function createResult(id: string, severity: ProbeResult["severity"]): ProbeResult {
  return {
    id,
    severity,
    durationMs: 1,
    facts: {},
    errors: [],
  };
}

function createClock(...values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}
