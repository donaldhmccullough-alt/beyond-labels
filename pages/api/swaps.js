/**
 * pages/api/swaps.js — Beyond Labels store-bought swap recommendations
 *
 * GET /api/swaps?category=chips|snacks|cereal|condiments|beverages|dairy|bread|frozen|cooking_oils&userLevel=1|2&subcategory=...
 *
 * Flow:
 *   1. Check 1-hour in-memory cache
 *   2. Query the swap_products Supabase table if stale (Phase 0 migration,
 *      July 2026 — previously a public Google Sheet CSV; see CLAUDE.md
 *      "Swaps System" section)
 *   3. Normalize rows → array of swap objects (array columns re-joined into
 *      the same delimited-string shape the CSV pipeline used to produce, so
 *      the response shape and SwapCard.jsx's own client-side .split() calls
 *      are unaffected by the migration)
 *   4. Filter by ?category (optional)
 *   5. If ?subcategory is also provided, narrow the category-filtered pool to
 *      matching (category, subcategory) rows — but only if that narrower
 *      pool is non-empty. Zero subcategory matches falls back to the
 *      category-wide pool silently (not treated as the "zero curated
 *      results" case — see step 6). subcategory is free text (Phase 1,
 *      July 2026 — see CLAUDE.md "Swaps System"); an unrecognized value
 *      just never matches any row, which is the same fallback behavior.
 *   6. Filter/tag by userLevel, capped at RESULTS_PER_TIER (20, raised from 3 in
 *      Phase 2, July 2026 — see CLAUDE.md "Swaps System") per tier:
 *      - Level 2: only swap_level=2 rows, returned flat with tier:'better'
 *      - Level 1: swap_level=1 tagged tier:'good', swap_level=2 tagged tier:'better'
 *      SwapsScreen.jsx renders only the first 3 of each tier initially and
 *      reveals the rest via a client-side "Show More" tap — no second
 *      request, since every row up to the cap is already in the response.
 *   7. AI fallback if 0 curated results and category is provided — unchanged
 *      from before subcategory support. Since step 5 already falls back to
 *      the category-wide pool whenever the subcategory has zero matches,
 *      this check never sees an empty subcategory-only pool as a false
 *      "zero curated results" signal.
 *   8. Return { swaps, source: 'curated' | 'ai' }
 *
 * swap_products columns: product_name, brand, category, subcategory, barcode,
 *   certifications (text[]), why_it_passes (text[]), where_to_buy (text[]),
 *   image_url, swap_level (integer), source ('curated' | 'scan_approved')
 *
 * swap_level values: 1 (passes Level 1 criteria), 2 (passes Level 2 strict criteria)
 * Level 2 swaps surface as tier:'better' for Level 1 users.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL } from '../../lib/aiConfig';
import { getSupabaseServer } from '../../lib/supabaseServer';
import * as Sentry from '@sentry/nextjs';

const VALID_CATEGORIES = [
  'chips', 'snacks', 'cereal', 'condiments', 'beverages', 'dairy', 'bread', 'frozen', 'cooking_oils', 'meat',
  'eggs',
];

// Phase 2 of the swaps overhaul (July 2026): raised from 3 to 20 so
// SwapsScreen.jsx can offer a client-side "Show More" expansion per tier
// without a second network request — it already has every row it needs,
// just renders the first 3 until the user asks for more. See CLAUDE.md
// "Swaps System" for the full behavior.
const RESULTS_PER_TIER = 20;

let _cache = { rows: null, fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000;

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Re-joins swap_products' text[] columns into the same delimited-string
// shape the old CSV pipeline produced, so every downstream consumer
// (this file's own filter/tier logic below, plus SwapCard.jsx's client-side
// .split(';')/.split(',') calls) needs zero changes for the migration.
function normalizeSwapRow(row) {
  return {
    product_name: row.product_name || '',
    brand: row.brand || '',
    category: row.category || '',
    subcategory: row.subcategory || '',
    barcode: row.barcode || '',
    certifications: (row.certifications || []).join(';'),
    why_it_passes: (row.why_it_passes || []).join(';'),
    where_to_buy: (row.where_to_buy || []).join(','),
    image_url: row.image_url || '',
    swap_level: String(row.swap_level),
  };
}

async function getSwapRows() {
  const now = Date.now();
  if (_cache.rows && (now - _cache.fetchedAt) < CACHE_TTL_MS) return _cache.rows;

  const sb = getSupabaseServer();
  if (!sb) throw new Error('Supabase client unavailable — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');

  const { data, error } = await sb.from('swap_products').select('*');
  if (error) throw new Error(`swap_products query failed: ${error.message}`);

  _cache.rows = (data || []).map(normalizeSwapRow);
  _cache.fetchedAt = now;
  return _cache.rows;
}

async function getAISuggestions(category, userLevel) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const client = new Anthropic({ apiKey });

  const levelCriteria = userLevel === 2
    ? `- USDA Organic or Non-GMO Project Verified certified\n- No seed oils (canola, soybean, sunflower, corn, vegetable oil)\n- No artificial additives, dyes, or preservatives\n- No conventional crops\n- No natural flavors`
    : `- No artificial additives, dyes, or preservatives\n- No trans fats or hydrogenated oils\n- No high-fructose corn syrup or artificial sweeteners\n- Seed oils and conventional crops are acceptable`;

  const prompt =
    `You are a clean-food expert helping shoppers find better alternatives to processed grocery products.\n\n` +
    `Suggest 2-3 real, widely-available store-bought products in the "${category}" category that meet ALL of these criteria:\n` +
    `${levelCriteria}\n\n` +
    `Return ONLY a valid JSON array — no markdown, no explanation:\n` +
    `[\n  {\n    "product_name": "...",\n    "brand": "...",\n    "certifications": "...",\n    "why_it_passes": "Reason one; Reason two",\n    "where_to_buy": "Whole Foods, Amazon"\n  }\n]`;

  try {
    const message = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = message.content[0]?.text || '[]';
    const json = raw.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(json);
    const tier = userLevel === 2 ? 'better' : 'good';
    return parsed.map(item => ({
      product_name:   item.product_name  || '',
      brand:          item.brand         || '',
      category,
      barcode:        '',
      certifications: item.certifications || '',
      why_it_passes:  item.why_it_passes  || '',
      where_to_buy:   item.where_to_buy   || '',
      image_url:      '',
      swap_level:     String(userLevel),
      tier,
      ai_generated:   true,
    }));
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'swaps', op: 'ai_suggestions', category, userLevel },
    });
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const { category, subcategory, userLevel: rawUserLevel } = req.query;

  if (rawUserLevel !== undefined && rawUserLevel !== '1' && rawUserLevel !== '2') {
    return res.status(400).json({ error: 'Invalid userLevel. Must be 1 or 2.' });
  }

  const userLevel = rawUserLevel === '1' ? 1 : 2;

  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}.`,
    });
  }

  try {
    const allRows = await getSwapRows();
    const categoryFiltered = category ? allRows.filter(r => r.category === category) : allRows;

    // Narrow to (category, subcategory) only when that narrower pool is
    // non-empty — zero matches falls back to the category-wide pool
    // silently, so a subcategory the backfill/detection didn't confidently
    // classify never dead-ends to no swaps shown.
    let filtered = categoryFiltered;
    if (subcategory) {
      const subcategoryFiltered = categoryFiltered.filter(r => r.subcategory === subcategory);
      if (subcategoryFiltered.length > 0) filtered = subcategoryFiltered;
    }

    if (userLevel === 2) {
      const swaps = shuffleArray(filtered.filter(r => r.swap_level === '2'))
        .slice(0, RESULTS_PER_TIER)
        .map(r => ({ ...r, tier: 'better' }));

      if (swaps.length === 0 && category) {
        const aiSwaps = await getAISuggestions(category, 2);
        return res.status(200).json({ swaps: aiSwaps, source: 'ai' });
      }
      return res.status(200).json({ swaps, source: 'curated' });
    } else {
      const good   = shuffleArray(filtered.filter(r => r.swap_level === '1')).slice(0, RESULTS_PER_TIER).map(r => ({ ...r, tier: 'good' }));
      const better = shuffleArray(filtered.filter(r => r.swap_level === '2')).slice(0, RESULTS_PER_TIER).map(r => ({ ...r, tier: 'better' }));
      const swaps  = [...good, ...better];

      if (swaps.length === 0 && category) {
        const aiSwaps = await getAISuggestions(category, 1);
        return res.status(200).json({ swaps: aiSwaps, source: 'ai' });
      }
      return res.status(200).json({ swaps, source: 'curated' });
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'swaps', category: category || null, userLevel },
    });
    return res.status(500).json({ error: err.message });
  }
}
