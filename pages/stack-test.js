/**
 * pages/stack-test.js — Beyond Labels · API connection test
 *
 * Accessible at /stack-test (local and production).
 * Type any barcode → POST /api/scan → live JSON verdict.
 *
 * The full camera prototype is at /  (served from public/prototype.html)
 */

import Head from 'next/head';
import { useState } from 'react';

const TEST_BARCODE = '021000025350';

// ─── Colour map keyed by verdict string ──────────────────────────────────────
const VERDICT_PALETTE = {
  red:        { dot: '#C0392B', glow: 'rgba(192,57,43,0.35)',  bg: '#FDEDEC', border: 'rgba(192,57,43,0.22)', label: '🚫 REJECT'  },
  yellow:     { dot: '#D4AC0D', glow: 'rgba(212,172,13,0.35)', bg: '#FEF9E7', border: 'rgba(212,172,13,0.22)', label: '⚠️ CAUTION' },
  green:      { dot: '#27AE60', glow: 'rgba(39,174,96,0.35)',  bg: '#EAFAF1', border: 'rgba(39,174,96,0.22)',  label: '✓ PASS'    },
  unverified: { dot: '#8A8A8A', glow: 'rgba(138,138,138,0.2)', bg: '#F5F5F5', border: 'rgba(138,138,138,0.2)', label: '? UNVERIFIED' },
};

const SEVERITY_COLOR = { reject: '#C0392B', caution: '#D4AC0D' };

// ─── Tiny reusable pieces ─────────────────────────────────────────────────────

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.9px',
      textTransform: 'uppercase', color: '#9A8260', marginBottom: 4 }}>
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: 'white', border: '1.5px solid #F2EBD9',
      borderRadius: 14, padding: '14px 16px', ...style }}>
      {children}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StackTest() {
  const [phase, setPhase]       = useState('idle');   // idle | fetching | done | error
  const [response, setResponse] = useState(null);     // { status, body }
  const [errMsg, setErrMsg]     = useState('');
  const [elapsed, setElapsed]   = useState(null);     // ms
  const [barcode, setBarcode]   = useState(TEST_BARCODE);

  async function runScan() {
    setPhase('fetching');
    setResponse(null);
    setErrMsg('');
    setElapsed(null);

    const t0 = Date.now();
    try {
      const res = await fetch('/api/scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ barcode }),
      });
      const body = await res.json();
      setElapsed(Date.now() - t0);
      setResponse({ status: res.status, body });
      setPhase('done');
    } catch (e) {
      setElapsed(Date.now() - t0);
      setErrMsg(e.message);
      setPhase('error');
    }
  }

  const vc      = response ? (VERDICT_PALETTE[response.body.verdict] ?? VERDICT_PALETTE.unverified) : null;
  const rejects = response?.body.flags?.filter(f => f.severity === 'reject') ?? [];
  const cauts   = response?.body.flags?.filter(f => f.severity === 'caution') ?? [];

  return (
    <>
      <Head>
        <title>Beyond Labels — API Test</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div style={{ fontFamily: "'Inter', system-ui, sans-serif",
        background: '#FAF6EF', minHeight: '100vh', padding: '2rem 1rem' }}>
        <div style={{ maxWidth: 580, margin: '0 auto' }}>

          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 26 }}>🌿</span>
            <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: 26, fontWeight: 700, color: '#2C2416', margin: 0 }}>
              Beyond Labels
            </h1>
          </div>
          <p style={{ color: '#9A8260', fontSize: 13, margin: '0 0 1.75rem 36px' }}>
            API test page · <a href="/" style={{ color: '#D4872A', fontWeight: 600, textDecoration: 'none' }}>← Back to app</a>
          </p>

          {/* ── Barcode input ── */}
          <div style={{ marginBottom: '1.25rem' }}>
            <Label>Barcode</Label>
            <input
              type="text"
              inputMode="numeric"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && phase !== 'fetching' && runScan()}
              placeholder="Enter barcode number…"
              disabled={phase === 'fetching'}
              style={{
                width: '100%', padding: '12px 14px', boxSizing: 'border-box',
                border: '1.5px solid #E0D5C1', borderRadius: 10,
                fontSize: 16, fontWeight: 600, color: '#2C2416',
                background: 'white', outline: 'none',
                fontFamily: 'monospace', letterSpacing: '0.05em',
              }}
            />
          </div>

          {/* ── Scan button ── */}
          <button
            onClick={runScan}
            disabled={phase === 'fetching' || !barcode.trim()}
            style={{
              width: '100%', padding: '15px',
              background: phase === 'fetching'
                ? 'linear-gradient(135deg, #3A5A40, #4D7B55)'
                : 'linear-gradient(135deg, #D4872A, #F0A83C)',
              color: 'white', border: 'none', borderRadius: 14,
              fontSize: 16, fontWeight: 700,
              cursor: (phase === 'fetching' || !barcode.trim()) ? 'not-allowed' : 'pointer',
              boxShadow: phase === 'fetching'
                ? '0 4px 16px rgba(58,90,64,0.35)'
                : '0 4px 16px rgba(212,135,42,0.35)',
              transition: 'all 0.2s', marginBottom: '1.5rem',
            }}
          >
            {phase === 'fetching' ? '⏳ Calling /api/scan…' : '📷 Scan Barcode'}
          </button>

          {/* ── Error card ── */}
          {phase === 'error' && (
            <Card style={{ background: '#FDEDEC',
              border: '1.5px solid rgba(192,57,43,0.25)', marginBottom: '1rem' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#C0392B', marginBottom: 4 }}>
                Could not reach /api/scan
              </div>
              <div style={{ fontSize: 12, color: '#C0392B', opacity: 0.85 }}>{errMsg}</div>
              <div style={{ fontSize: 11, color: '#9A8260', marginTop: 8 }}>
                The API endpoint may be unavailable. Check the{' '}
                <a href="/api/scan" style={{ color: '#9A8260' }}>/api/scan</a> route.
              </div>
            </Card>
          )}

          {/* ── Results ── */}
          {phase === 'done' && response && (
            <>
              {/* Verdict hero */}
              <div style={{ background: vc.bg, border: `1.5px solid ${vc.border}`,
                borderRadius: 14, padding: '16px', marginBottom: '1rem',
                display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%',
                  background: vc.dot, flexShrink: 0,
                  boxShadow: `0 0 12px ${vc.glow}` }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9A8260',
                    textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 2 }}>
                    HTTP {response.status} · {elapsed}ms · /api/scan
                  </div>
                  <div style={{ fontFamily: "'Playfair Display', Georgia, serif",
                    fontSize: 24, fontWeight: 700, color: vc.dot, lineHeight: 1.1 }}>
                    {vc.label}
                  </div>
                  <div style={{ fontSize: 13, color: '#5C4A2A', marginTop: 4 }}>
                    {response.body.productName}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {[
                    { count: rejects.length, color: '#C0392B', hint: 'rejects' },
                    { count: cauts.length,   color: '#D4AC0D', hint: 'cautions' },
                  ].map(({ count, color, hint }) => (
                    <div key={hint} style={{ textAlign: 'center',
                      background: 'rgba(255,255,255,0.7)', borderRadius: 10,
                      padding: '6px 10px' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>
                        {count}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#9A8260',
                        textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {hint}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Flags list */}
              {response.body.flags?.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <Label>Flags from rulesEngine ({response.body.flags.length} total)</Label>
                  {response.body.flags.map((flag, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start',
                      gap: 10, background: 'white', border: '1.5px solid #F2EBD9',
                      borderRadius: 10, padding: '10px 12px', marginBottom: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%',
                        marginTop: 5, flexShrink: 0,
                        background: SEVERITY_COLOR[flag.severity] ?? '#ccc' }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#2C2416' }}>
                          {flag.matchedIngredient}
                          <span style={{ fontSize: 10, fontWeight: 500,
                            color: '#9A8260', marginLeft: 8 }}>
                            {flag.category} · {flag.severity}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#9A8260',
                          marginTop: 2, lineHeight: 1.45 }}>
                          {flag.summary}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Metadata row */}
              <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
                {[
                  { k: 'barcode',        v: response.body.barcode },
                  { k: 'found',          v: String(response.body.found) },
                  { k: 'clearedBy',      v: response.body.clearedBy ?? 'null' },
                  { k: 'labelsDetected', v: response.body.labelsDetected?.join(', ') || '(none)' },
                ].map(({ k, v }) => (
                  <div key={k} style={{ background: '#F2EBD9', borderRadius: 8,
                    padding: '6px 10px', fontSize: 11 }}>
                    <span style={{ fontWeight: 700, color: '#9A8260',
                      textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {k}{' '}
                    </span>
                    <span style={{ color: '#2C2416', fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Raw JSON */}
              <Label>Raw /api/scan response body</Label>
              <pre style={{ background: '#1E1E1E', color: '#D4D4D4', borderRadius: 12,
                padding: '1.25rem', fontSize: 11.5, lineHeight: 1.65,
                overflow: 'auto', maxHeight: 500, margin: '0 0 2rem' }}>
                {JSON.stringify(response.body, null, 2)}
              </pre>
            </>
          )}

          {/* ── Footer links ── */}
          <div style={{ borderTop: '1px solid #F2EBD9', paddingTop: '1rem',
            display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { href: '/',         label: '🌿 Open app' },
              { href: '/api/scan', label: '⚡ /api/scan (POST endpoint)' },
            ].map(({ href, label }) => (
              <a key={href} href={href} style={{ fontSize: 12, color: '#D4872A',
                fontWeight: 600, textDecoration: 'none' }}>
                {label}
              </a>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}
