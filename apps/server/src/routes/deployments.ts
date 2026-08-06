import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { parseDeviceSerial } from "@test-center/contracts/device";
import type { DeploymentCreateInput, DeploymentView } from "@test-center/deployments";
import {
  assertAllowedHost,
  assertSameOrigin,
  assertValidCsrf,
} from "@test-center/security/request-policy";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

const ConfirmationSchema = z
  .object({
    artifactId: z.string().min(1).max(200),
    deviceSerial: z.string().min(1).max(128),
    operationKind: z.enum(["CLEAR_DATA", "UNINSTALL_REINSTALL"]),
  })
  .strict();

const CreateSchema = z
  .object({
    clientRequestId: z.string().min(1).max(128),
    artifactId: z.string().min(1).max(200),
    deviceSerial: z.string().min(1).max(128),
    mutation: z.enum(["NONE", "CLEAR_DATA", "UNINSTALL_REINSTALL"]).default("NONE"),
    confirmationNonce: z.string().min(1).max(256).optional(),
  })
  .strict();

export interface DeploymentRouteService {
  list(): readonly DeploymentView[];
  get(id: string): DeploymentView;
  issueConfirmation(input: {
    readonly sessionId: string;
    readonly artifactId: string;
    readonly deviceSerial: ReturnType<typeof parseDeviceSerial>;
    readonly operationKind: "CLEAR_DATA" | "UNINSTALL_REINSTALL";
  }): { readonly nonce: string; readonly expiresAt: string };
  create(input: DeploymentCreateInput): Promise<DeploymentView>;
  run(id: string): Promise<DeploymentView>;
  cancel(id: string): Promise<DeploymentView>;
  retry(id: string): Promise<DeploymentView>;
  subscribe?(listener: (deployment: DeploymentView) => void): () => void;
}

export async function registerDeploymentsRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/deployments", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.deployments === undefined)
      return await reply.code(503).send({ error: "Deployment service unavailable." });
    return { schemaVersion: 1, deployments: context.deployments.list() };
  });

  app.get<{ Params: { id: string } }>("/api/deployments/:id", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.deployments === undefined)
      return await reply.code(503).send({ error: "Deployment service unavailable." });
    try {
      return { schemaVersion: 1, deployment: context.deployments.get(request.params.id) };
    } catch (error) {
      return await reply.code(deploymentErrorCode(error)).send({ error: errorMessage(error) });
    }
  });

  app.post("/api/deployments/confirmations", async (request, reply) => {
    try {
      const session = assertMutationAllowed(request, context);
      if (context.deployments === undefined)
        return await reply.code(503).send({ error: "Deployment service unavailable." });
      const payload = ConfirmationSchema.parse(request.body);
      const result = context.deployments.issueConfirmation({
        sessionId: session.sessionId,
        artifactId: payload.artifactId,
        deviceSerial: parseDeviceSerial(payload.deviceSerial),
        operationKind: payload.operationKind,
      });
      return { schemaVersion: 1, ...result };
    } catch (error) {
      return await reply.code(deploymentErrorCode(error)).send({ error: errorMessage(error) });
    }
  });

  app.post("/api/deployments", async (request, reply) => {
    try {
      const session = assertMutationAllowed(request, context);
      if (context.deployments === undefined)
        return await reply.code(503).send({ error: "Deployment service unavailable." });
      const payload = CreateSchema.parse(request.body);
      const result = await context.deployments.create({
        clientRequestId: payload.clientRequestId,
        artifactId: payload.artifactId,
        deviceSerial: parseDeviceSerial(payload.deviceSerial),
        mutation: payload.mutation,
        sessionId: session.sessionId,
        ...(payload.confirmationNonce === undefined
          ? {}
          : { confirmationNonce: payload.confirmationNonce }),
      });
      return await reply.code(201).send({ schemaVersion: 1, deployment: result });
    } catch (error) {
      return await reply.code(deploymentErrorCode(error)).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/deployments/:id/start",
    async (request, reply) =>
      await runMutation(request, reply, context, (service, id) => service.run(id)),
  );
  app.post<{ Params: { id: string } }>(
    "/api/deployments/:id/cancel",
    async (request, reply) =>
      await runMutation(request, reply, context, (service, id) => service.cancel(id)),
  );
  app.post<{ Params: { id: string } }>(
    "/api/deployments/:id/retry",
    async (request, reply) =>
      await runMutation(request, reply, context, (service, id) => service.retry(id)),
  );
}

async function runMutation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  context: ServerContext,
  action: (service: DeploymentRouteService, id: string) => Promise<DeploymentView>,
): Promise<unknown> {
  try {
    assertMutationAllowed(request, context);
    if (context.deployments === undefined)
      return await reply.code(503).send({ error: "Deployment service unavailable." });
    return { schemaVersion: 1, deployment: await action(context.deployments, request.params.id) };
  } catch (error) {
    return await reply.code(deploymentErrorCode(error)).send({ error: errorMessage(error) });
  }
}

function assertMutationAllowed(
  request: FastifyRequest,
  context: ServerContext,
): { sessionId: string; csrfToken: string } {
  assertAllowedHost(request.headers.host, context.port);
  assertSameOrigin(request.headers.origin, context.port);
  const session = requireSession(request, context);
  if (session === undefined) throw new Error("Authentication required.");
  const raw = request.headers["x-test-center-csrf"];
  assertValidCsrf(request.cookies.tc_csrf, Array.isArray(raw) ? raw[0] : raw);
  return session;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Deployment request rejected.";
}
function deploymentErrorCode(error: unknown): number {
  const message = errorMessage(error);
  if (/Authentication required/i.test(message)) return 401;
  if (/Host|Origin|CSRF|confirmation|nonce|target/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/active|offline|identity|terminal|cancel|Idempotency/i.test(message)) return 409;
  return 400;
}
