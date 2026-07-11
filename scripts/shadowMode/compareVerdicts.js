'use strict';

/**
 * scripts/shadowMode/compareVerdicts.js
 *
 * Stage 4 of the L1/L2 unification project: shadow-mode comparison.
 *
 * Runs the CORRECTED target logic against all 135 Golden Master cases, and
 * diffs it against the real, frozen scan.js output already captured in
 * scripts/goldenMaster/snapshot-baseline.json.
 *
 * Nothing here is wired into any live path:
 *   - pages/api/scan.js is read/required but never modified.
 *   - No Supabase client is constructed; no network calls happen.
 *   - No PROMPT_VERSION bump — this stage changes no production behavior.
 *
 * Run: node scripts/shadowMode/compareVerdicts.js
 * Writes: scripts/shadowMode/shadow-report.json, scripts/shadowMode/shadow-report.md
 *
 * ── Stage 5a update: no more mirrored/duplicated helpers ──────────────────
 * Through Stage 4, this script hand-mirrored several of pages/api/scan.js's
 * private helpers (normalizeLabelTags, isMeatProduct, isSeafoodProduct,
 * isGameMeatProduct, detectWildCaught, allIngredientsPrefixedOrganic,
 * allIngredientsAreWaterSafe, maskIgnoredIngredients, mapProductCategory),
 * each flagged with a "will drift if scan.js changes" comment, because those
 * functions were private to scan.js and its ES module syntax meant plain
 * `node` couldn't `require()` it at all.
 *
 * Stage 5a extracted all of those helpers into lib/scanHelpers.js (a pure
 * relocation — scan.js now imports from there too, verified via the full
 * test suite passing unchanged) and ported this script's own hand-written
 * corrected-verdict interpreter into lib/verdictEngine.js as a real,
 * callable production module (computeCorrectedVerdict()). This script now
 * genuinely REQUIRES that shared module rather than maintaining its own
 * copy of the logic — the drift risk Stage 4 flagged no longer exists.
 */

const fs = require('fs');
const path = require('path');

const { computeCorrectedVerdict } = require('../../lib/verdictEngine');

// ════════════════════════════════════════════════════════════════════════
// Diffing
// ════════════════════════════════════════════════════════════════════════

/** Reduces a flags array to the comparable shape: category + severity only
 *  (per decision #2 — summary text is presentation, not logic), sorted so
 *  array-order differences (e.g. which injected flag got prepended first)
 *  don't themselves count as a diff unless the actual member sets differ. */
function flagsForComparison(flags) {
  return flags
    .map(f => `${f.category}:${f.severity}`)
    .sort();
}

const CORRECTION_TAGS = {
  bioengineering: '#1 (bioengineering organic/non-gmo clearance)',
  conventional_meat_game: '#2 (conventional_meat game-meat no-op)',
  conventional_eggs_priority: '#4 (conventional_eggs priority over conventional_meat)',
};

/**
 * Classifies a diff between the corrected interpreter's output and the real
 * snapshot as "expected" (attributable to one of the three known
 * corrections) or "unexpected" (anything else). This is a best-effort
 * classification based on which categories/fields actually changed, not a
 * guarantee — every diff, expected or not, is still recorded in full in the
 * output so nothing is hidden by the classification.
 */
function classifyDiff(caseId, correctedOut, liveOut) {
  const correctedFlagCats = new Set(correctedOut.flags.map(f => f.category));
  const liveFlagCats = new Set(liveOut.flags.map(f => f.category));
  const tags = new Set();

  if (liveFlagCats.has('bioengineering') && !correctedFlagCats.has('bioengineering')) {
    tags.add(CORRECTION_TAGS.bioengineering);
  }
  if (/^meat-game-/.test(caseId)) {
    tags.add(CORRECTION_TAGS.conventional_meat_game);
  }
  if (
    (liveFlagCats.has('conventional_meat') !== correctedFlagCats.has('conventional_meat')) &&
    (liveFlagCats.has('conventional_eggs') || correctedFlagCats.has('conventional_eggs'))
  ) {
    tags.add(CORRECTION_TAGS.conventional_eggs_priority);
  }

  return tags.size > 0 ? { classification: 'expected', tags: [...tags] } : { classification: 'unexpected', tags: [] };
}

/** Builds the field-level diff object for one case. Returns null if every
 *  in-scope field matches. */
function diffCase(caseId, correctedOut, liveOut) {
  const fieldDiffs = {};

  const correctedVerdict = correctedOut.verdict;
  const liveVerdict = liveOut.verdict;
  if (correctedVerdict !== liveVerdict) {
    fieldDiffs.verdict = { corrected: correctedVerdict, live: liveVerdict };
  }

  const correctedFlags = flagsForComparison(correctedOut.flags);
  const liveFlags = flagsForComparison(liveOut.flags);
  if (JSON.stringify(correctedFlags) !== JSON.stringify(liveFlags)) {
    fieldDiffs.flags = { corrected: correctedFlags, live: liveFlags };
  }

  if (correctedOut.clearedBy !== liveOut.clearedBy) {
    fieldDiffs.clearedBy = { corrected: correctedOut.clearedBy, live: liveOut.clearedBy };
  }

  if (correctedOut.isMeat !== liveOut.isMeat) {
    fieldDiffs.isMeat = { corrected: correctedOut.isMeat, live: liveOut.isMeat };
  }

  if (correctedOut.oliveCaveat !== liveOut.oliveCaveat) {
    fieldDiffs.oliveCaveat = { corrected: correctedOut.oliveCaveat, live: liveOut.oliveCaveat };
  }

  if (Object.keys(fieldDiffs).length === 0) return null;
  return fieldDiffs;
}

// ════════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════════

function main() {
  const inputsPath = path.join(__dirname, '..', 'goldenMaster', 'inputs.json');
  const snapshotPath = path.join(__dirname, '..', 'goldenMaster', 'snapshot-baseline.json');
  const inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

  const liveById = new Map(snapshot.results.map(r => [r.id, r.output]));

  const perCase = [];
  let expectedCount = 0;
  let unexpectedCount = 0;
  const unexpectedDetails = [];

  for (const testCase of inputs) {
    const liveOut = liveById.get(testCase.id);
    if (!liveOut) {
      throw new Error(`No snapshot-baseline.json entry found for case id "${testCase.id}" — inputs.json and the snapshot have drifted apart.`);
    }

    const correctedOut = computeCorrectedVerdict({
      ingredientText: testCase.ingredientText,
      productLabels: testCase.productLabels ?? [],
      categoriesTags: testCase.categoriesTags ?? [],
      productName: testCase.productName,
      userLevel: testCase.userLevel,
    });

    const fieldDiffs = diffCase(testCase.id, correctedOut, liveOut);

    let entry = {
      id: testCase.id,
      description: testCase.description,
      userLevel: testCase.userLevel,
      hasDiff: fieldDiffs !== null,
    };

    if (fieldDiffs) {
      const { classification, tags } = classifyDiff(testCase.id, correctedOut, liveOut);
      entry = {
        ...entry,
        classification,
        expectedCorrections: tags,
        fieldDiffs,
        correctedOutput: {
          verdict: correctedOut.verdict,
          flags: flagsForComparison(correctedOut.flags),
          clearedBy: correctedOut.clearedBy,
          isMeat: correctedOut.isMeat,
          oliveCaveat: correctedOut.oliveCaveat,
        },
        liveOutput: {
          verdict: liveOut.verdict,
          flags: flagsForComparison(liveOut.flags),
          clearedBy: liveOut.clearedBy,
          isMeat: liveOut.isMeat,
          oliveCaveat: liveOut.oliveCaveat,
        },
      };

      if (classification === 'expected') {
        expectedCount++;
      } else {
        unexpectedCount++;
        unexpectedDetails.push(entry);
      }
    }

    perCase.push(entry);
  }

  const methodologyNotes = {
    bioengineeringClearance:
      'Bioengineering clearance is usda-organic-label ONLY (non-gmo-project-verified-label was removed as a clearance mechanism for this category ' +
      'specifically — see lib/verdictRules.js DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded, decided 2026-07-11). Organic-ingredient-PREFIX ' +
      "clearance (still documented as a third mechanism on the bioengineering row) remains NOT implemented in lib/verdictEngine.js — replicating it " +
      "faithfully would require re-deriving lib/rulesEngine.js's private isPrecededByOrganic(), which needs the character index of the match inside " +
      "the engine's internal cleaned text (not exposed by analyzeIngredients()'s return value), and no current Golden Master case exercises that " +
      'combination anyway.',
    bioengineeringCoverageGap:
      'No current Golden Master case combines "bioengineered"/"genetically modified" ingredient text with a usda-organic LABEL — only the ' +
      'non-gmo-project-verified label path (clear-non-gmo-bioengineering-l1/l2) is covered, and that path no longer clears bioengineering. This means ' +
      'NO case in the current input set exercises bioengineering\'s remaining (organic-label) clearance mechanism at all. Flagged as a candidate for a ' +
      'future Stage 1 supplement.',
    comparisonScope:
      'Diffed fields: verdict, flags (by category+severity only — summary text excluded as presentation, not logic), clearedBy, isMeat, oliveCaveat. ' +
      'Excluded entirely: unverifiedIngredients, productCategory (both unrelated to verdict logic). unverifiedReason is computed by ' +
      'lib/verdictEngine.js for completeness but is also excluded from the diff.',
    sharedHelpersExtraction:
      'Stage 5a: pages/api/scan.js\'s private helpers (normalizeLabelTags, isMeatProduct, isSeafoodProduct, isGameMeatProduct, detectWildCaught, ' +
      'allIngredientsPrefixedOrganic, allIngredientsAreWaterSafe, maskIgnoredIngredients, mapProductCategory, and the MEAT_CATEGORIES/' +
      'SEAFOOD_CATEGORIES/GAME_MEAT_CATEGORIES sets) were extracted verbatim into lib/scanHelpers.js — a pure relocation, verified via the full test ' +
      'suite passing unchanged. scan.js now imports from there instead of defining them locally; this script\'s own former hand-mirrored copies (with ' +
      '"will drift" comments, present through the Stage 4 run) are gone — the corrected interpreter itself was also extracted into ' +
      'lib/verdictEngine.js\'s computeCorrectedVerdict(), which this script now genuinely requires. No more duplicated logic anywhere.',
    correction4Scope:
      'The conventional_eggs-over-conventional_meat priority correction (#4) is scoped narrowly to the same ordering the original discrepancy report ' +
      'described — conventional_eggs checked before the generic isConventionalMeat branch (live Node 8 vs Node 8b) — at both levels. It is NOT extended ' +
      'to the farmed-seafood (Node 5b) or gelatin (Node 8c) conventional_meat injection sites, which were never part of the reported ordering issue.',
    correction2GatedGreenRevision:
      'Correction #2 (game-meat handling) is a GATED GREEN, mirroring the wild-caught Node 5 pattern exactly, instead of a full no-op removed from the ' +
      'priority chain. An earlier no-op design surfaced an undecided side effect — a CLEAN game-meat product (zero other flags) fell through to Node ' +
      "14's default YELLOW instead of getting an automatic GREEN, a new L1/L2 asymmetry nobody had actually decided on (L1's equivalent no-op leaves a " +
      "clean game-meat product GREEN via the engine's own default). Gated green resolves this: a clean game-meat product now correctly shows GREEN " +
      'again, matching L1, while a game-meat product WITH a genuine pre-existing reject-severity flag still has that flag preserved rather than ' +
      'discarded (the gate condition is simply false, so the branch does not match and the chain falls through normally to whichever node matches the ' +
      'real concern).',
    correction2CoverageGap:
      'No current Golden Master case combines game-meat category with a separate reject-severity flag present at the same time — the only two ' +
      'game-meat cases in the input set (meat-game-l1/l2) use a single clean fixture ("venison, water, salt") with zero flags in either category. This ' +
      "means the gate's actual discriminating behavior — leaving a reject flag alone when one exists — is exercised by neither this comparison run nor " +
      'lib/verdictRules.test.js\'s data-level assertions (which check the table documents the mechanism, not that it behaves correctly against a real ' +
      'case). Flagged as a candidate for a future Stage 1 supplement (e.g. a game-meat product with an added bioengineering disclosure and no ' +
      'organic/non-gmo label), not built as part of this stage.',
  };

  const report = {
    generatedAt: new Date().toISOString(),
    totalCases: inputs.length,
    matchingCases: perCase.filter(c => !c.hasDiff).length,
    expectedDiffCount: expectedCount,
    unexpectedDiffCount: unexpectedCount,
    methodologyNotes,
    cases: perCase,
  };

  const reportPath = path.join(__dirname, 'shadow-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const md = buildMarkdownSummary(report, unexpectedDetails);
  const mdPath = path.join(__dirname, 'shadow-report.md');
  fs.writeFileSync(mdPath, md);

  console.log(md);
  console.log(`\nFull structured diff written to: ${reportPath}`);
  console.log(`Markdown summary written to: ${mdPath}`);
}

function buildMarkdownSummary(report, unexpectedDetails) {
  const lines = [];
  lines.push('# Shadow-Mode Comparison — Stage 4/5a Summary');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`- Total cases: ${report.totalCases}`);
  lines.push(`- Matching (no diff): ${report.matchingCases}`);
  lines.push(`- Expected diffs (attributable to #1/#2/#4): ${report.expectedDiffCount}`);
  lines.push(`- **Unexpected diffs: ${report.unexpectedDiffCount}**`);
  lines.push('');
  lines.push('## Methodology notes');
  for (const [key, note] of Object.entries(report.methodologyNotes)) {
    lines.push(`### ${key}`);
    lines.push(note);
    lines.push('');
  }

  lines.push('## Unexpected diffs (full detail)');
  if (unexpectedDetails.length === 0) {
    lines.push('None.');
  } else {
    for (const entry of unexpectedDetails) {
      lines.push(`### ${entry.id} (Level ${entry.userLevel})`);
      lines.push(entry.description);
      lines.push('```json');
      lines.push(JSON.stringify(entry.fieldDiffs, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

main();
