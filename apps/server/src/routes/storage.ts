import type { FastifyInstance } from "fastify";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

export type StorageOverviewPressure = "NORMAL" | "WARNING" | "BLOCKED";

export interface StorageOverviewSnapshot {
  readonly measuredAt: string;
  readonly pressure: StorageOverviewPressure;
  readonly freeBytes?: number;
  readonly warningBytes: number;
  readonly dangerBytes: number;
  readonly writeRateBytesPerSecond: number;
  readonly estimatedSecondsUntilBlocked?: number;
  readonly activeRunCount: number;
  readonly sourceError?: "FREE_SPACE_UNAVAILABLE";
}

export interface StorageOverviewRouteService {
  getOverview(): Promise<StorageOverviewSnapshot>;
}

export async function registerStorageRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/storage/overview", async (_request, reply) => {
    if (requireSession(_request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.storageService === undefined)
      return await reply.code(503).send({ error: "Storage overview service unavailable." });
    try {
      return { schemaVersion: 1, overview: await context.storageService.getOverview() };
    } catch {
      return await reply.code(503).send({ error: "Storage overview unavailable." });
    }
  });
}
