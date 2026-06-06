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

  async function processBarcode(barcode) {
    setScanError(null);
    setScanning(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, userLevel }),
      });
      const data = await res.json();
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
        addScanToHistory({ productName: data.productName || barcode, verdict: data.verdict, timestamp: new Date().toISOString(), barcode });
        setHistory(getScanHistory());
      }
      onScanResult(data);
    } catch (err) {
      console.error('Scan error:', err);
      setScanError('Something went wrong. Please try again.');
    } finally { setScanning(false); }
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
            <button type="submit" style={{ background: 'var(--amber)', color: 'white', border: 'none', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>Scan</button>
          </div>
        </form>
      )}

      {/* Viewfinder */}
      <div style={{ margin: '20px 16px 0', borderRadius: 20, overflow: 'hidden', background: '#1A1A2E', height: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
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
        <p style={{ textAlign: 'center', marginTop: 8, fontSize: 13, color: '#C0392B', fontWeight: 500, padding: '0 16px' }}>
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
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-dark)' }}>{item.productName}</span>
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

      <style dangerouslySetInnerHTML={{ __html: '@keyframes scanAnim{0%,100%{top:20%;opacity:.6;}50%{top:80%;opacity:1;}}@keyframes spin{to{transform:rotate(360deg);}}' }} />
    </div>
  );
}
