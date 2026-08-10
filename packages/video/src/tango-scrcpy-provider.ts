import { performance } from "node:perf_hooks";

import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

import { LatestFrameBuffer, type EncodedFrame } from "./latest-frame-buffer.js";
import { ScrcpyVideoParser, type ScrcpyVideoEvent } from "./scrcpy-video-parser.js";
import type { ViewProvider, ViewProviderState } from "./view-provider.js";

const DEFAULT_FIRST_FRAME_TIMEOUT_MS = 3_000;

export interface ScrcpyVideoTransport {
  open(): Promise<AsyncIterable<Uint8Array>>;
  close(): Promise<void>;
}

export interface TangoScrcpyViewProviderOptions {
  readonly serial: string;
  readonly transport: ScrcpyVideoTransport;
  readonly firstFrameTimeoutMs?: number;
  readonly now?: () => number;
}

export class TangoScrcpyViewProvider implements ViewProvider {
  public readonly serial: DeviceSerial;
  public readonly kind = "tango" as const;
  public readonly degraded = false;
  private readonly transport: ScrcpyVideoTransport;
  private readonly firstFrameTimeoutMs: number;
  private readonly now: () => number;
  private readonly parser = new ScrcpyVideoParser();
  private readonly frames = new LatestFrameBuffer();
  private readonly listeners = new Set<(frame: EncodedFrame) => void>();
  private frameId = 0;
  private _state: ViewProviderState = "STOPPED";
  private firstFrameResolve: (() => void) | undefined;
  private firstFrameReject: ((error: Error) => void) | undefined;

  public constructor(options: TangoScrcpyViewProviderOptions) {
    this.serial = parseDeviceSerial(options.serial);
    this.transport = options.transport;
    this.firstFrameTimeoutMs = options.firstFrameTimeoutMs ?? DEFAULT_FIRST_FRAME_TIMEOUT_MS;
    this.now = options.now ?? (() => performance.now());
    if (!Number.isSafeInteger(this.firstFrameTimeoutMs) || this.firstFrameTimeoutMs < 1) {
      throw new TypeError("First scrcpy frame timeout must be a positive safe integer.");
    }
  }

  public get state(): ViewProviderState {
    return this._state;
  }

  public async start(): Promise<void> {
    if (this._state === "READY") return;
    if (this._state === "STARTING") throw new Error("Tango view provider is already starting.");
    this._state = "STARTING";
    try {
      const stream = await this.transport.open();
      void this.consume(stream);
      if (this.frames.peek() === undefined) await this.waitForFirstFrame();
      this._state = "READY";
    } catch (error) {
      this._state = "ERROR";
      await this.transport.close().catch(() => undefined);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    await this.transport.close();
    this._state = "STOPPED";
    this.rejectFirstFrame(new Error("Tango view provider stopped before the first H.264 frame."));
  }

  public async captureOnce(): Promise<EncodedFrame> {
    const latest = this.frames.peek();
    if (latest !== undefined) return latest;
    if (this._state === "STOPPED") await this.start();
    if (this._state === "STARTING") await this.waitForFirstFrame();
    const frame = this.frames.peek();
    if (frame === undefined) throw new Error("No H.264 frame is available.");
    return frame;
  }

  public getLatestFrame(): EncodedFrame | undefined {
    return this.frames.peek();
  }

  public subscribe(listener: (frame: EncodedFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async consume(stream: AsyncIterable<Uint8Array>): Promise<void> {
    try {
      for await (const chunk of stream) {
        for (const event of this.parser.feed(chunk)) this.handleEvent(event);
      }
      this.parser.finish();
      if (this._state !== "STOPPED") {
        this._state = "ERROR";
        this.rejectFirstFrame(new Error("scrcpy video stream ended before the first H.264 frame."));
      }
    } catch (error) {
      if (this._state !== "STOPPED") this._state = "ERROR";
      this.rejectFirstFrame(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleEvent(event: ScrcpyVideoEvent): void {
    if (event.type === "metadata") return;
    const frame: EncodedFrame = {
      schemaVersion: 1,
      frameId: ++this.frameId,
      serial: this.serial,
      capturedAtMonotonicMs: this.now(),
      metricsEpoch: event.metricsEpoch,
      width: event.width,
      height: event.height,
      format: "h264",
      data: event.data,
      keyFrame: event.keyFrame,
      config: event.config,
      presentationTimestampUs: event.presentationTimestampUs.toString(),
      degraded: false,
      provider: "tango",
    };
    this.frames.publish(frame);
    for (const listener of this.listeners) listener({ ...frame, data: frame.data.slice() });
    if (this.firstFrameResolve !== undefined) {
      const resolve = this.firstFrameResolve;
      this.firstFrameResolve = undefined;
      this.firstFrameReject = undefined;
      resolve();
    }
  }

  private waitForFirstFrame(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.firstFrameResolve = undefined;
        this.firstFrameReject = undefined;
        reject(new Error("Timed out waiting for the first H.264 frame."));
      }, this.firstFrameTimeoutMs);
      this.firstFrameResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.firstFrameReject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  private rejectFirstFrame(error: Error): void {
    const reject = this.firstFrameReject;
    this.firstFrameResolve = undefined;
    this.firstFrameReject = undefined;
    reject?.(error);
  }
}
