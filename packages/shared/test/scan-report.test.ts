import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScanReport } from '../src/parsers/scan-report.ts';

/**
 * Synthetic scan-report fixtures. These mirror the shape of real PDF-extracted text
 * from each tool. Production hardening requires sample exports from each vendor +
 * software version — these tests prove the structure works, not the layout coverage.
 */

const boschPreScan = `
Bosch ADS 625
Pre-Repair Scan Report
Generated: 2026-05-20 14:32:00

Vehicle: 2019 HONDA CIVIC EX
VIN: 2HGFC2F59KH500000

Modules Scanned: ECM, TCM, ABS, SRS, EPS, SAS, ACC

ABS Module
  C0051:00 active — Steering Angle Sensor Performance
  C0561:71 stored — VSA System Disabled

SRS Module
  B1234:11 active — Driver Front Impact Sensor Open Circuit

ACC Module
  U0428:00 active — Lost Communication With Steering Angle Sensor

EPS Module
  C1611 stored — Battery Voltage Low
`;

const autelPostScan = `
Autel MaxiSys MS909
Post-Repair Scan Report

Date: 05/20/2026 16:45
VIN: 1FTFW1ET5DFB12345
Vehicle: 2013 FORD F-150 XLT

System Scan Results:
  ECM: No DTCs found
  TCM: No DTCs found
  ABS: No DTCs found
  SRS: No DTCs found
  BCM: 1 DTC

BCM Module
  B1318 history — Battery Voltage Low (resolved)

All other modules report no active DTCs.
`;

const snapOnCleanScan = `
Snap-on Zeus
Post-Scan
Tech: John Smith
Shop: ACME Collision

Vehicle: 2020 TOYOTA CAMRY SE
VIN: 4T1B11HK5LU000001

Date: 2026-05-20T17:00:00

Modules: ECM, TCM, ABS, SRS, BCM, EPS, ACC, LKA

Scan complete. No DTCs found in any module.
`;

const launchMixedScan = `
LAUNCH X431 PRO5
Pre-Scan Report

VIN: 5YJ3E1EA5KF300000
2019 TESLA MODEL 3 LR

03/15/2026 09:15

Body Control:
  U0140:00 — Lost Communication With Body Control Module (active)
  U0151:00 — Lost Communication With Restraints Control Module (stored)

Forward Camera:
  P0AB0 — Hybrid/EV Battery Voltage Sensor (history)
`;

test('parseScanReport detects Bosch vendor from header', () => {
  const r = parseScanReport({ filename: 'pre_scan.pdf', text: boschPreScan });
  assert.ok(r.ok, r.error);
  assert.equal(r.report?.vendor, 'BOSCH');
});

test('parseScanReport detects Autel vendor from header', () => {
  const r = parseScanReport({ filename: 'post.pdf', text: autelPostScan });
  assert.ok(r.ok);
  assert.equal(r.report?.vendor, 'AUTEL');
});

test('parseScanReport detects Snap-on vendor from header', () => {
  const r = parseScanReport({ filename: 'scan.pdf', text: snapOnCleanScan });
  assert.ok(r.ok);
  assert.equal(r.report?.vendor, 'SNAP_ON');
});

test('parseScanReport detects Launch vendor from header', () => {
  const r = parseScanReport({ filename: 'launch.pdf', text: launchMixedScan });
  assert.ok(r.ok);
  assert.equal(r.report?.vendor, 'LAUNCH');
});

test('parseScanReport identifies pre-scan from title', () => {
  const r = parseScanReport({ filename: 'unknown.pdf', text: boschPreScan });
  assert.ok(r.ok);
  assert.equal(r.report?.phase, 'PRE');
});

test('parseScanReport identifies post-scan from title', () => {
  const r = parseScanReport({ filename: 'unknown.pdf', text: autelPostScan });
  assert.ok(r.ok);
  assert.equal(r.report?.phase, 'POST');
});

test('parseScanReport falls back to filename for phase detection', () => {
  // Strip the obvious "Pre-Repair Scan" header but keep "pre_scan" in filename
  const stripped = boschPreScan.replace('Pre-Repair Scan Report', 'Scan Report');
  const r = parseScanReport({ filename: 'pre_scan_2026.pdf', text: stripped });
  assert.ok(r.ok);
  assert.equal(r.report?.phase, 'PRE');
});

test('parseScanReport extracts valid VIN', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: boschPreScan });
  assert.ok(r.ok);
  assert.equal(r.report?.vin, '2HGFC2F59KH500000');
});

test('parseScanReport extracts vehicle description', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: boschPreScan });
  assert.ok(r.ok);
  assert.equal(r.report?.vehicleText, '2019 HONDA CIVIC EX');
});

test('parseScanReport extracts ISO timestamp', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: boschPreScan });
  assert.ok(r.ok);
  assert.match(r.report?.scannedAt ?? '', /^2026-05-20/);
});

test('parseScanReport extracts US-format timestamp', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: autelPostScan });
  assert.ok(r.ok);
  assert.equal(r.report?.scannedAt, '2026-05-20T16:45:00');
});

test('parseScanReport extracts all DTCs across modules', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: boschPreScan });
  assert.ok(r.ok);
  const codes = r.report?.dtcs.map((d) => d.code) ?? [];
  assert.ok(codes.includes('C0051:00'));
  assert.ok(codes.includes('B1234:11'));
  assert.ok(codes.includes('U0428:00'), 'should include the ACC comms-loss code');
  assert.ok(codes.includes('C1611'), 'should include the EPS battery code (no suffix)');
});

test('parseScanReport associates DTCs with their module', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: boschPreScan });
  assert.ok(r.ok);
  const u0428 = r.report?.dtcs.find((d) => d.code === 'U0428:00');
  assert.equal(u0428?.module, 'ACC');
});

test('parseScanReport captures DTC status (active/stored/history)', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: boschPreScan });
  assert.ok(r.ok);
  const u0428 = r.report?.dtcs.find((d) => d.code === 'U0428:00');
  assert.equal(u0428?.status, 'active');
  const c0561 = r.report?.dtcs.find((d) => d.code === 'C0561:71');
  assert.equal(c0561?.status, 'stored');
});

test('parseScanReport dedupes the same DTC code', () => {
  const dupes = boschPreScan + '\nDuplicate section:\nU0428:00 active — Lost Communication With Steering Angle Sensor\n';
  const r = parseScanReport({ filename: 'x.pdf', text: dupes });
  assert.ok(r.ok);
  const u0428Count = r.report?.dtcs.filter((d) => d.code === 'U0428:00').length ?? 0;
  assert.equal(u0428Count, 1, 'same code reported in two sections should dedupe');
});

test('parseScanReport handles clean post-scan (no DTCs) with warning', () => {
  const r = parseScanReport({ filename: 'post.pdf', text: snapOnCleanScan });
  assert.ok(r.ok);
  assert.equal(r.report?.dtcs.length, 0);
  assert.ok(r.warnings.length >= 1, 'clean scan should emit a warning explaining absence');
});

test('parseScanReport extracts modules scanned', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: boschPreScan });
  assert.ok(r.ok);
  const modules = r.report?.modulesScanned ?? [];
  assert.ok(modules.includes('ABS'));
  assert.ok(modules.includes('SRS'));
  assert.ok(modules.includes('ACC'));
});

test('parseScanReport rejects empty input', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: '   ' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /empty/i);
});

test('parseScanReport handles mixed-format DTCs (Launch)', () => {
  const r = parseScanReport({ filename: 'x.pdf', text: launchMixedScan });
  assert.ok(r.ok);
  const codes = r.report?.dtcs.map((d) => d.code) ?? [];
  assert.ok(codes.includes('U0140:00'));
  assert.ok(codes.includes('U0151:00'));
  assert.ok(codes.includes('P0AB0'));
});
