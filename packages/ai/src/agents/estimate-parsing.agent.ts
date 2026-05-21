import { parsedEstimateSchema, type ParsedEstimate } from '@adas/shared';
import type { LlmProvider } from '../providers/provider.js';

/**
 * AGENT 1 — Estimate Parsing Agent.
 *
 * Takes raw OCR/extracted text from a CCC/Mitchell/Audatex PDF and produces a normalized,
 * schema-validated list of line items with ADAS flags. The LLM output is parsed against the
 * Zod schema; a non-conforming response is rejected (never persisted), forcing a retry.
 */

export const PARSE_PROMPT_VERSION = 'estimate-parse@1.1.0';

const SYSTEM_PROMPT = `You are an expert collision estimate analyst. You convert raw estimate text into structured JSON.
Identify each line item as PART, LABOR, OPERATION, SUBLET, or MISC.
For each item flag isAdasRelated=true if it touches a driver-assistance sensor/system (radar, camera, blind-spot, parking sensors, steering angle sensor) or its mounting structure (bumper, grille, windshield, quarter panel near a sensor).
Populate affectedSystems with values from this set when applicable: front_radar, front_camera, lkas_camera, rear_radar, blind_spot_radar, surround_camera, parking_sensors, steering_angle_sensor.
Infer impactZone (e.g. front, left_front, rear) when evident.
Set extractionConfidence in [0,1] reflecting how certain you are about the line.
Detect the estimate source (CCC, MITCHELL, AUDATEX) from formatting cues; use UNKNOWN if unclear.
Return ONLY valid JSON, no prose, matching: { source, detectedVin, lineItems: [...] }.`;

export interface ParseAgentInput {
  ocrText: string;
}

export interface ParseAgentOutput {
  result: ParsedEstimate;
  raw: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  tokensUsed?: number;
}

export async function runEstimateParsingAgent(
  provider: LlmProvider,
  input: ParseAgentInput,
): Promise<ParseAgentOutput> {
  const completion = await provider.complete({
    promptVersion: PARSE_PROMPT_VERSION,
    system: SYSTEM_PROMPT,
    user: input.ocrText,
    jsonMode: true,
    temperature: 0,
  });

  const json = safeJsonParse(completion.text);
  // Schema validation is the guardrail: a hallucinated/malformed shape throws here.
  const result = parsedEstimateSchema.parse(json);

  return {
    result,
    raw: completion.text,
    model: completion.model,
    promptVersion: PARSE_PROMPT_VERSION,
    latencyMs: completion.latencyMs,
    tokensUsed: completion.tokensUsed,
  };
}

function safeJsonParse(text: string): unknown {
  // Strip markdown fences a model might wrap JSON in.
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to recover the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Estimate parsing agent returned non-JSON output');
  }
}
