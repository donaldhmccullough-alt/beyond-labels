/**
 * pages/api/scan.js — Beyond Labels barcode scan endpoint
 *
 * POST /api/scan
 * Body (JSON): { barcode: string }
 *
 * Flow:
 *   1. Validate method and input
 *   2. Sanitise barcode (strip non-digits, preserve leading zeros)
 *   3. Fetch product from Open Food Facts
 *   4. Normalise OFF labels_tags → our internal certification strings
 *   5. Run ingredients through rulesEngine.analyzeIngredients()
 *   6. Return structured JSON verdict
 *
 * Response shape (200 — product found):
 * {
 *   verdict:        'red' | 'yellow' | 'green',
 *   flags:          Flag[],
 *   clearedBy:      string | null,
 *   productName:    string,
 *   ingredients:    string | null,
 *   barcode:        string,
 *   source:         'open-food-facts',
 *   found:          true,
 *   labelsDetected: string[]
 * }
 *
 * Response shape (404 — product not in OFF database):
 * {
 *   verdict:        'unverified',
 *   flags:          [],
 *   clearedBy:      null,
 *   productName:    null,
 *   ingredients:    null,
 *   barcode:        string,
 *   source:         'open-food-facts',
 *   found:          false,
 *   labelsDetected: []
 * }
 */

import rulesEngine from '../../lib/rulesEngine';
const { analyzeIngredients } = rulesEngine;

const OFF_BASE = 'https://world.openfoodfacts.org/api/v0/product';

/**
 * Conservative mapping from Open Food Facts labels_tags values to the
 * internal certification strings recognised by the rules engine.
 *
 * Only verified certification labels are mapped.
 * Generic brand claims ("en:no-artificial-flavors", etc.) are intentionally
 * excluded — they have no effect on Cat 2 clearance.
 */
const OFF_LABEL_MAP = {
  'en:usda-organic':              'usda-organic',
  'en:organic':                   'usda-organic',
  'en:non-gmo-project-verified':  'non-gmo-project-verified',
  // "en:no-gmos" is a self-declared claim, not a third-party certification;
  // we do NOT map it to non-gmo-project-verified to avoid false clearance.
};

/**
 * Convert an OFF labels_tags array into our deduplicated internal label array.
 * Unknown or unmapped tags are silently ignored.
 *
 * @param {unknown} labelsTags — value of product.labels_tags from OFF
 * @returns {string[]}
 */
function normalizeLabelTags(labelsTags) {
  if (!Array.isArray(labelsTags)) return [];

  const seen = new Set();
  const result = [];

  for (const tag of labelsTags) {
    const mapped = OFF_LABEL_MAP[String(tag).toLowerCase()];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      result.push(mapped);
    }
  }

  return result;
}

/**
 * Next.js API route handler.
 *
 * @param {import('next').NextApiRequest}  req
 * @param {import('next').NextApiResponse} res
 */
export default async function handler(req, res) {
  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed. Send a POST request with { barcode } in the body.',
    });
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { barcode, userLevel: rawUserLevel } = req.body ?? {};
  const userLevel = rawUserLevel === 1 || rawUserLevel === 2 ? rawUserLevel : 2;

  if (barcode === undefined || barcode === null || barcode === '') {
    return res.status(400).json({
      error: '`barcode` is required in the JSON request body.',
    });
  }

  // Strip everything that isn't a digit (hyphens, spaces, check-digit separators).
  // Leading zeros are preserved because barcodes like 021000025350 are valid.
  const cleanBarcode = String(barcode).trim().replace(/[^0-9]/g, '');

  if (!cleanBarcode) {
    return res.status(400).json({
      error: '`barcode` must contain at least one digit.',
    });
  }

  // ── Fetch from Open Food Facts ────────────────────────────────────────────
  let offData;

  try {
    const response = await fetch(`${OFF_BASE}/${cleanBarcode}.json`, {
      headers: {
        // OFF requests a meaningful User-Agent for non-trivial integrations.
        'User-Agent': 'BeyondLabels/1.0 (session-2-prototype)',
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        error: 'Upstream error from Open Food Facts.',
        detail: `HTTP ${response.status} ${response.statusText}`,
      });
    }

    offData = await response.json();
  } catch (err) {
    return res.status(502).json({
      error: 'Failed to reach Open Food Facts. Check network connectivity.',
      detail: err.message,
    });
  }

  // ── Product not found in OFF database ─────────────────────────────────────
  // OFF returns { status: 0 } when a barcode is not in their database.
  if (!offData || offData.status === 0 || !offData.product) {
    const { verdict, flags, clearedBy } = analyzeIngredients(null);

    return res.status(404).json({
      verdict,          // always 'unverified'
      flags,            // always []
      clearedBy,        // always null
      productName:    null,
      ingredients:    null,
      barcode:        cleanBarcode,
      source:         'open-food-facts',
      found:          false,
      labelsDetected: [],
    });
  }

  // ── Extract fields from OFF product object ────────────────────────────────
  const { product } = offData;

  // Prefer English names/ingredients when available.
  const productName =
    product.product_name_en ||
    product.product_name    ||
    'Unknown Product';

  const ingredientsText =
    product.ingredients_text_en ||
    product.ingredients_text    ||
    null;

  const labelsDetected = normalizeLabelTags(product.labels_tags);

  // ── Run the rules engine ──────────────────────────────────────────────────
  const { verdict, flags, clearedBy } = analyzeIngredients(ingredientsText, labelsDetected, userLevel);

  return res.status(200).json({
    verdict,
    flags,
    clearedBy,
    productName,
    ingredients:    ingredientsText,
    barcode:        cleanBarcode,
    source:         'open-food-facts',
    found:          true,
    labelsDetected,
  });
}
