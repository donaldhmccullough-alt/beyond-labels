#!/usr/bin/env node
/**
 * scripts/seed-sheet.js
 *
 * Reads /data/sample-swaps.csv and prints a header row + all data rows,
 * tab-separated and ready to paste directly into Google Sheets.
 *
 * Usage:
 *   node scripts/seed-sheet.js
 *
 * Then:
 *   1. Open the Google Sheet at ID: 1_QFQIElPjPxo5yquDQ0XS-g_QBYjaLNroYRcUuQ26dY
 *   2. Click cell A1
 *   3. Paste — Google Sheets will split on tabs into the correct columns
 *
 * Column order:
 *   product_name | brand | category | barcode | certifications |
 *   why_it_passes | where_to_buy | image_url
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── CSV parser (same logic as the API route) ──────────────────────────────────
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

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  const rows  = [];

  // Skip header row if present
  let startIdx = 0;
  if (lines[0] && lines[0].toLowerCase().startsWith('product_name')) {
    startIdx = 1;
  }

  for (let li = startIdx; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;

    const fields = [];
    let cur     = '';
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

// ── Main ──────────────────────────────────────────────────────────────────────
const csvPath = path.join(__dirname, '..', 'data', 'sample-swaps.csv');

if (!fs.existsSync(csvPath)) {
  console.error(`ERROR: Could not find ${csvPath}`);
  process.exit(1);
}

const csv  = fs.readFileSync(csvPath, 'utf8');
const rows = parseCSV(csv);

console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  BEYOND LABELS — Google Sheet Seed Data');
console.log('  Copy everything between the dashed lines and paste into A1');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');
console.log('─── PASTE START ────────────────────────────────────────────────────');
console.log('');

// Header row
console.log(COLUMNS.join('\t'));

// Data rows — tab-separated so Sheets splits them correctly
rows.forEach(row => {
  const line = COLUMNS.map(col => row[col] || '').join('\t');
  console.log(line);
});

console.log('');
console.log('─── PASTE END ──────────────────────────────────────────────────────');
console.log('');
console.log(`✅  ${rows.length} swap entries ready.`);
console.log('');
console.log('Instructions:');
console.log('  1. Open https://docs.google.com/spreadsheets/d/1_QFQIElPjPxo5yquDQ0XS-g_QBYjaLNroYRcUuQ26dY');
console.log('  2. Click cell A1');
console.log('  3. Paste (Ctrl+V / Cmd+V)');
console.log('  4. Each column will auto-populate across the 8 columns');
console.log('');
console.log('Then make the sheet publicly readable:');
console.log('  Share → Anyone with the link → Viewer');
console.log('');
