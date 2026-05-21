import {
  scanReportSchema,
  type ScanReport,
  type ScanToolVendor,
  type ScanPhase,
  type Dtc,
} from './scan-report.schema.js';
import { vinSchema } from '../schemas.js';

/**
 * Scan-report text parser.
 *
 * Input is the extracted text from a scan-tool PDF (Bosch ADS, Autel MaxiSys, Snap-on,
 * Launch X431, asTech Repairify). The PDF → text step happens elsewhere (pdf-parse or
 * OCR via Textract/DocAI); this module operates on text only so the same code path
 * also handles pasted text and future structured JSON exports.
 *
 * Strategy: deterministic and vendor-agnostic where possible.
 *   - DTC regex (P/B/C/U + 4 hex digits) is a stable industry standard
 *   - Vendor detection by header keyword
 *   - Pre/post phase detection by filename + title cues
 *   - Module + description extraction is per-vendor (most tools print one DTC per line
 *     with the module label nearby — we capture context windows around each DTC match)
 *
 * Production hardening note: tested against the public spec + synthetic fixtures.
 * Real vendor reports have layout drift between software versions; the parser is
 * designed to fail soft (emit warnings, keep going) rather than reject the report.
 */

export interface ParseScanReportInput {
  /** Filename (used for pre/post detection by convention). */
  filename: string;
  /** Extracted text content from the PDF (or pasted text). */
  text: string;
}

export interface ParseScanReportResult {
  ok: boolean;
  report?: ScanReport;
  warnings: string[];
  error?: string;
}

const DTC_REGEX = /\b([PBCU][0-9A-F]{4})(?::([0-9A-F][0-9A-F-]*))?\b/gi;

export function parseScanReport(input: ParseScanReportInput): ParseScanReportResult {
  const warnings: string[] = [];
  if (!input.text || input.text.trim().length === 0) {
    return { ok: false, warnings, error: 'Empty scan report text' };
  }

  const vendor = detectVendor(input.text);
  const phase = detectPhase(input.filename, input.text);
  const vin = extractVin(input.text);
  const vehicleText = extractVehicleText(input.text);
  const scannedAt = extractTimestamp(input.text);
  const modulesScanned = extractModulesScanned(input.text);
  const dtcs = extractDtcs(input.text, warnings);

  const candidate: ScanReport = {
    vendor,
    phase,
    vin,
    vehicleText,
    scannedAt,
    modulesScanned,
    dtcs,
  };

  const safe = scanReportSchema.safeParse(candidate);
  if (!safe.success) {
    return {
      ok: false,
      warnings,
      error: `Scan report failed schema validation: ${safe.error.message}`,
    };
  }
  return { ok: true, report: safe.data, warnings };
}

function detectVendor(text: string): ScanToolVendor {
  const upper = text.toUpperCase();
  // Order matters: more specific tokens first.
  if (/\bAUTEL\b|MAXISYS|MAXICHECK|MAXIDIAG/.test(upper)) return 'AUTEL';
  if (/\bBOSCH\b|\bADS\s*\d|\bKTS\s*\d/.test(upper)) return 'BOSCH';
  if (/SNAP[- ]?ON|SOLUS\b|MODIS\b|TRITON\b|\bZEUS\b|APOLLO\b/.test(upper)) return 'SNAP_ON';
  if (/\bLAUNCH\b|X-?431|SCANPAD/.test(upper)) return 'LAUNCH';
  if (/ASTECH|REPAIRIFY/.test(upper)) return 'ASTECH';
  if (/\bGDS\b|\bTECH\s*2\b|\bIDS\b|\bMDI\b/.test(upper)) return 'OEM_TOOL';
  return 'UNKNOWN';
}

function detectPhase(filename: string, text: string): ScanPhase {
  const haystack = `${filename}\n${text.slice(0, 400)}`.toLowerCase();
  // Post-scan often labeled "post-repair scan", "post scan", "post-repair", etc.
  // Order matters: check POST before PRE because "post-repair" contains "re".
  if (/post[\s_-]*(repair[\s_-]*)?scan|post[\s_-]*scan|post[\s_-]*repair/.test(haystack)) return 'POST';
  if (/pre[\s_-]*(repair[\s_-]*)?scan|pre[\s_-]*scan|initial\s*scan|incoming\s*scan/.test(haystack)) return 'PRE';
  return 'UNKNOWN';
}

function extractVin(text: string): string | null {
  // VINs print in the header somewhere; scan all 17-char VIN-shaped tokens until a valid one.
  const matches = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/gi) ?? [];
  for (const m of matches) {
    const parsed = vinSchema.safeParse(m);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function extractVehicleText(text: string): string | null {
  // Capture "YYYY MAKE MODEL [TRIM]" on a single line.
  // [^\S\n] = horizontal whitespace only — never cross a newline (otherwise the regex
  // gobbles into the next line, e.g. "2019 HONDA CIVIC EX VIN").
  // Anchor the trailing word with a lookahead so "VIN" on the next line can't pull in.
  const m = text.match(
    /\b((?:19|20)\d{2})[ \t]+([A-Z][A-Z -]{2,20}?)[ \t]+([A-Z0-9][A-Z0-9 -]{1,20}?)(?=[ \t]*(?:\n|$))/m,
  );
  if (!m) return null;
  return `${m[1]} ${m[2].trim()} ${m[3].trim()}`.trim();
}

function extractTimestamp(text: string): string | null {
  // Look for ISO-8601, US dates, or "Date: ..." lines. Best-effort.
  const iso = text.match(/\b(20\d{2}-[01]\d-[0-3]\d[T ]([0-2]\d:[0-5]\d(?::[0-5]\d)?)?)/);
  if (iso) return iso[1].replace(' ', 'T');
  const us = text.match(/\b([01]?\d)\/([0-3]?\d)\/(20\d{2})\s*(?:([0-2]?\d):([0-5]\d))?/);
  if (us) {
    const [, mm, dd, yyyy, hh, min] = us;
    const date = `${yyyy}-${pad(mm)}-${pad(dd)}`;
    return hh && min ? `${date}T${pad(hh)}:${min}:00` : date;
  }
  return null;
}

function pad(n: string): string {
  return n.padStart(2, '0');
}

function extractModulesScanned(text: string): string[] {
  // Heuristic: look for lines listing module names. Common ECU abbreviations.
  // We keep this conservative — false positives here are harmless (used only as metadata).
  const knownModules = new Set([
    'ECM', 'PCM', 'TCM', 'BCM', 'ABS', 'SRS', 'EPS', 'IPC', 'HVAC', 'TPMS',
    'SAS', 'YRS', 'ACC', 'LKA', 'BSM', 'PSM', 'SDM', 'RCM', 'OCS', 'AFS',
    'AHL', 'GW', 'CGM',
  ]);
  const found = new Set<string>();
  const tokens = text.toUpperCase().match(/\b[A-Z]{2,5}\b/g) ?? [];
  for (const tok of tokens) {
    if (knownModules.has(tok)) found.add(tok);
  }
  return Array.from(found);
}

function extractDtcs(text: string, warnings: string[]): Dtc[] {
  const lines = text.split(/\r?\n/);
  const dtcs: Dtc[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Reset regex state each loop iteration.
    DTC_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DTC_REGEX.exec(line)) !== null) {
      const code = match[0].toUpperCase();
      // Dedupe within a single report. Some tools list the same DTC under multiple
      // sections (e.g. "Active" and "All Codes"); keep the first occurrence.
      if (seen.has(code)) continue;
      seen.add(code);

      const module = extractModuleNearMatch(lines, i, match.index);
      const description = extractDescriptionForDtc(line, match.index + match[0].length);
      const status = extractStatusForDtc(line);

      dtcs.push({ code, module, description, status });
    }
  }

  if (dtcs.length === 0) {
    warnings.push(
      'No DTCs found. Either the vehicle scan returned clean, or the report layout is ' +
        'one this parser does not yet recognize — capture a sample and add a fixture.',
    );
  }

  return dtcs;
}

/**
 * Look backwards a few lines for the nearest module header. Most scan tools print
 * something like "ABS Module" or "[ABS]" before the DTC list for that module. If we
 * can't find one, the DTC's module stays null and the rules engine has to fall back
 * on the code letter prefix (U=Network, B=Body, C=Chassis, P=Powertrain) for context.
 */
function extractModuleNearMatch(lines: string[], lineIdx: number, _colIdx: number): string | null {
  const knownModules = [
    'ECM', 'PCM', 'TCM', 'BCM', 'ABS', 'SRS', 'EPS', 'IPC', 'HVAC', 'TPMS',
    'SAS', 'YRS', 'ACC', 'LKA', 'BSM', 'PSM', 'SDM', 'RCM', 'OCS', 'AFS',
    'AHL', 'GW', 'CGM',
  ];
  for (let j = lineIdx; j >= Math.max(0, lineIdx - 6); j--) {
    const upper = lines[j].toUpperCase();
    for (const m of knownModules) {
      if (new RegExp(`\\b${m}\\b`).test(upper)) return m;
    }
  }
  return null;
}

/** Take everything after the DTC on the same line as the description; trim noise. */
function extractDescriptionForDtc(line: string, afterIdx: number): string {
  const tail = line.slice(afterIdx).trim();
  // Strip leading separators (—, -, :, |, tabs).
  return tail.replace(/^[\s\-—:|\t]+/, '').replace(/\s+/g, ' ').trim();
}

function extractStatusForDtc(line: string): string | null {
  const lower = line.toLowerCase();
  if (/\bactive\b/.test(lower)) return 'active';
  if (/\bpermanent\b/.test(lower)) return 'permanent';
  if (/\bstored\b/.test(lower)) return 'stored';
  if (/\bhistory\b|\bhistorical\b/.test(lower)) return 'history';
  if (/\bpending\b/.test(lower)) return 'pending';
  return null;
}
