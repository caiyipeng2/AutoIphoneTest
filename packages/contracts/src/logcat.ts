import { z } from "zod";

import { DeviceSerialSchema } from "./device.js";

export const LogcatLevelSchema = z.enum(["V", "D", "I", "W", "E", "F", "UNKNOWN"]);
export type LogcatLevel = z.infer<typeof LogcatLevelSchema>;

export const LogcatParsedLineSchema = z
  .object({
    monthDay: z.string().regex(/^\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}:\d{2}\.\d{3}$/),
    pid: z.number().int().nonnegative().safe(),
    tid: z.number().int().nonnegative().safe(),
    level: LogcatLevelSchema,
    tag: z.string().min(1).max(128),
    message: z.string().max(16_384),
  })
  .strict();

export const LogcatRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    serial: DeviceSerialSchema,
    receivedAtMonotonicMs: z.number().finite().nonnegative(),
    rawLine: z.string().max(16_384),
    truncated: z.boolean(),
    parsed: LogcatParsedLineSchema.nullable(),
  })
  .strict();
export type LogcatRecord = z.infer<typeof LogcatRecordSchema>;

export const LogcatSegmentClosedSchema = z
  .object({
    schemaVersion: z.literal(1),
    serial: DeviceSerialSchema,
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().nonnegative().safe(),
    recordCount: z.number().int().nonnegative().safe(),
    startedAtMonotonicMs: z.number().finite().nonnegative(),
    endedAtMonotonicMs: z.number().finite().nonnegative(),
    recovered: z.boolean(),
  })
  .strict();
export type LogcatSegmentClosed = z.infer<typeof LogcatSegmentClosedSchema>;
