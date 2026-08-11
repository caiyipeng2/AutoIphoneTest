import { describe, expect, it, vi } from "vitest";

import type { DeviceSessionCapabilities, SessionFence } from "@test-center/appium";

import { AppiumPreflightProbe } from "./appium-preflight.js";

describe("AppiumPreflightProbe", () => {
  it("creates a serial-bound session, activates the package, and closes it", async () => {
    const fence: SessionFence = { sessionId: "session-a", serial: "R5CX211TXNT", generation: 1 };
    const client = {
      createSession: vi.fn(async (capabilities: DeviceSessionCapabilities) => {
        expect(capabilities).toMatchObject({
          platformName: "Android",
          automationName: "UiAutomator2",
          udid: fence.serial,
          systemPort: 8201,
          mjpegServerPort: 7811,
          noReset: true,
        });
        return fence;
      }),
      activateApp: vi.fn(async () => undefined),
      currentPackage: vi.fn(async () => "com.hg.idleweaponshoptycoon.android"),
      deleteSession: vi.fn(async () => undefined),
    };
    const probe = new AppiumPreflightProbe({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      clientFactory: () => client,
    });

    await probe.check({ serial: fence.serial, packageName: "com.hg.idleweaponshoptycoon.android" });

    expect(client.activateApp).toHaveBeenCalledWith(fence, "com.hg.idleweaponshoptycoon.android");
    expect(client.currentPackage).toHaveBeenCalledWith(fence);
    expect(client.deleteSession).toHaveBeenCalledWith(fence);
  });

  it("closes the Appium session when the foreground package is wrong", async () => {
    const fence: SessionFence = { sessionId: "session-b", serial: "R5CX211TXNT", generation: 1 };
    const client = {
      createSession: vi.fn(async () => fence),
      activateApp: vi.fn(async () => undefined),
      currentPackage: vi.fn(async () => "com.example.other"),
      deleteSession: vi.fn(async () => undefined),
    };
    const probe = new AppiumPreflightProbe({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      foregroundTimeoutMs: 20,
      foregroundPollIntervalMs: 1,
      clientFactory: () => client,
    });

    await expect(
      probe.check({ serial: fence.serial, packageName: "com.hg.idleweaponshoptycoon.android" }),
    ).rejects.toThrow("foreground package");
    expect(client.deleteSession).toHaveBeenCalledWith(fence);
  });

  it("waits for the target package when activation reports a transient foreground app", async () => {
    const fence: SessionFence = { sessionId: "session-c", serial: "R5CX211TXNT", generation: 1 };
    const client = {
      createSession: vi.fn(async () => fence),
      activateApp: vi.fn(async () => undefined),
      currentPackage: vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("com.qent.probe")
        .mockResolvedValueOnce("com.hg.idleweaponshoptycoon.android"),
      deleteSession: vi.fn(async () => undefined),
    };
    const probe = new AppiumPreflightProbe({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      foregroundTimeoutMs: 100,
      foregroundPollIntervalMs: 1,
      clientFactory: () => client,
    });

    await probe.check({ serial: fence.serial, packageName: "com.hg.idleweaponshoptycoon.android" });

    expect(client.currentPackage).toHaveBeenCalledTimes(2);
    expect(client.deleteSession).toHaveBeenCalledWith(fence);
  });
});
