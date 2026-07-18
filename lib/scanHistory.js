/**
 * lib/scanHistory.js — shared scan history utilities
 *
 * Exports:
 *   formatTime(iso)              — human-readable relative timestamp
 *   createHistoryTapHandler(opts) — factory returning handleHistoryItemTap
 *
 * Consumed by ScannerScreen and ProfileScreen. Extracted here to avoid
 * duplicating the tap-handler logic across both components.
 */

import { getUserLevel } from './userLevel';
import * as Sentry from '@sentry/nextjs';

/**
 * Format an ISO timestamp as a human-readable relative string.
 *
 * @param {string} iso - ISO 8601 timestamp string.
 * @returns {string}   - e.g. "just now", "5m ago", "3h ago", or a locale date.
 */
export function formatTime(iso) {
  const d = new Date(iso), now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  return diffHr < 24 ? diffHr + 'h ago' : d.toLocaleDateString();
}

/**
 * Factory that returns a handleHistoryItemTap function bound to the calling
 * component's state setters and ref. Accepts all mutable handles as parameters
 * so the returned function has no hidden dependencies on component internals.
 *
 * The tapInFlightRef guard is synchronous and survives React 18 concurrent-mode
 * scheduling, which makes it preferable to a useState boolean for preventing
 * double-taps when the tap causes component unmount (e.g. navigating to verdict).
 *
 * @param {object}   opts
 * @param {object|null} opts.supabase          - Supabase client instance (may be null).
 * @param {1|2}      opts.userLevel            - Current user strictness level.
 * @param {number}   opts.promptVersion        - Current PROMPT_VERSION constant.
 * @param {Function} opts.onResult             - Called with the mapped result on cache hit.
 * @param {{ current: boolean }} opts.tapInFlightRef  - Ref used as concurrency guard.
 * @param {Function} opts.setLoadingBarcode    - State setter for visual loading indicator.
 * @param {Function} opts.setMissBarcode       - State setter for cache-miss message.
 * @returns {Function} async handleHistoryItemTap(item)
 */
export function createHistoryTapHandler({
  supabase,
  userLevel,
  promptVersion,
  onResult,
  tapInFlightRef,
  setLoadingBarcode,
  setMissBarcode,
}) {
  return async function handleHistoryItemTap(item) {
    // Use the ref as the guard — synchronous, unaffected by React render scheduling.
    if (!item.barcode || tapInFlightRef.current) return;
    tapInFlightRef.current = true;
    setLoadingBarcode(item.barcode);
    setMissBarcode(null);

    try {
      if (!supabase) throw new Error('no-supabase');

      const level = userLevel ?? getUserLevel();
      const { data: cached, error } = await supabase
        .from('scan_cache')
        .select('*')
        .eq('barcode', item.barcode)
        .eq('user_level', level)
        .eq('prompt_version', promptVersion)
        .maybeSingle();

      if (error) throw error;

      if (cached) {
        const result = {
          verdict:               cached.verdict,
          flags:                 cached.flags ?? [],
          clearedBy:             cached.cleared_by ?? null,
          productName:           cached.product_name,
          ingredients:           cached.ingredients ?? null,
          barcode:               cached.barcode,
          source:                'cache',
          found:                 true,
          labelsDetected:        [],
          unverifiedIngredients: cached.unverified_ingredients ?? [],
          explanation:           cached.explanation ?? null,
          productCategory:       cached.product_category ?? null,
          unverifiedReason:      cached.unverified_reason ?? null,
          isMeat:                cached.is_meat ?? false,
        };
        // Release the guard and clear visual state synchronously before navigating.
        // onResult() may unmount this component; resetting via ref here ensures
        // the guard is always clean if the component is reused on return.
        tapInFlightRef.current = false;
        setLoadingBarcode(null);
        onResult && onResult(result);
      } else {
        tapInFlightRef.current = false;
        setLoadingBarcode(null);
        setMissBarcode(item.barcode);
      }
    } catch (err) {
      // "no-supabase" is an expected, intentional sentinel (client not
      // configured) — not a bug worth an event. Anything else is a real
      // query failure. barcode is a public product identifier.
      if (err?.message !== 'no-supabase') {
        Sentry.captureException(err, {
          tags: { route: 'scan_history_tap', barcode: item.barcode },
        });
      }
      tapInFlightRef.current = false;
      setLoadingBarcode(null);
      setMissBarcode(item.barcode);
    }
  };
}
