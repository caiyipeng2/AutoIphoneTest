import type { DeploymentState, DeploymentStepKind } from "@test-center/contracts/deployment";

export type { DeploymentStepKind } from "@test-center/contracts/deployment";

export type DeploymentStepAttempt = {
  readonly step: DeploymentStepKind;
  readonly attempt: number;
  readonly outcome: "FAILED";
  readonly message: string;
};

export type DeploymentMachineSnapshot = {
  readonly state: DeploymentState;
  readonly currentStep?: DeploymentStepKind;
  readonly failedStep?: DeploymentStepKind;
  readonly failureMessage?: string;
  readonly attempt: number;
  readonly attempts: readonly DeploymentStepAttempt[];
};

export interface DeploymentPersistence {
  persist(snapshot: DeploymentMachineSnapshot, updatedAt: string): void;
}

export interface DeploymentMachineOptions {
  readonly persistence?: DeploymentPersistence;
  readonly now?: () => string;
  readonly initialSnapshot?: DeploymentMachineSnapshot;
}

export type DeploymentCommand =
  | { readonly type: "START_OR_ADVANCE" }
  | { readonly type: "FAIL"; readonly step: DeploymentStepKind; readonly message: string }
  | { readonly type: "CANCEL" }
  | { readonly type: "RETRY" };

const STEP_ORDER: readonly DeploymentStepKind[] = [
  "PRECHECK",
  "PREPARE",
  "INSTALL",
  "VERIFY",
  "LAUNCH",
];

const TERMINAL_STATES = new Set<DeploymentState>(["COMPLETED", "CANCELLED"]);

export class DeploymentMachine {
  private state: DeploymentState = "QUEUED";
  private stepIndex = -1;
  private stepAttempt = 1;
  private failedStep: DeploymentStepKind | undefined;
  private failureMessage: string | undefined;
  private readonly failedAttempts: DeploymentStepAttempt[] = [];

  public constructor(private readonly options: DeploymentMachineOptions = {}) {
    const initial = options.initialSnapshot;
    if (initial === undefined) return;
    this.state = initial.state;
    this.stepIndex = initial.currentStep === undefined ? -1 : STEP_ORDER.indexOf(initial.currentStep);
    this.stepAttempt = initial.attempt;
    this.failedStep = initial.failedStep;
    this.failureMessage = initial.failureMessage;
    this.failedAttempts.push(...initial.attempts);
  }

  public get snapshot(): DeploymentMachineSnapshot {
    return {
      state: this.state,
      ...(this.stepIndex >= 0 && this.stepIndex < STEP_ORDER.length
        ? { currentStep: STEP_ORDER[this.stepIndex] }
        : {}),
      ...(this.failedStep === undefined ? {} : { failedStep: this.failedStep }),
      ...(this.failureMessage === undefined ? {} : { failureMessage: this.failureMessage }),
      attempt: this.stepAttempt,
      attempts: [...this.failedAttempts],
    };
  }

  public dispatch(command: DeploymentCommand): DeploymentMachineSnapshot {
    if (TERMINAL_STATES.has(this.state)) throw new Error("Deployment is terminal.");

    if (command.type === "CANCEL") {
      if (this.state !== "QUEUED" && this.state !== "PRECHECK" && this.state !== "PREPARE") {
        throw new Error("Deployment cannot be cancelled while a device step is executing.");
      }
      this.state = "CANCELLED";
      return this.persistSnapshot();
    }

    if (command.type === "RETRY") {
      if (this.state !== "FAILED" || this.failedStep === undefined) {
        throw new Error("Only a failed deployment can be retried.");
      }
      this.state = this.failedStep;
      this.stepIndex = STEP_ORDER.indexOf(this.failedStep);
      this.stepAttempt += 1;
      this.failureMessage = undefined;
      return this.persistSnapshot();
    }

    if (command.type === "FAIL") {
      const activeStep = this.activeStep();
      if (activeStep !== command.step)
        throw new Error(`Failure step '${command.step}' is not active.`);
      this.state = "FAILED";
      this.failedStep = command.step;
      this.failureMessage = command.message;
      this.failedAttempts.push({
        step: command.step,
        attempt: this.stepAttempt,
        outcome: "FAILED",
        message: command.message,
      });
      return this.persistSnapshot();
    }

    if (command.type === "START_OR_ADVANCE") {
      if (this.state === "FAILED") throw new Error("Failed deployment requires RETRY.");
      if (this.state === "QUEUED") {
        this.stepIndex = 0;
        this.state = STEP_ORDER[0]!;
        return this.persistSnapshot();
      }
      const nextIndex = this.stepIndex + 1;
      if (nextIndex >= STEP_ORDER.length) {
        this.state = "COMPLETED";
        this.stepIndex = -1;
      } else {
        this.stepIndex = nextIndex;
        this.state = STEP_ORDER[nextIndex]!;
      }
      return this.persistSnapshot();
    }

    return this.persistSnapshot();
  }

  private persistSnapshot(): DeploymentMachineSnapshot {
    const snapshot = this.snapshot;
    this.options.persistence?.persist(snapshot, this.options.now?.() ?? new Date().toISOString());
    return snapshot;
  }

  private activeStep(): DeploymentStepKind {
    const step = STEP_ORDER[this.stepIndex];
    if (step === undefined) throw new Error("Deployment has no active step.");
    return step;
  }
}
