/**
 * Shared domain vocabulary. These mirror the Prisma enums but live here so that the
 * web app, API, and AI packages all speak the same language without importing Prisma.
 * Keep in sync with packages/db/prisma/schema.prisma.
 */

export const REQUIREMENT_KINDS = [
  'PRE_SCAN',
  'POST_SCAN',
  'STATIC_CALIBRATION',
  'DYNAMIC_CALIBRATION',
  'RADAR_CALIBRATION',
  'CAMERA_AIMING',
  'STEERING_ANGLE_RESET',
  'WHEEL_ALIGNMENT',
  'BATTERY_SUPPORT',
  'INITIALIZATION',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const ESTIMATE_SOURCES = ['CCC', 'MITCHELL', 'AUDATEX', 'UNKNOWN'] as const;
export type EstimateSource = (typeof ESTIMATE_SOURCES)[number];

export const LINE_ITEM_TYPES = ['PART', 'LABOR', 'OPERATION', 'SUBLET', 'MISC'] as const;
export type LineItemType = (typeof LINE_ITEM_TYPES)[number];

export const CONFIDENCE_BANDS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const USER_ROLES = ['OWNER', 'MANAGER', 'ESTIMATOR', 'TECHNICIAN', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Known ADAS systems we reason about. Extend as OEM coverage grows. */
export const ADAS_SYSTEMS = [
  'front_radar',
  'front_camera',
  'lkas_camera',
  'rear_radar',
  'blind_spot_radar',
  'surround_camera',
  'parking_sensors',
  'night_vision',
  'steering_angle_sensor',
] as const;
export type AdasSystem = (typeof ADAS_SYSTEMS)[number];

/** Confidence band thresholds — single source of truth for the whole platform. */
export const CONFIDENCE_THRESHOLDS = { HIGH: 0.85, MEDIUM: 0.6 } as const;

export function bandFor(score: number): ConfidenceBand {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/** The disclaimer every advisory output and report must carry. */
export const LIABILITY_DISCLAIMER =
  'This output is assistive OEM repair intelligence. All recommendations are advisory, ' +
  'must be independently verified against current OEM repair procedures, and do not ' +
  'constitute a guarantee. The repairing facility remains responsible for final repair ' +
  'decisions and OEM compliance.';
