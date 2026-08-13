import { randomUUID } from "node:crypto";

import type { ActionCommand } from "./action-command.js";
import { actionCompletionPolicy } from "./action-command.js";
import type { ActionBarrierFactory } from "./action-barrier.js";
import type { ActionPayload, ActionView, RunActionRepository } from "./run-repository.js";
import type { ActionOutbox } from "./action-outbox.js";
import type { TextFocusBarrier, TextFocusVerificationInput } from "./text-focus-barrier.js";

export interface ActionDeviceExecutor {
  execute(input: {
    readonly runId?: string;
    readonly actionId?: string;
    readonly serial: string;
    readonly packageName: string;
    readonly payload?: ActionPayload;
    readonly command?: ActionCommand;
  }): Promise<unknown>;
}

export interface ActionDispatchInput {
  readonly actionId: string;
  readonly packageName: string;
}

export type ActionDeviceExecutorFactory = (serial: string) => ActionDeviceExecutor;

export class ActionDispatcher {
  public constructor(
    private readonly repository: RunActionRepository,
    private readonly outbox: ActionOutbox,
    private readonly executorFactory: ActionDeviceExecutorFactory,
    private readonly ownerToken = `dispatcher-${randomUUID()}`,
    private readonly barrierFactory?: ActionBarrierFactory,
    private readonly textFocusBarrier?: Pick<TextFocusBarrier, "verify">,
  ) {}

  public async dispatch(input: ActionDispatchInput): Promise<ActionView> {
    const queued = this.repository.get(input.actionId);
    if (queued === undefined) throw new Error("Action not found.");
    if (queued.state !== "QUEUED") throw new Error("Action is not queued.");

    const lease = this.outbox.leaseAction(input.actionId, this.ownerToken);
    if (lease === undefined) throw new Error("Action is not available for dispatch.");
    this.outbox.markDispatching(input.actionId, lease.leaseToken);

    const command = queued.command;
    if (command?.type === "text" && this.textFocusBarrier !== undefined) {
      const verification: TextFocusVerificationInput = {
        serials: queued.targets.map((target) => target.serial),
        metricsEpoch: queued.sourceMetricsEpoch,
        runId: queued.runId,
      };
      try {
        await this.textFocusBarrier.verify(verification);
      } catch (error) {
        await Promise.all(
          queued.targets.map(async (target) =>
            this.outbox.completeTarget(
              input.actionId,
              lease.leaseToken,
              target.serial,
              "FAILED",
              JSON.stringify({ ok: false, error: serializeError(error) }),
            ),
          ),
        );
        const rejected = this.repository.get(input.actionId);
        if (rejected === undefined) {
          throw new Error("Rejected action could not be read back.", { cause: error });
        }
        return rejected;
      }
    }

    await Promise.all(
      queued.targets.map(async (target) => {
        try {
          const command = queued.command;
          const barrier =
            command !== undefined &&
            actionCompletionPolicy(command).armBridge &&
            this.barrierFactory !== undefined
              ? await this.barrierFactory(target.serial, queued.runId).arm({
                  actionId: queued.id,
                  runId: queued.runId,
                  serial: target.serial,
                  command,
                  metricsEpoch: queued.sourceMetricsEpoch,
                  ...(queued.sourceFrameId === undefined
                    ? {}
                    : { sourceFrameId: queued.sourceFrameId }),
                })
              : undefined;
          const executorInput = {
            runId: queued.runId,
            actionId: queued.id,
            serial: target.serial,
            packageName: input.packageName,
            ...(queued.command === undefined ? {} : { command: queued.command }),
            ...(queued.payload === undefined ? {} : { payload: queued.payload }),
          };
          try {
            const result = await this.executorFactory(target.serial).execute(executorInput);
            if (barrier !== undefined) await barrier.waitForAck();
            this.outbox.completeTarget(
              input.actionId,
              lease.leaseToken,
              target.serial,
              "SUCCEEDED",
              JSON.stringify({ ok: true, result }),
            );
          } catch (error) {
            await barrier?.cancel().catch(() => undefined);
            throw error;
          }
        } catch (error) {
          this.outbox.completeTarget(
            input.actionId,
            lease.leaseToken,
            target.serial,
            "FAILED",
            JSON.stringify({ ok: false, error: serializeError(error) }),
          );
        }
      }),
    );
    const completed = this.repository.get(input.actionId);
    if (completed === undefined) throw new Error("Completed action could not be read back.");
    return completed;
  }
}

function serializeError(error: unknown): { readonly name: string; readonly message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}
