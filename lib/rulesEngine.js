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
  'high oleic soybean oil',   // before 'soybean oil'
  'high oleic soybean',       // bare form
  // ── Palm derivatives ──────────────────────────────────────────────────────
  'fractionated palm oil',    // before 'palm oil', 'fractionated palm'
  'fractionated palm',        // catches "fractionated palm" without "oil"
  'palm kernel oil',          // before 'palm oil'
  'palm fruit oil',           // before 'palm oil'; "palm oil" does not match "palm fruit oil"
  'palm olein',
  // ── Conventional seed/vegetable oils ─────────────────────────────────────
  'canola',          // before 'canola oil'
  'canola oil',
  'soybean oil',
  'soya oil',          // UK/EU labeling variant of soybean oil
  'soy oil',           // shortened form (distinct from 'soybean oil')
  'corn oil',
  'sunflower oil',
  'safflower oil',
  'cottonseed',      // before 'cottonseed oil'
  'cottonseed oil',
  'grapeseed oil',
  'rice bran oil',
  'vegetable oil',
  'palm oil',
  'rapeseed oil',
  'peanut oil',
  'mustard seed oil',
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
  // ── Cross-check notes ────────────────────────────────────────────────────
  // 'canola' removed — already in SEED_OILS (unconditional, no organic clearance).
  // 'soya lecithin' present in SYNTHETIC_ADDITIVES as EU/British variant;
  //   'soy lecithin' (different string) and bare 'lecithin' are kept here.
  // No conflicts with SEED_OILS (except canola removed above),
  //   MILK_DERIVED_INGREDIENTS, or EGG_DERIVED_INGREDIENTS.
  // 'cottonseed flour'/'cottonseed meal': SEED_OILS has bare 'cottonseed' which
  //   claims the span first — these entries produce a seed_oils flag in practice.
  // Bare 'corn' is intentionally absent — handled by the standalone corn regex
  //   in analyzeIngredients() which uses a word-boundary pattern.
  // 'maltodextrin' added (not in user spec) to prevent bare 'dextrin' (7 chars)
  //   from falsely matching the suffix of 'maltodextrin'; same approach as
  //   'cyclodextrin' which the user's spec included for the same reason.
  // Wheat derivatives (enriched flour, bleached flour, unbleached flour, all
  //   purpose flour, bread flour, durum wheat, semolina, spelt, wheat bran,
  //   wheat germ, wheat flour, wheat starch, wheat gluten, enriched macaroni
  //   product) moved to GLYPHOSATE_HEAVY — pre-harvest desiccation is the
  //   primary risk. Tests updated from conventional_crops → glyphosate_heavy.
  // Oat derivatives (oat starch, oat extract, oat syrup, oat bran, rolled oats,
  //   oat flour, oat fiber) moved to GLYPHOSATE_HEAVY. Tests updated.
  // Malt derivatives (malt syrup, malt extract, malt flavor) moved to
  //   GLYPHOSATE_HEAVY barley section. Tests updated.

  // ── Corn/Maize — whole and minimally processed ────────────────────────────
  'maize starch',         // before 'maize flour', 'maize'
  'maize flour',          // before 'maize'
  'popped corn',          // before 'corn'
  'whole corn',           // before 'corn'
  'corn grits',           // before 'corn'
  'corn flour',           // before 'corn'
  'corn sugar',           // before 'corn'
  'corn bran',            // before 'corn'
  'corn meal',            // before 'corn'
  'cornmeal',
  'popcorn',
  'hominy',
  'maize',                // before 'corn' (no shared substring)

  // ── Corn — sweeteners and syrups ──────────────────────────────────────────
  'high fructose corn syrup',   // before 'corn syrup', 'glucose-fructose syrup'
  'glucose-fructose syrup',     // before 'glucose syrup'
  'corn syrup solids',          // before 'corn syrup'
  'brown rice syrup',
  'glucose syrup',              // before 'glucose'
  'maize syrup',
  'corn syrup',
  'cane juice crystals',        // before 'cane juice', 'cane syrup', 'sugar'
  'cane juice',                 // before 'sugar'
  'cane syrup',                 // before 'sugar'
  'invert sugar',               // before 'sugar'
  'high fructose',              // standalone; HFCS shadows at same position
  'crystalline fructose',

  // ── Corn — starches ───────────────────────────────────────────────────────
  'corn starch modified',  // before 'corn starch'
  'corn starch',

  // ── Corn — fermentation and acid derivatives ──────────────────────────────
  'gluconic acid',         // before 'acetic acid', 'lactic acid' (length sort)
  'grain vinegar',         // fermented from wheat/corn; clearable by organic
  'acetic acid',
  'lactic acid',
  'citric acid',

  // ── Corn — sugar alcohols ─────────────────────────────────────────────────
  'polydextrose',          // before 'dextrose'
  'erythritol',
  'maltitol',
  'lactitol',
  'isomalt',               // contains 'malt' internally — claimed here before GLYPHOSATE_HEAVY
  'xylitol',
  'mannitol',
  'sorbitol',
  'dextrose',
  'fructose',
  'glucose',
  'sucrose',
  'lactose',                    // dairy sugar; conventional supply chain absent organic cert
  'sugar',

  // ── Corn — vitamins and amino acids ───────────────────────────────────────
  // These corn-fermentation-derived nutrients indicate heavy industrial
  // processing. Not in FORTIFIED_VITAMINS cross-check list but note they
  // also appear in FORTIFIED_VITAMINS — containsFortifiedVitamins() uses a
  // separate substring check (not the claiming system) so no conflict.
  'pantothenic acid',      // vitamin b5 (16 chars)
  'ascorbic acid',         // vitamin c  (13 chars)
  'glutamic acid',         // precursor form of msg (13 chars)
  'tocopherols',           // vitamin e family (11 chars)
  'niacinamide',           // vitamin b3 (10 chars)
  'riboflavin',            // vitamin b2 (10 chars)
  'tryptophan',            // amino acid  (10 chars)
  'vitamin b2',
  'vitamin b3',
  'vitamin b5',
  'threonine',
  'vitamin c',
  'vitamin e',
  'lysine',

  // ── Corn — starches and gums ──────────────────────────────────────────────
  'starch sodium octenylsuccinate', // longest (31)
  'carboxymethyl cellulose',
  'hydroxypropyl starch',
  'hydroxyethyl starch',
  'acetylated starch',
  'resistant starch',
  'phosphate starch',
  'oxidized starch',
  'cellulose gum',
  'cyclodextrin',           // before 'dextrin' (dextrin is suffix of cyclodextrin)
  'maltodextrin',           // added: prevents bare 'dextrin' false-matching suffix
  'xanthan gum',
  'modified potato starch', // before 'modified starch' (not a substring match)
  'modified tapioca starch', // before 'modified starch' (not a substring match)
  'modified starch',        // generic form
  'gellan gum',
  'guar gum',               // galactomannan hydrocolloid; often from GE-crop regions
  'pullulan',
  'dextrin',
  'tvp',                    // textured vegetable protein abbreviation

  // ── Soy — whole and minimally processed ───────────────────────────────────
  // 'soybean oil' lives in SEED_OILS (unconditional, no clearance).
  'whole soy',
  'soy flour',
  'soybeans',               // before 'soybean'
  'soybean',

  // ── Soy — proteins ────────────────────────────────────────────────────────
  'hydrolyzed vegetable protein',  // before 'vegetable protein'
  'hydrolyzed plant protein',
  'hydrolyzed soy protein',        // before 'soy protein'
  'soy protein concentrate',       // before 'soy protein isolate', 'soy protein'
  'soy protein isolate',           // before 'soy protein'
  'textured vegetable protein',    // before 'vegetable protein', 'textured soy'
  'vegetable protein',
  'soy concentrate',               // before 'soy protein'
  'textured soy',
  'soy protein',
  'soy isolate',

  // ── Soy — extracts ────────────────────────────────────────────────────────
  // 'soya lecithin' is in SYNTHETIC_ADDITIVES (EU/British spelling); the US
  // spelling 'soy lecithin' and bare 'lecithin' are intentionally kept here
  // so that organic/non-gmo certification can clear them.
  // 'sunflower lecithin' is a known non-GMO source — range is claimed (so bare
  //   'lecithin' cannot match the suffix) but no flag is emitted. Listed in
  //   CONVENTIONAL_CROPS_NO_FLAG below and handled in the detection loop.
  'sunflower lecithin',     // before 'lecithin' — claim range, skip flag (see loop)
  'soy lecithin',           // before 'lecithin'
  'soy extract',
  'soy sauce',
  'lecithin',
  'miso',

  // ── Canola/Rapeseed ───────────────────────────────────────────────────────
  // 'canola' removed — already in SEED_OILS as 'canola' and 'canola oil'.
  // 'rapeseed oil' lives in SEED_OILS (no clearance).
  // Plain 'rapeseed' (the crop form) is clearable here via organic/Non-GMO.
  'rapeseed',

  // ── Cottonseed ────────────────────────────────────────────────────────────
  // Note: SEED_OILS has bare 'cottonseed' (9 chars). If the ingredient text
  // says "cottonseed flour", SEED_OILS claims [0,9] first, which overlaps with
  // the 'cottonseed flour' match here. In practice these flag as seed_oils.
  'cottonseed flour',       // before 'cottonseed meal' (tie at 16 chars)
  'cottonseed meal',

  // ── Sugar beet ────────────────────────────────────────────────────────────
  'beet sugar',             // before 'sugar' (already above in corn sweeteners)

  // ── Papaya ────────────────────────────────────────────────────────────────
  'papaya',

  // ── Zucchini/Summer squash ────────────────────────────────────────────────
  'yellow squash',          // before 'summer squash' (same length, order fine)
  'summer squash',
  'zucchini',

  // ── Alfalfa ───────────────────────────────────────────────────────────────
  'alfalfa sprouts',        // before 'alfalfa'
  'alfalfa',

  // ── Potato ────────────────────────────────────────────────────────────────
  // Note: 'potato' (6 chars) is a substring of 'sweet potato' — this may
  // false-positive on sweet potato ingredients (not a GMO crop). Known limitation.
  'potato granules',        // before 'potato flakes', 'potato starch', 'potato'
  'dried potatoes',         // before 'potatoes', 'potato'
  'potato starch',          // before 'potato flakes', 'potato'
  'potato flakes',          // before 'potatoes', 'potato'
  'potato flour',           // before 'potatoes', 'potato'
  'potatoes',               // before 'potato'
  'potato',
];

/**
 * Category: High-glyphosate-risk crops
 * Crops where glyphosate is routinely applied as a pre-harvest desiccant or
 * as a primary herbicide during cultivation. Separate from CONVENTIONAL_CROPS
 * because the primary concern is pesticide residue (especially glyphosate),
 * not GMO status.
 *
 * Clearance:
 *   - usda-organic label OR organic prefix → skip entirely (no flag)
 *   - glyphosate-free label → downgrade from reject → caution (still flagged yellow)
 *   - Level 1 → always caution regardless of certification
 *
 * No conflict with SYNTHETIC_ADDITIVES, SEED_OILS, MILK_DERIVED_INGREDIENTS,
 * or EGG_DERIVED_INGREDIENTS.
 * flaxseed oil / linseed oil are NOT in SEED_OILS so they remain here.
 * No cross-list conflicts with CONVENTIONAL_CROPS (wheat/oats/malt not there).
 *
 * IMPORTANT — bare 'malt' guard: the detection loop applies a word-boundary
 * check for the trigger 'malt' — if the character immediately following the
 * match is a letter, the flag is skipped. This prevents false positives in
 * 'maltodextrin', 'maltose', etc. where 'malt' is a derivatization prefix,
 * not a barley-malt ingredient declaration.
 */
const GLYPHOSATE_HEAVY = [
  // ── Oats & oat derivatives ────────────────────────────────────────────────
  'whole grain oats',       // before 'oats', 'oat'
  'oat beta glucan',        // before 'oat bran', 'oats'
  'steel cut oats',         // before 'oats'
  'rolled oats',            // before 'oats'
  'oat protein',            // before 'oats'
  'oat extract',            // before 'oats'
  'quick oats',             // before 'oats'
  'oat starch',             // before 'oats'
  'oat flour',              // before 'oats'
  'oat fiber',              // before 'oats'
  'oat syrup',              // before 'oats'
  'oat bran',               // before 'oats'
  'oatmilk',                // no-space variant (before 'oat milk')
  'oat milk',               // before 'oats'
  'oats',

  // ── Wheat & wheat derivatives ─────────────────────────────────────────────
  'enriched acini di pepe',      // before 'enriched macaroni product', 'enriched flour'
  'enriched macaroni product',   // before 'enriched flour', 'wheat'
  'vital wheat gluten',          // before 'wheat gluten', 'wheat'
  'whole wheat flour',           // before 'whole wheat', 'wheat flour', 'wheat'
  'all purpose flour',           // before 'wheat'
  'unbleached flour',            // before 'enriched flour', 'wheat'
  'bleached flour',              // before 'enriched flour', 'wheat'
  'enriched flour',              // before 'wheat'
  'wheat berries',               // before 'wheat'
  'wheat starch',                // before 'wheat'
  'wheat gluten',                // before 'wheat'
  'whole wheat',                 // before 'wheat'
  'wheat flour',                 // before 'wheat'
  'durum wheat',                 // before 'wheat'
  'bread flour',
  'triticale',
  'semolina',
  'bulgur',
  'kamut',
  'wheat',
  'farro',
  'spelt',

  // ── Barley & barley malt derivatives ─────────────────────────────────────
  'barley malt extract',   // before 'barley malt', 'malt extract', 'barley'
  'barley beta glucan',    // before 'barley'
  'barley malt syrup',     // before 'barley malt', 'malt syrup', 'barley'
  'malted barley',         // before 'barley', 'malt'
  'barley flour',          // before 'barley'
  'malt extract',          // before 'malt'
  'pearl barley',          // before 'barley'
  'barley bran',           // before 'barley'
  'barley malt',           // before 'barley', 'malt'
  'malt flavor',           // before 'malt'
  'malt syrup',            // before 'malt'
  'barley',
  'malt',                  // ← word-boundary guard applied in detection loop

  // ── Lentils ───────────────────────────────────────────────────────────────
  'lentil protein',        // before 'lentils'
  'lentil flour',          // before 'lentils'
  'green lentils',         // before 'lentils'
  'red lentils',           // before 'lentils'
  'lentils',

  // ── Peas ─────────────────────────────────────────────────────────────────
  'pea protein isolate',   // before 'pea protein'
  'pea protein',
  'yellow peas',           // before 'peas'
  'split peas',            // before 'peas'
  'pea starch',
  'pea flour',
  'green peas',            // before 'peas'
  'pea fiber',
  'peas',

  // ── Edible beans ─────────────────────────────────────────────────────────
  'chickpea flour',        // before 'chickpeas', 'bean flour'
  'garbanzo flour',        // before 'garbanzo beans'
  'garbanzo beans',        // before 'beans'
  'kidney beans',          // before 'beans'
  'black beans',           // before 'beans'
  'pinto beans',           // before 'beans'
  'navy beans',            // before 'beans'
  'bean flour',            // before 'beans'
  'chickpeas',
  'chickpea',              // singular — same crop/glyphosate exposure as 'chickpeas'
  'beans',

  // ── Flax / Linseed ────────────────────────────────────────────────────────
  // Note: flaxseed oil and linseed oil are NOT in SEED_OILS — they remain here.
  'ground flaxseed',       // before 'flaxseed oil', 'flaxseed'
  'flaxseed oil',          // before 'flaxseed'
  'linseed oil',           // before 'linseed'
  'flax meal',             // before 'flax'
  'flaxseed',              // before 'flax'
  'linseed',
  'flax',

  // ── Rye ───────────────────────────────────────────────────────────────────
  'pumpernickel',          // before 'rye'
  'whole rye',             // before 'rye'
  'rye flour',             // before 'rye'
  'rye malt',              // before 'rye', 'malt'
  'rye bran',              // before 'rye'
  'rye',

  // ── Buckwheat ────────────────────────────────────────────────────────────
  'buckwheat groats',      // before 'buckwheat'
  'buckwheat flour',       // before 'buckwheat'
  'buckwheat',
  'kasha',

  // ── Millet ───────────────────────────────────────────────────────────────
  'foxtail millet',        // before 'millet'
  'finger millet',         // before 'millet'
  'whole millet',          // before 'millet'
  'millet flour',          // before 'millet'
  'millet bran',           // before 'millet'
  'millet',
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
  // ── Generic flavor terms ──────────────────────────────────────────────────
  'flavor enhancer',  // before 'flavor'
  'flavor base',      // before 'flavor'
  'flavouring',       // before 'flavor'
  'flavor',
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
  'interesterified palm oil',    // before 'interesterified oil'
  'interesterified soybean oil', // before 'interesterified oil'
  'interesterified oil',         // before 'interesterified fat'
  'interesterified fat',
  'carrageenan',
  'titanium dioxide',
  'propyl gallate',
  'octyl gallate',
  'dodecyl gallate',
  'propylene glycol',
  'acetylated monoglycerides',   // synthetic emulsifier
  'emulsifiers',
  'acidity regulators',
  'anticaking agent',
  'silicon dioxide',
  'nisin',                   // natural antimicrobial peptide used as preservative (E234)
  'nisin preparation',
  // ── Emulsifiers ───────────────────────────────────────────────────────────
  'mono- and diglycerides',  // before 'monoglycerides', 'diglycerides'
  'mono and diglycerides',   // before 'monoglycerides', 'diglycerides'
  'mono - and diglycerides', // space variant
  'monoglycerides',
  'diglycerides',
  // ── Glycerol-based emulsifiers ───────────────────────────────────────────
  'glycerol monostearate',   // before 'glycerol'
  'glyceryl monostearate',   // alternate spelling
  'glycerol',
  'glycerin',                // common name for glycerol (different string)
  'humectants',
  'hydrolyzed corn protein', // free glutamate generator
  // ── Synthetic fortification — moved to FORTIFIED_VITAMINS ───────────────
  // (folic acid, niacin, niacinamide, potassium phosphate, thiamine mononitrate,
  //  thiamin mononitrate, thiamin mononitrite, riboflavin, reduced iron,
  //  ferrous sulfate, zinc oxide — all now detected via containsFortifiedVitamins)
  // ── Sodium-based preservatives and stabilizers ───────────────────────────
  'sodium alginate',
  'sodium caseinate',
  'sodium citrate',
  'sodium diacetate',
  'sodium phosphate',
  // ── Synthetic phosphates ──────────────────────────────────────────────────
  'tetrasodium diphosphate',      // pyrophosphate chelating agent (E450i)
  'tetrasodium pyrophosphate',    // alternate name for tetrasodium diphosphate
  'sodium hexametaphosphate',     // sequestrant / emulsifier (E452i)
  'sodium aluminum phosphate',    // leavening acid (E541)
  'sorbic acid',
  'malic acid',              // synthetic acidulant / pH regulator (E296)
  // ── Preservative acids and salts ─────────────────────────────────────────
  'potassium benzoate',
  'benzoic acid',
  'potassium sorbate',
  'calcium propionate',
  'sodium propionate',
  'propionic acid',
  'potassium nitrate',
  'potassium nitrite',
  // ── "Uncured" nitrate sources ─────────────────────────────────────────────
  'cultured celery juice',    // nitrate precursor used in "uncured" products
  'cultured celery powder',   // nitrate precursor — powder form
  'cultured celery extract',  // nitrate precursor — extract form
  'cultured onion juice',     // nitrate precursor — onion-based form
  // ── Thickeners / stabilizers (borderline food additives) ─────────────────
  'karaya gum',              // tree exudate emulsifier/stabilizer (E416)
  'konjac gum',              // konjac-derived glucomannan thickener (E425)
  'modified cellulose',      // synthetic cellulose derivative (methylcellulose/HPMC)
  // ── Synthetic additives — miscellaneous ──────────────────────────────────
  'caffeine',               // synthetic stimulant; concern in food products
  'cherry powder',          // synthetic nitrate source in "uncured" products
  'disodium succinate',     // flavor enhancer (E363); glutamate-adjacent
  'erythorbic acid',        // synthetic antioxidant (E315); ascorbate analogue
  'ester gum',              // synthetic resin stabilizer (E445)
  // ── Brominated vegetable oil ──────────────────────────────────────────────
  'brominated vegetable oil',  // also pre-claimed in PRIORITY_ADDITIVES pre-pass
  'brominated oil',
  'cyclamate',          // bare form — 'sodium cyclamate' is longer; both forms needed
  'sodium cyclamate',
  'natamycin',
  'stannous chloride',
  // ── Sulfur-based preservatives ────────────────────────────────────────────
  'sulfur dioxide',
  'sodium bisulfite',
  'sodium metabisulfite',
  'sodium sulfite',
  'potassium bisulfite',
  'potassium metabisulfite',
  'sulfites',
  // ── EDTA chelating agents ─────────────────────────────────────────────────
  'calcium disodium edta',  // before 'disodium edta'
  'disodium edta',
  'tetrasodium edta',
  // ── Lactylate emulsifiers ─────────────────────────────────────────────────
  'sodium stearoyl-2-lactylate',  // before 'sodium stearoyl lactylate'
  'sodium stearoyl lactylate',
  'calcium stearoyl-2-lactylate',
  // ── Stearyl ester emulsifiers ─────────────────────────────────────────────
  'sodium stearyl fumarate',      // stearyl ester dough conditioner (E485)
  'stearyl tartrate',             // stearyl ester emulsifier (E483)
  // ── Polysorbate emulsifiers ───────────────────────────────────────────────
  'polysorbate 60',               // synthetic emulsifier (E435)
  'polysorbate 80',               // synthetic emulsifier (E433)
  // ── Fat substitutes and sucrose esters ───────────────────────────────────
  'salatrim',
  'succistearin',
  'sucroglycerides',
  // ── Dyes ─────────────────────────────────────────────────────────────────
  'msg',
  'yellow 5',
  'yellow 5 lake',       // after 'yellow 5' — lake form (aluminum complex)
  'yellow 6',
  'yellow 6 lake',       // after 'yellow 6'
  'red 40',
  'red 40 lake',         // after 'red 40'
  'blue 1',
  'blue 1 lake',         // after 'blue 1'
  'blue 2',
  'blue 2 lake',         // after 'blue 2'
  'green 3',
  'green 3 lake',        // after 'green 3'
  // ── Dye chemical name synonyms ────────────────────────────────────────────
  'brilliant blue fcf',  // Blue 1 (E133)
  'fast green fcf',      // Green 3 (E143)
  'sunset yellow',       // Yellow 6 (E110)
  'tartrazine',          // Yellow 5 (E102)
  'allura red',          // Red 40 (E129)
  'indigotine',          // Blue 2 (E132)
  'orange b',            // additional synthetic dye
  'tbhq',
  'bha',
  'bht',
  'butylated hydroxyanisole',  // full chemical name for BHA (E320)
  'butylated hydroxytoluene',  // full chemical name for BHT (E321)
  // ── Texas SB 25 additions — dough conditioners / flour treatments ─────────
  'azodicarbonamide',
  'azobisformamide',               // synonym for azodicarbonamide (ADA)
  'bromated flour',
  'calcium bromate',
  'potassium iodate',
  'diacetyl tartaric acid esters', // before 'diacetyl'
  'diacetyl',
  'datem',
  'ada',                           // abbreviation for azodicarbonamide
  'l-cysteine',                    // dough conditioner (E920); often from duck feathers
  // ── Flour bleaching / oxidizing agents ───────────────────────────────────
  'benzoyl peroxide',
  'acetone peroxide',
  'chlorine dioxide',
  // ── Texas SB 25 additions — fat substitutes ───────────────────────────────
  'olestra',
  'olean',                         // brand name for olestra
  // ── Texas SB 25 additions — preservatives / emulsifiers ──────────────────
  'methylparaben',
  'ethylparaben',
  'propylparaben',
  'butylparaben',
  'heptylparaben',
  'sodium lauryl sulfate',
  // ── Texas SB 25 additions — leavening agents ─────────────────────────────
  'potassium aluminum sulfate',
  'sodium aluminum sulfate',
  // ── Texas SB 25 additions — synthetic colorants ───────────────────────────
  'canthaxanthin',
  'citrus red 2',
  'red 3',
  'red 3 lake',   // after 'red 3' — lake form (aluminum complex)
  'red 4',
  // ── Additional synthetic colorants ───────────────────────────────────────
  'carmine',
  'cochineal',
  'erythrosine',
  'iron oxide',
  // ── E-number additives ───────────────────────────────────────────────────
  'e102',   // tartrazine (Yellow 5)
  'e110',   // sunset yellow FCF (Yellow 6)
  'e127',   // erythrosine (Red 3)
  'e129',   // allura red AC (Red 40)
  'e132',   // indigotine (Blue 2)
  'e133',   // brilliant blue FCF (Blue 1)
  'e143',   // fast green FCF (Green 3)
  'e161g',  // canthaxanthin (E-number form)
  'e171',   // titanium dioxide (E-number form)
  'e319',   // TBHQ (E-number form)
  'e320',   // BHA (E-number form)
  'e321',   // BHT (E-number form)
  'e330',   // citric acid (synthetic form)
  'e339',   // sodium phosphates
  'e388',   // thiodipropionic acid (antioxidant synergist)
  'e471',   // mono and diglycerides (E-number form)
  'e472a',  // acetic acid esters of mono- and diglycerides
  'e472b',  // lactic acid esters of mono- and diglycerides
  'e472e',  // DATEM — diacetyl tartaric acid esters (E-number form)
  'e476',   // polyglycerol polyricinoleate (PGPR)
  'e483',   // stearyl tartrate (E-number form)
  'e485',   // sodium stearoyl fumarate (E-number form)
  'e487',   // sodium lauryl sulfate (E-number form)
  // ── SLS text forms ────────────────────────────────────────────────────────
  'sodium dodecyl sulfate',    // synonym for sodium lauryl sulfate (SLS / E487)
  'e500',   // sodium carbonates
  'e924',   // potassium bromate (E-number form)
  'e950',   // acesulfame potassium (E-number form)
  'e951',   // aspartame (E-number form)
  'e952',   // cyclamate (E-number form)
  'e954',   // saccharin (E-number form)
  'e955',   // sucralose (E-number form)
  // ── Spanish-language equivalents ─────────────────────────────────────────
  'colorante amarillo 6',              // Spanish: Yellow 6
  'colorante artificial rojo 40',      // Spanish: Red 40
  'jarabe de maíz de alta fructosa',   // Spanish: high-fructose corn syrup
  'aceite de palma y/o karité',        // Spanish: palm/shea oil blend
  'aceite de palma y/o palmiste',      // Spanish: palm/palm kernel oil blend
  'soya lecithin',                     // British/EU spelling of soy lecithin
  // ── Novel proteins and food-tech ingredients ─────────────────────────────
  'soy leghemoglobin',
  'insect flour',
  // ── Synthetic flavoring compounds ────────────────────────────────────────
  'ethyl vanillin',  // before 'vanillin' — findMatches length-sorts; wins at same position
  'vanillin',
  // ── Processing methods ────────────────────────────────────────────────────
  'mechanically separated meat',  // structural/processing concern, not a chemical additive
  // Note: 'bleached flour' is intentionally omitted here — it now lives in
  // GLYPHOSATE_HEAVY (clearable by organic label or glyphosate-free cert).
];

/** Soft-flag grains that indicate gluten / prolamin protein is present. */
const GLUTEN_GRAINS = [
  // ── Wheat & wheat derivatives (longer phrases first) ──────────────────────
  'hydrolyzed wheat protein', // before 'wheat protein', 'wheat'
  'modified wheat starch',    // before 'wheat starch', 'wheat'
  'white whole wheat flour',  // before 'whole wheat flour', 'wheat flour', 'wheat'
  'whole wheat flour',        // before 'wheat flour', 'wheat'
  'self-rising flour',
  'pastry flour',
  'cake flour',
  'bread flour',
  'all-purpose flour',
  'tipo 00 flour',
  'wheat flour',
  'wheat starch',
  'wheat protein',
  'wheat maltodextrin',       // before 'wheat'
  'wheat germ',
  'wheat bran',
  'wheat',
  'semolina',
  'bulgur',
  'farro',
  'freekeh',
  // ── Ancient and hybrid wheat varieties ────────────────────────────────────
  'einkorn',
  'emmer',
  'triticale',
  'spelt flour',              // before 'spelt'
  'spelt',
  'kamut flour',              // before 'kamut'
  'kamut',
  'durum',
  // ── Botanical names — appear on supplement and specialty food labels ───────
  'triticum vulgare',         // common wheat
  'hordeum vulgare',          // barley
  'secale cereale',           // rye
  'avena sativa',             // oats
  // ── Barley & barley derivatives ────────────────────────────────────────────
  'barley malt',              // before 'barley', 'malt'
  'malt extract',             // before 'malt'
  'malt vinegar',             // before 'malt'
  'malt flavor',              // before 'malt'
  'dextrimaltose',            // barley malt-derived sweetener
  'quick-cooking barley',     // before 'barley'
  'pearl barley',             // before 'barley'
  'pot barley',               // before 'barley'
  'scotch barley',            // before 'barley'
  'hulled barley',            // before 'barley'
  'dehulled barley',          // before 'barley'
  'hulless barley',           // before 'barley'
  'naked barley',             // before 'barley'
  'barley flakes',            // before 'barley'
  'barley flour',             // before 'barley'
  'barley grits',             // before 'barley'
  'malt barley',              // before 'barley', 'malt'
  'barley',
  'malt',
  // ── Rye ───────────────────────────────────────────────────────────────────
  'white rye',
  'light rye',
  'medium rye',
  'dark rye',
  'cereal rye',
  'ryegrass',
  'pumpernickel',
  'rye',
  // ── Rice (broader prolamin definition — rice prolamins can trigger sensitivity) ──
  'whole grain brown rice flour',  // before 'rice flour', 'brown rice'
  'brown rice',               // before 'rice'
  'white rice',               // before 'rice'
  'rice flour',               // before 'rice'
  'rice starch',              // before 'rice'
  'rice bran',                // before 'rice'
  'rice protein',             // before 'rice'
  'rice',
  // ── Corn & corn derivatives ───────────────────────────────────────────────
  'high fructose corn syrup', // before 'corn syrup', 'corn'
  'hydrolyzed corn protein',  // before 'corn'
  'modified corn starch',     // before 'corn starch', 'corn'
  'corn syrup solids',        // before 'corn'
  'corn syrup',               // before 'corn' — bare form (solids already above)
  'corn oil margarine',       // before 'corn oil', 'corn'
  'corn oil',                 // before 'corn'
  'corn gluten',              // before 'corn'
  'corn sweetener',           // before 'corn'
  'corn sugar',               // before 'corn'
  'corn flakes',              // before 'corn'
  'corn extract',             // before 'corn'
  'corn alcohol',             // before 'corn'
  'corn flour',               // before 'corn'
  'corn starch',              // before 'corn'
  'cornmeal',
  'hominy',
  'grits',
  'maize',
  'masa',
  'polenta',                  // corn-based
  'zea mays',                 // botanical name for corn
  'corn',
  // ── Oats & oat derivatives ────────────────────────────────────────────────
  'steel-cut oats',           // before 'oats'
  'scottish oats',            // before 'oats'
  'quick oats',               // before 'oats'
  'instant oats',             // before 'oats'
  'whole oats',               // before 'oats'
  'oat groats',               // before 'oats'
  'sprouted oats',            // before 'oats'
  'rolled oats',              // before 'oats'
  'oat flour',                // before 'oats'
  'oat bran',                 // before 'oats'
  'oatmeal',
  'oats',
  // ── Other grains ─────────────────────────────────────────────────────────
  'millet flour',             // before 'millet'
  'millet',
  'groat',
  'graham',
  // ── Cross-sensitivity risk grains ────────────────────────────────────────
  'grain sorghum',            // before 'sorghum'
  'sweet sorghum',            // before 'sorghum'
  'broomcorn',
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
  // ── Almost always wheat-blended in commercial production ──────────────────
  'asafoetida',
  'hing',                     // alternative name for asafoetida
  // ── May use barley malt as carrier ───────────────────────────────────────
  'smoke flavoring',
  // ── Corn-derived sweeteners and grain-based additives ─────────────────────
  'maltodextrin',             // before 'malt' — bare form (wheat maltodextrin already above)
  'dextrose',
  'fructose',
  'glucose syrup',
  'maltose',
  'vanillin',
  'confectioners sugar',
  'sorbitol',
  'xanthan gum',
  // ── Processed and ambiguous grain-based ingredients ────────────────────────
  'modified food starch',     // before 'food starch'
  'food starch',
  'hydrogenated starch hydrolysate',
  'hydroxypropylated starch',
  'pregelatinized starch',
  'hydrolyzed vegetable protein',
  'hydrolyzed plant protein',
  'textured vegetable protein',
  'vegetable protein',
  'vegetable gum',
  'soy sauce',
  'miso',
  'dextrin',
  'baking powder',
];

/**
 * Synthetic vitamin fortification markers — exported for L2 waterfall use.
 * These indicate industrial enrichment added back after processing removes
 * naturally occurring vitamins and minerals.
 */
const FORTIFIED_VITAMINS = [
  // ── B vitamins ────────────────────────────────────────────────────────────
  'riboflavin',
  'thiamine mononitrate',   // before 'thiamin mononitrate' (length sort)
  'thiamin mononitrate',
  'thiamin mononitrite',    // label typo variant
  'niacin',
  'niacinamide',            // before 'niacin' (length sort)
  'folic acid',
  'pyridoxine hydrochloride', // before 'vitamin b6'
  'vitamin b6',
  'vitamin b12',
  'cobalamin',
  'cyanocobalamin',         // before 'cobalamin' (length sort)
  'pantothenic acid',
  'calcium pantothenate',   // before 'calcium' entries
  'biotin',
  'choline chloride',       // before 'choline bitartrate'
  'choline bitartrate',
  'inositol',
  // ── Fat-soluble vitamins ──────────────────────────────────────────────────
  'vitamin a palmitate',    // before 'vitamin a acetate', 'vitamin a', 'palmitate'
  'vitamin a acetate',      // before 'vitamin a'
  'vitamin a',
  'palmitate',              // suffix used after vitamin a and d on some labels
  'vitamin d2',             // before 'vitamin d3'
  'vitamin d3',
  'dl-alpha-tocopherol',    // before 'vitamin e', 'd-alpha-tocopherol'
  'd-alpha-tocopherol',     // before 'vitamin e'
  'natural vitamin e',      // before 'vitamin e' and 'mixed tocopherols'
  'mixed tocopherols',
  'vitamin e',
  'phytonadione',           // before 'vitamin k'
  'menaquinone',            // before 'vitamin k'
  'vitamin k',
  // ── Iron & minerals ───────────────────────────────────────────────────────
  'reduced iron',            // before bare 'iron'
  'ferrous sulfate',
  'ferric phosphate',        // before 'phosphate' sub-triggers
  'iron',                    // bare form used on some labels
  'zinc oxide',
  'zinc gluconate',         // before 'zinc sulfate'
  'zinc sulfate',
  'calcium carbonate',      // before 'calcium phosphate', 'calcium citrate'
  'calcium phosphate',
  'calcium citrate',
  'magnesium oxide',        // before 'magnesium citrate'
  'magnesium citrate',
  'potassium iodide',       // before 'potassium phosphate'
  'potassium phosphate',
  'sodium iodide',
  'copper gluconate',       // before 'copper sulfate'
  'copper sulfate',
  'manganese sulfate',
  'chromium picolinate',
  'selenium yeast',         // before 'sodium selenite', 'sodium selenate'
  'sodium selenite',        // before 'sodium selenate'
  'sodium selenate',
  'molybdenum',
  // ── Amino acids and conditionally essential nutrients ─────────────────────
  'taurine',
  'l-carnitine',
  'l-tryptophan',           // before 'l-theanine'
  'l-theanine',
  'lysine',
];

/**
 * Plant-derived colorants — exported for L2 waterfall use.
 * Not synthetic dyes (those are already in SYNTHETIC_ADDITIVES), but their
 * presence signals that the product required color correction after processing.
 */
const NATURAL_COLORANTS = [
  'annatto',
  'annatto extract',
  'annatto color',                    // label variant of annatto extract
  'beet juice',
  'beet juice concentrate',
  'beet powder',                      // dehydrated beet colorant
  'black carrot juice concentrate',   // before 'carrot juice concentrate'
  'carrot juice concentrate',
  'red cabbage juice concentrate',
  'turmeric extract',
  'turmeric color',
  'paprika extract',
  'oleoresin of paprika',             // alternate label form (before 'oleoresin paprika')
  'oleoresin paprika',                // alternate word-order form
  'paprika oleoresin',                // standard label form
  'extractives of paprika',           // FDA label term
  'beta-carotene',
  'fruit and/or vegetable juice color',  // common label phrase for mixed colorants
  'fruit and vegetable juice',           // another form of the same
  'huito juice concentrate',             // blue-black plant colorant (Genipa americana)
];

/**
 * Returns true if the ingredient string contains any entry from FORTIFIED_VITAMINS.
 * Case-insensitive substring match.
 * @param {string} ingredients
 * @returns {boolean}
 */
function containsFortifiedVitamins(ingredients) {
  const lower = ingredients.toLowerCase();
  return FORTIFIED_VITAMINS.some(trigger => lower.includes(trigger));
}

/**
 * Returns true if the ingredient string contains any entry from NATURAL_COLORANTS.
 * Case-insensitive substring match.
 * @param {string} ingredients
 * @returns {boolean}
 */
function containsNaturalColorants(ingredients) {
  const lower = ingredients.toLowerCase();
  return NATURAL_COLORANTS.some(trigger => lower.includes(trigger));
}

/**
 * Ingredients that must never trigger any check — mined minerals, water,
 * salt forms, yeast, live cultures, enzymes. Exported so scan.js can mask
 * them from ingredient strings before calling any ingredient-level helper.
 *
 * Sorted longest-first so masking replaces the most specific form first
 * (e.g. "himalayan pink salt" before "himalayan salt" before "salt"),
 * preventing a shorter match from leaving a recognisable suffix behind.
 */
const ALWAYS_IGNORE_INGREDIENTS = [
  // Salt forms (longest first)
  'himalayan pink sea salt', // before 'himalayan pink salt', 'himalayan salt'
  'himalayan pink salt',
  'himalayan salt',
  'celtic sea salt',
  'kosher salt',
  'onion salt',
  'sea salt',
  'salt',
  // Water forms
  'filtered water',
  'purified water',
  'sparkling water',
  'water',
  // Mined minerals (calcium carbonate is in FORTIFIED_VITAMINS — must be masked)
  'calcium carbonate',
  'magnesium oxide',
  // Yeast forms
  'nutritional yeast',
  'active dry yeast',
  'instant yeast',
  'bakers yeast',
  'yeast',
  // Live cultures
  'live and active probiotic',   // before 'live and active cultures'
  'probiotic',                   // bare form
  'live active cultures',
  'live active',                 // bare form (without 'cultures' suffix)
  'live cultures',
  'active cultures',
  'cultures',
  // Enzymes
  'non-animal enzymes',
  'microbial enzymes',
  'natural enzymes',
  'enzymes',
  'amylase',
  // Baking agents
  'leavening [baking soda and/or calcium phosphate', // specific compound leavening form
  'leavening',
  // Culture (singular — 'cultures' plural already above)
  'culture',
  // ── Lactase / lactic acid ──
  'lactase enzyme',                       // before 'lactase'
  'lactase',
  'lactic acid starter culture',
  // ── Probiotic / yogurt cultures ──
  'l. paracasei and l. rhamnosus',        // compound strain designation
  'l.paracasei and l. rhamnosus',         // no-space variant
  'lactis dn 173-010/cncm 1-2494',        // specific Activia strain
  'lactobacillus',                         // bare genus (all species already above)
  'lactobacillus delbrueckii subsp. bulgaricus',
  'lactobacillus delbrueckii subsp. lactis',
  'lactobacillus acidophilus',
  'lactobacillus bulgaricus',
  'lactobacillus paracasei',
  'lactobacillus casei',
  'lactococcus lactis',
  'streptococcus thermophilus',
  'bifidobacterium longum',
  'bifidobacterium bifidum',
  'bifidobacterium lactis',
  'bifidobacterium lactics',      // labeling variant/typo of 'bifidobacterium lactis'
  'active bacterial cultures',
  'live and active cultures',
  'microbial rennet',
  'vegetable rennet',
  'l. bulgaricus',
  'l. acidophilus',
  'l. paracasei',
  's. thermophilus',
  'l. casei',
  'l. rhamnosus',
  'bifidus',
  'b. lactis',
  'rennet',
  'pectin',
];

/**
 * Dairy-derived ingredient triggers for conventional dairy detection.
 * No bare 'milk', 'cream', or 'butter' — avoids almond milk, cream of
 * tartar, and peanut butter false positives.
 * matchesWholePhrase() is used for word-boundary-aware matching.
 */
const MILK_DERIVED_INGREDIENTS = [
  'whole milk',
  'nonfat milk',
  'skim milk',
  'low-fat milk',
  'grade a grassfed reduced fat organic milk', // longest first
  'grade a pasteurized skim milk',             // before 'pasteurized milk', 'skim milk'
  'imported greek yogurt',                     // before 'yogurt'
  'cultured pasteurized milk',                 // before 'pasteurized milk', 'cultured milk'
  'cultured lowfat milk',                      // before 'cultured milk', 'lowfat milk'
  'cultured milk',                             // before bare triggers
  'pasteurized milk',
  'reduced fat milk',
  'nonfat dry milk',            // before 'nonfat milk'
  'milk powder',
  'skim milk powder',
  'whole milk powder',
  'nonfat milk powder',
  'milk solids',
  'nonfat milk solids',
  'made from milk',                                 // generic milk-based descriptor
  'milk [whole & skim',                             // bracket notation on some labels
  'milk chocolate',                                 // contains milk solids
  'milk protein blend',                             // before 'milk protein concentrate'
  'milk protein concentrate',
  'milk protein isolate',
  'milkfat',
  'heavy cream',
  'light cream',
  'sour cream',
  'whipping cream',
  'half & half',             // before 'half and half' (ampersand variant)
  'half and half',
  'unsalted butter',
  'salted butter',
  'cultured butter',
  'butter powder',
  'butter oil',
  'fontina cheese',          // before 'cheese' (length sort)
  'cheese',
  'mild cheddar cheese',                            // before 'cheddar'
  'cheddar',
  'mozzarella white cheddar cheese blend',          // longest (before shorter mozzarella forms)
  'low moisture part skim mozzarella cheese',       // before 'low moisture mozzarella cheese'
  'low moisture mozzarella cheese',                 // before 'mozzarella cheese'
  'mozzarella cheese',                              // before bare 'mozzarella'
  'mozzarella',
  'parmesan',
  'cream cheese',
  'cottage cheese',
  'modified whey',          // before bare 'whey'
  'whey',
  'whey protein concentrate',
  'whey protein isolate',
  'whey powder',
  'sweet whey',
  'sodium caseinate',
  'calcium caseinate',
  'caseins',              // before 'casein' (length sort)
  'casein',
  'lactose',
  'lactalbumin',
  'lactoglobulin',
  'lowfat greek yogurt',    // before 'yogurt'
  'yogurt',
  'kefir',
  'buttermilk',
  'evaporated milk',
  'condensed milk',
];

/**
 * Animal-derived gelatin triggers for conventional meat detection.
 * Gelatin is rendered from animal bones/hides; signals conventional supply chain
 * when no organic certification is present.
 * matchesWholePhrase() is used for word-boundary-aware matching.
 */
const MEAT_DERIVED_INGREDIENTS = [
  'beef gelatin',            // before 'gelatin' (length sort)
  'pork gelatin',            // before 'gelatin'
  'kosher gelatin',          // before 'gelatin'
  'gelatin',
];

/**
 * Returns true if the ingredient string contains any entry from MEAT_DERIVED_INGREDIENTS.
 * @param {string} ingredients — lowercased, masked ingredient string
 * @returns {boolean}
 */
function containsMeatDerived(ingredients) {
  return MEAT_DERIVED_INGREDIENTS.some(trigger => matchesWholePhrase(ingredients, trigger));
}

/**
 * Terrestrial meat ingredient triggers for is_meat corroboration — a second,
 * independent signal alongside OFF categories_tags (see isMeatProduct() in
 * pages/api/scan.js). Added to close false negatives where OFF category data
 * is missing, uses only modern canonical parent tags (e.g.
 * "en:meats-and-their-products" instead of the specific "en:beef"), or files
 * a product under an unrelated branch entirely (e.g. beef burgers under
 * "en:sandwiches"). matchesWholePhrase() provides word-boundary-aware
 * matching; isInFlavorOrStyleContext() (below) suppresses matches inside
 * flavor/style/imitation wording so plant-based products using "natural beef
 * flavor" or "chicken-style seasoning" don't false-positive.
 *
 * Deliberately scoped to terrestrial meat only — seafood and game meat are
 * out of scope for this pass, since they interact with isSeafoodProduct()/
 * isGameMeatProduct() and the wild-caught/no-cert-required tree branches,
 * which need their own routing signal, not just isMeat. Eggs are excluded —
 * CONVENTIONAL_EGGS/EGG_DERIVED_INGREDIENTS already own egg detection.
 */
const MEAT_INGREDIENT_TERMS = [
  'ground beef',
  'beef broth',
  'beef stock',
  'beef fat',
  'beef tallow',
  'corned beef',
  'beef',
  'tallow',
  'ground pork',
  'pork fat',
  'lard',
  'pork',
  'chicken breast',
  'chicken thigh',
  'chicken fat',
  'chicken stock',
  'chicken broth',
  'ground chicken',
  'chicken',
  'turkey breast',
  'ground turkey',
  'turkey',
  'lamb',
  'veal',
  'bacon',
  'ham',
  'salami',
  'pepperoni',
  'prosciutto',
  'chorizo',
  'pastrami',
  'bratwurst',
  'kielbasa',
  'hot dog',
  'sausage',
  'deli meat',
  'cold cuts',
  'luncheon meat',
];

/**
 * Returns true if the match at [index, end) is naming a flavor, style, or
 * imitation product rather than an actual meat ingredient — e.g. "natural
 * beef flavor", "chicken-style seasoning", "imitation bacon bits". Modeled
 * on isInFreeOrNonContext() below.
 *
 * @param {string} text  - Full lowercased ingredient string.
 * @param {number} index - Start position of the matched trigger.
 * @param {number} end   - End position of the matched trigger.
 * @returns {boolean}
 */
function isInFlavorOrStyleContext(text, index, end) {
  const after  = text.slice(end, end + 12);
  const before = text.slice(Math.max(0, index - 12), index);
  return (
    /^[\s-]*(flavor|flavored|flavoring|style)\b/.test(after) ||
    /(imitation|artificial|vegan|meatless|plant-based|faux)[\s-]*$/.test(before)
  );
}

/**
 * Returns true if the ingredient string contains any entry from
 * MEAT_INGREDIENT_TERMS, using word-boundary-aware matching with the
 * flavor/style guard applied.
 * @param {string} ingredients — lowercased ingredient string
 * @returns {boolean}
 */
function containsMeatIngredient(ingredients) {
  return MEAT_INGREDIENT_TERMS.some(trigger =>
    matchesWholePhrase(ingredients, trigger, isInFlavorOrStyleContext)
  );
}

/**
 * Egg-derived ingredient triggers for conventional egg detection.
 * Includes bare 'egg'/'eggs' — matchesWholePhrase() prevents 'eggplant'
 * false positive.
 */
/**
 * Trigger list for conventional egg detection.
 * Scanned in the rules-engine loop with isPrecededByOrganic() clearance so
 * that "organic eggs" in the ingredient text does not trigger the flag.
 * Sorted longest-first for greedy matching in findMatches().
 */
const CONVENTIONAL_EGGS = [
  'pasteurized eggs',
  'pasteurized egg',
  'powdered eggs',
  'powdered egg',
  'liquid eggs',
  'liquid egg',
  'dried eggs',
  'dried egg',
  'whole eggs',
  'whole egg',
  'egg whites',
  'egg white',
  'egg yolks',
  'egg yolk',
  'eggs',
  'egg',
];

const EGG_DERIVED_INGREDIENTS = [
  'egg whites',
  'egg white',
  'egg yolks',
  'egg yolk',
  'dried egg',
  'powdered egg',
  'egg powder',
  'liquid egg',
  'egg albumin',
  'albumin',
  'whole eggs',
  'whole egg',
  'eggs',
  'egg',
];

/**
 * Word-boundary-aware substring match. Checks that `trigger` appears in
 * `text` with a non-letter character (or string boundary) immediately
 * before and after the match. Prevents false positives like 'eggplant'
 * matching 'egg', or 'cheesecake' matching 'cheese'.
 *
 * @param {string} text    — lowercased ingredient string
 * @param {string} trigger — exact phrase to find
 * @param {(text: string, index: number, end: number) => boolean} [guard] —
 *   optional context guard; when it returns true for a boundary-valid
 *   match, that match is skipped and the search continues. Existing
 *   callers (milk/egg/gelatin) omit this and are unaffected.
 * @returns {boolean}
 */
function matchesWholePhrase(text, trigger, guard) {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(trigger, searchFrom);
    if (idx === -1) return false;
    const charBefore = idx > 0 ? text[idx - 1] : null;
    const charAfter  = idx + trigger.length < text.length ? text[idx + trigger.length] : null;
    const prevOk = charBefore === null || /[\s,/()\-]/.test(charBefore);
    const nextOk = charAfter  === null || /[\s,/()\-]/.test(charAfter);
    if (prevOk && nextOk) {
      if (!guard || !guard(text, idx, idx + trigger.length)) return true;
    }
    searchFrom = idx + 1;
  }
  return false;
}

/**
 * Returns true if the (masked) ingredient string contains any milk-derived
 * ingredient trigger, using word-boundary-aware matching.
 * @param {string} ingredients — lowercased, pre-masked ingredient string
 * @returns {boolean}
 */
function containsMilkDerived(ingredients) {
  return MILK_DERIVED_INGREDIENTS.some(trigger => matchesWholePhrase(ingredients, trigger));
}

/**
 * Returns true if the (masked) ingredient string contains any egg-derived
 * ingredient trigger, using word-boundary-aware matching.
 * @param {string} ingredients — lowercased, pre-masked ingredient string
 * @returns {boolean}
 */
function containsEggDerived(ingredients) {
  return EGG_DERIVED_INGREDIENTS.some(trigger => matchesWholePhrase(ingredients, trigger));
}

/**
 * Flat list of every trigger string across all categories.
 * Used by the unverified-ingredient detector to check whether a parsed
 * ingredient token is "known" to the engine (flagged or not).
 */
const ALL_TRIGGERS = [
  ...TRANS_FATS,
  ...SEED_OILS,
  ...CONVENTIONAL_CROPS,
  ...CONVENTIONAL_EGGS,
  ...GLYPHOSATE_HEAVY,
  ...BIOENGINEERING_TERMS,
  ...NATURAL_FLAVORS,
  ...SYNTHETIC_ADDITIVES,
  ...GLUTEN_GRAINS,
  ...FORTIFIED_VITAMINS,   // prevents vitamin/mineral names from appearing in unverified
];

/**
 * Categories that downgrade from 'reject' → 'caution' for Level 1 users.
 * Trans fats and SYNTHETIC_ADDITIVES are intentionally excluded — they stay
 * red at both levels.
 */
const LEVEL_1_YELLOW_CATEGORIES = new Set([
  'seed_oils',
  'conventional_crops',
  'conventional_eggs',
  'glyphosate_heavy',
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
  ...CONVENTIONAL_EGGS,
  ...GLYPHOSATE_HEAVY,
  ...BIOENGINEERING_TERMS,
  ...NATURAL_FLAVORS,
]);

/**
 * Whole-food tokens suppressed from unverifiedIngredients at Level 2.
 * Narrower than Level 1 — only truly unambiguous whole-food tokens.
 */
const WHOLE_FOOD_TOKENS_L2 = new Set([
  'water',
  'sea salt',
  'himalayan salt',
  'himalayan pink salt',
  'celtic sea salt',
  'baking soda',
  'sodium bicarbonate',
  'almonds',
  'banana',
  'avocado oil',
  'arrowroot powder',
  'basil',
  'beef',
  'broccoli',
  'butter',
  'buttermilk',
  'carrots',
  'carrot powder',
  'cassava flour',
  'cassava starch',
  'cassava blend',
  'celery',
  'celery powder',
  'chia seeds',
  'chickpeas',
  'chicken fat',
  'chicken stock',
  'chile pepper',
  'cocoa butter',
  'cocoa mass',
  'coconut flour',
  'coconut oil',
  'coconuts',
  'cranberries',
  'cream',
  'cultured nonfat milk',
  'dehydrated garlic',
  'dehydrated onions',
  'distilled vinegar',
  'elderberry juice concentrate',
  'apple juice concentrate',
  'candied walnuts',
  "cow's milk",
  'feta cheese',
  'flax',
  'garlic',
  'garlic powder',
  'heavy cream',
  'milk',
  'milk fat',
  'milk protein concentrate',
  'milkfat',
  'molasses',
  'mustard seed',
  'nonfat milk',
  'onion',
  'onion powder',
  'onions',
  'oregano',
  'paprika',
  'parmesan cheese',
  'parsley',
  "part-skim cow's milk",
  'pasteurized milk',
  'pea starch',
  'peanuts',
  'pear and raspberry juice concentrates',
  'pork',
  'potato flour',
  'potatoes',
  'pumpkin',
  'radicchio',
  'red and green bell pepper powder',
  'red and green bell peppers',
  'red and green chard',
  'red and green leaf',
  'red and green oak',
  'red and green tango',
  'red bell pepper',
  'red pepper',
  'red wine vinegar',
  'romano cheese',
  'rosemary',
  'rosemary extract',
  'sage',
  'salt',
  'skim milk',
  'skimmed milk powder',
  'spring mix',
  'sweetened dried cranberries',
  'tapioca',
  'tapioca syrup',
  'tatsoi',
  'tomato',
  'tomato powder',
  'tomato puree',
  'turmeric',
  'vinegar',
  'walnuts',
  'white pepper',
  'yeast',
]);

/**
 * Ingredients the team has manually reviewed and confirmed as clean whole
 * foods. Tokens matching this list are suppressed from the unverifiedIngredients
 * output (both levels) so they never appear in the UI unverified card and never
 * get written to the Supabase review queue.
 *
 * DISPLAY-ONLY — does not affect engine logic, flag detection, or verdicts.
 * If any of these ingredients also appear in a trigger list they will still be
 * flagged normally; this filter only runs on tokens that reached the unverified
 * pass (i.e. tokens that did NOT trigger any flag).
 *
 * When adding new entries, run in Supabase SQL editor to clean up stale rows:
 *   DELETE FROM unverified_ingredients WHERE ingredient = 'ingredient_name';
 */
const REVIEWED_CLEAN_INGREDIENTS = new Set([
  'almond flour',
  'arrowroot',
  'arrowroot starch',
  'arrowroot flour',
  'cassava flour',
  'tapioca starch',
  'tapioca flour',
  'coconut flour',
  'tigernut flour',
  'coconut sugar',
  'maple syrup',
  'honey',
  'vanilla extract',
  'vanilla bean',
  'cocoa powder',
  'cacao powder',
  'cacao nibs',
  'shea butter',
  'cocoa butter',
  'sunflower seeds',
  'pumpkin seeds',
  'chia seeds',
  'hemp seeds',
  'flax seeds',
  'sesame seeds',
  'almonds',
  'cashews',
  'walnuts',
  'pecans',
  'pistachios',
  'macadamia nuts',
  'hazelnuts',
  'brazil nuts',
  'coconut',
  'coconut milk',
  'coconut cream',
  'coconut oil',
  'avocado oil',
  'olive oil',
  'apple cider vinegar',
  'lemon juice',
  'lime juice',
  'orange juice',
  'turmeric',
  'cinnamon',
  'ginger',
  'garlic',
  'onion',
  'black pepper',
  'cumin',
  'paprika',
  'oregano',
  'basil',
  'thyme',
  'rosemary',
  'cayenne',
  'chili pepper',
  'nutritional yeast',
  'cream of tartar',
  'psyllium husk',
  'gelatin',
  'agar',
  'carob',
  // ── Batch 4 additions (June 2026) ────────────────────────────────────────
  'first cold pressed extra virgin olive oil',
  'fish oil',
  'freeze-dried berry blend',
  'fresh dill',
  'fresh garlic',
  'fresh organic banana',
  'fresh roasted usa grown peanuts',
  'fruit pectin',
  'garlic and onion powder',
  'garlic seasoning',
  'ginger extract',
  'golden raisins',
  'grape',
  'grapefruit juice concentrate',
  'green bell pepper powder',
  'green cabbage',
  'green onions',
  'green tea extract 0.1%',
  'ground nutmeg',
  'gum acacia',
  'gum arabic',
  'hemp protein',
  'hemp protein powder',
  'himalayan pink sea salt',
  'italian tomatoes',
  'italian whole peeled tomatoes',
  'jalapeno lime seasoning',
  'jalapeno peppers',
  'jasmine tea extract',
  'koji seed',
  'koji spores',
  'korean red pepper',
  'kosher salt',
  'lactase',
  'lactase enzyme',
  'lactic acid starter culture',
  'lactobacillus',
  // ── Batch 2 & 3 additions (June 2026) ────────────────────────────────────
  // Herbs & spices
  'sage',
  'dill',
  'parsley',
  'cilantro',
  'coriander',
  'fennel',
  'cloves',
  'nutmeg',
  'cardamom',
  'allspice',
  'bay leaves',
  'bay leaf',
  'marjoram',
  'tarragon',
  'mint',
  'spearmint',
  'peppermint',
  // Nuts & nut butters
  'almond butter',
  'sunflower seed butter',
  'sunflower butter',
  'tahini',
  'pine nuts',
  // Fruits & berries
  'blueberries',
  'strawberries',
  'raspberries',
  'blackberries',
  'cherries',
  'apricots',
  'dates',
  'date',                  // singular form
  'figs',
  'raisins',
  'cranberries',
  'pomegranate',
  'mango',
  'pineapple',
  'banana',
  'apple',
  'pear',
  // Vegetables
  'spinach',
  'kale',
  'sweet potato',
  'broccoli',
  'carrot',
  'carrots',
  'beet',
  'beets',
  'celery',
  // Proteins & legumes
  'quinoa',
  'amaranth',
  'teff',
  // Natural sweeteners
  'date sugar',
  'date syrup',
  'raw honey',
  'agave nectar',
  'agave syrup',
  // Oils & fats
  'ghee',
  // Other clean ingredients
  'acacia fiber',
  'apple cider',
  'lemon zest',
  'lime zest',
  'orange zest',
  'sea vegetables',
  'dulse',
  'nori',
  'kelp',
  // ── Batch 5 additions (June 2026) ────────────────────────────────────────
  'lemon juice concentrate',
  'lemongrass puree',
  'lime',
  'lime juice concentrate',
  'lime juice powder',
  'lime oil',
  'locust bean gum',
  'maca root powder',
  'magnesium oxide',
  'magnesium sulfate potassium bicarbonate',
  'mandarins',
  'molasses powder',
  'monk fruit extract',
  'mushroom extract',
  'mustard flour',
  'mustard greens',
  'natural artesian water',
  'natural maple syrup',
  'nutmeg oil',
  'oncorhynchus gorbuscha',            // scientific name for pink salmon
  'mung bean protein',
  // ── Batch 6 additions (July 2026) ────────────────────────────────────────
  'coconut flakes',
  'banana puree',
  'bananas',
  'sprouted sunflower seeds',
  'sprouted pumpkin seeds',
  'dried plums',
  'prunes',
  'virgin coconut oil',
  'maca powder',
  'ground cinnamon',
  // ── Batch 7 additions (July 2026) ────────────────────────────────────────
  // 'chickpea' (singular) and 'chickpeas' (plural) are NOT added here —
  // both are GLYPHOSATE_HEAVY triggers (edible beans section). See the
  // "chickpea singular/plural correction" changelog entry in CLAUDE.md.
  'monk fruit',
  'cocoa',
  // ── Batch 9 additions (July 2026) ────────────────────────────────────────
  // 'chocolate chips' intentionally NOT added — unlike a raw whole food, it's
  // a manufactured/compound product whose composition varies by brand and
  // near-universally includes added sugar (often soy lecithin, milk solids)
  // that are undisclosed when a label lists it without a parenthetical
  // breakdown. Whitelisting the container term would mask those undisclosed
  // ingredients. When a label DOES disclose the breakdown in a parenthetical
  // (e.g. "chocolate chips (unsweetened chocolate, sugar, cocoa butter)"),
  // the sub-ingredients are already checked individually — no fix needed.
  'unsweetened chocolate',
]);

/**
 * Structural label phrases that parsing produces as tokens but that are not
 * ingredient names. Filtered at both user levels.
 */
const ARTIFACT_PHRASES = new Set([
  'contains', 'less than', 'made with', 'prepared with',
  'and/or', 'or less', 'or fewer',
  'and less than 2% of salt',
  'and less than 2% of the following',
  'and less than 2% silicon dioxide',
  'contains 2% or less of',
  'contains 2% or less of salt',
  'contains 2% or less of water',
  'contains less than 1% of',
  'contains less than 2% of salt',
  'contains milk',
  'and yeast extract. contains milk ingredients',
  'to preserve quality contains milk',
  'distributéd by',
  'bentonville',
  'ingredients may vary bý season',
  'less than 1% of',
  'less than 2% of',
  'less than 2% of salt',
  'made from corn',
  'milk and soy',
  'may contain tree nuts',
  'nj 07936 usa made in mexico hecho en méxico',
  'inc',
  'frito-lay',
  'granular and blue cheese',
  'garlic powder. contains milk ingredients',
  'folic acid. *dried',
  'medium chain triglycerides. contains',
  'natural butter flavor',
  'mononitrato de tiamina',
  'ácid0 fólico',
  'himalayan salt contains coconut',
  'corn and soya beans',
  // ── Percentage / quantity preambles ──────────────────────────────────────
  // These appear as structural notes in ingredient lists ("Contains 2% or less
  // of: X, Y") and become standalone tokens after colon-splitting. They are
  // not ingredients and must never surface in the unverified queue.
  'contains less than 2% of',
  'contains 2% or less',
  'contains 2% or less of the following',
  'contains 2% or less of each of the following',
  'contains 1% or less of',
  'contains one or more of the following',
  'added to preserve freshness',
  'to preserve freshness',
  'and less than 2% of',
]);

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Strips legal/allergen-advisory phrases from an ingredient string — these
 * are disclaimers, not ingredients, and must never feed trigger matching or
 * the unverified-ingredients token derivation. Both pipelines call this same
 * function so they can never drift out of sync with each other again.
 *
 * Each phrase is stripped through its terminating period or comma. "contains:"
 * also strips through end-of-string, since labels frequently print a trailing
 * allergen statement with no closing punctuation at all (e.g. "...contains:
 * tree nuts (coconut),​" with a trailing comma, or no punctuation once
 * that comma is itself stripped) — without this, "contains:"-led disclosures
 * that a label happens to end on are left completely unstripped, leaking
 * fragments like "tree nuts" into the unverified queue and, since the same
 * unstripped text also feeds trigger matching, letting a disclosed allergen
 * ingredient name accidentally trip a real flag.
 *
 * Also strips a trailing sentence-fragment certification note — e.g.
 * "...(probiotic). Organic." — anchored to the very end of the string and
 * requiring a literal period immediately before the term. Ingredients are
 * comma-separated, never period-separated, so a period directly followed by
 * a bare certification word at the tail of the string is always a label's
 * closing sentence ("Organic.", "Certified Organic.", "USDA Organic."), not
 * an ingredient — parseIngredientTokens() has no leading-punctuation strip,
 * so this fragment otherwise survives as a malformed ". Organic" token in
 * unverifiedIngredients. Anchoring to end-of-string and requiring the
 * preceding period is deliberate: it leaves ordinary mid-string periods
 * (decimals, abbreviations) and comma-separated ingredients that merely
 * start with "Organic" (e.g. "salt, pepper, Organic Coconut Oil.") untouched.
 *
 * Also strips two boilerplate patterns unrelated to allergens but equally
 * not-an-ingredient: (1) "Manufactured by: [company] [address]" — company
 * attribution, stripped through the next newline rather than a period or
 * comma. A printed address routinely contains its own abbreviation periods
 * ("N.E.", "3rd.") that would terminate a period-anchored match early and
 * leave the rest of the address behind, and its own internal commas
 * ("Miami, FL 33138") that would do the same to a comma-anchored match —
 * newline is the only reliable boundary for this one. Deliberately has NO
 * end-of-string fallback (unlike "contains:"'s three-variant pattern): if
 * "Manufactured by:" is never followed by a newline, it's left unstripped
 * rather than risk swallowing real ingredient text that happens to follow
 * it on the same line with no other separator. (2) "This product is made
 * in a [...] facility [...]" — a facility disclaimer close in spirit to the
 * existing "produced in a facility" pattern above, but distinct exact
 * wording that pattern doesn't match, added as its own literal-phrase
 * anchor following the same period-terminated style.
 *
 * Also strips two forms of BARE (no-colon) "contains" declaration — a
 * confirmed false-flag source, not just a display-cosmetic one. Unlike
 * "contains:" (colon), a bare "Contains wheat." has no dedicated pattern
 * above, so the allergen name survives into both the unverified-token
 * queue AND trigger matching — confirmed to falsely trigger reject-severity
 * glyphosate_heavy ("wheat"/"barley"/"rye"/"oats"), conventional_crops
 * ("soybean"/"soybeans"), and conventional_eggs ("egg"/"eggs") flags on
 * products with no such ingredient anywhere else in the list, flipping the
 * verdict red from an advisory sentence alone.
 *
 * These two bare-contains patterns are order-dependent and must run in
 * this sequence:
 *   1. "contains less than X% of [the following:] ..." — a QUALIFIER
 *      phrase introducing a real minor-ingredient list (spices, gums,
 *      preservatives), not an allergen declaration. Strips ONLY the
 *      qualifier phrase itself ("contains less than X% of", plus "the
 *      following:" when present) — everything after it is a real
 *      ingredient list and must continue through normal tokenization and
 *      trigger matching. Confirmed via two real-world label shapes that
 *      BOTH must be handled: "...of the following: soy lecithin, xanthan
 *      gum, natural flavors." (colon form) and, just as common, "...of
 *      citric acid, sodium phosphate, ... soybean oil, yellow 5, yellow
 *      6)." (no "the following", no colon — confirmed via the existing
 *      Kraft Mac & Cheese fixture already in this test suite). An earlier
 *      version of this pattern only matched the colon form; the no-colon
 *      form fell through to pattern 2 below, whose greedy `[^.]*` then
 *      swallowed the entire real ingredient list up to the next period —
 *      silently deleting citric acid / soybean oil / yellow 5 / yellow 6
 *      from trigger matching entirely. Caught by the existing test suite,
 *      not a hypothetical.
 *   2. Bare "Contains <allergen list>." — runs AFTER (1), so by the time
 *      this broader pattern runs, a genuine qualifier clause has already
 *      lost its "contains ... % of ..." prefix and can't be mistaken for
 *      a plain declaration. Uses the same `[^.]*\.` style as the rest of
 *      this function, plus an end-of-string fallback mirroring
 *      "contains:"'s own EOS variant. Excludes (negative lookahead) any
 *      match that would start a bioengineering disclosure —
 *      "contains a bioengineered food ingredient" is itself a literal
 *      BIOENGINEERING_TERMS trigger phrase (see that array); an earlier
 *      version of this pattern had no such exclusion and silently deleted
 *      that mandatory disclosure before BIOENGINEERING_TERMS ever saw it,
 *      caught by multiple existing bioengineering-detection tests.
 *
 * @param {string} str - Raw ingredient list text (original casing preserved).
 * @returns {string} Same text with advisory phrases removed.
 */
function stripAllergenAdvisory(str) {
  return str
    .replace(/may contain[^.]*\./gi, '')
    .replace(/may contain[^,]*,/gi, '')
    .replace(/contains:[^.]*\./gi, '')
    .replace(/contains:[^,]*,/gi, '')
    .replace(/contains:[^.,]*$/gi, '')
    .replace(/manufactured on a line[^.]*\./gi, '')
    .replace(/produced in a facility[^.]*\./gi, '')
    .replace(/manufactured by:?[^\n]*\n/gi, '')
    .replace(/this product is made in a[^.]*\./gi, '')
    .replace(/\.\s*(?:usda\s+)?(?:certified\s+)?organic\.?\s*$/gi, '')
    // Bare "contains" pattern 1 of 2 — qualifier phrase only, MUST run
    // before pattern 2. "the following:" is optional so both the colon
    // and no-colon real-world label shapes are covered by one pattern.
    .replace(/contains\s+less\s+than\s+[\d.]+%\s+of\s+(?:the\s+following:\s*)?/gi, '')
    // Bare "contains" pattern 2 of 2 — the false-flag source. Two guards:
    // (1) negative lookahead excludes bioengineering disclosures
    // ("contains a bioengineered food ingredient", "contains genetically
    // modified/engineered X", "contains gmo X") — those are a required
    // trigger phrase, not an allergen declaration, and must reach
    // BIOENGINEERING_TERMS matching untouched. (2) negative lookbehind
    // `(?<!^\s*)` excludes "contains" when it opens the string — a real
    // allergen/qualifier disclosure always trails the actual ingredient
    // list, never opens it; this also protects test fixtures throughout
    // this suite that use "contains <additive>" as a whole, standalone
    // ingredientText string to name the additive being tested (e.g. the
    // Texas SB 25 disclosure-style tests in describe block 13, and the
    // generic-additive tests in blocks 14/17) — those are real ingredient
    // declarations by construction, not throwaway advisory text.
    .replace(/(?<!^\s*)\bcontains\s+(?!(?:a\s+)?bioengineered|genetically\s+(?:engineered|modified)|gmo\b)[^.]*\./gi, '')
    .replace(/(?<!^\s*)\bcontains\s+(?!(?:a\s+)?bioengineered|genetically\s+(?:engineered|modified)|gmo\b)[^.,]*$/gi, '');
}

/**
 * Strips a leading dietary/certification-claim label prefix in the narrow
 * "(WORD):" shape at the very start of the ingredient string — e.g.
 * "(VEGAN): organic pinto beans, water, sea salt." Confirmed real false
 * positive: "VEGAN" surfacing as its own unverifiedIngredients entry.
 *
 * Deliberately curated to a short, known list of claim words rather than a
 * blanket "any leading parenthetical is not an ingredient" rule — a generic
 * rule risks swallowing a genuine ingredient that happens to open the list
 * in parentheses. `^` anchors to the true start of the string, so a later,
 * unrelated parenthetical mid-list is never touched by this function.
 *
 * @param {string} str - Ingredient list text (original casing preserved).
 * @returns {string} Same text with a leading cert-claim prefix removed.
 */
function stripCertPrefixLabel(str) {
  return str.replace(
    /^\(\s*(vegan|kosher|halal|gluten-free|dairy-free|non-gmo|plant-based)\s*\)\s*:?\s*/i,
    ''
  );
}

/**
 * Strips parenthetical purpose-notes — e.g. "vegetable juice (for color)",
 * "natural extract (for freshness)", "ascorbic acid (to preserve texture)"
 * — that explain WHY an ingredient is present rather than disclosing WHAT
 * it is. These are not ingredients and must never become their own token.
 *
 * Distinguishes a purpose-note parenthetical from a real sub-ingredient
 * parenthetical (e.g. "chocolate chips (unsweetened chocolate, sugar,
 * cocoa butter)") structurally: a purpose note's content always starts
 * with the preposition "for" or "to" immediately after the opening paren
 * (whitespace-only in between), whereas a sub-ingredient list starts with
 * an ingredient noun. No real ingredient name begins with a bare "for"/"to"
 * followed by a word boundary, so this is a safe, narrow signal — it does
 * not key on the presence/absence of internal commas, since a purpose note
 * can legitimately list more than one reason (e.g. "(to preserve color and
 * freshness)") without becoming a sub-ingredient list.
 *
 * Called before parseIngredientTokens() flattens parentheses, so purpose
 * notes are removed entirely rather than surviving as their own comma-
 * separated token once the parens are converted to commas.
 *
 * @param {string} str - Ingredient list text (original casing preserved).
 * @returns {string} Same text with purpose-note parentheticals removed.
 */
function stripPurposeNoteParentheticals(str) {
  return str
    .replace(/\(\s*(?:for|to)\b[^()]*\)/gi, '')
    // Collapse any double space left behind when a purpose note is removed
    // from between two words (e.g. "high oleic (for flavor) sunflower oil"),
    // so an exact-substring trigger phrase spanning that gap still matches.
    .replace(/ {2,}/g, ' ');
}

/**
 * Parse a raw ingredient list string into discrete ingredient tokens.
 *
 * Strategy:
 *   1. Replace parentheses with commas so sub-ingredient lists (e.g.
 *      "cheese (milk, salt)") are flattened into the main list.
 *   2. Treat colons as separators ("contains 2% or less of: X, Y").
 *   3. Split on commas and semicolons.
 *   4. Strip leading percentages ("2% salt" → "salt"), a leading conjunction
 *      ("and " — from Oxford-comma list endings like "X, Y, and Z"), and
 *      trailing punctuation.
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
      .replace(/^\*+/, '')               // strip leading * (organic/disclaimer asterisks)
      // Strip a leading Oxford-comma conjunction ("...X, and Y" → last token
      // is "and Y"). Whitespace-required after "and" so this can never match
      // a real ingredient name that merely starts with the letters "and"
      // (e.g. "andouille sausage" has no space between "and" and "ouille").
      .replace(/^and\s+/i, '')
      .replace(/^\d+(\.\d+)?%?\s+/, '') // strip leading "2% " / "0.5% "
      .replace(/[.*[\])]+$/g, '')        // strip trailing . * [ ] )
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
 * Returns true if the word "organic" appears in the ingredient segment
 * containing the matched trigger. Uses ingredient-boundary detection so
 * multi-word compound names like "organic unrefined coconut sugar" are
 * correctly cleared regardless of how many words precede the trigger.
 *
 * Also handles the edge case "organic, corn starch" (organic as a
 * standalone comma-separated label immediately before the ingredient):
 * if the current segment has no "organic", the immediately preceding
 * segment is checked — but only when it consists solely of "organic".
 *
 * @param {string} text  - Full lowercased ingredient string.
 * @param {number} index - Start position of the matched ingredient.
 */
function isPrecededByOrganic(text, index) {
  const lastComma = text.lastIndexOf(',', index - 1);
  const segmentStart = lastComma === -1 ? 0 : lastComma + 1;
  const segment = text.slice(segmentStart, index);

  // Primary check: "organic" anywhere in the same comma-delimited segment
  if (/(?:^|[\s,(])organic[\s,]/.test(segment)) return true;

  // Edge-case check: "organic, <trigger>" — organic is the entire preceding entry
  if (lastComma !== -1) {
    const prevComma = text.lastIndexOf(',', lastComma - 1);
    const prevSegmentStart = prevComma === -1 ? 0 : prevComma + 1;
    const prevSegment = text.slice(prevSegmentStart, lastComma).trim();
    if (prevSegment === 'organic') return true;
  }

  return false;
}

/**
 * Returns true if the grain at `index` is a source note rather than a
 * standalone ingredient — e.g. "maltodextrin (made from corn)".
 * Used to prevent GLUTEN_GRAINS from flagging parenthetical disclosures.
 *
 * @param {string} text  - Full lowercased ingredient string.
 * @param {number} index - Start position of the matched grain.
 */
function isPrecededBySourceNote(text, index) {
  const before = text.slice(Math.max(0, index - 30), index);
  return /(?:from|of|made from|derived from)\s*$/.test(before);
}

/**
 * Returns true if the matched grain word is immediately followed by " oil",
 * indicating a refined oil (e.g. "corn oil", "rice oil") rather than the
 * whole grain. Refined oils do not carry meaningful prolamin protein content
 * and are already covered by SEED_OILS; they should not generate a separate
 * GLUTEN_GRAINS flag.
 *
 * @param {string} text          - Full lowercased ingredient string.
 * @param {number} index         - Start position of the matched trigger.
 * @param {number} triggerLength - Byte length of the matched trigger string.
 */
function isOilDerivative(text, index, triggerLength) {
  const after = text.slice(index + triggerLength);
  return /^\s+oil\b/.test(after);
}

/**
 * Returns true if the matched trigger sits inside a "-free" claim (e.g.
 * "egg-free", "canola-free", "sugar-free") or a "non-X" negative
 * declaration (e.g. "non-GMO"). Both contexts assert the ABSENCE of the
 * trigger ingredient — the product doesn't contain it, it's advertising
 * that it doesn't — which inverts what a bare substring match would
 * otherwise imply.
 *
 * Generalizes the guard originally written narrowly for the bare "gmo"
 * trigger (BIOENGINEERING_TERMS) into a single shared helper applied at
 * every bare-word trigger match across the engine, mirroring
 * isPrecededByOrganic()/isPrecededBySourceNote(). Confirmed real false
 * positives this closes: "egg-free" (conventional_eggs), "corn-free" /
 * "wheat-free" / "barley-free" / "rye-free" (gluten_grains,
 * glyphosate_heavy), "canola-free" (seed_oils — an INSTANT_RED_CATEGORIES
 * member), and "sugar-free" (conventional_crops).
 *
 * @param {string} text  - Full lowercased ingredient string.
 * @param {number} index - Start position of the matched trigger.
 * @param {number} end   - End position of the matched trigger (index + trigger.length).
 * @returns {boolean}
 */
function isInFreeOrNonContext(text, index, end) {
  const before = text.slice(Math.max(0, index - 4), index);
  const after  = text.slice(end, end + 5);
  return (
    before === 'non-' ||
    before === 'non ' ||
    text.slice(Math.max(0, index - 3), index) === 'non' ||
    after.startsWith('-free') ||
    after.startsWith(' free')
  );
}

/**
 * Confirmed-legitimate compound words where a bare trigger genuinely is part
 * of a real ingredient name despite being immediately preceded by a letter —
 * e.g. "popcorn" genuinely is corn; the 'p' immediately before the 'corn'
 * match is not a substring-collision false positive. Extend this Set (never
 * the guard logic itself) when a new legitimate compound is confirmed.
 *
 * 'groats' (bare 'oats' inside "groats", e.g. "oat groats") was added after
 * this guard's rollout broke an existing test: GLYPHOSATE_HEAVY has no
 * dedicated 'oat groats'/'groats' trigger of its own, so it relied entirely
 * on bare 'oats' coincidentally matching the tail of "groats" to flag oat
 * groats at all — and oat groats genuinely are oats (hulled whole oat
 * kernels), so that match is correct, not a substring-collision false
 * positive. Note this is a bare-word allowlist entry, not scoped to "oat
 * groats" specifically — an unqualified "Groats" ingredient (rare on real
 * labels; groats are almost always qualified as oat/buckwheat/wheat groats)
 * would also stop flagging glyphosate_heavy under this entry. Acceptable
 * trade-off: "buckwheat groats" and "wheat groats" are unaffected either
 * way, since both have their own longer, more specific GLYPHOSATE_HEAVY
 * triggers that claim the range before bare 'oats' is ever tried.
 */
const TRIGGER_ADJACENCY_ALLOWLIST = new Set([
  'popcorn',
  'groats',
]);

/**
 * Returns true if a bare trigger match is immediately preceded by a letter
 * (i.e. embedded inside a larger word rather than standing alone) and that
 * containing word is not on TRIGGER_ADJACENCY_ALLOWLIST.
 *
 * This is a deliberately strict DEFAULT: any letter-adjacent bare-trigger
 * match is treated as a substring-collision false positive unless the
 * surrounding word is explicitly allowlisted. Replaces the earlier
 * isImmediatelyPrecededByLetter() design, which required hand-confirming
 * and hardcoding one specific collision letter per call site ('g' for
 * oats/"goats", 'a' for corn/"acorn", 'p' for rice/"price") — that approach
 * missed every OTHER collision letter for the same trigger (e.g. 'i' for
 * corn/"unicorn", 'o' for rice/"licorice", 'c' for oats/"coats"), so the bug
 * class kept recurring one hand-found collision at a time. This general
 * check catches all of those automatically, with no per-letter enumeration.
 *
 * @param {string} text  - Full lowercased ingredient string.
 * @param {number} index - Start position of the matched trigger.
 * @param {number} end   - End position of the matched trigger.
 * @returns {boolean}
 */
function isPrecededByLetterUnlessAllowlisted(text, index, end) {
  const charBefore = index > 0 ? text[index - 1] : null;
  if (!charBefore || !/[a-z]/.test(charBefore)) return false;

  // Reconstruct the full contiguous lowercase word containing the match so a
  // confirmed-legitimate compound (e.g. "popcorn") can be recognized rather
  // than blocked.
  let wordStart = index;
  while (wordStart > 0 && /[a-z]/.test(text[wordStart - 1])) wordStart--;
  let wordEnd = end;
  while (wordEnd < text.length && /[a-z]/.test(text[wordEnd])) wordEnd++;
  const word = text.slice(wordStart, wordEnd);

  return !TRIGGER_ADJACENCY_ALLOWLIST.has(word);
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
      // Level 1 uses an inverted approach: assume any token that doesn't look
      // like a chemical or additive is a natural ingredient and skip it.
      // Only surface a token if it matches one of these "chemical" signals:

      // Contains a digit anywhere (e.g. "red 40", "e471", "phosphate 2").
      const hasDigit = /\d/.test(t);

      // Matches an E-number pattern (e.g. "e471", "e1442").
      const isENumber = /\be\d{3,4}\b/i.test(t);

      // More than 4 words — multi-word technical names.
      const wordCount = t.split(/\s+/).length;
      const isTechnicalPhrase = wordCount > 4;

      // Contains a parenthetical — e.g. "calcium disodium (edta)".
      // Note: parseIngredientTokens replaces () with commas, so a surviving
      // parenthesis means it came from within a token after re-assembly.
      const hasParenthetical = t.includes('(') || t.includes(')');

      // Is a known Level-1-yellow trigger (already handled by engine as caution
      // or cleared; not truly unrecognized, but include for explicitness).
      let isKnownL1Trigger = false;
      for (const trigger of LEVEL_1_YELLOW_TRIGGERS) {
        if (t.includes(trigger)) { isKnownL1Trigger = true; break; }
      }

      // Surface only if at least one chemical signal is present.
      if (!hasDigit && !isENumber && !isTechnicalPhrase && !hasParenthetical && !isKnownL1Trigger) {
        return false; // Looks like a natural ingredient — skip at Level 1.
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

  // Normalize label notation before any trigger matching.
  // Step 1: Strip "No. " (FD&C numbering suffix) so "Red No. 40" → "Red 40",
  //   "Yellow No. 5" → "Yellow 5", "Citrus Red No. 2" → "Citrus Red 2".
  //   \b prevents matching "no." inside words (e.g. "Casino."). /gi = global, case-insensitive.
  // Step 2: Strip "#" before dye numbers so "Red #40" → "Red 40",
  //   "C Red #3" → "C Red 3", "Red #3" → "Red 3".
  //   Covers label variants that use a hash sign as an ordinal marker.
  // Strip allergen advisories and purpose-note parentheticals once, up front —
  // shared by trigger matching (`text`, below) and by the unverified-token
  // derivation (`ingredientTextCleaned`, used later at the parseIngredientTokens()
  // call) so the two pipelines can't disagree about what counts as a real
  // ingredient vs. a legal disclaimer or a "why this is here" note.
  const ingredientTextCleaned = stripCertPrefixLabel(stripPurposeNoteParentheticals(stripAllergenAdvisory(String(ingredientText))));

  const text = ingredientTextCleaned
    .replace(/\bno\.\s+/gi, '')
    .replace(/#(\d)/g, '$1')
    .toLowerCase();

  const labels = (Array.isArray(productLabels) ? productLabels : [])
    .map(l => String(l).toLowerCase());

  const hasUsdaOrganic = labels.includes('usda-organic');
  const hasNonGmo      = labels.includes('non-gmo-project-verified');

  /** @type {ReturnType<analyzeIngredients>['flags']} */
  let flags = [];

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

  // ── Priority synthetic additives — must claim before SEED_OILS ──────────
  // "interesterified palm oil" and "interesterified soybean oil" each contain a
  // seed-oil sub-string as a suffix ("palm oil", "soybean oil"). If SEED_OILS runs
  // first it would claim the shorter 8-char sub-span, causing findMatches to skip
  // the 24-char compound trigger due to range overlap. Running these two triggers
  // here (before SEED_OILS) ensures the full compound span is claimed as an
  // 'additives' flag. The main SYNTHETIC_ADDITIVES pass (after NATURAL_FLAVORS)
  // will skip them automatically since those ranges are already in claimedRanges.
  const PRIORITY_ADDITIVES = [
    'interesterified palm oil',
    'interesterified soybean oil',
    'brominated vegetable oil',  // 'vegetable oil' suffix is in SEED_OILS
    'soya lecithin',             // 'lecithin' suffix is in CONVENTIONAL_CROPS
  ];
  for (const { trigger } of matchAndClaim(PRIORITY_ADDITIVES)) {
    flags.push({
      category: 'additives',
      severity: 'reject',
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a synthetic additive with documented links ` +
        `to adverse health effects, including behavioral changes and organ stress.`,
    });
  }

  // ── Category 1: Seed oils ───────────────────────────────────────────────
  // Uses findMatches directly (not matchAndClaim) so a "-free"-guarded match
  // (e.g. "canola-free") is not claimed either — the range stays available
  // for other categories rather than being silently consumed by a rejected match.
  for (const { trigger, index, end } of findMatches(text, SEED_OILS, claimedRanges)) {
    if (isInFreeOrNonContext(text, index, end)) continue;
    claimedRanges.push({ start: index, end });
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
  // Use findMatches directly (not matchAndClaim) so that ranges cleared by
  // organic/non-gmo labels are NOT added to claimedRanges — this allows
  // GLUTEN_GRAINS to still match those grains for the prolamin concern.
  //
  // CONVENTIONAL_CROPS_NO_FLAG: triggers whose range is claimed (preventing a
  // shorter sub-trigger from matching the suffix) but which do NOT emit a flag.
  // These are known non-GMO / non-conventional sources of an otherwise-flagged
  // ingredient. Only affects this category — other categories are unaffected.
  const CONVENTIONAL_CROPS_NO_FLAG = new Set([
    'sunflower lecithin',  // non-GMO source; 'lecithin' suffix must still be blocked
  ]);
  for (const { trigger, index, end } of findMatches(text, CONVENTIONAL_CROPS, claimedRanges)) {
    if (isInFreeOrNonContext(text, index, end)) continue; // e.g. "sugar-free"
    const clearedByPrefix = isPrecededByOrganic(text, index);
    if (hasUsdaOrganic || hasNonGmo || clearedByPrefix) continue;

    // Always claim the range so shorter sub-triggers cannot match the suffix.
    claimedRanges.push({ start: index, end });
    if (CONVENTIONAL_CROPS_NO_FLAG.has(trigger)) continue; // range claimed, no flag

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
    const cornOffset = cornMatch[0].indexOf('corn');
    const cornStart  = cornMatch.index + cornOffset;
    const cornEnd    = cornStart + 4;

    const clearedByOrganic = Boolean(cornMatch[1]) || hasUsdaOrganic || hasNonGmo;
    if (!clearedByOrganic) {
      // Only claim range when actually flagging — cleared corn stays available for
      // GLUTEN_GRAINS to flag as a prolamin concern.
      claimedRanges.push({ start: cornStart, end: cornEnd });
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

  // ── Conventional eggs ────────────────────────────────────────────────────
  // Detect eggs from conventionally raised hens. Cleared by USDA Organic label
  // OR by "organic" word prefix on the ingredient (e.g. "organic eggs").
  // Word-boundary guard: skip partial matches inside longer words (eggplant, etc.).
  // "-free"/"non-" guard: skip negative-context claims (e.g. "egg-free facility").
  for (const { trigger, index, end } of findMatches(text, CONVENTIONAL_EGGS, claimedRanges)) {
    // Word-boundary guard — skip if the matched text is embedded inside another word
    const charBefore = index > 0 ? text[index - 1] : null;
    const charAfter  = end < text.length ? text[end] : null;
    if ((charBefore && /[a-z]/.test(charBefore)) || (charAfter && /[a-z]/.test(charAfter))) continue;

    if (isInFreeOrNonContext(text, index, end)) continue;

    const clearedByPrefix = isPrecededByOrganic(text, index);
    if (hasUsdaOrganic || clearedByPrefix) continue;

    claimedRanges.push({ start: index, end });
    flags.push({
      category:          'conventional_eggs',
      severity:          severityFor('conventional_eggs', userLevel),
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — eggs from conventionally raised hens without organic certification.`,
    });
  }

  // ── GLYPHOSATE_HEAVY: high-glyphosate-risk crops ─────────────────────────
  // Organic full skip: usda-organic label OR organic ingredient prefix → no flag.
  // glyphosate-free label → downgrade to caution (YELLOW), still flagged.
  // Level 1 → always caution (YELLOW) regardless of certification.
  // bare 'malt' guard: if character immediately after match is a letter, skip
  //   (prevents false positives in 'maltodextrin', 'maltose', etc.).
  // bare 'oats'/'oat milk'/'oatmilk' guard: skip when embedded inside a
  //   larger word (see isPrecededByLetterUnlessAllowlisted) — covers
  //   "goats' milk yogurt", "goat milk", "goatmilk", "coats", etc.
  const hasGlyphosateFree = labels.includes('glyphosate-free');
  for (const { trigger, index, end } of findMatches(text, GLYPHOSATE_HEAVY, claimedRanges)) {
    // Not to be confused with the "glyphosate-free" OFF label (hasGlyphosateFree,
    // above) — this checks the ingredient text itself for a "-free"/"non-" claim
    // on the matched crop (e.g. "wheat-free", "barley-free"), a separate signal.
    if (isInFreeOrNonContext(text, index, end)) continue;

    const clearedByPrefix = isPrecededByOrganic(text, index);
    if (clearedByPrefix || hasUsdaOrganic) continue; // organic = full clearance

    if (trigger === 'malt') {
      const charAfter = text[index + trigger.length];
      if (charAfter && /[a-z]/.test(charAfter)) continue;
    }

    // Word-boundary guard for 'oats'/'oat milk'/'oatmilk' — skip when
    // embedded inside a larger word (e.g. "goats' milk yogurt", "goat milk",
    // "goatmilk", "coats"). Confirmed real false positive: a plain goat-dairy
    // product with zero oat content was producing a reject-severity
    // glyphosate_heavy flag and a false RED verdict. No oat-prefixed trigger
    // in this list is a legitimate suffix of another word, so no allowlist
    // entry is needed here (unlike bare 'corn' and "popcorn" below).
    if (
      (trigger === 'oats' || trigger === 'oat milk' || trigger === 'oatmilk') &&
      isPrecededByLetterUnlessAllowlisted(text, index, end)
    ) continue;

    claimedRanges.push({ start: index, end });
    const glyphoSeverity = (userLevel === 1 || hasGlyphosateFree) ? 'caution' : 'reject';
    flags.push({
      category: 'glyphosate_heavy',
      severity: glyphoSeverity,
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a crop where glyphosate is routinely applied as a ` +
        `pre-harvest desiccant. Look for a glyphosate-free or USDA Organic certification ` +
        `to reduce residue exposure.`,
    });
  }

  // ── Category 3: Bioengineering / gene-modification disclosure ──────────
  const bioMatches = matchAndClaim(BIOENGINEERING_TERMS);
  // Find the first match that is not a false positive.
  // Guard: "gmo" can appear inside negative declarations ("non-gmo", "gmo-free")
  // that signal the product is NOT genetically modified — uses the shared
  // isInFreeOrNonContext() guard (see its definition for the full rationale
  // and the other categories it's now applied to). The other BIOENGINEERING_TERMS
  // triggers are full phrases ("genetically modified", "bioengineered") that
  // cannot appear in a comparable negative context, so the guard is "gmo"-only.
  let validBioMatch = null;
  for (const match of bioMatches) {
    if (match.trigger === 'gmo' && isInFreeOrNonContext(text, match.index, match.end)) {
      continue; // negative context — not a bioengineering disclosure
    }
    validBioMatch = match;
    break;
  }
  if (validBioMatch) {
    const { trigger } = validBioMatch;
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
  // Runs after NATURAL_FLAVORS so that NATURAL_FLAVORS triggers (e.g. "natural
  // flavors", 15 chars) can claim their spans before any overlapping substring
  // in this array consumes them. The PRIORITY_ADDITIVES pass above handles
  // entries that need to run before SEED_OILS.
  //
  // The bare 'flavor' trigger uses a word-boundary guard (see loop body) to
  // prevent over-matching compound flavor descriptors like "natural butter
  // flavor" or "cheese flavor" — where 'flavor' is a qualifier on a whole-food
  // ingredient, not a standalone synthetic-additive declaration.
  //
  // The bare 'ada' trigger (abbreviation for azodicarbonamide) also uses a
  // word-boundary guard — mirrors the CONVENTIONAL_EGGS letter-adjacency
  // guard (see that loop) rather than the two-back 'flavor' check above,
  // since 'ada' is a mid-word substring risk on both sides, not a
  // "<word> ada" compound-descriptor risk. Confirmed real false positives
  // this closes: "macadamia nuts" (m-a-c-ADA-mia) and "Canada" (C-ADA...) —
  // both previously produced a phantom synthetic-additive reject flag and a
  // false RED verdict with no azodicarbonamide anywhere in the product.
  for (const { trigger, index } of matchAndClaim(SYNTHETIC_ADDITIVES)) {
    // Word-boundary guard for the bare 'flavor' trigger only.
    // 'flavor' preceded by a letter two positions back (pattern: "<word> flavor")
    // indicates a compound descriptor, not a standalone additive declaration.
    // Longer triggers like 'artificial flavor', 'flavor enhancer' are already
    // claimed first by length-sorting, so this guard only fires for truly bare
    // 'flavor' that follows a content word (e.g. "butter flavor").
    if (trigger === 'flavor' && index >= 2 && /[a-z]/.test(text[index - 2])) continue;

    // Word-boundary guard for the bare 'ada' trigger only — skip if either
    // adjacent character is a letter (i.e. 'ada' is embedded inside a longer
    // word rather than standing alone as "ADA").
    if (trigger === 'ada') {
      const adaCharBefore = index > 0 ? text[index - 1] : null;
      const adaCharAfter  = index + trigger.length < text.length ? text[index + trigger.length] : null;
      if ((adaCharBefore && /[a-z]/.test(adaCharBefore)) || (adaCharAfter && /[a-z]/.test(adaCharAfter))) continue;
    }

    flags.push({
      category: 'additives',
      severity: 'reject',
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — a synthetic additive with documented links ` +
        `to adverse health effects, including behavioral changes and organ stress.`,
    });
  }

  // ── Soft flags: gluten / prolamin grains ────────────────────────────────
  // Run against the full text with no blocked ranges — prolamin concern is
  // independent of every other category. Internal deduplication (longer
  // phrases shadow shorter ones) still applies via findMatches' local usedRanges.
  //
  // Bare 'oats'/'corn'/'rice' collision guard: skips any of these three bare
  // triggers when embedded inside a larger word — e.g. 'oats' inside "goats"
  // or "coats", 'corn' inside "acorn" or "unicorn", 'rice' inside "price" or
  // "licorice" — via isPrecededByLetterUnlessAllowlisted(). Legitimate
  // compounds (bare 'corn' inside "popcorn") are carved out via
  // TRIGGER_ADJACENCY_ALLOWLIST rather than narrowing the guard itself; see
  // that function's doc comment for the full rationale.
  for (const { trigger, index, end } of findMatches(text, GLUTEN_GRAINS, [])) {
    if (isPrecededBySourceNote(text, index)) continue;
    if (isOilDerivative(text, index, trigger.length)) continue;
    if (isInFreeOrNonContext(text, index, end)) continue; // e.g. "wheat-free", "corn-free"
    if (
      (trigger === 'oats' || trigger === 'corn' || trigger === 'rice') &&
      isPrecededByLetterUnlessAllowlisted(text, index, end)
    ) continue;
    flags.push({
      category: 'gluten_grains',
      severity: 'caution',
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — gluten protein is present. ` +
        `Not safe for individuals with celiac disease or non-celiac gluten sensitivity.`,
    });
  }

  // ── Deduplicate flags by (category, matchedIngredient) ─────────────────
  // Prevents the same trigger appearing 2–3× when a short term (e.g. "sugar",
  // "canola oil") matches multiple positions in the ingredient string.
  const _seenFlags = new Set();
  flags = flags.filter(f => {
    const key = f.category + '|' + f.matchedIngredient;
    if (_seenFlags.has(key)) return false;
    _seenFlags.add(key);
    return true;
  });

  // ── Verdict ─────────────────────────────────────────────────────────────
  // gluten_grains is a paywall feature — stripped in scan.js before UI display.
  // Exclude it here so it never inflates the engine verdict.
  const activeFlags = flags.filter(f => f.category !== 'gluten_grains');
  const hasReject   = activeFlags.some(f => f.severity === 'reject');
  const hasCaution  = activeFlags.some(f => f.severity === 'caution');

  let verdict;
  if (hasReject)       verdict = 'red';
  else if (hasCaution) verdict = 'yellow';
  else                 verdict = 'green';

  const clearedBy =
    hasUsdaOrganic ? 'organic'                  :
    hasNonGmo      ? 'non-gmo-project-verified' :
    null;

  // ── Unverified ingredients ───────────────────────────────────────────────
  // Three-pass approach:
  //   Pass 1 — remove tokens that contain any known trigger (ALL_TRIGGERS).
  //            These are already "known" to the engine, flagged or cleared.
  //   Pass 2 — filterUnrecognizedTokens() removes clean whole-food tokens,
  //            parsing artifacts, and level-appropriate known-good tokens.
  //   Pass 3 — remove tokens the team has manually reviewed and confirmed
  //            clean (REVIEWED_CLEAN_INGREDIENTS). Display-only filter;
  //            never affects verdict or flag logic.
  // Result is sent to the database for team review; never affects the verdict.
  // Parses ingredientTextCleaned (allergen phrases and purpose-note parentheticals
  // already stripped, original casing preserved) rather than the raw
  // ingredientText — otherwise disclaimer fragments like "contains" / "tree nuts"
  // and purpose notes like "for color" leak into the review queue even though
  // the same phrases are correctly stripped from `text` for flag matching.
  const rawUnknownTokens = parseIngredientTokens(ingredientTextCleaned)
    .filter(token => {
      const t = token.toLowerCase().trim();
      if (ALL_TRIGGERS.some(trigger => t.includes(trigger))) return false;
      if (ALWAYS_IGNORE_INGREDIENTS.some(ignore => t.includes(ignore))) return false;
      if (t === 'corn') return false; // handled by standalone corn regex in analyzeIngredients()
      return true;
    });

  const unverifiedIngredients = filterUnrecognizedTokens(rawUnknownTokens, userLevel, claimedRanges)
    .filter(token => !REVIEWED_CLEAN_INGREDIENTS.has(token.toLowerCase().trim()));

  return { verdict, flags, clearedBy, unverifiedIngredients };
}

module.exports = {
  analyzeIngredients,
  LEVEL_1_YELLOW_CATEGORIES,
  CONVENTIONAL_EGGS,
  GLYPHOSATE_HEAVY,
  FORTIFIED_VITAMINS,
  NATURAL_COLORANTS,
  containsFortifiedVitamins,
  containsNaturalColorants,
  ALWAYS_IGNORE_INGREDIENTS,
  MILK_DERIVED_INGREDIENTS,
  EGG_DERIVED_INGREDIENTS,
  containsMilkDerived,
  MEAT_DERIVED_INGREDIENTS,
  containsMeatDerived,
  MEAT_INGREDIENT_TERMS,
  containsMeatIngredient,
  containsEggDerived,
  REVIEWED_CLEAN_INGREDIENTS,
};
