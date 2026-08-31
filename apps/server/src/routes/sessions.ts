import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { AndroidPackageNameSchema } from "@test-center/contracts/artifact";
import {
  parseActionCommand,
  type ActionCommand,
  type ActionPayload,
  type ActionView,
} from "@test-center/sessions";
import {
  DeviceSerialSchema,
  parseDeviceSerial,
  type DeviceSerial,
} from "@test-center/contracts/device";
import {
  assertAllowedHost,
  assertSameOrigin,
  assertValidCsrf,
} from "@test-center/security/request-policy";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

const FailurePolicySchema = z.enum(["PAUSE_ALL", "QUARANTINE_FAILED_DEVICE"]);
const BridgeModeSchema = z.enum(["REQUIRED", "APPIUM_ONLY"]);

const CreateSessionSchema = z
  .object({
    clientRequestId: z.string().trim().min(1).max(128),
    packageName: AndroidPackageNameSchema,
    deviceSerial: DeviceSerialSchema.optional(),
    deviceSerials: z.array(DeviceSerialSchema).min(1).max(4).optional(),
    leaderVideoEnabled: z.boolean().default(true),
    failurePolicy: FailurePolicySchema.default("PAUSE_ALL"),
    bridgeMode: BridgeModeSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.deviceSerial === undefined && value.deviceSerials === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one device is required.",
      });
    }
    if (value.deviceSerial !== undefined && value.deviceSerials !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use deviceSerial or deviceSerials, not both.",
      });
    }
    if (
      value.deviceSerials !== undefined &&
      new Set(value.deviceSerials).size !== value.deviceSerials.length
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Device serials must be unique." });
    }
  })
  .transform((value) => ({
    ...value,
    deviceSerials: value.deviceSerials ?? [value.deviceSerial!],
  }));

const TapActionPayloadSchema = z
  .object({
    kind: z.literal("tap"),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();
const SwipeActionPayloadSchema = z
  .object({
    kind: z.literal("swipe"),
    path: z
      .array(z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]))
      .min(2)
      .max(64),
    durationMs: z.number().int().min(1).max(60_000),
  })
  .strict();
const ActionSubmitSchema = z
  .union([
    z
      .object({
        clientRequestId: z.string().trim().min(1).max(128),
        type: z.literal("tap"),
        payload: TapActionPayloadSchema,
        sourceMetricsEpoch: z.number().int().nonnegative(),
        sourceFrameId: z.string().trim().min(1).max(128).optional(),
      })
      .strict(),
    z
      .object({
        clientRequestId: z.string().trim().min(1).max(128),
        type: z.literal("swipe"),
        payload: SwipeActionPayloadSchema,
        sourceMetricsEpoch: z.number().int().nonnegative(),
        sourceFrameId: z.string().trim().min(1).max(128).optional(),
      })
      .strict(),
    z
      .object({
        clientRequestId: z.string().trim().min(1).max(128),
        type: z.enum(["longPress", "drag", "text", "back", "activate", "terminate", "restart"]),
        command: z.unknown(),
        sourceMetricsEpoch: z.number().int().nonnegative(),
        sourceFrameId: z.string().trim().min(1).max(128).optional(),
      })
      .strict()
      .transform((value) => ({
        ...value,
        command: parseActionCommand(value.command),
      })),
  ])
  .transform((value) => value as SessionActionInput);

const PauseSessionSchema = z
  .object({ reason: z.string().trim().min(1).max(128).default("operator") })
  .strict();
const CompleteSessionSchema = z
  .object({
    state: z.enum(["FINISHED", "FAILED", "INTERRUPTED"]),
    reason: z.string().trim().min(1).max(128).default("operator"),
  })
  .strict();

export interface SessionLeaderView {
  readonly serial: DeviceSerial;
  readonly role: "LEADER";
  readonly membershipState: "ACTIVE" | "QUARANTINED" | "RECOVERING" | "LEFT";
  readonly epoch: number;
  readonly generation: number;
}

export interface SessionDeviceView {
  readonly serial: DeviceSerial;
  readonly role: "LEADER" | "FOLLOWER";
  readonly membershipState: "ACTIVE" | "QUARANTINED" | "RECOVERING" | "LEFT";
  readonly epoch: number;
  readonly generation: number;
}

export interface SessionView {
  readonly id: string;
  readonly clientRequestId: string;
  readonly packageName: string;
  readonly state:
    "CREATED" | "PREFLIGHT" | "RUNNING" | "PAUSED" | "FINISHED" | "INTERRUPTED" | "FAILED";
  readonly currentEpoch: number;
  readonly leaderVideoEnabled: boolean;
  readonly failurePolicy: "PAUSE_ALL" | "QUARANTINE_FAILED_DEVICE";
  readonly bridgeMode: "REQUIRED" | "APPIUM_ONLY";
  readonly leader: SessionLeaderView;
  readonly devices: readonly SessionDeviceView[];
}

export interface SessionCreateInput {
  readonly clientRequestId: string;
  readonly packageName: string;
  readonly deviceSerials?: readonly DeviceSerial[];
  readonly deviceSerial?: DeviceSerial;
  readonly leaderVideoEnabled: boolean;
  readonly failurePolicy?: "PAUSE_ALL" | "QUARANTINE_FAILED_DEVICE";
  readonly bridgeMode?: "REQUIRED" | "APPIUM_ONLY";
  readonly actorSessionId: string;
}

export interface SessionPreflightProbe {
  check(input: { readonly serial: DeviceSerial; readonly packageName: string }): Promise<void>;
}

export interface SessionActionInput {
  readonly clientRequestId: string;
  readonly type: ActionCommand["type"];
  readonly payload?: ActionPayload;
  readonly command?: ActionCommand;
  readonly sourceMetricsEpoch: number;
  readonly sourceFrameId?: string;
}

export interface SessionActionResult {
  readonly state: "CREATED" | "DEDUPLICATED";
  readonly action: ActionView;
}

export interface SessionCompletionInput {
  readonly state: "FINISHED" | "FAILED" | "INTERRUPTED";
  readonly reason: string;
}

export interface SessionRouteService {
  create(
    input: SessionCreateInput,
  ): Promise<{ readonly session: SessionView; readonly state: "CREATED" | "DEDUPLICATED" }>;
  get(id: string): SessionView | undefined;
  preflight(id: string, actorSessionId: string): Promise<SessionView>;
  start(id: string, actorSessionId: string): Promise<SessionView>;
  pause(id: string, reason: string): Promise<SessionView>;
  complete?(id: string, input: SessionCompletionInput): Promise<SessionView>;
  submitAction(
    id: string,
    actorSessionId: string,
    input: SessionActionInput,
  ): Promise<SessionActionResult>;
}

export async function registerSessionsRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.post("/api/sessions", async (request, reply) => {
    try {
      assertMutationAllowed(request, context);
      if (context.sessionService === undefined)
        return await reply.code(503).send({ error: "Session service unavailable." });
      const payload = CreateSessionSchema.parse(request.body);
      const session = requireSession(request, context);
      if (session === undefined)
        return await reply.code(401).send({ error: "Authentication required." });
      const result = await context.sessionService.create({
        clientRequestId: payload.clientRequestId,
        packageName: payload.packageName,
        deviceSerials: payload.deviceSerials.map(parseDeviceSerial),
        leaderVideoEnabled: payload.leaderVideoEnabled,
        failurePolicy: payload.failurePolicy,
        ...(payload.bridgeMode === undefined ? {} : { bridgeMode: payload.bridgeMode }),
        actorSessionId: session.sessionId,
      });
      return await reply
        .code(result.state === "CREATED" ? 201 : 200)
        .send({ schemaVersion: 1, ...result });
    } catch (error) {
      return await reply
        .code(sessionErrorCode(error))
        .send({ error: error instanceof Error ? error.message : "Session creation rejected." });
    }
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.sessionService === undefined)
      return await reply.code(503).send({ error: "Session service unavailable." });
    const session = context.sessionService.get(decodeURIComponent(request.params.id));
    if (session === undefined) return await reply.code(404).send({ error: "Session not found." });
    return { schemaVersion: 1, session };
  });

  for (const phase of ["preflight", "start"] as const) {
    app.post<{ Params: { id: string } }>(`/api/sessions/:id/${phase}`, async (request, reply) => {
      try {
        assertMutationAllowed(request, context);
        if (context.sessionService === undefined)
          return await reply.code(503).send({ error: "Session service unavailable." });
        const auth = requireSession(request, context);
        if (auth === undefined)
          return await reply.code(401).send({ error: "Authentication required." });
        const session = await context.sessionService[phase](
          decodeURIComponent(request.params.id),
          auth.sessionId,
        );
        return { schemaVersion: 1, session };
      } catch (error) {
        return await reply
          .code(sessionErrorCode(error))
          .send({ error: error instanceof Error ? error.message : `${phase} rejected.` });
      }
    });
  }

  app.post<{ Params: { id: string } }>("/api/sessions/:id/pause", async (request, reply) => {
    try {
      assertMutationAllowed(request, context);
      if (context.sessionService === undefined)
        return await reply.code(503).send({ error: "Session service unavailable." });
      if (requireSession(request, context) === undefined)
        return await reply.code(401).send({ error: "Authentication required." });
      const payload = PauseSessionSchema.parse(request.body ?? {});
      const session = await context.sessionService.pause(
        decodeURIComponent(request.params.id),
        payload.reason,
      );
      return { schemaVersion: 1, session };
    } catch (error) {
      return await reply
        .code(sessionErrorCode(error))
        .send({ error: error instanceof Error ? error.message : "Pause rejected." });
    }
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/complete", async (request, reply) => {
    try {
      assertMutationAllowed(request, context);
      if (context.sessionService === undefined)
        return await reply.code(503).send({ error: "Session service unavailable." });
      if (context.sessionService.complete === undefined)
        return await reply.code(503).send({ error: "Session completion unavailable." });
      if (requireSession(request, context) === undefined)
        return await reply.code(401).send({ error: "Authentication required." });
      const payload = CompleteSessionSchema.parse(request.body);
      const session = await context.sessionService.complete(
        decodeURIComponent(request.params.id),
        payload,
      );
      return { schemaVersion: 1, session };
    } catch (error) {
      return await reply
        .code(sessionErrorCode(error))
        .send({ error: error instanceof Error ? error.message : "Completion rejected." });
    }
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/actions", async (request, reply) => {
    try {
      assertMutationAllowed(request, context);
      if (context.sessionService === undefined)
        return await reply.code(503).send({ error: "Session service unavailable." });
      const auth = requireSession(request, context);
      if (auth === undefined)
        return await reply.code(401).send({ error: "Authentication required." });
      const payload = ActionSubmitSchema.parse(request.body);
      const result = await context.sessionService.submitAction(
        decodeURIComponent(request.params.id),
        auth.sessionId,
        payload,
      );
      return await reply
        .code(result.state === "CREATED" ? 201 : 200)
        .send({ schemaVersion: 1, ...result });
    } catch (error) {
      return await reply
        .code(sessionErrorCode(error))
        .send({ error: error instanceof Error ? error.message : "Action rejected." });
    }
  });
}

function assertMutationAllowed(request: FastifyRequest, context: ServerContext): void {
  assertAllowedHost(request.headers.host, context.port);
  assertSameOrigin(request.headers.origin, context.port);
  if (requireSession(request, context) === undefined) throw new Error("Authentication required.");
  const csrfHeader = request.headers["x-test-center-csrf"];
  assertValidCsrf(request.cookies.tc_csrf, Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader);
}

function sessionErrorCode(error: unknown): 400 | 401 | 403 | 404 | 409 | 503 {
  if (error instanceof Error && error.message === "Authentication required.") return 401;
  if (error instanceof Error && error.message.includes("CSRF")) return 403;
  if (error instanceof Error && error.message.includes("already exists")) return 409;
  if (error instanceof Error && error.message.includes("in flight")) return 409;
  if (error instanceof Error && error.message.includes("different payload")) return 409;
  if (error instanceof Error && error.message.includes("RUNNING")) return 409;
  if (error instanceof Error && error.message.includes("state")) return 409;
  if (error instanceof Error && error.message.includes("online")) return 409;
  if (error instanceof Error && error.message.includes("not found")) return 404;
  if (error instanceof Error && error.message.includes("unavailable")) return 503;
  return 400;
}
