import { describe, expect, it, vi } from "vitest";

import { AppiumService, type ChildProcessLike } from "./appium-service.js";

describe("AppiumService", () => {
  it("builds loopback, project-local arguments without relaxed security", () => {
    const service = new AppiumService({
      executablePath: "C:\\test-center\\node_modules\\.bin\\appium.cmd",
      appiumHome: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\appium-home",
      port: 4723,
      logPath: "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\logs\\appium-4723.log",
      readinessTimeoutMs: 100,
      spawnProcess: () => {
        throw new Error("not used");
      },
      requestStatus: async () => ({ ready: true, value: { build: { version: "3.6.0" } } }),
    });
    expect(service.args).toEqual([
      "--address",
      "127.0.0.1",
      "--port",
      "4723",
      "--base-path",
      "/",
      "--log",
      "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\logs\\appium-4723.log",
    ]);
    expect(service.args).not.toContain("--relaxed-security");
    expect(service.environment.APPIUM_HOME).toBe(
      "E:\\Projects\\UnityMultiDeviceTestCenter\\data\\appium-home",
    );
  });

  it("waits for readiness and shuts down only its owned child tree", async () => {
    const child: ChildProcessLike = {
      pid: 1234,
      once: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
        if (event === "close") queueMicrotask(() => callback(0, null));
        return child;
      }),
      kill: vi.fn(),
    };
    const terminateProcessTree = vi.fn(async () => undefined);
    const service = new AppiumService({
      executablePath: "C:\\test-center\\appium.cmd",
      appiumHome: "E:\\appium-home",
      port: 4723,
      logPath: "E:\\logs\\appium.log",
      readinessTimeoutMs: 100,
      spawnProcess: () => child,
      requestStatus: async () => ({ ready: true, value: { build: { version: "3.6.0" } } }),
      terminateProcessTree,
    });
    const started = await service.start();
    await service.stop();

    expect(started.version).toBe("3.6.0");
    expect(terminateProcessTree).toHaveBeenCalledWith(1234);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("fails when readiness never arrives and terminates the owned child", async () => {
    const child: ChildProcessLike = { pid: 1235, once: vi.fn(() => child), kill: vi.fn() };
    const terminateProcessTree = vi.fn(async () => undefined);
    const service = new AppiumService({
      executablePath: "C:\\test-center\\appium.cmd",
      appiumHome: "E:\\appium-home",
      port: 4723,
      logPath: "E:\\logs\\appium.log",
      readinessTimeoutMs: 10,
      spawnProcess: () => child,
      requestStatus: async () => ({ ready: false }),
      terminateProcessTree,
    });

    await expect(service.start()).rejects.toThrow("readiness timeout");
    expect(terminateProcessTree).toHaveBeenCalledWith(1235);
  });

  it("supports a portable Node executable with an Appium CLI prefix", async () => {
    const child: ChildProcessLike = { pid: 1236, once: vi.fn(() => child), kill: vi.fn() };
    const spawnProcess = vi.fn(() => child);
    const terminateProcessTree = vi.fn(async () => undefined);
    const service = new AppiumService({
      executablePath: "E:\\tools\\node.exe",
      executableArgs: ["E:\\project\\node_modules\\appium\\build\\lib\\main.js"],
      appiumHome: "E:\\appium-home",
      port: 4723,
      logPath: "E:\\logs\\appium.log",
      readinessTimeoutMs: 100,
      spawnProcess,
      requestStatus: async () => ({ ready: true }),
      terminateProcessTree,
    });

    await service.start();
    await service.stop();

    expect(spawnProcess).toHaveBeenCalledWith(
      "E:\\tools\\node.exe",
      ["E:\\project\\node_modules\\appium\\build\\lib\\main.js", ...service.args],
      expect.objectContaining({ APPIUM_HOME: "E:\\appium-home" }),
      undefined,
    );
  });

  it("allows the runtime to pin Appium to the same Android SDK environment as its ADB client", () => {
    const service = new AppiumService({
      executablePath: "E:\\tools\\node.exe",
      appiumHome: "E:\\appium-home",
      port: 4723,
      logPath: "E:\\logs\\appium.log",
      environment: {
        ANDROID_HOME: "E:\\tools\\scrcpy\\3.1",
        ANDROID_SDK_ROOT: "E:\\tools\\scrcpy\\3.1",
      },
    });

    expect(service.environment).toMatchObject({
      ANDROID_HOME: "E:\\tools\\scrcpy\\3.1",
      ANDROID_SDK_ROOT: "E:\\tools\\scrcpy\\3.1",
    });
  });
});
