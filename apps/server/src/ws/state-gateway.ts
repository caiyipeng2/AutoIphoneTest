import type { FastifyInstance, FastifyRequest } from "fastify";

import type { HealthSnapshot } from "@test-center/contracts/health";
import { assertAllowedHost, assertSameOrigin } from "@test-center/security/request-policy";

import { requireSession } from "../routes/bootstrap.js";
import type { ServerContext } from "../routes/context.js";

interface SocketLike {
  send(payload: string): void;
  close(code?: number, reason?: string): void;
}

export async function registerStateGateway(
  app: FastifyInstance,
  context: ServerContext,
  snapshot: HealthSnapshot,
): Promise<void> {
  app.get("/ws/state", { websocket: true }, (socket: SocketLike, request: FastifyRequest) => {
    try {
      assertAllowedHost(request.headers.host, context.port);
      assertSameOrigin(request.headers.origin, context.port);
      if (requireSession(request, context) === undefined) {
        throw new TypeError("Authentication required.");
      }
      socket.send(JSON.stringify({ type: "snapshot", eventSeq: 0, snapshot }));
    } catch {
      socket.close(1008, "Unauthorized");
    }
  });
}
