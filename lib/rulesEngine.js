'use strict';

/**
 * rulesEngine.js — Beyond Labels ingredient analysis engine
 *
 * Exports a single function:
 *   analyzeIngredients(ingredientText, productLabels, userLevel) → VerdictResult
 *
 * Verdict levels:
 *   'red'        — one or more hard-reject triggers matched
 *   'yellow'     — no hard rejects, but soft caution flags present
 *   'green'      — no hard rejects, no soft flags; all risky ingredients
 *                  carry organic / non-gmo certification
 *   'unverified' — ingredient text unavailable or empty
 *
 * User levels:
 *   2 (default) — strict: seed oils, conventional crops, bioengineering,
 *                 and natural flavors are all hard rejects (red).
 *   1 (lenient) — beginner: those four categories downgrade to caution (yellow).
 *                 Trans fats and all other synthetic additives stay red at both levels.
 */

// ─── Trigger registries ──────────────────────────────────────────────────────
// Within each array, order doesn't matter — findMatches() sorts longest-first
// internally so longer phrases always win over their substrings at the same
// text position (e.g. "partially hydrogenated" beats "hydrogenated").

/**
 * Trans fats — always red at both user levels.
 * Subset of what was formerly SEED_OILS; separated so level logic can target
 * the remaining seed oils without also softening these.
 */
const TRANS_FATS = [
  'partially hydrogenated', // before 'hydrogenated'
  'hydrogenated',
  'margarine',
  'shortening',
];

/**
 * Category 1 — Seed oils (excluding trans fats above)
 * Level 2: hard reject. Level 1: caution (yellow).
 * No organic / Non-GMO clearance applies to any entry in this list.
 * NOTE: "soybean oil" is intentionally absent from CONVENTIONAL_CROPS to
 * prevent double-flagging; Cat 1 already catches it unconditionally.
 */
const SEED_OILS = [
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
];

/**
 * Category 2 — Conventional crop derivatives
 * Level 2: hard reject. Level 1: caution (yellow).
 * Each match is clearable by:
 *   (a) ingredient is preceded by the word "organic"
 *   (b) productLabels includes 'usda-organic'
 *   (c) productLabels includes 'non-gmo-project-verified'
 * "Natural", "no artificial ingredients", brand claims do NOT clear.
 * "soybean oil" excluded here; it lives in Cat 1.
 */
const CONVENTIONAL_CROPS = [
  // ── Corn & corn derivatives ───────────────────────────────────────────────
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
 * Level 2: hard reject. Level 1: caution (yellow).
 * Matched anywhere in the full ingredient text.
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
 * Natural flavors — Level 2: hard reject. Level 1: caution (yellow).
 * Separated from SYNTHETIC_ADDITIVES so the level system can target them
 * independently. Ordered longest-first for correct deduplication.
 */
const NATURAL_FLAVORS = [
  'natural and artificial flavors', // before 'natural and artificial flavor'
  'with other natural flavors',     // before 'natural flavors'
  'natural and artificial flavor',
  'natural flavors',                // before 'natural flavor'
  'natural flavor',
  'wonf',
];

/**
 * Category 4 — Synthetic additives
 * Always hard reject at both user levels — no level downgrade applies.
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
  // ── Artificial flavors & colors ───────────────────────────────────────────
  'artificial flavors',             // before 'artificial flavor'
  'artificial colour',
  'artificial color',
  'artificial flavor',
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

/** Soft-flag grains that indicate gluten protein is present. */
const GLUTEN_GRAINS = ['wheat', 'barley', 'rye', 'spelt', 'kamut'];

/**
 * Flat list of every trigger string across all categories.
 * Used by the unverified-ingredient detector to check whether a parsed
 * ingredient token is "known" to the engine (flagged or not).
 */
const ALL_TRIGGERS = [
  ...TRANS_FATS,
  ...SEED_OILS,
  ...CONVENTIONAL_CROPS,
  ...BIOENGINEERING_TERMS,
  ...NATURAL_FLAVORS,
  ...SYNTHETIC_ADDITIVES,
  ...GLUTEN_GRAINS,
];

/**
 * Categories that downgrade from 'reject' → 'caution' for Level 1 users.
 * Trans fats and SYNTHETIC_ADDITIVES are intentionally excluded — they stay
 * red at both levels.
 */
const LEVEL_1_YELLOW_CATEGORIES = new Set([
  'seed_oils',
  'conventional_crops',
  'bioengineering',
  'natural_flavors',
]);

/**
 * All triggers belonging to Level-1-yellow categories, as a Set for O(1)
 * membership testing. Built from the actual category arrays so new triggers
 * added to any of those arrays are automatically included here without any
 * change to filterUnrecognizedTokens.
 */
const LEVEL_1_YELLOW_TRIGGERS = new Set([
  ...SEED_OILS,
  ...CONVENTIONAL_CROPS,
  ...BIOENGINEERING_TERMS,
  ...NATURAL_FLAVORS,
]);

/**
 * Whole-food tokens suppressed from unverifiedIngredients at Level 1.
 * Intentionally minimal — only genuinely unambiguous single-ingredient words.
 * Vinegar, oil, spice/spices, yeast, starch, and juice are excluded.
 */
const WHOLE_FOOD_TOKENS_L1 = new Set([
  'water', 'salt', 'honey', 'eggs', 'egg', 'milk', 'cream', 'butter', 'flour', 'sugar',
]);

/**
 * Whole-food tokens suppressed from unverifiedIngredients at Level 2.
 * Narrower than Level 1 — only truly unambiguous multi-word tokens and water.
 * Plain "salt" intentionally excluded; only qualified salt varieties are listed.
 */
const WHOLE_FOOD_TOKENS_L2 = new Set([
  'water',
  'sea salt',
  'himalayan salt',
  'himalayan pink salt',
  'celtic sea salt',
  'baking soda',
  'sodium bicarbonate',
]);

/**
 * Structural label phrases that parsing produces as tokens but that are not
 * ingredient names. Filtered at both user levels.
 */
const ARTIFACT_PHRASES = new Set([
  'contains', 'less than', 'made with', 'prepared with',
  'and/or', 'or less', 'or fewer',
]);

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Parse a raw ingredient list string into discrete ingredient tokens.
 *
 * Strategy:
 *   1. Replace parentheses with commas so sub-ingredient lists (e.g.
 *      "cheese (milk, salt)") are flattened into the main list.
 *   2. Treat colons as separators ("contains 2% or less of: X, Y").
 *   3. Split on commas and semicolons.
 *   4. Strip leading percentages ("2% salt" → "salt") and trailing punctuation.
 *   5. Discard tokens that are empty, purely numeric, or a single character.
 *
 * The returned tokens preserve original casing so they can be stored
 * readably in the database.
 *
 * @param {string} ingredientText - Raw ingredient list as printed on label.
 * @returns {string[]} Deduplicated, cleaned ingredient token array.
 */
function parseIngredientTokens(ingredientText) {
  const tokens = ingredientText
    .replace(/[()]/g, ',')          // flatten parenthetical sub-lists
    .replace(/:/g, ',')             // treat colons as separators
    .split(/[,;]/)
    .map(s => s
      .trim()
      .replace(/^\d+(\.\d+)?%?\s+/, '') // strip leading "2% " / "0.5% "
      .replace(/[.*[\]]+$/g, '')         // strip trailing . * [ ]
      .trim()
    )
    .filter(s => s.length > 1 && !/^\d+(\.\d+)?%?$/.test(s));

  // Deduplicate preserving first-occurrence order (case-insensitive key).
  const seen = new Set();
  return tokens.filter(t => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Finds all non-overlapping occurrences of `triggers` inside `text`.
 * Longer triggers are tried first so a phrase like "partially hydrogenated"
 * consumes that span before the shorter "hydrogenated" can claim it.
 *
 * @param {string}   text          - Lowercased ingredient string.
 * @param {string[]} triggers      - List of lowercased trigger phrases.
 * @param {{ start: number, end: number }[]} [blockedRanges=[]]
 *   Ranges already consumed by prior category passes. Matches that overlap
 *   these ranges are skipped, enabling cross-category deduplication.
 * @returns {{ trigger: string, index: number, end: number }[]} Sorted by position.
 */
function findMatches(text, triggers, blockedRanges = []) {
  const sorted = [...triggers].sort((a, b) => b.length - a.length);

  /** @type {{ start: number, end: number }[]} */
  const usedRanges = [...blockedRanges];
  /** @type {{ trigger: string, index: number, end: number }[]} */
  const results = [];

  for (const trigger of sorted) {
    let searchFrom = 0;
    let idx;

    while ((idx = text.indexOf(trigger, searchFrom)) !== -1) {
      const end = idx + trigger.length;

      const overlaps = usedRanges.some(r => idx < r.end && end > r.start);
      if (!overlaps) {
        results.push({ trigger, index: idx, end });
        usedRanges.push({ start: idx, end });
      }

      searchFrom = idx + 1;
    }
  }

  return results.sort((a, b) => a.index - b.index);
}

/**
 * Returns true if the word "organic" (as a standalone word, not a suffix
 * such as "inorganic") appears immediately before the ingredient at `index`.
 *
 * @param {string} text  - Full lowercased ingredient string.
 * @param {number} index - Start position of the matched ingredient.
 */
function isPrecededByOrganic(text, index) {
  const before = text.slice(Math.max(0, index - 40), index);
  return /(?:^|[\s,(])organic[\s,]*$/.test(before);
}

/**
 * Returns the severity for a flag given the category and user level.
 * Categories in LEVEL_1_YELLOW_CATEGORIES are downgraded to 'caution' for
 * Level 1 users; everything else is always 'reject'.
 *
 * @param {string} category
 * @param {1 | 2}  userLevel
 * @returns {'reject' | 'caution'}
 */
function severityFor(category, userLevel) {
  return userLevel === 1 && LEVEL_1_YELLOW_CATEGORIES.has(category)
    ? 'caution'
    : 'reject';
}

/**
 * Remove tokens from the unverified list that are known-clean, artifacts,
 * or already accounted for by the level system.
 *
 * Call this after the ALL_TRIGGERS filter has already removed tokens that
 * contain any known trigger string. The two steps are complementary:
 *   1. ALL_TRIGGERS filter → remove "known bad" tokens (already flagged or flaggable)
 *   2. filterUnrecognizedTokens → remove "known good / known irrelevant" tokens
 *
 * @param {string[]} tokens       - Tokens surviving the ALL_TRIGGERS filter.
 * @param {1|2}      userLevel    - User's strictness level.
 * @param {Array}    [flaggedRanges=[]] - Reserved for future use.
 * @returns {string[]} Tokens that genuinely warrant team review.
 */
function filterUnrecognizedTokens(tokens, userLevel, flaggedRanges = []) {
  return tokens.filter(token => {
    const t = token.toLowerCase().trim();

    // ── Rules common to both levels ───────────────────────────────────────

    // Organic-prefixed tokens are clean by definition — never surface them.
    if (t.startsWith('organic')) return false;

    // Parsing artifacts: too short to be meaningful.
    if (t.length < 3) return false;

    // Parsing artifacts: purely numeric (e.g. "2", "0.5", "2%").
    if (/^\d+(\.\d+)?%?$/.test(t)) return false;

    // Parsing artifacts: no letters — only symbols, digits, punctuation.
    if (!/[a-z]/.test(t)) return false;

    // Parsing artifacts: structural label phrases that aren't ingredient names.
    if (ARTIFACT_PHRASES.has(t)) return false;

    // ── Level-specific rules ──────────────────────────────────────────────

    if (userLevel === 1) {
      // Level 1: filter common unambiguous whole-food words.
      if (WHOLE_FOOD_TOKENS_L1.has(t)) return false;

      // Level 1: tokens that contain a Level-1-yellow category trigger are
      // already known to the engine (flagged as caution or cleared by organic /
      // Non-GMO). Don't surface them as unrecognized. Built from the actual
      // category arrays so adding a new trigger automatically extends coverage.
      for (const trigger of LEVEL_1_YELLOW_TRIGGERS) {
        if (t.includes(trigger)) return false;
      }
    } else {
      // Level 2: narrow list — only the most unambiguously clean tokens.
      if (WHOLE_FOOD_TOKENS_L2.has(t)) return false;
    }

    return true; // Surface to team for review.
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analyse an ingredient list string and return a structured verdict.
 *
 * @param {string|null|undefined} ingredientText
 *   Full ingredient list as printed on the product label.
 *
 * @param {string[]} [productLabels=[]]
 *   Certification seals on the product. Recognised values:
 *     'usda-organic'            — clears all Category 2 conventional-crop flags.
 *     'non-gmo-project-verified'— clears all Category 2 conventional-crop flags.
 *
 * @param {1 | 2} [userLevel=2]
 *   User experience level. Level 1 downgrades seed oils, conventional crops,
 *   bioengineering disclosures, and natural flavors from red → yellow.
 *   Level 2 (default) treats all categories as hard rejects.
 *
 * @returns {{
 *   verdict:   'red' | 'yellow' | 'green' | 'unverified',
 *   flags:     Array<{
 *                category:          string,
 *                severity:          'reject' | 'caution',
 *                matchedIngredient: string,
 *                summary:           string
 *              }>,
 *   clearedBy: string | null
 * }}
 */
function analyzeIngredients(ingredientText, productLabels, userLevel = 2) {
  // ── Guard: missing or empty ingredient text ─────────────────────────────
  if (ingredientText == null || String(ingredientText).trim() === '') {
    return { verdict: 'unverified', flags: [], clearedBy: null, unverifiedIngredients: [] };
  }

  const text = String(ingredientText).toLowerCase();

  const labels = (Array.isArray(productLabels) ? productLabels : [])
    .map(l => String(l).toLowerCase());

  const hasUsdaOrganic = labels.includes('usda-organic');
  const hasNonGmo      = labels.includes('non-gmo-project-verified');

  /** @type {ReturnType<analyzeIngredients>['flags']} */
  const flags = [];

  // Shared range tracker — ensures a text span claimed by one category pass
  // cannot be re-matched by a later pass (cross-category deduplication).
  /** @type {{ start: number, end: number }[]} */
  const claimedRanges = [];

  /**
   * Wraps findMatches with the shared claimedRanges and updates it on return.
   * @param {string[]} triggers
   * @returns {{ trigger: string, index: number, end: number }[]}
   */
  function matchAndClaim(triggers) {
    const results = findMatches(text, triggers, claimedRanges);
    for (const { index, end } of results) claimedRanges.push({ start: index, end });
    return results;
  }

  // ── Trans fats — always red at both levels ──────────────────────────────
  for (const { trigger } of matchAndClaim(TRANS_FATS)) {
    flags.push({
      category: 'trans_fats',
      severity: 'reject',
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a trans fat or hydrogenated oil directly linked ` +
        `to cardiovascular disease and systemic inflammation.`,
    });
  }

  // ── Category 1: Seed oils ───────────────────────────────────────────────
  for (const { trigger } of matchAndClaim(SEED_OILS)) {
    flags.push({
      category: 'seed_oils',
      severity: severityFor('seed_oils', userLevel),
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a refined seed oil that disrupts omega-6/omega-3 ` +
        `balance and is associated with systemic inflammation.`,
    });
  }

  // ── Category 2: Conventional crop derivatives ───────────────────────────
  for (const { trigger, index } of matchAndClaim(CONVENTIONAL_CROPS)) {
    const clearedByPrefix = isPrecededByOrganic(text, index);
    if (hasUsdaOrganic || hasNonGmo || clearedByPrefix) continue;

    flags.push({
      category: 'conventional_crops',
      severity: severityFor('conventional_crops', userLevel),
      matchedIngredient: trigger,
      summary:
        `Contains conventional "${trigger}" — likely sourced from GE crops ` +
        `or grown with heavy synthetic pesticide and herbicide use.`,
    });
  }

  // ── Standalone corn grain ────────────────────────────────────────────────
  const STANDALONE_CORN_RE = /(?:^|,)\s*(organic\s+)?corn(?!\s+[a-z])/;
  const cornMatch = STANDALONE_CORN_RE.exec(text);
  if (cornMatch) {
    const clearedByOrganic = Boolean(cornMatch[1]) || hasUsdaOrganic || hasNonGmo;
    if (!clearedByOrganic) {
      flags.push({
        category: 'conventional_crops',
        severity: severityFor('conventional_crops', userLevel),
        matchedIngredient: 'corn',
        summary:
          'Contains conventional "corn" — in the US, over 90% of field corn is grown ' +
          'from GE seed and treated with synthetic herbicides such as glyphosate.',
      });
    }
  }

  // ── Category 3: Bioengineering / gene-modification disclosure ──────────
  const bioMatches = matchAndClaim(BIOENGINEERING_TERMS);
  if (bioMatches.length > 0) {
    const { trigger } = bioMatches[0];
    flags.push({
      category: 'bioengineering',
      severity: severityFor('bioengineering', userLevel),
      matchedIngredient: trigger,
      summary:
        `Product discloses gene modification: "${trigger}". ` +
        `Covers both legacy GMO/rDNA transgenics and CRISPR-edited varieties ` +
        `that may fall outside mandatory labeling requirements.`,
    });
  }

  // ── Natural flavors — L2: red, L1: yellow ──────────────────────────────
  for (const { trigger } of matchAndClaim(NATURAL_FLAVORS)) {
    flags.push({
      category: 'natural_flavors',
      severity: severityFor('natural_flavors', userLevel),
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a catch-all term that can mask hundreds of ` +
        `undisclosed chemical compounds derived from natural sources.`,
    });
  }

  // ── Category 4: Synthetic additives — always red at both levels ─────────
  for (const { trigger } of matchAndClaim(SYNTHETIC_ADDITIVES)) {
    flags.push({
      category: 'additives',
      severity: 'reject',
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a synthetic additive with documented links ` +
        `to adverse health effects, including behavioral changes and organ stress.`,
    });
  }

  // ── Soft flags ──────────────────────────────────────────────────────────
  const glutenGrain = GLUTEN_GRAINS.find(g => text.includes(g));
  if (glutenGrain) {
    flags.push({
      category: 'gluten',
      severity: 'caution',
      matchedIngredient: glutenGrain,
      summary:
        `Contains "${glutenGrain}" — gluten protein is present. ` +
        `Not safe for individuals with celiac disease or non-celiac gluten sensitivity.`,
    });
  }

  // ── Verdict ─────────────────────────────────────────────────────────────
  const hasReject = flags.some(f => f.severity === 'reject');
  const hasCaution = flags.some(f => f.severity === 'caution');

  let verdict;
  if (hasReject)       verdict = 'red';
  else if (hasCaution) verdict = 'yellow';
  else                 verdict = 'green';

  const clearedBy =
    hasUsdaOrganic ? 'organic'                  :
    hasNonGmo      ? 'non-gmo-project-verified' :
    null;

  // ── Unverified ingredients ───────────────────────────────────────────────
  // Two-pass approach:
  //   Pass 1 — remove tokens that contain any known trigger (ALL_TRIGGERS).
  //            These are already "known" to the engine, flagged or cleared.
  //   Pass 2 — filterUnrecognizedTokens() removes clean whole-food tokens,
  //            parsing artifacts, and level-appropriate known-good tokens.
  // Result is sent to the database for team review; never affects the verdict.
  const rawUnknownTokens = parseIngredientTokens(String(ingredientText))
    .filter(token => !ALL_TRIGGERS.some(trigger => token.toLowerCase().includes(trigger)));

  const unverifiedIngredients = filterUnrecognizedTokens(rawUnknownTokens, userLevel, claimedRanges);

  return { verdict, flags, clearedBy, unverifiedIngredients };
}

module.exports = { analyzeIngredients };
