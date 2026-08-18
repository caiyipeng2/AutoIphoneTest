import type {
  ReportFinalizationExecutor,
  ReportHistoryFilter,
  ReportHistoryItem,
  ReportHistoryRepository,
} from "@test-center/reports";

import type { ResultsRouteService } from "./routes/results.js";

/** Couples durable history reads with report-only retry execution. */
export class RuntimeResultsRouteService implements ResultsRouteService {
  public constructor(
    private readonly history: Pick<ReportHistoryRepository, "list" | "get">,
    private readonly finalization: Pick<ReportFinalizationExecutor, "retryFinalization">,
  ) {}

  public list(filter: ReportHistoryFilter): readonly ReportHistoryItem[] {
    return this.history.list(filter);
  }

  public get(runId: string): ReportHistoryItem | undefined {
    return this.history.get(runId);
  }

  public async retryFinalization(
    runId: string,
    idempotencyKey: string,
  ): Promise<ReportHistoryItem> {
    await this.finalization.retryFinalization(runId, idempotencyKey);
    const result = this.history.get(runId);
    if (result === undefined) throw new Error("Result not found after finalization.");
    return result;
  }
}
