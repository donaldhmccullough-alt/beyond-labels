'use client';
// ─────────────────────────────────────────────────────────────────────────────
// MVP_MODE: set to false to restore scan limits and paywall
// ─────────────────────────────────────────────────────────────────────────────
const MVP_MODE = true;

import { useState, useEffect, useRef } from 'react';
import { getScanUsage, incrementScan, getScanHistory, addScanToHistory, incrementTotalScan } from '@/lib/userProfile';
import { logScanToSupabase, getSupabaseScanCountThisMonth, getSupabaseScanHistory } from '@/lib/auth';
// MVP_MODE: PaywallModal imported but not shown
import PaywallModal from './PaywallModal';
import { supabase } from '@/lib/supabase';
import { getUserLevel } from '@/lib/userLevel';
import { PROMPT_VERSION } from '@/lib/cacheVersion';
import { formatTime, createHistoryTapHandler } from '@/lib/scanHistory';
import * as Sentry from '@sentry/nextjs';

const OFFLINE_MESSAGE = '📶 No internet connection — check your connection and try again.';
const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

// fetch() only *rejects* (as opposed to resolving with a non-ok status) when
// the request never reached a server at all — no connectivity, DNS failure, a
// dropped connection mid-request. Per the Fetch spec that's always a
// TypeError; a real HTTP error status resolves normally, and a malformed
// JSON body from res.json() throws SyntaxError instead — so this won't
// misclassify either of those as "offline."
export function isNetworkError(err) {
  return err instanceof TypeError;
}

/**
 * Factory that returns the actual async processBarcode(barcode) function,
 * bound to the calling component's refs, state setters, and per-render
 * values (user/userLevel/onScanResult) — same "extract for testability"
 * reasoning as lib/scanHistory.js's createHistoryTapHandler: this project
 * has no React rendering test infrastructure, so pulling the real decision
 * logic out into a plain function taking mockable refs/setters is what
 * makes it unit-testable at all. See CLAUDE.md for the investigation this
 * closes (an in-flight /api/scan request kept running, and its response
 * kept acting on stale state, after the user backed out or re-submitted).
 *
 * Race-condition handling, two mechanisms working together:
 *  - scanInFlightRef (synchronous ref, not state) guards only the narrow,
 *    truly synchronous setup section at the top of processBarcode — closed
 *    before any await, and released again immediately once the new
 *    AbortController is stored. This is a same-tick re-entrancy guard, not
 *    a "block for the whole request" guard: a second scan that starts once
 *    setup has finished (e.g. a rapid manual re-submission while the first
 *    request is still awaiting /api/scan) is deliberately allowed through.
 *  - currentScanAbortRef holds the AbortController for whichever request is
 *    currently outstanding. It's aborted and replaced on every call (so a
 *    stale request's response can never act on state or call onScanResult
 *    once superseded) and aborted again from the component's unmount
 *    cleanup effect (covers "user switched tabs mid-scan"). This is what
 *    makes "the newer scan always wins" true for the realistic rapid
 *    re-scan case, not the ref guard above.
 * Both exist deliberately ("belt and suspenders") for different windows —
 * the ref guard closes the instant before a controller even exists to
 * abort; the abort logic covers everything after that.
 */
export function createProcessBarcodeHandler({
  scanInFlightRef,
  currentScanAbortRef,
  setScanError,
  setScanning,
  setScanUsage,
  setHistory,
  user,
  userLevel,
  onScanResult,
}) {
  return async function processBarcode(barcode) {
    // Synchronous re-entrancy guard — belt-and-suspenders alongside the
    // abort-based cancellation below. It only protects the narrow, truly
    // synchronous setup section immediately below (checked, then released,
    // before any await): a ref is readable/settable synchronously, so it
    // closes a same-tick re-entrant-call window the abort mechanism can't
    // help with yet (there's nothing to abort until a controller has
    // actually been created and stored). A legitimate second scan starting
    // once that setup has finished — e.g. a rapid manual re-submission
    // while the first request is still awaiting /api/scan — is
    // deliberately NOT blocked here; it's handled by the abort-and-replace
    // logic immediately below instead, so the newer scan always wins.
    if (scanInFlightRef.current) return;
    scanInFlightRef.current = true;

    // Cancel whatever request is still outstanding so its (eventually
    // arriving) response can never win — covers rapid re-scans and
    // manual-entry resubmission ("let the new one win").
    if (currentScanAbortRef.current) {
      currentScanAbortRef.current.abort();
    }
    const controller = new AbortController();
    currentScanAbortRef.current = controller;
    scanInFlightRef.current = false;

    setScanError(null);
    setScanning(true);

    // Proactive check — point-in-time only, no online/offline listeners.
    // Skips the fetch attempt entirely when the browser already knows it's
    // offline, rather than waiting on a doomed network request to fail.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setScanError(OFFLINE_MESSAGE);
      setScanning(false);
      if (currentScanAbortRef.current === controller) currentScanAbortRef.current = null;
      return;
    }

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, userLevel }),
        signal: controller.signal,
      });
      const data = await res.json();

      // This request may have been superseded/aborted between the fetch
      // resolving and here — bail out before touching any state or calling
      // onScanResult for a scan the user already moved past.
      if (controller.signal.aborted) return;

      incrementTotalScan();

      if (user?.id) {
        await logScanToSupabase(user.id, { ...data, barcode });
        const count = await getSupabaseScanCountThisMonth(user.id);
        setScanUsage({ scanCount: count, resetDate: new Date().toISOString().slice(0, 7) });
        const sbHistory = await getSupabaseScanHistory(user.id, 20);
        setHistory(sbHistory.map(r => ({
          productName: r.product_name, verdict: r.verdict,
          timestamp: r.scanned_at, barcode: r.barcode,
        })));
      } else {
        incrementScan();
        setScanUsage(getScanUsage());
        addScanToHistory({ productName: data.productName || '', verdict: data.verdict, timestamp: new Date().toISOString(), barcode });
        setHistory(getScanHistory());
      }
      onScanResult(data);
    } catch (err) {
      if (err?.name === 'AbortError') {
        // Intentional cancellation (superseded by a newer scan, or the
        // component unmounted) — not a failure. No toast, no state update,
        // no history/analytics writes.
        return;
      }
      console.error('Scan error:', err);
      const offline = isNetworkError(err);
      // Offline is an expected, common condition for a scan-in-store app,
      // not a bug — tagged and kept at 'warning' so it doesn't read the
      // same as a genuine unhandled failure. barcode is a public product
      // identifier, safe to tag (same convention as the API routes).
      Sentry.captureException(err, {
        tags: { route: 'scanner', errorType: offline ? 'offline' : 'unknown', barcode },
        level: offline ? 'warning' : 'error',
      });
      setScanError(offline ? OFFLINE_MESSAGE : GENERIC_ERROR_MESSAGE);
    } finally {
      // Only clear in-flight bookkeeping if this is still the current
      // request — an older, superseded request's finally must not stomp on
      // a newer request's in-progress state (which would flip the
      // spinner/button back to "idle" while real work is still happening).
      if (currentScanAbortRef.current === controller) {
        currentScanAbortRef.current = null;
        setScanning(false);
      }
    }
  };
}

export default function ScannerScreen({ user, userLevel = 2, onScanResult }) {
  const [scanning, setScanning] = useState(false);
  const [scanUsage, setScanUsage] = useState({ scanCount: 0, resetDate: '' });
  const [history, setHistory] = useState([]);
  const [showPaywall, setShowPaywall] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [showManual, setShowManual] = useState(false);
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const tapInFlightRef = useRef(false);
  // Synchronous re-entrancy guard for the live-scan/manual-entry path — same
  // reasoning as tapInFlightRef above: a ref survives the synchronous window
  // between two rapid triggers, which a useState boolean (batched, async to
  // settle) cannot reliably close on its own.
  const scanInFlightRef = useRef(false);
  // Holds the AbortController for whichever /api/scan request is currently
  // outstanding, so a new scan can cancel a stale one and processBarcode()
  // can tell an aborted/superseded response apart from a real one.
  const currentScanAbortRef = useRef(null);
  const [loadingBarcode, setLoadingBarcode] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [missBarcode, setMissBarcode] = useState(null);
  const FREE_SCAN_LIMIT = 15;

  useEffect(() => {
    async function loadUsage() {
      setScanUsage({ scanCount: 0, resetDate: '' });
      setHistory([]);

      if (user?.id) {
        const count = await getSupabaseScanCountThisMonth(user.id);
        setScanUsage({ scanCount: count, resetDate: new Date().toISOString().slice(0, 7) });
        const sbHistory = await getSupabaseScanHistory(user.id, 20);
        setHistory(sbHistory.map(r => ({
          productName: r.product_name,
          verdict: r.verdict,
          timestamp: r.scanned_at,
          barcode: r.barcode,
        })));
      } else {
        setScanUsage(getScanUsage());
        setHistory(getScanHistory());
      }
    }
    loadUsage();
  }, [user]);

  // Cancel whatever /api/scan request is still outstanding when this screen
  // unmounts (e.g. the user switches bottom-nav tabs mid-scan) — otherwise
  // the request keeps resolving server-side and its response would still
  // try to act on state or call onScanResult on the (now-unmounted)
  // component's behalf. See createProcessBarcodeHandler above.
  useEffect(() => {
    return () => {
      currentScanAbortRef.current?.abort();
    };
  }, []);

  const processBarcode = createProcessBarcodeHandler({
    scanInFlightRef,
    currentScanAbortRef,
    setScanError,
    setScanning,
    setScanUsage,
    setHistory,
    user,
    userLevel,
    onScanResult,
  });

  async function startCamera() {
    // MVP_MODE: paywall check disabled — unlimited scans
    if (!MVP_MODE && scanUsage.scanCount >= FREE_SCAN_LIMIT) { setShowPaywall(true); return; }
    setScanning(true); setCameraError(false);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/library');
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      reader.decodeFromStream(stream, videoRef.current, async (result) => {
        if (result) { stopCamera(); await processBarcode(result.getText()); }
      });
    } catch (err) { console.error('Camera error:', err); setCameraError(true); setScanning(false); }
  }

  function stopCamera() {
    if (readerRef.current) { try { readerRef.current.reset(); } catch(e){} readerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setScanning(false);
  }

  async function handleManualSubmit(e) {
    e.preventDefault();
    if (!manualBarcode.trim()) return;
    // MVP_MODE: paywall check disabled
    if (!MVP_MODE && scanUsage.scanCount >= FREE_SCAN_LIMIT) { setShowPaywall(true); return; }
    setShowManual(false);
    await processBarcode(manualBarcode.trim());
    setManualBarcode('');
  }

  const handleHistoryItemTap = createHistoryTapHandler({
    supabase,
    userLevel,
    promptVersion: PROMPT_VERSION,
    onResult: onScanResult,
    tapInFlightRef,
    setLoadingBarcode,
    setMissBarcode,
  });

  const vc = { red: '#C0392B', yellow: '#D4AC0D', green: '#27AE60', unverified: '#9A8260' };

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100dvh' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)' }}>
        <span style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 20, fontWeight: 700, color: 'var(--text-dark)' }}>Beyond Labels</span>
        <button onClick={() => setShowManual(!showManual)} style={{ background: 'transparent', border: '1.5px solid #D4872A', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#D4872A', minHeight: 36 }}>Enter Barcode</button>
      </div>

      {showManual && (
        <form onSubmit={handleManualSubmit} style={{ padding: '12px 16px', background: 'var(--cream-dark)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" value={manualBarcode} onChange={e => setManualBarcode(e.target.value)} placeholder="Enter barcode number..." style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', background: 'white', fontSize: 14, color: 'var(--text-dark)', outline: 'none' }} autoFocus />
            <button type="submit" disabled={scanning} style={{ background: 'var(--amber)', color: 'white', border: 'none', borderRadius: 10, padding: '10px 16px', cursor: scanning ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, opacity: scanning ? 0.6 : 1 }}>Scan</button>
          </div>
        </form>
      )}

      {/* Viewfinder */}
      <div className="viewfinder" onClick={scanning ? stopCamera : startCamera} style={{ margin: '20px 16px 0', borderRadius: 20, overflow: 'hidden', background: '#1A1A2E', height: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', cursor: 'pointer' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1A1A2E 0%, #16213E 50%, #0F3460 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(212,135,42,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(212,135,42,0.08) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
        <video ref={videoRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: scanning && !cameraError ? 'block' : 'none' }} playsInline muted />
        <div style={{ position: 'relative', width: 200, height: 140, zIndex: 2 }}>
          {[
            { top: 0, left: 0, borderWidth: '3px 0 0 3px', borderRadius: '4px 0 0 0' },
            { top: 0, right: 0, borderWidth: '3px 3px 0 0', borderRadius: '0 4px 0 0' },
            { bottom: 0, left: 0, borderWidth: '0 0 3px 3px', borderRadius: '0 0 0 4px' },
            { bottom: 0, right: 0, borderWidth: '0 3px 3px 0', borderRadius: '0 0 4px 0' },
          ].map((st, i) => (
            <div key={i} style={{ position: 'absolute', width: 24, height: 24, borderColor: '#F0A83C', borderStyle: 'solid', ...st }} />
          ))}
          {scanning && <div style={{ position: 'absolute', left: 8, right: 8, height: 2, background: 'linear-gradient(90deg, transparent, #F0A83C, transparent)', animation: 'scanAnim 2s ease-in-out infinite', top: '50%' }} />}
          {!scanning && (
            <div style={{ position: 'absolute', inset: '20px 30px', display: 'flex', gap: 3, opacity: 0.25 }}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} style={{ flex: 1, background: '#F0A83C', borderRadius: 1, height: i % 3 === 0 ? '100%' : i % 3 === 1 ? '80%' : '60%', alignSelf: i % 3 === 0 ? 'stretch' : i % 3 === 1 ? 'center' : 'flex-end' }} />
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', zIndex: 2, color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500, letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 16 }}>
          {cameraError ? 'Camera unavailable' : scanning ? 'Scanning...' : 'Tap to scan'}
        </div>
        {scanning && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,26,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 10, borderRadius: 20 }}>
            <div style={{ width: 36, height: 36, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#F0A83C', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>Analyzing...</span>
          </div>
        )}
      </div>

      {/* Scan button */}
      <button onClick={scanning ? stopCamera : startCamera} style={{ margin: '16px 16px 0', width: 'calc(100% - 32px)', height: 54, background: scanning ? 'linear-gradient(135deg, #3A5A40, #4D7B55)' : 'linear-gradient(135deg, #D4872A, #F0A83C)', color: 'white', fontFamily: 'var(--font-inter), system-ui, sans-serif', fontSize: 17, fontWeight: 700, border: 'none', borderRadius: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'all 0.15s' }}>
        {scanning ? 'Stop Scanning' : 'Tap to Scan'}
      </button>

      {scanError && (
        <p style={{ textAlign: 'center', marginTop: 8, fontSize: 13, color: scanError === OFFLINE_MESSAGE ? 'var(--amber)' : '#C0392B', fontWeight: 500, padding: '0 16px' }}>
          {scanError}
        </p>
      )}

      {/* MVP_MODE: scan counter hidden entirely.
          To restore: remove the MVP_MODE check below and show the counter.
      {!MVP_MODE && scanUsage.scanCount > 3 && (
        <p style={{ textAlign: 'center', marginTop: 8, fontSize: 12, color: 'var(--text-light)', fontWeight: 500 }}>
          {Math.max(FREE_SCAN_LIMIT - scanUsage.scanCount, 0)} free scans remaining this month
        </p>
      )}
      */}

      {/* Recently scanned */}
      {history.length > 0 && (
        <div style={{ margin: '16px 16px 0', background: 'var(--cream-dark)', borderRadius: 14, padding: 16 }}>
          <p style={{ fontFamily: 'var(--font-playfair), Georgia, serif', fontSize: 15, fontWeight: 600, color: 'var(--text-dark)', marginBottom: 10 }}>Recently Scanned</p>
          {history.map((item, i) => {
            const isLoading = loadingBarcode === item.barcode;
            const isMiss    = missBarcode === item.barcode;
            return (
              <div key={i}>
                <div
                  onClick={() => item.barcode && handleHistoryItemTap(item)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    paddingTop: 10, paddingBottom: 10,
                    borderBottom: (!isMiss && i < history.length - 1) ? '1px solid rgba(0,0,0,0.08)' : 'none',
                    cursor: item.barcode ? 'pointer' : 'default',
                    opacity: isLoading ? 0.5 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: vc[item.verdict] || '#9A8260' }} />
                  {item.productName
                    ? <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-dark)' }}>{item.productName}</span>
                    : <span style={{ flex: 1, fontSize: 13, fontWeight: 400, color: 'var(--text-light)', fontStyle: 'italic' }}>Product Not Found</span>
                  }
                  {isLoading ? (
                    <span style={{ fontSize: 11, color: 'var(--text-light)' }}>…</span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{formatTime(item.timestamp)}</span>
                  )}
                </div>
                {isMiss && (
                  <p style={{
                    fontSize: 12, color: 'var(--text-light)', fontStyle: 'italic',
                    padding: '0 0 10px 22px',
                    borderBottom: i < history.length - 1 ? '1px solid rgba(0,0,0,0.08)' : 'none',
                  }}>
                    Scan this product again to see the full report.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MVP_MODE: paywall modal kept in code but never triggered */}
      {!MVP_MODE && showPaywall && <PaywallModal onClose={() => setShowPaywall(false)} />}

      <style dangerouslySetInnerHTML={{ __html: '@keyframes scanAnim{0%,100%{top:20%;opacity:.6;}50%{top:80%;opacity:1;}}@keyframes spin{to{transform:rotate(360deg);}}.viewfinder:active{opacity:0.82;transition:opacity 0.1s;}' }} />
    </div>
  );
}
