import type { FastifyInstance } from "fastify";

import type { Incident } from "@test-center/contracts/incident";
import type { RecoveryAttempt } from "@test-center/sessions";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

export interface IncidentTimeline {
  readonly runId: string;
  readonly incidents: readonly Incident[];
  readonly recoveries: readonly RecoveryAttempt[];
}

export interface IncidentRouteService {
  getTimeline(runId: string): IncidentTimeline | undefined;
}

export async function registerIncidentRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/sessions/:id/incidents", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.incidentService === undefined)
      return await reply.code(503).send({ error: "Incident service unavailable." });
    const timeline = context.incidentService.getTimeline(decodeURIComponent(request.params.id));
    if (timeline === undefined) return await reply.code(404).send({ error: "Session not found." });
    return { schemaVersion: 1, timeline };
  });
}
