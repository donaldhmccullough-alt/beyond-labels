// Manages user profile in localStorage
const PROFILE_KEY = 'bl_profile';
const SCAN_KEY = 'bl_scans';

export function getProfile() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(PROFILE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearProfile() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(SCAN_KEY);
}

export function getScanUsage() {
  if (typeof window === 'undefined') return { scanCount: 0, resetDate: '' };
  const raw = localStorage.getItem(SCAN_KEY);
  const now = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (!raw) return { scanCount: 0, resetDate: now };
  const data = JSON.parse(raw);
  if (data.resetDate !== now) return { scanCount: 0, resetDate: now };
  return data;
}

export function incrementScan() {
  const usage = getScanUsage();
  const updated = { ...usage, scanCount: usage.scanCount + 1, resetDate: new Date().toISOString().slice(0, 7) };
  localStorage.setItem(SCAN_KEY, JSON.stringify(updated));
  return updated;
}

export function getScanHistory() {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem('bl_scan_history');
  return raw ? JSON.parse(raw) : [];
}

export function addScanToHistory(item) {
  const history = getScanHistory();
  const updated = [item, ...history].slice(0, 10);
  localStorage.setItem('bl_scan_history', JSON.stringify(updated));
}

// ── Total (lifetime) scan counter ─────────────────────────────────────────────
export function getTotalScans() {
  if (typeof window === 'undefined') return 0;
  return parseInt(localStorage.getItem('bl_total_scans') || '0', 10);
}

export function incrementTotalScan() {
  const count = getTotalScans() + 1;
  localStorage.setItem('bl_total_scans', String(count));
  return count;
}

// ── Deferred onboarding nudge tracking ────────────────────────────────────────
export function getNudgeState() {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem('bl_nudges');
  return raw ? JSON.parse(raw) : {};
}

export function markNudgeDismissed(milestone) {
  const state = getNudgeState();
  state[`dismissed_${milestone}`] = true;
  localStorage.setItem('bl_nudges', JSON.stringify(state));
}

// Returns which nudge milestone should be shown right now, or null.
// Shows nudge 3 first, then 5, then 8. Each only once.
// After all three dismissed (or total >= 8 + dismissed_8), never shows again.
export function shouldShowNudge(totalScans) {
  // Never nudge if assessment is already complete
  const profile = getProfile();
  if (profile?.onboardingComplete) return null;

  const state = getNudgeState();
  // Show highest applicable undismissed milestone
  if (totalScans >= 8 && !state['dismissed_8']) return 8;
  if (totalScans >= 5 && !state['dismissed_5']) return 5;
  if (totalScans >= 3 && !state['dismissed_3']) return 3;
  return null;
}
