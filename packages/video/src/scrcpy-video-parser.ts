const H264_CODEC = 0x68323634;
const VIDEO_METADATA_BYTES = 12;
const FRAME_HEADER_BYTES = 12;
const DEFAULT_MAX_PACKET_BYTES = 32 * 1024 * 1024;
const CONFIG_FLAG = 1n << 63n;
const KEY_FRAME_FLAG = 1n << 62n;
const PTS_MASK = KEY_FRAME_FLAG - 1n;

export interface ScrcpyVideoParserOptions {
  readonly maxPacketBytes?: number;
}

export interface ScrcpyVideoMetadataEvent {
  readonly type: "metadata";
  readonly codec: "h264";
  readonly width: number;
  readonly height: number;
  readonly metricsEpoch: number;
}

export interface ScrcpyVideoFrameEvent {
  readonly type: "frame";
  readonly codec: "h264";
  readonly width: number;
  readonly height: number;
  readonly metricsEpoch: number;
  readonly presentationTimestampUs: bigint;
  readonly config: boolean;
  readonly keyFrame: boolean;
  readonly data: Uint8Array;
}

export type ScrcpyVideoEvent = ScrcpyVideoMetadataEvent | ScrcpyVideoFrameEvent;

/** Parses the fixed v3.1 video socket framing without assuming read boundaries. */
export class ScrcpyVideoParser {
  private readonly maxPacketBytes: number;
  private pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private metadataParsed = false;
  private width = 0;
  private height = 0;
  private metricsEpoch = 1;

  public constructor(options: ScrcpyVideoParserOptions = {}) {
    this.maxPacketBytes = options.maxPacketBytes ?? DEFAULT_MAX_PACKET_BYTES;
    if (!Number.isSafeInteger(this.maxPacketBytes) || this.maxPacketBytes < 1) {
      throw new TypeError("scrcpy packet limit must be a positive safe integer.");
    }
  }

  public feed(chunk: Uint8Array): ScrcpyVideoEvent[] {
    if (chunk.byteLength > 0) this.pending = concat(this.pending, chunk);
    const events: ScrcpyVideoEvent[] = [];
    while (true) {
      if (!this.metadataParsed) {
        if (this.pending.byteLength < VIDEO_METADATA_BYTES) break;
        const view = new DataView(this.pending.buffer, this.pending.byteOffset);
        const codec = view.getUint32(0);
        if (codec !== H264_CODEC) {
          throw new Error(`Unsupported scrcpy video codec 0x${codec.toString(16)}.`);
        }
        const width = view.getUint32(4);
        const height = view.getUint32(8);
        if (width < 1 || height < 1) throw new Error("scrcpy video dimensions must be positive.");
        this.width = width;
        this.height = height;
        this.metadataParsed = true;
        this.pending = this.pending.slice(VIDEO_METADATA_BYTES);
        events.push({
          type: "metadata",
          codec: "h264",
          width,
          height,
          metricsEpoch: this.metricsEpoch,
        });
      }

      if (this.pending.byteLength < FRAME_HEADER_BYTES) break;
      const view = new DataView(this.pending.buffer, this.pending.byteOffset);
      const flagsAndPts = view.getBigUint64(0);
      const packetBytes = view.getUint32(8);
      if (packetBytes > this.maxPacketBytes) {
        throw new Error(`scrcpy packet size ${packetBytes} exceeds the configured limit.`);
      }
      if (this.pending.byteLength < FRAME_HEADER_BYTES + packetBytes) break;
      const data = this.pending.slice(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + packetBytes);
      this.pending = this.pending.slice(FRAME_HEADER_BYTES + packetBytes);
      events.push({
        type: "frame",
        codec: "h264",
        width: this.width,
        height: this.height,
        metricsEpoch: this.metricsEpoch,
        presentationTimestampUs: flagsAndPts & PTS_MASK,
        config: (flagsAndPts & CONFIG_FLAG) !== 0n,
        keyFrame: (flagsAndPts & KEY_FRAME_FLAG) !== 0n,
        data,
      });
    }
    return events;
  }

  public finish(): void {
    if (this.pending.byteLength > 0)
      throw new Error("scrcpy video stream ended with an incomplete packet.");
  }

  public reset(): void {
    this.pending = new Uint8Array(0);
    this.metadataParsed = false;
    this.width = 0;
    this.height = 0;
    this.metricsEpoch += 1;
  }
}

function concat(left: Uint8Array<ArrayBufferLike>, right: Uint8Array): Uint8Array<ArrayBufferLike> {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left, 0);
  output.set(right, left.byteLength);
  return output;
}
