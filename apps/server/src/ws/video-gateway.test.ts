import { describe, expect, it } from "vitest";

import { encodeVideoFrame } from "./video-gateway.js";

describe("video gateway frame encoding", () => {
  it("encodes bounded frame metadata and payload without exposing mutable buffers", () => {
    const frame = {
      schemaVersion: 1 as const,
      frameId: 7,
      serial: "serial-a",
      capturedAtMonotonicMs: 1234,
      metricsEpoch: 2,
      width: 1080,
      height: 2340,
      format: "jpeg" as const,
      data: new Uint8Array([1, 2, 3]),
      degraded: true,
      provider: "screenshot" as const,
      degradedReason: "PRIMARY_PROVIDER_UNAVAILABLE" as const,
    };

    const encoded = encodeVideoFrame(frame);

    expect(encoded).toEqual({
      type: "video.frame",
      frame: {
        schemaVersion: 1,
        frameId: 7,
        serial: "serial-a",
        capturedAtMonotonicMs: 1234,
        metricsEpoch: 2,
        width: 1080,
        height: 2340,
        format: "jpeg",
        degraded: true,
        provider: "screenshot",
        degradedReason: "PRIMARY_PROVIDER_UNAVAILABLE",
        dataBase64: "AQID",
      },
    });
    frame.data[0] = 9;
    expect(encoded.frame.dataBase64).toBe("AQID");
  });
});
