import { bandFor, CONFIDENCE_THRESHOLDS, type CandidateRequirement } from '@adas/shared';
import type { ParsedLineItem } from '@adas/shared';

/**
 * AGENT 6 — Confidence Scoring Agent (deterministic).
 *
 * Combines independent signals into a single per-requirement confidence. Deterministic on
 * purpose: the score that gates whether something becomes a supplement candidate must be
 * explainable and reproducible, not a model's mood.
 *
 *   confidence = w1*extraction_certainty
 *              + w2*rule_strength (baseConfidence)
 *              + w3*oem_source_quality
 *              + w4*vin_profile_completeness
 */

export interface ScoringSignals {
  /** Average extractionConfidence of the line items that triggered this requirement. */
  triggerItems: ParsedLineItem[];
  /** Did we attach at least one OEM procedure reference? */
  hasOemReference: boolean;
  /** 0..1 how complete the decoded VIN/ADAS profile is. */
  vinProfileCompleteness: number;
}

const WEIGHTS = { extraction: 0.3, rule: 0.4, oem: 0.2, vin: 0.1 } as const;

export interface ScoredRequirement extends CandidateRequirement {
  confidenceScore: number;
  confidenceBand: ReturnType<typeof bandFor>;
  needsHumanReview: boolean;
  isSupplementCandidate: boolean;
}

export function scoreRequirement(
  candidate: CandidateRequirement,
  signals: ScoringSignals,
): ScoredRequirement {
  const extractionCertainty =
    signals.triggerItems.length === 0
      ? 0.5
      : signals.triggerItems.reduce((s, li) => s + (li.extractionConfidence ?? 0.5), 0) /
        signals.triggerItems.length;

  const oemQuality = signals.hasOemReference ? 1 : 0.4;

  const raw =
    WEIGHTS.extraction * extractionCertainty +
    WEIGHTS.rule * candidate.baseConfidence +
    WEIGHTS.oem * oemQuality +
    WEIGHTS.vin * clamp01(signals.vinProfileCompleteness);

  const confidenceScore = round2(clamp01(raw));
  const confidenceBand = bandFor(confidenceScore);

  return {
    ...candidate,
    confidenceScore,
    confidenceBand,
    // Low-confidence items always require a human and never auto-enter a supplement.
    needsHumanReview: confidenceScore < CONFIDENCE_THRESHOLDS.MEDIUM,
    isSupplementCandidate: confidenceScore >= CONFIDENCE_THRESHOLDS.HIGH,
  };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
