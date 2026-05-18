'use strict';

/**
 * rulesEngine.js — Beyond Labels ingredient analysis engine
 *
 * Exports a single function:
 *   analyzeIngredients(ingredientText, productLabels) → VerdictResult
 *
 * Verdict levels:
 *   'red'        — one or more hard-reject triggers matched
 *   'yellow'     — no hard rejects, but soft caution flags present
 *   'green'      — no hard rejects, no soft flags; all risky ingredients
 *                  carry organic / non-gmo certification
 *   'unverified' — ingredient text unavailable or empty
 */

// ─── Trigger registries ──────────────────────────────────────────────────────
// Within each array, order doesn't matter — findMatches() sorts longest-first
// internally so longer phrases always win over their substrings at the same
// text position (e.g. "partially hydrogenated" beats "hydrogenated").

/**
 * Category 1 — Seed oils
 * Hard reject. No organic / Non-GMO clearance applies.
 * NOTE: "soybean oil" is intentionally absent from CONVENTIONAL_CROPS to
 * prevent double-flagging; Cat 1 already catches it unconditionally.
 */
const SEED_OILS = [
  'partially hydrogenated', // must come before 'hydrogenated' (length sort handles it)
  'hydrogenated',
  // ── High-oleic variants (longer phrases must shadow their base oil) ────────
  'high oleic sunflower oil', // before 'sunflower oil'
  'high oleic canola oil',    // before 'canola oil'
  'high oleic safflower oil', // before 'safflower oil'
  // ── Palm derivatives ──────────────────────────────────────────────────────
  'fractionated palm oil',    // before 'palm oil', 'fractionated palm'
  'fractionated palm',        // catches "fractionated palm" without "oil"
  'palm kernel oil',          // before 'palm oil'
  'palm olein',
  // ── Conventional seed/vegetable oils ─────────────────────────────────────
  'canola oil',
  'soybean oil',
  'corn oil',
  'sunflower oil',
  'safflower oil',
  'cottonseed oil',
  'grapeseed oil',
  'rice bran oil',
  'vegetable oil',
  'palm oil',
  'rapeseed oil',
  'peanut oil',
  'margarine',
  'shortening',
];

/**
 * Category 2 — Conventional crop derivatives
 * Hard reject UNLESS cleared by:
 *   (a) ingredient is preceded by the word "organic"
 *   (b) productLabels includes 'usda-organic'
 *   (c) productLabels includes 'non-gmo-project-verified'
 * "Natural", "no artificial ingredients", brand claims do NOT clear.
 * "soybean oil" excluded here; it lives in Cat 1.
 */
const CONVENTIONAL_CROPS = [
  // ── Corn & corn derivatives ───────────────────────────────────────────────
  // Longer phrases first (findMatches sorts internally; comments clarify intent)
  'high fructose corn syrup',   // before 'corn syrup', 'high fructose'
  'corn starch modified',       // before 'corn starch'
  'glucose-fructose syrup',     // before 'glucose syrup', 'glucose'
  'textured vegetable protein', // before 'tvp'
  'modified food starch',       // before 'modified starch'
  'beet sugar',                 // before 'sugar'
  'corn syrup solids',          // before 'corn syrup'
  'corn starch',
  'corn flour',
  'corn syrup',
  'corn grits',
  'corn sugar',
  'corn bran',
  'corn oil',    // also Cat 1 SEED_OILS (unconditional); here organic/Non-GMO can clear it
  'maize starch', // before 'maize'
  'maize flour',  // before 'maize'
  'maize syrup',  // before 'maize'
  'glucose syrup', // before 'glucose'
  'whole corn',
  'corn meal',
  'cornmeal',
  'popcorn',
  'popped corn',
  'hominy',
  'maize',
  'high fructose',      // standalone; HFCS shadows this at the same position
  'crystalline fructose',
  'invert sugar',       // before 'sugar'
  'glucose',
  'fructose',
  'sorbitol',
  'erythritol',
  'xylitol',
  'mannitol',
  // ── Wheat & wheat derivatives ─────────────────────────────────────────────
  'wheat flour',
  'wheat starch',
  'wheat gluten',
  'durum wheat',   // before 'wheat' in findMatches length sort
  'wheat bran',
  'wheat germ',
  'semolina',
  'enriched flour',
  'bleached flour',
  'unbleached flour',
  'all purpose flour',
  'bread flour',
  'spelt',
  // ── Soy & soy derivatives ─────────────────────────────────────────────────
  'soy lecithin',
  'soy protein',
  'soy concentrate', // before 'soy extract', 'soy sauce'
  'soy isolate',
  'textured soy',
  'soy extract',
  'soy sauce',
  // ── Rapeseed (crop) ───────────────────────────────────────────────────────
  // 'rapeseed oil' lives in SEED_OILS (Cat 1, no clearance).
  // Plain 'rapeseed' (the crop) is clearable here via organic/Non-GMO.
  'rapeseed',
  // ── Oats & oat derivatives ────────────────────────────────────────────────
  'rolled oats',
  'oat flour',
  'oat fiber',
  'oat starch',
  'oat extract',
  'oat syrup',
  'oat bran',
  // ── Other crop derivatives ────────────────────────────────────────────────
  'maltodextrin',
  'modified starch',
  'xanthan gum',
  'citric acid',
  'dextrose',
  'sucrose',
  'sugar',
  'tvp',
];

/**
 * Category 3 — Bioengineering / gene-modification disclosure
 * Hard reject. Matched anywhere in the full ingredient text.
 * Only the first (longest) match is reported to avoid duplicate flags.
 */
const BIOENGINEERING_TERMS = [
  'contains a bioengineered food ingredient', // before 'bioengineered'
  'genetically engineered',
  'genetically modified',
  'bioengineered',
  'gmo',
];

/**
 * Category 4 — Synthetic additives
 * Hard reject. Substring match, case-insensitive.
 */
const SYNTHETIC_ADDITIVES = [
  'caramel color',
  'sodium benzoate',
  'potassium bromate',
  'sodium nitrate',
  'sodium nitrite',
  'monosodium glutamate',
  'disodium inosinate',
  'disodium guanylate',
  // ── Flavors & colors — ALL are hard rejects ───────────────────────────────
  // Ordered longest-first so findMatches() deduplicates correctly when phrases
  // overlap (e.g. "natural and artificial flavors" wins over "artificial flavors").
  'natural and artificial flavors', // before 'natural and artificial flavor'
  'with other natural flavors',     // before 'natural flavors'
  'natural and artificial flavor',
  'natural flavors',                // before 'natural flavor'
  'artificial flavors',             // before 'artificial flavor'
  'artificial colour',
  'artificial color',
  'natural flavor',
  'artificial flavor',
  'wonf',
  // ── Artificial sweeteners ─────────────────────────────────────────────────
  'acesulfame potassium',  // before 'acesulfame-k'
  'steviol glycoside',     // before 'stevia extract', 'rebaudioside', 'reb-a'
  'stevia extract',        // before 'rebaudioside'
  'sucralose',
  'aspartame',
  'acesulfame-k',          // before 'ace-k'
  'ace-k',
  'saccharin',
  'neotame',
  'advantame',
  'rebaudioside',
  'reb-a',
  // ── Processing / functional additives ────────────────────────────────────
  'interesterified oil',   // before 'interesterified fat'
  'interesterified fat',
  'fractionated palm oil', // also in SEED_OILS; here for additives category label
  'palm kernel oil',       // also in SEED_OILS
  'palm olein',            // also in SEED_OILS
  'carrageenan',
  'titanium dioxide',
  'propyl gallate',
  'propylene glycol',
  // ── Dyes ─────────────────────────────────────────────────────────────────
  'msg',
  'yellow 5',
  'yellow 6',
  'red 40',
  'blue 1',
  'blue 2',
  'green 3',
  'tbhq',
  'bha',
  'bht',
];

/** Soft-flag grains that indicate gluten / prolamin protein is present. */
const GLUTEN_GRAINS = [
  // ── Wheat & wheat derivatives (longer phrases first) ──────────────────────
  'hydrolyzed wheat protein', // before 'wheat protein', 'wheat'
  'modified wheat starch',    // before 'wheat starch', 'wheat'
  'wheat flour',
  'wheat starch',
  'wheat protein',
  'wheat germ',
  'wheat bran',
  'wheat',
  'semolina',
  'bulgur',
  'farro',
  'freekeh',
  'einkorn',
  'emmer',
  'triticale',
  'spelt flour',              // before 'spelt'
  'spelt',
  'kamut flour',              // before 'kamut'
  'kamut',
  'durum',
  // ── Barley & barley derivatives ────────────────────────────────────────────
  'barley malt',              // before 'barley', 'malt'
  'malt extract',             // before 'malt'
  'malt vinegar',             // before 'malt'
  'barley',
  'malt',
  // ── Rye ───────────────────────────────────────────────────────────────────
  'rye',
  // ── Rice & rice derivatives ───────────────────────────────────────────────
  'brown rice',               // before 'rice'
  'white rice',               // before 'rice'
  'rice flour',               // before 'rice'
  'rice starch',              // before 'rice'
  'rice bran',                // before 'rice'
  'rice protein',             // before 'rice'
  'rice',
  // ── Corn & corn derivatives ───────────────────────────────────────────────
  'modified corn starch',     // before 'corn starch', 'corn'
  'corn syrup solids',        // before 'corn'
  'corn flour',               // before 'corn'
  'corn starch',              // before 'corn'
  'cornmeal',
  'hominy',
  'grits',
  'maize',
  'masa',
  'corn',
  // ── Oats & oat derivatives ────────────────────────────────────────────────
  'rolled oats',              // before 'oats'
  'oat flour',                // before 'oats'
  'oat bran',                 // before 'oats'
  'oatmeal',
  'oats',
  // ── Other grains ─────────────────────────────────────────────────────────
  'millet flour',             // before 'millet'
  'millet',
  'sorghum flour',            // before 'sorghum'
  'sorghum',
  'quinoa flour',             // before 'quinoa'
  'quinoa',
  'amaranth flour',           // before 'amaranth'
  'amaranth',
  'buckwheat flour',          // before 'buckwheat'
  'buckwheat',
  'teff flour',               // before 'teff'
  'teff',
];

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Finds all non-overlapping occurrences of `triggers` inside `text`.
 * Longer triggers are tried first so a phrase like "partially hydrogenated"
 * consumes that span before the shorter "hydrogenated" can claim it.
 *
 * @param {string}   text     - Lowercased ingredient string.
 * @param {string[]} triggers - List of lowercased trigger phrases.
 * @returns {{ trigger: string, index: number }[]} Sorted by position.
 */
function findMatches(text, triggers) {
  // Sort longest-first so longer phrases shadow their own substrings.
  const sorted = [...triggers].sort((a, b) => b.length - a.length);

  /** @type {{ start: number, end: number }[]} */
  const usedRanges = [];
  /** @type {{ trigger: string, index: number }[]} */
  const results = [];

  for (const trigger of sorted) {
    let searchFrom = 0;
    let idx;

    while ((idx = text.indexOf(trigger, searchFrom)) !== -1) {
      const end = idx + trigger.length;

      // Skip if this range overlaps any already-claimed range.
      const overlaps = usedRanges.some(r => idx < r.end && end > r.start);
      if (!overlaps) {
        results.push({ trigger, index: idx });
        usedRanges.push({ start: idx, end });
      }

      // Advance past this position regardless of overlap.
      searchFrom = idx + 1;
    }
  }

  return results.sort((a, b) => a.index - b.index);
}

/**
 * Returns true if the word "organic" (as a standalone word, not a suffix
 * such as "inorganic") appears immediately before the ingredient at `index`.
 *
 * Allowed separators between "organic" and the ingredient: spaces and commas.
 * "Non-organic", "inorganic", "unorganic" are explicitly excluded.
 *
 * @param {string} text  - Full lowercased ingredient string.
 * @param {number} index - Start position of the matched ingredient.
 */
function isPrecededByOrganic(text, index) {
  // Take up to 40 chars before the ingredient to capture the preceding word.
  const before = text.slice(Math.max(0, index - 40), index);

  // Pattern: "organic" must be preceded by start-of-slice, whitespace,
  // or punctuation — NOT by a letter or hyphen (which would make it a suffix).
  // Followed by optional whitespace/commas before the ingredient name.
  return /(?:^|[\s,(])organic[\s,]*$/.test(before);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analyse an ingredient list string and return a structured verdict.
 *
 * @param {string|null|undefined} ingredientText
 *   Full ingredient list as printed on the product label.
 *   Pass null / undefined / empty string to receive an 'unverified' verdict.
 *
 * @param {string[]} [productLabels=[]]
 *   Certification seals on the product. Recognised values:
 *     'usda-organic'            — clears all Category 2 conventional-crop flags.
 *     'non-gmo-project-verified'— clears all Category 2 conventional-crop flags.
 *   Any other strings are accepted but have no effect on flag clearance.
 *
 * @returns {{
 *   verdict:   'red' | 'yellow' | 'green' | 'unverified',
 *   flags:     Array<{
 *                category:         string,
 *                severity:         'reject' | 'caution',
 *                matchedIngredient: string,
 *                summary:          string
 *              }>,
 *   clearedBy: string | null
 * }}
 */
function analyzeIngredients(ingredientText, productLabels) {
  // ── Guard: missing or empty ingredient text ─────────────────────────────
  if (ingredientText == null || String(ingredientText).trim() === '') {
    return { verdict: 'unverified', flags: [], clearedBy: null };
  }

  const text = String(ingredientText).toLowerCase();

  // Normalise label array; treat any non-array value as no labels.
  const labels = (Array.isArray(productLabels) ? productLabels : [])
    .map(l => String(l).toLowerCase());

  const hasUsdaOrganic = labels.includes('usda-organic');
  const hasNonGmo      = labels.includes('non-gmo-project-verified');

  /** @type {ReturnType<analyzeIngredients>['flags']} */
  const hardFlags = []; // severity: 'reject' — contribute to RED verdict
  /** @type {ReturnType<analyzeIngredients>['flags']} */
  const softFlags = []; // severity: 'caution' — contribute to YELLOW verdict

  // ── Category 1: Seed oils ───────────────────────────────────────────────
  // No organic clearance — seed oils are always a hard reject.
  for (const { trigger } of findMatches(text, SEED_OILS)) {
    hardFlags.push({
      category: 'seed_oils',
      severity: 'reject',
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a refined seed oil that disrupts omega-6/omega-3 ` +
        `balance and is associated with systemic inflammation.`,
    });
  }

  // ── Category 2: Conventional crop derivatives ───────────────────────────
  // Each match is individually checked for organic/non-gmo clearance.
  for (const { trigger, index } of findMatches(text, CONVENTIONAL_CROPS)) {
    const clearedByPrefix = isPrecededByOrganic(text, index);

    // Skip (clear the flag) when any valid certification applies.
    if (hasUsdaOrganic || hasNonGmo || clearedByPrefix) continue;

    hardFlags.push({
      category: 'conventional_crops',
      severity: 'reject',
      matchedIngredient: trigger,
      summary:
        `Contains conventional "${trigger}" — likely sourced from GE crops ` +
        `or grown with heavy synthetic pesticide and herbicide use.`,
    });
  }

  // ── Standalone corn grain ────────────────────────────────────────────────
  // Catches plain "corn" listed as a distinct ingredient (e.g. the first
  // ingredient in corn chips). Uses an anchor so it only matches when "corn"
  // immediately follows start-of-string or a comma (with optional whitespace /
  // organic prefix) — this prevents false matches inside "corn oil" (handled
  // by Cat 1), "(made from corn)" parentheticals, etc. The negative lookahead
  // also guards against compound forms like "corn flour" or "corn starch" whose
  // own longer triggers are already in CONVENTIONAL_CROPS above.
  const STANDALONE_CORN_RE = /(?:^|,)\s*(organic\s+)?corn(?!\s+[a-z])/;
  const cornMatch = STANDALONE_CORN_RE.exec(text);
  if (cornMatch) {
    const clearedByOrganic = Boolean(cornMatch[1]) || hasUsdaOrganic || hasNonGmo;
    if (!clearedByOrganic) {
      hardFlags.push({
        category: 'conventional_crops',
        severity: 'reject',
        matchedIngredient: 'corn',
        summary:
          'Contains conventional "corn" — in the US, over 90% of field corn is grown ' +
          'from GE seed and treated with synthetic herbicides such as glyphosate.',
      });
    }
  }

  // ── Category 3: Bioengineering / gene-modification disclosure ──────────
  // Flag once — longest / earliest match only, to avoid duplicate entries
  // when e.g. "bioengineered" appears inside "contains a bioengineered food ingredient".
  const bioMatches = findMatches(text, BIOENGINEERING_TERMS);
  if (bioMatches.length > 0) {
    const { trigger } = bioMatches[0];
    hardFlags.push({
      category: 'bioengineering',
      severity: 'reject',
      matchedIngredient: trigger,
      summary:
        `Product discloses gene modification: "${trigger}". ` +
        `Covers both legacy GMO/rDNA transgenics and CRISPR-edited varieties ` +
        `that may fall outside mandatory labeling requirements.`,
    });
  }

  // ── Category 4: Synthetic additives ────────────────────────────────────
  for (const { trigger } of findMatches(text, SYNTHETIC_ADDITIVES)) {
    hardFlags.push({
      category: 'additives',
      severity: 'reject',
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a synthetic additive with documented links ` +
        `to adverse health effects, including behavioral changes and organ stress.`,
    });
  }

  // ── Soft flags ──────────────────────────────────────────────────────────
  // These are evaluated regardless of hard flags, but only affect the verdict
  // when no hard rejects are present.

  // Gluten — flag the first detected gluten-bearing grain.
  const glutenGrain = GLUTEN_GRAINS.find(g => text.includes(g));
  if (glutenGrain) {
    softFlags.push({
      category: 'gluten',
      severity: 'caution',
      matchedIngredient: glutenGrain,
      summary:
        `Contains "${glutenGrain}" — gluten protein is present. ` +
        `Not safe for individuals with celiac disease or non-celiac gluten sensitivity.`,
    });
  }

  // NOTE: "natural flavor", "natural flavors", and all related phrases
  // (including "with other natural flavors", "wonf") are now hard rejects
  // in SYNTHETIC_ADDITIVES above. No separate soft flag is needed here.

  // ── Verdict ─────────────────────────────────────────────────────────────
  let verdict;
  if (hardFlags.length > 0)     verdict = 'red';
  else if (softFlags.length > 0) verdict = 'yellow';
  else                           verdict = 'green';

  // clearedBy reflects product-level certification only.
  // Per-ingredient "organic" prefix clearance is a matching detail; it does
  // not elevate clearedBy unless a product seal is present.
  const clearedBy =
    hasUsdaOrganic ? 'organic'                   :
    hasNonGmo      ? 'non-gmo-project-verified'  :
    null;

  return {
    verdict,
    flags: [...hardFlags, ...softFlags],
    clearedBy,
  };
}

module.exports = { analyzeIngredients };
