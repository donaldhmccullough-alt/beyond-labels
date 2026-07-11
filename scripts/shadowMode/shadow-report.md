# Shadow-Mode Comparison — Stage 4/5a Summary

Generated: 2026-07-11T17:58:49.450Z

- Total cases: 135
- Matching (no diff): 133
- Expected diffs (attributable to #1/#2/#4): 2
- **Unexpected diffs: 0**

## Methodology notes
### bioengineeringClearance
Bioengineering clearance is usda-organic-label ONLY (non-gmo-project-verified-label was removed as a clearance mechanism for this category specifically — see lib/verdictRules.js DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded, decided 2026-07-11). Organic-ingredient-PREFIX clearance (still documented as a third mechanism on the bioengineering row) remains NOT implemented in lib/verdictEngine.js — replicating it faithfully would require re-deriving lib/rulesEngine.js's private isPrecededByOrganic(), which needs the character index of the match inside the engine's internal cleaned text (not exposed by analyzeIngredients()'s return value), and no current Golden Master case exercises that combination anyway.

### bioengineeringCoverageGap
No current Golden Master case combines "bioengineered"/"genetically modified" ingredient text with a usda-organic LABEL — only the non-gmo-project-verified label path (clear-non-gmo-bioengineering-l1/l2) is covered, and that path no longer clears bioengineering. This means NO case in the current input set exercises bioengineering's remaining (organic-label) clearance mechanism at all. Flagged as a candidate for a future Stage 1 supplement.

### comparisonScope
Diffed fields: verdict, flags (by category+severity only — summary text excluded as presentation, not logic), clearedBy, isMeat, oliveCaveat. Excluded entirely: unverifiedIngredients, productCategory (both unrelated to verdict logic). unverifiedReason is computed by lib/verdictEngine.js for completeness but is also excluded from the diff.

### sharedHelpersExtraction
Stage 5a: pages/api/scan.js's private helpers (normalizeLabelTags, isMeatProduct, isSeafoodProduct, isGameMeatProduct, detectWildCaught, allIngredientsPrefixedOrganic, allIngredientsAreWaterSafe, maskIgnoredIngredients, mapProductCategory, and the MEAT_CATEGORIES/SEAFOOD_CATEGORIES/GAME_MEAT_CATEGORIES sets) were extracted verbatim into lib/scanHelpers.js — a pure relocation, verified via the full test suite passing unchanged. scan.js now imports from there instead of defining them locally; this script's own former hand-mirrored copies (with "will drift" comments, present through the Stage 4 run) are gone — the corrected interpreter itself was also extracted into lib/verdictEngine.js's computeCorrectedVerdict(), which this script now genuinely requires. No more duplicated logic anywhere.

### correction4Scope
The conventional_eggs-over-conventional_meat priority correction (#4) is scoped narrowly to the same ordering the original discrepancy report described — conventional_eggs checked before the generic isConventionalMeat branch (live Node 8 vs Node 8b) — at both levels. It is NOT extended to the farmed-seafood (Node 5b) or gelatin (Node 8c) conventional_meat injection sites, which were never part of the reported ordering issue.

### correction2GatedGreenRevision
Correction #2 (game-meat handling) is a GATED GREEN, mirroring the wild-caught Node 5 pattern exactly, instead of a full no-op removed from the priority chain. An earlier no-op design surfaced an undecided side effect — a CLEAN game-meat product (zero other flags) fell through to Node 14's default YELLOW instead of getting an automatic GREEN, a new L1/L2 asymmetry nobody had actually decided on (L1's equivalent no-op leaves a clean game-meat product GREEN via the engine's own default). Gated green resolves this: a clean game-meat product now correctly shows GREEN again, matching L1, while a game-meat product WITH a genuine pre-existing reject-severity flag still has that flag preserved rather than discarded (the gate condition is simply false, so the branch does not match and the chain falls through normally to whichever node matches the real concern).

### correction2CoverageGap
No current Golden Master case combines game-meat category with a separate reject-severity flag present at the same time — the only two game-meat cases in the input set (meat-game-l1/l2) use a single clean fixture ("venison, water, salt") with zero flags in either category. This means the gate's actual discriminating behavior — leaving a reject flag alone when one exists — is exercised by neither this comparison run nor lib/verdictRules.test.js's data-level assertions (which check the table documents the mechanism, not that it behaves correctly against a real case). Flagged as a candidate for a future Stage 1 supplement (e.g. a game-meat product with an added bioengineering disclosure and no organic/non-gmo label), not built as part of this stage.

## Unexpected diffs (full detail)
None.