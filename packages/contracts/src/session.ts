import { z } from "zod";

import { DeviceSerialSchema } from "./device.js";

export const DeviceSessionStateSchema = z.enum([
  "DISCONNECTED",
  "STARTING",
  "READY",
  "STOPPING",
  "STOPPED",
  "ERROR",
]);
export type DeviceSessionState = z.infer<typeof DeviceSessionStateSchema>;

export const DeviceSessionFenceSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    serial: DeviceSerialSchema,
    generation: z.number().int().positive().safe(),
  })
  .strict();
export type DeviceSessionFence = z.infer<typeof DeviceSessionFenceSchema>;
