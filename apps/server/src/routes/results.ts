import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { DeviceSerialSchema } from "@test-center/contracts/device";
import type { ReportHistoryFilter, ReportHistoryItem } from "@test-center/reports";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

const ResultsQuerySchema = z
  .object({
    state: z.enum(["FINISHED", "FAILED", "INTERRUPTED"]).optional(),
    serial: DeviceSerialSchema.optional(),
    uid: z.string().trim().min(1).max(256).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export interface ResultsRouteService {
  list(filter: ReportHistoryFilter): readonly ReportHistoryItem[];
  get(runId: string): ReportHistoryItem | undefined;
}

export async function registerResultsRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get<{ Querystring: Record<string, unknown> }>("/api/results", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.resultsService === undefined)
      return await reply.code(503).send({ error: "Results service unavailable." });
    try {
      const filter = ResultsQuerySchema.parse(request.query) as ReportHistoryFilter;
      return { schemaVersion: 1, results: context.resultsService.list(filter) };
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "Results query rejected." });
    }
  });

  app.get<{ Params: { id: string } }>("/api/results/:id", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.resultsService === undefined)
      return await reply.code(503).send({ error: "Results service unavailable." });
    const result = context.resultsService.get(decodeURIComponent(request.params.id));
    if (result === undefined) return await reply.code(404).send({ error: "Result not found." });
    return { schemaVersion: 1, result };
  });
}
