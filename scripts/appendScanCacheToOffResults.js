'use strict';

/**
 * appendScanCacheToOffResults.js
 *
 * Appends new scan_cache products to scripts/off-test-results-cumulative.csv.
 * "New" = any scan_cache barcode not already present anywhere in the CSV's
 * barcode column. Existing rows are never modified.
 *
 * This is a SEPARATE tool from off-rules-tester.js. That script's own
 * scan_cache phase re-derives BOTH verdict_l1 and verdict_l2 from bare
 * `analyzeIngredients(text, [], level)` using whatever rules engine code is
 * currently on disk — meaning every time it's re-run, previously-logged
 * scan_cache rows would silently get "corrected" to current-code behavior,
 * losing the historical prompt_version they actually ran under. That's fine
 * for L1 (scan_cache has no real per-product L1 history to preserve — see
 * below) but wrong for L2 test-results logging, which is meant to be a
 * historical record of what a real scan actually produced at the time.
 *
 * This script instead:
 *   - Reads verdict_l2 / flags_l2 / prompt_version DIRECTLY from each
 *     scan_cache row's own stored columns — never re-derived, never
 *     "corrected" for later rule changes. This is the historical record.
 *   - For verdict_l1: scan_cache is keyed on (barcode, user_level), so a
 *     small number of barcodes have a REAL cached user_level=1 row alongside
 *     the user_level=2 row. When that exists, it's used directly (also
 *     historical, also authoritative — not a re-derivation). Only when no
 *     real L1 row exists does this script fall back to computing L1 via
 *     bare `analyzeIngredients(ingredients, [], 1)` against the CURRENT
 *     rules engine — this matches the exact convention already used by
 *     every prior scan_cache-sourced row in this CSV (confirmed by
 *     inspection: 100% of previously-added scan_cache rows use this same
 *     bare-engine L1 approach, none left L1 blank while L2 was populated).
 *     This is NOT a full reproduction of scan.js's real L1 path — it's
 *     missing the L1 overrides that need OFF label/category data
 *     (wild-caught/game-meat seafood exemptions, meat/dairy caution
 *     injection) since that data isn't stored in scan_cache. It captures
 *     the engine-level L1 severity/clearance behavior only (e.g.
 *     LEVEL_1_YELLOW_CATEGORIES downgrades, gluten_grains always-optional).
 *
 * CSV column conventions (reverse-engineered from the existing file, since
 * off-rules-tester.js's own CSV_COLUMNS constant uses different names —
 * "level_changes" vs this file's actual "verdicts_differ" header, and that
 * script was never actually the tool that produced this file's real header):
 *   - Header/column order is exactly:
 *     category,barcode,product_name,brand,run_date,prompt_version,
 *     ingredients_preview,verdict_l1,verdict_l2,decisive_flags_l1,
 *     optional_flags_l1,decisive_flags_l2,optional_flags_l2,verdicts_differ,
 *     language_skipped,ingredients_full
 *   - verdict labels: GREEN/YELLOW/RED/UNVERIFIED/INCONCLUSIVE (uppercase).
 *     The file contains an older PASS/FAIL/CAUTION vocabulary from its
 *     earliest sessions (prompt_version 20 era) but the current convention,
 *     confirmed against the most recent batch (100% of prompt_version 32
 *     rows), is GREEN/YELLOW/RED — that's what this script writes.
 *   - decisive_flags_* / optional_flags_*: reject-severity flags are
 *     "decisive", caution-severity are "optional"; gluten_grains is always
 *     optional (paywall feature, excluded from verdict calculation).
 *     Format: comma-separated category names, "(n)" appended when a
 *     category fires more than once. Reused verbatim from off-rules-tester.js.
 *   - ingredients_preview: ingredients_full.slice(0, 120) — measured
 *     directly against 1,519 existing truncated rows, 100% exact match,
 *     zero deviation.
 *   - language_skipped: TRUE/FALSE via the same isEnglish() heuristic
 *     off-rules-tester.js already uses for scan_cache rows (no `lang`
 *     field available, so it falls back to English-structural-word +
 *     non-ASCII detection). When TRUE, all verdict/flag columns are left
 *     blank, matching existing convention exactly (blank verdict_l1/l2 in
 *     the existing file correlates 100% with language_skipped=TRUE — there
 *     is no existing precedent for blank-L1-but-populated-L2).
 *   - verdicts_differ: TRUE/FALSE, verdict_l1 !== verdict_l2 (uppercase
 *     labels). Left blank if either side is blank/unavailable.
 *   - run_date: the scan_cache row's own `created_at`, sliced to YYYY-MM-DD.
 *     Uses the L2 row's created_at when both L1 and L2 exist for a barcode.
 *   - 'unverified'-verdict scan_cache rows always have NULL ingredients (no
 *     product-not-found / no-ingredients-in-OFF case has real text to log)
 *     — these are skipped entirely, matching off-rules-tester.js's existing
 *     "skip products with no usable ingredient text" rule.
 *   - 'inconclusive'-verdict rows DO have real ingredient text and ARE
 *     included, labeled INCONCLUSIVE.
 *
 * Usage: node scripts/appendScanCacheToOffResults.js [--dry-run]
 *   --dry-run   Print the summary without writing to the CSV.
 */

const path = require('path');
const fs   = require('fs');

const { analyzeIngredients } = require(path.join(__dirname, '..', 'lib', 'rulesEngine'));

const DRY_RUN = process.argv.includes('--dry-run');
const SAMPLE  = process.argv.includes('--sample'); // print first 3 new rows as JSON for inspection

// ── Paths ─────────────────────────────────────────────────────────────────
const CUMULATIVE_PATH = path.join(__dirname, 'off-test-results-cumulative.csv');

// ── Env vars ──────────────────────────────────────────────────────────────
function readEnvVars() {
  const vars = {};
  for (const file of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) vars[m[1]] = m[2];
    }
  }
  return vars;
}
const ENV = readEnvVars();
const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL || '';
// Service role key is used (not anon) because this reads every scan_cache
// row regardless of RLS policy — the anon key's SELECT policy may not cover
// every column needed here.
const SUPABASE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// ── CSV columns — must match the REAL existing header exactly ───────────────
const CSV_COLUMNS = [
  'category', 'barcode', 'product_name', 'brand',
  'run_date', 'prompt_version',
  'ingredients_preview',
  'verdict_l1', 'verdict_l2',
  'decisive_flags_l1', 'optional_flags_l1',
  'decisive_flags_l2', 'optional_flags_l2',
  'verdicts_differ', 'language_skipped',
  'ingredients_full',
];

const INGREDIENTS_PREVIEW_LEN = 120;

const KNOWN_CATEGORIES = new Set([
  'chips', 'snacks', 'cereal', 'condiments', 'beverages',
  'dairy', 'bread', 'frozen', 'cooking_oils', 'meat',
]);

// ── Language detection — reused verbatim from off-rules-tester.js ───────────
const ENGLISH_STRUCTURAL_WORDS = [
  'water', 'salt', 'sugar', 'flour', 'oil', 'milk', 'cream', 'butter',
  'yeast', 'starch', 'syrup', 'extract', 'powder', 'acid', 'wheat',
  'corn', 'rices?', 'oats?',
  'organic', 'honey', 'vitamins?', 'vinegar', 'juice', 'bananas?',
  'mango(?:es)?', 'berry|berries', 'grapes?', 'peanuts?', 'cashews?',
  'walnuts?', 'pumpkins?', 'cinnamon', 'tomato(?:es)?', 'lemons?',
  'coconuts?', 'avocado(?:s)?', 'olives?', 'salmon', 'tuna', 'beef',
  'chicken', 'pork', 'dates?', 'apples?', 'spinach',
  'strawberry|strawberries', 'raspberry|raspberries',
  'blueberry|blueberries', 'cranberry|cranberries', 'raisins?',
  'pistachio(?:s)?', 'almonds?', 'pecans?', 'pine\\s+nuts?', 'hemp',
  'flaxseed', 'flax', 'kiwifruit', 'kiwi', 'pears?', 'onions?', 'garlic',
  'peppers?', 'agave', 'protein', 'gum', 'orange(?:s)?', 'mandarins?',
  'cod',
];
const ENGLISH_WORD_RES = ENGLISH_STRUCTURAL_WORDS.map(w => new RegExp(`\\b(?:${w})\\b`, 'i'));
const BENIGN_SYMBOLS_RE = /[®™©‘’“”–—°]/g;
const NON_ASCII_RE = /[^\x00-\x7F]/;

function countEnglishStructuralWords(rawText) {
  return ENGLISH_WORD_RES.filter(re => re.test(rawText)).length;
}
function hasNonAsciiSignal(rawText) {
  return NON_ASCII_RE.test(rawText.replace(BENIGN_SYMBOLS_RE, ''));
}
function isEnglish(lang, rawText) {
  if (lang && typeof lang === 'string' && lang.trim() !== '') {
    return lang.trim().toLowerCase() === 'en';
  }
  const text = rawText || '';
  return countEnglishStructuralWords(text) >= 1 && !hasNonAsciiSignal(text);
}

// ── Flag utilities — reused verbatim from off-rules-tester.js ───────────────
function splitFlags(flags, verdict) {
  const alwaysOptional = flags.filter(f => f.category === 'gluten_grains');
  const effective      = flags.filter(f => f.category !== 'gluten_grains');
  if (verdict === 'red') {
    return {
      decisive: effective.filter(f => f.severity === 'reject'),
      optional: [...effective.filter(f => f.severity === 'caution'), ...alwaysOptional],
    };
  }
  if (verdict === 'yellow') return { decisive: effective, optional: alwaysOptional };
  return { decisive: [], optional: alwaysOptional };
}
function formatFlags(flags) {
  if (!flags.length) return '';
  const counts = {};
  for (const f of flags) counts[f.category] = (counts[f.category] || 0) + 1;
  return Object.entries(counts)
    .map(([cat, n]) => (n > 1 ? `${cat} (${n})` : cat))
    .join(', ');
}
const verdictLabel = v =>
  ({ green: 'GREEN', yellow: 'YELLOW', red: 'RED', unverified: 'UNVERIFIED', inconclusive: 'INCONCLUSIVE' }[v] || 'UNKNOWN');

// ── CSV read/write helpers ────────────────────────────────────────────────

function csvCell(value) {
  if (value == null) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}
function rowToLine(row) {
  return CSV_COLUMNS.map(col => csvCell(row[col])).join(',');
}

/**
 * Full-stream RFC4180-style CSV parser. Existing rows in this file contain
 * LEGITIMATE embedded newlines inside quoted ingredients_full fields — a
 * naive line-split-then-parse approach corrupts the file (confirmed: it
 * fabricates ~500 phantom garbage rows from mid-field text). This parser
 * walks the whole file as one character stream and only ends a row on an
 * actual unquoted newline.
 */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  let i = 0;
  const n = content.length;
  while (i < n) {
    const c = content[i];
    if (inQ) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++; continue;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function loadExistingBarcodes() {
  if (!fs.existsSync(CUMULATIVE_PATH)) return new Set();
  const content = fs.readFileSync(CUMULATIVE_PATH, 'utf8');
  const allRows = parseCsv(content);
  if (allRows.length <= 1) return new Set();
  const headers = allRows[0];
  const barcodeIdx = headers.indexOf('barcode');
  if (barcodeIdx < 0) throw new Error('Could not find "barcode" column in existing CSV header.');
  const set = new Set();
  for (const r of allRows.slice(1)) {
    if (r[barcodeIdx]) set.add(r[barcodeIdx]);
  }
  return set;
}

function appendRows(newRows) {
  if (!newRows.length) return;
  const lines = newRows.map(rowToLine).join('\r\n');
  fs.appendFileSync(CUMULATIVE_PATH, lines + '\r\n', 'utf8');
}

// ── scan_cache fetch (paginated, all rows, both user levels) ────────────────
async function fetchAllScanCache() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase credentials not found in .env.local/.env');
  }
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' };
  const cols = 'barcode,user_level,verdict,flags,cleared_by,ingredients,product_name,product_category,prompt_version,created_at';
  let all = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/scan_cache?select=${cols}&order=barcode.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`scan_cache fetch failed: HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }
  return all;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (no file changes) ===' : '=== Appending new scan_cache rows ===');

  const existingBarcodes = loadExistingBarcodes();
  console.log(`Existing distinct barcodes in CSV: ${existingBarcodes.size}`);

  const allRecords = await fetchAllScanCache();
  console.log(`scan_cache total rows fetched: ${allRecords.length}`);

  // Group by barcode → { l1, l2 }
  const byBarcode = new Map();
  for (const rec of allRecords) {
    if (!rec.barcode) continue;
    if (!byBarcode.has(rec.barcode)) byBarcode.set(rec.barcode, { l1: null, l2: null });
    const entry = byBarcode.get(rec.barcode);
    if (rec.user_level === 1) entry.l1 = rec;
    else if (rec.user_level === 2) entry.l2 = rec;
  }

  const newRows = [];
  const categoryTally = {};
  let skippedNoIngredients = 0;
  let skippedAlreadyPresent = 0;
  let skippedUnverifiedNoText = 0;
  let langSkippedCount = 0;
  let realL1Used = 0;
  let derivedL1Used = 0;
  let blankL1Count = 0;

  for (const [barcode, { l1, l2 }] of byBarcode) {
    if (existingBarcodes.has(barcode)) { skippedAlreadyPresent++; continue; }

    // Primary source: L2 if present, else L1.
    const primary = l2 || l1;
    if (!primary) continue;

    if (primary.verdict === 'unverified') { skippedUnverifiedNoText++; continue; }

    const ingredientsText = (l2 && l2.ingredients) || (l1 && l1.ingredients) || null;
    if (!ingredientsText || typeof ingredientsText !== 'string' || ingredientsText.trim() === '') {
      skippedNoIngredients++;
      continue;
    }

    const category = KNOWN_CATEGORIES.has(primary.product_category) ? primary.product_category : 'uncategorized';
    const productName = primary.product_name || '';
    const runDate = (primary.created_at || '').slice(0, 10);
    const promptVersion = primary.prompt_version != null ? String(primary.prompt_version) : '';

    const row = {
      category,
      barcode,
      product_name: productName,
      brand: '',
      run_date: runDate,
      prompt_version: promptVersion,
      ingredients_preview: ingredientsText.slice(0, INGREDIENTS_PREVIEW_LEN),
      verdict_l1: '',
      verdict_l2: '',
      decisive_flags_l1: '',
      optional_flags_l1: '',
      decisive_flags_l2: '',
      optional_flags_l2: '',
      verdicts_differ: '',
      language_skipped: 'FALSE',
      ingredients_full: ingredientsText,
    };

    if (!isEnglish(null, ingredientsText)) {
      row.language_skipped = 'TRUE';
      langSkippedCount++;
      newRows.push(row);
      categoryTally[category] = (categoryTally[category] || 0) + 1;
      continue;
    }

    // ── L2: use the REAL stored verdict/flags, never re-derived ──────────
    let vl2Label = '';
    if (l2) {
      const { decisive: d2, optional: o2 } = splitFlags(l2.flags || [], l2.verdict);
      vl2Label = verdictLabel(l2.verdict);
      row.verdict_l2 = vl2Label;
      row.decisive_flags_l2 = formatFlags(d2);
      row.optional_flags_l2 = formatFlags(o2);
    }

    // ── L1: real cached row if it exists, else fall back to bare engine ──
    let vl1Label = '';
    if (l1) {
      const { decisive: d1, optional: o1 } = splitFlags(l1.flags || [], l1.verdict);
      vl1Label = verdictLabel(l1.verdict);
      row.verdict_l1 = vl1Label;
      row.decisive_flags_l1 = formatFlags(d1);
      row.optional_flags_l1 = formatFlags(o1);
      realL1Used++;
    } else {
      try {
        const resultL1 = analyzeIngredients(ingredientsText, [], 1);
        const { decisive: d1, optional: o1 } = splitFlags(resultL1.flags, resultL1.verdict);
        vl1Label = verdictLabel(resultL1.verdict);
        row.verdict_l1 = vl1Label;
        row.decisive_flags_l1 = formatFlags(d1);
        row.optional_flags_l1 = formatFlags(o1);
        derivedL1Used++;
      } catch {
        blankL1Count++;
      }
    }

    if (vl1Label && vl2Label) {
      row.verdicts_differ = vl1Label !== vl2Label ? 'TRUE' : 'FALSE';
    }

    newRows.push(row);
    categoryTally[category] = (categoryTally[category] || 0) + 1;
  }

  console.log(`\nNew rows to add: ${newRows.length}`);
  console.log(`  Already present (skipped): ${skippedAlreadyPresent}`);
  console.log(`  Skipped — verdict 'unverified' (no ingredient text): ${skippedUnverifiedNoText}`);
  console.log(`  Skipped — no usable ingredient text otherwise: ${skippedNoIngredients}`);
  console.log(`  Language-skipped (included, blank verdict/flags): ${langSkippedCount}`);
  console.log(`  L1 from real cached scan_cache row: ${realL1Used}`);
  console.log(`  L1 derived via bare analyzeIngredients() (no real L1 row): ${derivedL1Used}`);
  console.log(`  L1 left blank (engine error): ${blankL1Count}`);
  console.log('\nBy category:');
  for (const [cat, n] of Object.entries(categoryTally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${n}`);
  }

  if (SAMPLE) {
    console.log('\n--- Sample rows (first 3) ---');
    console.log(JSON.stringify(newRows.slice(0, 3), null, 2));
  }

  if (!DRY_RUN && newRows.length) {
    appendRows(newRows);
    console.log(`\nAppended ${newRows.length} rows to ${CUMULATIVE_PATH}`);
  } else if (DRY_RUN) {
    console.log('\nDry run — no file changes made.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
