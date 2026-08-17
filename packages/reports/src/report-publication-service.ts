import type { AtomicPublishContent } from "@test-center/evidence";
import { AtomicEvidencePublisher } from "@test-center/evidence";
import type { ReportExportRecord } from "./report-export-repository.js";
import { ReportExportRepository } from "./report-export-repository.js";

export interface ReportPublicationRequest {
  readonly relativePath: string;
  readonly attempt: number;
  readonly content: AtomicPublishContent;
}

/** Couples report file publication with the durable export state transition. */
export class ReportPublicationService {
  public constructor(
    private readonly repository: ReportExportRepository,
    private readonly publisher: AtomicEvidencePublisher,
  ) {}

  public async publish(
    exportId: string,
    request: ReportPublicationRequest,
  ): Promise<ReportExportRecord> {
    const pending = this.repository.get(exportId);
    if (pending === undefined) throw new Error("Report export not found.");
    if (pending.state !== "PENDING") {
      throw new Error(`Report export is already terminal: ${pending.state}`);
    }
    if (pending.attempt !== request.attempt) {
      throw new Error("Report publication attempt does not match the pending record.");
    }

    try {
      const published = await this.publisher.publish({
        relativePath: request.relativePath,
        attempt: request.attempt,
        content: request.content,
      });
      return this.repository.markReady(exportId, {
        finalRelativePath: published.relativePath,
        sha256: published.sha256,
        sizeBytes: published.sizeBytes,
      });
    } catch (error) {
      this.repository.markFailed(exportId, { category: "PUBLISH_FAILED" });
      throw error;
    }
  }
}
