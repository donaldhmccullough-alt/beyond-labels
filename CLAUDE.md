# Beyond Labels — Claude Code Project Memory

## What This App Is
Beyond Labels is a mobile-first food ingredient scanner app. Users scan a product barcode, the app fetches ingredients from Open Food Facts, runs them through a deterministic rules engine, and returns a red/yellow/green verdict with AI-generated plain-language explanations in the voice of hosts Sina McCullough (PhD nutritionist) and Joel Salatin (regenerative farmer).

---

## Tech Stack
- **Framework**: Next.js 14 (App Router for UI, Pages Router for API routes)
- **React**: 18.3
- **Database/Auth**: Supabase JS v2 (`@supabase/supabase-js`) — no auth-helpers package
- **Barcode scanning**: `@zxing/library` 0.21.3
- **AI explanations**: `@anthropic-ai/sdk` — Claude Sonnet, called from `/pages/api/scan.js` (inline) and `/pages/api/explain.js` (standalone endpoint)
- **Node**: 20.x (pinned in `.nvmrc` and `package.json` engines)
- **Deployment**: Vercel, region `iad1`
- **Testing**: Jest

---

## Repository & Branches
- `master` — production baseline
- `mvp-beta` — active development branch; MVP simplifications applied here

---

## Project File Structure
```
app/
  layout.jsx              — root layout, fonts (Inter + Playfair Display)
  page.jsx                — onboarding orchestrator; controls the step flow
  globals.css             — CSS variables, base styles
  auth/
    callback/page.jsx     — handles Supabase email confirmation (PKCE + OTP + hash)
    confirm/page.jsx      — thin redirector → /auth/callback

components/
  onboarding/
    WelcomeScreen.jsx     — first screen; logo + tagline + begin/skip
    LevelSelectScreen.jsx — two-card level picker (current first onboarding step)
    AssessmentScreen.jsx  — 13-question quiz (BYPASSED in MVP_MODE — do not delete)
    CalculatingScreen.jsx — loading animation (BYPASSED in MVP_MODE — do not delete)
    RevealScreen.jsx      — shows stage result (BYPASSED in MVP_MODE — do not delete)
    FlagsScreen.jsx       — personal dietary flags (BYPASSED in MVP_MODE — do not delete)
    LaunchScreen.jsx      — "you're all set" screen (BYPASSED in MVP_MODE — do not delete)
  scanner/
    ScannerScreen.jsx     — ZXing camera, barcode decode, POST /api/scan; history tappable
    PaywallModal.jsx      — scan limit paywall (kept, never triggered in MVP_MODE)
  verdict/
    VerdictScreen.jsx     — displays red/yellow/green verdict + flags + AI explanation + unrecognized ingredients card
    ConcernCard.jsx       — individual flag card component
  profile/
    ProfileScreen.jsx     — user profile, settings, level switcher, tappable scan history
  swaps/
    SwapsScreen.jsx       — product swap suggestions; level-aware Good/Better sections
    SwapCard.jsx
  shared/
    BottomNav.jsx         — 4-tab nav: Scan / Verdict / Swaps / Profile
    Header.jsx
    LoadingSpinner.jsx
  auth/
    AuthModal.jsx         — sign in / sign up modal

lib/
  rulesEngine.js          — deterministic ingredient analysis engine (core logic)
  rulesEngine.test.js     — Jest tests for rules engine (35 describe blocks; 2050 tests total; block 20 = SYNTHETIC_ADDITIVES bucket-1 expansion (91 tests); block 21 = FD&C "No." normalization (19 tests); block 22 = mechanically separated meat (3 tests); block 23 = interesterified variants, lake forms, dye synonyms, new E-numbers, stearyl emulsifiers, cyclamate (78 tests); block 24 = synonym/E-number expansion: nitrates, BVO, bleaching agents, BHA/BHT names, SLS, E-numbers e320/e321/e924/e950–e955 (50 tests); block 25 = gluten grains expansion: ancient grains, botanical names, asafoetida/hing, smoke flavoring, brown rice syrup (34 tests); block 26 = H2: artifact phrases and red list additions — polysorbates, synthetic phosphates, red 3/#-normalizer (17 tests); block 27 = I: Sina gluten expansion — 65 new GLUTEN_GRAINS entries across corn derivatives, wheat flour varieties, barley/rye/oat forms, processed ingredients (22 tests); block 28 = FORTIFIED_VITAMINS group — synthetic vitamin fortification detection (61 tests); block 29 = NATURAL_COLORANTS group — plant-derived colorant detection (12 tests); block 32 = containsMilkDerived, containsEggDerived, ALWAYS_IGNORE_INGREDIENTS — new helper functions and ignore-list constant (32 tests); block 33 = GLYPHOSATE_HEAVY — high-glyphosate-risk crops: pea protein, oat milk, buckwheat, ascorbic acid, lecithin, potato starch, papaya, glyphosate-free escape hatch for oats/wheat, GLYPHOSATE_HEAVY export (11 tests); block 34 = CONVENTIONAL_CROPS_NO_FLAG — sunflower lecithin range-claim without flag (5 tests); block 35 = REVIEWED_CLEAN_INGREDIENTS — display-only suppression filter, Set export, almond flour/arrowroot suppressed, unknown ingredient still surfaces, engine flags/verdict unaffected (5 tests))
  __tests__/api/scan.test.js — Jest integration tests for /api/scan handler (18 suites A–R; 156 tests total; suite H = L2 decision tree coverage: cert gate, organic path, non-organic path, seafood/meat/dairy logic, isMeatProduct detection, L2 organic requirement, L1 no-op — 16 tests; suite I = inconclusive verdict: all ingredients unrecognized — 3 tests; suite J = L1 explicit overrides — gluten suppression, conventional meat caution injection (8 tests); suite K = L2 flags array cleanup — gluten suppression and organic conventional_crops strip (5 tests); suite L = universal L2 decision tree — 15 integration scenarios covering all 14 nodes (L5 updated: eggs now produce conventional_eggs not conventional_meat); suite M = PROMPT_VERSION contract — 1 test; suite N = wild-caught detection — product name signals, farmed exclusions, seed oil short-circuit (4 tests); suite O = cert_unconfirmed — all-organic ingredient prefix detection, trivial ingredient exclusion, non-organic partial mix, usda-organic cert bypass (4 tests); suite P = conventional_eggs — non-meat product with eggs, organic prefix clearance, meat+eggs both flags, dairy-only no-interference (4 tests); suite Q = detectWildCaught standalone wild signal — product name only, ingredients signal, non-seafood unaffected, astaxanthin farmed exclusion (4 tests); suite R = pure-water GREEN path — artesian water + minerals, sparkling water, water+natural-flavor regression, coconut water non-match (4 tests))
  ── Combined test total: 1041 tests (885 rulesEngine + 156 scan) ──
  onboardingData.js       — QUESTIONS array (13 Qs), STAGES array (5 stages), getStageFromScore()
  userProfile.js          — localStorage profile read/write/clear helpers
  userLevel.js            — getUserLevel(), setUserLevel(), hasUserLevel() — localStorage bl_user_level
  auth.js                 — Supabase auth wrappers (signUp, signIn, signOut, migration)
  supabase.js             — null-safe Supabase singleton; anon key + RLS; client-side only
  supabaseServer.js       — null-safe Supabase singleton; service role key; SERVER-ONLY — never import from client components or app/
  cacheVersion.js         — PROMPT_VERSION constant (single source of truth for cache invalidation)
  cacheUtils.js           — getCacheInvalidationSQL() developer utility for manual cache purges
  scanHistory.js          — formatTime(iso) and createHistoryTapHandler(opts) — shared utilities for tappable scan history in ScannerScreen + ProfileScreen

pages/api/
  scan.js                 — POST barcode → cache check → Open Food Facts → rulesEngine → Claude → scan_cache upsert
  explain.js              — POST verdict/flags → Claude API → plain-language explanation (standalone; also exports SYSTEM_PROMPT + buildUserMessage)
  swaps.js                — swap suggestions (Google Sheet CSV + AI fallback); level-aware Good/Better tiers
  health.js               — health check endpoint
```

---

## Design System

### CSS Variables (app/globals.css)
```css
--cream: #FAF6EF          /* main background */
--cream-dark: #F2EBD9     /* card/section backgrounds */
--amber: #D4872A          /* primary CTA, highlights */
--amber-light: #F0A83C    /* gradient end, hover states */
--forest: #3A5A40         /* secondary/success color */
--forest-light: #4D7B55
--text-dark: #2C2416
--text-mid: #5C4A2A
--text-light: #9A8260
--blue-flag-bg: #E6F1FB   /* personal flag badges */
--blue-flag-text: #0C447C
--red-flag: #C0392B
--yellow-flag: #D4872A    /* reuses amber */
--green-flag: #3A5A40     /* reuses forest */
```

### Fonts
- **Headings/serif**: `var(--font-playfair)` — Playfair Display (loaded via next/font)
- **Body/UI**: `var(--font-inter)` — Inter (loaded via next/font)

### Layout
- Mobile-first, max-width 430px, centered with `margin: 0 auto`
- Container class: `.app-container`
- All components use inline styles (no CSS modules or Tailwind)
- Warm earthy, never clinical — think farmers market, not pharma

---

## MVP_MODE Pattern (CRITICAL)

**Never delete features — gate them with flags.**

Each component that has MVP simplifications has this at the top:
```js
// MVP_MODE: set to false to restore [feature name]
const MVP_MODE = true;
```

This is module-level per file, not a global config. Re-enabling is a one-line change per file.

### Currently applied on mvp-beta:
| File | What MVP_MODE disables |
|------|----------------------|
| `ScannerScreen.jsx` | Scan counter display, paywall modal, scan limit check |
| `VerdictScreen.jsx` | Onboarding nudge banners, personal flag badges |
| `ProfileScreen.jsx` | Pro coaching note |
| `app/page.jsx` | Skips FlagsScreen in onboarding (goes reveal → launch directly) |

### Completed MVP_MODE items:
- ✅ Replaced "Upgrade to Pro — $9.99/mo" button with disabled grey "Coming Soon" in ProfileScreen
- ✅ Level-select onboarding screen built and wired into the flow
- ✅ Level system fully implemented throughout (rules engine, UI, storage, AI tone)
- ✅ Swaps system fully rebuilt with level-aware Good/Better tiers

### Still pending on mvp-beta:
- No pending MVP_MODE items as of the last session.

---

## Onboarding Flow

### Current flow (mvp-beta):
```
welcome → level-select → scanner
```
On return visits, `hasUserLevel()` is checked on mount — if already set, jumps straight to `appScreen: 'main'` (scanner).

### Bypassed onboarding steps (MVP_MODE — do not delete):
```
assessment → calculating → reveal → flags → launch
```
These screens are fully built. Re-enabling them is a one-line change in `app/page.jsx`.

### Level-select screen:
- Two cards side by side, user picks one, stored immediately to localStorage
- Card A: **"Building awareness"** — sets Level 1
- Card B: **"Already label-conscious"** — sets Level 2
- Component: `components/onboarding/LevelSelectScreen.jsx`

---

## User Level System (FULLY BUILT)

### Concept
New users choose Level 1 (lenient) or Level 2 (strict) during onboarding. The rules engine downgrades certain categories from red → yellow for Level 1, making the app less daunting for beginners. Level 2 is the full strict ruleset.

### Storage
- Anonymous: `localStorage` key `bl_user_level` (integer 1 or 2) via `lib/userLevel.js`
- Signed-in: `user_level` column on Supabase `profiles` table (synced on sign-in)
- Default for new users: `1`
- Mutable: user can switch in Profile → Strictness Level section

### Level rules — Always RED (both levels)
**Trans fats** (TRANS_FATS array — separate from SEED_OILS):
`partially hydrogenated`, `hydrogenated`, `margarine`, `shortening`

**All of SYNTHETIC_ADDITIVES** (every item stays red for both levels): All items in the SYNTHETIC_ADDITIVES array — see `lib/rulesEngine.js` for the full list.

### Level rules — YELLOW for Level 1, RED for Level 2
**Seed oils** (SEED_OILS array — trans fats are in a separate TRANS_FATS array):
high oleic sunflower/canola/safflower oil, high oleic soybean oil, high oleic soybean,
canola, canola oil, soybean oil, corn oil, sunflower oil, safflower oil,
cottonseed, cottonseed oil, grapeseed oil, rice bran oil, vegetable oil, palm oil,
palm fruit oil, rapeseed oil, peanut oil, mustard seed oil, palm kernel oil, palm olein,
fractionated palm oil, fractionated palm

**All conventional crops** (CONVENTIONAL_CROPS array; organic/Non-GMO clearance still applies; recent additions: enriched long grain white rice, enriched macaroni product, dried potatoes, malt syrup, malt extract, malt flavor, soybean [bare crop form — soybean oil remains in SEED_OILS only])

**Bioengineering disclosure** (BIOENGINEERING_TERMS array):
contains a bioengineered food ingredient, genetically engineered, genetically modified,
bioengineered, gmo

**Natural flavors** (NATURAL_FLAVORS array — separated from SYNTHETIC_ADDITIVES):
natural and artificial flavors, with other natural flavors, natural and artificial flavor,
natural flavors, natural flavor, wonf

### Unverified ingredients — level-aware filtering
After a fresh scan, tokens not matched by any trigger are filtered through `filterUnrecognizedTokens()`:
- **Level 1 (inverted logic)**: assume clean unless chemical signals present — digit, E-number pattern, >4 words, parenthetical, or known L1-yellow trigger. Whole foods like "turmeric" are suppressed.
- **Level 2**: suppress only narrow unambiguous tokens (water, sea salt variants, baking soda, sodium bicarbonate).

### AI tone by level
- Items RED at both levels: current direct language unchanged
- Items YELLOW at Level 1: softer framing — `[Level 1 awareness item — use encouraging, non-alarming tone]` injected into the Claude prompt per category. Implemented in `buildUserMessage()` in `explain.js`.

---

## Rules Engine (lib/rulesEngine.js)

### Exports
```js
// CommonJS — import as:
import rulesEngine from '@/lib/rulesEngine';
const { analyzeIngredients, LEVEL_1_YELLOW_CATEGORIES } = rulesEngine;

analyzeIngredients(ingredientText, productLabels, userLevel = 2)
// Returns: {
//   verdict:               'red'|'yellow'|'green'|'unverified',
//   flags:                 Flag[],
//   clearedBy:             string|null,
//   unverifiedIngredients: string[]
// }

LEVEL_1_YELLOW_CATEGORIES
// Set<string> — {'seed_oils', 'conventional_crops', 'bioengineering', 'natural_flavors'}
// Trans fats and SYNTHETIC_ADDITIVES are intentionally excluded — always red at both levels.
// Imported by VerdictScreen and explain.js (single source of truth)
```

### Text preprocessing (inside `analyzeIngredients`)
Before any trigger matching the raw ingredient string is normalized in two steps:
1. **"No." stripping** — `/\bno\.\s+/gi` removes the FD&C ordinal suffix so label strings like `"FD&C Red No. 40"` → `"FD&C Red 40"` and then match the existing `red 40` trigger. Covers all FD&C dyes and `Citrus Red No. 2`. `\b` prevents the regex from firing inside words (e.g. "Casino."). The fix lives in `analyzeIngredients`, **not** in `scan.js`, because `scan.js` passes the raw OFF ingredient text directly — this ensures every caller (tests, future endpoints) gets consistent behavior automatically.
2. **Lowercase** — the entire string is lowercased for case-insensitive trigger matching.

### Categories
1. **TRANS_FATS** — always red at both levels; no clearance
2. **SEED_OILS** — Level 2: red; Level 1: yellow; no organic clearance
3. **CONVENTIONAL_CROPS** — Level 2: red; Level 1: yellow; clearable by `usda-organic` label, `non-gmo-project-verified` label, or "organic" word prefix on the ingredient
4. **BIOENGINEERING_TERMS** — Level 2: red; Level 1: yellow; first match only
5. **NATURAL_FLAVORS** — Level 2: red; Level 1: yellow; no clearance
6. **SYNTHETIC_ADDITIVES** — always red at both levels; no clearance; expanded with ~200 additional EU n/n triggers. Category string: `'additives'` (the engine loop emits `category: 'additives'`; `ConcernCard` maps both `'additives'` and `'synthetic_additives'` to the same display for backwards-compatibility). Includes lake dye forms (e.g. `yellow 5 lake`), chemical name synonyms (e.g. `tartrazine`, `allura red`), 22 E-numbers, stearyl ester emulsifiers, bare `cyclamate`, and a **"Processing methods"** section: `mechanically separated meat`. PRIORITY_ADDITIVES pre-pass runs before SEED_OILS; contains `interesterified palm oil`, `interesterified soybean oil`, `brominated vegetable oil`, and `soya lecithin` (added to prevent `lecithin` in CONVENTIONAL_CROPS from claiming the suffix first). The bare `flavor` trigger uses a **word-boundary guard** in the SYNTHETIC_ADDITIVES loop.
6b. **GLYPHOSATE_HEAVY** — Level 2: red; Level 1: always caution (yellow). Category string: `'glyphosate_heavy'`. Covers crops where glyphosate is routinely used as a pre-harvest desiccant: oats and oat derivatives, wheat and wheat derivatives (moved from old CONVENTIONAL_CROPS), barley and malt derivatives (moved from old CONVENTIONAL_CROPS), lentils, peas, edible beans, flax/linseed, rye, buckwheat, millet. Clearance: `usda-organic` label OR organic ingredient prefix → skip entirely; `glyphosate-free` label → flag stays but downgraded to caution (YELLOW). **bare `malt` guard**: if character immediately after the match is a letter, skip (prevents false positives in `maltodextrin`, `maltose`). Detection loop runs between CONVENTIONAL_CROPS and BIOENGINEERING. Included in `LEVEL_1_YELLOW_CATEGORIES` and `LEVEL_1_YELLOW_TRIGGERS`.
7. **GLUTEN_GRAINS** — soft flag (caution/yellow only at both levels). Category string: `'gluten_grains'` (not `'gluten'`).
   - **Flags every match**, not just the first — a product with wheat flour, oats, and barley malt gets three separate `gluten_grains` flags.
   - **Bypasses the claiming system entirely** — runs `findMatches(text, GLUTEN_GRAINS, [])` with an empty blocked-ranges list, so no prior category can suppress a grain match. Prolamin protein is an independent concern from pesticide exposure, bioengineering, or seed-oil content.
   - Organic/Non-GMO clearance does **not** suppress GLUTEN_GRAINS flags — organic wheat is still a prolamin concern.
   - **Broader prolamin definition**: rice entries (`whole grain brown rice flour`, `rice flour`, `rice`, etc.) are included because rice prolamins (oryzin) can trigger sensitivity in celiac and non-celiac gluten-sensitive individuals. Added `whole grain brown rice flour` (shadows `rice flour` and `brown rice` at the same position). Also added `malt flavor` to the barley/malt section.
   - **Sina clinical list expansion** (65 new entries): corn derivatives (`high fructose corn syrup`, `corn syrup`, `hydrolyzed corn protein`, `corn oil`, `corn gluten`, `polenta`, `zea mays`, etc.); wheat flour varieties (`whole wheat flour`, `bread flour`, `self-rising flour`, `pastry flour`, `cake flour`, `all-purpose flour`, `tipo 00 flour`); barley varieties (`pearl barley`, `barley flour`, `barley flakes`, `hulled barley`, etc.); rye varieties (`pumpernickel`, `cereal rye`, `ryegrass`, `white/light/medium/dark rye`); oat varieties (`steel-cut oats`, `oat groats`, `quick oats`, `instant oats`, `scottish oats`, `sprouted oats`); sorghum varieties (`grain sorghum`, `sweet sorghum`, `broomcorn`); corn-derived sweeteners (`maltodextrin`, `dextrose`, `fructose`, `glucose syrup`, `maltose`, `vanillin`, `sorbitol`, `xanthan gum`); processed/ambiguous ingredients (`modified food starch`, `food starch`, `pregelatinized starch`, `hydrolyzed vegetable protein`, `textured vegetable protein`, `vegetable gum`, `soy sauce`, `miso`, `dextrin`, `baking powder`). Double-flagging with CONVENTIONAL_CROPS or SYNTHETIC_ADDITIVES is acceptable by design — GLUTEN_GRAINS bypasses the claiming system.
   - **Two false-positive filters** applied per match before a flag is emitted:
     1. `isPrecededBySourceNote()` — skips grains that appear in source-disclosure parentheticals, e.g. "maltodextrin (made from corn)" does not flag "corn".
     2. `isOilDerivative()` — skips a grain word immediately followed by ` oil` (e.g. "corn" inside "corn oil"). Refined oils carry no meaningful prolamin and are already covered by SEED_OILS.

### Verdict logic
- Any hard reject (`severity: 'reject'`) → `'red'`
- No hard rejects + soft flags (`severity: 'caution'`) → `'yellow'`
- Nothing → `'green'`
- Empty/null ingredients → `'unverified'`

### Level 2 universal decision tree (inline in scan.js)

For `userLevel === 2`, `scan.js` applies a universal 14-node decision tree **after** `analyzeIngredients()` runs. Applies to all 10 product categories. First matching node wins. Does not run for `unverified` or `inconclusive` verdicts.

**Pre-processing before the tree runs:**
1. Gluten_grains flags are stripped (paywall feature — invisible at both levels)
2. `maskedText` is built: `maskIgnoredIngredients(ingredientsText.toLowerCase())` — replaces `ALWAYS_IGNORE_INGREDIENTS` terms (salt, water, calcium carbonate, magnesium oxide, yeast, cultures, enzymes) with same-length spaces to prevent false positives in ingredient-level helper functions.

**Decision tree:**
| Node | Condition | Verdict | `clearedBy` |
|------|-----------|---------|-------------|
| 1 | `additives` flag present | RED | null |
| 2 | `seed_oils` flag present | RED | null |
| 3 | `trans_fats` flag present | RED | null |
| 3b | `natural_flavors` flag present | RED | null |
| 4 | `usda-organic` label | → organic sub-tree | `'organic'` |
| 5 | `detectWildCaught()` returns true (OFF label OR product name contains wild-caught signal, no farmed exclusions) | GREEN | `'wild-caught'` |
| 5b | `isSeafood` + no wild-caught signal detected | RED (inject `conventional_meat` flag) | null |
| 6 | Game meat category (`en:game-meats`) | GREEN | null |
| 7 | `non-gmo-project-verified` label | YELLOW | `'non-gmo-project-verified'` |
| 8 | `isMeat` (non-seafood, non-game) | RED (inject `conventional_meat` flag) | null |
| 8b | `conventional_eggs` flag present (from engine) | RED (no injection — engine already has flag with matchedIngredient) | null |
| 9 | `containsMilkDerived(maskedText)` | RED (inject `conventional_dairy` flag) | null |
| 10 | `conventional_crops` flag present | RED | null |
| 11 | `bioengineering` flag present | RED | null |
| 12 | `glyphosate-free` label | YELLOW | `'glyphosate-free'` |
| 13 | `glyphosate-heavy` label | RED | null |
| 14 | Default | YELLOW | null |

**Organic sub-tree (entered at node 4):**
| Check | Verdict |
|-------|---------|
| `containsFortifiedVitamins(maskedText)` | YELLOW + inject `fortified_vitamins` caution flag |
| `containsNaturalColorants(maskedText)` | YELLOW + inject `natural_colorants` caution flag |
| `maskedText.includes('olive oil')` | YELLOW + inject `olive_oil_adulteration` flag, set `oliveCaveat: true` |
| None of the above | GREEN |

**Key behaviour changes from the previous cert-gate waterfall:**
- Products with no cert AND no conventional ingredient signals now default to **YELLOW** (node 14), not RED. "Pistachios, salt" is yellow not red.
- Seafood and game meat have dedicated nodes — no conventional_meat flag for wild-caught fish or venison.
- Conventional dairy (`conventional_dairy` flag) is now a distinct tree node separate from conventional meat.
- Conventional eggs (`conventional_eggs` flag) have their own Node 8b — no longer merged into the `conventional_meat` node. Products like ravioli, pasta, and cookies with egg ingredients get `conventional_eggs` (not `conventional_meat`). The flag comes from the rules engine (not scan.js injection) and carries the actual matched ingredient string.
- Egg ingredients are detected by the rules engine (CONVENTIONAL_EGGS loop with `isPrecededByOrganic()` guard) and handled at Node 8b — separate from conventional_meat. Products like ravioli, pasta, and cookies with egg ingredients get a `conventional_eggs` flag (not `conventional_meat`). "organic eggs" as an ingredient prefix clears the flag at engine level. `containsEggDerived()` is still exported from rulesEngine but no longer used in scan.js.
- `oliveCaveat: true` is set on the response object when the organic path hits the olive oil branch. Not yet persisted to `scan_cache` (no `olive_caveat` column); `TODO` comment left in upsert.

**New helper sets in scan.js:**
```js
// Subset of MEAT_CATEGORIES for seafood-specific detection
const SEAFOOD_CATEGORIES = new Set([
  'en:fish', 'en:seafood', 'en:shellfish', 'en:crustaceans', 'en:molluscs',
  'en:salmon', 'en:tuna', 'en:cod', 'en:tilapia', 'en:shrimp',
]);
const GAME_MEAT_CATEGORIES = new Set(['en:game-meats', 'en:game', 'en:wild-game']);
```

**New OFF_LABEL_MAP entries** (wild-caught, farmed, glyphosate-heavy):
```js
'en:wild-caught':          'wild-caught',
'en:wild-caught-fish':     'wild-caught',
'en:wild-caught-seafood':  'wild-caught',
'en:wild-fish':            'wild-caught',
'en:farmed':               'farmed',
'en:farm-raised':          'farmed',
'en:glyphosate-heavy':     'glyphosate-heavy',
```

**`detectWildCaught(productName, labelsDetected, ingredientsText)` helper** (added v12, extended v18):
- Combines four positive signals: (1) `labelsDetected.includes('wild-caught')`; (2) product name contains `'wild-caught'` or `'wild caught'` (case-insensitive); (3) product name contains standalone word `'wild'` (`/\bwild\b/` — will not match "wildlife" or "wilderness"); (4) ingredients text contains standalone word `'wild'` (same regex — covers labels like "Wild pink salmon").
- Farmed exclusions take precedence over all signals: product name contains `'farm-raised'`, `'farmed'`, or `'atlantic salmon'` → returns false. Ingredients contain `'astaxanthin'` (synthetic farmed-salmon color additive) → returns false.
- Used at Node 5 of the L2 tree. Node 5b (`isSeafood` + no wild-caught signal) still applies for seafood that is definitively not wild-caught.

**`matchedIngredient: ''` convention** — injected flags (`conventional_meat`, `conventional_dairy`) always use an empty string, not `null`. `ConcernCard` asserts `typeof matchedIngredient === 'string'`; do not change this to `null`. `conventional_eggs` flags are engine-emitted (not injected) and carry the actual matched ingredient string (e.g. `'eggs'`, `'egg whites'`).

**Custom unverified messaging for meat products** (keyed on `isMeat` + `unverifiedReason` in VerdictScreen):
- L1 + `no_ingredients` + `isMeat`: "Flip the package over and read the label before buying — skip it if you see any synthetic chemicals, artificial additives, artificial flavors, or preservatives."
- L2 + `no_ingredients` + `isMeat`: "Look for the USDA Organic seal before buying, and use your best judgment on quality — grass-fed, pasture-raised, or sourced from a farm you trust is always the better choice."

`isMeat` is included in the scan response and written to the `scan_cache` table (`is_meat` boolean column, default false). The `isMeat: false` default is also included in the 404 not-found response for shape consistency.

**Limitations**:
- OFF labels are user-contributed; coverage is good but not authoritative.
- Non-GMO Project check is live using OFF label data. Direct Non-GMO Project data partnership pending.
- USDA OData API confirmed retired May 2026; replacement REST API returns empty results — not accessible at current api.data.gov key tier.

---

## Swaps System (FULLY BUILT)

### Concept
When a user taps "See Cleaner Swaps" on the VerdictScreen, the app surfaces curated store-bought alternatives from a Google Sheet database. Swaps are level-aware and category-matched to the scanned product.

### Google Sheet
- Sheet ID stored in `SWAP_SHEET_ID` env var
- Fetched as CSV, cached in-memory for 1 hour
- Column order (exact): `product_name, brand, category, barcode, certifications, why_it_passes, where_to_buy, image_url, swap_level`
- `certifications`: semicolon-separated — must use exact strings `usda-organic` and/or `non-gmo-project-verified`
- `why_it_passes`: semicolon-separated reasons (rendered as checklist in UI)
- `where_to_buy`: comma-separated store names
- `swap_level`: `1` (passes Level 1 criteria) or `2` (passes Level 2 strict criteria)

### Level tiers
| User level | swap_level=1 rows | swap_level=2 rows |
|---|---|---|
| Level 2 | hidden | shown as flat list |
| Level 1 | shown as "Good Swap" section | shown as "Better Swap" section |

Level 2 products serve double duty — they are the gold standard for Level 2 users and the "Better" aspirational tier for Level 1 users.

### Swap categories (9 total)
Valid values for the `category` column: `chips`, `snacks`, `cereal`, `condiments`, `beverages`, `dairy`, `bread`, `frozen`, `cooking_oils`. Spelling must be exact — the API validates against this list.

### Product category mapping (scan.js)
`scan.js` extracts `categories_tags` from the OFF API response and maps to one of the 9 swap categories via `CATEGORY_TAG_MAP` using **exact tag matching** (not substring). The map uses a priority-ordered array — first match wins. `snacks` is last as the broadest catch-all.

**Critical**: use exact OFF tag values (e.g. `en:cheeses`, not `cheese`). Substring matching caused false positives — `en:cheese-flavored-snacks` would wrongly match dairy. Exact set lookup (`normalized.has(t)`) prevents this.

If no OFF tag matches, `productCategory` returns `null`. `SwapsScreen` falls back to a `FLAG_CATEGORY_MAP` derived from the top scan flag:
```js
const FLAG_CATEGORY_MAP = {
  trans_fats:          'condiments',
  seed_oils:           'snacks',
  conventional_crops:  'snacks',
  bioengineering:      'snacks',
  natural_flavors:     'snacks',
  synthetic_additives: 'snacks',
  gluten_grains:       'cereal',
  conventional_meat:   null,   // no product-category swap; user directed to local farm card
};
```
If both are null, the API returns all rows unfiltered.

### Randomization
The API shuffles matching rows before slicing to 3, so users see different products across sessions. The Google Sheet cache is stable for 1 hour; the shuffle is fresh per request.

### AI fallback
If 0 curated swaps exist for a category, Claude Sonnet is called to suggest 2-3 real products. The prompt is level-aware — Level 2 requires certification + no seed oils; Level 1 requires no synthetic additives or trans fats only.

### Adding new swap products
Add rows directly to the Google Sheet. The app picks them up within 1 hour (cache TTL). Always verify:
- No synthetic additives or trans fats (required for any level)
- No seed oils, conventional crops, or natural flavors (required for `swap_level=2`)
- `certifications` column uses exact strings only
- `category` column uses one of the 9 exact values

---

## Supabase

### Clients
Two separate clients — never mix them:

**`lib/supabase.js`** — client-side singleton
- Uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Subject to RLS — safe to expose to browser
- Used by: `ScannerScreen`, `ProfileScreen`, `lib/auth.js`, `lib/scanHistory.js`

**`lib/supabaseServer.js`** — server-side singleton (API routes only)
- Uses `SUPABASE_SERVICE_ROLE_KEY` (server-only env var — never `NEXT_PUBLIC_`)
- Bypasses RLS — **never import from client components or any file under `app/`**
- Used by: `pages/api/scan.js`
- Auth persistence disabled (`persistSession: false`) — no user session on server

Both return `null` when env vars are absent. Always null-check before using: `if (!supabase) return ...`

### Tables
- `profiles` — `id` (uuid, FK to auth.users), `stage`, `score`, `personal_flags` (jsonb), `user_level` (integer, 1 or 2)
- `scans` — `id`, `user_id` (FK), `barcode`, `product_name`, `verdict`, `scanned_at`
- `scan_cache` — barcode-level cache keyed by `(barcode, user_level)`:
  - `id`, `barcode`, `user_level` (1|2), `prompt_version` (integer)
  - `verdict`, `flags` (jsonb), `ingredients` (text), `cleared_by` (text|null)
  - `unverified_ingredients` (jsonb), `explanation` (jsonb — `{summary, details}`)
  - `unverified_reason` (text|null) — `'not_found'` | `'no_ingredients'` | `null`
  - `product_name`, `product_category` (text|null), `is_meat` (boolean, default false), `last_accessed_at`
  - Unique constraint on `(barcode, user_level)` — upserted on every fresh scan
  - Cache hit returns `source: 'cache'`; miss falls through to Open Food Facts
  - Invalidated by bumping `PROMPT_VERSION` in `lib/cacheVersion.js`
  - **RLS requirements**: service role key for writes (server-side, `scan.js`); anon SELECT policy required for client-side tap-to-verdict reads (`scanHistory.js`); no anon INSERT/UPDATE policies needed
- `unverified_ingredients` — team review queue for tokens not matched by any trigger:
  - `id`, `ingredient` (text, lowercase), `product_name`, `barcode`
  - `first_seen` (timestamptz), `occurrence_count` (integer)
  - Populated by `pages/api/scan.js` after each fresh scan (awaited, not fire-and-forget)

### Auth flow
- Email/password signup with `emailRedirectTo: ${origin}/auth/callback`
- `/app/auth/callback/page.jsx` handles PKCE code, token_hash OTP, and hash-fragment sessions
- Sign-out calls `clearScanLocalStorage()` to prevent data leaking between users

### Env vars needed
```
NEXT_PUBLIC_SUPABASE_URL=          # used by both clients
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # client-side only (safe to expose)
SUPABASE_SERVICE_ROLE_KEY=         # server-side only — NEVER use NEXT_PUBLIC_ prefix
ANTHROPIC_API_KEY=                 # server-side only
SWAP_SHEET_ID=                     # Google Sheet ID for swap products database
```

---

## localStorage Keys
| Key | Purpose |
|-----|---------|
| `bl_profile` | User profile (stage, flags, onboardingComplete) |
| `bl_scans` | Monthly scan counter `{ scanCount, resetDate }` |
| `bl_scan_history` | Last 10 scans array |
| `bl_total_scans` | Lifetime scan count integer |
| `bl_migrated` | Whether localStorage scans have been migrated to Supabase |
| `bl_nudges` | Dismissed onboarding nudge milestones |
| `bl_user_level` | User level (1 or 2) — set by `lib/userLevel.js` |

---

## API Routes

### POST /api/scan
- Body: `{ barcode: string, userLevel?: 1 | 2 }`
- Flow: validate → sanitize barcode → check `scan_cache` (return immediately on hit) → fetch Open Food Facts → normalize labels → map `categories_tags` → run `analyzeIngredients(text, labels, userLevel)` → call Claude for explanation (skipped when `verdict === 'unverified'`) → upsert `scan_cache` → return result
- Returns: `{ verdict, flags, clearedBy, productName, ingredients, barcode, source, found, labelsDetected, unverifiedIngredients, explanation, productCategory, unverifiedReason, isMeat, oliveCaveat }`
- `oliveCaveat`: boolean, `true` when the L2 organic path hits the olive oil adulteration branch. Not yet persisted to `scan_cache` (no column); cache hits always return `false` until the column is added.
- `productCategory`: one of the 9 swap categories or `null` if no OFF tag matched
- `unverifiedReason`: carries additional context for YELLOW and UNVERIFIED verdicts:
  - `'not_found'` — barcode not in the Open Food Facts database (`found: false`)
  - `'no_ingredients'` — product record exists in OFF but has no ingredient text (`found: true`)
  - `'cert_unconfirmed'` — verdict is YELLOW with no flags and no clearedBy, and every non-trivial ingredient is prefixed "organic" — product looks organic from the label text but USDA cert tag is missing from OFF. Signals VerdictScreen / Claude to use the "verify the seal" framing rather than the generic no-cert caveat.
  - `null` — verdict is red / yellow / green with no special context needed
- Claude is never called when `verdict === 'unverified'` — no ingredients to explain
- VerdictScreen renders a human-readable message card for unverified results (keyed on `unverifiedReason` + `isMeat`) instead of the AI summary, and shows a "Scan Again" button instead of "See Cleaner Swaps"
- At Level 2, the universal decision tree runs after `analyzeIngredients()` — see "Level 2 universal decision tree" in the Rules Engine section for the full 14-node spec
- **Pure-water GREEN path** (post-waterfall, both levels): after the L2 tree and cert_unconfirmed check, if `verdict === 'yellow' && flags.length === 0 && clearedBy === null` and every ingredient token is in `WATER_SAFE_INGREDIENTS` → set `verdict = 'green'` and `clearedBy = 'pure_water'`. Covers natural mineral water, spring water, artesian water, sparkling water. USDA organic cert is inapplicable to geological water sources; the `pure_water` clearance tells Claude not to mention cert at all.
- `isMeat: false` is included in the 404 not-found response for consistent response shape
- Uses `supabaseServer` (service role key) for all Supabase writes

### POST /api/explain
- Body: `{ verdict, flags, productName, ingredients, userLevel?: 1 | 2, clearedBy?: string | null, unverifiedReason?: string | null }`
- Calls Claude Sonnet with Sina-Joel voice system prompt
- Returns: `{ summary: string, details: { [category]: string } }`
- Exports `SYSTEM_PROMPT`, `buildUserMessage`, `PROMPT_VERSION` for use by `scan.js`
- VerdictScreen never calls this endpoint directly — explanation is always returned inline in the POST /api/scan response.
- **System prompt voice**: Sina McCullough (PhD Nutrition, autoimmune healing journey, science-first, rhetorical questions, inflammation/gut/gene-expression framing) + Joel Salatin (Polyface Farm, story-and-analogy thinker, farming-system angle). Together: empowering, not alarmist, skeptical of GRAS and industry-funded science.
- **Level-aware tone**: Level 1 users get encouragement and awareness-building framing; Level 2 users get direct, graduate-level honesty. Controlled by `[Level 1 awareness item]` note injected per flagged category in `buildUserMessage()`.
- **`flagsSection` in `buildUserMessage()` has six conditions** (checked in order; first match wins): (1) flags present → "Flagged categories: …" list; (2) no flags + verdict is `'red'` → certification-standards explanation (L2 uncertified conventional product — no USDA Organic or Non-GMO cert found; instruct Claude to be honest but not alarmist); (3) no flags + `verdict === 'yellow'` + `clearedBy === null` + `unverifiedReason === 'cert_unconfirmed'` → cert_unconfirmed branch: tells Claude the ingredients all look organic but the seal couldn't be confirmed in the database, and to encourage the user to flip the package and look for the USDA seal; return `"details": {}` (empty); (4) no flags + `verdict === 'yellow'` + `clearedBy === null` → default Yellow branch: instructs Claude to write Sina's honest no-cert framing into the `summary` field and return `"details": {}` (empty — no flag categories to render); (5) `clearedBy === 'pure_water'` → pure-water branch: tells Claude this is a pure water product (mineral/spring/artesian water), that USDA organic cert is literally inapplicable to geological water sources and must not be mentioned, give a clean warm GREEN explanation celebrating the simplicity; return `"details": {}` (empty); (6) no flags + any other verdict → "No concerning ingredients found — product passed all checks." Branch 3 fires before branch 4; branch 5 fires before branch 6. Yellow verdicts with `clearedBy` set (non-gmo-project-verified, glyphosate-free) fall through to branch 6. `default_yellow` is NOT a voice-assignment category and must never appear as a `details` key. `clearedBy` is the sixth parameter and `unverifiedReason` is the seventh parameter of both `buildUserMessage()` and `fetchExplanation()` (both default `null`).
- See Scan Cache Pattern section for current PROMPT_VERSION.

### Explanation Prompt Voice Assignment (v6+, updated v16)
Each flagged category is explained by ONE voice only. Sina owns: trans_fats, seed_oils, additives, natural_flavors, fortified_vitamins, natural_colorants, olive_oil_adulteration, default_yellow. Joel owns: conventional_crops, conventional_meat, conventional_eggs, bioengineering, glyphosate_heavy, conventional_dairy. Sina focuses on biochemistry and regulatory failure. Joel focuses on farming systems and food philosophy. Do not reassign voices without bumping PROMPT_VERSION.

**v10 additions**: glyphosate_heavy (Joel — pre-harvest desiccation angle, farming system choice, glyphosate-free cert signal), conventional_dairy (Sina — GMO feed/hormones/antibiotics biochemistry, organic as meaningful upgrade), olive_oil_adulteration (Sina — supply chain adulteration reality, caveat not condemnation). Inline `buildUserMessage()` annotations added for all three categories.

**v11 changes**: conventional_dairy moved from Sina to Joel (farming system angle — GMO feed, hormones, antibiotics; organic as signal that farmer chose differently). Fourth `flagsSection` branch added: `verdict === 'yellow' && flags.length === 0 && clearedBy === null` (default-Yellow node-14 products) — instructs Claude to write Sina's honest no-cert framing into the `summary` field and return `"details": {}` (empty). `default_yellow` is NOT a voice-assignment category and does NOT appear as a details key — the guidance is inline in the branch instruction only. `clearedBy` added as sixth parameter to `buildUserMessage()` and `fetchExplanation()` (default `null`); call sites in `scan.js` and the standalone `explain.js` handler updated accordingly.

**v13 changes**: cert_unconfirmed branch inserted before the default-Yellow branch in `flagsSection`. When `unverifiedReason === 'cert_unconfirmed'`, Claude is told the ingredients look organic but the seal couldn't be confirmed — frame as "verify the seal" rather than "no cert, can't rule out pesticides." `unverifiedReason` added as seventh parameter to `buildUserMessage()` and `fetchExplanation()` (default `null`); standalone `explain.js` handler updated to destructure and pass it from `req.body`. `allIngredientsPrefixedOrganic()` helper and `CERT_UNCONFIRMED_TRIVIAL` Set added to `scan.js` to detect products where every non-trivial ingredient starts with "organic" but USDA cert tag is absent from OFF.

**v16 changes**: `conventional_eggs` added as its own flag category. Joel owns the voice. `CONVENTIONAL_EGGS` trigger array added to `lib/rulesEngine.js` with `isPrecededByOrganic()` clearance and word-boundary guard. Added to `LEVEL_1_YELLOW_CATEGORIES` (caution/yellow at L1, reject/red at L2) and `ALL_TRIGGERS` (egg terms no longer appear as unverified). `conventional_eggs` flag carries actual matched ingredient (e.g. `'eggs'`), unlike injected flags. Node 8 in L2 tree no longer includes egg detection (`containsEggDerived` removed from scan.js imports and Node 8 condition). New Node 8b handles `conventional_eggs` flags. ConcernCard `CATEGORY_INFO` updated (🥚, "Conventional Eggs"). `conventional_eggs` annotation added to `buildUserMessage()`. PROMPT_VERSION bumped 13 → 16.

**v19 changes**: Pure-water GREEN path added. `WATER_SAFE_INGREDIENTS` Set (water forms, naturally occurring minerals, CO2) and `allIngredientsAreWaterSafe()` helper added to `scan.js`. Post-waterfall check after cert_unconfirmed: if `verdict === 'yellow' && flags.length === 0 && clearedBy === null && allIngredientsAreWaterSafe(ingredientsText)` → set `verdict = 'green'` and `clearedBy = 'pure_water'`. New sixth `flagsSection` branch in `buildUserMessage()` for `clearedBy === 'pure_water'` — tells Claude to give a clean GREEN explanation without any cert caveats (organic cert is inapplicable to geological water sources). PROMPT_VERSION bumped 18 → 19.

### GET /api/swaps
- Query params: `category` (one of 9 valid values, optional), `userLevel` (1 or 2, defaults to 2)
- Flow: check in-memory cache (1hr TTL) → fetch Google Sheet CSV if stale → filter by category → filter/tag by swap_level → shuffle → slice to 3 per tier → AI fallback if 0 results
- Returns: `{ swaps: SwapRow[], source: 'curated' | 'ai' }`
- Each swap row includes `tier: 'good' | 'better'` — used by SwapsScreen to render sections
- AI fallback prompt is level-aware — Level 2 requires certification + no seed oils; Level 1 requires no synthetic additives only

---

## Scan Cache Pattern

Cache is keyed on `(barcode, user_level, prompt_version)` — see the `scan_cache` table in the Supabase section for the full schema, and `POST /api/scan` for the hit/miss flow. `PROMPT_VERSION` is the single source of truth in `lib/cacheVersion.js` — import it from there, never from an API route file.

To invalidate the cache after a prompt change:
1. Bump `PROMPT_VERSION` in `lib/cacheVersion.js`
2. Run the SQL from `getCacheInvalidationSQL(newVersion)` in `lib/cacheUtils.js` against the Supabase DB
3. Deploy — new scans rebuild the cache at the new version

**Current PROMPT_VERSION is 19.**

### Cache Invalidation
When PROMPT_VERSION is bumped, run `getCacheInvalidationSQL()` from `lib/cacheUtils.js` in the Supabase SQL editor to purge stale cache rows. Current version is 19. Run `DELETE FROM scan_cache WHERE prompt_version < 19` in Supabase to purge all stale rows before deploying.

---

## Scan History Tap Pattern

Both `ScannerScreen` and `ProfileScreen` support tapping a history item to view its full verdict. The shared logic lives in `lib/scanHistory.js`:

```js
import { formatTime, createHistoryTapHandler } from '@/lib/scanHistory';

const handleHistoryItemTap = createHistoryTapHandler({
  supabase,
  userLevel,
  promptVersion: PROMPT_VERSION,
  onResult: onScanResult,
  tapInFlightRef,              // useRef(false) — synchronous concurrency guard
  setLoadingBarcode,
  setMissBarcode,
});
```

The `tapInFlightRef` guard is a ref (not state) because `onResult()` triggers navigation that unmounts the component. State setters on an unmounted component are no-ops in React 18; ref mutations are synchronous and survive unmount.

On a cache miss, a "Scan this product again to see the full report." message appears inline under the history item.

---

## Common Patterns

### All 'use client' components
Every component file starts with `'use client';` — this is App Router.

### No CSS modules, no Tailwind
All styles are inline `style={{}}` objects using the CSS variables.

### Button minimum touch target
All interactive elements: `minHeight: 44` (iOS HIG minimum).

### Amber gradient CTA (standard primary button)
```jsx
style={{
  background: 'linear-gradient(135deg, #D4872A 0%, #F0A83C 100%)',
  color: 'white', height: 56, borderRadius: 16,
  fontSize: 17, fontWeight: 700,
  boxShadow: '0 4px 16px rgba(212,135,42,0.35)',
}}
```

### Disabled / Coming Soon button
```jsx
style={{
  background: '#D1C9BC', color: '#9A8260',
  cursor: 'not-allowed', opacity: 0.7,
  height: 52, borderRadius: 12,
}}
disabled={true}
```

### ConcernCard CATEGORY_INFO contract

`ConcernCard.jsx` maintains a `CATEGORY_INFO` map keyed on engine category strings. Current keys: `seed_oils`, `conventional_crops`, `glyphosate_heavy`, `bioengineering`, `natural_flavors`, `synthetic_additives`, `trans_fats`, `gluten_grains`, `conventional_meat`, `conventional_dairy`, `conventional_eggs`, `fortified_vitamins`, `natural_colorants`, `olive_oil_adulteration`. If a new engine category is added without a matching key, the card silently falls back to a generic label and renders the raw category string. **Always update `CATEGORY_INFO` in `ConcernCard.jsx` when adding a new flag category to the rules engine.**

### L2 Universal Decision Tree (scan.js)

Level 2 users get a 14-node decision tree applied AFTER the rules engine runs. See "Level 2 universal decision tree" in the Rules Engine section for the full spec. Key points:

- Gluten_grains flags are stripped before the tree runs (paywall feature — same as L1)
- `ALWAYS_IGNORE_INGREDIENTS` terms are masked before ingredient-level helper checks run
- Products with no cert and no conventional ingredient signals default to **YELLOW** (node 14) — not RED
- Seafood (node 5) and game meat (node 6) have dedicated tree paths
- `conventional_dairy` (node 9) is a new injected flag category for milk-derived ingredients without organic cert
- `oliveCaveat: true` is set on the response when the organic path hits the olive oil node
- Conventional crops flags are stripped post-tree when `clearedBy === 'organic'`

**ALWAYS_IGNORE_INGREDIENTS** (exported from `lib/rulesEngine.js`): salt forms, water forms, calcium carbonate, magnesium oxide, yeast forms, live cultures, enzymes. Applied via `maskIgnoredIngredients()` in `scan.js` before calling `containsFortifiedVitamins`, `containsMilkDerived`, `containsEggDerived`. Sorted longest-first so specific forms are masked before shorter sub-strings.

**MILK_DERIVED_INGREDIENTS** (exported from `lib/rulesEngine.js`): compound dairy forms only — no bare `milk`, `cream`, or `butter` to prevent almond milk, cream of tartar, peanut butter false positives. Uses `matchesWholePhrase()` for word-boundary-aware matching. Includes: whole/skim/nonfat milk, milk powder/solids/protein concentrate, milkfat, heavy/sour/whipping cream, unsalted/salted/cultured butter, cheese, cheddar, mozzarella, parmesan, cream cheese, cottage cheese, whey (all forms), caseinate, casein, lactose, lactalbumin, lactoglobulin, yogurt, kefir, buttermilk, evaporated/condensed milk.

**EGG_DERIVED_INGREDIENTS** (exported from `lib/rulesEngine.js`): egg whites, egg yolk, dried/powdered/liquid egg, albumin, whole egg, eggs, egg. Uses `matchesWholePhrase()` — `eggplant` correctly returns false.

**FORTIFIED_VITAMINS** (56 ingredients): Detected by `containsFortifiedVitamins(maskedText)` in the L2 organic path. Contains synthetic B vitamins (niacin, niacinamide, riboflavin, thiamine variants, folic acid, pyridoxine hydrochloride, B6, B12, pantothenic acid, biotin, choline salts, inositol), fat-soluble vitamins (A palmitate/acetate, D2/D3, tocopherol forms, vitamin E, phytonadione, menaquinone, vitamin K), minerals (reduced iron, ferrous sulfate, zinc oxide/gluconate/sulfate, calcium carbonate/phosphate/citrate, magnesium forms, potassium iodide/phosphate, sodium iodide, copper salts, manganese sulfate, chromium picolinate, selenium forms, molybdenum), and amino acids/conditionally essential nutrients (taurine, l-carnitine, l-tryptophan, l-theanine, lysine). Note: `calcium carbonate` is in FORTIFIED_VITAMINS but also in ALWAYS_IGNORE_INGREDIENTS — masking prevents it from triggering YELLOW in the organic path for products that use it as a harmless mined mineral.

### Known Limitations
- ZBAR and similar products with organic asterisks in ingredient lists but no usda-organic label in Open Food Facts will not receive organic cert detection. Fix requires updating the OFF database for those barcodes, not a code change.
- Sodium citrate remains in SYNTHETIC_ADDITIVES — flagged as a potential false positive but deferred pending further review.
- `olive_oil_adulteration` ConcernCard entry added (icon 🫒, label "Olive Oil Quality") — previously the category key was missing from CATEGORY_INFO and the card fell back to the raw category string as label.

### L1 Verdict Overrides (scan.js)

Level 1 users get two explicit overrides applied after the engine runs, before the inconclusive check. (1) Gluten suppression: gluten_grains flags are removed from the flags array; verdict is recalculated from remaining flags (reject → red, caution → yellow, no flags → green). Gluten is a future paywall feature — do not wire it back into L1 or L2 logic. (2) Conventional meat caution: if isMeatProduct and verdict is not `'unverified'`, a `conventional_meat` caution flag is injected unconditionally — no cert check at L1, always educational yellow. The flag can upgrade green → yellow but cannot downgrade red. For everything else at L1, the engine's built-in level-aware verdict is used directly: trans_fats and additives return red; seed_oils, natural_flavors, conventional_crops, and bioengineering return yellow.

### Vercel serverless — always await Supabase writes before res.json()

**Critical pattern**: Vercel serverless functions freeze the execution context the moment `res.json()` is called. Any un-awaited promise is silently discarded.

```js
// ✅ Correct — awaited before res.json()
if (sb) {
  try {
    await sb.from('scan_cache').upsert({ ... });
  } catch (err) {
    console.error('scan_cache write failed:', err);
  }
}
return res.status(200).json({ ... });

// ❌ Wrong — promise is dropped when function terminates on res.json()
if (sb) {
  sb.from('scan_cache').upsert({ ... }).then(() => {}).catch(() => {});
}
return res.status(200).json({ ... });
```

This applies to **all** Supabase writes in API routes. Never use fire-and-forget in a Vercel serverless handler.

---

## Commit History (mvp-beta)

Earlier sessions: rules engine expansions (SB 25, EU additives, seed oils, conventional crops, gluten grains), swaps system build, certifications, cache write fix, prompt iterations — see `git log` for full history.

### Session — audit fixes (gluten_grains key, conventional_meat UI, flavor over-match, scan response shape)
| Hash | Description |
|------|-------------|
| `7d2fa42` | fix: audit fixes — gluten_grains key, conventional_meat UI, flavor over-match, scan response shape, CLAUDE.md cleanup |

### Session — prompt v4/v5 (restore full Sina/Joel voice depth)
| Hash | Description |
|------|-------------|
| `2bad2f6` | feat: v4 prompt — restore full v2 voice depth (distinct roles, signature phrases, level-specific instructions) on v3 plumbing |
| `d6ebd68` | feat: v5 prompt — restore shared philosophy paragraph, add explicit Sina/Joel self-introduction instruction |

### Session — add meat as 10th swap category
| Hash | Description |
|------|-------------|
| `d245abe` | feat: add meat as 10th swap category — VALID_CATEGORIES, CATEGORY_TAG_MAP, CLAUDE.md |

### Session — unverified ingredient triage (artifacts + red list)
| Hash | Description |
|------|-------------|
| `1ee5ca7` | feat: add artifact phrases and red list — polysorbates, phosphates, red 3, erythrosine |

### Session — inconclusive verdict + unverified queue triage
| Hash | Description |
|------|-------------|
| `d245abe` | feat: add meat as 10th swap category — VALID_CATEGORIES, CATEGORY_TAG_MAP, CLAUDE.md |
| `1ee5ca7` | feat: add artifact phrases and red list — polysorbates, phosphates, red 3, erythrosine |
| `b862d7f` | docs: log 1ee5ca7 in CLAUDE.md commit history |
| `01d11c5` | feat: add inconclusive verdict for all-unrecognized ingredient scans |

### Session — GLUTEN_GRAINS expansion (Sina clinical list)
| Hash | Description |
|------|-------------|
| `565b17b` | feat: expand GLUTEN_GRAINS with Sina clinical list — 65 new entries across corn derivatives, grain varieties, and processed ingredients |

### Session — Sina gluten expansion
| Hash | Description |
|------|-------------|
| `565b17b` | feat: expand GLUTEN_GRAINS with Sina clinical list — 65 new entries across corn derivatives, grain varieties, and processed ingredients |
| `468c2e0` | fix: scope 4 overlap-prevention tests to conventional_crops only |

### Session — L2 verdict waterfall + new ingredient groups
| Hash | Description |
|------|-------------|
| `691ff02` | feat: add FORTIFIED_VITAMINS and NATURAL_COLORANTS groups to rules engine |
| `839f361` | feat: implement L2 verdict waterfall in scan.js — cert gate, organic/non-organic paths, fortified vitamins, natural colorants, olive oil caution |

### Session — L1 explicit overrides
| Hash | Description |
|------|-------------|
| `0555b96` | feat: implement L1 explicit overrides in scan.js — gluten suppression, conventional meat caution injection |

### Session — L2 flags cleanup + rules engine false positive fixes
| Hash | Description |
|------|-------------|
| `7dcf575` | fix: strip gluten_grains and conventional_crops from L2 flags array — fixes organic verdict inflation and ConcernCard display bugs |
| `2904a6b` | fix: remove antioxidant false positive from SYNTHETIC_ADDITIVES |

### Session — FORTIFIED_VITAMINS expansion + fortification false positive cleanup
| Hash | Description |
|------|-------------|
| `0cf25ed` | feat: expand FORTIFIED_VITAMINS to 56 ingredients, remove fortification vitamins from SYNTHETIC_ADDITIVES |

### Session — PROMPT_VERSION 6: single voice per category
| Hash | Description |
|------|-------------|
| `8f05c05` | feat: v6 prompt — one voice per category, assign categories to Sina/Joel |

### Session — PROMPT_VERSION 8: restore Sina/Joel self-introduction in details JSON template
| Hash | Description |
|------|-------------|
| `c9a46dc` | feat: fix olive_oil_adulteration ConcernCard, inject fortified_vitamins and natural_colorants flags on L2 organic path, bump PROMPT_VERSION to 7 |
| `5eb9e78` | fix: restore Sina/Joel self-introduction in details JSON template, bump PROMPT_VERSION to 8 |

### Session — PROMPT_VERSION 9: handle red + empty flags in buildUserMessage
| Hash | Description |
|------|-------------|
| `a7fb831` | fix: handle red + empty flags case in buildUserMessage, bump PROMPT_VERSION to 9 |

### Session — Universal L2 decision tree
| Hash | Description |
|------|-------------|
| `846af6c` | feat: replace L2 waterfall with universal 14-node decision tree — ALWAYS_IGNORE_INGREDIENTS masking, MILK_DERIVED_INGREDIENTS, EGG_DERIVED_INGREDIENTS, conventional_dairy flag, seafood/game-meat nodes, oliveCaveat, 50 new tests |

### Session — GLYPHOSATE_HEAVY category + CONVENTIONAL_CROPS expansion
| Hash | Description |
|------|-------------|
| `5863e86` | feat: add GLYPHOSATE_HEAVY category — oats/wheat/barley/rye/legumes/flax/buckwheat/millet; expand CONVENTIONAL_CROPS with full corn/soy/potato/papaya/alfalfa/squash/cottonseed/sugarbeet lists; detection loop with organic clearance and glyphosate-free escape hatch; update ConcernCard; 11 new tests; 2045 rulesEngine + 135 scan = 2180 total |

### Session — PROMPT_VERSION 10: voice assignments for glyphosate_heavy, conventional_dairy, olive_oil_adulteration
| Hash | Description |
|------|-------------|
| `c5e1d8d` | feat: v10 prompt — add Joel voice for glyphosate_heavy (pre-harvest desiccation), Sina voice for conventional_dairy (GMO feed/hormones) and olive_oil_adulteration (supply chain); bump PROMPT_VERSION to 10; suite M (1 test); 2181 total |

### Session — VerdictScreen swap button verdict gate
| Hash | Description |
|------|-------------|
| `7593769` | fix: hide See Cleaner Swaps button on green verdicts — red/yellow → swaps, unverified/inconclusive → Scan Again, green → nothing |

### Session — PROMPT_VERSION 11: default Yellow branch + conventional_dairy to Joel
| Hash | Description |
|------|-------------|
| `2ccd6cd` | feat: v11 prompt — default Yellow branch (Sina, no-cert caveat); move conventional_dairy to Joel (farming system voice); add clearedBy param to buildUserMessage(); 2181 total |
| `4026bf8` | fix: add clearedBy param to fetchExplanation() — was undefined at buildUserMessage call site (fetchExplanation is a module-level helper, not the handler; clearedBy was in handler scope but never passed in) |
| `b146d44` | fix: default_yellow branch drives summary directly, not details key — remove default_yellow from voice assignment and SYSTEM_PROMPT guidance; instruct Claude to return details:{} for node-14 Yellow products; no PROMPT_VERSION bump, clear v11 cache manually |

### Session — REVIEWED_CLEAN_INGREDIENTS display filter
| Hash | Description |
|------|-------------|
| `15f7e19` | feat: add REVIEWED_CLEAN_INGREDIENTS — display-only Set filter suppressing known-clean whole foods from unverifiedIngredients output; export from rulesEngine; 5 new tests (block 35); 2186 total |

### Session — wild-caught detection via product name + PROMPT_VERSION 12
| Hash | Description |
|------|-------------|
| `b5c6be0` | feat: add detectWildCaught() — wild-caught detection via OFF label OR product name; farmed exclusions (farm-raised/atlantic salmon/astaxanthin); replace Node 5 in L2 tree; bump PROMPT_VERSION to 12; 4 new tests (suite N); 2190 total |

### Session — cert_unconfirmed + PROMPT_VERSION 13
| Hash | Description |
|------|-------------|
| `712baf8` | feat: cert_unconfirmed detection — allIngredientsPrefixedOrganic() helper; new unverifiedReason value; cert_unconfirmed branch in buildUserMessage(); 7th param threading through fetchExplanation() and explain.js handler; bump PROMPT_VERSION to 13; 4 new tests (suite O); 2194 total |

### Session — conventional_eggs as own category + PROMPT_VERSION 16
| Hash | Description |
|------|-------------|
| `9058727` | feat: add conventional_eggs category — CONVENTIONAL_EGGS trigger array in rulesEngine.js with isPrecededByOrganic() and word-boundary guard; LEVEL_1_YELLOW_CATEGORIES and ALL_TRIGGERS updated; Node 8b in L2 tree; remove egg detection from Node 8; ConcernCard 🥚 entry; Joel voice in explain.js; bump PROMPT_VERSION to 16; 4 new tests (suite P); L5 updated; 2198 total |

### Session — palm fruit oil added to SEED_OILS + PROMPT_VERSION 17
| Hash | Description |
|------|-------------|
| `0e394eb` | fix: add "palm fruit oil" to SEED_OILS trigger list — "palm oil" does not match "palm fruit oil" as a substring; placed near existing palm entries; bump PROMPT_VERSION to 17; 3 new rulesEngine tests; 2201 total |

### Session — detectWildCaught standalone wild signal + PROMPT_VERSION 18
| Hash | Description |
|------|-------------|
| `bc99e2d` | feat: extend detectWildCaught() with standalone "wild" word signal — /\bwild\b/ in product name (signal 3) and ingredients (signal 4); farmed exclusions unchanged; bump PROMPT_VERSION to 18; 4 new scan tests (suite Q); 1037 total |

### Session — pure-water GREEN path + PROMPT_VERSION 19
| Hash | Description |
|------|-------------|
| `5c71daf` | feat: pure-water GREEN path — WATER_SAFE_INGREDIENTS Set + allIngredientsAreWaterSafe() helper in scan.js; post-waterfall upgrade YELLOW→GREEN with clearedBy 'pure_water'; pure_water branch in buildUserMessage(); bump PROMPT_VERSION to 19; 4 new scan tests (suite R); 1041 total |

---

## What NOT to Do
- Do not install `@supabase/auth-helpers-nextjs` — it's a Pages Router package, breaks App Router builds
- Do not use `serverExternalPackages` in next.config.js — use `experimental.serverComponentsExternalPackages` (Next.js 14 key)
- Do not delete feature code — use `MVP_MODE` flags
- Do not use global MVP_MODE — keep it module-level per file
- Do not commit `.env.local`
- Do not import `lib/supabaseServer.js` from any client component or any file under `app/` — it holds the service role key
- Do not import `PROMPT_VERSION` from `pages/api/explain.js` — import it from `lib/cacheVersion.js` (API route named exports can resolve as `undefined` under certain Next.js bundling scenarios)
- Do not prefix `SUPABASE_SERVICE_ROLE_KEY` with `NEXT_PUBLIC_` — that would expose it to the browser
- Do not use substring matching for OFF category tags — use exact set lookup (`normalized.has(t)`). Substring matching causes false positives (e.g. `en:cheese-flavored-snacks` matching dairy).
- Do not add new swap categories without updating `VALID_CATEGORIES` in `pages/api/swaps.js` and `CATEGORY_TAG_MAP` in `pages/api/scan.js` (current 10 swap categories: `chips`, `snacks`, `cereal`, `condiments`, `beverages`, `dairy`, `bread`, `frozen`, `cooking_oils`, `meat`)
