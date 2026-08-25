import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DeviceRecord,
  DeviceRegistryEvent,
  DeviceRegistryListener,
} from "@test-center/devices";
import type { DeviceSerial } from "@test-center/contracts/device";
import type { ViewProvider } from "@test-center/video";

import {
  createConfiguredRuntimeVideoCoordinator,
  createRuntimeVideoCoordinator,
} from "./runtime-video.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

class FakeRegistry {
  public unsubscribe = vi.fn();
  public initialDevices: DeviceRecord[] = [];
  private listener: DeviceRegistryListener | undefined;

  public subscribe(listener: DeviceRegistryListener): () => void {
    this.listener = listener;
    return this.unsubscribe;
  }

  public list(): DeviceRecord[] {
    return this.initialDevices;
  }

  public emit(serial: string, state: "ONLINE" | "OFFLINE"): void {
    this.listener?.({
      version: 1,
      type: "device.connectionChanged",
      eventSeq: 1,
      device: {
        serial: serial as DeviceSerial,
        state,
        metadata: {},
        firstSeenAt: "2026-08-24T00:00:00.000Z",
        lastSeenAt: "2026-08-24T00:00:00.000Z",
        connectionSeq: 1,
        tags: [],
      },
    } satisfies DeviceRegistryEvent);
  }
}

function provider(): ViewProvider {
  return {
    serial: "R5CX211TXNT" as DeviceSerial,
    kind: "tango",
    degraded: false,
    state: "STOPPED",
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    captureOnce: vi.fn(async () => {
      throw new Error("not used");
    }),
    getLatestFrame: vi.fn(() => undefined),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe("runtime video coordinator", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates an online provider and starts it on demand", async () => {
    const registry = new FakeRegistry();
    const videoProvider = provider();
    const runtime = createRuntimeVideoCoordinator({
      registry,
      createProvider: () => videoProvider,
    });

    registry.emit("R5CX211TXNT", "ONLINE");

    expect(runtime.providers.get("R5CX211TXNT")).toBe(videoProvider);
    await runtime.start("R5CX211TXNT");
    expect(videoProvider.start).toHaveBeenCalledOnce();
  });

  it("creates providers for online devices already present at startup", () => {
    const registry = new FakeRegistry();
    registry.initialDevices.push({
      serial: "R5CX211TXNT" as DeviceSerial,
      state: "ONLINE",
      metadata: {},
      firstSeenAt: "2026-08-24T00:00:00.000Z",
      lastSeenAt: "2026-08-24T00:00:00.000Z",
      connectionSeq: 1,
      tags: [],
    });
    const videoProvider = provider();

    const runtime = createRuntimeVideoCoordinator({
      registry,
      createProvider: () => videoProvider,
    });

    expect(runtime.providers.get("R5CX211TXNT")).toBe(videoProvider);
  });

  it("stops and removes a provider when its device leaves online state", async () => {
    const registry = new FakeRegistry();
    const videoProvider = provider();
    const runtime = createRuntimeVideoCoordinator({
      registry,
      createProvider: () => videoProvider,
    });

    registry.emit("R5CX211TXNT", "ONLINE");
    registry.emit("R5CX211TXNT", "OFFLINE");

    expect(videoProvider.stop).toHaveBeenCalledOnce();
    expect(runtime.providers.has("R5CX211TXNT")).toBe(false);
  });

  it("stops providers and unsubscribes when closed", async () => {
    const registry = new FakeRegistry();
    const videoProvider = provider();
    const runtime = createRuntimeVideoCoordinator({
      registry,
      createProvider: () => videoProvider,
    });

    registry.emit("R5CX211TXNT", "ONLINE");
    await runtime.close();

    expect(videoProvider.stop).toHaveBeenCalledOnce();
    expect(registry.unsubscribe).toHaveBeenCalledOnce();
    expect(runtime.providers.size).toBe(0);
  });

  it("disables runtime video when the pinned server asset is absent", () => {
    const registry = new FakeRegistry();

    const runtime = createConfiguredRuntimeVideoCoordinator({
      registry,
      projectRoot: "E:\\Projects\\TestCenter",
      adbPath: "E:\\Android\\platform-tools\\adb.exe",
      serverPath: "E:\\Projects\\TestCenter\\tools\\scrcpy\\3.1\\scrcpy-server",
    });

    expect(runtime).toBeUndefined();
  });

  it("creates a serial-bound Tango provider when the pinned server asset exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-video-"));
    roots.push(root);
    const serverPath = win32.join(root, "scrcpy-server");
    await writeFile(serverPath, Buffer.from("fixture"));
    const registry = new FakeRegistry();

    const runtime = createConfiguredRuntimeVideoCoordinator({
      registry,
      projectRoot: root,
      adbPath: "E:\\Android\\platform-tools\\adb.exe",
      serverPath,
    });

    expect(runtime).toBeDefined();
    registry.emit("R5CX211TXNT", "ONLINE");
    const configured = runtime?.providers.get("R5CX211TXNT");
    expect(configured).toMatchObject({
      serial: "R5CX211TXNT",
      kind: "tango",
      degraded: false,
      state: "STOPPED",
    });
    await runtime?.close();
  });

  it("creates a screenshot provider when scrcpy is unavailable but capture is configured", async () => {
    const registry = new FakeRegistry();
    const capture = vi.fn(async () => ({ base64: "AQID", width: 1080, height: 2340 }));
    const runtime = createConfiguredRuntimeVideoCoordinator({
      registry,
      projectRoot: "E:\\Projects\\TestCenter",
      adbPath: "E:\\Android\\platform-tools\\adb.exe",
      serverPath: "E:\\Projects\\TestCenter\\tools\\scrcpy\\3.1\\scrcpy-server",
      getScreenshotCapture: () => capture,
    });

    expect(runtime).toBeDefined();
    registry.emit("R5CX211TXNT", "ONLINE");
    const configured = runtime?.providers.get("R5CX211TXNT");
    expect(configured).toMatchObject({
      serial: "R5CX211TXNT",
      kind: "screenshot",
      degraded: true,
      state: "STOPPED",
    });

    await configured?.start();
    expect(capture).toHaveBeenCalledOnce();
    expect(configured?.getLatestFrame()).toMatchObject({
      provider: "screenshot",
      degraded: true,
    });
    await runtime?.close();
  });
});
