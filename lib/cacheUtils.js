/**
 * lib/cacheUtils.js — Beyond Labels scan cache maintenance utilities
 *
 * These are developer-facing helpers for manual cache operations via the
 * Supabase SQL editor. None of these functions are called automatically
 * in the application runtime.
 *
 * Usage after a prompt update:
 *   1. Bump PROMPT_VERSION in lib/cacheVersion.js
 *   2. Copy the SQL returned by getCacheInvalidationSQL(newVersion) into
 *      the Supabase SQL editor and run it.
 *   3. Deploy — new scans will rebuild the cache at the new version.
 */

/**
 * Returns the SQL statement that purges all scan_cache rows whose
 * prompt_version is below the given version number.
 *
 * Run this manually in the Supabase SQL editor whenever PROMPT_VERSION
 * is bumped in pages/api/explain.js.
 *
 * @param {number} newVersion — the new PROMPT_VERSION value (e.g. 2)
 * @returns {string} SQL DELETE statement
 *
 * @example
 * console.log(getCacheInvalidationSQL(2));
 * // DELETE FROM scan_cache WHERE prompt_version < 2;
 */
export function getCacheInvalidationSQL(newVersion) {
  return `DELETE FROM scan_cache WHERE prompt_version < ${newVersion};`;
}
