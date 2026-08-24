import { describe, expect, it, vi } from "vitest";

import type { AppiumW3cClient, PortLease, SessionFence } from "@test-center/appium";
import type { LogcatStream } from "@test-center/adb";
import {
  DeviceWorker,
  type AppiumServiceLike,
  type DeviceWorkerIdentity,
  type DeviceWorkerState,
} from "./device-worker.js";
import type { WorkerResourceLease } from "./worker-resource-manager.js";

const lease: PortLease = {
  leaseId: "lease-a",
  serial: "serial-a",
  appiumPort: 4723,
  systemPort: 8200,
  mjpegPort: 7810,
  ownerPid: 100,
  ownerToken: "run-a",
  createdAt: 1,
};

const resourceLease: WorkerResourceLease = {
  leaseId: "worker-lease-a",
  identity: { runId: "run-a", serial: "serial-a", generation: 1 },
  ownerToken: "run-a",
  ports: { appium: 4727, system: 8207, mjpeg: 7817, bridge: 17507 },
  paths: {
    logs: "E:/runs/run-a/serial-a/generation-1/logs",
    preview: "E:/runs/run-a/serial-a/generation-1/preview",
    evidence: "E:/runs/run-a/serial-a/generation-1/evidence",
  },
  appiumLeaseId: "lease-a",
};

function createHarness() {
  const fence: SessionFence = { sessionId: "session-a", serial: "serial-a", generation: 1 };
  const client = {
    createSession: vi.fn(async () => fence),
    deleteSession: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => "base64-png"),
  } as unknown as AppiumW3cClient & {
    createSession: ReturnType<typeof vi.fn>;
    screenshot: ReturnType<typeof vi.fn>;
  };
  const logcat = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  } as unknown as LogcatStream;
  const allocator = {
    allocate: vi.fn(async () => lease),
    release: vi.fn(async () => undefined),
  };
  const identity: DeviceWorkerIdentity = { serial: "serial-a", packageName: "com.example.game" };
  const worker = new DeviceWorker({
    serial: "serial-a",
    packageName: "com.example.game",
    owner: { ownerPid: 100, ownerToken: "run-a" },
    allocator,
    identityProbe: vi.fn(async () => identity),
    clientFactory: vi.fn(() => client),
    logcatFactory: vi.fn(() => logcat),
  });
  return { worker, client, logcat, allocator, identity, fence };
}

function createManagedHarness() {
  const fence: SessionFence = { sessionId: "session-a", serial: "serial-a", generation: 1 };
  const client = {
    createSession: vi.fn(async () => fence),
    deleteSession: vi.fn(async () => undefined),
  } as unknown as AppiumW3cClient & {
    createSession: ReturnType<typeof vi.fn>;
  };
  const logcat = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  } as unknown as LogcatStream;
  const appium = {
    start: vi.fn(async () => ({ pid: 501 })),
    stop: vi.fn(async () => undefined),
  } satisfies AppiumServiceLike;
  const appiumServiceFactory = vi.fn(() => appium);
  const resourceManager = {
    allocate: vi.fn(async (identity: WorkerResourceLease["identity"]) => ({
      ...resourceLease,
      identity,
      paths: {
        ...resourceLease.paths,
        logs: resourceLease.paths.logs.replace(
          /generation-\d+/,
          `generation-${identity.generation}`,
        ),
      },
    })),
    release: vi.fn(async () => undefined),
  };
  const identity: DeviceWorkerIdentity = { serial: "serial-a", packageName: "com.example.game" };
  const worker = new DeviceWorker({
    serial: "serial-a",
    packageName: "com.example.game",
    owner: { ownerPid: 100, ownerToken: "run-a" },
    runId: "run-a",
    resourceManager,
    appiumServiceFactory,
    identityProbe: vi.fn(async () => identity),
    clientFactory: vi.fn(() => client),
    logcatFactory: vi.fn(() => logcat),
  });
  return { worker, client, logcat, appium, appiumServiceFactory, resourceManager, identity };
}

describe("DeviceWorker", () => {
  it("starts managed Appium from the resource lease before creating the session", async () => {
    const { worker, client, logcat, appium, appiumServiceFactory, resourceManager } =
      createManagedHarness();

    await worker.start();

    expect(worker.state).toBe("READY");
    expect(resourceManager.allocate).toHaveBeenCalledWith({
      runId: "run-a",
      serial: "serial-a",
      generation: 1,
    });
    expect(appium.start).toHaveBeenCalledTimes(1);
    expect(appiumServiceFactory).toHaveBeenCalledWith({
      serial: "serial-a",
      generation: 1,
      port: 4727,
      logPath: resourceLease.paths.logs,
      resourceLease,
    });
    expect(client.createSession).toHaveBeenCalledWith({
      platformName: "Android",
      automationName: "UiAutomator2",
      udid: "serial-a",
      systemPort: 8207,
      mjpegServerPort: 7817,
      noReset: true,
      newCommandTimeout: 60,
    });
    expect(logcat.start).toHaveBeenCalledTimes(1);
    expect(resourceManager.allocate.mock.invocationCallOrder[0]).toBeLessThan(
      appium.start.mock.invocationCallOrder[0]!,
    );
    expect(appium.start.mock.invocationCallOrder[0]).toBeLessThan(
      client.createSession.mock.invocationCallOrder[0]!,
    );
  });

  it("releases the managed lease when Appium startup fails", async () => {
    const { worker, client, appium, resourceManager } = createManagedHarness();
    appium.start.mockRejectedValueOnce(new Error("appium unavailable"));

    await expect(worker.start()).rejects.toThrow("appium unavailable");

    expect(client.createSession).not.toHaveBeenCalled();
    expect(appium.stop).not.toHaveBeenCalled();
    expect(resourceManager.release).toHaveBeenCalledWith(resourceLease, resourceLease.ownerToken);
    expect(worker.state).toBe("ERROR");
  });

  it("stops managed resources after the session and logcat", async () => {
    const { worker, client, logcat, appium, resourceManager } = createManagedHarness();

    await worker.start();
    await worker.stop();

    expect(client.deleteSession).toHaveBeenCalledTimes(1);
    expect(logcat.stop).toHaveBeenCalledTimes(1);
    expect(appium.stop).toHaveBeenCalledTimes(1);
    expect(resourceManager.release).toHaveBeenCalledWith(resourceLease, resourceLease.ownerToken);
    expect(worker.state).toBe("STOPPED");
  });

  it("releases the managed lease when Appium stop fails", async () => {
    const { worker, appium, resourceManager } = createManagedHarness();
    appium.stop.mockRejectedValueOnce(new Error("appium stop failed"));

    await worker.start();
    await expect(worker.stop()).rejects.toMatchObject({ code: "STOP_FAILED" });

    expect(resourceManager.release).toHaveBeenCalledWith(resourceLease, resourceLease.ownerToken);
    expect(worker.state).toBe("ERROR");
    expect(worker.generation).toBe(2);
  });

  it("requests the next resource generation after a managed restart", async () => {
    const { worker, resourceManager } = createManagedHarness();

    await worker.start();
    await worker.stop();
    await worker.start();

    expect(resourceManager.allocate).toHaveBeenNthCalledWith(2, {
      runId: "run-a",
      serial: "serial-a",
      generation: 2,
    });
  });

  it("forwards the managed bridge port and connects a generation-bound bridge session", async () => {
    const { client, logcat, appium, resourceManager } = createManagedHarness();
    const forwarder = {
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const actionBarrier = {
      arm: vi.fn(async () => ({
        waitForAck: async () => undefined,
        cancel: async () => undefined,
      })),
    };
    const bridgeSession = {
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      actionBarrier,
    };
    const bridgeSessionFactory = vi.fn(() => bridgeSession);
    const bridgeWorker = new DeviceWorker({
      serial: "serial-a",
      packageName: "com.example.game",
      owner: { ownerPid: 100, ownerToken: "run-a" },
      runId: "run-a",
      resourceManager,
      appiumServiceFactory: () => appium,
      identityProbe: vi.fn(async () => ({ serial: "serial-a", packageName: "com.example.game" })),
      clientFactory: () => client,
      logcatFactory: () => logcat,
      bridgeForwarder: forwarder,
      bridgeSessionFactory,
    });

    await bridgeWorker.start();

    expect(forwarder.add).toHaveBeenCalledWith("serial-a", resourceLease.ports.bridge, 17_501);
    expect(bridgeSessionFactory).toHaveBeenCalledWith({
      serial: "serial-a",
      generation: 1,
      hostPort: resourceLease.ports.bridge,
      devicePort: 17_501,
    });
    expect(bridgeSession.connect).toHaveBeenCalledTimes(1);
    expect(bridgeWorker.getActionBarrier()).toBe(actionBarrier);

    await bridgeWorker.stop();

    expect(bridgeSession.close).toHaveBeenCalledTimes(1);
    expect(forwarder.remove).toHaveBeenCalledWith("serial-a", resourceLease.ports.bridge);
    expect(bridgeWorker.getActionBarrier()).toBeUndefined();
  });

  it("removes the bridge forward when bridge connection fails", async () => {
    const { client, logcat, appium, resourceManager } = createManagedHarness();
    const forwarder = {
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const bridgeSession = {
      connect: vi.fn(async () => {
        throw new Error("bridge unavailable");
      }),
      close: vi.fn(async () => undefined),
      actionBarrier: { arm: vi.fn() },
    };
    const bridgeWorker = new DeviceWorker({
      serial: "serial-a",
      packageName: "com.example.game",
      owner: { ownerPid: 100, ownerToken: "run-a" },
      runId: "run-a",
      resourceManager,
      appiumServiceFactory: () => appium,
      identityProbe: vi.fn(async () => ({ serial: "serial-a", packageName: "com.example.game" })),
      clientFactory: () => client,
      logcatFactory: () => logcat,
      bridgeForwarder: forwarder,
      bridgeSessionFactory: () => bridgeSession,
    });

    await expect(bridgeWorker.start()).rejects.toThrow("bridge unavailable");
    expect(bridgeSession.close).toHaveBeenCalledTimes(1);
    expect(forwarder.remove).toHaveBeenCalledWith("serial-a", resourceLease.ports.bridge);
    expect(resourceManager.release).toHaveBeenCalledWith(resourceLease, resourceLease.ownerToken);
  });

  it("checks identity, allocates ports, starts Appium and logcat, then becomes READY", async () => {
    const { worker, client, logcat, allocator } = createHarness();
    const states: DeviceWorkerState[] = [];
    worker.onStateChange((state) => states.push(state));

    await worker.start();

    expect(worker.state).toBe("READY");
    expect(states).toEqual(["STARTING", "READY"]);
    expect(allocator.allocate).toHaveBeenCalledWith("serial-a", {
      ownerPid: 100,
      ownerToken: "run-a",
    });
    expect(client.createSession).toHaveBeenCalledWith({
      platformName: "Android",
      automationName: "UiAutomator2",
      udid: "serial-a",
      systemPort: 8200,
      mjpegServerPort: 7810,
      noReset: true,
      newCommandTimeout: 60,
    });
    expect(logcat.start).toHaveBeenCalledTimes(1);
    expect(worker.getFence()).toEqual({
      sessionId: "session-a",
      serial: "serial-a",
      generation: 1,
    });
  });

  it("captures a screenshot through the current session fence while READY", async () => {
    const { worker, client, fence } = createHarness();

    await worker.start();

    await expect(worker.captureScreenshot()).resolves.toEqual({
      base64: "base64-png",
      width: 1080,
      height: 2340,
    });
    expect(client.screenshot).toHaveBeenCalledWith(fence);
  });

  it("rejects screenshot capture unless the worker owns a READY session", async () => {
    const { worker, client } = createHarness();

    await expect(worker.captureScreenshot()).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(client.screenshot).not.toHaveBeenCalled();

    await worker.start();
    await worker.stop();

    await expect(worker.captureScreenshot()).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(client.screenshot).toHaveBeenCalledTimes(0);
  });

  it("rejects an identity mismatch before allocating ports or creating a session", async () => {
    const { worker, allocator, client } = createHarness();
    (worker as unknown as { identityProbe: () => Promise<DeviceWorkerIdentity> }).identityProbe =
      async () => ({ serial: "serial-a", packageName: "com.other.game" });

    await expect(worker.start()).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(worker.state).toBe("ERROR");
    expect(allocator.allocate).not.toHaveBeenCalled();
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("cleans owned resources on stop and advances generation for a rebuild", async () => {
    const { worker, client, logcat, allocator } = createHarness();
    await worker.start();
    await worker.stop();

    expect(worker.state).toBe("STOPPED");
    expect(worker.generation).toBe(2);
    expect(logcat.stop).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith({
      sessionId: "session-a",
      serial: "serial-a",
      generation: 1,
    });
    expect(allocator.release).toHaveBeenCalledWith("lease-a", {
      ownerPid: 100,
      ownerToken: "run-a",
    });
    expect(worker.getFence()).toBeUndefined();
  });

  it("rolls back session and lease when logcat startup fails", async () => {
    const { worker, client, allocator, logcat } = createHarness();
    vi.mocked(logcat.start).mockRejectedValueOnce(new Error("logcat unavailable"));

    await expect(worker.start()).rejects.toThrow("logcat unavailable");
    expect(client.deleteSession).toHaveBeenCalledWith({
      sessionId: "session-a",
      serial: "serial-a",
      generation: 1,
    });
    expect(allocator.release).toHaveBeenCalledWith("lease-a", {
      ownerPid: 100,
      ownerToken: "run-a",
    });
    expect(worker.state).toBe("ERROR");
  });
});
