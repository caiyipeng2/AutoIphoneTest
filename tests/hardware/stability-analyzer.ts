export const STABILITY_ANALYZER_VERSION = "m11-stability-analyzer-v2";
export const WARMUP_SECONDS = 10 * 60;
export const ROLLING_WINDOW_SECONDS = 5 * 60;
export const MAX_QUEUE_DEPTH = 2;
export const MAX_QUEUE_DURATION_SECONDS = 30;
export const MAX_WAL_BYTES = 64 * 1024 * 1024;
export const MAX_PRIVATE_BYTES_SLOPE_MIB_PER_MINUTE = 1;
export const MAX_PRIVATE_BYTES_FINAL_DELTA_MIB = 128;
export const MAX_HANDLES_SLOPE_PER_MINUTE = 1;
export const MAX_HANDLES_FINAL_DELTA = 100;
export const MAX_THREADS_SLOPE_PER_MINUTE = 0.1;
export const MAX_THREADS_FINAL_DELTA = 10;

export interface StabilitySample {
  readonly elapsedSeconds: number;
  readonly processTreePrivateBytes: number;
  readonly processTreeHandles: number;
  readonly processTreeThreads: number;
  readonly maxQueueDepth: number;
  readonly walBytes: number;
  readonly crashCount: number;
  readonly restartCount: number;
  readonly workerCount: number;
  readonly portLeaseCount: number;
  readonly forwardCount: number;
  readonly cpuPercent?: number;
  readonly rssBytes?: number;
  readonly openFileCount?: number;
  readonly openSocketCount?: number;
  readonly temperatureCelsius?: number;
}

export interface StabilityAnalysis {
  readonly analyzerVersion: string;
  readonly status: "PASS" | "FAIL";
  readonly warmupSeconds: number;
  readonly sampleCount: number;
  readonly postWarmupSampleCount: number;
  readonly thresholds: {
    readonly events: "PASS" | "FAIL";
    readonly queueDepth: "PASS" | "FAIL";
    readonly walBytes: "PASS" | "FAIL";
    readonly privateBytesSlope: "PASS" | "FAIL";
    readonly handlesSlope: "PASS" | "FAIL";
    readonly threadsSlope: "PASS" | "FAIL";
  };
  readonly metrics: {
    readonly privateBytesSlopeMiBPerMinute: number;
    readonly privateBytesKendallTau: number;
    readonly privateBytesFirstRollingMedianMiB: number;
    readonly privateBytesFinalRollingMedianMiB: number;
    readonly privateBytesFinalDeltaMiB: number;
    readonly handlesSlopePerMinute: number;
    readonly handlesFinalDelta: number;
    readonly threadsSlopePerMinute: number;
    readonly threadsFinalDelta: number;
    readonly maxQueueDepth: number;
    readonly maxQueueViolationDurationSeconds: number;
    readonly maxWalBytes: number;
    readonly finalWorkerCount: number;
    readonly finalPortLeaseCount: number;
    readonly finalForwardCount: number;
    readonly crashCount: number;
    readonly restartCount: number;
  };
  readonly failures: readonly string[];
}

export interface StabilityAnalyzerOptions {
  readonly warmupSeconds?: number;
  readonly expectedWorkers?: number;
  readonly cleanup?: Pick<StabilitySample, "workerCount" | "portLeaseCount" | "forwardCount">;
}

export function analyzeStability(
  samples: readonly StabilitySample[],
  options: StabilityAnalyzerOptions = {},
): StabilityAnalysis {
  const warmupSeconds = options.warmupSeconds ?? WARMUP_SECONDS;
  const expectedWorkers = options.expectedWorkers ?? 1;
  const cleanup = options.cleanup;
  const sorted = [...samples].sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
  const postWarmup = sorted.filter((sample) => sample.elapsedSeconds >= warmupSeconds);
  const failures: string[] = [];

  if (postWarmup.length < 2) {
    return emptyAnalysis(
      sorted.length,
      warmupSeconds,
      failures.concat("INSUFFICIENT_POST_WARMUP_SAMPLES"),
    );
  }

  const last = postWarmup[postWarmup.length - 1]!;
  const privateValues = postWarmup.map((sample) => ({
    x: sample.elapsedSeconds,
    y: sample.processTreePrivateBytes,
  }));
  const handlesValues = postWarmup.map((sample) => ({
    x: sample.elapsedSeconds,
    y: sample.processTreeHandles,
  }));
  const threadValues = postWarmup.map((sample) => ({
    x: sample.elapsedSeconds,
    y: sample.processTreeThreads,
  }));
  const privateSlope = theilSenSlope(privateValues) * 60;
  const handlesSlope = theilSenSlope(handlesValues) * 60;
  const threadsSlope = theilSenSlope(threadValues) * 60;
  const privateTau = kendallTau(privateValues.map(({ y }) => y));
  const privateRolling = rollingMedians(postWarmup, (sample) => sample.processTreePrivateBytes);
  const firstPrivateMedian = privateRolling[0]!.value / (1024 * 1024);
  const finalPrivateMedian = privateRolling[privateRolling.length - 1]!.value / (1024 * 1024);
  const privateFinalDelta = finalPrivateMedian - firstPrivateMedian;
  const firstHandlesMedian = rollingMedians(postWarmup, (sample) => sample.processTreeHandles)[0]!
    .value;
  const finalHandlesMedian = rollingMedians(postWarmup, (sample) => sample.processTreeHandles).at(
    -1,
  )!.value;
  const firstThreadsMedian = rollingMedians(postWarmup, (sample) => sample.processTreeThreads)[0]!
    .value;
  const finalThreadsMedian = rollingMedians(postWarmup, (sample) => sample.processTreeThreads).at(
    -1,
  )!.value;
  const maxQueueDepth = Math.max(...postWarmup.map((sample) => sample.maxQueueDepth));
  const maxQueueViolationDurationSeconds = sustainedViolationDuration(
    postWarmup,
    (sample) => sample.maxQueueDepth > MAX_QUEUE_DEPTH,
  );
  const maxWalBytes = Math.max(...postWarmup.map((sample) => sample.walBytes));
  const finalWorkerCount = last.workerCount;
  const finalPortLeaseCount = last.portLeaseCount;
  const finalForwardCount = last.forwardCount;
  const crashCount = Math.max(...sorted.map((sample) => sample.crashCount));
  const restartCount = Math.max(...sorted.map((sample) => sample.restartCount));
  const cleanupPass =
    cleanup === undefined ||
    (cleanup.workerCount === 0 && cleanup.portLeaseCount === 0 && cleanup.forwardCount === 0);

  const eventsPass =
    crashCount === 0 && restartCount === 0 && finalWorkerCount === expectedWorkers && cleanupPass;
  const queuePass = maxQueueViolationDurationSeconds < MAX_QUEUE_DURATION_SECONDS;
  const walPass = maxWalBytes <= MAX_WAL_BYTES;
  const privateSlopePass =
    !(privateSlope > MAX_PRIVATE_BYTES_SLOPE_MIB_PER_MINUTE && privateTau >= 0.5) &&
    privateFinalDelta <= MAX_PRIVATE_BYTES_FINAL_DELTA_MIB;
  const handlesPass = !(
    handlesSlope > MAX_HANDLES_SLOPE_PER_MINUTE &&
    finalHandlesMedian - firstHandlesMedian > MAX_HANDLES_FINAL_DELTA
  );
  const threadsPass = !(
    threadsSlope > MAX_THREADS_SLOPE_PER_MINUTE &&
    finalThreadsMedian - firstThreadsMedian > MAX_THREADS_FINAL_DELTA
  );

  const thresholds = {
    events: passOrFailure(eventsPass, failures, "EVENT_OR_RESOURCE_LEAK"),
    queueDepth: passOrFailure(queuePass, failures, "QUEUE_DEPTH_SUSTAINED"),
    walBytes: passOrFailure(walPass, failures, "WAL_ABOVE_64_MIB"),
    privateBytesSlope: passOrFailure(privateSlopePass, failures, "PRIVATE_BYTES_TREND"),
    handlesSlope: passOrFailure(handlesPass, failures, "HANDLE_TREND"),
    threadsSlope: passOrFailure(threadsPass, failures, "THREAD_TREND"),
  } as const;

  return {
    analyzerVersion: STABILITY_ANALYZER_VERSION,
    status: failures.length === 0 ? "PASS" : "FAIL",
    warmupSeconds,
    sampleCount: sorted.length,
    postWarmupSampleCount: postWarmup.length,
    thresholds,
    metrics: {
      privateBytesSlopeMiBPerMinute: round(privateSlope),
      privateBytesKendallTau: round(privateTau),
      privateBytesFirstRollingMedianMiB: round(firstPrivateMedian),
      privateBytesFinalRollingMedianMiB: round(finalPrivateMedian),
      privateBytesFinalDeltaMiB: round(privateFinalDelta),
      handlesSlopePerMinute: round(handlesSlope),
      handlesFinalDelta: round(finalHandlesMedian - firstHandlesMedian),
      threadsSlopePerMinute: round(threadsSlope),
      threadsFinalDelta: round(finalThreadsMedian - firstThreadsMedian),
      maxQueueDepth,
      maxQueueViolationDurationSeconds: round(maxQueueViolationDurationSeconds),
      maxWalBytes,
      finalWorkerCount,
      finalPortLeaseCount,
      finalForwardCount,
      crashCount,
      restartCount,
    },
    failures,
  };
}

function emptyAnalysis(
  sampleCount: number,
  warmupSeconds: number,
  failures: string[],
): StabilityAnalysis {
  return {
    analyzerVersion: STABILITY_ANALYZER_VERSION,
    status: "FAIL",
    warmupSeconds,
    sampleCount,
    postWarmupSampleCount: 0,
    thresholds: {
      events: "FAIL",
      queueDepth: "FAIL",
      walBytes: "FAIL",
      privateBytesSlope: "FAIL",
      handlesSlope: "FAIL",
      threadsSlope: "FAIL",
    },
    metrics: {
      privateBytesSlopeMiBPerMinute: 0,
      privateBytesKendallTau: 0,
      privateBytesFirstRollingMedianMiB: 0,
      privateBytesFinalRollingMedianMiB: 0,
      privateBytesFinalDeltaMiB: 0,
      handlesSlopePerMinute: 0,
      handlesFinalDelta: 0,
      threadsSlopePerMinute: 0,
      threadsFinalDelta: 0,
      maxQueueDepth: 0,
      maxQueueViolationDurationSeconds: 0,
      maxWalBytes: 0,
      finalWorkerCount: 0,
      finalPortLeaseCount: 0,
      finalForwardCount: 0,
      crashCount: 0,
      restartCount: 0,
    },
    failures,
  };
}

function passOrFailure(pass: boolean, failures: string[], failure: string): "PASS" | "FAIL" {
  if (!pass) failures.push(failure);
  return pass ? "PASS" : "FAIL";
}

function theilSenSlope(values: readonly { x: number; y: number }[]): number {
  const slopes: number[] = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const deltaX = values[right]!.x - values[left]!.x;
      if (deltaX > 0) slopes.push((values[right]!.y - values[left]!.y) / deltaX);
    }
  }
  return median(slopes);
}

function kendallTau(values: readonly number[]): number {
  let concordant = 0;
  let discordant = 0;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const difference = values[right]! - values[left]!;
      if (difference > 0) concordant += 1;
      if (difference < 0) discordant += 1;
    }
  }
  const pairs = (values.length * (values.length - 1)) / 2;
  return pairs === 0 ? 0 : (concordant - discordant) / pairs;
}

function rollingMedians(
  samples: readonly StabilitySample[],
  read: (sample: StabilitySample) => number,
): Array<{ elapsedSeconds: number; value: number }> {
  return samples.map((sample) => {
    const windowStart = sample.elapsedSeconds - ROLLING_WINDOW_SECONDS;
    const values = samples
      .filter(
        (candidate) =>
          candidate.elapsedSeconds >= windowStart &&
          candidate.elapsedSeconds <= sample.elapsedSeconds,
      )
      .map(read);
    return { elapsedSeconds: sample.elapsedSeconds, value: median(values) };
  });
}

function sustainedViolationDuration(
  samples: readonly StabilitySample[],
  violates: (sample: StabilitySample) => boolean,
): number {
  let runStart: number | undefined;
  let longest = 0;
  for (const sample of samples) {
    if (violates(sample)) {
      runStart ??= sample.elapsedSeconds;
      longest = Math.max(longest, sample.elapsedSeconds - runStart);
    } else {
      runStart = undefined;
    }
  }
  return longest;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
