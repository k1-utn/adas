import type { CalibrationRuleDef } from './engine.js';

/**
 * Starter OEM ruleset. These encode common, well-established collision calibration
 * triggers. In production this is the seed for the CalibrationRule table and is expanded
 * with OEM-sourced, position-statement-backed rules per make/model/year.
 *
 * Every rule carries a rationale and (in prod) OEM procedure references. baseConfidence
 * reflects how directly OEM-sourced the rule is: exact position statements -> ~0.9,
 * broadly-accepted industry practice -> ~0.7.
 */
export const STARTER_RULES: CalibrationRuleDef[] = [
  {
    id: 'rule_prescan_all',
    kind: 'PRE_SCAN',
    predicate: {},
    rationale:
      'Most OEMs require a pre-repair diagnostic scan to identify all DTCs present before ' +
      'disassembly, establishing a baseline of vehicle health.',
    baseConfidence: 0.82,
    version: '1.0.0',
  },
  {
    id: 'rule_postscan_all',
    kind: 'POST_SCAN',
    predicate: {},
    rationale:
      'OEMs broadly require a post-repair scan to confirm no active or stored DTCs remain ' +
      'and that all systems are functioning after repairs.',
    baseConfidence: 0.85,
    version: '1.0.0',
  },
  {
    id: 'rule_front_radar_recal',
    kind: 'RADAR_CALIBRATION',
    predicate: {
      anySystem: ['front_radar'],
      descriptionContains: ['bumper', 'grille', 'radar', 'front reinforcement'],
    },
    rationale:
      'Front radar units mounted in/behind the front fascia require recalibration when the ' +
      'bumper, grille, or radar bracket is removed or replaced, as mounting tolerance directly ' +
      'affects beam aim.',
    baseConfidence: 0.9,
    version: '1.0.0',
  },
  {
    id: 'rule_windshield_camera_aim',
    kind: 'CAMERA_AIMING',
    predicate: {
      anySystem: ['front_camera', 'lkas_camera'],
      descriptionContains: ['windshield', 'glass', 'camera', 'mirror bracket'],
    },
    rationale:
      'Forward-facing cameras mounted to the windshield require static or dynamic aiming ' +
      'after windshield replacement or camera removal, per OEM glass procedures.',
    baseConfidence: 0.92,
    version: '1.0.0',
  },
  {
    id: 'rule_blind_spot_rear',
    kind: 'RADAR_CALIBRATION',
    predicate: {
      anySystem: ['blind_spot_radar'],
      impactZoneIn: ['rear', 'left_rear', 'right_rear'],
      descriptionContains: ['quarter panel', 'rear bumper', 'bumper'],
    },
    rationale:
      'Blind-spot monitoring radar mounted in the rear bumper/quarter requires calibration ' +
      'after rear collision repair affecting its mounting location.',
    baseConfidence: 0.88,
    version: '1.0.0',
  },
  {
    id: 'rule_sas_reset_alignment',
    kind: 'STEERING_ANGLE_RESET',
    predicate: {
      descriptionContains: ['alignment', 'steering', 'tie rod', 'suspension', 'knuckle'],
    },
    rationale:
      'Steering angle sensor reset is required after a wheel alignment or steering/suspension ' +
      'component service so the SAS reference matches the new thrust angle.',
    baseConfidence: 0.8,
    version: '1.0.0',
  },
  {
    id: 'rule_wheel_alignment',
    kind: 'WHEEL_ALIGNMENT',
    predicate: {
      descriptionContains: [
        'alignment',
        'suspension',
        'tie rod',
        'control arm',
        'knuckle',
        'subframe',
      ],
    },
    rationale:
      'Suspension or steering component replacement requires a four-wheel alignment to restore ' +
      'OEM geometry, which is itself a prerequisite for ADAS calibration.',
    baseConfidence: 0.83,
    version: '1.0.0',
  },
  {
    id: 'rule_battery_support',
    kind: 'BATTERY_SUPPORT',
    predicate: {
      descriptionContains: ['calibration', 'programming', 'module', 'scan'],
    },
    rationale:
      'A stable power supply (battery maintainer) is required during calibration and module ' +
      'programming to prevent voltage drop that can corrupt the procedure.',
    baseConfidence: 0.7,
    version: '1.0.0',
  },
];
