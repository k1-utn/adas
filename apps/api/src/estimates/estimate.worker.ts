import { Worker } from 'bullmq';
import { promises as fs } from 'node:fs';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  getLlmProvider,
  runPipeline,
  runPipelineFromParsed,
  STARTER_RULES,
} from '@adas/ai';
import { bandFor, detectFormat, parseEstimateFile, type VinProfile } from '@adas/shared';
import { ESTIMATE_QUEUE, type EstimateJobData } from '../queue/queue.service.js';

/**
 * Estimate processing worker. Runs as a SEPARATE process from the API (scales independently).
 *
 * Flow per job:
 *   1. mark estimate ANALYZING
 *   2. OCR/extract the PDF -> text   (extractText is the integration point for the OCR vendor)
 *   3. decode/load VIN profile
 *   4. run the agent pipeline (rules engine + LLM agents)
 *   5. persist line items, requirements, OEM refs, and an immutable ProcessingStep per stage
 *
 * Provider selection: if no API keys are configured, falls back to the deterministic stub so
 * the system stays runnable in dev. Swap in OpenAI/Anthropic providers for production.
 */

const prisma = new PrismaClient();

// Real provider auto-detected from env (ANTHROPIC_API_KEY → real, otherwise stub).
const makeProvider = getLlmProvider;

async function extractText(_fileKey: string): Promise<string> {
  // INTEGRATION POINT: pull the PDF from object storage and run OCR/text extraction
  // (e.g. AWS Textract, Google Document AI, or pdf-parse for native-text PDFs).
  // Returns raw estimate text for the parsing agent.
  return '';
}

/**
 * Load raw bytes for an uploaded estimate. In production this pulls from object
 * storage (R2/S3/Supabase); in dev we read from the local `uploads/` directory.
 */
async function loadFile(fileKey: string): Promise<Buffer> {
  // Local-dev shortcut: keys like "uploads/<org>/<ts>-<name>" resolve to the on-disk path.
  // Replace with `storage.get(fileKey)` once object storage is wired.
  return fs.readFile(fileKey);
}

export function startEstimateWorker(): Worker<EstimateJobData> {
  const connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
  };

  const worker = new Worker<EstimateJobData>(
    ESTIMATE_QUEUE,
    async (job) => {
      const { estimateId } = job.data;
      await prisma.estimate.update({ where: { id: estimateId }, data: { status: 'ANALYZING' } });

      const estimate = await prisma.estimate.findUniqueOrThrow({
        where: { id: estimateId },
        include: { vinRecord: true },
      });

      const vin: VinProfile = estimate.vinRecord
        ? {
            vin: estimate.vinRecord.vin,
            make: estimate.vinRecord.make,
            model: estimate.vinRecord.model,
            trim: estimate.vinRecord.trim,
            modelYear: estimate.vinRecord.modelYear,
            adasSystems:
              (estimate.vinRecord.adasSystems as VinProfile['adasSystems']) ?? [],
          }
        : { vin: 'UNKNOWN0000000000', make: null, model: null, trim: null, modelYear: null, adasSystems: [] };

      const provider = makeProvider();

      // Detect file format and branch. EMS/BMS files are deterministically parsed
      // (skips OCR + LLM extraction entirely — structured data in, structured data out).
      // PDFs go through the legacy OCR + parsing-agent pipeline.
      const fileBytes = await loadFile(estimate.fileKey).catch(() => null);
      const format = fileBytes
        ? detectFormat(estimate.fileKey, fileBytes)
        : 'PDF';

      let out;
      if (fileBytes && (format === 'EMS' || format === 'BMS')) {
        const parseResult = parseEstimateFile(estimate.fileKey, fileBytes);
        if (!parseResult.ok) {
          throw new Error(`${format} parse failed: ${parseResult.error}`);
        }
        out = await runPipelineFromParsed(provider, {
          parsed: parseResult.estimate,
          vin,
          rules: STARTER_RULES,
        });
      } else {
        const ocrText = await extractText(estimate.fileKey);
        out = await runPipeline(provider, { ocrText, vin, rules: STARTER_RULES });
      }

      // Persist everything in one transaction so partial writes can't corrupt an estimate.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Trace steps (immutable).
        for (const step of out.trace) {
          await tx.processingStep.create({
            data: {
              estimateId,
              agent: step.agent,
              status: step.status,
              model: step.model,
              promptVersion: step.promptVersion,
              latencyMs: step.latencyMs,
              tokensUsed: step.tokensUsed,
              error: step.error,
            },
          });
        }

        // Line items.
        const createdItems = [];
        for (const li of out.parsed.lineItems) {
          const created = await tx.lineItem.create({
            data: {
              estimateId,
              type: li.type,
              description: li.description,
              oemPartNo: li.oemPartNo ?? null,
              quantity: li.quantity ?? null,
              laborHours: li.laborHours ?? null,
              impactZone: li.impactZone ?? null,
              isAdasRelated: li.isAdasRelated,
              affectedSystems: li.affectedSystems as object,
              extractionConfidence: li.extractionConfidence ?? null,
            },
          });
          createdItems.push(created);
        }

        // Requirements + OEM references.
        for (const r of out.requirements) {
          await tx.calibrationRequirement.create({
            data: {
              estimateId,
              ruleId: r.ruleId,
              kind: r.kind,
              explanation: r.explanation,
              triggeredByItems: r.triggeredByItems as object,
              confidenceScore: r.confidenceScore,
              confidenceBand: bandFor(r.confidenceScore),
              needsHumanReview: r.needsHumanReview,
              isSupplementCandidate: r.isSupplementCandidate,
            },
          });
        }

        await tx.estimate.update({
          where: { id: estimateId },
          data: { status: 'COMPLETED', source: out.parsed.source },
        });
      });

      return { requirements: out.requirements.length, gaps: out.complianceGaps.length };
    },
    { connection, concurrency: 4 },
  );

  worker.on('failed', async (job, err) => {
    if (job) {
      await prisma.estimate
        .update({ where: { id: job.data.estimateId }, data: { status: 'FAILED' } })
        .catch(() => undefined);
    }
    // eslint-disable-next-line no-console
    console.error(`Estimate job ${job?.id} failed:`, err.message);
  });

  return worker;
}
