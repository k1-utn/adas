import type {
  AdasSystem,
  CandidateRequirement,
  ParsedLineItem,
  RequirementKind,
  VinProfile,
} from '@adas/shared';

/**
 * CALIBRATION RULES ENGINE — the deterministic source of truth.
 *
 * The LLM agents normalize estimates and explain results, but THIS decides what is
 * actually required. A rule is pure data + a predicate. Insurers contest AI output;
 * they contest a documented, versioned OEM rule far less. That is the whole point of
 * keeping this layer deterministic and separate.
 *
 * In production these rules live in the database (CalibrationRule table) and are loaded
 * at runtime. This module defines the *evaluation logic* and a typed in-memory ruleset
 * used for seeding and tests.
 */

export interface RulePredicate {
  /** Fires if the vehicle is equipped with ANY of these systems. */
  anySystem?: AdasSystem[];
  /** Fires only for these makes (case-insensitive). Omit = all makes. */
  makeIn?: string[];
  /** Inclusive model-year window. */
  yearFrom?: number;
  yearTo?: number;
  /** Fires if a parsed line item touches any of these impact zones. */
  impactZoneIn?: string[];
  /** Fires if a parsed line item description matches any of these (lowercased substring). */
  descriptionContains?: string[];
}

export interface CalibrationRuleDef {
  id: string;
  kind: RequirementKind;
  predicate: RulePredicate;
  /** Human-readable WHY — fed to the explanation agent as grounding. */
  rationale: string;
  /** Baseline confidence before signal adjustments. Exact OEM rules score higher. */
  baseConfidence: number;
  /** OEM procedure ids this rule is grounded in (FKs in prod). */
  oemProcedureIds?: string[];
  version: string;
}

export interface RuleEvaluationInput {
  vin: VinProfile;
  lineItems: (ParsedLineItem & { id: string })[];
}

const equippedSystems = (vin: VinProfile): Set<AdasSystem> =>
  new Set(vin.adasSystems.map((s) => s.system));

const inYearWindow = (year: number | null, from?: number, to?: number): boolean => {
  if (year == null) return true; // unknown year shouldn't suppress a safety-relevant rule
  if (from != null && year < from) return false;
  if (to != null && year > to) return false;
  return true;
};

const makeMatches = (vin: VinProfile, makeIn?: string[]): boolean => {
  if (!makeIn || makeIn.length === 0) return true;
  if (!vin.make) return false;
  return makeIn.some((m) => m.toLowerCase() === vin.make!.toLowerCase());
};

/**
 * Evaluate one rule against an estimate. Returns a candidate requirement if it fires,
 * along with the specific line item ids that triggered it (for traceability).
 */
export function evaluateRule(
  rule: CalibrationRuleDef,
  input: RuleEvaluationInput,
): CandidateRequirement | null {
  const { vin, lineItems } = input;
  const p = rule.predicate;

  if (!makeMatches(vin, p.makeIn)) return null;
  if (!inYearWindow(vin.modelYear, p.yearFrom, p.yearTo)) return null;

  // System gate: if the rule requires a system, the vehicle must be equipped with it.
  const systems = equippedSystems(vin);
  const systemOk =
    !p.anySystem || p.anySystem.length === 0 || p.anySystem.some((s) => systems.has(s));
  if (!systemOk) return null;

  // Determine which line items triggered the rule (zone / description / affected system).
  const triggers = lineItems.filter((li) => {
    const zoneHit =
      !p.impactZoneIn ||
      (li.impactZone != null && p.impactZoneIn.includes(li.impactZone));
    const descHit =
      !p.descriptionContains ||
      p.descriptionContains.some((needle) =>
        li.description.toLowerCase().includes(needle.toLowerCase()),
      );
    const systemHit =
      !p.anySystem ||
      li.affectedSystems.some((s) => (p.anySystem as AdasSystem[]).includes(s));

    // A line item triggers the rule if it satisfies the *constrained* dimensions.
    // Unconstrained dimensions (undefined predicate fields) don't filter anything out.
    return zoneHit && descHit && systemHit;
  });

  // If the predicate constrains line-item dimensions but nothing matched, it doesn't fire.
  const constrainsLineItems =
    p.impactZoneIn != null || p.descriptionContains != null || p.anySystem != null;
  if (constrainsLineItems && triggers.length === 0) return null;

  return {
    kind: rule.kind,
    ruleId: rule.id,
    triggeredByItems: triggers.map((t) => t.id),
    baseConfidence: rule.baseConfidence,
    rationale: rule.rationale,
    oemProcedureIds: rule.oemProcedureIds ?? [],
  };
}

/** Evaluate the full ruleset, de-duplicating by requirement kind (highest confidence wins). */
export function evaluateRuleset(
  rules: CalibrationRuleDef[],
  input: RuleEvaluationInput,
): CandidateRequirement[] {
  const fired = rules
    .filter((r) => true)
    .map((r) => evaluateRule(r, input))
    .filter((c): c is CandidateRequirement => c !== null);

  // Collapse duplicates of the same kind, keeping the strongest and merging triggers.
  const byKind = new Map<RequirementKind, CandidateRequirement>();
  for (const c of fired) {
    const existing = byKind.get(c.kind);
    if (!existing) {
      byKind.set(c.kind, c);
      continue;
    }
    const merged: CandidateRequirement = {
      ...(c.baseConfidence >= existing.baseConfidence ? c : existing),
      triggeredByItems: Array.from(
        new Set([...existing.triggeredByItems, ...c.triggeredByItems]),
      ),
      oemProcedureIds: Array.from(
        new Set([...existing.oemProcedureIds, ...c.oemProcedureIds]),
      ),
    };
    byKind.set(c.kind, merged);
  }
  return [...byKind.values()];
}
