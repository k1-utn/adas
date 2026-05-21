import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRuleset } from '../src/rules/engine.ts';
import { STARTER_RULES } from '../src/rules/ruleset.ts';
import { scoreRequirement } from '../src/agents/confidence-scoring.agent.ts';
import { runPipeline } from '../src/agents/orchestrator.ts';
import { StubLlmProvider } from '../src/providers/provider.ts';

const hondaCivic = {
  vin: '2HGFC2F59KH500000',
  make: 'Honda',
  model: 'Civic',
  trim: 'EX',
  modelYear: 2019,
  adasSystems: [
    { system: 'front_radar', sensors: ['front_radar'] },
    { system: 'lkas_camera', sensors: ['windshield_camera'] },
  ],
};

test('front bumper replacement on radar-equipped car triggers radar calibration', () => {
  const lineItems = [
    {
      id: 'li_0',
      type: 'PART',
      description: 'Front Bumper Cover',
      isAdasRelated: true,
      affectedSystems: ['front_radar'],
      extractionConfidence: 0.9,
    },
  ];
  const candidates = evaluateRuleset(STARTER_RULES, { vin: hondaCivic, lineItems });
  const kinds = candidates.map((c) => c.kind);
  assert.ok(kinds.includes('RADAR_CALIBRATION'), 'expected radar calibration to fire');
  assert.ok(kinds.includes('PRE_SCAN') && kinds.includes('POST_SCAN'), 'scans always fire');
});

test('rule does not fire for a system the vehicle lacks', () => {
  const noRadar = { ...hondaCivic, adasSystems: [] };
  const lineItems = [
    {
      id: 'li_0',
      type: 'PART',
      description: 'Front Bumper Cover',
      isAdasRelated: false,
      affectedSystems: [],
      extractionConfidence: 0.9,
    },
  ];
  const candidates = evaluateRuleset(STARTER_RULES, { vin: noRadar, lineItems });
  assert.ok(!candidates.some((c) => c.kind === 'RADAR_CALIBRATION'));
});

test('confidence scoring puts OEM-referenced exact rule in HIGH band', () => {
  const scored = scoreRequirement(
    {
      kind: 'CAMERA_AIMING',
      ruleId: 'rule_windshield_camera_aim',
      triggeredByItems: ['li_0'],
      baseConfidence: 0.92,
      rationale: 'x',
      oemProcedureIds: ['oem_1'],
    },
    {
      triggerItems: [
        { type: 'PART', description: 'windshield', isAdasRelated: true, affectedSystems: [], extractionConfidence: 0.95 },
      ],
      hasOemReference: true,
      vinProfileCompleteness: 1,
    },
  );
  assert.equal(scored.confidenceBand, 'HIGH');
  assert.equal(scored.isSupplementCandidate, true);
});

test('full pipeline runs end-to-end with the stub provider', async () => {
  const parsed = JSON.stringify({
    source: 'CCC',
    detectedVin: hondaCivic.vin,
    lineItems: [
      { type: 'PART', description: 'Front Bumper Cover', isAdasRelated: true, affectedSystems: ['front_radar'], extractionConfidence: 0.9, impactZone: 'front' },
      { type: 'OPERATION', description: 'Four wheel alignment', isAdasRelated: false, affectedSystems: [], extractionConfidence: 0.8 },
    ],
  });
  const provider = new StubLlmProvider({ 'estimate-parse@1.1.0': parsed });
  const out = await runPipeline(provider, { ocrText: 'raw', vin: hondaCivic, rules: STARTER_RULES });

  assert.ok(out.requirements.length > 0, 'pipeline produced requirements');
  assert.ok(out.trace.find((t) => t.agent === 'ESTIMATE_PARSING' && t.status === 'ok'));
  assert.ok(out.requirements.every((r) => r.confidenceBand), 'every requirement has a band');
  // Alignment present, so the "missing alignment" gap should NOT fire.
  assert.ok(!out.complianceGaps.some((g) => g.includes('no wheel alignment')));
});
