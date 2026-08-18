import {
  DEFAULT_STORAGE_THRESHOLDS,
  StoragePolicy,
  type StoragePolicy as StoragePolicyType,
  type StoragePressure,
} from "./storage-policy.js";

export interface StorageFreeSpaceSource {
  readFreeBytes(): Promise<number | undefined>;
}

export interface StoragePressureSample {
  readonly measuredAtMs: number;
  readonly pressure: StoragePressure;
  readonly writeRateBytesPerSecond: number;
  readonly freeBytes?: number;
  readonly sourceError?: "FREE_SPACE_UNAVAILABLE";
}

export interface StoragePressureMonitorOptions {
  readonly policy?: StoragePolicyType;
  readonly now?: () => number;
  readonly windowMs?: number;
}

interface WriteEvent {
  readonly bytes: number;
  readonly atMs: number;
}

/** Samples free space and records a bounded recent write-rate signal. */
export class StoragePressureMonitor {
  private readonly policy: StoragePolicyType;
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly writes: WriteEvent[] = [];
  private latestSample: StoragePressureSample | undefined;

  public constructor(
    private readonly source: StorageFreeSpaceSource,
    options: StoragePressureMonitorOptions = {},
  ) {
    this.policy = options.policy ?? new StoragePolicy(DEFAULT_STORAGE_THRESHOLDS);
    this.now = options.now ?? (() => Date.now());
    this.windowMs = options.windowMs ?? 5 * 60 * 1000;
    if (!Number.isSafeInteger(this.windowMs) || this.windowMs <= 0) {
      throw new TypeError("Storage monitor windowMs must be a positive safe integer.");
    }
  }

  public recordWrite(bytes: number, atMs = this.now()): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new TypeError("Storage write bytes must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(atMs) || atMs < 0) {
      throw new TypeError("Storage write timestamp must be a non-negative safe integer.");
    }
    this.writes.push({ bytes, atMs });
  }

  public async sample(atMs = this.now()): Promise<StoragePressureSample> {
    if (!Number.isSafeInteger(atMs) || atMs < 0) {
      throw new TypeError("Storage sample timestamp must be a non-negative safe integer.");
    }

    let freeBytes: number | undefined;
    let sourceError: StoragePressureSample["sourceError"];
    try {
      const reading = await this.source.readFreeBytes();
      if (reading === undefined || (Number.isSafeInteger(reading) && reading >= 0)) {
        freeBytes = reading;
      } else {
        sourceError = "FREE_SPACE_UNAVAILABLE";
      }
    } catch {
      sourceError = "FREE_SPACE_UNAVAILABLE";
    }

    const sample: StoragePressureSample = {
      measuredAtMs: atMs,
      pressure: this.policy.classify(freeBytes),
      writeRateBytesPerSecond: this.calculateWriteRate(atMs),
      ...(freeBytes === undefined ? {} : { freeBytes }),
      ...(sourceError === undefined ? {} : { sourceError }),
    };
    this.latestSample = sample;
    return sample;
  }

  public getLatest(): StoragePressureSample | undefined {
    return this.latestSample;
  }

  private calculateWriteRate(atMs: number): number {
    const cutoff = atMs - this.windowMs;
    for (let index = this.writes.length - 1; index >= 0; index -= 1) {
      if (this.writes[index]!.atMs < cutoff) this.writes.splice(index, 1);
    }
    const recent = this.writes.filter((event) => event.atMs <= atMs);
    if (recent.length === 0) return 0;
    const totalBytes = recent.reduce((sum, event) => sum + event.bytes, 0);
    const elapsedMs = Math.max(1, atMs - recent[0]!.atMs);
    return (totalBytes * 1000) / elapsedMs;
  }
}
