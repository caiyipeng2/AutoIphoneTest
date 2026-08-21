import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { DeviceSerialSchema } from "@test-center/contracts/device";
import type {
  ReportHistoryFilter,
  ReportHistoryItem,
  ReportOptionalExportFormat,
} from "@test-center/reports";
import {
  assertAllowedHost,
  assertSameOrigin,
  assertValidCsrf,
} from "@test-center/security/request-policy";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

const ResultsQuerySchema = z
  .object({
    state: z.enum(["FINISHED", "FAILED", "INTERRUPTED"]).optional(),
    serial: DeviceSerialSchema.optional(),
    uid: z.string().trim().min(1).max(256).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const ResultsExportFormatSchema = z.enum(["HTML", "ZIP", "EXCEL", "PDF", "JUNIT"]);
const OptionalExportRequestSchema = z
  .object({
    formats: z
      .array(z.enum(["EXCEL", "PDF", "JUNIT"]))
      .min(1)
      .max(3),
  })
  .strict();
const IdempotencyKeySchema = z.string().trim().min(1).max(128);

export interface ResultsRouteService {
  list(filter: ReportHistoryFilter): readonly ReportHistoryItem[];
  get(runId: string): ReportHistoryItem | undefined;
  retryFinalization?(runId: string, idempotencyKey: string): Promise<ReportHistoryItem>;
  requestOptionalExports?(
    runId: string,
    formats: readonly ReportOptionalExportFormat[],
    idempotencyKey: string,
  ): Promise<ReportHistoryItem>;
}

export async function registerResultsRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get<{ Querystring: Record<string, unknown> }>("/api/results", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.resultsService === undefined)
      return await reply.code(503).send({ error: "Results service unavailable." });
    try {
      const filter = ResultsQuerySchema.parse(request.query) as ReportHistoryFilter;
      return { schemaVersion: 1, results: context.resultsService.list(filter) };
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "Results query rejected." });
    }
  });

  app.get<{ Params: { id: string } }>("/api/results/:id", async (request, reply) => {
    if (requireSession(request, context) === undefined)
      return await reply.code(401).send({ error: "Authentication required." });
    if (context.resultsService === undefined)
      return await reply.code(503).send({ error: "Results service unavailable." });
    const result = context.resultsService.get(decodeURIComponent(request.params.id));
    if (result === undefined) return await reply.code(404).send({ error: "Result not found." });
    return { schemaVersion: 1, result };
  });

  app.post<{ Params: { id: string } }>(
    "/api/results/:id/retry-finalization",
    async (request, reply) => {
      try {
        assertMutationAllowed(request, context);
        if (context.resultsService === undefined)
          return await reply.code(503).send({ error: "Results service unavailable." });
        if (context.resultsService.retryFinalization === undefined)
          return await reply.code(503).send({ error: "Report finalization retry unavailable." });

        const runId = decodeURIComponent(request.params.id);
        const result = context.resultsService.get(runId);
        if (result === undefined) return await reply.code(404).send({ error: "Result not found." });

        const rawKey = request.headers["idempotency-key"];
        const idempotencyKey = IdempotencyKeySchema.parse(
          Array.isArray(rawKey) ? rawKey[0] : rawKey,
        );
        if (
          result.finalization === undefined ||
          (result.finalization.state !== "FINALIZATION_FAILED" &&
            result.finalization.state !== "INTERRUPTED")
        ) {
          return await reply.code(409).send({ error: "Result finalization is not retryable." });
        }

        const retried = await context.resultsService.retryFinalization(runId, idempotencyKey);
        return { schemaVersion: 1, result: retried };
      } catch (error) {
        return await reply
          .code(resultsMutationErrorCode(error))
          .send({ error: errorMessage(error) });
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/results/:id/exports", async (request, reply) => {
    try {
      assertMutationAllowed(request, context);
      if (context.resultsService === undefined)
        return await reply.code(503).send({ error: "Results service unavailable." });
      if (context.resultsService.requestOptionalExports === undefined)
        return await reply.code(503).send({ error: "Optional report export unavailable." });

      const runId = decodeURIComponent(request.params.id);
      if (context.resultsService.get(runId) === undefined)
        return await reply.code(404).send({ error: "Result not found." });
      const rawKey = request.headers["idempotency-key"];
      const idempotencyKey = IdempotencyKeySchema.parse(Array.isArray(rawKey) ? rawKey[0] : rawKey);
      const body = OptionalExportRequestSchema.parse(request.body) as {
        formats: ReportOptionalExportFormat[];
      };
      const result = await context.resultsService.requestOptionalExports(
        runId,
        body.formats,
        idempotencyKey,
      );
      return await reply.code(202).send({ schemaVersion: 1, result });
    } catch (error) {
      return await reply
        .code(resultsMutationErrorCode(error))
        .send({ error: errorMessage(error, "Optional report export request rejected.") });
    }
  });

  app.get<{ Params: { id: string; format: string } }>(
    "/api/results/:id/exports/:format",
    async (request, reply) => {
      if (requireSession(request, context) === undefined)
        return await reply.code(401).send({ error: "Authentication required." });
      if (context.resultsService === undefined)
        return await reply.code(503).send({ error: "Results service unavailable." });
      if (context.resultsExportRoot === undefined)
        return await reply.code(503).send({ error: "Results export storage unavailable." });

      const format = ResultsExportFormatSchema.safeParse(request.params.format.toUpperCase());
      if (!format.success)
        return await reply.code(400).send({ error: "Export format is invalid." });
      const result = context.resultsService.get(decodeURIComponent(request.params.id));
      if (result === undefined) return await reply.code(404).send({ error: "Result not found." });
      const reportExport = result.exports
        .filter((item) => item.format === format.data)
        .sort((left, right) => right.attempt - left.attempt)[0];
      if (reportExport?.state !== "READY" || reportExport.finalRelativePath === undefined) {
        return await reply.code(409).send({ error: "Result export is not ready." });
      }

      try {
        const exportPath = await resolveReadyExportPath(
          context.resultsExportRoot,
          reportExport.finalRelativePath,
        );
        const fileMetadata = await stat(exportPath);
        const downloadMetadata = exportDownloadMetadata(format.data);
        reply.header("content-type", downloadMetadata.contentType);
        reply.header(
          "content-disposition",
          `${downloadMetadata.inline ? "inline" : "attachment"}; filename="${downloadMetadata.filename}"`,
        );
        reply.header("content-length", fileMetadata.size);
        return await reply.send(createReadStream(exportPath));
      } catch (error) {
        if (isMissingFile(error))
          return await reply.code(404).send({ error: "Result export not found." });
        return await reply.code(404).send({ error: "Result export path is unavailable." });
      }
    },
  );
}

function assertMutationAllowed(request: FastifyRequest, context: ServerContext): void {
  assertAllowedHost(request.headers.host, context.port);
  assertSameOrigin(request.headers.origin, context.port);
  if (requireSession(request, context) === undefined) throw new Error("Authentication required.");
  const csrfHeader = request.headers["x-test-center-csrf"];
  assertValidCsrf(request.cookies.tc_csrf, Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader);
}

function errorMessage(error: unknown, fallback = "Result finalization retry rejected."): string {
  return error instanceof Error ? error.message : fallback;
}

function exportDownloadMetadata(format: z.infer<typeof ResultsExportFormatSchema>): {
  readonly contentType: string;
  readonly filename: string;
  readonly inline: boolean;
} {
  switch (format) {
    case "HTML":
      return { contentType: "text/html; charset=utf-8", filename: "report.html", inline: true };
    case "ZIP":
      return { contentType: "application/zip", filename: "evidence.zip", inline: false };
    case "EXCEL":
      return {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "report.xlsx",
        inline: false,
      };
    case "PDF":
      return { contentType: "application/pdf", filename: "report.pdf", inline: false };
    case "JUNIT":
      return {
        contentType: "application/xml; charset=utf-8",
        filename: "report.xml",
        inline: false,
      };
  }
}

function resultsMutationErrorCode(error: unknown): 400 | 401 | 403 | 404 | 409 | 503 {
  const message = errorMessage(error);
  if (/Authentication required/i.test(message)) return 401;
  if (/Host|Origin|CSRF/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/unavailable/i.test(message)) return 503;
  if (/retryable|terminal|Idempotency|idempotency|state/i.test(message)) return 409;
  return 400;
}

async function resolveReadyExportPath(root: string, relativePath: string): Promise<string> {
  const normalizedRoot = await realpath(win32.normalize(root));
  if (!win32.isAbsolute(normalizedRoot))
    throw new TypeError("Results export root must be absolute.");
  const candidate = win32.resolve(normalizedRoot, relativePath.replaceAll("/", "\\"));
  if (!isWithin(normalizedRoot, candidate))
    throw new TypeError("Result export path escaped run root.");
  const resolved = await realpath(candidate);
  if (!isWithin(normalizedRoot, resolved))
    throw new TypeError("Result export path escaped run root.");
  return resolved;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = win32.relative(win32.normalize(root), win32.normalize(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..\\") && relative !== ".." && !win32.isAbsolute(relative))
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
