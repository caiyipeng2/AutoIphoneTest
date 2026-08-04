import type { AdbClient, MetadataCommandResult } from "@test-center/adb";
import { collectDeviceMetadata, parseDevicesOutput, type ParsedAdbDevice } from "@test-center/adb";
import type { DeviceSerial } from "@test-center/contracts/device";

import {
  DeviceRepository,
  type DeviceHistoryRecord,
  type DeviceMutation,
  type DeviceObservation,
  type DeviceRecord,
} from "./device-repository.js";

export interface DeviceDiscoverySource {
  discover(): Promise<readonly DeviceObservation[]>;
}

export interface DeviceRegistryEvent {
  readonly version: 1;
  readonly type: "device.upserted" | "device.connectionChanged";
  readonly eventSeq: number;
  readonly device: DeviceRecord;
}

export type DeviceRegistryListener = (event: DeviceRegistryEvent) => void;

export interface DeviceRegistryOptions {
  readonly pollIntervalMs?: number;
  readonly now?: () => string;
}

export class DeviceRegistry {
  private readonly listeners = new Set<DeviceRegistryListener>();
  private readonly pollIntervalMs: number;
  private readonly now: () => string;
  private stopController: AbortController | undefined;
  private sequence = 0;

  public constructor(
    private readonly repository: DeviceRepository,
    private readonly source: DeviceDiscoverySource,
    options: DeviceRegistryOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs <= 0) {
      throw new TypeError("pollIntervalMs must be a positive integer.");
    }
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public get eventSeq(): number {
    return this.sequence;
  }

  public subscribe(listener: DeviceRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async poll(): Promise<readonly DeviceMutation[]> {
    const observations = await this.source.discover();
    const seen = new Set<DeviceSerial>();
    const mutations: DeviceMutation[] = [];
    for (const observation of observations) {
      seen.add(observation.serial);
      const mutation = this.repository.upsert(observation, this.now());
      mutations.push(mutation);
      if (mutation.changed) this.emit("device.upserted", mutation.record);
      if (mutation.connectionChanged) this.emit("device.connectionChanged", mutation.record);
    }
    for (const mutation of this.repository.markMissing(seen, this.now())) {
      mutations.push(mutation);
      if (mutation.changed) this.emit("device.upserted", mutation.record);
      if (mutation.connectionChanged) this.emit("device.connectionChanged", mutation.record);
    }
    return mutations;
  }

  public async start(signal?: AbortSignal): Promise<void> {
    if (this.stopController !== undefined) throw new Error("Device registry is already running.");
    const controller = new AbortController();
    this.stopController = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      while (!controller.signal.aborted) {
        await this.poll();
        if (!controller.signal.aborted) await waitForAbort(controller.signal, this.pollIntervalMs);
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      this.stopController = undefined;
    }
  }

  public stop(): void {
    this.stopController?.abort();
  }

  public list(): DeviceRecord[] {
    return this.repository.list();
  }

  public get(serial: DeviceSerial): DeviceRecord | undefined {
    return this.repository.get(serial);
  }

  public history(serial: DeviceSerial): DeviceHistoryRecord[] {
    return this.repository.history(serial);
  }

  public setTags(serial: DeviceSerial, tags: readonly string[], group?: string): DeviceRecord {
    const record = this.repository.setTags(serial, tags, group, this.now());
    this.emit("device.upserted", record);
    return record;
  }

  private emit(type: DeviceRegistryEvent["type"], device: DeviceRecord): void {
    const event: DeviceRegistryEvent = { version: 1, type, eventSeq: ++this.sequence, device };
    for (const listener of this.listeners) listener(event);
  }
}

export function createAdbDiscoverySource(client: AdbClient): DeviceDiscoverySource {
  return {
    async discover(): Promise<readonly DeviceObservation[]> {
      let devicesResult;
      try {
        devicesResult = await client.execute({ kind: "devices" });
      } catch {
        return [];
      }
      if (devicesResult.timedOut || devicesResult.exitCode !== 0) return [];
      const devices = parseDevicesOutput(devicesResult.stdout);
      return await Promise.all(devices.map((device) => createObservation(client, device)));
    },
  };
}

async function createObservation(
  client: AdbClient,
  device: ParsedAdbDevice,
): Promise<DeviceObservation> {
  const metadata =
    device.state === "ONLINE"
      ? await collectDeviceMetadata(device.serial, {
          execute: async (command): Promise<MetadataCommandResult> => await client.execute(command),
        })
      : undefined;
  return {
    serial: device.serial,
    state: device.state,
    metadata: {
      ...(device.model === undefined ? {} : { model: device.model }),
      ...(device.product === undefined ? {} : { product: device.product }),
      ...(device.device === undefined ? {} : { device: device.device }),
      ...(device.transportId === undefined ? {} : { transportId: device.transportId }),
      ...(metadata === undefined ? {} : metadata),
    },
  };
}

function waitForAbort(signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
