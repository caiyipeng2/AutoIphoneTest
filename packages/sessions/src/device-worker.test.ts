import { describe, expect, it, vi } from "vitest";

import type { AppiumW3cClient, PortLease, SessionFence } from "@test-center/appium";
import type { LogcatStream } from "@test-center/adb";
import {
  DeviceWorker,
  type DeviceWorkerIdentity,
  type DeviceWorkerState,
} from "./device-worker.js";

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

function createHarness() {
  const fence: SessionFence = { sessionId: "session-a", serial: "serial-a", generation: 1 };
  const client = {
    createSession: vi.fn(async () => fence),
    deleteSession: vi.fn(async () => undefined),
  } as unknown as AppiumW3cClient;
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
  return { worker, client, logcat, allocator, identity };
}

describe("DeviceWorker", () => {
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
