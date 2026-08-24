import { existsSync } from "node:fs";
import { win32 } from "node:path";

import type { DeviceRegistry, DeviceRegistryEvent } from "@test-center/devices";
import type { DeviceSerial } from "@test-center/contracts/device";
import {
  AdbScrcpyVideoTransport,
  TangoScrcpyViewProvider,
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
  if (!existsSync(serverPath)) return undefined;
  return createRuntimeVideoCoordinator({
    registry: options.registry,
    createProvider: (serial) =>
      new TangoScrcpyViewProvider({
        serial,
        transport: new AdbScrcpyVideoTransport({
          serial,
          adbPath: options.adbPath,
          serverPath,
        }),
      }),
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
