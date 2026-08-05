import { describe, expect, it } from "vitest";

import {
  createReadinessRecord,
  decodeLauncherFrame,
  encodeLauncherFrame,
  readLauncherInit,
  verifyReadinessRecord,
} from "./launcher-ipc.js";

describe("launcher IPC framing", () => {
  it("round-trips one bounded length-prefixed init message", () => {
    const message = {
      version: 1 as const,
      launchSecret: "secret",
      bootstrapCode: "code",
      requestedPort: 4780,
    };
    const frame = encodeLauncherFrame(message);
    expect(decodeLauncherFrame(frame)).toEqual(message);
  });

  it("rejects trailing bytes and oversized frames", () => {
    const frame = encodeLauncherFrame({
      version: 1,
      launchSecret: "secret",
      bootstrapCode: "code",
    });
    expect(() => decodeLauncherFrame(Buffer.concat([frame, Buffer.from("extra")]))).toThrow(
      /trailing/,
    );
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(65_537);
    expect(() => decodeLauncherFrame(oversized)).toThrow(/maximum/);
  });

  it("reads one stdin frame and authenticates the readiness record", async () => {
    const message = { version: 1 as const, launchSecret: "secret", bootstrapCode: "code" };
    const frame = encodeLauncherFrame(message);
    expect(
      await readLauncherInit(
        (async function* () {
          yield frame.subarray(0, 3);
          yield frame.subarray(3);
        })(),
      ),
    ).toEqual(message);
    const record = createReadinessRecord("secret", 4780, 1234, "0123456789abcdef");
    expect(verifyReadinessRecord(record, "secret")).toBe(true);
    expect(verifyReadinessRecord(record, "wrong-secret")).toBe(false);
  });
});
