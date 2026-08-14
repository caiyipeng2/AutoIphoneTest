import type { AtomicPublishContent } from "./atomic-publisher.js";
import { AtomicEvidencePublisher } from "./atomic-publisher.js";
import type { EvidenceRecord } from "./evidence-repository.js";
import { EvidenceRepository } from "./evidence-repository.js";

export interface EvidencePublicationRequest {
  readonly relativePath: string;
  readonly attempt: number;
  readonly content: AtomicPublishContent;
  readonly capturedAt?: string;
}

/** Couples file publication with its durable evidence state without hiding publication errors. */
export class EvidencePublicationService {
  public constructor(
    private readonly repository: EvidenceRepository,
    private readonly publisher: AtomicEvidencePublisher,
  ) {}

  public async publish(
    evidenceId: string,
    request: EvidencePublicationRequest,
  ): Promise<EvidenceRecord> {
    const pending = this.repository.get(evidenceId);
    if (pending === undefined) throw new Error("Evidence not found.");
    if (pending.state !== "PENDING") {
      throw new Error(`Evidence is already terminal: ${pending.state}`);
    }
    if (pending.attempt !== request.attempt) {
      throw new Error("Evidence publication attempt does not match the pending record.");
    }

    try {
      const published = await this.publisher.publish({
        relativePath: request.relativePath,
        attempt: request.attempt,
        content: request.content,
      });
      return this.repository.markReady(evidenceId, {
        finalRelativePath: published.relativePath,
        sha256: published.sha256,
        sizeBytes: published.sizeBytes,
        ...(request.capturedAt === undefined ? {} : { capturedAt: request.capturedAt }),
      });
    } catch (error) {
      this.repository.markFailed(evidenceId, { category: "PUBLISH_FAILED" });
      throw error;
    }
  }
}
