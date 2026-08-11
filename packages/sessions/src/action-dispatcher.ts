import { randomUUID } from "node:crypto";

import type { ActionPayload, ActionView, RunActionRepository } from "./run-repository.js";
import type { ActionOutbox } from "./action-outbox.js";

export interface ActionDeviceExecutor {
  execute(input: {
    readonly serial: string;
    readonly packageName: string;
    readonly payload: ActionPayload;
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
  ) {}

  public async dispatch(input: ActionDispatchInput): Promise<ActionView> {
    const queued = this.repository.get(input.actionId);
    if (queued === undefined) throw new Error("Action not found.");
    if (queued.state !== "QUEUED") throw new Error("Action is not queued.");

    const lease = this.outbox.leaseAction(input.actionId, this.ownerToken);
    if (lease === undefined) throw new Error("Action is not available for dispatch.");
    this.outbox.markDispatching(input.actionId, lease.leaseToken);

    for (const target of queued.targets) {
      try {
        const result = await this.executorFactory(target.serial).execute({
          serial: target.serial,
          packageName: input.packageName,
          payload: queued.payload,
        });
        this.outbox.completeTarget(
          input.actionId,
          lease.leaseToken,
          target.serial,
          "SUCCEEDED",
          JSON.stringify({ ok: true, result }),
        );
      } catch (error) {
        this.outbox.completeTarget(
          input.actionId,
          lease.leaseToken,
          target.serial,
          "FAILED",
          JSON.stringify({ ok: false, error: serializeError(error) }),
        );
      }
    }
    const completed = this.repository.get(input.actionId);
    if (completed === undefined) throw new Error("Completed action could not be read back.");
    return completed;
  }
}

function serializeError(error: unknown): { readonly name: string; readonly message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}
