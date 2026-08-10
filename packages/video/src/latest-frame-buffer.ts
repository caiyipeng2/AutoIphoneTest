export interface EncodedFrame {
  readonly schemaVersion: 1;
  readonly frameId: number;
  readonly serial: string;
  readonly capturedAtMonotonicMs: number;
  readonly metricsEpoch: number;
  readonly width: number;
  readonly height: number;
  readonly format: "jpeg" | "h264";
  readonly data: Uint8Array;
  readonly keyFrame?: boolean;
  readonly config?: boolean;
  readonly presentationTimestampUs?: string;
  readonly degraded: boolean;
  readonly provider: "tango" | "mjpeg" | "screenshot";
  readonly degradedReason?: "PRIMARY_PROVIDER_UNAVAILABLE" | "BACKPRESSURE";
}

export interface LatestFrameBufferOptions {
  readonly maxFrames?: 1 | 2;
}

export class LatestFrameBuffer {
  private readonly maxFrames: number;
  private readonly frames: EncodedFrame[] = [];
  private lastFrameId = 0;
  private dropped = 0;

  public constructor(options: LatestFrameBufferOptions = {}) {
    this.maxFrames = options.maxFrames ?? 2;
    if (this.maxFrames < 1 || this.maxFrames > 2) {
      throw new TypeError("Latest frame buffer supports one or two frames.");
    }
  }

  public get size(): number {
    return this.frames.length;
  }

  public get droppedFrameCount(): number {
    return this.dropped;
  }

  public publish(frame: EncodedFrame): void {
    if (!Number.isSafeInteger(frame.frameId) || frame.frameId <= this.lastFrameId) {
      throw new Error("Frame ids must be monotonically increasing.");
    }
    this.lastFrameId = frame.frameId;
    this.frames.push(cloneFrame(frame));
    while (this.frames.length > this.maxFrames) {
      this.frames.shift();
      this.dropped += 1;
    }
  }

  public peek(): EncodedFrame | undefined {
    const frame = this.frames[this.frames.length - 1];
    return frame === undefined ? undefined : cloneFrame(frame);
  }

  public drain(): readonly EncodedFrame[] {
    const latest = this.frames[this.frames.length - 1];
    this.frames.length = 0;
    return latest === undefined ? [] : [cloneFrame(latest)];
  }
}

function cloneFrame(frame: EncodedFrame): EncodedFrame {
  return { ...frame, data: frame.data.slice() };
}
