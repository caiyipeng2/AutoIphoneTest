import type {
  ReportFinalizationExecutor,
  ReportHistoryFilter,
  ReportHistoryItem,
  ReportHistoryRepository,
  ReportOptionalExportFormat,
  ReportExportService,
} from "@test-center/reports";

import type { ResultsRouteService } from "./routes/results.js";

/** Couples durable history reads with report-only retry execution. */
export class RuntimeResultsRouteService implements ResultsRouteService {
  public constructor(
    private readonly history: Pick<ReportHistoryRepository, "list" | "get">,
    private readonly finalization: Pick<ReportFinalizationExecutor, "retryFinalization">,
    private readonly optionalExports?: Pick<ReportExportService, "request">,
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

  public async requestOptionalExports(
    runId: string,
    formats: readonly ReportOptionalExportFormat[],
    idempotencyKey: string,
  ): Promise<ReportHistoryItem> {
    if (this.optionalExports === undefined) throw new Error("Optional report export unavailable.");
    if (this.history.get(runId) === undefined) throw new Error("Result not found.");
    this.optionalExports.request(runId, formats, idempotencyKey);
    const result = this.history.get(runId);
    if (result === undefined) throw new Error("Result not found after export request.");
    return result;
  }
}
