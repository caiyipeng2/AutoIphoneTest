import { performance } from "node:perf_hooks";

import {
  ArmController,
  BridgeClient,
  BridgeProtocolParser,
  ClockCalibrator,
  createTcpBridgeTransport,
  hashBridgeDescriptor,
} from "@test-center/bridge";
import type { BridgeHash } from "@test-center/contracts/bridge";
import {
  actionDescriptor,
  type ActionBarrier,
  type ActionCommand,
  type TextFocusSnapshot,
} from "@test-center/sessions";

export interface RuntimeBridgeSessionOptions {
  readonly hostPort: number;
  readonly runNonceHash: string;
  readonly connectTimeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly armTimeoutMs?: number;
  readonly armLeaseMs?: number;
}

export interface RuntimeBridgeSession {
  readonly actionBarrier: ActionBarrier;
  connect(): Promise<void>;
  close(): Promise<void>;
  getTextFocusSnapshot(): TextFocusSnapshot | undefined;
}

export function createRuntimeBridgeParser(runNonceHash: BridgeHash): BridgeProtocolParser {
  // Unity's QaClock reports Android elapsedRealtime, so QA_ARMED/QA_ACK lease
  // checks must use the same process-monotonic domain as ClockCalibrator.
  return new BridgeProtocolParser({
    expectedRunNonceHash: runNonceHash,
    nowRealtimeMs: () => performance.now(),
  });
}

export function createRuntimeBridgeSession(
  options: RuntimeBridgeSessionOptions,
): RuntimeBridgeSession {
  const runNonceHash = options.runNonceHash as BridgeHash;
  const client = new BridgeClient({
    transport: createTcpBridgeTransport({
      port: options.hostPort,
      connectTimeoutMs: options.connectTimeoutMs ?? 5_000,
    }),
    parser: createRuntimeBridgeParser(runNonceHash),
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 8_000,
  });
  const calibrator = new ClockCalibrator(client, { sampleCount: 3, pingTimeoutMs: 1_000 });
  const controller = new ArmController(client, {
    defaultArmTimeoutMs: options.armTimeoutMs ?? 10_000,
  });
  let clockOffsetMs: number | undefined;

  return {
    actionBarrier: {
      arm: async (request) => {
        const snapshot = client.getSnapshot();
        const state = snapshot.state;
        if (snapshot.status !== "ready" || state === undefined) {
          throw new Error("Unity QA bridge state is not ready for action arm.");
        }
        const command = request.command as ActionCommand;
        const descriptor = {
          actionType: command.type,
          normalizedShape: bridgeEventShape(command, state.width, state.height),
          expectedView: state.view,
          expectedFocus: state.focusedControlId ?? null,
          metricsEpoch: request.metricsEpoch,
        };
        const descriptorHash = hashBridgeDescriptor(descriptor);
        const lease = await controller.arm({
          runNonceHash,
          actionId: request.actionId,
          descriptorHash,
          expectedEventShapeHash: descriptorHash,
          expectedView: state.view,
          expectedFocus: state.focusedControlId ?? null,
          metricsEpoch: request.metricsEpoch,
          expiresAtRealtimeMs: String(
            Math.floor(performance.now() + (clockOffsetMs ?? 0) + (options.armLeaseMs ?? 30_000)),
          ),
          timeoutMs: options.armTimeoutMs ?? 10_000,
        });
        return {
          waitForAck: async () => await lease.waitForAck(),
          cancel: async () => await lease.cancel(),
        };
      },
    },
    connect: async () => {
      await client.connect();
      clockOffsetMs = (await calibrator.calibrate()).offsetMs;
    },
    close: async () => {
      controller.dispose();
      await client.close();
    },
    getTextFocusSnapshot: () => {
      const snapshot = client.getSnapshot();
      const state = snapshot.state;
      if (snapshot.status !== "ready" || state === undefined || snapshot.hello === undefined) {
        return undefined;
      }
      return {
        serial: "runtime",
        bridgeInstanceId: snapshot.hello.bridgeInstanceId,
        view: state.view,
        focusedControlId: state.focusedControlId ?? null,
        metricsEpoch: state.metricsEpoch,
      };
    },
  };
}

export function bridgeEventShape(
  command: ActionCommand,
  width: number,
  height: number,
): ReturnType<typeof actionDescriptor> {
  if (command.type !== "tap") return actionDescriptor(command);
  return {
    type: "tap",
    x: quantizeCoordinate(command.x, width),
    y: quantizeCoordinate(command.y, height),
  };
}

function quantizeCoordinate(value: number, size: number): number {
  if (!Number.isSafeInteger(size) || size < 2) throw new TypeError("Bridge viewport is invalid.");
  const pixel = Math.round(value * (size - 1));
  return Number((pixel / (size - 1)).toFixed(3));
}
