import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { DeviceSerialSchema, parseDeviceSerial } from "@test-center/contracts/device";
import {
  assertAllowedHost,
  assertSameOrigin,
  assertValidCsrf,
} from "@test-center/security/request-policy";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

const TagsPatchSchema = z.object({
  tags: z.array(z.string()).max(20),
  group: z.string().optional(),
});

export async function registerDevicesRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/devices", async (request, reply) => {
    if (requireSession(request, context) === undefined) {
      return await reply.code(401).send({ error: "Authentication required." });
    }
    return { schemaVersion: 1, devices: context.devices?.list() ?? [] };
  });

  app.get<{ Params: { serial: string } }>("/api/devices/:serial", async (request, reply) => {
    if (requireSession(request, context) === undefined) {
      return await reply.code(401).send({ error: "Authentication required." });
    }
    const serialResult = DeviceSerialSchema.safeParse(decodeURIComponent(request.params.serial));
    if (!serialResult.success)
      return await reply.code(400).send({ error: "Invalid device serial." });
    const device = context.devices?.get(parseDeviceSerial(serialResult.data));
    if (device === undefined) return await reply.code(404).send({ error: "Device not found." });
    return { schemaVersion: 1, device };
  });

  app.patch<{ Params: { serial: string } }>("/api/devices/:serial/tags", async (request, reply) => {
    try {
      assertAllowedHost(request.headers.host, context.port);
      assertSameOrigin(request.headers.origin, context.port);
      if (requireSession(request, context) === undefined) {
        return await reply.code(401).send({ error: "Authentication required." });
      }
      const csrfHeader = request.headers["x-test-center-csrf"];
      assertValidCsrf(
        request.cookies.tc_csrf,
        Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader,
      );
      if (context.devices === undefined)
        return await reply.code(503).send({ error: "Device registry unavailable." });
      const serialResult = DeviceSerialSchema.safeParse(decodeURIComponent(request.params.serial));
      if (!serialResult.success)
        return await reply.code(400).send({ error: "Invalid device serial." });
      const body = TagsPatchSchema.parse(request.body);
      const device = context.devices.setTags(
        parseDeviceSerial(serialResult.data),
        body.tags,
        body.group === undefined ? undefined : body.group,
      );
      return { schemaVersion: 1, device };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Device tags request rejected.";
      return await reply
        .code(message.startsWith("Unknown device") ? 404 : 400)
        .send({ error: message });
    }
  });
}
