/**
 * pages/api/swaps.js — Beyond Labels store-bought swap recommendations
 *
 * GET /api/swaps?category=snacks|cereal|condiments
 *
 * Flow:
 *   1. Check 1-hour in-memory cache
 *   2. If stale / empty: fetch CSV from the public Google Sheet
 *   3. Parse CSV → array of swap objects
 *   4. Filter by ?category (optional — omit to return all rows)
 *   5. If 0 curated results AND category is provided: call Claude for AI suggestions
 *   6. Return { swaps, source: 'curated' | 'ai' }
 *
 * CSV column order (exact, no header row expected):
 *   product_name, brand, category, barcode,
 *   certifications, why_it_passes, where_to_buy, image_url
 *
 * Notes:
 *   - certifications: semicolon-separated (e.g. "usda-organic;non-gmo-project-verified")
 *   - why_it_passes:  semicolon-separated reasons (shown as a check-list in the UI)
 *   - where_to_buy:   comma-separated store names (may be quoted in CSV)
 */

import Anthropic from '@anthropic-ai/sdk';

// ── Column definitions ────────────────────────────────────────────────────────
const COLUMNS = [
  'product_name',
  'brand',
  'category',
  'barcode',
  'certifications',
  'why_it_passes',
  'where_to_buy',
  'image_url',
];

// ── Module-level 1-hour cache ─────────────────────────────────────────────────
let _cache = { rows: null, fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── CSV parser ────────────────────────────────────────────────────────────────
/**
 * Minimal RFC-4180-compliant CSV parser.
 * Handles double-quoted fields (including fields containing commas and escaped quotes).
 * Automatically skips a header row if the first cell equals "product_name".
 *
 * @param {string} text - Raw CSV text from Google Sheets export.
 * @returns {Record<string, string>[]} Array of row objects keyed by COLUMNS.
 */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  const rows = [];

  // Detect and skip header row
  let startIdx = 0;
  if (lines[0] && lines[0].toLowerCase().startsWith('product_name')) {
    startIdx = 1;
  }

  for (let li = startIdx; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;

    // Parse one CSV line into fields, respecting double-quoted segments.
    const fields = [];
    let cur = '';
    let inQuote = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') {
          // Escaped quote inside a quoted field
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuote = true;
        } else if (ch === ',') {
          fields.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
    }
    fields.push(cur.trim()); // final field

    const row = {};
    COLUMNS.forEach((col, idx) => {
      row[col] = (fields[idx] ?? '').trim();
    });

    if (row.product_name) rows.push(row); // skip blank rows
  }

  return rows;
}

// ── Sheet fetcher with cache ───────────────────────────────────────────────────
/**
 * Returns all swap rows, fetching from Google Sheets only if the cache is stale.
 *
 * @returns {Promise<Record<string, string>[]>}
 */
async function getSwapRows() {
  const now = Date.now();

  if (_cache.rows && (now - _cache.fetchedAt) < CACHE_TTL_MS) {
    return _cache.rows; // cache hit
  }

  const sheetId = process.env.SWAP_SHEET_ID;
  if (!sheetId) {
    throw new Error('SWAP_SHEET_ID environment variable is not set.');
  }

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'BeyondLabels/1.0 (swap-fetch)' },
  });

  if (!response.ok) {
    throw new Error(
      `Google Sheets fetch failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const csv = await response.text();
  _cache.rows = parseCSV(csv);
  _cache.fetchedAt = now;

  return _cache.rows;
}

// ── AI fallback ───────────────────────────────────────────────────────────────
/**
 * Calls Claude Sonnet to suggest 2-3 clean alternative products in a category.
 * Returns an array of swap-shaped objects marked as AI-generated.
 * Fails gracefully (returns []) if the API key is missing or the call errors.
 *
 * @param {string} category - snacks | cereal | condiments
 * @returns {Promise<Record<string, string>[]>}
 */
async function getAISuggestions(category) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const client = new Anthropic({ apiKey });

  const prompt =
    `You are a clean-food expert helping shoppers find better alternatives ` +
    `to processed grocery products.\n\n` +
    `Suggest 2-3 real, widely-available store-bought products in the "${category}" ` +
    `category that meet ALL of these criteria:\n` +
    `- No seed oils (no canola, soybean, sunflower, corn oil, vegetable oil)\n` +
    `- No artificial additives, dyes, or preservatives\n` +
    `- No high-fructose corn syrup or artificial sweeteners\n` +
    `- Ideally USDA Organic or Non-GMO Project Verified\n\n` +
    `Return ONLY a valid JSON array — no markdown, no explanation:\n` +
    `[\n` +
    `  {\n` +
    `    "product_name": "...",\n` +
    `    "brand": "...",\n` +
    `    "certifications": "non-gmo-project-verified",\n` +
    `    "why_it_passes": "Reason one; Reason two; Reason three",\n` +
    `    "where_to_buy": "Whole Foods, Amazon"\n` +
    `  }\n` +
    `]`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0]?.text || '[]';
    // Strip accidental markdown code fences
    const json = raw.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(json);

    return parsed.map(item => ({
      product_name:   item.product_name  || '',
      brand:          item.brand          || '',
      category,
      barcode:        '',
      certifications: item.certifications || '',
      why_it_passes:  item.why_it_passes  || '',
      where_to_buy:   item.where_to_buy   || '',
      image_url:      '',
      ai_generated:   true,
    }));
  } catch {
    return []; // fail gracefully
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
/**
 * @param {import('next').NextApiRequest}  req
 * @param {import('next').NextApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const { category } = req.query;

  // Validate category if provided
  const VALID_CATEGORIES = ['snacks', 'cereal', 'condiments'];
  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}.`,
    });
  }

  try {
    const allRows = await getSwapRows();

    // Filter by category (if provided)
    const swaps = category
      ? allRows.filter(r => r.category === category)
      : allRows;

    // AI fallback when no curated swap exists for this category
    if (swaps.length === 0 && category) {
      const aiSwaps = await getAISuggestions(category);
      return res.status(200).json({ swaps: aiSwaps, source: 'ai' });
    }

    // Return up to 3 curated swaps
    return res.status(200).json({ swaps: swaps.slice(0, 3), source: 'curated' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
