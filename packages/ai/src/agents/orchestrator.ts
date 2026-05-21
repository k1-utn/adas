import {
  bandFor,
  requirementResultSchema,
  type ParsedEstimate,
  type RequirementResult,
  type VinProfile,
} from '@adas/shared';
import type { LlmProvider } from '../providers/provider.js';
import { runEstimateParsingAgent } from './estimate-parsing.agent.js';
import { explainRequirement, generateSupplement, type SupplementDraft } from './narrative.agents.js';
import { scoreRequirement } from './confidence-scoring.agent.js';
import { evaluateRuleset, type CalibrationRuleDef } from '../rules/engine.js';

/**
 * ORCHESTRATOR — runs the agent DAG for one estimate and records a trace step per stage.
 *
 *   parse ─▶ rules(evaluate) ─▶ explain(each) ─▶ score(each) ─▶ compliance ─▶ supplement
 *
 * Each stage pushes a ProcessingStep-shaped record onto `trace`. The caller (API worker)
 * persists these immutably. If a stage degrades, we emit an honest partial result — never
 * a fabricated requirement.
 */

export interface TraceStep {
  agent: string;
  status: 'ok' | 'retry' | 'failed';
  model?: string;
  promptVersion?: string;
  latencyMs?: number;
  tokensUsed?: number;
  error?: string;
}

export interface PipelineInput {
  ocrText: string;
  vin: VinProfile;
  rules: CalibrationRuleDef[];
}

/**
 * Input variant for when the estimate has already been parsed deterministically
 * (e.g. a CIECA EMS file ingestion). Skips the LLM parsing agent entirely — the data
 * is structured at the source, no extraction needed.
 */
export interface PipelineFromParsedInput {
  parsed: ParsedEstimate;
  vin: VinProfile;
  rules: CalibrationRuleDef[];
}

export interface PipelineOutput {
  parsed: ParsedEstimate;
  requirements: RequirementResult[];
  supplement: SupplementDraft;
  complianceGaps: string[];
  trace: TraceStep[];
}

export async function runPipeline(
  provider: LlmProvider,
  input: PipelineInput,
): Promise<PipelineOutput> {
  const trace: TraceStep[] = [];

  // 1) Parse ----------------------------------------------------------------
  const parsedOut = await runEstimateParsingAgent(provider, { ocrText: input.ocrText });
  trace.push({
    agent: 'ESTIMATE_PARSING',
    status: 'ok',
    model: parsedOut.model,
    promptVersion: parsedOut.promptVersion,
    latencyMs: parsedOut.latencyMs,
    tokensUsed: parsedOut.tokensUsed,
  });

  return runPipelineFromParsed(provider, {
    parsed: parsedOut.result,
    vin: input.vin,
    rules: input.rules,
  }, trace);
}

/**
 * Entrypoint for pre-parsed estimates (EMS / BMS file ingestion). Identical to
 * runPipeline from stage 2 onward. The trace records ESTIMATE_PARSING as a
 * "deterministic" step so the audit log still shows the parse happened.
 */
export async function runPipelineFromParsed(
  provider: LlmProvider,
  input: PipelineFromParsedInput,
  existingTrace?: TraceStep[],
): Promise<PipelineOutput> {
  const trace: TraceStep[] = existingTrace ?? [];
  if (!existingTrace) {
    trace.push({
      agent: 'ESTIMATE_PARSING',
      status: 'ok',
      promptVersion: 'deterministic-ems',
    });
  }

  return runFromParsedInternal(provider, input, trace);
}

async function runFromParsedInternal(
  provider: LlmProvider,
  input: PipelineFromParsedInput,
  trace: TraceStep[],
): Promise<PipelineOutput> {
  // Assign stable ids to line items for traceability through the rules engine.
  const lineItems = input.parsed.lineItems.map((li, i) => ({ ...li, id: `li_${i}` }));

  // 2) Rules engine (deterministic) ----------------------------------------
  const candidates = evaluateRuleset(input.rules, { vin: input.vin, lineItems });
  trace.push({ agent: 'CALIBRATION_LOGIC', status: 'ok' });

  const vinCompleteness = computeVinCompleteness(input.vin);

  // 3) Explain + 4) Score each candidate ------------------------------------
  const requirements: RequirementResult[] = [];
  for (const c of candidates) {
    const triggerItems = lineItems.filter((li) => c.triggeredByItems.includes(li.id));
    let explanation = c.rationale;
    try {
      explanation = await explainRequirement(provider, {
        vin: input.vin,
        kind: c.kind,
        rationale: c.rationale,
        triggerDescriptions: triggerItems.map((t) => t.description),
      });
    } catch (e) {
      trace.push({ agent: 'EXPLAIN', status: 'failed', error: String(e) });
      // Degrade gracefully to the deterministic rationale.
    }

    const scored = scoreRequirement(c, {
      triggerItems,
      hasOemReference: c.oemProcedureIds.length > 0,
      vinProfileCompleteness: vinCompleteness,
    });

    requirements.push(
      requirementResultSchema.parse({
        ...c,
        explanation,
        confidenceScore: scored.confidenceScore,
        confidenceBand: scored.confidenceBand,
        needsHumanReview: scored.needsHumanReview,
        isSupplementCandidate: scored.isSupplementCandidate,
      }),
    );
  }
  trace.push({ agent: 'CONFIDENCE_SCORING', status: 'ok' });

  // 5) Compliance validation (deterministic cross-checks) -------------------
  const complianceGaps = validateCompliance(requirements);
  trace.push({ agent: 'COMPLIANCE_VALIDATION', status: 'ok' });

  // 6) Supplement draft -----------------------------------------------------
  let supplement: SupplementDraft;
  try {
    supplement = await generateSupplement(provider, { vin: input.vin, requirements });
    trace.push({ agent: 'INSURER_SUPPLEMENT', status: 'ok' });
  } catch (e) {
    supplement = { narrative: '', disclaimer: '', includedRequirementKinds: [] };
    trace.push({ agent: 'INSURER_SUPPLEMENT', status: 'failed', error: String(e) });
  }

  return { parsed: input.parsed, requirements, supplement, complianceGaps, trace };
}

function computeVinCompleteness(vin: VinProfile): number {
  let score = 0;
  if (vin.make) score += 0.25;
  if (vin.model) score += 0.25;
  if (vin.modelYear) score += 0.25;
  if (vin.adasSystems.length > 0) score += 0.25;
  return score;
}

/** Deterministic compliance cross-checks: catch contradictions and likely-missed ops. */
function validateCompliance(reqs: RequirementResult[]): string[] {
  const gaps: string[] = [];
  const kinds = new Set(reqs.map((r) => r.kind));

  // If any calibration/aiming is required, a wheel alignment + SAS reset are usually prerequisites.
  const needsCal =
    kinds.has('RADAR_CALIBRATION') ||
    kinds.has('CAMERA_AIMING') ||
    kinds.has('STATIC_CALIBRATION') ||
    kinds.has('DYNAMIC_CALIBRATION');
  if (needsCal && !kinds.has('WHEEL_ALIGNMENT')) {
    gaps.push(
      'A calibration is indicated but no wheel alignment was detected. Many OEM calibrations ' +
        'require a verified alignment first — confirm whether alignment applies.',
    );
  }
  if (needsCal && !kinds.has('POST_SCAN')) {
    gaps.push('Calibration indicated without a post-repair scan — verify post-scan requirement.');
  }
  return gaps;
}
