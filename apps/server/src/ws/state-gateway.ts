import type { FastifyInstance, FastifyRequest } from "fastify";

import type { HealthSnapshot } from "@test-center/contracts/health";
import { assertAllowedHost, assertSameOrigin } from "@test-center/security/request-policy";

import { requireSession } from "../routes/bootstrap.js";
import type { ServerContext } from "../routes/context.js";

interface SocketLike {
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  on?(event: "close", listener: () => void): void;
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
      socket.send(
        JSON.stringify({
          type: "snapshot",
          eventSeq: context.devices?.eventSeq ?? 0,
          snapshot,
          devices: context.devices?.list() ?? [],
          deployments: context.deployments?.list() ?? [],
        }),
      );
      if (context.devices !== undefined) {
        const unsubscribe = context.devices.subscribe((event) =>
          socket.send(JSON.stringify(event)),
        );
        socket.on?.("close", unsubscribe);
      }
      if (context.deployments?.subscribe !== undefined) {
        const unsubscribe = context.deployments.subscribe((deployment) =>
          socket.send(JSON.stringify({ type: "deployment.updated", deployment })),
        );
        socket.on?.("close", unsubscribe);
      }
    } catch {
      socket.close(1008, "Unauthorized");
    }
  });
}
