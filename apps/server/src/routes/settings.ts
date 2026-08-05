import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { SettingKeySchema } from "@test-center/contracts/settings";
import {
  assertAllowedHost,
  assertSameOrigin,
  assertValidCsrf,
} from "@test-center/security/request-policy";

import type { ServerContext } from "./context.js";
import { requireSession } from "./bootstrap.js";

const SettingsPatchSchema = z.record(z.string(), z.unknown());

export async function registerSettingsRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/settings", async (request, reply) => {
    if (requireSession(request, context) === undefined) {
      return await reply.code(401).send({ error: "Authentication required." });
    }
    return { version: context.settings.version, values: { ...context.settings.values } };
  });

  app.patch("/api/settings", async (request, reply) => {
    try {
      assertAllowedHost(request.headers.host, context.port);
      assertSameOrigin(request.headers.origin, context.port);
      const session = requireSession(request, context);
      if (session === undefined) {
        return await reply.code(401).send({ error: "Authentication required." });
      }
      const rawCsrfHeader = request.headers["x-test-center-csrf"];
      const csrfHeader = Array.isArray(rawCsrfHeader) ? rawCsrfHeader[0] : rawCsrfHeader;
      assertValidCsrf(request.cookies.tc_csrf, csrfHeader);
      const rawExpectedVersion = request.headers["if-match"];
      const expectedVersion = Array.isArray(rawExpectedVersion)
        ? rawExpectedVersion[0]
        : rawExpectedVersion;
      if (
        expectedVersion !== undefined &&
        expectedVersion !== `"${String(context.settings.version)}"`
      ) {
        return await reply.code(409).send({ error: "Settings version conflict." });
      }
      const patch = SettingsPatchSchema.parse(request.body);
      for (const [key, value] of Object.entries(patch)) {
        if (!SettingKeySchema.safeParse(key).success) {
          return await reply.code(400).send({ error: `Unknown setting '${key}'.` });
        }
        validateSettingValue(key, value);
      }
      Object.assign(context.settings.values, patch);
      context.settings.version += 1;
      return { version: context.settings.version, values: { ...context.settings.values } };
    } catch (error) {
      return await reply.code(403).send({
        error: error instanceof Error ? error.message : "Settings request rejected.",
      });
    }
  });
}

function validateSettingValue(key: string, value: unknown): void {
  if (
    key === "retentionDays" &&
    (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 3650)
  ) {
    throw new TypeError("retentionDays must be between 1 and 3650.");
  }
}
