import { createHash } from "node:crypto";

import { z } from "zod";

const CoordinateSchema = z.number().finite().min(0).max(1);
const PointSchema = z.tuple([CoordinateSchema, CoordinateSchema]);

const TapSchema = z
  .object({ type: z.literal("tap"), x: CoordinateSchema, y: CoordinateSchema })
  .strict();
const LongPressSchema = z
  .object({
    type: z.literal("longPress"),
    x: CoordinateSchema,
    y: CoordinateSchema,
    durationMs: z
      .number()
      .int()
      .min(300, "Long press duration must be 300-10000 ms.")
      .max(10_000, "Long press duration must be 300-10000 ms."),
  })
  .strict();
const PathSchema = z
  .array(PointSchema)
  .min(2, "Action path must contain 2-128 points.")
  .max(128, "Action path must contain 2-128 points.");
const SwipeSchema = z
  .object({
    type: z.literal("swipe"),
    path: PathSchema,
    durationMs: z.number().int().min(50).max(30_000),
  })
  .strict();
const DragSchema = z
  .object({
    type: z.literal("drag"),
    path: PathSchema,
    durationMs: z.number().int().min(50).max(30_000),
  })
  .strict();
const TextSchema = z
  .object({
    type: z.literal("text"),
    text: z
      .string()
      .refine(
        (value) => Array.from(value).length >= 1,
        "Text action length must be from 1-2000 Unicode scalar values.",
      ),
  })
  .strict()
  .superRefine((value, context) => {
    const length = Array.from(value.text).length;
    if (length > 2_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Text action length must be from 1-2000 Unicode scalar values.",
        path: ["text"],
      });
    }
  });
const ActionCommandSchema = z.discriminatedUnion("type", [
  TapSchema,
  LongPressSchema,
  SwipeSchema,
  DragSchema,
  TextSchema,
  z.object({ type: z.literal("back") }).strict(),
  z.object({ type: z.literal("activate") }).strict(),
  z.object({ type: z.literal("terminate") }).strict(),
  z.object({ type: z.literal("restart") }).strict(),
]);

export type ActionCommand = z.infer<typeof ActionCommandSchema>;

export type ActionCompletion = "BRIDGE_ACK" | "FRESH_BRIDGE_STATE" | "PROCESS_ABSENT";

export interface ActionCompletionPolicy {
  readonly armBridge: boolean;
  readonly completion: ActionCompletion;
}

export type ActionDescriptor =
  | { readonly type: "tap"; readonly x: number; readonly y: number }
  | {
      readonly type: "longPress";
      readonly x: number;
      readonly y: number;
      readonly durationMs: number;
    }
  | {
      readonly type: "swipe" | "drag";
      readonly path: readonly (readonly [number, number])[];
      readonly durationMs: number;
    }
  | { readonly type: "text"; readonly length: number; readonly classHash: string }
  | { readonly type: "back" | "activate" | "terminate" | "restart" };

export function parseActionCommand(value: unknown): ActionCommand {
  const parsed = ActionCommandSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new TypeError(issue?.message ?? "Invalid action command.");
}

export function actionCompletionPolicy(
  command: Pick<ActionCommand, "type">,
): ActionCompletionPolicy {
  switch (command.type) {
    case "activate":
      return { armBridge: false, completion: "FRESH_BRIDGE_STATE" };
    case "terminate":
      return { armBridge: false, completion: "PROCESS_ABSENT" };
    case "restart":
      return { armBridge: false, completion: "FRESH_BRIDGE_STATE" };
    default:
      return { armBridge: true, completion: "BRIDGE_ACK" };
  }
}

export function actionDescriptor(command: ActionCommand): ActionDescriptor {
  if (command.type === "text") {
    return {
      type: "text",
      length: Array.from(command.text).length,
      classHash: `sha256:${createHash("sha256").update(textClassSignature(command.text), "utf8").digest("hex")}`,
    };
  }
  if (command.type === "tap") return { type: command.type, x: command.x, y: command.y };
  if (command.type === "longPress") {
    return { type: command.type, x: command.x, y: command.y, durationMs: command.durationMs };
  }
  if (command.type === "swipe" || command.type === "drag") {
    return { type: command.type, path: command.path, durationMs: command.durationMs };
  }
  return { type: command.type };
}

function textClassSignature(text: string): string {
  return Array.from(text)
    .map((character) => {
      if (/\p{L}/u.test(character)) return "L";
      if (/\p{N}/u.test(character)) return "N";
      if (/\s/u.test(character)) return "S";
      if (/\p{P}|\p{S}/u.test(character)) return "P";
      return "O";
    })
    .join("");
}
