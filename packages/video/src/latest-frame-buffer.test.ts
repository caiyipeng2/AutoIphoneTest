import { describe, expect, it } from "vitest";

import { LatestFrameBuffer, type EncodedFrame } from "./latest-frame-buffer.js";

function frame(frameId: number): EncodedFrame {
  return {
    schemaVersion: 1,
    frameId,
    serial: "serial-a",
    capturedAtMonotonicMs: frameId,
    metricsEpoch: 1,
    width: 2,
    height: 2,
    format: "jpeg",
    data: new Uint8Array([frameId]),
    degraded: true,
    provider: "screenshot",
  };
}

describe("LatestFrameBuffer", () => {
  it("keeps at most two frames and drops superseded frames on read", () => {
    const buffer = new LatestFrameBuffer({ maxFrames: 2 });

    buffer.publish(frame(1));
    buffer.publish(frame(2));
    buffer.publish(frame(3));

    expect(buffer.size).toBe(2);
    expect(buffer.peek()?.frameId).toBe(3);
    expect(buffer.drain()).toHaveLength(1);
    expect(buffer.drain()).toEqual([]);
    expect(buffer.droppedFrameCount).toBe(1);
  });

  it("rejects non-monotonic frame ids", () => {
    const buffer = new LatestFrameBuffer();
    buffer.publish(frame(2));

    expect(() => buffer.publish(frame(2))).toThrow("monotonically");
    expect(() => buffer.publish(frame(1))).toThrow("monotonically");
  });
});
