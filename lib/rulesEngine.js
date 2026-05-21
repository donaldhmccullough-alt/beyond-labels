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
  'palm olein',
  // ── Conventional seed/vegetable oils ─────────────────────────────────────
  'canola',          // before 'canola oil'
  'canola oil',
  'soybean oil',
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
  'enriched long grain white rice',
  'brown rice syrup',             // highly processed rice sweetener
  'enriched macaroni product',
  'dried potatoes',
  // ── Soy & soy derivatives ─────────────────────────────────────────────────
  'soybean',        // bare crop form; 'soybean oil' lives in SEED_OILS (Cat 1, no clearance)
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
  'malt syrup',   // barley malt sweetener
  'malt extract', // barley malt derivative
  'malt flavor',  // barley malt derivative
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
  'antioxidant',
  'silicon dioxide',
  'nisin preparation',
  'ferrous sulfate',
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
  'humectants',
  'hydrolyzed corn protein', // free glutamate generator
  // ── Synthetic fortification ──────────────────────────────────────────────
  'folic acid',
  'niacinamide',             // before 'niacin' in length sort
  'niacin',
  'potassium phosphate',
  'thiamine mononitrate',    // before 'thiamin mononitrate' in length sort
  'thiamin mononitrate',     // synthetic B1 — most common spelling
  'thiamin mononitrite',     // label typo variant — appears in the wild
  'riboflavin',              // synthetic B2
  'reduced iron',            // synthetic iron fortification
  // ── Sodium-based preservatives and stabilizers ───────────────────────────
  'sodium alginate',
  'sodium caseinate',
  'sodium citrate',
  'sodium diacetate',
  'sodium phosphate',
  'sorbic acid',
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
  'cultured celery juice',   // nitrate precursor used in "uncured" products
  'cultured celery powder',  // nitrate precursor — powder form
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
  // Note: 'bleached flour' is intentionally omitted here — it is already
  // present in CONVENTIONAL_CROPS (clearable by organic/non-gmo labels).
  // Moving it would require updating existing tests. At Level 2 it is
  // always flagged red; at Level 1 it is yellow per the conventional_crops rule.
];

/** Soft-flag grains that indicate gluten / prolamin protein is present. */
const GLUTEN_GRAINS = [
  // ── Wheat & wheat derivatives (longer phrases first) ──────────────────────
  'hydrolyzed wheat protein', // before 'wheat protein', 'wheat'
  'modified wheat starch',    // before 'wheat starch', 'wheat'
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
  'barley',
  'malt',
  // ── Rye ───────────────────────────────────────────────────────────────────
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
  // ── Cross-sensitivity risk grains ────────────────────────────────────────
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
];

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
  // Strip "No. " (FD&C numbering suffix) so "Red No. 40" → "Red 40",
  // "Yellow No. 5" → "Yellow 5", "Citrus Red No. 2" → "Citrus Red 2".
  // \b prevents matching "no." inside words (e.g. "Casino."). /gi = global, case-insensitive.
  const text = String(ingredientText)
    .replace(/\bno\.\s+/gi, '')
    .toLowerCase();

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
  // Use findMatches directly (not matchAndClaim) so that ranges cleared by
  // organic/non-gmo labels are NOT added to claimedRanges — this allows
  // GLUTEN_GRAINS to still match those grains for the prolamin concern.
  for (const { trigger, index, end } of findMatches(text, CONVENTIONAL_CROPS, claimedRanges)) {
    const clearedByPrefix = isPrecededByOrganic(text, index);
    if (hasUsdaOrganic || hasNonGmo || clearedByPrefix) continue;

    claimedRanges.push({ start: index, end });
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
  // Runs after NATURAL_FLAVORS so that "natural flavors" (14 chars) can claim
  // its full span before the bare "flavor" (6 chars) trigger in this array
  // consumes the overlapping sub-string. The PRIORITY_ADDITIVES pass above
  // handles any entries that need to run before SEED_OILS.
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

  // ── Soft flags: gluten / prolamin grains ────────────────────────────────
  // Run against the full text with no blocked ranges — prolamin concern is
  // independent of every other category. Internal deduplication (longer
  // phrases shadow shorter ones) still applies via findMatches' local usedRanges.
  for (const { trigger, index } of findMatches(text, GLUTEN_GRAINS, [])) {
    if (isPrecededBySourceNote(text, index)) continue;
    if (isOilDerivative(text, index, trigger.length)) continue;
    flags.push({
      category: 'gluten_grains',
      severity: 'caution',
      matchedIngredient: trigger,
      summary:
        `Contains "${trigger}" — gluten protein is present. ` +
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

module.exports = { analyzeIngredients, LEVEL_1_YELLOW_CATEGORIES };
