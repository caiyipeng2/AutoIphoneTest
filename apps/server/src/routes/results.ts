import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { DeviceSerialSchema } from "@test-center/contracts/device";
import type { ReportHistoryFilter, ReportHistoryItem } from "@test-center/reports";

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
const ResultsExportFormatSchema = z.enum(["HTML", "ZIP"]);

export interface ResultsRouteService {
  list(filter: ReportHistoryFilter): readonly ReportHistoryItem[];
  get(runId: string): ReportHistoryItem | undefined;
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
      const reportExport = result.exports.find((item) => item.format === format.data);
      if (reportExport?.state !== "READY" || reportExport.finalRelativePath === undefined) {
        return await reply.code(409).send({ error: "Result export is not ready." });
      }

      try {
        const exportPath = await resolveReadyExportPath(
          context.resultsExportRoot,
          reportExport.finalRelativePath,
        );
        const metadata = await stat(exportPath);
        reply.header(
          "content-type",
          format.data === "HTML" ? "text/html; charset=utf-8" : "application/zip",
        );
        reply.header(
          "content-disposition",
          `${format.data === "HTML" ? "inline" : "attachment"}; filename="${format.data === "HTML" ? "report.html" : "evidence.zip"}"`,
        );
        reply.header("content-length", metadata.size);
        return await reply.send(createReadStream(exportPath));
      } catch (error) {
        if (isMissingFile(error))
          return await reply.code(404).send({ error: "Result export not found." });
        return await reply.code(404).send({ error: "Result export path is unavailable." });
      }
    },
  );
}

async function resolveReadyExportPath(root: string, relativePath: string): Promise<string> {
  const normalizedRoot = win32.normalize(root);
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
