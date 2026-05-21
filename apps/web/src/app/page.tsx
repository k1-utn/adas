'use client';

import { useState } from 'react';
import { api, type RequirementView } from '@/lib/api';
import type { VinProfile } from '@adas/shared';
import { RequirementCard } from '@/components/requirement-card';

type Phase = 'idle' | 'decoding' | 'uploading' | 'analyzing' | 'done' | 'error';

export default function Workspace() {
  const [vin, setVin] = useState('');
  const [profile, setProfile] = useState<VinProfile | null>(null);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<RequirementView[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleDecode() {
    setError(null);
    setPhase('decoding');
    try {
      const p = await api.decodeVin(vin);
      setProfile(p);
      setPhase('idle');
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  }

  async function handleUpload(file: File) {
    setError(null);
    setPhase('uploading');
    try {
      const { id } = await api.uploadEstimate(file);
      setEstimateId(id);
      setPhase('analyzing');
      await pollUntilDone(id);
      const reqs = await api.getRequirements(id);
      setRequirements(reqs);
      setPhase('done');
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  }

  async function pollUntilDone(id: string) {
    for (let i = 0; i < 30; i++) {
      const est = await api.getEstimate(id);
      if (est.status === 'COMPLETED' || est.status === 'FAILED') return;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const supplementCount = requirements.filter((r) => r.isSupplementCandidate).length;
  const reviewCount = requirements.filter((r) => r.needsHumanReview).length;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 80px' }}>
      <Header />

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
        {/* VIN decode */}
        <div className="panel" style={{ padding: 20 }}>
          <div className="label" style={{ marginBottom: 12 }}>
            01 · VIN Decode
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="17-CHARACTER VIN"
              value={vin}
              maxLength={17}
              onChange={(e) => setVin(e.target.value.toUpperCase())}
              style={{ textTransform: 'uppercase' }}
            />
            <button
              className="btn"
              onClick={handleDecode}
              disabled={vin.length !== 17 || phase === 'decoding'}
            >
              {phase === 'decoding' ? '···' : 'Decode'}
            </button>
          </div>

          {profile && (
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Make" value={profile.make} />
              <Field label="Model" value={profile.model} />
              <Field label="Year" value={profile.modelYear?.toString() ?? null} />
              <Field label="Trim" value={profile.trim} />
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="label" style={{ marginBottom: 4 }}>
                  Candidate ADAS Systems
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {profile.adasSystems.length === 0 && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                      none inferred
                    </span>
                  )}
                  {profile.adasSystems.map((s) => (
                    <span
                      key={s.system}
                      className="mono"
                      style={{
                        fontSize: 10,
                        padding: '3px 8px',
                        border: '1px solid var(--panel-edge)',
                        color: 'var(--accent)',
                      }}
                    >
                      {s.system}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Estimate upload */}
        <div className="panel" style={{ padding: 20 }}>
          <div className="label" style={{ marginBottom: 12 }}>
            02 · Estimate Upload
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Upload a CCC, Mitchell, or Audatex estimate PDF. The pipeline parses line items,
            evaluates OEM calibration rules, and scores confidence.
          </p>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            disabled={phase === 'uploading' || phase === 'analyzing'}
          />
          {(phase === 'uploading' || phase === 'analyzing') && (
            <div style={{ marginTop: 14, position: 'relative', height: 4, background: 'var(--grid)', overflow: 'hidden' }}>
              <div
                style={{
                  position: 'absolute',
                  height: '100%',
                  width: '40%',
                  background: 'var(--accent)',
                  animation: 'scan 1.2s linear infinite',
                }}
              />
            </div>
          )}
          {phase === 'analyzing' && (
            <div className="label" style={{ marginTop: 8, color: 'var(--accent)' }}>
              Running agent pipeline…
            </div>
          )}
        </div>
      </section>

      {error && (
        <div
          className="panel"
          style={{ marginTop: 16, padding: 14, borderColor: 'var(--lo)', color: 'var(--lo)' }}
        >
          <span className="mono" style={{ fontSize: 12 }}>ERROR · {error}</span>
        </div>
      )}

      {/* Results */}
      {phase === 'done' && (
        <section style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 16 }}>
            <h2 className="mono" style={{ fontSize: 18, margin: 0 }}>
              Detected Operations
            </h2>
            <span className="label">{requirements.length} total</span>
            <span className="label" style={{ color: 'var(--hi)' }}>{supplementCount} supplement</span>
            <span className="label" style={{ color: 'var(--lo)' }}>{reviewCount} need review</span>
            {estimateId && (
              <a
                href={api.reportUrl(estimateId)}
                className="btn"
                style={{ marginLeft: 'auto', textDecoration: 'none' }}
              >
                Generate Insurer Report
              </a>
            )}
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {requirements.map((r) => (
              <RequirementCard key={r.id} r={r} />
            ))}
          </div>

          <Disclaimer />
        </section>
      )}
    </main>
  );
}

function Header() {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 40,
          height: 40,
          border: '2px solid var(--accent)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 18 }}>
          A
        </span>
      </div>
      <div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 600, letterSpacing: '0.04em' }}>
          ADAS
        </div>
        <div className="label">OEM Repair Intelligence</div>
      </div>
      <span
        className="label"
        style={{ marginLeft: 'auto', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '4px 10px' }}
      >
        Assistive · Advisory Only
      </span>
    </header>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 14 }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function Disclaimer() {
  return (
    <p style={{ marginTop: 28, fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
      This output is assistive OEM repair intelligence. All recommendations are advisory, must
      be independently verified against current OEM repair procedures, and do not constitute a
      guarantee. The repairing facility remains responsible for final repair decisions and OEM
      compliance.
    </p>
  );
}
