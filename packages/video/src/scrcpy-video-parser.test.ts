import { describe, expect, it } from "vitest";

import { ScrcpyVideoParser } from "./scrcpy-video-parser.js";

function u32(value: number): Uint8Array {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return new Uint8Array(buffer);
}

function u64(value: bigint): Uint8Array {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(value);
  return new Uint8Array(buffer);
}

function join(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

describe("ScrcpyVideoParser", () => {
  it("parses split metadata and frame packets with config/key flags", () => {
    const parser = new ScrcpyVideoParser();
    const metadata = join(u32(0x68323634), u32(1080), u32(2340));
    const flags = (1n << 63n) | (1n << 62n) | 1234n;
    const frame = join(u64(flags), u32(3), new Uint8Array([1, 2, 3]));

    expect(parser.feed(metadata.slice(0, 5))).toEqual([]);
    expect(parser.feed(join(metadata.slice(5), frame.slice(0, 7)))).toEqual([
      { type: "metadata", codec: "h264", width: 1080, height: 2340, metricsEpoch: 1 },
    ]);
    expect(parser.feed(frame.slice(7))).toEqual([
      {
        type: "frame",
        codec: "h264",
        width: 1080,
        height: 2340,
        metricsEpoch: 1,
        presentationTimestampUs: 1234n,
        config: true,
        keyFrame: true,
        data: new Uint8Array([1, 2, 3]),
      },
    ]);
  });

  it("rejects non-H264 metadata and oversized packets", () => {
    const parser = new ScrcpyVideoParser({ maxPacketBytes: 4 });
    expect(() => parser.feed(join(u32(0x68323635), u32(1), u32(1)))).toThrow(
      "Unsupported scrcpy video codec",
    );

    const valid = new ScrcpyVideoParser({ maxPacketBytes: 4 });
    valid.feed(join(u32(0x68323634), u32(1), u32(1)));
    expect(() => valid.feed(join(u64(0n), u32(5)))).toThrow("exceeds the configured limit");
  });

  it("detects a truncated header or payload at stream end", () => {
    const parser = new ScrcpyVideoParser();
    parser.feed(join(u32(0x68323634), u32(10), u32(20), u64(0n)));
    expect(() => parser.finish()).toThrow("ended with an incomplete packet");
  });
});
