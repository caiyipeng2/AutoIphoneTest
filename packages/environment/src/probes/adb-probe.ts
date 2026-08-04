import { performance } from "node:perf_hooks";
import { win32 } from "node:path";

import type { ProbeResult } from "@test-center/contracts/environment";

import type { EnvironmentProbe } from "../run-diagnostic.js";

export const EXPECTED_ADB_VERSION = "35.0.0";

export interface AdbSnapshot {
  readonly present: boolean;
  readonly resolvedPath?: string;
  readonly diagnosticPaths?: readonly string[];
  readonly versionOutput?: string;
  readonly versionExitCode?: number | null;
  readonly devicesOutput?: string;
  readonly devicesExitCode?: number | null;
  readonly timedOut?: boolean;
}

export interface AdbProbeOptions {
  readonly collectSnapshot: () => Promise<AdbSnapshot>;
  readonly expectedVersion?: string;
  readonly now?: () => number;
}

interface AdbDeviceFact {
  readonly serial: string;
  readonly state: string;
  readonly model?: string;
  readonly product?: string;
}

export function createAdbProbe(options: AdbProbeOptions): EnvironmentProbe {
  const now = options.now ?? (() => performance.now());
  return {
    id: "adb",
    collect: async () => {
      const startedAt = now();
      const snapshot = await options.collectSnapshot();
      return classifyAdbSnapshot(
        snapshot,
        Math.max(0, Math.round(now() - startedAt)),
        options.expectedVersion,
      );
    },
  };
}

export function classifyAdbSnapshot(
  snapshot: AdbSnapshot,
  durationMs: number,
  expectedVersion = EXPECTED_ADB_VERSION,
): ProbeResult {
  if (!snapshot.present) {
    const diagnosticOnly = (snapshot.diagnosticPaths?.length ?? 0) > 0;
    return {
      id: "adb",
      severity: "DEGRADED",
      durationMs,
      facts: {
        expectedVersion,
        ...(snapshot.diagnosticPaths === undefined
          ? {}
          : { diagnosticPaths: [...snapshot.diagnosticPaths] }),
        devices: [],
        onlineCount: 0,
      },
      errors: [
        {
          category: diagnosticOnly ? "PATH_UNRESOLVED" : "NOT_FOUND",
          message: diagnosticOnly
            ? "ADB was found only at diagnostic-only paths and is not trusted for execution."
            : "ADB was not found.",
        },
      ],
    };
  }

  const version = snapshot.versionOutput?.match(/^Version\s+(\d+\.\d+\.\d+)/im)?.[1];
  const protocolVersion = snapshot.versionOutput?.match(
    /Android Debug Bridge version\s+([^\s]+)/i,
  )?.[1];
  const devices = parseAdbDevices(snapshot.devicesOutput ?? "");
  const stateCounts = countStates(devices);
  const errors: ProbeResult["errors"] = [];

  if (snapshot.resolvedPath === undefined || !win32.isAbsolute(snapshot.resolvedPath)) {
    errors.push({
      category: "PATH_UNRESOLVED",
      message: "ADB does not have a trusted absolute executable path.",
    });
  }

  if (snapshot.timedOut === true) {
    errors.push({ category: "COMMAND_TIMEOUT", message: "ADB readiness commands timed out." });
  } else {
    if (snapshot.versionExitCode !== 0) {
      errors.push({ category: "VERSION_COMMAND_FAILED", message: "ADB version command failed." });
    } else if (version === undefined) {
      errors.push({
        category: "VERSION_UNAVAILABLE",
        message: "ADB did not report its platform-tools version.",
      });
    } else if (version !== expectedVersion) {
      errors.push({
        category: "VERSION_MISMATCH",
        message: `Expected ADB ${expectedVersion}, found ${version}.`,
      });
    }
    if (snapshot.devicesExitCode !== 0) {
      errors.push({ category: "DEVICE_LIST_FAILED", message: "ADB device discovery failed." });
    }
  }

  if (devices.length === 0) {
    errors.push({ category: "NO_DEVICE", message: "No Android device is connected." });
  } else if (stateCounts.device === 0) {
    errors.push({
      category: "NO_ONLINE_DEVICE",
      message: "No connected Android device has an online ADB transport.",
    });
  }
  if (stateCounts.unauthorized > 0) {
    errors.push({
      category: "UNAUTHORIZED",
      message: `${String(stateCounts.unauthorized)} device(s) have not authorized this host.`,
    });
  }
  if (stateCounts.offline > 0) {
    errors.push({
      category: "OFFLINE",
      message: `${String(stateCounts.offline)} device(s) are offline.`,
    });
  }
  if (stateCounts.noPermissions > 0) {
    errors.push({
      category: "NO_PERMISSIONS",
      message: `${String(stateCounts.noPermissions)} device(s) cannot be accessed by this host.`,
    });
  }
  const unavailableStateCount = devices.filter(
    (device) => !["device", "unauthorized", "offline", "no permissions"].includes(device.state),
  ).length;
  if (unavailableStateCount > 0) {
    errors.push({
      category: "DEVICE_STATE_UNAVAILABLE",
      message: `${String(unavailableStateCount)} device(s) are in an unsupported ADB state.`,
    });
  }

  return {
    id: "adb",
    severity: errors.length === 0 ? "HEALTHY" : "DEGRADED",
    durationMs,
    ...(snapshot.resolvedPath === undefined ? {} : { resolvedPath: snapshot.resolvedPath }),
    ...(version === undefined ? {} : { version }),
    facts: {
      expectedVersion,
      ...(protocolVersion === undefined ? {} : { protocolVersion }),
      devices: devices.map((device) => ({
        serial: device.serial,
        state: device.state,
        ...(device.model === undefined ? {} : { model: device.model }),
        ...(device.product === undefined ? {} : { product: device.product }),
      })),
      onlineCount: stateCounts.device,
      unauthorizedCount: stateCounts.unauthorized,
      offlineCount: stateCounts.offline,
      noPermissionsCount: stateCounts.noPermissions,
      unavailableStateCount,
    },
    errors,
  };
}

function parseAdbDevices(output: string): AdbDeviceFact[] {
  const devices: AdbDeviceFact[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^List of devices attached$/i.test(line) || line.startsWith("* daemon")) {
      continue;
    }
    const tabIndex = line.indexOf("\t");
    if (tabIndex <= 0) {
      continue;
    }
    const serial = line.slice(0, tabIndex).trim();
    const descriptor = line.slice(tabIndex + 1).trim();
    const state = descriptor.toLowerCase().startsWith("no permissions")
      ? "no permissions"
      : (descriptor.split(/\s+/, 1)[0] ?? "unknown");
    const model = descriptor.match(/(?:^|\s)model:([^\s]+)/)?.[1];
    const product = descriptor.match(/(?:^|\s)product:([^\s]+)/)?.[1];
    devices.push({
      serial,
      state,
      ...(model === undefined ? {} : { model }),
      ...(product === undefined ? {} : { product }),
    });
  }
  return devices;
}

function countStates(devices: readonly AdbDeviceFact[]): {
  readonly device: number;
  readonly unauthorized: number;
  readonly offline: number;
  readonly noPermissions: number;
} {
  return {
    device: devices.filter((device) => device.state === "device").length,
    unauthorized: devices.filter((device) => device.state === "unauthorized").length,
    offline: devices.filter((device) => device.state === "offline").length,
    noPermissions: devices.filter((device) => device.state === "no permissions").length,
  };
}
