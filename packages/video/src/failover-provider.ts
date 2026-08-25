import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

import type { EncodedFrame } from "./latest-frame-buffer.js";
import type { ViewProvider, ViewProviderKind, ViewProviderState } from "./view-provider.js";

export interface FailoverViewProviderOptions {
  readonly serial: string;
  readonly primary: ViewProvider;
  readonly fallback: ViewProvider;
}

/**
 * Keeps the gateway contract stable while choosing the best available view
 * provider at startup. The fallback is deliberately activated only after the
 * primary provider has failed and been stopped, so two device transports are
 * never left running for one serial.
 */
export class FailoverViewProvider implements ViewProvider {
  public readonly serial: DeviceSerial;
  private readonly primary: ViewProvider;
  private readonly fallback: ViewProvider;
  private readonly listeners = new Map<(frame: EncodedFrame) => void, (() => void) | undefined>();
  private active: ViewProvider | undefined;
  private _state: ViewProviderState = "STOPPED";

  public constructor(options: FailoverViewProviderOptions) {
    this.serial = parseDeviceSerial(options.serial);
    if (options.primary.serial !== this.serial || options.fallback.serial !== this.serial) {
      throw new TypeError("Failover providers must use the configured serial.");
    }
    this.primary = options.primary;
    this.fallback = options.fallback;
  }

  public get kind(): ViewProviderKind {
    return this.active?.kind ?? this.primary.kind;
  }

  public get degraded(): boolean {
    return this.active?.degraded ?? this.primary.degraded;
  }

  public get state(): ViewProviderState {
    return this.active?.state ?? this._state;
  }

  public async start(): Promise<void> {
    if (this.active !== undefined && (this.state === "READY" || this.state === "DEGRADED")) {
      return;
    }
    if (this._state === "STARTING") throw new Error("Failover view provider is already starting.");
    this._state = "STARTING";
    try {
      await this.primary.start();
      this.activate(this.primary);
      return;
    } catch (primaryError) {
      await this.primary.stop().catch(() => undefined);
      try {
        await this.fallback.start();
        this.activate(this.fallback);
        return;
      } catch (fallbackError) {
        await this.fallback.stop().catch(() => undefined);
        this.active = undefined;
        this._state = "ERROR";
        const primaryMessage =
          primaryError instanceof Error ? primaryError.message : String(primaryError);
        throw new Error(
          `Primary and screenshot fallback providers failed to start: ${primaryMessage}.`,
          { cause: fallbackError },
        );
      }
    }
  }

  public async stop(): Promise<void> {
    const active = this.active;
    this.detachListeners();
    this.active = undefined;
    if (active !== undefined) await active.stop();
    this._state = "STOPPED";
  }

  public async captureOnce(): Promise<EncodedFrame> {
    if (this.active === undefined) await this.start();
    const active = this.active;
    if (active === undefined) throw new Error("No active view provider is available.");
    return await active.captureOnce();
  }

  public getLatestFrame(): EncodedFrame | undefined {
    return this.active?.getLatestFrame();
  }

  public subscribe(listener: (frame: EncodedFrame) => void): () => void {
    if (this.listeners.has(listener)) return () => undefined;
    this.listeners.set(listener, this.active?.subscribe(listener));
    return () => {
      const unsubscribe = this.listeners.get(listener);
      unsubscribe?.();
      this.listeners.delete(listener);
    };
  }

  private activate(provider: ViewProvider): void {
    this.active = provider;
    this._state = provider.state;
    for (const [listener, unsubscribe] of this.listeners) {
      unsubscribe?.();
      this.listeners.set(listener, provider.subscribe(listener));
    }
  }

  private detachListeners(): void {
    for (const [listener, unsubscribe] of this.listeners) {
      unsubscribe?.();
      this.listeners.set(listener, undefined);
    }
  }
}
