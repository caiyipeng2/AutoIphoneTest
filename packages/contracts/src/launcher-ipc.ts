import { z } from "zod";

export const LauncherInitSchema = z
  .object({
    version: z.literal(1),
    launchSecret: z.string().min(1).max(512),
    bootstrapCode: z.string().min(1).max(512),
    requestedPort: z.number().int().min(0).max(65535).optional(),
  })
  .strict();

export const ReadinessRecordSchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(1).max(65535),
    pid: z.number().int().positive(),
    nonce: z.string().min(16).max(256),
    hmac: z.string().min(32).max(512),
  })
  .strict();

export type LauncherInit = z.infer<typeof LauncherInitSchema>;
export type ReadinessRecord = z.infer<typeof ReadinessRecordSchema>;
