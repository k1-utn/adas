import type { ParseFormat, ParseResult } from './types.js';
import { parseEms } from './ems.js';

export type { ParseFormat, ParseResult, ParseSuccess, ParseFailure } from './types.js';
export { parseEms } from './ems.js';

// Scan-tool reports (Bosch / Autel / Snap-on / Launch / asTech). Separate entity from
// estimates — uploaded independently, correlated against completed requirements.
export {
  parseScanReport,
  type ParseScanReportInput,
  type ParseScanReportResult,
} from './scan-report.js';
export {
  scanReportSchema,
  dtcSchema,
  SCAN_TOOL_VENDORS,
  SCAN_PHASES,
  type ScanReport,
  type ScanToolVendor,
  type ScanPhase,
  type Dtc,
} from './scan-report.schema.js';

/**
 * Detect the format of an uploaded estimate file. We look at the filename extension and
 * content sniff (first non-blank line) — both because shops rename files and because some
 * estimating platforms emit EMS with non-standard extensions.
 */
export function detectFormat(filename: string, content: string | Buffer): ParseFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'PDF';

  const text = typeof content === 'string' ? content : content.toString('utf8');
  const firstNonBlank = text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? '';

  if (lower.endsWith('.xml') || /^<\?xml|^<bms\b|^<estimate\b/i.test(firstNonBlank)) {
    return 'BMS';
  }

  // EMS records start with a 3-letter id followed by a pipe. Tolerate any extension
  // (.ems, .txt, .cif, .est, vendor-specific) — sniffing decides.
  if (/^[A-Z]{3}\|/i.test(firstNonBlank)) return 'EMS';

  // PDF magic bytes as a fallback even if the extension lied.
  if (text.startsWith('%PDF-')) return 'PDF';

  return 'UNKNOWN';
}

/**
 * Top-level dispatch: detect format then run the matching parser. PDF is not parsed here
 * (it goes through the OCR + LLM pipeline in the worker); we return UNKNOWN/PDF and the
 * caller branches on `.format`.
 */
export function parseEstimateFile(filename: string, content: string | Buffer): ParseResult {
  const format = detectFormat(filename, content);
  const text = typeof content === 'string' ? content : content.toString('utf8');

  switch (format) {
    case 'EMS':
      return parseEms(text);
    case 'BMS':
      return {
        ok: false,
        format: 'BMS',
        error: 'CIECA BMS XML parser not yet implemented — coming next',
      };
    case 'PDF':
      return {
        ok: false,
        format: 'PDF',
        error: 'PDF estimates are handled by the OCR + LLM pipeline, not deterministic parse',
      };
    default:
      return {
        ok: false,
        format: 'UNKNOWN',
        error: 'Could not detect estimate file format (expected EMS, BMS XML, or PDF)',
      };
  }
}
