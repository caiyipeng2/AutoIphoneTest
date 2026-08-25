import { existsSync } from "node:fs";
import { win32 } from "node:path";

import type { DeviceRegistry, DeviceRegistryEvent } from "@test-center/devices";
import type { DeviceSerial } from "@test-center/contracts/device";
import {
  AdbScrcpyVideoTransport,
  FailoverViewProvider,
  MjpegViewProvider,
  TangoScrcpyViewProvider,
  type ScreenshotCaptureResult,
  type ViewProvider,
} from "@test-center/video";

export interface RuntimeVideoCoordinatorOptions {
  readonly registry: Pick<DeviceRegistry, "list" | "subscribe">;
  readonly createProvider: (serial: DeviceSerial) => ViewProvider;
}

export interface RuntimeVideoCoordinator {
  readonly providers: Map<string, ViewProvider>;
  start(serial: string): Promise<void>;
  close(): Promise<void>;
}

export interface ConfiguredRuntimeVideoOptions {
  readonly registry: Pick<DeviceRegistry, "list" | "subscribe">;
  readonly projectRoot: string;
  readonly adbPath: string;
  readonly serverPath?: string;
  readonly getScreenshotCapture?: (
    serial: DeviceSerial,
  ) => (() => Promise<ScreenshotCaptureResult>) | undefined;
}

export function createConfiguredRuntimeVideoCoordinator(
  options: ConfiguredRuntimeVideoOptions,
): RuntimeVideoCoordinator | undefined {
  const serverPath = win32.normalize(
    options.serverPath ??
      process.env.TEST_CENTER_SCRCPY_SERVER_PATH ??
      win32.join(options.projectRoot, "tools", "scrcpy", "3.1", "scrcpy-server"),
  );
  if (!win32.isAbsolute(serverPath)) throw new TypeError("scrcpy server path must be absolute.");
  if (!win32.isAbsolute(options.adbPath)) throw new TypeError("adb path must be absolute.");
  const hasPrimary = existsSync(serverPath);
  if (!hasPrimary && options.getScreenshotCapture === undefined) return undefined;
  return createRuntimeVideoCoordinator({
    registry: options.registry,
    createProvider: (serial) => {
      const primary = hasPrimary
        ? new TangoScrcpyViewProvider({
            serial,
            transport: new AdbScrcpyVideoTransport({
              serial,
              adbPath: options.adbPath,
              serverPath,
            }),
          })
        : undefined;
      const fallback =
        options.getScreenshotCapture === undefined
          ? undefined
          : new MjpegViewProvider({
              serial,
              captureScreenshot: async () => {
                const capture = options.getScreenshotCapture?.(serial);
                if (capture === undefined) {
                  throw new Error(`Screenshot capture is unavailable for serial: ${serial}.`);
                }
                return await capture();
              },
            });
      if (primary === undefined && fallback === undefined) {
        throw new Error(`No video provider is configured for serial: ${serial}.`);
      }
      if (primary === undefined) return fallback!;
      if (fallback === undefined) return primary;
      return new FailoverViewProvider({ serial, primary, fallback });
    },
  });
}

export function createRuntimeVideoCoordinator(
  options: RuntimeVideoCoordinatorOptions,
): RuntimeVideoCoordinator {
  const providers = new Map<string, ViewProvider>();
  const unsubscribe = options.registry.subscribe((event) => handleDeviceEvent(event));
  for (const device of options.registry.list()) handleDevice(device.serial, device.state);

  return {
    providers,
    async start(serial: string): Promise<void> {
      const provider = providers.get(serial);
      if (provider === undefined) {
        throw new Error(`Video provider is unavailable for this serial: ${serial}.`);
      }
      await provider.start();
    },
    async close(): Promise<void> {
      unsubscribe();
      const activeProviders = [...providers.values()];
      providers.clear();
      await Promise.allSettled(activeProviders.map((provider) => provider.stop()));
    },
  };

  function handleDeviceEvent(event: DeviceRegistryEvent): void {
    handleDevice(event.device.serial, event.device.state);
  }

  function handleDevice(serial: DeviceSerial, state: string): void {
    if (state === "ONLINE") {
      if (!providers.has(serial)) providers.set(serial, options.createProvider(serial));
      return;
    }
    const provider = providers.get(serial);
    if (provider === undefined) return;
    providers.delete(serial);
    void provider.stop().catch(() => undefined);
  }
}
