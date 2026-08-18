import type { StoragePressureMonitor, StoragePressureSample } from "./storage-pressure-monitor.js";

export interface StoragePollScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface StoragePressurePollerOptions {
  readonly intervalMs: number;
  readonly scheduler?: StoragePollScheduler;
  readonly onSample?: (sample: StoragePressureSample) => void;
  readonly onError?: (error: unknown) => void;
}

const defaultScheduler: StoragePollScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Owns explicit monitor start/stop and prevents overlapping samples. */
export class StoragePressurePoller {
  private readonly scheduler: StoragePollScheduler;
  private readonly intervalMs: number;
  private readonly onSample: ((sample: StoragePressureSample) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private running = false;
  private intervalHandle: unknown;
  private inFlight: Promise<StoragePressureSample> | undefined;
  private startInFlight: Promise<StoragePressureSample> | undefined;

  public constructor(
    private readonly monitor: StoragePressureMonitor,
    options: StoragePressurePollerOptions,
  ) {
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs <= 0) {
      throw new TypeError("Storage poll intervalMs must be a positive safe integer.");
    }
    this.intervalMs = options.intervalMs;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.onSample = options.onSample;
    this.onError = options.onError;
  }

  public async start(): Promise<StoragePressureSample> {
    if (this.running) {
      const latest = this.monitor.getLatest();
      if (latest !== undefined) return latest;
      if (this.startInFlight !== undefined) return this.startInFlight;
    }
    this.running = true;
    const startup = this.pollOnce()
      .then((sample) => {
        // A stop can happen while the immediate sample is pending. In that
        // case the completed startup must not resurrect a cleared interval.
        if (this.running && this.intervalHandle === undefined) {
          this.intervalHandle = this.scheduler.setInterval(() => {
            void this.pollOnce().catch((error) => this.onError?.(error));
          }, this.intervalMs);
        }
        return sample;
      })
      .catch((error) => {
        this.running = false;
        this.onError?.(error);
        throw error;
      })
      .finally(() => {
        if (this.startInFlight === startup) this.startInFlight = undefined;
      });
    this.startInFlight = startup;
    return startup;
  }

  public async stop(): Promise<void> {
    if (!this.running && this.intervalHandle === undefined) return;
    this.running = false;
    if (this.intervalHandle !== undefined) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    await this.inFlight?.catch(() => undefined);
    await this.startInFlight?.catch(() => undefined);
  }

  public isRunning(): boolean {
    return this.running;
  }

  private pollOnce(): Promise<StoragePressureSample> {
    if (this.inFlight !== undefined) return this.inFlight;
    const request = this.monitor
      .sample()
      .then((sample) => {
        this.onSample?.(sample);
        return sample;
      })
      .finally(() => {
        if (this.inFlight === request) this.inFlight = undefined;
      });
    this.inFlight = request;
    return request;
  }
}
