import { z } from 'zod';
import { vinSchema } from '../schemas.js';

/**
 * Normalized scan-report output.
 *
 * Scan reports come from in-bay diagnostic tools (Bosch ADS, Autel MaxiSys, Snap-on
 * Solus/Modis/Triton/Zeus, Launch X431, Repairify asTech, etc.). Shops use them to
 * document the vehicle's electronic state BEFORE repair (pre-scan) and AFTER repair
 * (post-scan) — proving they discovered every fault and resolved everything before
 * release. Insurers increasingly require both.
 *
 * The killer correlation: cross-check post-scan DTCs against completed calibrations.
 * If you "performed" a radar calibration but the post-scan still shows U0428 from
 * the front radar module, something went wrong — and the rules engine should flag it.
 *
 * IMPORTANT — production hardening:
 *   These shape definitions match real scan-tool report semantics. Actual PDF
 *   text-extraction layouts vary by tool, software version, and shop language
 *   settings. Test against real .pdf exports before going to production.
 */

export const SCAN_TOOL_VENDORS = [
  'BOSCH',     // Bosch ADS, KTS series
  'AUTEL',     // MaxiSys, MaxiCheck
  'SNAP_ON',   // Solus, Modis, Triton, Zeus, Apollo
  'LAUNCH',    // X431 series, ScanPad
  'ASTECH',    // Repairify asTech (often a remote service)
  'OEM_TOOL',  // GDS, IDS, Tech2/MDI, etc. — manufacturer-specific
  'UNKNOWN',
] as const;
export type ScanToolVendor = (typeof SCAN_TOOL_VENDORS)[number];

export const SCAN_PHASES = ['PRE', 'POST', 'UNKNOWN'] as const;
export type ScanPhase = (typeof SCAN_PHASES)[number];

/**
 * A single DTC (Diagnostic Trouble Code). Standard format: 1 letter + 4 hex digits.
 *   P = Powertrain         (engine, transmission)
 *   B = Body               (airbag, lighting, climate)
 *   C = Chassis            (ABS, traction control, steering)
 *   U = Network            (CAN bus, module communication)
 * The most ADAS-relevant codes are typically U-codes (lost comms with a sensor module),
 * B-codes (calibration not learned), and some C-codes (steering angle, yaw rate).
 */
export const dtcSchema = z.object({
  /** Raw code as printed, e.g. "U0428" or "U0428:00-28". */
  code: z.string().regex(/^[PBCU][0-9A-F]{4}(:[0-9A-F-]+)?$/i, 'Invalid DTC format'),
  /** Module/ECU that reported the code, e.g. "EPS", "ABS", "SRS", "ACC". */
  module: z.string().nullable(),
  /** Human-readable description, vendor-supplied. */
  description: z.string(),
  /** Status flags as reported (e.g. "active", "stored", "permanent", "history"). */
  status: z.string().nullable(),
});
export type Dtc = z.infer<typeof dtcSchema>;

export const scanReportSchema = z.object({
  vendor: z.enum(SCAN_TOOL_VENDORS),
  /** PRE / POST / UNKNOWN — inferred from filename and document title. */
  phase: z.enum(SCAN_PHASES),
  /** VIN if extractable from the report. */
  vin: vinSchema.nullable(),
  /** Vehicle text the tool printed (e.g. "2019 HONDA CIVIC EX"), best-effort. */
  vehicleText: z.string().nullable(),
  /** ISO-8601 timestamp from the report, best-effort. */
  scannedAt: z.string().nullable(),
  /** Modules that responded to the scan (e.g. ["ECM", "TCM", "ABS", "SRS"]). */
  modulesScanned: z.array(z.string()).default([]),
  /** All extracted DTCs across all modules. */
  dtcs: z.array(dtcSchema),
});
export type ScanReport = z.infer<typeof scanReportSchema>;
