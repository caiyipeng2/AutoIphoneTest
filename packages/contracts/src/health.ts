import { z } from "zod";

import { ProbeSeveritySchema } from "./environment.js";

export const HealthSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    service: z.object({ state: z.enum(["STARTING", "READY", "DEGRADED", "STOPPING"]) }).strict(),
    environment: z
      .object({ overall: ProbeSeveritySchema, generatedAt: z.string().datetime({ offset: true }) })
      .strict(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type HealthSnapshot = z.infer<typeof HealthSnapshotSchema>;
