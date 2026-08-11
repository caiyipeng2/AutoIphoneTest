import { describe, expect, it, vi } from "vitest";

import type { DeviceSessionCapabilities, SessionFence, W3cAction } from "@test-center/appium";

import { AppiumActionExecutor, createPointerActions } from "./appium-action.js";

describe("createPointerActions", () => {
  it("maps a normalized tap to viewport pixels without exceeding bounds", () => {
    expect(
      createPointerActions({ kind: "tap", x: 1, y: 1 }, { width: 1080, height: 2340 }),
    ).toEqual([
      {
        type: "pointer",
        id: "test-center-finger",
        actions: [
          { type: "pointerMove", duration: 0, origin: "viewport", x: 1079, y: 2339 },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ] satisfies readonly W3cAction[]);
  });

  it("splits swipe duration across the normalized path", () => {
    const actions = createPointerActions(
      {
        kind: "swipe",
        path: [
          [0.1, 0.8],
          [0.5, 0.5],
          [0.9, 0.2],
        ],
        durationMs: 401,
      },
      { width: 100, height: 200 },
    );
    expect(actions[0]?.actions).toEqual([
      { type: "pointerMove", duration: 0, origin: "viewport", x: 10, y: 159 },
      { type: "pointerDown", button: 0 },
      { type: "pointerMove", duration: 200, origin: "viewport", x: 50, y: 100 },
      { type: "pointerMove", duration: 201, origin: "viewport", x: 89, y: 40 },
      { type: "pointerUp", button: 0 },
    ]);
  });
});

describe("AppiumActionExecutor", () => {
  it("creates a serial-bound session, activates the package, injects actions, and cleans up", async () => {
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
      currentPackage: vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("com.qent.probe")
        .mockResolvedValueOnce("com.hg.idleweaponshoptycoon.android"),
      performActions: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
    const executor = new AppiumActionExecutor({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      viewport: { width: 1080, height: 2340 },
      foregroundTimeoutMs: 100,
      foregroundPollIntervalMs: 1,
      clientFactory: () => client,
    });

    const result = await executor.execute({
      serial: fence.serial,
      packageName: "com.hg.idleweaponshoptycoon.android",
      payload: { kind: "tap", x: 0.5, y: 0.5 },
    });

    expect(result.foregroundPackage).toBe("com.hg.idleweaponshoptycoon.android");
    expect(client.performActions).toHaveBeenCalledWith(
      fence,
      createPointerActions({ kind: "tap", x: 0.5, y: 0.5 }, { width: 1080, height: 2340 }),
    );
    expect(client.deleteSession).toHaveBeenCalledWith(fence);
  });
});
