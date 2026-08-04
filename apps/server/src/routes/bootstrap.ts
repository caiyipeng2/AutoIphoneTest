import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertAllowedHost, assertSameOrigin } from "@test-center/security/request-policy";

import type { ServerContext } from "./context.js";

const BootstrapPayloadSchema = z.object({ code: z.string().min(1).max(512) }).strict();

export async function registerBootstrapRoute(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.post("/api/bootstrap/exchange", async (request, reply) => {
    try {
      assertAllowedHost(request.headers.host, context.port);
      assertSameOrigin(request.headers.origin, context.port);
      const payload = BootstrapPayloadSchema.parse(request.body);
      const grant = context.bootstrapStore.consume(payload.code);
      if (grant === undefined) {
        return await reply.code(401).send({ error: "Bootstrap code is invalid or already used." });
      }
      context.sessions.set(grant.sessionId, { csrfToken: grant.csrfToken, createdAt: Date.now() });
      setSessionCookies(reply, grant.sessionId, grant.csrfToken);
      return await reply.code(204).send();
    } catch (error) {
      return await reply.code(403).send({
        error: error instanceof Error ? error.message : "Bootstrap request rejected.",
      });
    }
  });
}

function setSessionCookies(reply: FastifyReply, sessionId: string, csrfToken: string): void {
  reply.setCookie("tc_session", sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
  });
  reply.setCookie("tc_csrf", csrfToken, {
    httpOnly: false,
    sameSite: "strict",
    secure: false,
    path: "/",
  });
}

export function requireSession(
  request: FastifyRequest,
  context: ServerContext,
): { sessionId: string; csrfToken: string } | undefined {
  const sessionId = request.cookies.tc_session;
  if (sessionId === undefined) {
    return undefined;
  }
  const session = context.sessions.get(sessionId);
  return session === undefined ? undefined : { sessionId, csrfToken: session.csrfToken };
}
