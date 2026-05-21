import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEms } from '../src/parsers/ems.ts';
import { detectFormat, parseEstimateFile } from '../src/parsers/index.ts';

/**
 * Synthetic EMS fixtures. The CIECA EMS spec is fixed at the field-position level, so
 * these mirror the real shape — but production hardening should replace these with
 * real exports from CCC ONE, Mitchell Cloud, and Audatex once we have NDA'd samples.
 */

const cccFixture = [
  'EMS|CCC ONE|6.0|2026-05-20|CLAIM-123',
  'ADM|CCC|PATHWAYS|EST-456',
  'VEH|2HGFC2F59KH500000|2019|HONDA|CIVIC|EX|BLUE',
  'IMP|FRONT|MODERATE',
  'LIN|1|RP|Front Bumper Cover|71101-TBA-A00|1|450.00|450.00|0|0|O',
  'LIN|2|R|R&I Front Bumper|||0|0|0|15|0|',
  'LIN|3|OP|Four Wheel Alignment|||1|120.00|120.00|10|0|',
  'TOT||1170.00',
].join('\n');

const mitchellFixture = [
  'EMS|Mitchell Cloud Estimating|7.2|2026-05-20',
  'ADM|MITCHELL|ULTRAMATE|EST-789',
  'VEH|1FTFW1ET5DFB12345|2013|FORD|F-150|XLT|BLACK',
  'LIN|1|RP|Windshield|FL3Z-1503100-A|1|620.50|620.50|0|0|O',
  'LIN|2|OP|Lane Keep Assist Camera Calibration|||1|225.00|225.00|10|0|',
].join('\n');

const audatexFixture = [
  'EMS|AudaExplore|5.4|2026-05-20',
  'ADM|AUDATEX|SOLERA|EST-001',
  'VEH|5YJ3E1EA5KF300000|2019|TESLA|MODEL 3|LR|WHITE',
  'LIN|1|RP|Front Radar Sensor Assembly|1097395-00-G|1|1450.00|1450.00|0|0|O',
  'LIN|2|OP|Adaptive Cruise Radar Calibration|||1|350.00|350.00|15|0|',
].join('\n');

test('parseEms detects CCC source from header', () => {
  const r = parseEms(cccFixture);
  assert.ok(r.ok, `expected ok parse, got: ${!r.ok && r.error}`);
  if (!r.ok) return;
  assert.equal(r.estimate.source, 'CCC');
});

test('parseEms detects Mitchell source from header', () => {
  const r = parseEms(mitchellFixture);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.estimate.source, 'MITCHELL');
});

test('parseEms detects Audatex source from header', () => {
  const r = parseEms(audatexFixture);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.estimate.source, 'AUDATEX');
});

test('parseEms extracts a valid 17-char VIN from VEH record', () => {
  const r = parseEms(cccFixture);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.estimate.detectedVin, '2HGFC2F59KH500000');
});

test('parseEms produces line items with descriptions and part numbers', () => {
  const r = parseEms(cccFixture);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.estimate.lineItems.length, 3);
  const bumper = r.estimate.lineItems[0];
  assert.equal(bumper.description, 'Front Bumper Cover');
  assert.equal(bumper.oemPartNo, '71101-TBA-A00');
  assert.equal(bumper.type, 'PART');
});

test('parseEms flags ADAS items via keyword sniff', () => {
  const r = parseEms(audatexFixture);
  assert.ok(r.ok);
  if (!r.ok) return;
  const radarSensor = r.estimate.lineItems.find((li) => /Radar Sensor/i.test(li.description));
  assert.ok(radarSensor?.isAdasRelated, 'front radar sensor should be flagged ADAS');
  assert.ok(radarSensor?.affectedSystems.includes('front_radar'));
});

test('parseEms reports higher extraction confidence than OCR pipeline', () => {
  const r = parseEms(cccFixture);
  assert.ok(r.ok);
  if (!r.ok) return;
  for (const li of r.estimate.lineItems) {
    assert.ok(
      (li.extractionConfidence ?? 0) >= 0.85,
      `structured EMS should yield >=0.85 confidence, got ${li.extractionConfidence}`,
    );
  }
});

test('detectFormat identifies EMS files by content sniff', () => {
  assert.equal(detectFormat('estimate.ems', cccFixture), 'EMS');
  assert.equal(detectFormat('estimate.txt', cccFixture), 'EMS');
  assert.equal(detectFormat('estimate.unknown', cccFixture), 'EMS');
});

test('detectFormat identifies PDF by magic bytes even with wrong extension', () => {
  assert.equal(detectFormat('estimate.ems', '%PDF-1.4\nsome bytes'), 'PDF');
});

test('parseEstimateFile dispatches correctly to EMS parser', () => {
  const r = parseEstimateFile('estimate.ems', cccFixture);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.format, 'EMS');
  assert.equal(r.estimate.source, 'CCC');
});

test('parseEstimateFile returns BMS not-implemented for XML', () => {
  const xml = '<?xml version="1.0"?><bms><estimate/></bms>';
  const r = parseEstimateFile('estimate.xml', xml);
  assert.equal(r.ok, false);
  assert.equal(r.format, 'BMS');
});

test('parseEms tolerates CRLF line endings', () => {
  const crlf = cccFixture.replace(/\n/g, '\r\n');
  const r = parseEms(crlf);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.estimate.lineItems.length, 3);
});

test('parseEms emits warnings for malformed records, not errors', () => {
  const broken = cccFixture + '\nLIN|99|RP|||\n';
  const r = parseEms(broken);
  assert.ok(r.ok, 'a malformed LIN should not fail the whole parse');
  if (!r.ok) return;
  assert.ok(r.warnings.length >= 1);
});
