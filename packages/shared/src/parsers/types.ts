import type { ParsedEstimate } from '../schemas.js';

export type ParseFormat = 'EMS' | 'BMS' | 'PDF' | 'UNKNOWN';

export interface ParseSuccess {
  ok: true;
  format: ParseFormat;
  estimate: ParsedEstimate;
  warnings: string[];
}

export interface ParseFailure {
  ok: false;
  format: ParseFormat;
  error: string;
}

export type ParseResult = ParseSuccess | ParseFailure;
