/**
 * pages/api/admin/swap-candidates.js — Beyond Labels admin swap-candidate discovery
 *
 * GET /api/admin/swap-candidates
 * Header: Authorization: Bearer <supabase access token> (see lib/requireAdmin.js)
 *
 * Phase 3a of the swaps system overhaul (July 2026) — foundation only. This
 * endpoint surfaces candidate products for the swaps catalog but does NOT
 * let an admin act on them yet (no approve/reject action, no admin UI) —
 * that's Phase 3b. See CLAUDE.md "Swaps System" for the full plan.
 *
 * Flow:
 *   1. Verify the caller is an admin (requireAdmin()) — 401 if not.
 *   2. Query `scans` (not scan_cache — scan_cache is keyed by (barcode,
 *      user_level) and only ever holds the CURRENT state per level, not
 *      historical scan events) for verdict='green' rows, group by barcode
 *      in JS, and keep only barcodes with >= MIN_DISTINCT_SCANNERS (3)
 *      distinct user_id values. Rows with a null barcode or user_id are
 *      skipped — an anonymous (not-signed-in) scan has no user_id and
 *      can't contribute to a "distinct users" count.
 *   3. Exclude barcodes already present in swap_products (already a real
 *      swap — nothing to review).
 *   4. Exclude barcodes already present in swap_candidate_reviews,
 *      regardless of decision — a rejected barcode must never resurface,
 *      and an approved one is (or will be, once Phase 3b exists) already
 *      reflected in swap_products via step 3 anyway.
 *   5. For every remaining candidate barcode, join scan_cache rows (both
 *      user_level 1 and 2, whichever exist — scan_cache's own unique
 *      constraint on (barcode, user_level) already guarantees at most one
 *      current row per level, so no extra "most recent" ordering is
 *      needed) to attach product_name/product_category/product_subcategory
 *      and each level's current verdict + explanation. This is NOT
 *      filtered to verdict='green' — a candidate may have gone green for
 *      enough distinct users historically (step 2) while its CURRENT
 *      scan_cache state at one level has since drifted (a rules-engine
 *      change, cache invalidation, etc.); reporting the real current
 *      per-level verdict lets an admin see that instead of a stale
 *      assumption baked into the response.
 *   6. Return { candidates: Candidate[] }.
 *
 * Candidate shape:
 * {
 *   barcode:            string,
 *   distinctScanCount:  number,
 *   productName:        string | null,
 *   productCategory:    string | null,
 *   productSubcategory: string | null,
 *   levels: {
 *     [1]?: { verdict: string, explanation: object | null, promptVersion: number },
 *     [2]?: { verdict: string, explanation: object | null, promptVersion: number },
 *   }
 * }
 *
 * `promptVersion` per level was added in Phase 3b (July 2026, admin review screen) —
 * the admin UI's verification-status banner needs it to detect a stale cache row
 * (prompt_version behind the current lib/cacheVersion.js constant) as a distinct
 * case from "verdict isn't green" or "no cache row at all". See
 * getVerificationStatus() in pages/admin/swap-candidates.jsx.
 */

import { requireAdmin } from '../../../lib/requireAdmin';
import { getSupabaseServer } from '../../../lib/supabaseServer';

const MIN_DISTINCT_SCANNERS = 3;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const admin = await requireAdmin(req);
  if (!admin) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const sb = getSupabaseServer();
  if (!sb) {
    return res.status(500).json({ error: 'Supabase client unavailable.' });
  }

  try {
    // ── Step 2: distinct-scanner threshold from real scan history ──────────
    const { data: greenScans, error: scansError } = await sb
      .from('scans')
      .select('barcode, user_id')
      .eq('verdict', 'green');
    if (scansError) throw new Error(`scans query failed: ${scansError.message}`);

    const scannersByBarcode = new Map();
    for (const row of greenScans || []) {
      if (!row.barcode || !row.user_id) continue;
      if (!scannersByBarcode.has(row.barcode)) scannersByBarcode.set(row.barcode, new Set());
      scannersByBarcode.get(row.barcode).add(row.user_id);
    }

    let candidateBarcodes = [...scannersByBarcode.entries()]
      .filter(([, users]) => users.size >= MIN_DISTINCT_SCANNERS)
      .map(([barcode]) => barcode);

    if (candidateBarcodes.length === 0) {
      return res.status(200).json({ candidates: [] });
    }

    // ── Step 3: exclude barcodes already a real swap ────────────────────────
    const { data: existingSwaps, error: swapProductsError } = await sb
      .from('swap_products')
      .select('barcode');
    if (swapProductsError) throw new Error(`swap_products query failed: ${swapProductsError.message}`);
    const existingSwapBarcodes = new Set((existingSwaps || []).map(r => r.barcode).filter(Boolean));

    // ── Step 4: exclude barcodes already reviewed (either decision) ────────
    const { data: reviewed, error: reviewsError } = await sb
      .from('swap_candidate_reviews')
      .select('barcode');
    if (reviewsError) throw new Error(`swap_candidate_reviews query failed: ${reviewsError.message}`);
    const reviewedBarcodes = new Set((reviewed || []).map(r => r.barcode).filter(Boolean));

    candidateBarcodes = candidateBarcodes.filter(
      barcode => !existingSwapBarcodes.has(barcode) && !reviewedBarcodes.has(barcode)
    );

    if (candidateBarcodes.length === 0) {
      return res.status(200).json({ candidates: [] });
    }

    // ── Step 5: join scan_cache for product info + per-level verdict data ──
    const { data: cacheRows, error: cacheError } = await sb
      .from('scan_cache')
      .select('barcode, user_level, verdict, product_name, product_category, product_subcategory, explanation, prompt_version')
      .in('barcode', candidateBarcodes);
    if (cacheError) throw new Error(`scan_cache query failed: ${cacheError.message}`);

    const cacheByBarcode = new Map();
    for (const row of cacheRows || []) {
      if (!cacheByBarcode.has(row.barcode)) cacheByBarcode.set(row.barcode, {});
      cacheByBarcode.get(row.barcode)[row.user_level] = row;
    }

    const candidates = candidateBarcodes.map(barcode => {
      const levelRows = cacheByBarcode.get(barcode) || {};
      const infoRow = levelRows[1] || levelRows[2] || {};

      const levels = {};
      for (const level of [1, 2]) {
        if (levelRows[level]) {
          levels[level] = {
            verdict: levelRows[level].verdict ?? null,
            explanation: levelRows[level].explanation ?? null,
            promptVersion: levelRows[level].prompt_version ?? null,
          };
        }
      }

      return {
        barcode,
        distinctScanCount: scannersByBarcode.get(barcode).size,
        productName: infoRow.product_name ?? null,
        productCategory: infoRow.product_category ?? null,
        productSubcategory: infoRow.product_subcategory ?? null,
        levels,
      };
    });

    return res.status(200).json({ candidates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
