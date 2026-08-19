import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { CleanupAuditEvent, CleanupExecutionResult } from "@test-center/evidence";
import {
  assertAllowedHost,
  assertSameOrigin,
  assertValidCsrf,
} from "@test-center/security/request-policy";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

const SafeSegmentSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => value !== "." && value !== "..");
const CleanupTargetSchema = z
  .object({
    runIds: z.array(SafeSegmentSchema).min(1).max(1_000),
    expectedBytes: z.number().int().nonnegative(),
  })
  .strict();
const CleanupExecuteSchema = CleanupTargetSchema.extend({
  cleanupId: SafeSegmentSchema,
  nonce: z.string().min(1).max(512),
}).strict();

export interface CleanupRouteTarget {
  readonly runIds: readonly string[];
  readonly expectedBytes: number;
}

export interface CleanupRouteExecuteInput extends CleanupRouteTarget {
  readonly cleanupId: string;
  readonly nonce: string;
}

export interface CleanupRouteService {
  issueConfirmation(target: CleanupRouteTarget): { nonce: string; expiresAt: string };
  execute(input: CleanupRouteExecuteInput): Promise<CleanupExecutionResult>;
  listEvents(cleanupId: string): readonly CleanupAuditEvent[];
}

export async function registerCleanupRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.post("/api/cleanup/confirmations", async (request, reply) => {
    try {
      assertMutationAllowed(request, context);
      if (context.cleanupService === undefined)
        return await reply.code(503).send({ error: "Cleanup service unavailable." });
      const target = CleanupTargetSchema.parse(request.body) as CleanupRouteTarget;
      const confirmation = context.cleanupService.issueConfirmation(target);
      return { schemaVersion: 1, confirmation };
    } catch (error) {
      return await reply.code(cleanupErrorCode(error)).send({ error: errorMessage(error) });
    }
  });

  app.post("/api/cleanup/execute", async (request, reply) => {
    try {
      assertMutationAllowed(request, context);
      if (context.cleanupService === undefined)
        return await reply.code(503).send({ error: "Cleanup service unavailable." });
      const input = CleanupExecuteSchema.parse(request.body) as CleanupRouteExecuteInput;
      const result = await context.cleanupService.execute(input);
      return { schemaVersion: 1, result };
    } catch (error) {
      return await reply.code(cleanupErrorCode(error)).send({ error: errorMessage(error) });
    }
  });

  app.get<{ Params: { id: string } }>("/api/cleanup/:id/events", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.cleanupService === undefined)
      return await reply.code(503).send({ error: "Cleanup service unavailable." });
    const cleanupId = SafeSegmentSchema.safeParse(decodePathSegment(request.params.id));
    if (!cleanupId.success) return await reply.code(400).send({ error: "Cleanup ID is invalid." });
    return {
      schemaVersion: 1,
      cleanupId: cleanupId.data,
      events: context.cleanupService.listEvents(cleanupId.data),
    };
  });
}

function assertMutationAllowed(request: FastifyRequest, context: ServerContext): void {
  assertAllowedHost(request.headers.host, context.port);
  assertSameOrigin(request.headers.origin, context.port);
  if (requireSession(request, context) === undefined) throw new Error("Authentication required.");
  const csrfHeader = request.headers["x-test-center-csrf"];
  assertValidCsrf(request.cookies.tc_csrf, Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader);
}

function cleanupErrorCode(error: unknown): 400 | 401 | 403 | 409 | 503 {
  if (error instanceof z.ZodError) return 400;
  const message = errorMessage(error);
  if (/Authentication required/i.test(message)) return 401;
  if (/Host|Origin|CSRF/i.test(message)) return 403;
  if (/unavailable/i.test(message)) return 503;
  if (/confirmation|nonce|cleanup state|DELETING|already reused/i.test(message)) return 409;
  return 400;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Cleanup request rejected.";
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
