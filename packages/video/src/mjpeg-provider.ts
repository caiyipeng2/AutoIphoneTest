import { performance } from "node:perf_hooks";

import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

import { LatestFrameBuffer, type EncodedFrame } from "./latest-frame-buffer.js";
import type { ViewProvider, ViewProviderState } from "./view-provider.js";

const DEFAULT_MIN_CAPTURE_INTERVAL_MS = 500;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export interface ScreenshotCaptureResult {
  readonly base64: string;
  readonly width: number;
  readonly height: number;
}

export interface MjpegViewProviderOptions {
  readonly serial: string;
  readonly captureScreenshot: () => Promise<ScreenshotCaptureResult>;
  readonly minCaptureIntervalMs?: number;
  readonly now?: () => number;
}

export type ViewProviderErrorCode =
  "INVALID_STATE" | "RATE_LIMITED" | "CAPTURE_FAILED" | "INVALID_FRAME";

export class ViewProviderError extends Error {
  public constructor(
    public readonly code: ViewProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ViewProviderError";
  }
}

export class MjpegViewProvider implements ViewProvider {
  public readonly serial: DeviceSerial;
  public readonly kind = "screenshot" as const;
  public readonly degraded = true;
  private readonly captureScreenshot: MjpegViewProviderOptions["captureScreenshot"];
  private readonly minCaptureIntervalMs: number;
  private readonly now: () => number;
  private readonly frames = new LatestFrameBuffer();
  private readonly listeners = new Set<(frame: EncodedFrame) => void>();
  private frameId = 0;
  private metricsEpoch = 1;
  private lastDimensions: { width: number; height: number } | undefined;
  private lastCaptureAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private _state: ViewProviderState = "STOPPED";

  public constructor(options: MjpegViewProviderOptions) {
    this.serial = parseDeviceSerial(options.serial);
    this.captureScreenshot = options.captureScreenshot;
    this.minCaptureIntervalMs = options.minCaptureIntervalMs ?? DEFAULT_MIN_CAPTURE_INTERVAL_MS;
    this.now = options.now ?? (() => performance.now());
    if (!Number.isSafeInteger(this.minCaptureIntervalMs) || this.minCaptureIntervalMs < 500) {
      throw new TypeError("Screenshot capture interval must be at least 500ms.");
    }
  }

  public get state(): ViewProviderState {
    return this._state;
  }

  public async start(): Promise<void> {
    if (this._state === "READY" || this._state === "DEGRADED") return;
    if (this._state === "STARTING")
      throw new ViewProviderError("INVALID_STATE", "View provider is starting.");
    this._state = "STARTING";
    try {
      await this.captureOnce();
      this._state = "DEGRADED";
      this.scheduleCapture();
    } catch (error) {
      this._state = "ERROR";
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this._state = "STOPPED";
  }

  public async captureOnce(): Promise<EncodedFrame> {
    const capturedAt = this.now();
    if (
      this.lastCaptureAt !== undefined &&
      capturedAt - this.lastCaptureAt < this.minCaptureIntervalMs
    ) {
      throw new ViewProviderError(
        "RATE_LIMITED",
        "Screenshot fallback is limited to two frames per second.",
      );
    }
    this.lastCaptureAt = capturedAt;
    let result: ScreenshotCaptureResult;
    try {
      result = await this.captureScreenshot();
    } catch (error) {
      throw new ViewProviderError("CAPTURE_FAILED", "Appium screenshot capture failed.", {
        cause: error,
      });
    }
    if (
      !Number.isSafeInteger(result.width) ||
      result.width <= 0 ||
      !Number.isSafeInteger(result.height) ||
      result.height <= 0
    ) {
      throw new ViewProviderError("INVALID_FRAME", "Screenshot dimensions are invalid.");
    }
    const data = Buffer.from(result.base64, "base64");
    if (data.byteLength === 0 || data.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new ViewProviderError(
        "INVALID_FRAME",
        "Screenshot payload is empty or exceeds the size limit.",
      );
    }
    if (
      this.lastDimensions !== undefined &&
      (this.lastDimensions.width !== result.width || this.lastDimensions.height !== result.height)
    ) {
      this.metricsEpoch += 1;
    }
    this.lastDimensions = { width: result.width, height: result.height };
    const frame: EncodedFrame = {
      schemaVersion: 1,
      frameId: ++this.frameId,
      serial: this.serial,
      capturedAtMonotonicMs: capturedAt,
      metricsEpoch: this.metricsEpoch,
      width: result.width,
      height: result.height,
      format: "jpeg",
      data: new Uint8Array(data),
      degraded: true,
      provider: "screenshot",
      degradedReason: "PRIMARY_PROVIDER_UNAVAILABLE",
    };
    this.frames.publish(frame);
    for (const listener of this.listeners) listener(cloneFrame(frame));
    return cloneFrame(frame);
  }

  public getLatestFrame(): EncodedFrame | undefined {
    return this.frames.peek();
  }

  public subscribe(listener: (frame: EncodedFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleCapture(): void {
    this.timer = setTimeout(() => {
      if (this._state !== "DEGRADED" && this._state !== "READY") return;
      void this.captureOnce()
        .catch(() => undefined)
        .finally(() => this.scheduleCapture());
    }, this.minCaptureIntervalMs);
  }
}

function cloneFrame(frame: EncodedFrame): EncodedFrame {
  return { ...frame, data: frame.data.slice() };
}
