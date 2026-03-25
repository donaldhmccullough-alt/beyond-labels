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
