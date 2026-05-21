import { z } from 'zod';
import {
  REQUIREMENT_KINDS,
  ESTIMATE_SOURCES,
  LINE_ITEM_TYPES,
  CONFIDENCE_BANDS,
  ADAS_SYSTEMS,
} from './domain.js';

/**
 * Zod schemas. These are the contract between layers. The AI agents validate their
 * output against these (so a hallucinated shape is rejected, not persisted), the API
 * validates requests, and the web app infers its types from them.
 */

export const vinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(17, 'A VIN must be exactly 17 characters')
  .regex(/^[A-HJ-NPR-Z0-9]+$/, 'VIN contains invalid characters (no I, O, or Q)');

export const adasSystemSchema = z.enum(ADAS_SYSTEMS);

export const adasProfileSchema = z.object({
  system: adasSystemSchema,
  sensors: z.array(z.string()).default([]),
});

export const vinProfileSchema = z.object({
  vin: vinSchema,
  make: z.string().nullable(),
  model: z.string().nullable(),
  trim: z.string().nullable(),
  modelYear: z.number().int().min(1980).max(2100).nullable(),
  adasSystems: z.array(adasProfileSchema).default([]),
});
export type VinProfile = z.infer<typeof vinProfileSchema>;

/** Output shape the Estimate Parsing Agent must conform to. */
export const parsedLineItemSchema = z.object({
  type: z.enum(LINE_ITEM_TYPES),
  description: z.string().min(1),
  oemPartNo: z.string().nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  laborHours: z.number().nonnegative().nullable().optional(),
  impactZone: z.string().nullable().optional(),
  isAdasRelated: z.boolean().default(false),
  affectedSystems: z.array(adasSystemSchema).default([]),
  extractionConfidence: z.number().min(0).max(1).default(0.5),
});
export type ParsedLineItem = z.infer<typeof parsedLineItemSchema>;

export const parsedEstimateSchema = z.object({
  source: z.enum(ESTIMATE_SOURCES),
  detectedVin: vinSchema.nullable().optional(),
  lineItems: z.array(parsedLineItemSchema),
});
export type ParsedEstimate = z.infer<typeof parsedEstimateSchema>;

/** A candidate requirement emitted by the rules engine (pre-explanation). */
export const candidateRequirementSchema = z.object({
  kind: z.enum(REQUIREMENT_KINDS),
  ruleId: z.string().nullable(),
  triggeredByItems: z.array(z.string()).default([]),
  baseConfidence: z.number().min(0).max(1),
  rationale: z.string(),
  oemProcedureIds: z.array(z.string()).default([]),
});
export type CandidateRequirement = z.infer<typeof candidateRequirementSchema>;

/** Final, user-facing requirement after explanation + confidence scoring. */
export const requirementResultSchema = candidateRequirementSchema.extend({
  explanation: z.string(),
  confidenceScore: z.number().min(0).max(1),
  confidenceBand: z.enum(CONFIDENCE_BANDS),
  needsHumanReview: z.boolean(),
  isSupplementCandidate: z.boolean(),
});
export type RequirementResult = z.infer<typeof requirementResultSchema>;

/** API request DTOs. */
export const decodeVinRequestSchema = z.object({ vin: vinSchema });
export const acknowledgeRequestSchema = z.object({
  statement: z.string().min(1),
});
