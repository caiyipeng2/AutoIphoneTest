export interface TextFocusSnapshot {
  readonly serial: string;
  readonly bridgeInstanceId: string;
  readonly view: string;
  readonly focusedControlId: string | null;
  readonly metricsEpoch: number;
}

export interface TextFocusSnapshotProvider {
  sample(serial: string, runId?: string): Promise<TextFocusSnapshot>;
}

export interface TextFocusVerificationInput {
  readonly serials: readonly string[];
  readonly metricsEpoch: number;
  readonly runId?: string;
}

export interface TextFocusBarrierOptions {
  readonly settleMs?: number;
  readonly sleep?: (durationMs: number) => Promise<void>;
}

export type TextFocusBarrierErrorCode =
  | "MISSING_FOCUS"
  | "FOCUS_MISMATCH"
  | "VIEW_MISMATCH"
  | "METRICS_CHANGED"
  | "BRIDGE_MISMATCH"
  | "SAMPLE_CHANGED";

export class TextFocusBarrierError extends Error {
  public constructor(
    public readonly code: TextFocusBarrierErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TextFocusBarrierError";
  }
}

/**
 * Text input is only safe when every target agrees twice on the same trusted
 * control and bridge state. The second sample prevents a focus change between
 * validation and the Appium text command from being treated as synchronized.
 */
export class TextFocusBarrier {
  private readonly settleMs: number;
  private readonly sleep: (durationMs: number) => Promise<void>;

  public constructor(
    private readonly provider: TextFocusSnapshotProvider,
    options: TextFocusBarrierOptions = {},
  ) {
    this.settleMs = options.settleMs ?? 50;
    this.sleep =
      options.sleep ?? ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    if (!Number.isFinite(this.settleMs) || this.settleMs < 0) {
      throw new TypeError("settleMs must be a non-negative finite number.");
    }
  }

  public async verify(input: TextFocusVerificationInput): Promise<void> {
    if (input.serials.length === 0)
      throw new TextFocusBarrierError("MISSING_FOCUS", "Text input requires at least one target.");
    const first = await this.sampleAll(input.serials, input.runId);
    this.validateGroup(first, input.metricsEpoch);
    await this.sleep(this.settleMs);
    const second = await this.sampleAll(input.serials, input.runId);
    this.validateGroup(second, input.metricsEpoch);
    for (let index = 0; index < first.length; index += 1) {
      if (!sameSnapshot(first[index]!, second[index]!)) {
        throw new TextFocusBarrierError(
          "SAMPLE_CHANGED",
          `Trusted text focus changed on ${first[index]!.serial}.`,
        );
      }
    }
  }

  private async sampleAll(
    serials: readonly string[],
    runId?: string,
  ): Promise<readonly TextFocusSnapshot[]> {
    return await Promise.all(serials.map((serial) => this.provider.sample(serial, runId)));
  }

  private validateGroup(samples: readonly TextFocusSnapshot[], metricsEpoch: number): void {
    const first = samples[0];
    if (first === undefined)
      throw new TextFocusBarrierError("MISSING_FOCUS", "Text input requires a trusted focus.");
    if (!first.focusedControlId)
      throw new TextFocusBarrierError(
        "MISSING_FOCUS",
        `Trusted focus is missing on ${first.serial}.`,
      );
    for (const sample of samples) {
      if (!sample.focusedControlId)
        throw new TextFocusBarrierError(
          "MISSING_FOCUS",
          `Trusted focus is missing on ${sample.serial}.`,
        );
      if (!sample.bridgeInstanceId)
        throw new TextFocusBarrierError(
          "BRIDGE_MISMATCH",
          `Bridge instance is missing on ${sample.serial}.`,
        );
      if (sample.view !== first.view)
        throw new TextFocusBarrierError("VIEW_MISMATCH", "Text targets are not on the same view.");
      if (sample.focusedControlId !== first.focusedControlId)
        throw new TextFocusBarrierError(
          "FOCUS_MISMATCH",
          "Text targets do not share the same focused control.",
        );
      if (sample.metricsEpoch !== metricsEpoch || sample.metricsEpoch !== first.metricsEpoch)
        throw new TextFocusBarrierError(
          "METRICS_CHANGED",
          "Text target metrics changed before dispatch.",
        );
    }
  }
}

function sameSnapshot(left: TextFocusSnapshot, right: TextFocusSnapshot): boolean {
  return (
    left.serial === right.serial &&
    left.bridgeInstanceId === right.bridgeInstanceId &&
    left.view === right.view &&
    left.focusedControlId === right.focusedControlId &&
    left.metricsEpoch === right.metricsEpoch
  );
}
