/**
 * pages/api/admin/swap-candidates/review.js — Beyond Labels admin swap-candidate review action
 *
 * POST /api/admin/swap-candidates/review
 * Header: Authorization: Bearer <supabase access token> (see lib/requireAdmin.js)
 * Body: { barcode, decision: 'approved' | 'rejected', ...decision-specific fields }
 *
 * Phase 3b of the swaps system overhaul (July 2026) — the action half of the
 * admin review workflow Phase 3a built the read-only discovery endpoint for.
 * See CLAUDE.md "Swaps System" → "Admin swap-candidate review" for the full
 * design, including why this is a single POST endpoint keyed by `decision`
 * rather than two separate routes (approve/reject share almost all of their
 * validation and both ultimately just insert into swap_candidate_reviews;
 * only 'approved' additionally inserts into swap_products first).
 *
 * decision: 'rejected' body:
 *   { barcode, decision: 'rejected', reason?: string }
 *   → inserts one swap_candidate_reviews row (decision: 'rejected',
 *     note: reason ?? null). No swap_products row, ever.
 *
 * decision: 'approved' body:
 *   {
 *     barcode, decision: 'approved',
 *     product_name, brand?, category, subcategory?,
 *     why_it_passes: string[], certifications: string[], purchase_links: [{retailer, affiliate_url}],
 *     swap_level: 1 | 2,
 *     confirmedCurrent: boolean,  // false when approved despite an unconfirmed
 *                                 // verification-status banner (see
 *                                 // getVerificationStatus() in
 *                                 // pages/admin/swap-candidates.jsx) — the
 *                                 // admin explicitly checked the "I'm
 *                                 // approving without current verification" box
 *   }
 *   → inserts one swap_products row (source: 'scan_approved'), then one
 *     swap_candidate_reviews row (decision: 'approved', swap_product_id set
 *     to the new row's id; note set to
 *     "approved without current scan_cache verification" when
 *     confirmedCurrent === false, else null).
 *
 * Partial-failure handling: Supabase's PostgREST-based JS client has no
 * multi-table transaction support in this codebase (no stored
 * procedures/RPC anywhere — see the Phase 3a "GET swap-candidates" comment
 * for the same reasoning applied to querying), so a real atomic transaction
 * isn't available without introducing the project's first one. Instead: the
 * swap_products insert happens first; if the FOLLOW-UP
 * swap_candidate_reviews insert fails, the swap_products row is deleted as
 * a compensating action so it never sits orphaned (approved-looking but with
 * no review record explaining why). This is "otherwise handle partial
 * failure sensibly," not a true transaction — a crash between the two
 * writes (as opposed to the second write returning an error) could still
 * leave an orphaned row; that residual risk is accepted, consistent with
 * every other multi-step Supabase write in this codebase.
 */

import { requireAdmin } from '../../../../lib/requireAdmin';
import { getSupabaseServer } from '../../../../lib/supabaseServer';
import * as Sentry from '@sentry/nextjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const admin = await requireAdmin(req);
  if (!admin) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const sb = getSupabaseServer();
  if (!sb) {
    return res.status(500).json({ error: 'Supabase client unavailable.' });
  }

  const body = req.body || {};
  const { barcode, decision } = body;

  if (!barcode || typeof barcode !== 'string') {
    return res.status(400).json({ error: 'barcode is required.' });
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
  }

  try {
    if (decision === 'rejected') {
      const note = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

      const { error: reviewError } = await sb.from('swap_candidate_reviews').insert({
        barcode,
        decision: 'rejected',
        note,
      });
      if (reviewError) throw new Error(`swap_candidate_reviews insert failed: ${reviewError.message}`);

      return res.status(200).json({ success: true, decision: 'rejected' });
    }

    // decision === 'approved'
    const {
      product_name, brand, category, subcategory,
      why_it_passes, certifications, purchase_links,
      swap_level, confirmedCurrent,
    } = body;

    if (!product_name || typeof product_name !== 'string' || !product_name.trim()) {
      return res.status(400).json({ error: 'product_name is required.' });
    }
    if (!category || typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: 'category is required.' });
    }
    if (swap_level !== 1 && swap_level !== 2) {
      return res.status(400).json({ error: 'swap_level must be 1 or 2.' });
    }

    const swapProductPayload = {
      product_name: product_name.trim(),
      brand: brand && brand.trim() ? brand.trim() : null,
      category: category.trim(),
      subcategory: subcategory && subcategory.trim() ? subcategory.trim() : null,
      barcode,
      certifications: Array.isArray(certifications) ? certifications : [],
      why_it_passes: Array.isArray(why_it_passes) ? why_it_passes : [],
      purchase_links: Array.isArray(purchase_links) ? purchase_links : [],
      swap_level,
      source: 'scan_approved',
    };

    const { data: insertedSwap, error: swapInsertError } = await sb
      .from('swap_products')
      .insert(swapProductPayload)
      .select()
      .single();
    if (swapInsertError) throw new Error(`swap_products insert failed: ${swapInsertError.message}`);

    const reviewNote = confirmedCurrent === false
      ? 'approved without current scan_cache verification'
      : null;

    const { error: reviewInsertError } = await sb.from('swap_candidate_reviews').insert({
      barcode,
      decision: 'approved',
      swap_product_id: insertedSwap.id,
      note: reviewNote,
    });

    if (reviewInsertError) {
      // Compensating delete — see the file-header comment on why this isn't
      // a real transaction, and why that's an accepted, documented tradeoff.
      await sb.from('swap_products').delete().eq('id', insertedSwap.id);
      throw new Error(
        `swap_candidate_reviews insert failed (swap_products row ${insertedSwap.id} rolled back): ${reviewInsertError.message}`
      );
    }

    return res.status(200).json({ success: true, decision: 'approved', swapProductId: insertedSwap.id });
  } catch (err) {
    // barcode is a public product identifier (not personal data) — safe to
    // tag directly, same convention as pages/api/scan.js.
    Sentry.captureException(err, {
      tags: { route: 'admin/swap-candidates/review', decision, barcode },
    });
    return res.status(500).json({ error: err.message });
  }
}
