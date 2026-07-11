'use strict';

/**
 * scripts/goldenMaster/generateInputs.js
 *
 * Stage 1 of the L1/L2 unification project: generates a deliberately
 * comprehensive list of realistic scan inputs, covering every category the
 * rules engine can emit, every clearance path, every special verdict path
 * (pure-water, cert_unconfirmed, inconclusive, default-yellow), seafood/
 * game/meat variants, every specific bug fixed across the recent
 * bare-trigger-collision audit series, multi-flag interaction cases, and the
 * documented text-preprocessing edge cases (allergen stripping, purpose-note
 * parentheticals, "-free"/"non-" contexts, FD&C "No." normalization).
 *
 * Each case has the shape:
 *   { id, description, ingredientText, productLabels, categoriesTags, productName, userLevel }
 *
 * `productLabels` and `categoriesTags` use raw Open Food Facts tag strings
 * (e.g. 'en:usda-organic', 'en:salmon') — the same shape scan.js reads from
 * a real OFF product record, normalized internally by normalizeLabelTags()/
 * mapProductCategory()/isSeafoodProduct()/etc.
 *
 * Wherever possible, ingredient strings and product names are lifted
 * directly from existing fixtures in lib/rulesEngine.test.js and
 * __tests__/api/scan.test.js — already-known-good, realistic examples —
 * rather than invented from scratch.
 *
 * Run: node scripts/goldenMaster/generateInputs.js
 * Writes: scripts/goldenMaster/inputs.json
 */

const fs = require('fs');
const path = require('path');

const cases = [];

/** Push one test case for BOTH user levels (most common shape). */
function addBothLevels(id, description, ingredientText, productLabels = [], categoriesTags = [], productName = 'Test Product') {
  cases.push({ id: `${id}-l1`, description: `${description} (Level 1)`, ingredientText, productLabels, categoriesTags, productName, userLevel: 1 });
  cases.push({ id: `${id}-l2`, description: `${description} (Level 2)`, ingredientText, productLabels, categoriesTags, productName, userLevel: 2 });
}

/** Push one test case for a single specified level. */
function addOneLevel(id, description, ingredientText, productLabels, categoriesTags, productName, userLevel) {
  cases.push({ id, description, ingredientText, productLabels, categoriesTags, productName, userLevel });
}

// ════════════════════════════════════════════════════════════════════════════
// A. One realistic example per rules-engine category (both levels)
// ════════════════════════════════════════════════════════════════════════════
// Each isolated so exactly one category fires (no cross-contamination),
// mirroring the fixtures established across the bare-trigger-audit sessions.

addBothLevels('cat-trans-fats', 'trans_fats: partially hydrogenated oil',
  'Partially hydrogenated oil, salt, water.');

addBothLevels('cat-seed-oils', 'seed_oils: canola oil',
  'Canola oil, salt, water.');

addBothLevels('cat-conventional-crops', 'conventional_crops: citric acid (no clearance)',
  'Citric acid, salt, water.');

addBothLevels('cat-bioengineering', 'bioengineering: bioengineered disclosure',
  'Bioengineered ingredient, salt, water.');

addBothLevels('cat-natural-flavors', 'natural_flavors: bare natural flavors',
  'Natural flavors, salt, water.');

addBothLevels('cat-synthetic-additives', 'synthetic_additives ("additives"): Yellow 5 dye',
  'Yellow 5, salt, water.');

addBothLevels('cat-glyphosate-heavy', 'glyphosate_heavy: bare oats (no clearance)',
  'Oats, salt, water.');

addBothLevels('cat-gluten-grains', 'gluten_grains: quinoa (paywall feature, stripped from display at both levels)',
  'Quinoa, salt, water.');

addBothLevels('cat-conventional-meat', 'conventional_meat: beef with no organic cert',
  'Beef, water, salt', [], ['en:beef'], 'Beef Jerky');

addBothLevels('cat-conventional-dairy', 'conventional_dairy: whole milk + cheddar, no organic cert',
  'Whole milk, cheddar cheese, salt.');

addBothLevels('cat-conventional-eggs', 'conventional_eggs: bare egg whites, no organic cert',
  'Egg whites, salt, water.');

addBothLevels('cat-fortified-vitamins', 'fortified_vitamins: organic path + synthetic vitamin fortification (L2-only mechanism — see CLAUDE.md, L1 never runs the organic sub-tree)',
  'Organic milk, vitamin d3, niacin, salt.', ['en:usda-organic']);

addBothLevels('cat-natural-colorants', 'natural_colorants: organic path + plant-derived colorant (L2-only mechanism)',
  'Organic milk, beet juice concentrate, salt.', ['en:usda-organic']);

addBothLevels('cat-olive-oil-adulteration', 'olive_oil_adulteration: organic path + olive oil (L2-only mechanism)',
  'Organic olive oil, salt.', ['en:usda-organic']);

// ════════════════════════════════════════════════════════════════════════════
// B. Clearance paths, each applied to a relevant category, both levels
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('clear-usda-organic-label', 'usda-organic LABEL clears conventional_crops (corn starch)',
  'Corn starch, salt, water.', ['en:usda-organic']);

addBothLevels('clear-organic-prefix', 'organic INGREDIENT PREFIX clears conventional_crops (no label needed)',
  'Organic corn starch, salt, water.', []);

addBothLevels('clear-non-gmo-project-verified', 'non-gmo-project-verified label clears conventional_crops',
  'Corn starch, soy lecithin.', ['en:non-gmo-project-verified']);

addBothLevels('clear-glyphosate-free', 'glyphosate-free label downgrades glyphosate_heavy to caution',
  'Oats, salt, water.', ['en:glyphosate-free']);

// ════════════════════════════════════════════════════════════════════════════
// C. Seafood, game meat, and conventional meat — both levels
// ════════════════════════════════════════════════════════════════════════════
// Fixtures lifted directly from __tests__/api/scan.test.js Suite N/L/S.

addBothLevels('meat-wild-caught-seafood', 'wild-caught seafood (OFF category confirmed) → clean',
  'salmon, water, salt', [], ['en:salmon'], 'Wild Caught Alaskan Salmon');

addBothLevels('meat-farmed-seafood', 'farmed/unlabeled seafood ("farm-raised" name signal) → reject',
  'atlantic salmon, water, salt', [], ['en:salmon'], 'Farm-Raised Atlantic Salmon');

addBothLevels('meat-game', 'game meat (en:game-meats) → clean, wild-harvested by nature',
  'venison, water, salt', [], ['en:game-meats'], 'Venison Steak');

addBothLevels('meat-conventional', 'conventional meat (en:beef), no organic cert → reject',
  'beef, water, salt', [], ['en:beef'], 'Grass Fed Beef');

// ════════════════════════════════════════════════════════════════════════════
// D. Special verdict paths — both levels (several deliberately show L1/L2
//    asymmetry, since these mechanisms are largely L2-tree-specific;
//    capturing that asymmetry as ground truth is the point of this snapshot)
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('path-pure-water', 'pure-water GREEN path (WATER_SAFE_INGREDIENTS only)',
  'Spring water, calcium, magnesium, bicarbonates.', []);

addBothLevels('path-cert-unconfirmed', 'cert_unconfirmed: all non-trivial ingredients organic-prefixed, no cert tag',
  'Organic tomatoes, organic basil, sea salt.', []);

addBothLevels('path-inconclusive', 'inconclusive: all-unrecognized ingredients (ALL_UNKNOWN_OFF fixture)',
  'zymotrixal, biophenolate, hexamorphite, gluvaxitol, cryomethylane, phytorextrin, neovitriol', [], [], 'Mystery Product');

addBothLevels('path-default-yellow-node14', 'default-yellow (L2 Node 14): "Pistachios, salt" — no cert, no concern (CLAUDE.md\'s own canonical example)',
  'Pistachios, salt.', []);

// ════════════════════════════════════════════════════════════════════════════
// E. Every specific real bug fixed across the bare-trigger-collision audit
//    series — locked in as permanent regression coverage, both levels.
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('bug-macadamia', 'bare \'ada\' false positive: macadamia nuts (PROMPT_VERSION 33)',
  'Almonds, macadamia nuts, cashews, sea salt.');

addBothLevels('bug-product-of-canada', 'bare \'ada\' false positive: "Product of Canada" (PROMPT_VERSION 33)',
  'Chocolate, sugar, cocoa butter. Product of Canada.');

addBothLevels('bug-goat-milk', 'bare \'oats\'/\'oat milk\' false positive: goat milk (PROMPT_VERSION 34)',
  'Goat milk, salt.');

addBothLevels('bug-goats-milk-yogurt', 'bare \'oats\' false positive: goats\' milk yogurt (PROMPT_VERSION 34)',
  "Goats' milk yogurt, sea salt.");

addBothLevels('bug-licorice', 'bare \'rice\' false positive: licorice (PROMPT_VERSION 35)',
  'Licorice, sugar, salt.');

addBothLevels('bug-cowpeas', 'bare \'peas\' false negative: cowpeas one-word form (PROMPT_VERSION 38)',
  'Cowpeas, salt, water.');

addBothLevels('bug-broadbeans', 'bare \'beans\' false negative: broadbeans one-word form (PROMPT_VERSION 38)',
  'Broadbeans, salt, water.');

addBothLevels('bug-horsebeans', 'bare \'beans\' false negative: horsebeans one-word form (PROMPT_VERSION 38)',
  'Horsebeans, salt, water.');

addBothLevels('bug-acorn-squash', 'bare \'corn\' false positive: acorn squash (PROMPT_VERSION 37)',
  'Acorn squash, sea salt, water.');

addBothLevels('bug-oat-groats', 'bare \'oats\' false-negative-of-a-fix: oat groats must still flag (allowlisted, PROMPT_VERSION 35)',
  'Water, oat groats, salt.');

addBothLevels('bug-popcorn', 'bare \'corn\' legitimate compound: popcorn must still flag (allowlisted)',
  'Popcorn, sea salt, water.');

addBothLevels('bug-sweetcorn', 'bare \'corn\' false negative: sweetcorn must still flag (allowlisted, PROMPT_VERSION 37)',
  'Sweetcorn, salt, water.');

// ════════════════════════════════════════════════════════════════════════════
// F. Multi-flag products — interaction effects, not just isolated categories
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('multi-kraft', 'Kraft Mac & Cheese: 4 categories at once (seed_oils, conventional_crops, bioengineering, additives)',
  'ENRICHED MACARONI (WHEAT FLOUR, NIACIN, FERROUS SULFATE, THIAMIN MONONITRATE, ' +
  'RIBOFLAVIN, FOLIC ACID), CHEESE SAUCE MIX (WHEY, MILKFAT, MILK PROTEIN CONCENTRATE, ' +
  'SALT, SODIUM TRIPOLYPHOSPHATE, CONTAINS LESS THAN 2% OF CITRIC ACID, SODIUM PHOSPHATE, ' +
  'LACTIC ACID, CALCIUM PHOSPHATE, SOYBEAN OIL, YELLOW 5, YELLOW 6). ' +
  'CONTAINS BIOENGINEERED FOOD INGREDIENTS.',
  [], [], 'Kraft Macaroni & Cheese Dinner Original');

addBothLevels('multi-seed-oil-suppresses-dairy', 'interaction: seed_oils (INSTANT_RED) short-circuits before conventional_dairy would be injected — milk present but NOT flagged',
  'Whole milk, wheat flour, canola oil, salt.');

addBothLevels('multi-eggs-suppresses-dairy-and-crops-ordering', 'interaction: conventional_eggs (Node 8b) fires before conventional_dairy (Node 9) — milk present but NOT flagged; conventional_crops/glyphosate_heavy flags still retained in array',
  'Wheat flour, eggs, whole milk, sugar, salt.');

addBothLevels('multi-annies-organic-gluten', "Annie's Homegrown: USDA organic clears conventional_crops, gluten_grains still fires (paywall feature, stripped from display)",
  'ORGANIC WHEAT FLOUR, ORGANIC WHEY, ORGANIC CHEDDAR CHEESE ' +
  '(ORGANIC PASTEURIZED MILK, CULTURES, SALT, NON-ANIMAL ENZYMES), ' +
  'ORGANIC CORN STARCH, SEA SALT, ORGANIC ANNATTO EXTRACT.',
  ['en:usda-organic'], [], "Annie's Homegrown Shells & White Cheddar");

addBothLevels('multi-eggs-and-meat', 'interaction: conventional_meat (Node 8) fires before conventional_eggs check — both flags coexist in the array (chicken broth + eggs)',
  'chicken broth, egg noodles, eggs, chicken, salt', [], ['en:broths', 'en:soups'], 'Chicken Noodle Soup');

// ════════════════════════════════════════════════════════════════════════════
// G. Documented text-preprocessing edge cases
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('edge-allergen-advisory-stripping', 'allergen advisory stripping: "Contains: soy lecithin." disclaimer must not trip a false conventional_crops flag',
  'Sunflower seeds, dried cranberries, sea salt. Contains: soy lecithin.');

addOneLevel('edge-purpose-note-parenthetical', 'purpose-note parenthetical: "canola (for cooking) oil" still flags seed_oils across the gap',
  'canola (for cooking) oil, salt', [], [], 'Test Product', 2);

addOneLevel('edge-free-context-seed-oils', '"-free" context: "canola-free" must NOT flag seed_oils (INSTANT_RED_CATEGORIES member)',
  'Canola-free trail mix, sea salt.', [], [], 'Test Product', 2);

addOneLevel('edge-free-context-eggs-and-wheat', '"-free" context: "egg-free" facility disclaimer must not flag conventional_eggs, but wheat flour still flags glyphosate_heavy/gluten_grains',
  'Egg-free bakery facility. Wheat flour, sugar, salt.', [], [], 'Test Product', 2);

addBothLevels('edge-fdc-no-normalization', 'FD&C "No." normalization: "FD&C Red No. 40" matches the "red 40" dye trigger',
  'water, FD&C Red No. 40, salt');

// ════════════════════════════════════════════════════════════════════════════
// H. Additional real production reproductions from CLAUDE.md's changelog
//    (extra realistic breadth, pulled from documented investigations)
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('prod-tractor-wheels', 'TRACTOR WHEELS (barcode 810003512611): organic + oat flour/wheatgrass gluten_grains + unrecognized tokens, NOT inconclusive (>5 threshold with real flags present)',
  'OAT FLOUR, DATE*, COCONUT OIL*, AGAVE INULIN* (PREBIOTIC), APPLE, STRAWBERRY**, ' +
  'PUMPKIN SEED BUTTER*, STRAWBERRY PUREE, PUMPKIN, VANILLA EXTRACT, BEET**, ' +
  'BAKING SODA (SODIUM BICARBONATE), CINNAMON*, GREENS POWDER BLEND* (WHEATGRASS, KALE, CHLORELLA*, MORINGA*)',
  ['en:usda-organic'], [], 'TRACTOR WHEELS Organic Toddler Soft-Baked Bar Strawberry, Pumpkin & Beet');

addBothLevels('prod-smoothie-melts', 'Smoothie Melts Blueberry Burst (barcode 810003512802): organic path, fortified_vitamins via vitamin E, low unverified count after vocabulary fixes',
  'Cultured whole milk, blueberry purée, whole milk powder, cherry purée, Date, lemon juice, ' +
  'tapioca starch, vitamin E (mix tocopherols to protect flavor), Bifidobacterium lactics (probiotic). Organic.',
  ['en:usda-organic']);

addBothLevels('prod-pasta-ravioli-eggs', 'Fresh Pasta Ravioli: eggs, no cert, non-meat category → conventional_eggs, not conventional_meat',
  'semolina flour, eggs, water, salt', [], ['en:pasta', 'en:fresh-pasta'], 'Fresh Pasta Ravioli');

addBothLevels('prod-organic-egg-noodles', 'Organic Egg Noodles: "organic eggs" ingredient prefix clears conventional_eggs even with no cert tag',
  'organic wheat flour, organic eggs, water', [], ['en:pasta'], 'Organic Egg Noodles');

// ════════════════════════════════════════════════════════════════════════════
// I. Additional trigger-word variety within already-covered categories
//    (different real trigger words for the same category can interact
//    differently with other guards — genuine extra coverage, not padding)
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('variety-seed-oils-vegetable-oil', 'seed_oils variant: vegetable oil',
  'Vegetable oil, salt, water.');

addBothLevels('variety-conventional-crops-dextrose', 'conventional_crops variant: dextrose (no clearance)',
  'Dextrose, salt, water.');

addBothLevels('variety-glyphosate-heavy-wheat', 'glyphosate_heavy variant: wheat flour (also gluten_grains)',
  'Wheat flour, salt, water.');

addBothLevels('variety-synthetic-additives-sodium-benzoate', 'synthetic_additives variant: sodium benzoate preservative',
  'Sodium benzoate, salt, water.');

addBothLevels('variety-bioengineering-genetically-modified', 'bioengineering variant: full phrase "genetically modified"',
  'Genetically modified soy protein, salt, water.');

addBothLevels('variety-natural-flavors-wonf', 'natural_flavors variant: WONF abbreviation',
  'WONF, salt, water.');

// ════════════════════════════════════════════════════════════════════════════
// J. Additional clearance-mechanism combinations
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('clear-non-gmo-bioengineering', 'non-gmo-project-verified label downgrades bioengineering to caution',
  'Bioengineered ingredient, salt, water.', ['en:non-gmo-project-verified']);

addBothLevels('clear-glyphosate-free-wheat', 'glyphosate-free label downgrades a second GLYPHOSATE_HEAVY crop (wheat) to caution',
  'Wheat flour, salt, water.', ['en:glyphosate-free']);

addBothLevels('clear-organic-prefix-eggs', 'organic ingredient prefix clears conventional_eggs (no label needed)',
  'Organic eggs, salt, water.', []);

addBothLevels('clear-usda-organic-glyphosate-heavy', 'usda-organic label fully clears glyphosate_heavy (not just downgrade)',
  'Oats, salt, water.', ['en:usda-organic']);

// ════════════════════════════════════════════════════════════════════════════
// K. Additional wild-caught signal variants
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('meat-wild-name-signal-no-category', 'wild-caught NAME signal alone, no OFF seafood category → falls to default (safer failure mode, confirmed PROMPT_VERSION 29 fix)',
  'salmon, water, salt', [], [], 'Wild Caught Alaskan Salmon');

addBothLevels('meat-wild-ingredient-text-signal', 'wild-caught INGREDIENT-TEXT signal ("Wild" in ingredients) with confirmed OFF seafood category',
  'Wild pink salmon, water, salt', [], ['en:salmon'], 'Pink Salmon');

// ════════════════════════════════════════════════════════════════════════════
// L. More real production reproductions from CLAUDE.md's changelog
// ════════════════════════════════════════════════════════════════════════════

addBothLevels('prod-unsweetened-cereal', 'Unsweetened Cereal (barcode 860002152400): sole flag is glyphosate_heavy reject (chickpea + pea protein) — the Node 11b fix',
  'Chickpea, Tapioca, Pea Protein, Salt', [], [], 'Unsweetened Cereal');

addBothLevels('prod-banana-berry', 'Banana Berry (barcode 079900003251): frozen fruit with "wild blueberries" — must NOT get false wild-caught clearance (PROMPT_VERSION 29 fix); citric acid still flags conventional_crops',
  'BANANA SLICES (ASCORBIC AND CITRIC ACIDS ADDED TO PROTECT COLOR), STRAWBERRIES, WILD BLUEBERRIES.',
  [], [], 'Banana Berry');

addBothLevels('prod-guava-crackers', 'Guava Toasted Snack Crackers: "egg-free facility" disclaimer must not flag conventional_eggs (PROMPT_VERSION 30 fix)',
  'Rice flour, guava paste, sugar, salt. Manufactured in a facility that also processes tree nuts. This product is made in an EGG-FREE facility.',
  [], [], 'Guava Toasted Snack Crackers');

addBothLevels('prod-mango-chobani', 'Mango Chobani (barcode 818290015365): Oxford-comma conjunction + bare "L. Rhamnosus" probiotic strain, organic path',
  'Organic cultured pasteurized grade A nonfat milk, mango, cane sugar, fruit pectin, L. Casei, and L. Rhamnosus.',
  ['en:usda-organic']);

addBothLevels('prod-himalayan-salt-crackers', 'Pink Himalayan Salt Flatbread Crackers (barcode 860493002284): multi-category product (17 flags across 3 categories in the original production incident)',
  'Enriched wheat flour, soybean oil, sugar, pink himalayan salt, natural flavors, TBHQ.',
  [], [], 'Pink Himalayan Salt Flatbread Crackers');

// ════════════════════════════════════════════════════════════════════════════
// Write output
// ════════════════════════════════════════════════════════════════════════════

const outputPath = path.join(__dirname, 'inputs.json');
fs.writeFileSync(outputPath, JSON.stringify(cases, null, 2));

console.log(`Generated ${cases.length} test cases -> ${outputPath}`);
