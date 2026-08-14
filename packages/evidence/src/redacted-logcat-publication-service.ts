import type { EvidenceRecord, EvidenceRepository } from "./evidence-repository.js";
import { EvidencePublicationService } from "./evidence-publication-service.js";
import { redactLogcatEvidence, type LogcatEvidenceRequest } from "./logcat-evidence.js";

export interface RedactedLogcatPublicationRequest extends LogcatEvidenceRequest {
  /** Pending report-owned evidence record receiving the derived, redacted file. */
  readonly outputEvidenceId: string;
  readonly relativePath: string;
  readonly attempt: number;
  readonly capturedAt?: string;
}

/**
 * Turns a manifest-verified logcat segment into a report-owned evidence file.
 * Redaction is deliberately completed before the publisher is called so a
 * source-validation failure can never create an output file or be confused
 * with an I/O publication failure.
 */
export class RedactedLogcatPublicationService {
  public constructor(
    private readonly repository: EvidenceRepository,
    private readonly publicationService: EvidencePublicationService,
  ) {}

  public async publish(request: RedactedLogcatPublicationRequest): Promise<EvidenceRecord> {
    const output = this.repository.get(request.outputEvidenceId);
    if (output === undefined) throw new Error("Redacted logcat evidence is not registered.");
    if (output.kind !== "REDACTED_LOGCAT") {
      throw new Error("Output evidence must use the REDACTED_LOGCAT kind.");
    }

    let redacted;
    try {
      redacted = await redactLogcatEvidence(request);
    } catch (error) {
      // Keep the original validation error available to the caller while
      // persisting a stable category for report diagnostics and retry policy.
      const current = this.repository.get(request.outputEvidenceId);
      if (current?.state === "PENDING") {
        this.repository.markFailed(request.outputEvidenceId, { category: "REDACTION_FAILED" });
      }
      throw error;
    }

    // EvidencePublicationService owns the READY/PUBLISH_FAILED transition and
    // the measured hash/size metadata; this adapter only supplies safe content.
    return this.publicationService.publish(request.outputEvidenceId, {
      relativePath: request.relativePath,
      attempt: request.attempt,
      content: [redacted.content],
      ...(request.capturedAt === undefined ? {} : { capturedAt: request.capturedAt }),
    });
  }
}
