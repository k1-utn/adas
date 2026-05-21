import type { ParsedEstimate, ParsedLineItem } from '../schemas.js';
import { parsedEstimateSchema, vinSchema } from '../schemas.js';
import type { EstimateSource, LineItemType, AdasSystem } from '../domain.js';
import type { ParseResult } from './types.js';

/**
 * CIECA EMS (Estimate Management Standard) parser.
 *
 * EMS is the industry-standard pipe-delimited text export produced by CCC ONE,
 * Mitchell Cloud Estimating, and Audatex/Solera. The estimating system writes a file
 * (commonly .EMS, .TXT, or vendor-specific extensions like .CIF) that the shop sends
 * to insurers. Same shape, same field positions, regardless of vendor — that is the
 * point of the standard.
 *
 * Record structure (one record per newline-terminated line):
 *
 *   <record_id>|<field1>|<field2>|...|<fieldN>
 *
 * Common record IDs we care about:
 *   EMS  header (sender / vendor identifying info — used for source detection)
 *   ADM  administrative (file/claim metadata)
 *   VEH  vehicle (VIN, year, make, model, trim, color)
 *   IMP  impact / damage zones
 *   LIN  line item (op code, description, part number, labor units, paint units, $)
 *   TOT  totals
 *
 * IMPORTANT — production hardening:
 *   The CIECA EMS spec is ~100 pages of field-by-field definitions. This parser
 *   reads the load-bearing fields the rules engine needs (VIN, vehicle ID,
 *   operation code, description, part number, labor hours). Vendor exports include
 *   extensions and occasional column shifts; harden with real fixture files before
 *   trusting in production. Unknown record IDs are skipped (forward-compatible).
 */

const RECORD_DELIM = '\n';
const FIELD_DELIM = '|';

interface EmsRecord {
  id: string;
  fields: string[];
  /** 1-based line number for error reporting. */
  line: number;
}

export function parseEms(input: string): ParseResult {
  const warnings: string[] = [];

  const records = tokenize(input);
  if (records.length === 0) {
    return { ok: false, format: 'EMS', error: 'Empty or unreadable EMS file' };
  }

  const source = detectSource(records);
  const detectedVin = extractVin(records, warnings);
  const vehicleHints = extractVehicleHints(records);
  const lineItems = extractLineItems(records, vehicleHints, warnings);

  const candidate: ParsedEstimate = {
    source,
    detectedVin: detectedVin ?? undefined,
    lineItems,
  };

  const safe = parsedEstimateSchema.safeParse(candidate);
  if (!safe.success) {
    return {
      ok: false,
      format: 'EMS',
      error: `EMS produced output that failed schema validation: ${safe.error.message}`,
    };
  }

  return { ok: true, format: 'EMS', estimate: safe.data, warnings };
}

function tokenize(input: string): EmsRecord[] {
  // EMS files in the wild use CRLF, LF, or occasionally CR — normalize.
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(RECORD_DELIM);
  const records: EmsRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const fields = raw.split(FIELD_DELIM);
    const id = (fields[0] ?? '').trim().toUpperCase();
    if (!id) continue;
    records.push({ id, fields, line: i + 1 });
  }
  return records;
}

function detectSource(records: EmsRecord[]): EstimateSource {
  // The EMS header (record id "EMS") generally encodes the sending system in one of the
  // early fields. Vendors don't all populate it identically, so we sniff multiple records
  // for a recognizable vendor token.
  const haystack = records
    .filter((r) => r.id === 'EMS' || r.id === 'ADM')
    .flatMap((r) => r.fields)
    .join(' ')
    .toUpperCase();

  if (/\bCCC\b|PATHWAYS|CCC\s*ONE|CCCIS/.test(haystack)) return 'CCC';
  if (/\bMITCHELL\b|ULTRAMATE|MITCHELL\s*CLOUD/.test(haystack)) return 'MITCHELL';
  if (/\bAUDATEX\b|SOLERA|AUDAEXPLORE/.test(haystack)) return 'AUDATEX';
  return 'UNKNOWN';
}

function extractVin(records: EmsRecord[], warnings: string[]): string | null {
  // Per EMS spec the VEH record carries the VIN. Vendors vary in field position, so we
  // scan every VEH field for a 17-char VIN-shaped token. Defensive but accurate.
  const vehRecords = records.filter((r) => r.id === 'VEH');
  for (const rec of vehRecords) {
    for (const field of rec.fields) {
      const candidate = field.trim().toUpperCase();
      const parsed = vinSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }
  }
  if (vehRecords.length > 0) {
    warnings.push('VEH record(s) present but no valid 17-char VIN found');
  }
  return null;
}

interface VehicleHints {
  year: number | null;
  make: string | null;
  model: string | null;
}

function extractVehicleHints(records: EmsRecord[]): VehicleHints {
  // Best-effort, not load-bearing — the rules engine reads from the VinRecord, which
  // was decoded via NHTSA. We only collect hints here so they can be surfaced in
  // warnings/diagnostics if the EMS vehicle and the decoded vehicle disagree.
  const veh = records.find((r) => r.id === 'VEH');
  if (!veh) return { year: null, make: null, model: null };

  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;

  for (const field of veh.fields) {
    const trimmed = field.trim();
    if (!trimmed) continue;
    if (!year && /^(19|20)\d{2}$/.test(trimmed)) {
      year = Number(trimmed);
      continue;
    }
    if (!make && /^[A-Z][A-Z -]{1,20}$/.test(trimmed.toUpperCase()) && trimmed.length <= 20) {
      make = trimmed.toUpperCase();
      continue;
    }
    if (make && !model && /^[A-Z0-9][A-Z0-9 -]{1,30}$/i.test(trimmed)) {
      model = trimmed.toUpperCase();
    }
  }
  return { year, make, model };
}

function extractLineItems(
  records: EmsRecord[],
  _vehicle: VehicleHints,
  warnings: string[],
): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];
  for (const rec of records.filter((r) => r.id === 'LIN')) {
    const item = parseLineItem(rec, warnings);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Parse a single LIN record. Field positions vary slightly by vendor; the resilient
 * approach is to (1) try positional reads against the most common layout, then
 * (2) scan unmatched fields for recognizable values (part-number-shaped, hour-shaped).
 */
function parseLineItem(rec: EmsRecord, warnings: string[]): ParsedLineItem | null {
  // Common LIN layout (fields after the record-id at index 0):
  //   1 line number
  //   2 operation code (R=Repair, P=Paint, B=Blend, RP=Replace, OP=Operation, S=Sublet)
  //   3 description
  //   4 part number (OEM or aftermarket)
  //   5 quantity
  //   6 unit price
  //   7 extended price
  //   8 labor units (tenths of an hour, e.g. "23" = 2.3 hrs in some exports, or "2.3" literal)
  //   9 paint units
  //  10 part type (O=OEM, A=Aftermarket, U=Used, R=Reconditioned)
  const fields = rec.fields;
  const opCode = (fields[2] ?? '').trim().toUpperCase();
  const description = (fields[3] ?? '').trim();
  const partNo = (fields[4] ?? '').trim() || null;
  const qty = parseNumber(fields[5]);
  const laborUnits = parseLaborHours(fields[8]);
  const paintUnits = parseLaborHours(fields[9]);

  if (!description) {
    warnings.push(`LIN at line ${rec.line} skipped: empty description`);
    return null;
  }

  const type = mapOperationCodeToType(opCode);
  const laborHours = sumDefined(laborUnits, paintUnits);
  const { isAdasRelated, affectedSystems, impactZone } = sniffAdas(description, opCode);

  const extractionConfidence = description.length > 0 && (qty !== null || laborHours !== null)
    ? 0.95   // structured EMS — much higher than OCR extraction
    : 0.85;

  return {
    type,
    description,
    oemPartNo: partNo,
    quantity: qty,
    laborHours,
    impactZone,
    isAdasRelated,
    affectedSystems,
    extractionConfidence,
  };
}

function mapOperationCodeToType(code: string): LineItemType {
  switch (code) {
    case 'R':
    case 'REPAIR':
      return 'LABOR';
    case 'P':
    case 'B':
    case 'PAINT':
    case 'BLEND':
      return 'LABOR';
    case 'RP':
    case 'REPLACE':
      return 'PART';
    case 'S':
    case 'SUBLET':
      return 'SUBLET';
    case 'OP':
    case 'OPERATION':
      return 'OPERATION';
    case '':
      return 'MISC';
    default:
      return 'OPERATION';
  }
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Labor units in EMS can be either:
 *  - decimal hours: "2.3"
 *  - tenths of an hour as integer: "23" meaning 2.3
 * We use a heuristic: a value with no decimal point and >= 10 is likely tenths.
 * Real vendor fixtures should refine this.
 */
function parseLaborHours(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  if (cleaned.includes('.')) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const intN = Number(cleaned);
  if (!Number.isFinite(intN)) return null;
  // Heuristic: small integers (0-9) treat as whole hours; >=10 treat as tenths.
  return intN >= 10 ? intN / 10 : intN;
}

function sumDefined(...values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

interface AdasSniff {
  isAdasRelated: boolean;
  affectedSystems: AdasSystem[];
  impactZone: string | null;
}

/**
 * Lightweight keyword sniff so the rules engine has hints to work with. The deterministic
 * rules engine is still the source of truth — this just pre-populates obvious flags so we
 * don't lose information from the structured input. False negatives here are OK; the rules
 * engine catches them by part number / position. False positives are OK too; the engine
 * gates by VIN profile.
 */
function sniffAdas(description: string, _opCode: string): AdasSniff {
  const text = description.toUpperCase();
  const systems = new Set<AdasSystem>();

  if (/\b(FRONT|FWD)\s*(RADAR|ACC SENSOR)\b|ADAPTIVE\s*CRUISE/.test(text)) systems.add('front_radar');
  if (/\b(FRONT|WINDSHIELD)\s*CAMERA\b|LANE\s*KEEP|LKAS|LDW/.test(text)) systems.add('front_camera');
  if (/\bLKAS\b|LANE[- ]KEEP/.test(text)) systems.add('lkas_camera');
  if (/\b(REAR)\s*RADAR\b|CROSS\s*TRAFFIC/.test(text)) systems.add('rear_radar');
  if (/\bBLIND\s*SPOT\b|BSM\b|BSD\b/.test(text)) systems.add('blind_spot_radar');
  if (/\b(SURROUND|360|BIRDSEYE|BIRD'S?\s*EYE)\b/.test(text)) systems.add('surround_camera');
  if (/\b(PARK\s*ASSIST|PDC|PARKING\s*SENSOR|ULTRASONIC)\b/.test(text)) systems.add('parking_sensors');
  if (/\bSTEERING\s*ANGLE\b|SAS\b/.test(text)) systems.add('steering_angle_sensor');

  // Sensor-mounting structures: bumpers, grilles, windshields near sensors. Flag for the
  // rules engine to consider, but no specific system without VIN cross-reference.
  const mountingStructure = /\b(BUMPER|GRILLE|WINDSHIELD|QUARTER\s*PANEL|FENDER|EMBLEM)\b/.test(text);

  let impactZone: string | null = null;
  if (/\bFRONT|FRT\b/.test(text)) impactZone = 'front';
  else if (/\bREAR\b/.test(text)) impactZone = 'rear';
  else if (/\bLEFT|LH|DRIVER\b/.test(text)) impactZone = 'left';
  else if (/\bRIGHT|RH|PASS(ENGER)?\b/.test(text)) impactZone = 'right';

  return {
    isAdasRelated: systems.size > 0 || mountingStructure,
    affectedSystems: Array.from(systems),
    impactZone,
  };
}
