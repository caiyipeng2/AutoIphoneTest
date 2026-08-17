import type { EvidenceZipEntryInput, EvidenceZipPublisher } from "./evidence-zip.js";
import type { EvidenceZipVerifyRequest, EvidenceZipVerifier } from "./evidence-zip-verifier.js";
import type { ReportExportRecord } from "./report-export-repository.js";
import { ReportExportRepository } from "./report-export-repository.js";
import type { ZipManifest } from "./zip-manifest.js";

export interface ReportZipPublicationRequest {
  readonly relativePath: string;
  readonly attempt: number;
  readonly manifest: ZipManifest;
  readonly entries: readonly EvidenceZipEntryInput[];
}

/** Publishes and independently verifies one ZIP export before making it READY. */
export class ReportZipPublicationService {
  public constructor(
    private readonly repository: ReportExportRepository,
    private readonly publisher: EvidenceZipPublisher,
    private readonly verifier: EvidenceZipVerifier,
  ) {}

  public async publish(
    exportId: string,
    request: ReportZipPublicationRequest,
  ): Promise<ReportExportRecord> {
    const pending = this.repository.get(exportId);
    if (pending === undefined) throw new Error("Report export not found.");
    if (pending.state !== "PENDING") {
      throw new Error(`Report export is already terminal: ${pending.state}`);
    }
    if (pending.format !== "ZIP") {
      throw new Error("Report ZIP publication format must be ZIP.");
    }
    if (pending.attempt !== request.attempt) {
      throw new Error("Report ZIP publication attempt does not match the pending record.");
    }

    let published: Awaited<ReturnType<EvidenceZipPublisher["publish"]>>;
    try {
      published = await this.publisher.publish(request);
    } catch (error) {
      this.repository.markFailed(exportId, { category: "PUBLISH_FAILED" });
      throw error;
    }

    try {
      const verificationRequest: EvidenceZipVerifyRequest = {
        relativePath: request.relativePath,
        manifest: request.manifest,
      };
      await this.verifier.verify(verificationRequest);
    } catch (error) {
      await this.publisher.cleanupPublished(request.relativePath).catch(() => undefined);
      this.repository.markFailed(exportId, { category: "VERIFY_FAILED" });
      throw error;
    }

    return this.repository.markReady(exportId, {
      finalRelativePath: published.relativePath,
      sha256: published.sha256,
      sizeBytes: published.sizeBytes,
    });
  }
}
