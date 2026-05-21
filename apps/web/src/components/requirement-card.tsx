'use client';

import type { RequirementView } from '@/lib/api';

const KIND_LABELS: Record<string, string> = {
  PRE_SCAN: 'Pre-Repair Scan',
  POST_SCAN: 'Post-Repair Scan',
  STATIC_CALIBRATION: 'Static Calibration',
  DYNAMIC_CALIBRATION: 'Dynamic Calibration',
  RADAR_CALIBRATION: 'Radar Calibration',
  CAMERA_AIMING: 'Camera Aiming',
  STEERING_ANGLE_RESET: 'Steering Angle Reset',
  WHEEL_ALIGNMENT: 'Wheel Alignment',
  BATTERY_SUPPORT: 'Battery Support',
  INITIALIZATION: 'System Initialization',
};

export function humanizeKind(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function ConfidenceLamp({ band }: { band: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const cls = band === 'HIGH' ? 'lamp-hi' : band === 'MEDIUM' ? 'lamp-med' : 'lamp-lo';
  return <span className={`lamp ${cls}`} aria-label={band} />;
}

export function RequirementCard({ r }: { r: RequirementView }) {
  const bandColor =
    r.confidenceBand === 'HIGH'
      ? 'var(--hi)'
      : r.confidenceBand === 'MEDIUM'
        ? 'var(--med)'
        : 'var(--lo)';

  return (
    <div className="panel" style={{ padding: 18, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <ConfidenceLamp band={r.confidenceBand} />
        <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
          {humanizeKind(r.kind)}
        </span>
        <span
          className="label"
          style={{ marginLeft: 'auto', color: bandColor, fontWeight: 600 }}
        >
          {r.confidenceBand} · {(r.confidenceScore * 100).toFixed(0)}%
        </span>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5, color: 'var(--ink)' }}>
        {r.explanation}
      </p>

      {r.oemReferences.length > 0 && (
        <div style={{ borderTop: '1px solid var(--panel-edge)', paddingTop: 10 }}>
          <div className="label" style={{ marginBottom: 6 }}>
            OEM References
          </div>
          {r.oemReferences.map((ref) => (
            <div key={ref.id} className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
              › {ref.procedure.title} — {ref.citation}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {r.needsHumanReview && (
          <span
            className="label"
            style={{
              color: 'var(--lo)',
              border: '1px solid var(--lo)',
              padding: '2px 8px',
            }}
          >
            ⚠ Human verification required
          </span>
        )}
        {r.isSupplementCandidate && (
          <span
            className="label"
            style={{ color: 'var(--hi)', border: '1px solid var(--hi)', padding: '2px 8px' }}
          >
            ✓ Supplement candidate
          </span>
        )}
      </div>
    </div>
  );
}
