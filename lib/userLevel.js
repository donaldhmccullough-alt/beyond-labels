'use strict';

const STORAGE_KEY = 'bl_user_level';
const DEFAULT_LEVEL = 1;

/**
 * Returns true if the user has explicitly chosen a level (i.e. the key
 * exists in localStorage). Returns false on first visit or SSR.
 *
 * @returns {boolean}
 */
function hasUserLevel() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Returns the stored user level (1 or 2), or DEFAULT_LEVEL if not set.
 * Safe to call in any environment — returns DEFAULT_LEVEL when localStorage
 * is unavailable (SSR, test environments).
 *
 * @returns {1 | 2}
 */
function getUserLevel() {
  if (typeof window === 'undefined') return DEFAULT_LEVEL;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  const parsed = parseInt(stored, 10);
  return parsed === 1 || parsed === 2 ? parsed : DEFAULT_LEVEL;
}

/**
 * Persists the user level to localStorage.
 *
 * @param {1 | 2} level
 */
function setUserLevel(level) {
  if (typeof window === 'undefined') return;
  if (level !== 1 && level !== 2) throw new Error(`Invalid user level: ${level}`);
  window.localStorage.setItem(STORAGE_KEY, String(level));
}

module.exports = { hasUserLevel, getUserLevel, setUserLevel };
