import { win32 } from "node:path";

import { z } from "zod";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const AbsoluteWindowsPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => win32.isAbsolute(value), "Expected an absolute Windows path.");

export const ProbeSeveritySchema = z.enum(["HEALTHY", "DEGRADED", "FATAL"]);

export const ProbeErrorSchema = z
  .object({
    category: z
      .string()
      .trim()
      .min(1)
      .regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().trim().min(1),
    detail: JsonValueSchema.optional(),
  })
  .strict();

const ProbeBaseSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/),
    durationMs: z.number().finite().nonnegative(),
    resolvedPath: AbsoluteWindowsPathSchema.optional(),
    version: z.string().trim().min(1).optional(),
    facts: z.record(z.string(), JsonValueSchema),
    errors: z.array(ProbeErrorSchema),
  })
  .strict();

export const ProbeResultSchema = z.discriminatedUnion("severity", [
  ProbeBaseSchema.extend({ severity: z.literal("HEALTHY") }),
  ProbeBaseSchema.extend({ severity: z.literal("DEGRADED") }),
  ProbeBaseSchema.extend({ severity: z.literal("FATAL") }),
]);

export const EnvironmentDiagnosticSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime({ offset: true }),
    overall: ProbeSeveritySchema,
    probes: z.array(ProbeResultSchema).min(1),
  })
  .strict();

export type ProbeSeverity = z.infer<typeof ProbeSeveritySchema>;
export type ProbeResult = z.infer<typeof ProbeResultSchema>;
export type EnvironmentDiagnostic = z.infer<typeof EnvironmentDiagnosticSchema>;
