import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  LauncherInitSchema,
  ReadinessRecordSchema,
  type LauncherInit,
  type ReadinessRecord,
} from "@test-center/contracts/launcher-ipc";

export const MAX_LAUNCHER_FRAME_BYTES = 64 * 1024;

export function encodeLauncherFrame(message: LauncherInit): Buffer {
  const payload = Buffer.from(JSON.stringify(LauncherInitSchema.parse(message)), "utf8");
  if (payload.byteLength > MAX_LAUNCHER_FRAME_BYTES) {
    throw new RangeError("Launcher frame exceeds the maximum size.");
  }
  const frame = Buffer.allocUnsafe(4 + payload.byteLength);
  frame.writeUInt32BE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}

export function decodeLauncherFrame(frame: Buffer): LauncherInit {
  if (frame.byteLength < 4) {
    throw new TypeError("Launcher frame is truncated.");
  }
  const payloadLength = frame.readUInt32BE(0);
  if (payloadLength > MAX_LAUNCHER_FRAME_BYTES) {
    throw new RangeError("Launcher frame exceeds the maximum size.");
  }
  if (frame.byteLength < 4 + payloadLength) {
    throw new TypeError("Launcher frame is truncated.");
  }
  if (frame.byteLength !== 4 + payloadLength) {
    throw new TypeError("Launcher frame contains trailing bytes.");
  }
  return LauncherInitSchema.parse(JSON.parse(frame.subarray(4).toString("utf8")));
}

export async function readLauncherInit(input: AsyncIterable<unknown>): Promise<LauncherInit> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    byteLength += buffer.byteLength;
    if (byteLength > 4 + MAX_LAUNCHER_FRAME_BYTES) {
      throw new RangeError("Launcher frame exceeds the maximum size.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new TypeError("Launcher initialization is missing.");
  }
  return decodeLauncherFrame(Buffer.concat(chunks, byteLength));
}

export function createReadinessRecord(
  launchSecret: string,
  port: number,
  pid: number,
  nonce = randomBytes(16).toString("hex"),
): ReadinessRecord {
  const unsigned = { version: 1 as const, port, pid, nonce };
  const payload = JSON.stringify(unsigned);
  return ReadinessRecordSchema.parse({
    ...unsigned,
    hmac: createHmac("sha256", launchSecret).update(payload, "utf8").digest("base64url"),
  });
}

export function verifyReadinessRecord(record: ReadinessRecord, launchSecret: string): boolean {
  const parsed = ReadinessRecordSchema.safeParse(record);
  if (!parsed.success) {
    return false;
  }
  const { hmac, ...unsigned } = parsed.data;
  const expected = createHmac("sha256", launchSecret)
    .update(JSON.stringify(unsigned), "utf8")
    .digest("base64url");
  const actualBytes = Buffer.from(hmac, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
