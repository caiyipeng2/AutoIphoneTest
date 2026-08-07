import { z } from "zod";

export const BridgeHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export type BridgeHash = z.infer<typeof BridgeHashSchema>;

const DecimalStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const BridgeInstanceIdSchema = z.string().min(1).max(128);
const BuildIdSchema = z.string().min(1).max(256);
const SafeAreaSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().positive(),
  z.number().positive(),
]);
const MetricsEpochSchema = z.number().int().nonnegative().safe();

export const BridgeDescriptorSchema = z
  .object({
    actionType: z.string().min(1).max(64),
    normalizedShape: z.unknown(),
    expectedView: z.string().min(1).max(256),
    expectedFocus: z.string().max(256).nullable(),
    metricsEpoch: MetricsEpochSchema,
  })
  .strict();
export type BridgeDescriptor = z.infer<typeof BridgeDescriptorSchema>;

export const QaHelloSchema = z
  .object({
    type: z.literal("QA_HELLO"),
    schemaVersion: z.literal(1),
    bridgeInstanceId: BridgeInstanceIdSchema,
    bootId: z.string().min(1).max(256),
    buildId: BuildIdSchema,
  })
  .strict();

export const QaStateSchema = z
  .object({
    type: z.literal("QA_STATE"),
    schemaVersion: z.literal(1),
    bridgeInstanceId: BridgeInstanceIdSchema,
    uid: z.string().min(1).max(256).nullable(),
    installGeneration: z.number().int().positive().safe(),
    appDataGeneration: z.number().int().positive().safe(),
    buildId: BuildIdSchema,
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
    safeArea: SafeAreaSchema,
    orientation: z.enum(["Portrait", "Landscape", "Unknown"]),
    metricsEpoch: MetricsEpochSchema,
    view: z.string().min(1).max(256),
    focusedControlId: z.string().max(256).nullable().optional(),
    textInputAvailable: z.boolean(),
    stateSeq: z.number().int().positive().safe(),
  })
  .strict();

export const QaArmedSchema = z
  .object({
    type: z.literal("QA_ARMED"),
    schemaVersion: z.literal(1),
    bridgeInstanceId: BridgeInstanceIdSchema,
    runNonceHash: BridgeHashSchema,
    actionId: z.string().min(1).max(128),
    descriptorHash: BridgeHashSchema,
    expectedEventShapeHash: BridgeHashSchema,
    expectedView: z.string().min(1).max(256),
    expectedFocus: z.string().max(256).nullable(),
    metricsEpoch: MetricsEpochSchema,
    expiresAtRealtimeMs: DecimalStringSchema,
  })
  .strict();

export const QaAckSchema = z
  .object({
    type: z.literal("QA_ACK"),
    schemaVersion: z.literal(1),
    bridgeInstanceId: BridgeInstanceIdSchema,
    actionId: z.string().min(1).max(128),
    observedAtRealtimeNs: DecimalStringSchema,
    descriptorHash: BridgeHashSchema,
    eventShapeHash: BridgeHashSchema,
    view: z.string().min(1).max(256),
    focusedControlId: z.string().max(256).nullable().optional(),
    metricsEpoch: MetricsEpochSchema,
    stateSeq: z.number().int().positive().safe(),
  })
  .strict();

export const QaRejectedSchema = z
  .object({
    type: z.literal("QA_REJECTED"),
    schemaVersion: z.literal(1),
    bridgeInstanceId: BridgeInstanceIdSchema,
    actionId: z.string().min(1).max(128).optional(),
    code: z.string().min(1).max(64),
    reason: z.string().min(1).max(256),
  })
  .strict();

export const QaPongSchema = z
  .object({
    type: z.literal("QA_PONG"),
    schemaVersion: z.literal(1),
    bridgeInstanceId: BridgeInstanceIdSchema,
    pingId: z.string().min(1).max(128),
    observedAtRealtimeNs: DecimalStringSchema,
  })
  .strict();

export const QaErrorSchema = z
  .object({
    type: z.literal("QA_ERROR"),
    schemaVersion: z.literal(1),
    bridgeInstanceId: BridgeInstanceIdSchema,
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  })
  .strict();

export const BridgeMessageSchema = z.discriminatedUnion("type", [
  QaHelloSchema,
  QaStateSchema,
  QaArmedSchema,
  QaAckSchema,
  QaRejectedSchema,
  QaPongSchema,
  QaErrorSchema,
]);
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
