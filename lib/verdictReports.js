'use strict';

// Light UX guard so a user doesn't see the "Report it" link re-appear on a
// scan they already reported — not real abuse prevention (the server has no
// corresponding rate limit). Same localStorage-array-capped-to-N pattern as
// lib/userProfile.js's bl_scan_history (capped at 10, newest first).

const STORAGE_KEY = 'bl_reported_scans';
const MAX_ENTRIES = 50;

function readReportedScans() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} barcode
 * @returns {boolean}
 */
function hasReportedScan(barcode) {
  return readReportedScans().includes(barcode);
}

/**
 * @param {string} barcode
 */
function markScanReported(barcode) {
  if (typeof window === 'undefined') return;
  const updated = [barcode, ...readReportedScans().filter(b => b !== barcode)].slice(0, MAX_ENTRIES);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

module.exports = { hasReportedScan, markScanReported };
