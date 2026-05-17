/**
 * pages/api/swaps.js — Beyond Labels store-bought swap recommendations
 *
 * GET /api/swaps?category=snacks|cereal|condiments|beverages|dairy|bread|frozen|cooking_oils&userLevel=1|2
 *
 * Flow:
 *   1. Check 1-hour in-memory cache
 *   2. Fetch CSV from public Google Sheet if stale
 *   3. Parse CSV → array of swap objects
 *   4. Filter by ?category (optional)
 *   5. Filter/tag by userLevel:
 *      - Level 2: only swap_level=2 rows, returned flat with tier:'better'
 *      - Level 1: swap_level=1 tagged tier:'good', swap_level=2 tagged tier:'better'
 *   6. AI fallback if 0 curated results and category is provided
 *   7. Return { swaps, source: 'curated' | 'ai' }
 *
 * CSV column order:
 *   product_name, brand, category, barcode,
 *   certifications, why_it_passes, where_to_buy, image_url, swap_level
 *
 * swap_level values: 1 (passes Level 1 criteria), 2 (passes Level 2 strict criteria)
 * Level 2 swaps surface as tier:'better' for Level 1 users.
 */

import Anthropic from '@anthropic-ai/sdk';

const COLUMNS = [
  'product_name',
  'brand',
  'category',
  'barcode',
  'certifications',
  'why_it_passes',
  'where_to_buy',
  'image_url',
  'swap_level',
];

const VALID_CATEGORIES = [
  'snacks', 'cereal', 'condiments', 'beverages', 'dairy', 'bread', 'frozen', 'cooking_oils',
];

let _cache = { rows: null, fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000;

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  const rows = [];
  let startIdx = 0;
  if (lines[0] && lines[0].toLowerCase().startsWith('product_name')) startIdx = 1;

  for (let li = startIdx; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;
    const fields = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { fields.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
    }
    fields.push(cur.trim());
    const row = {};
    COLUMNS.forEach((col, idx) => { row[col] = (fields[idx] ?? '').trim(); });
    if (row.product_name) rows.push(row);
  }
  return rows;
}

async function getSwapRows() {
  const now = Date.now();
  if (_cache.rows && (now - _cache.fetchedAt) < CACHE_TTL_MS) return _cache.rows;

  const sheetId = process.env.SWAP_SHEET_ID;
  if (!sheetId) throw new Error('SWAP_SHEET_ID environment variable is not set.');

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  const response = await fetch(url, { headers: { 'User-Agent': 'BeyondLabels/1.0 (swap-fetch)' } });
  if (!response.ok) throw new Error(`Google Sheets fetch failed: HTTP ${response.status} ${response.statusText}`);

  const csv = await response.text();
  _cache.rows = parseCSV(csv);
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
      model: 'claude-sonnet-4-20250514',
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
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const { category, userLevel: rawUserLevel } = req.query;
  const userLevel = rawUserLevel === '1' ? 1 : 2;

  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}.`,
    });
  }

  try {
    const allRows = await getSwapRows();
    const filtered = category ? allRows.filter(r => r.category === category) : allRows;

    if (userLevel === 2) {
      const swaps = filtered
        .filter(r => r.swap_level === '2')
        .slice(0, 3)
        .map(r => ({ ...r, tier: 'better' }));

      if (swaps.length === 0 && category) {
        const aiSwaps = await getAISuggestions(category, 2);
        return res.status(200).json({ swaps: aiSwaps, source: 'ai' });
      }
      return res.status(200).json({ swaps, source: 'curated' });
    } else {
      const good   = filtered.filter(r => r.swap_level === '1').slice(0, 3).map(r => ({ ...r, tier: 'good' }));
      const better = filtered.filter(r => r.swap_level === '2').slice(0, 3).map(r => ({ ...r, tier: 'better' }));
      const swaps  = [...good, ...better];

      if (swaps.length === 0 && category) {
        const aiSwaps = await getAISuggestions(category, 1);
        return res.status(200).json({ swaps: aiSwaps, source: 'ai' });
      }
      return res.status(200).json({ swaps, source: 'curated' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
