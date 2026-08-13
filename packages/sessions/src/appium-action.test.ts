import { describe, expect, it, vi } from "vitest";

import type { DeviceSessionCapabilities, SessionFence, W3cAction } from "@test-center/appium";
import { AppiumW3cClientError } from "@test-center/appium";

import {
  AppiumActionExecutor,
  createCommandPointerActions,
  createPointerActions,
} from "./appium-action.js";

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

  it("maps long press to a bounded W3C hold sequence", () => {
    expect(
      createCommandPointerActions(
        { type: "longPress", x: 0.25, y: 0.5, durationMs: 300 },
        { width: 100, height: 200 },
      ),
    ).toEqual([
      {
        type: "pointer",
        id: "test-center-finger",
        actions: [
          { type: "pointerMove", duration: 0, origin: "viewport", x: 25, y: 100 },
          { type: "pointerDown", button: 0 },
          { type: "pause", duration: 300 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
  });

  it("maps drag paths with the same bounded segmentation as swipe", () => {
    const actions = createCommandPointerActions(
      {
        type: "drag",
        path: [
          [0, 0.5],
          [0.5, 0.5],
          [1, 0.5],
        ],
        durationMs: 501,
      },
      { width: 100, height: 200 },
    );
    expect(actions[0]?.actions).toEqual([
      { type: "pointerMove", duration: 0, origin: "viewport", x: 0, y: 100 },
      { type: "pointerDown", button: 0 },
      { type: "pointerMove", duration: 250, origin: "viewport", x: 50, y: 100 },
      { type: "pointerMove", duration: 251, origin: "viewport", x: 99, y: 100 },
      { type: "pointerUp", button: 0 },
    ]);
  });
});

describe("AppiumActionExecutor", () => {
  it("reports a typed fault for an Appium session loss while preserving the action error", async () => {
    const faultSink = vi.fn();
    const client = {
      createSession: vi.fn(
        async () =>
          ({
            sessionId: "session-lost",
            serial: "R5CX211TXNT",
            generation: 1,
          }) satisfies SessionFence,
      ),
      activateApp: vi.fn(async () => {
        throw new AppiumW3cClientError("SESSION_NOT_FOUND", "session disappeared");
      }),
      terminateApp: vi.fn(async () => undefined),
      currentPackage: vi.fn(async () => "com.hg.idleweaponshoptycoon.android"),
      pressKey: vi.fn(async () => undefined),
      performActions: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
    const executor = new AppiumActionExecutor({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      viewport: { width: 1080, height: 2340 },
      clientFactory: () => client,
      faultSink,
    });

    await expect(
      executor.execute({
        runId: "run-a",
        actionId: "action-a",
        serial: "R5CX211TXNT",
        packageName: "com.hg.idleweaponshoptycoon.android",
      }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(faultSink).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-a",
        serial: "R5CX211TXNT",
        faultId: "action-a",
        category: "APPIUM_SESSION_LOST",
      }),
    );
    expect(client.deleteSession).toHaveBeenCalledWith(expect.anything());
  });

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
      terminateApp: vi.fn(async () => undefined),
      currentPackage: vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("com.qent.probe")
        .mockResolvedValueOnce("com.hg.idleweaponshoptycoon.android"),
      pressKey: vi.fn(async () => undefined),
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

  it("dispatches Back through Android keycode 4 without pointer actions", async () => {
    const fence: SessionFence = { sessionId: "session-back", serial: "R5CX211TXNT", generation: 1 };
    const client = {
      createSession: vi.fn(async () => fence),
      activateApp: vi.fn(async () => undefined),
      terminateApp: vi.fn(async () => undefined),
      currentPackage: vi.fn(async () => "com.hg.idleweaponshoptycoon.android"),
      pressKey: vi.fn(async () => undefined),
      performActions: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
    const executor = new AppiumActionExecutor({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      viewport: { width: 1080, height: 2340 },
      clientFactory: () => client,
    });

    const result = await executor.execute({
      serial: fence.serial,
      packageName: "com.hg.idleweaponshoptycoon.android",
      command: { type: "back" },
      payload: { kind: "tap", x: 0.5, y: 0.5 },
    });

    expect(result.pointerActionCount).toBe(0);
    expect(client.pressKey).toHaveBeenCalledWith(fence, 4);
    expect(client.performActions).not.toHaveBeenCalled();
    expect(client.deleteSession).toHaveBeenCalledWith(fence);
  });

  it("executes activate as a lifecycle command without pointer actions", async () => {
    const fence: SessionFence = {
      sessionId: "session-activate",
      serial: "R5CX211TXNT",
      generation: 1,
    };
    const client = {
      createSession: vi.fn(async () => fence),
      activateApp: vi.fn(async () => undefined),
      terminateApp: vi.fn(async () => undefined),
      currentPackage: vi.fn(async () => "com.hg.idleweaponshoptycoon.android"),
      pressKey: vi.fn(async () => undefined),
      performActions: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
    const executor = new AppiumActionExecutor({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      viewport: { width: 1080, height: 2340 },
      clientFactory: () => client,
    });

    const result = await executor.execute({
      serial: fence.serial,
      packageName: "com.hg.idleweaponshoptycoon.android",
      command: { type: "activate" },
    });

    expect(result.pointerActionCount).toBe(0);
    expect(client.activateApp).toHaveBeenCalledWith(fence, "com.hg.idleweaponshoptycoon.android");
    expect(client.performActions).not.toHaveBeenCalled();
    expect(client.deleteSession).toHaveBeenCalledWith(fence);
  });

  it("terminates the package and waits for the process probe to report absence", async () => {
    const fence: SessionFence = {
      sessionId: "session-terminate",
      serial: "R5CX211TXNT",
      generation: 1,
    };
    const client = {
      createSession: vi.fn(async () => fence),
      activateApp: vi.fn(async () => undefined),
      terminateApp: vi.fn(async () => undefined),
      currentPackage: vi.fn(async () => "com.hg.idleweaponshoptycoon.android"),
      pressKey: vi.fn(async () => undefined),
      performActions: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
    const processProbe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const executor = new AppiumActionExecutor({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      viewport: { width: 1080, height: 2340 },
      foregroundPollIntervalMs: 1,
      processProbe,
      clientFactory: () => client,
    });

    const result = await executor.execute({
      serial: fence.serial,
      packageName: "com.hg.idleweaponshoptycoon.android",
      command: { type: "terminate" },
    });

    expect(result.pointerActionCount).toBe(0);
    expect(client.terminateApp).toHaveBeenCalledWith(fence, "com.hg.idleweaponshoptycoon.android");
    expect(processProbe).toHaveBeenCalledTimes(2);
    expect(client.performActions).not.toHaveBeenCalled();
  });

  it("restarts with terminate, process absence, and a fresh activate without pointer actions", async () => {
    const fence: SessionFence = {
      sessionId: "session-restart",
      serial: "R5CX211TXNT",
      generation: 1,
    };
    const client = {
      createSession: vi.fn(async () => fence),
      activateApp: vi.fn(async () => undefined),
      terminateApp: vi.fn(async () => undefined),
      currentPackage: vi.fn(async () => "com.hg.idleweaponshoptycoon.android"),
      pressKey: vi.fn(async () => undefined),
      performActions: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
    const processProbe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const executor = new AppiumActionExecutor({
      baseUrl: "http://127.0.0.1:4723",
      systemPort: 8201,
      mjpegServerPort: 7811,
      viewport: { width: 1080, height: 2340 },
      foregroundPollIntervalMs: 1,
      processProbe,
      clientFactory: () => client,
    });

    const result = await executor.execute({
      serial: fence.serial,
      packageName: "com.hg.idleweaponshoptycoon.android",
      command: { type: "restart" },
    });

    expect(result.pointerActionCount).toBe(0);
    expect(client.terminateApp).toHaveBeenCalledWith(fence, "com.hg.idleweaponshoptycoon.android");
    expect(client.activateApp).toHaveBeenCalledTimes(2);
    expect(client.performActions).not.toHaveBeenCalled();
    expect(processProbe).toHaveBeenCalledTimes(2);
  });
});
