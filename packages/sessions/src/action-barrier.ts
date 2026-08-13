import type { ActionCommand } from "./action-command.js";

export interface ActionBarrierRequest {
  readonly actionId: string;
  readonly runId?: string;
  readonly serial: string;
  readonly command: ActionCommand;
  readonly metricsEpoch: number;
  readonly sourceFrameId?: string;
}

export interface ActionBarrierLease {
  waitForAck(): Promise<unknown>;
  cancel(): Promise<void>;
}

export interface ActionBarrier {
  arm(request: ActionBarrierRequest): Promise<ActionBarrierLease>;
}

export type ActionBarrierFactory = (serial: string, runId?: string) => ActionBarrier;
