'use strict';

/**
 * migrateSwapsFromSheet.js — one-time migration of swap product data from
 * the Google Sheet (SWAP_SHEET_ID) into the new `swap_products` Supabase
 * table (Phase 0 of the swaps system overhaul, see CLAUDE.md).
 *
 * Reuses the CSV fetch/parse logic that lived in pages/api/swaps.js at the
 * time of this migration (COLUMNS + parseCSV, copied verbatim below). It
 * cannot literally `require()` pages/api/swaps.js, because that file — like
 * every other file under pages/ and lib/ in this project — uses ES module
 * `import`/`export` syntax that only Next.js's bundler or Jest's next/jest
 * transform can parse; a bare `node` process treats a plain .js file as
 * CommonJS and throws a SyntaxError on `import`. This is the same
 * limitation documented in scripts/goldenMaster/captureSnapshot.js for
 * pages/api/scan.js. If pages/api/swaps.js's CSV parsing ever changes before
 * this script is re-run, update the copy below to match.
 *
 * Same reasoning applies to lib/supabaseServer.js's getSupabaseServer() —
 * it's ESM too, so this script has its own lazy, function-scoped
 * getSupabaseServer() mirror below (same env vars, same null-safety, same
 * "never a module-level client" discipline) rather than importing the real
 * one.
 *
 * Usage:
 *   node scripts/migrateSwapsFromSheet.js            # normal run
 *   node scripts/migrateSwapsFromSheet.js --force     # re-run even if
 *                                                      # swap_products already
 *                                                      # has rows
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
 * SWAP_SHEET_ID — read from .env.local / .env (see readEnvVars() below),
 * same convention as scripts/appendScanCacheToOffResults.js.
 */

const path = require('path');
const fs = require('fs');

const FORCE = process.argv.includes('--force');

// ── Env vars ──────────────────────────────────────────────────────────────
// Plain node does not load Next.js's .env.local the way `next dev`/`next
// build` do, so read it manually — same approach already established in
// scripts/appendScanCacheToOffResults.js.
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
for (const [key, value] of Object.entries(ENV)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// ── Lazy Supabase client — mirrors lib/supabaseServer.js's getSupabaseServer() ──
function getSupabaseServer() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !roleKey) return null;
  try {
    return createClient(url, roleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    return null;
  }
}

// ── CSV fetch/parse — copied from pages/api/swaps.js as of this migration ──
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

async function fetchSheetRows() {
  const sheetId = process.env.SWAP_SHEET_ID;
  if (!sheetId) throw new Error('SWAP_SHEET_ID environment variable is not set.');

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  const response = await fetch(url, { headers: { 'User-Agent': 'BeyondLabels/1.0 (swap-fetch)' } });
  if (!response.ok) throw new Error(`Google Sheets fetch failed: HTTP ${response.status} ${response.statusText}`);

  const csv = await response.text();
  return parseCSV(csv);
}

// ── Row conversion: semicolon/comma-separated strings → arrays ─────────────
function splitList(str, delimiter) {
  if (!str) return [];
  return str.split(delimiter).map(s => s.trim()).filter(Boolean);
}

function toSwapProductRow(sheetRow) {
  const swapLevel = parseInt(sheetRow.swap_level, 10);
  return {
    product_name: sheetRow.product_name,
    brand: sheetRow.brand || null,
    category: sheetRow.category,
    barcode: sheetRow.barcode || null,
    certifications: splitList(sheetRow.certifications, ';'),
    why_it_passes: splitList(sheetRow.why_it_passes, ';'),
    where_to_buy: splitList(sheetRow.where_to_buy, ','),
    image_url: sheetRow.image_url || null,
    swap_level: Number.isInteger(swapLevel) ? swapLevel : null,
    source: 'curated',
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const sb = getSupabaseServer();
  if (!sb) {
    console.error('Supabase client unavailable — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    process.exit(1);
  }

  if (!FORCE) {
    const { data: existingRows, error: checkError } = await sb
      .from('swap_products')
      .select('id')
      .limit(1);
    if (checkError) {
      console.error('Failed to check existing swap_products rows:', checkError.message);
      process.exit(1);
    }
    if (existingRows && existingRows.length > 0) {
      console.warn('swap_products already has rows — skipping migration to avoid duplicates. Pass --force to re-run anyway.');
      process.exit(0);
    }
  }

  console.log('Fetching swap sheet CSV...');
  const sheetRows = await fetchSheetRows();
  console.log(`Parsed ${sheetRows.length} row(s) from the sheet.`);

  const invalidRows = [];
  const insertRows = [];
  for (const row of sheetRows) {
    const converted = toSwapProductRow(row);
    if (converted.swap_level === null) {
      invalidRows.push(row);
      continue;
    }
    insertRows.push(converted);
  }

  if (invalidRows.length > 0) {
    console.warn(`Skipping ${invalidRows.length} row(s) with an invalid/missing swap_level:`, invalidRows.map(r => r.product_name));
  }

  if (insertRows.length === 0) {
    console.warn('No valid rows to insert. Exiting without writing.');
    process.exit(0);
  }

  const { data: inserted, error: insertError } = await sb
    .from('swap_products')
    .insert(insertRows)
    .select('id');

  if (insertError) {
    console.error('Insert failed:', insertError.message);
    process.exit(1);
  }

  console.log(`Inserted ${inserted.length} row(s) into swap_products.`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
