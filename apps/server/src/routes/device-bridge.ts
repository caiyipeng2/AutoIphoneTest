import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { DeviceSerialSchema, parseDeviceSerial } from "@test-center/contracts/device";
import {
  assertAllowedHost,
  assertSameOrigin,
  assertValidCsrf,
} from "@test-center/security/request-policy";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

const PackageQuerySchema = z.object({ packageName: z.string().min(1).max(256) }).strict();
const ManualUidConfirmationSchema = z.object({ packageName: z.string().min(1).max(256) }).strict();
const ManualUidSchema = z
  .object({
    packageName: z.string().min(1).max(256),
    uid: z.string().min(1).max(256),
    confirmationNonce: z.string().min(1).max(256),
  })
  .strict();

export async function registerDeviceBridgeRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get<{ Params: { serial: string }; Querystring: { packageName?: string } }>(
    "/api/devices/:serial/bridge",
    async (request, reply) => {
      const session = requireSession(request, context);
      if (session === undefined)
        return await reply.code(401).send({ error: "Authentication required." });
      if (context.uids === undefined)
        return await reply.code(503).send({ error: "UID and bridge service unavailable." });
      const serial = parseSerial(request.params.serial, reply);
      if (serial === undefined) return;
      const query = PackageQuerySchema.safeParse(request.query);
      if (!query.success) return await reply.code(400).send({ error: "packageName is required." });
      try {
        return { schemaVersion: 1, ...context.uids.get(serial, query.data.packageName) };
      } catch (error) {
        return await reply.code(404).send({ error: errorMessage(error) });
      }
    },
  );

  app.post<{ Params: { serial: string } }>(
    "/api/devices/:serial/uid/confirmations",
    async (request, reply) => {
      try {
        const session = assertMutationAllowed(request, context);
        if (context.uids === undefined)
          return await reply.code(503).send({ error: "UID and bridge service unavailable." });
        const serial = parseSerial(request.params.serial, reply);
        if (serial === undefined) return;
        const payload = ManualUidConfirmationSchema.parse(request.body);
        return {
          schemaVersion: 1,
          ...context.uids.issueManualUidConfirmation({
            sessionId: session.sessionId,
            serial,
            packageName: payload.packageName,
          }),
        };
      } catch (error) {
        return await reply.code(errorCode(error)).send({ error: errorMessage(error) });
      }
    },
  );

  app.patch<{ Params: { serial: string } }>("/api/devices/:serial/uid", async (request, reply) => {
    try {
      const session = assertMutationAllowed(request, context);
      if (context.uids === undefined)
        return await reply.code(503).send({ error: "UID and bridge service unavailable." });
      const serial = parseSerial(request.params.serial, reply);
      if (serial === undefined) return;
      const payload = ManualUidSchema.parse(request.body);
      return {
        schemaVersion: 1,
        ...context.uids.setManualUid({
          sessionId: session.sessionId,
          serial,
          packageName: payload.packageName,
          uid: payload.uid,
          confirmationNonce: payload.confirmationNonce,
        }),
      };
    } catch (error) {
      return await reply.code(errorCode(error)).send({ error: errorMessage(error) });
    }
  });
}

function parseSerial(
  value: string,
  reply: FastifyReply,
): ReturnType<typeof parseDeviceSerial> | undefined {
  const result = DeviceSerialSchema.safeParse(decodeURIComponent(value));
  if (result.success) return parseDeviceSerial(result.data);
  void reply.code(400).send({ error: "Invalid device serial." });
  return undefined;
}

function assertMutationAllowed(request: FastifyRequest, context: ServerContext) {
  assertAllowedHost(request.headers.host, context.port);
  assertSameOrigin(request.headers.origin, context.port);
  const session = requireSession(request, context);
  if (session === undefined) throw new Error("Authentication required.");
  const csrfHeader = request.headers["x-test-center-csrf"];
  assertValidCsrf(request.cookies.tc_csrf, Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader);
  return session;
}

function errorCode(error: unknown): number {
  const message = errorMessage(error);
  if (message.includes("Authentication required")) return 401;
  if (message.includes("confirmation") || message.includes("CSRF")) return 403;
  if (message.includes("Unknown installation")) return 404;
  return 400;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Device bridge request rejected.";
}
