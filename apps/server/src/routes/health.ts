import type { FastifyInstance } from "fastify";

import type { HealthSnapshot } from "@test-center/contracts/health";

export async function registerHealthRoute(
  app: FastifyInstance,
  snapshot: HealthSnapshot,
): Promise<void> {
  app.get("/api/health", async () => snapshot);
}
