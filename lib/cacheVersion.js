/**
 * lib/cacheVersion.js — Single source of truth for the scan cache prompt version.
 *
 * Bump PROMPT_VERSION whenever the Claude system prompt or user-message template
 * in pages/api/explain.js changes in a way that would make cached responses stale.
 *
 * After bumping:
 *   1. Run getCacheInvalidationSQL(newVersion) from lib/cacheUtils.js in the
 *      Supabase SQL editor to purge rows at the old version.
 *   2. Deploy — new scans will rebuild the cache at the new version.
 */
export const PROMPT_VERSION = 20;
