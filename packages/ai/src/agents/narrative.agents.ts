import { LIABILITY_DISCLAIMER, type RequirementResult, type VinProfile } from '@adas/shared';
import type { LlmProvider } from '../providers/provider.js';

/**
 * AGENT 3 (narrative half) — Calibration Logic Agent explanation.
 * The rules engine decides WHAT; this turns the rule's rationale + trigger context into a
 * clear, repair-context-aware WHY. It is grounded: the rationale comes from the rule, so the
 * model rewrites/contextualizes rather than inventing requirements.
 *
 * AGENT 4 — Insurer Supplement Agent: assembles a defensible narrative from confirmed,
 * high-confidence requirements with OEM references and the mandatory disclaimer.
 */

export const EXPLAIN_PROMPT_VERSION = 'explain-requirement@1.0.0';
export const SUPPLEMENT_PROMPT_VERSION = 'supplement-narrative@1.0.0';

export async function explainRequirement(
  provider: LlmProvider,
  args: { vin: VinProfile; kind: string; rationale: string; triggerDescriptions: string[] },
): Promise<string> {
  const system =
    'You write concise, factual collision repair justifications for insurers. ' +
    'Ground every sentence in the provided rationale and trigger items. Do not assert ' +
    'guarantees. Use advisory language ("OEM procedures indicate", "verification required"). ' +
    '2-4 sentences.';
  const user = JSON.stringify(args);
  const out = await provider.complete({
    promptVersion: EXPLAIN_PROMPT_VERSION,
    system,
    user,
    temperature: 0.2,
  });
  return out.text.trim() || args.rationale;
}

export interface SupplementDraft {
  narrative: string;
  disclaimer: string;
  includedRequirementKinds: string[];
}

export async function generateSupplement(
  provider: LlmProvider,
  args: { vin: VinProfile; requirements: RequirementResult[] },
): Promise<SupplementDraft> {
  // Only high-confidence, supplement-eligible requirements go into the insurer narrative.
  const included = args.requirements.filter((r) => r.isSupplementCandidate);

  const system =
    'You are drafting an insurer supplement justification for a collision repair facility. ' +
    'Summarize the required operations and why each is indicated by OEM procedures for this ' +
    'vehicle. Advisory tone, no guarantees. Group by operation. Keep it tight and professional.';
  const user = JSON.stringify({
    vehicle: `${args.vin.modelYear ?? ''} ${args.vin.make ?? ''} ${args.vin.model ?? ''}`.trim(),
    operations: included.map((r) => ({
      kind: r.kind,
      explanation: r.explanation,
      confidenceBand: r.confidenceBand,
    })),
  });

  const out = await provider.complete({
    promptVersion: SUPPLEMENT_PROMPT_VERSION,
    system,
    user,
    temperature: 0.3,
  });

  return {
    narrative: out.text.trim(),
    disclaimer: LIABILITY_DISCLAIMER,
    includedRequirementKinds: included.map((r) => r.kind),
  };
}
