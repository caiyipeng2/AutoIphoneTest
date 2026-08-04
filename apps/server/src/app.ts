import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { HealthSnapshot } from "@test-center/contracts/health";
import { BootstrapSessionStore } from "@test-center/security/bootstrap-session";
import { assertAllowedHost } from "@test-center/security/request-policy";

import { registerBootstrapRoute } from "./routes/bootstrap.js";
import type { ServerContext } from "./routes/context.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerStateGateway } from "./ws/state-gateway.js";

export interface CreateAppOptions {
  readonly port: number;
  readonly bootstrapCode?: string;
  readonly launchSecret?: string;
  readonly bootstrapStore?: BootstrapSessionStore;
  readonly healthSnapshot?: HealthSnapshot;
  readonly consoleDist?: string;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const bootstrapStore = options.bootstrapStore ?? new BootstrapSessionStore();
  if (options.bootstrapCode !== undefined && options.launchSecret !== undefined) {
    bootstrapStore.issue({
      bootstrapCode: options.bootstrapCode,
      launchSecret: options.launchSecret,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  }
  const context: ServerContext = {
    port: options.port,
    bootstrapStore,
    sessions: new Map(),
    settings: {
      version: 1,
      values: {
        retentionDays: 14,
      },
    },
  };
  const snapshot = options.healthSnapshot ?? createDefaultHealthSnapshot();

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  });
  await app.register(websocket);
  const consoleDist = options.consoleDist ?? join(process.cwd(), "apps", "console", "dist");
  if (existsSync(join(consoleDist, "index.html"))) {
    await app.register(fastifyStatic, { root: consoleDist, prefix: "/", wildcard: false });
  }
  app.addHook("onRequest", async (request, reply) => {
    try {
      assertAllowedHost(request.headers.host, options.port);
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "Host rejected." });
    }
  });
  await registerHealthRoute(app, snapshot);
  await registerBootstrapRoute(app, context);
  await registerSettingsRoutes(app, context);
  await registerStateGateway(app, context, snapshot);
  return app;
}

function createDefaultHealthSnapshot(): HealthSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    service: { state: "READY" },
    environment: { overall: "DEGRADED", generatedAt: now },
    updatedAt: now,
  };
}
