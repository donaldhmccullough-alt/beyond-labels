# Beyond Labels — Claude Code Project Memory

## What This App Is
Beyond Labels is a mobile-first food ingredient scanner app. Users scan a product barcode, the app fetches ingredients from Open Food Facts, runs them through a deterministic rules engine, and returns a red/yellow/green verdict with AI-generated plain-language explanations in the voice of hosts Sina McCullough (PhD nutritionist) and Joel Salatin (regenerative farmer).

---

## Tech Stack
- **Framework**: Next.js 14 (App Router for UI, Pages Router for API routes)
- **React**: 18.3
- **Database/Auth**: Supabase JS v2 (`@supabase/supabase-js`) — no auth-helpers package
- **Barcode scanning**: `@zxing/library` 0.21.3
- **AI explanations**: `@anthropic-ai/sdk` — Claude Sonnet, called from `/pages/api/scan.js` (inline) and `/pages/api/explain.js` (standalone endpoint). Model string is centralized in `lib/aiConfig.js` (`ANTHROPIC_MODEL`) — update it there when upgrading models; do not hardcode the string in individual API files.
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
    DisclaimerModal.jsx   — bottom-sheet disclaimer modal; checks/sets bl_disclaimer_accepted in localStorage; used on first launch (app/page.jsx) and from Profile screen
    PrivacyPromiseModal.jsx — bottom-sheet "Our Privacy Promise" modal; same pattern as DisclaimerModal; called from Profile screen Legal & Privacy section
  auth/
    AuthModal.jsx         — sign in / sign up modal

lib/
  rulesEngine.js          — deterministic ingredient analysis engine (core logic)
  rulesEngine.test.js     — Jest tests for rules engine (35 describe blocks; 2050 tests total; block 20 = SYNTHETIC_ADDITIVES bucket-1 expansion (91 tests); block 21 = FD&C "No." normalization (19 tests); block 22 = mechanically separated meat (3 tests); block 23 = interesterified variants, lake forms, dye synonyms, new E-numbers, stearyl emulsifiers, cyclamate (78 tests); block 24 = synonym/E-number expansion: nitrates, BVO, bleaching agents, BHA/BHT names, SLS, E-numbers e320/e321/e924/e950–e955 (50 tests); block 25 = gluten grains expansion: ancient grains, botanical names, asafoetida/hing, smoke flavoring, brown rice syrup (34 tests); block 26 = H2: artifact phrases and red list additions — polysorbates, synthetic phosphates, red 3/#-normalizer (17 tests); block 27 = I: Sina gluten expansion — 65 new GLUTEN_GRAINS entries across corn derivatives, wheat flour varieties, barley/rye/oat forms, processed ingredients (22 tests); block 28 = FORTIFIED_VITAMINS group — synthetic vitamin fortification detection (61 tests); block 29 = NATURAL_COLORANTS group — plant-derived colorant detection (12 tests); block 32 = containsMilkDerived, containsEggDerived, ALWAYS_IGNORE_INGREDIENTS — new helper functions and ignore-list constant (32 tests); block 33 = GLYPHOSATE_HEAVY — high-glyphosate-risk crops: pea protein, oat milk, buckwheat, ascorbic acid, lecithin, potato starch, papaya, glyphosate-free escape hatch for oats/wheat, GLYPHOSATE_HEAVY export (11 tests); block 34 = CONVENTIONAL_CROPS_NO_FLAG — sunflower lecithin range-claim without flag (5 tests); block 35 = REVIEWED_CLEAN_INGREDIENTS — display-only suppression filter, Set export, almond flour/arrowroot suppressed, unknown ingredient still surfaces, engine flags/verdict unaffected (5 tests))
  __tests__/api/scan.test.js — Jest integration tests for /api/scan handler (18 suites A–R; 156 tests total; suite H = L2 decision tree coverage: cert gate, organic path, non-organic path, seafood/meat/dairy logic, isMeatProduct detection, L2 organic requirement, L1 no-op — 16 tests; suite I = inconclusive verdict: all ingredients unrecognized — 3 tests; suite J = L1 explicit overrides — gluten suppression, conventional meat caution injection (8 tests); suite K = L2 flags array cleanup — gluten suppression and organic conventional_crops strip (5 tests); suite L = universal L2 decision tree — 17 integration scenarios covering all 14 nodes plus 11b (L5 updated: eggs now produce conventional_eggs not conventional_meat; L16/L17 added for the glyphosate_heavy-reject-forces-red fix and its glyphosate-free-downgrade regression guard); suite M = PROMPT_VERSION contract — 1 test; suite N = wild-caught detection — product name signals, farmed exclusions, seed oil short-circuit (4 tests); suite O = cert_unconfirmed — all-organic ingredient prefix detection, trivial ingredient exclusion, non-organic partial mix, usda-organic cert bypass (4 tests); suite P = conventional_eggs — non-meat product with eggs, organic prefix clearance, meat+eggs both flags, dairy-only no-interference (4 tests); suite Q = detectWildCaught standalone wild signal — product name only, ingredients signal, non-seafood unaffected, astaxanthin farmed exclusion (4 tests); suite R = pure-water GREEN path — artesian water + minerals, sparkling water, water+natural-flavor regression, coconut water non-match (4 tests))
  ── Combined test total: 1,222 tests (1,034 rulesEngine + 177 scan + 11 explain) — corrected July 2026; the
     previously documented 2,731 figure was inflated by summing jest runs across stale
     .claude/worktrees/ copies of the test files alongside the real root-only source of truth ──
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
  explain.js              — POST verdict/flags → Claude API → plain-language explanation (standalone; also exports SYSTEM_PROMPT, buildUserMessage, parseExplanationResponse)
  __tests__/api/explain.test.js — Jest tests for parseExplanationResponse() and the standalone handler (11 tests: clean/fenced/truncated Claude responses, input validation)
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
// Set<string> — {'seed_oils', 'conventional_crops', 'conventional_eggs', 'glyphosate_heavy', 'bioengineering', 'natural_flavors'}
// Trans fats and SYNTHETIC_ADDITIVES are intentionally excluded — always red at both levels.
// Imported by VerdictScreen and explain.js (single source of truth)
```

### Text preprocessing (inside `analyzeIngredients`)
Before any trigger matching, the raw ingredient string is normalized in four steps, producing the shared `ingredientTextCleaned` variable (original casing preserved) that both the trigger-matching `text` and the unverified-token derivation (`parseIngredientTokens()`) are built from — so the two pipelines can't drift apart on what counts as a real ingredient:
1. **`stripAllergenAdvisory()`** — strips "may contain"/"contains:"/"manufactured on a line"/"produced in a facility" disclaimers, trailing certification-note sentence fragments (e.g. `". Organic."`), and — since PROMPT_VERSION 30 — "manufactured by: [company] [address]" (stripped through the next newline only, deliberately with **no** end-of-string fallback, since a real ingredient could otherwise be silently swallowed if it follows on the same line with no other separator) and "this product is made in a [...] facility [...]." (a distinct wording variant of the existing "produced in a facility" pattern). See `lib/rulesEngine.js` for the full regex set.
2. **`stripPurposeNoteParentheticals()`** — strips parenthetical purpose-notes that explain *why* an ingredient is present rather than *what* it is (e.g. `"vegetable juice (for color)"`, `"ascorbic acid (to preserve freshness)"`), so they never become their own fake token or interrupt a trigger-phrase match. Distinguishes a purpose note from a real sub-ingredient parenthetical (e.g. `"chocolate chips (unsweetened chocolate, sugar, cocoa butter)"`) by requiring the content to start with `for`/`to` immediately after the opening paren — no real ingredient name begins that way. Collapses any double space left behind so a trigger phrase spanning the removed note (e.g. `"canola (for cooking) oil"` → `"canola oil"`) still matches correctly.
3. **"No." stripping** — `/\bno\.\s+/gi` removes the FD&C ordinal suffix so label strings like `"FD&C Red No. 40"` → `"FD&C Red 40"` and then match the existing `red 40` trigger. Covers all FD&C dyes and `Citrus Red No. 2`. `\b` prevents the regex from firing inside words (e.g. "Casino."). The fix lives in `analyzeIngredients`, **not** in `scan.js`, because `scan.js` passes the raw OFF ingredient text directly — this ensures every caller (tests, future endpoints) gets consistent behavior automatically.
4. **Lowercase** — the entire string is lowercased for case-insensitive trigger matching (this step is `text`-only — `parseIngredientTokens()` receives the original-cased `ingredientTextCleaned` so `unverifiedIngredients` output preserves label casing for display).

`parseIngredientTokens()` itself also strips a leading Oxford-comma conjunction (`/^and\s+/i` — e.g. `"...X, and Y"`'s last token `"and Y"` → `"Y"`), leading `*`/`NN%`, and trailing `.*[])` from each token. The conjunction strip is whitespace-anchored so it can't match a real ingredient name that merely starts with the letters "and" (e.g. `"andouille sausage"` has no space between "and" and "ouille").

### Categories
1. **TRANS_FATS** — always red at both levels; no clearance
2. **SEED_OILS** — Level 2: red; Level 1: yellow; no organic clearance. Uses `findMatches()` directly (not `matchAndClaim()`) so a match rejected by the `isInFreeOrNonContext()` guard (e.g. `"canola-free"`) is not claimed either, leaving the range available to other categories.
3. **CONVENTIONAL_CROPS** — Level 2: red; Level 1: yellow; clearable by `usda-organic` label, `non-gmo-project-verified` label, or "organic" word prefix on the ingredient
4. **BIOENGINEERING_TERMS** — Level 2: red; Level 1: yellow; first match only
5. **NATURAL_FLAVORS** — Level 2: red; Level 1: yellow; no clearance
6. **SYNTHETIC_ADDITIVES** — always red at both levels; no clearance; expanded with ~200 additional EU n/n triggers. Category string: `'additives'` (the engine loop emits `category: 'additives'`; `ConcernCard` maps both `'additives'` and `'synthetic_additives'` to the same display for backwards-compatibility). Includes lake dye forms (e.g. `yellow 5 lake`), chemical name synonyms (e.g. `tartrazine`, `allura red`), 22 E-numbers, stearyl ester emulsifiers, bare `cyclamate`, and a **"Processing methods"** section: `mechanically separated meat`. PRIORITY_ADDITIVES pre-pass runs before SEED_OILS; contains `interesterified palm oil`, `interesterified soybean oil`, `brominated vegetable oil`, and `soya lecithin` (added to prevent `lecithin` in CONVENTIONAL_CROPS from claiming the suffix first). The bare `flavor` trigger uses a **word-boundary guard** in the SYNTHETIC_ADDITIVES loop.
6b. **GLYPHOSATE_HEAVY** — Level 2: red; Level 1: always caution (yellow). Category string: `'glyphosate_heavy'`. Covers crops where glyphosate is routinely used as a pre-harvest desiccant: oats and oat derivatives, wheat and wheat derivatives (moved from old CONVENTIONAL_CROPS), barley and malt derivatives (moved from old CONVENTIONAL_CROPS), lentils, peas, edible beans, flax/linseed, rye, buckwheat, millet. Clearance: `usda-organic` label OR organic ingredient prefix → skip entirely; `glyphosate-free` label → flag stays but downgraded to caution (YELLOW). **bare `malt` guard**: if character immediately after the match is a letter, skip (prevents false positives in `maltodextrin`, `maltose`). **`isInFreeOrNonContext()` guard** (added PROMPT_VERSION 30): skips matches inside a `"-free"`/`" free"`/`"non-"`/`"non "` claim (e.g. `"wheat-free"`, `"barley-free"`, `"rye-free"`) — see the shared-helper note under GLUTEN_GRAINS below for the full list of categories this now applies to. Detection loop runs between CONVENTIONAL_CROPS and BIOENGINEERING. Included in `LEVEL_1_YELLOW_CATEGORIES` and `LEVEL_1_YELLOW_TRIGGERS`.
7. **GLUTEN_GRAINS** — soft flag (caution/yellow only at both levels). Category string: `'gluten_grains'` (not `'gluten'`).
   - **Flags every match**, not just the first — a product with wheat flour, oats, and barley malt gets three separate `gluten_grains` flags.
   - **Bypasses the claiming system entirely** — runs `findMatches(text, GLUTEN_GRAINS, [])` with an empty blocked-ranges list, so no prior category can suppress a grain match. Prolamin protein is an independent concern from pesticide exposure, bioengineering, or seed-oil content.
   - Organic/Non-GMO clearance does **not** suppress GLUTEN_GRAINS flags — organic wheat is still a prolamin concern.
   - **Broader prolamin definition**: rice entries (`whole grain brown rice flour`, `rice flour`, `rice`, etc.) are included because rice prolamins (oryzin) can trigger sensitivity in celiac and non-celiac gluten-sensitive individuals. Added `whole grain brown rice flour` (shadows `rice flour` and `brown rice` at the same position). Also added `malt flavor` to the barley/malt section.
   - **Sina clinical list expansion** (65 new entries): corn derivatives (`high fructose corn syrup`, `corn syrup`, `hydrolyzed corn protein`, `corn oil`, `corn gluten`, `polenta`, `zea mays`, etc.); wheat flour varieties (`whole wheat flour`, `bread flour`, `self-rising flour`, `pastry flour`, `cake flour`, `all-purpose flour`, `tipo 00 flour`); barley varieties (`pearl barley`, `barley flour`, `barley flakes`, `hulled barley`, etc.); rye varieties (`pumpernickel`, `cereal rye`, `ryegrass`, `white/light/medium/dark rye`); oat varieties (`steel-cut oats`, `oat groats`, `quick oats`, `instant oats`, `scottish oats`, `sprouted oats`); sorghum varieties (`grain sorghum`, `sweet sorghum`, `broomcorn`); corn-derived sweeteners (`maltodextrin`, `dextrose`, `fructose`, `glucose syrup`, `maltose`, `vanillin`, `sorbitol`, `xanthan gum`); processed/ambiguous ingredients (`modified food starch`, `food starch`, `pregelatinized starch`, `hydrolyzed vegetable protein`, `textured vegetable protein`, `vegetable gum`, `soy sauce`, `miso`, `dextrin`, `baking powder`). Double-flagging with CONVENTIONAL_CROPS or SYNTHETIC_ADDITIVES is acceptable by design — GLUTEN_GRAINS bypasses the claiming system.
   - **Three false-positive filters** applied per match before a flag is emitted:
     1. `isPrecededBySourceNote()` — skips grains that appear in source-disclosure parentheticals, e.g. "maltodextrin (made from corn)" does not flag "corn".
     2. `isOilDerivative()` — skips a grain word immediately followed by ` oil` (e.g. "corn" inside "corn oil"). Refined oils carry no meaningful prolamin and are already covered by SEED_OILS.
     3. `isInFreeOrNonContext()` (added PROMPT_VERSION 30) — skips a grain word inside a `"-free"`/`" free"`/`"non-"`/`"non "` claim, e.g. `"corn-free"`, `"wheat-free"`.

   **`isInFreeOrNonContext(text, index, end)`** — shared helper (`lib/rulesEngine.js`, alongside `isPrecededByOrganic()`/`isPrecededBySourceNote()`) that generalizes a guard originally written narrowly for the bare `"gmo"` trigger in `BIOENGINEERING_TERMS` into a single reusable check applied across every bare-word trigger category: `SEED_OILS`, `CONVENTIONAL_CROPS`, `CONVENTIONAL_EGGS`, `GLUTEN_GRAINS`, `GLYPHOSATE_HEAVY`, and `BIOENGINEERING_TERMS`'s own `"gmo"` trigger (now calling the shared function instead of its own inline copy). A bare-word trigger match immediately preceded by `"non-"`/`"non "` or immediately followed by `"-free"`/`" free"` asserts the *absence* of the ingredient (e.g. "egg-free facility," "canola-free," "non-GMO") and must not produce a flag — confirmed real false positives this closed: `egg-free` → `conventional_eggs`, `corn-free`/`wheat-free`/`barley-free`/`rye-free` → `gluten_grains`/`glyphosate_heavy`, `canola-free` → `seed_oils` (an `INSTANT_RED_CATEGORIES` member — this alone could force a product red from a facility disclaimer with zero real ingredient concern), `sugar-free` → `conventional_crops`. The existing letter-adjacency word-boundary guard on `CONVENTIONAL_EGGS` (protects `"eggplant"`) is unrelated and stays in place alongside this new check — a hyphen is not a letter, so that guard alone never caught the `"-free"` case.

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
| 5 | `isSeafood` AND no reject-severity flag already present AND `detectWildCaught()` returns true (OFF label OR product name contains wild-caught signal, no farmed exclusions) — **both the `isSeafood` gate and the reject-flag gate were added PROMPT_VERSION 29, see changelog; before that, this node had neither and could silently force GREEN over a real reject flag on any product, seafood or not** | GREEN | `'wild-caught'` |
| 5b | `isSeafood` + no wild-caught signal detected | RED (inject `conventional_meat` flag) | null |
| 6 | Game meat category (`en:game-meats`) | GREEN | null |
| 7 | `non-gmo-project-verified` label | YELLOW | `'non-gmo-project-verified'` |
| 8 | `isMeat` (non-seafood, non-game) | RED (inject `conventional_meat` flag) | null |
| 8b | `conventional_eggs` flag present (from engine) | RED (no injection — engine already has flag with matchedIngredient) | null |
| 9 | `containsMilkDerived(maskedText)` | RED (inject `conventional_dairy` flag) | null |
| 10 | `conventional_crops` flag present | RED | null |
| 11 | `bioengineering` flag present | RED | null |
| 11b | `glyphosate_heavy` flag present with `severity: 'reject'` (added PROMPT_VERSION 24 — see changelog; mutually exclusive with node 12 by construction, since the engine already downgrades this flag's own severity to `'caution'` when `glyphosate-free`/`usda-organic` clearance applies) | RED | null |
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

**⚠️ Keeping the tree in sync with the engine — required reading before adding a new reject-severity category:**
Every category `analyzeIngredients()` can emit with `severity: 'reject'` at Level 2 MUST have a
corresponding check in this tree (either via `INSTANT_RED_CATEGORIES`, or an explicit
`flags.some(f => f.category === '...')` node like 8b/10/11/11b). If a new reject category is added
to `lib/rulesEngine.js` without a matching node here, a product whose *only* concern is that
category will silently fall through to Node 14's default **YELLOW** instead of RED — the engine's
own flag object will still correctly say `severity: 'reject'`, but the top-level verdict will be
wrong, and the mismatch is easy to miss because products that also carry *any other* checked reject
category still show RED (masking the gap). This has now happened twice: `glyphosate_heavy` shipped
in an earlier session (GLYPHOSATE_HEAVY category) without a tree node, undetected until a July 2026
production-data investigation found "Unsweetened Cereal" (860002152400) — a product whose sole flag
was a reject-severity `glyphosate_heavy` — cached as verdict `yellow`. Fixed at Node 11b,
PROMPT_VERSION 24. **When adding a new reject-severity category to the engine, add a tree node in
the same change**, and add a Suite L test asserting the top-level `verdict` (not just the flag's own
`severity` field) for a product whose *only* flag is that new category.

**Key behaviour changes from the previous cert-gate waterfall:**
- Products with no cert AND no conventional ingredient signals now default to **YELLOW** (node 14), not RED. "Pistachios, salt" is yellow not red.
- Seafood and game meat have dedicated nodes — no conventional_meat flag for wild-caught fish or venison.
- Conventional dairy (`conventional_dairy` flag) is now a distinct tree node separate from conventional meat.
- Conventional eggs (`conventional_eggs` flag) have their own Node 8b — no longer merged into the `conventional_meat` node. Products like ravioli, pasta, and cookies with egg ingredients get `conventional_eggs` (not `conventional_meat`). The flag comes from the rules engine (not scan.js injection) and carries the actual matched ingredient string.
- Egg ingredients are detected by the rules engine (CONVENTIONAL_EGGS loop with `isPrecededByOrganic()` guard, a letter-adjacency word-boundary guard, and — since PROMPT_VERSION 30 — the shared `isInFreeOrNonContext()` guard so `"egg-free"` facility disclaimers don't false-flag) and handled at Node 8b — separate from conventional_meat. Products like ravioli, pasta, and cookies with egg ingredients get a `conventional_eggs` flag (not `conventional_meat`). "organic eggs" as an ingredient prefix clears the flag at engine level. `containsEggDerived()` is still exported from rulesEngine but no longer used in scan.js.
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
- **The function itself has no category awareness** — it is a pure text-signal detector; signals 3 and 4 fire on the bare word "wild" appearing *anywhere*, including non-seafood products ("wild rice," "wild honey," "wild mushrooms," "wild oats," "wild blueberries"). It relies entirely on its caller to have already established seafood relevance. **PROMPT_VERSION 29 fixed a bug where Node 5 was calling this with no such gate at all** — see "Level 2 universal decision tree" Node 5 row and the changelog entry below. Do not add a new call site for `detectWildCaught()` without first gating on `isSeafoodProduct(categoriesTags)` and confirming no reject-severity flag is already present, or the same bug class will recur.

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
| `bl_disclaimer_accepted` | Set to `'1'` when user accepts the first-launch disclaimer; checked on mount in `app/page.jsx` to suppress re-showing |

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
- **Inconclusive verdict** (runs before the L2 tree, which explicitly skips `unverified`/`inconclusive` results): if `ingredientsText !== null && verdict === 'green' && <flags excluding gluten_grains>.length === 0 && unverifiedIngredients.length > 5` → `verdict = 'inconclusive'`. The `> 5` figure is a proxy threshold, not a literal "100% unrecognized" check — see the July 2026 PROMPT_VERSION 26 changelog entry for the history. **⚠️ The "no real flags" check must exclude `gluten_grains`, kept in sync with the `activeFlags` filter `analyzeIngredients()` uses for its own verdict field** (`lib/rulesEngine.js`, gluten is a paywall feature excluded from verdict calc at both levels by design). `analyzeIngredients()` excludes `gluten_grains` from *its own* verdict but does **not** strip `gluten_grains` entries out of the `flags` array it returns — that stripping only happens later, in the L2 tree's own gluten-stripping pre-processing step. Checking the raw `flags` array here (instead of a gluten_grains-excluded set) let any product containing a gluten grain skip the `> 5` check entirely, regardless of its actual unverified-ingredient count — fixed at PROMPT_VERSION 26. If `analyzeIngredients()`'s verdict-exclusion list ever changes (e.g. a new paywalled/excluded category is added), update this check to match, or it will silently drift the same way again.
- **Pure-water GREEN path** (post-waterfall, both levels): after the L2 tree and cert_unconfirmed check, if `verdict === 'yellow' && flags.length === 0 && clearedBy === null` and every ingredient token is in `WATER_SAFE_INGREDIENTS` → set `verdict = 'green'` and `clearedBy = 'pure_water'`. Covers natural mineral water, spring water, artesian water, sparkling water. USDA organic cert is inapplicable to geological water sources; the `pure_water` clearance tells Claude not to mention cert at all.
- `isMeat: false` is included in the 404 not-found response for consistent response shape
- Uses `supabaseServer` (service role key) for all Supabase writes

### POST /api/explain
- Body: `{ verdict, flags, productName, ingredients, userLevel?: 1 | 2, clearedBy?: string | null, unverifiedReason?: string | null }`
- Calls Claude Sonnet with Sina-Joel voice system prompt
- Returns: `{ summary: string, details: { [category]: string } }`
- Exports `SYSTEM_PROMPT`, `buildUserMessage`, `PROMPT_VERSION`, `parseExplanationResponse` for use by `scan.js`
- VerdictScreen never calls this endpoint directly — explanation is always returned inline in the POST /api/scan response.
- **`parseExplanationResponse(rawText)`** — shared helper (added July 2026) that both this endpoint and `fetchExplanation()` in `scan.js` call to parse Claude's raw text into `{ summary, details }`. Tries `JSON.parse()` directly first; if that fails, tries regex-extracting a balanced `{...}` block (recovers from a markdown code fence or stray prose around the JSON) and parsing that. If **neither** succeeds — most commonly a genuine mid-generation truncation with no closing `}` anywhere in the text — returns `null`. Callers must treat `null` the same as any other explanation failure: `fetchExplanation()` already returns `null` for a missing API key or any other error, and this endpoint's handler returns the same `502 { error: 'Failed to generate explanation.' }` shape used for other Claude-call failures. **Never** falls back to stuffing the raw, unparsed text into `summary` — that was the bug (see changelog: raw truncated JSON, including a literal `` ```json `` fence and an unescaped `{`, was being served as the user-facing summary for any product whose explanation response got cut off mid-generation, most commonly multi-flag-category products needing a longer response).
- `max_tokens: 2000` at both call sites (raised from `1000`) — a summary plus one detailed explanation per flagged category, each requiring specific per-category framing (see `buildUserMessage()`), can plausibly exceed 1000 tokens for products with 3+ flagged categories. The JSON template's `summary` field instruction was also strengthened to explicitly forbid listing multiple issues in the summary itself ("if you find yourself naming more than one specific ingredient or category in the summary, stop and move that content into `details` instead") — the corrupted production response that surfaced this bug showed Claude drifting into listing all three flagged issues inside `summary` itself, eating into the token budget meant for `details`.
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

**Current PROMPT_VERSION is 38** (false-negative sweep fix — cowpeas/broadbeans/horsebeans — see the "false-negative sweep fix" changelog entry below). Committed and pushed this session; not yet empirically re-confirmed live against production `scan_cache` the way v32 was — per the deploy-gap incident documented below, treat "committed" and "confirmed deployed" as separate claims until a fresh live scan is checked post-deploy.

### Cache Invalidation
When PROMPT_VERSION is bumped, run `getCacheInvalidationSQL()` from `lib/cacheUtils.js` in the Supabase SQL editor to purge stale cache rows. Current version is 30. Run `DELETE FROM scan_cache WHERE prompt_version < 30` in Supabase to purge all stale rows before deploying.

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

Level 1 users get three explicit overrides applied after the engine runs, before the inconclusive check. Override helpers (`isSeafoodProduct`, `isGameMeatProduct`, `maskIgnoredIngredients`, `containsMilkDerived`) are pre-computed at the top of the L1 block.

**(1) Gluten suppression**: gluten_grains flags are removed from the flags array; verdict is recalculated from remaining flags (reject → red, caution → yellow, no flags → green). Gluten is a future paywall feature — do not wire it back into L1 or L2 logic.

**(2) Meat handling** (mirrors L2 nodes 5 and 6): if `isMeatProduct` and verdict is not `'unverified'` — three branches, first match wins:
- Wild-caught seafood (`isSeafoodProduct && detectWildCaught(...)` returns true) → **skip injection** — leave verdict and flags unchanged (mirrors L2 node 5).
- Game meat (`isGameMeatProduct`) → **skip injection** — leave verdict and flags unchanged (mirrors L2 node 6).
- All other meat (conventional, farmed seafood) → inject `conventional_meat` caution flag; upgrade green → yellow. Cannot downgrade red.

**(3) Conventional dairy caution** (mirrors L2 node 9, softened): if no `usda-organic` label AND `containsMilkDerived(maskedText)` returns true AND verdict is not `'unverified'` — inject `conventional_dairy` caution flag. Upgrade green → yellow. Does not downgrade red. Caution severity only (not reject).

For everything else at L1, the engine's built-in level-aware verdict is used directly: trans_fats and additives return red; seed_oils, natural_flavors, conventional_crops, and bioengineering return yellow.

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

### Session — fix silent scan_cache write failure (lazy Supabase client init)
| Hash | Description |
|------|-------------|
| (pending) | fix: convert `lib/supabaseServer.js` from module-load-time client initialization to a lazy `getSupabaseServer()` function; update `pages/api/scan.js` to call it inside the request handler instead of importing a pre-initialized client; fixes silent scan_cache write failures caused by `sb` resolving to `null` at cold start when env vars weren't yet available — ~100+ scans from the June 29 2026 session were lost and unrecoverable; all 2,731 tests pass |

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

### Session — L1 parity: wild-caught seafood, game meat, conventional dairy + PROMPT_VERSION 20
| Hash | Description |
|------|-------------|
| `952f5e0` | feat: L1 parity — wild-caught seafood and game meat skip conventional_meat injection (mirrors L2 nodes 5/6); new Override 3 injects conventional_dairy caution for uncertified milk-derived products (mirrors L2 node 9, softened); L1 conventional_dairy annotation in buildUserMessage(); bump PROMPT_VERSION to 20; 6 new scan tests (suite S); 1047 total |

### Session — allergen advisory stripping, yogurt culture ignore list, flag deduplication + PROMPT_VERSION 21
| Hash | Description |
|------|-------------|
| (pending) | fix: allergen advisory stripping in analyzeIngredients() — 5 regex patterns strip "may contain", "manufactured on a line", "produced in a facility", "contains:" phrases before trigger matching; yogurt culture strains added to ALWAYS_IGNORE_INGREDIENTS (24 new entries: Lactobacillus/Bifidobacterium/Streptococcus strain names, rennet, pectin); rawUnknownTokens filter extended to also exclude ALWAYS_IGNORE_INGREDIENTS terms (prevents inconclusive verdict on organic yogurt); flag deduplication by (category, matchedIngredient) before verdict calculation; bump PROMPT_VERSION to 21; 7 new rulesEngine tests (blocks 38–40); 1048 total |

### Session — staged batch Changes 1–12 (pending PROMPT_VERSION bump)
> **STAGED — do not bump PROMPT_VERSION until batch is reviewed and approved.**

| Change | Description |
|--------|-------------|
| 1 | `parseIngredientTokens()` — strip leading `*` (asterisk) from tokens before trigger matching |
| 2 | `parseIngredientTokens()` — strip trailing `)` in addition to `.` `*` `[` `]` |
| 3 | `rawUnknownTokens` filter — inline `corn` exclusion (handled by standalone corn regex; absent from ALL_TRIGGERS by design) |
| 4 | SYNTHETIC_ADDITIVES — add: `caffeine`, `cultured celery extract`, `cultured onion juice`, `cherry powder`, `disodium succinate`, `erythorbic acid`, `ester gum`. `fd&c yellow #5/5`, `fd&c red 40`, `fd&c blue 1/2`, `fd&c red 3` already covered by existing triggers + `#(digit)` preprocessing. |
| 5 | FORTIFIED_VITAMINS — add `ferric phosphate`. (`cyanocobalamin`, `d-alpha-tocopherol`, `ferrous sulfate` already present.) |
| 6 | (covered by 5 — cyanocobalamin and d-alpha-tocopherol confirmed already present) |
| 7 | NATURAL_COLORANTS — add: `annatto color`, `beet powder`, `black carrot juice concentrate`, `carrot juice concentrate`, `red cabbage juice concentrate`, `turmeric color`, `paprika oleoresin`, `extractives of paprika`. (`annatto extract`, `beet juice concentrate`, `beta-carotene` already present. Bare `paprika` and `turmeric` excluded to avoid false positives on spice use.) |
| 8 | MILK_DERIVED_INGREDIENTS — add: `cultured pasteurized milk`, `cultured lowfat milk`, `cultured milk`, `nonfat dry milk`, `butter powder`, `caseins`. (`butter oil`, `calcium caseinate` already present.) |
| 9 | ALWAYS_IGNORE_INGREDIENTS — add `amylase` and `culture` (singular; `cultures` already present). `cultured onion juice` moved to SYNTHETIC_ADDITIVES (Change 4). |
| 10 | CONVENTIONAL_CROPS — add `cane juice crystals`, `cane juice`, `cane syrup` before `invert sugar` / `sugar` |
| 11 | GLYPHOSATE_HEAVY — add `enriched acini di pepe` before `enriched macaroni product` |
| 12 | REVIEWED_CLEAN_INGREDIENTS — Batch 2 & 3 additions (June 2026): herbs/spices (sage, dill, parsley, cilantro, coriander, fennel, cloves, nutmeg, cardamom, allspice, bay leaves, bay leaf, marjoram, tarragon, mint, spearmint, peppermint), nuts/butters (almond butter, sunflower seed butter, sunflower butter, tahini, pine nuts), fruits/berries (blueberries, strawberries, raspberries, blackberries, cherries, apricots, dates, figs, raisins, cranberries, pomegranate, mango, pineapple, banana, apple, pear), vegetables (spinach, kale, sweet potato, broccoli, carrot, carrots, beet, beets, celery), proteins (quinoa, amaranth, teff), sweeteners (date sugar, date syrup, raw honey, agave nectar, agave syrup), fats (ghee), sea vegetables (acacia fiber, apple cider, lemon/lime/orange zest, sea vegetables, dulse, nori, kelp) |

**Tests added (blocks 41–50):** 22 new rulesEngine tests. Total: 2,704 passing (2,103 rulesEngine + 601 scan).

### Session — staged batch Changes 1–9 (pending final unverified ingredient review before PROMPT_VERSION bump)
> **STAGED — do not bump PROMPT_VERSION until batch is reviewed and approved.**

| Change | Description |
|--------|-------------|
| 1 | SYNTHETIC_ADDITIVES — add: `glycerin` (common name for glycerol; different string, needed explicitly), `karaya gum` (E416 stabilizer), `konjac gum` (E425 thickener), `l-cysteine` (E920 dough conditioner) |
| 2 | CONVENTIONAL_CROPS — add `guar gum` (galactomannan hydrocolloid); fixes unverified gap — was absent from CONVENTIONAL_CROPS and thus absent from ALL_TRIGGERS, causing it to slip into unverifiedIngredients even when organically cleared |
| 3 | FORTIFIED_VITAMINS added to ALL_TRIGGERS — fixes folic acid/iron unverified gap; FORTIFIED_VITAMINS was detected via `containsFortifiedVitamins()` separately but never blocked the unverified queue; also add bare `iron` to FORTIFIED_VITAMINS; broken test 12 updated (phrase containing "zinc gluconate" now caught by FORTIFIED_VITAMINS filter; replaced with neutral phrase) |
| 4 | CONVENTIONAL_CROPS — add `grain vinegar` (fermented from wheat/corn, clearable by organic cert) to corn/fermentation section |
| 5 | NATURAL_COLORANTS — add: `fruit and/or vegetable juice color`, `fruit and vegetable juice`, `huito juice concentrate` |
| 6 | MILK_DERIVED_INGREDIENTS — add: `grade a grassfed reduced fat organic milk`, `grade a pasteurized skim milk`, `imported greek yogurt`, `fontina cheese`, `half & half` (ampersand variant of existing `half and half`) |
| 7 | ALWAYS_IGNORE_INGREDIENTS — add: `himalayan pink sea salt` (variant not covered by `himalayan pink salt`), `lactase enzyme`, `lactase`, `lactic acid starter culture`, `l. paracasei and l. rhamnosus`, `l.paracasei and l. rhamnosus`, `lactis dn 173-010/cncm 1-2494`, bare `lactobacillus` genus |
| 8 | New `MEAT_DERIVED_INGREDIENTS` array + `containsMeatDerived()` helper in rulesEngine.js; exported; imported in scan.js; new Node 8c in L2 tree (after 8b conventional_eggs, before 9 conventional_dairy) — injects `conventional_meat` reject when gelatin found without organic cert. MEAT_DERIVED_INGREDIENTS: `beef gelatin`, `pork gelatin`, `kosher gelatin`, `gelatin`. |
| 9 | REVIEWED_CLEAN_INGREDIENTS — Batch 4 additions (June 2026): fresh/ginger/garlic forms, hemp protein, gum acacia/arabic, koji, Korean red pepper, various seasonal produce, freeze-dried blends, tea extracts, Italian tomato forms, fish oil, jalapeño items, Himalayan salt variant, lactase, lactobacillus, lactic acid starter |

**Tests added (blocks 51–57):** 14 new rulesEngine tests. Total: 2,718 passing (2,117 rulesEngine + 601 scan).

Key architecture note: `ALL_TRIGGERS` now includes `...FORTIFIED_VITAMINS`. This is a breaking addition for any token-level test that expected a FORTIFIED_VITAMINS member to survive as unverified — update those tests to use neutral phrases.

`containsMeatDerived` is exported from `lib/rulesEngine.js` and destructured in `pages/api/scan.js`. ConcernCard already maps `conventional_meat` so no UI change needed.

### Session — staged batch Changes 1–10 (pending final unverified ingredient review before PROMPT_VERSION bump)
> **STAGED — do not bump PROMPT_VERSION until batch is reviewed and approved.**

| Change | Description |
|--------|-------------|
| 1+10 | ALWAYS_IGNORE_INGREDIENTS — add (combined): `onion salt` (salt form, before `sea salt`); `live and active probiotic` (before `live active cultures`); `live active` bare form; `leavening [baking soda and/or calcium phosphate` (compound leavening); `leavening` bare; `lactococcus lactis` (probiotic genus). SKIP (already present): `lactobacillus acidophilus`, `lactobacillus bulgaricus`, `lactobacillus delbrueckii subsp. bulgaricus`, `lactobacillus delbrueckii subsp. lactis`, `live cultures`, `non-animal enzymes`, `live and active cultures`. |
| 2 | SYNTHETIC_ADDITIVES — add: `malic acid` (near acidulants, after `sorbic acid`); `modified cellulose` (thickeners section, after `konjac gum`); bare `nisin` (before existing `nisin preparation`). Tests: 1 per trigger. |
| 3 | FORTIFIED_VITAMINS — add: `natural vitamin e` (before `mixed tocopherols`); `palmitate` (after `vitamin a palmitate`, catches bare form). SKIP: `mixed tocopherols` already present. `niacin` already present + now in ALL_TRIGGERS from Batch 2. Tests: containsFortifiedVitamins for mixed tocopherols, natural vitamin e, palmitate. |
| 4 | GLYPHOSATE_HEAVY — add `oatmilk` (no-space variant) before `oat milk`. Test: 1. |
| 5 | NATURAL_COLORANTS — add `oleoresin of paprika` (longest form, before `oleoresin paprika`), `oleoresin paprika` (before `paprika oleoresin`). Test: 1. |
| 6 | MILK_DERIVED_INGREDIENTS — add (longest forms first): `mozzarella white cheddar cheese blend`, `low moisture part skim mozzarella cheese`, `low moisture mozzarella cheese`, `mozzarella cheese`; `mild cheddar cheese` (before `cheddar`); `made from milk`, `milk [whole & skim`, `milk chocolate`, `milk protein blend` (before `milk protein concentrate`); `modified whey` (before `whey`); `lowfat greek yogurt` (before `yogurt`). SKIP: bare `mozzarella` already present. Tests: 2. |
| 7 | CONVENTIONAL_CROPS — add `lactose` (dairy sugar, clearable by organic cert; puts it in ALL_TRIGGERS; also detected by containsMilkDerived in scan.js L2 tree). Test: 1. |
| 8 | CONVENTIONAL_CROPS — add `modified potato starch` and `modified tapioca starch` before `modified starch` (substring matching does NOT work for these — "modified potato starch" does not contain "modified starch" as a substring since "modified potato starch".includes("modified starch") = false). Tests: 2. |
| 9 | REVIEWED_CLEAN_INGREDIENTS — Batch 5 additions (June 2026): `lemon juice concentrate`, `lemongrass puree`, `lime`, `lime juice concentrate`, `lime juice powder`, `lime oil`, `locust bean gum`, `maca root powder`, `magnesium oxide`, `magnesium sulfate potassium bicarbonate`, `mandarins`, `molasses powder`, `monk fruit extract`, `mushroom extract`, `mustard flour`, `mustard greens`, `natural artesian water`, `natural maple syrup`, `nutmeg oil`, `oncorhynchus gorbuscha` (pink salmon scientific name), `mung bean protein`. SKIP: `nutmeg` already present from Batch 2. No new tests. |

**Tests added (blocks 58–64):** 13 new rulesEngine tests. Total: 2,731 passing (2,130 rulesEngine + 601 scan).

### Session — Rules engine expansion & unverified ingredients audit (June 2026)
- Audited 100+ scan_cache records and 400+ unverified_ingredients rows
- Added allergen advisory text stripping (Fix 1), yogurt culture ALWAYS_IGNORE expansion (Fix 2), flag deduplication (Fix 3)
- Expanded SYNTHETIC_ADDITIVES, CONVENTIONAL_CROPS, GLYPHOSATE_HEAVY, FORTIFIED_VITAMINS, NATURAL_COLORANTS, MILK_DERIVED_INGREDIENTS, ALWAYS_IGNORE_INGREDIENTS, REVIEWED_CLEAN_INGREDIENTS across multiple passes
- New MEAT_DERIVED_INGREDIENTS system added with containsMeatDerived() and Node 8c in L2 tree (triggers on gelatin)
- Tokenizer fixes: asterisk stripping, trailing punctuation cleanup, corn unverified gap
- Deleted 411 resolved rows from unverified_ingredients table
- Total tests: 2,731 (this figure was later found to be inflated — see July 2026 correction below) | PROMPT_VERSION: 22

### Session — REVIEWED_CLEAN_INGREDIENTS Batch 6 (whole-food coverage gap fix, July 2026)

Follow-up to a production bug investigation: a scan of "Grain Free Granola: Banana With Maca"
(barcode 628504873144) returned `verdict: inconclusive` with `cleared_by: organic` and nearly every
ingredient in `unverified_ingredients`. The investigation found the product's trailing-asterisk
organic convention (`"coconut flakes*, ... (*organic)"`) was parsed correctly by the tokenizer —
the real cause was a whole-food vocabulary coverage gap: 10 compound ingredient tokens had zero
matches anywhere in `rulesEngine.js`.

| Change | Description |
|--------|-------------|
| 1 | REVIEWED_CLEAN_INGREDIENTS — Batch 6 additions (July 2026): `coconut flakes`, `banana puree`, `bananas`, `sprouted sunflower seeds`, `sprouted pumpkin seeds`, `dried plums`, `prunes`, `virgin coconut oil`, `maca powder`, `ground cinnamon`. Added to REVIEWED_CLEAN_INGREDIENTS (not WHOLE_FOOD_TOKENS_L2) — matches the established Batch 2–5 pattern for audit-confirmed clean whole foods, applies at both user levels, and avoids touching level-specific filtering logic. `tree nuts` intentionally excluded — its appearance in the original bug report is an artifact of a separate allergen-advisory-parsing gap (the `contains:` regex requires a trailing period and this product's disclosure ends in a comma), deferred to another session. |

**Tests added (block 65):** 12 new rulesEngine tests. Total: 1,131 passing (969 rulesEngine + 162 scan).

**Test count correction discovered this session**: the running total documented above (2,731) was
computed by summing `jest` output across the root test files *and* several stale duplicate copies
under `.claude/worktrees/*/lib/rulesEngine.test.js` and `.claude/worktrees/*/__tests__/api/scan.test.js`
left over from prior worktree-isolated agent sessions. The root files — the actual source of truth —
had 957 rulesEngine + 162 scan = 1,119 tests before this batch, not 2,130 + 601. All historical
per-batch deltas in this changelog (e.g. "+22 tests", "+14 tests") are still accurate; only the
running *total* was compounding the worktree duplication. Run `npx jest --testPathIgnorePatterns=".claude/worktrees"`
to get an accurate root-only count in future sessions.

### Session — allergen-advisory stripping fix: shared helper + comma/EOS "contains:" termination (July 2026, PROMPT_VERSION 23)

Follow-up to the granola bug investigation: two compounding bugs in the allergen-advisory stripping
added under PROMPT_VERSION 21 were confirmed and fixed.

**Bug 1 — unverified-token derivation never saw the stripped text.** The `text` variable used for
trigger/flag matching had allergen phrases stripped, but `rawUnknownTokens` (the source of
`unverifiedIngredients`) re-parsed the raw, unstripped `ingredientText` independently. Disclaimer
fragments like `"contains"` and `"tree nuts"` could leak into the review queue even on labels where
the advisory phrase *was* correctly stripped from `text`.

**Bug 2 — the `contains:` regex required a trailing period.** `/contains:[^.]*\./` only matched
advisory clauses closed by a period. A label ending its allergen statement in a comma or with no
closing punctuation at all (e.g. `"...contains: tree nuts (coconut),"`) was not stripped —
**from either pipeline**, since this regex also feeds `text`. This turned out to be more serious
than inflated unverified counts: because the unstripped clause still fed trigger matching, an
allergen name disclosed only as a legal disclaimer could trip a real reject flag. Reproduced with
`'roasted nuts, sea salt, contains: soy lecithin,'` — before the fix this returned a false
`conventional_crops` reject flag on `"soy lecithin"` and verdict `red`; the product contains no such
ingredient, it was only named in the allergen disclaimer.

**Fix:**
- Added `stripAllergenAdvisory(str)` ([lib/rulesEngine.js](lib/rulesEngine.js)) — a single shared
  helper now called once to produce `ingredientTextNoAdvisory` (original casing preserved), which
  both the `text` pipeline (trigger matching; further lowercased/normalized from there) and
  `rawUnknownTokens` (via `parseIngredientTokens(ingredientTextNoAdvisory)`) derive from. The two
  pipelines can no longer drift apart. Token casing in `unverifiedIngredients` is unchanged —
  still original-case, not lowercased — since `ingredientTextNoAdvisory` is not lowercased.
- Extended the `contains:` handling to two additional patterns: `/contains:[^,]*,/gi` (comma-terminated)
  and `/contains:[^.,]*$/gi` (end-of-string, no closing punctuation at all) — mirroring the existing
  period/comma pair already used for `"may contain"`. `"may contain"`, `"manufactured on a line"`,
  and `"produced in a facility"` were left untouched (not part of the reported bug; out of scope).

**Tests added (block 66):** 7 new rulesEngine tests — comma-terminated `contains:`/`may contain`
clauses excluded from `unverifiedIngredients` (not just `flags`, closing the gap that let this bug
through block 38 originally); end-of-string `contains:` clause; the false-positive-flag regression
(`soy lecithin` no longer flagged); the exact granola string from the bug report (`contains`,
`tree nuts`, duplicate `coconut` all absent); a no-regression check on the original period-terminated
block 38 case; and a casing-preservation check. Total: 1,138 passing (976 rulesEngine + 162 scan).
Full suite (`__tests__/api/scan.test.js` included) passes with no other regressions.

**PROMPT_VERSION bumped 22 → 23.** This fix changes engine `flags`/`verdict` output (not just the
display-only `unverifiedIngredients` list) for any previously-scanned product whose OFF ingredient
text ends in a comma- or unpunctuated `contains:` clause — those products may have an incorrect
flag/verdict baked into `scan_cache` from before this fix, and `flags` feeds directly into the
Claude prompt via `buildUserMessage()` in `explain.js`. Per the cache-invalidation pattern, run
`DELETE FROM scan_cache WHERE prompt_version < 23` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test in `scan.test.js` was updated to assert `23`.

### Session — L2 tree missing node: glyphosate_heavy reject silently downgraded to yellow (July 2026, PROMPT_VERSION 24)

Follow-up to a production bug investigation: "Unsweetened Cereal" (barcode 860002152400,
ingredients `"Chickpea, Tapioca, Pea Protein, Salt"`, no OFF labels, Level 2) was cached with a
`glyphosate_heavy` flag whose own `severity` field correctly read `'reject'`, yet the top-level
`verdict` was `'yellow'` — contradicting the documented rule "any `severity: 'reject'` flag → red".

**Root cause**: `analyzeIngredients()` in `lib/rulesEngine.js` computes verdict correctly per the
documented rule. But at Level 2, `scan.js` runs a 14-node decision tree *after* the engine that
overrides its verdict using explicit per-category checks (`INSTANT_RED_CATEGORIES`, plus dedicated
checks for `conventional_eggs`/`conventional_crops`/`bioengineering`/etc.). Every reject-severity
category the engine can emit had a matching check in this tree **except `glyphosate_heavy`** — it
had none. A product whose *only* reject flag was `glyphosate_heavy` fell through every node to
Node 14's unconditional default (`verdict = 'yellow'`), silently discarding the correct RED. This
affects every product in the GLYPHOSATE_HEAVY list (oats, wheat, barley/malt, lentils, peas, edible
beans, flax/linseed, rye, buckwheat, millet) whenever it's the sole concern — products with an
*additional* checked reject category (e.g. `seed_oils`) still showed RED, which is what masked the
gap until now. Confirmed **not** related to the `glyphosate-free` label downgrade path (that path is
correct — it updates the flag's own `severity` to `'caution'` at the engine level before the tree
even runs, per `lib/rulesEngine.js` GLYPHOSATE_HEAVY loop) — reproduced with zero OFF labels present.

**Fix**: added Node 11b to the L2 tree in `pages/api/scan.js`, between the existing bioengineering
node (11) and the glyphosate-free node (12): `flags.some(f => f.category === 'glyphosate_heavy' && f.severity === 'reject')`
→ RED. Mutually exclusive with Node 12 by construction, since the engine has already downgraded the
flag's severity to `'caution'` by the time the tree runs if `glyphosate-free`/`usda-organic`
clearance applied — confirmed with a dedicated regression test. `hasGlyphosateHeavy` / Node 13 (the
unrelated OFF product-level `en:glyphosate-heavy` label check) and the engine's glyphosate-free
downgrade logic were left untouched, as neither was implicated.

**Tests added (Suite L, L16–L17):** L16 reproduces the exact bug case and asserts `verdict: 'red'`;
L17 is a regression guard confirming the glyphosate-free downgrade still correctly produces
`'yellow'` (flag `severity: 'caution'`) once a `glyphosate-free` label is present, so the new node
doesn't clobber the legitimate certification path. Audited every other GLYPHOSATE_HEAVY-triggering
fixture already in `scan.test.js` (wheat flour, rye) — all were paired with an additional
`INSTANT_RED_CATEGORIES` flag (seed_oils) or organic clearance, so none were asserting the bug; no
existing test needed correction. Full suite: 1,140 passing (976 rulesEngine + 164 scan), no
regressions.

**PROMPT_VERSION bumped 23 → 24.** Same reasoning as the v23 fix: this changes real `verdict` output
(yellow → red) for a class of previously-cached products, and `flags`/`verdict` feed directly into
`buildUserMessage()` in `explain.js`. Run `DELETE FROM scan_cache WHERE prompt_version < 24` in
Supabase before/after deploying. The `M. PROMPT_VERSION` contract test was updated to assert `24`.

**Process note**: this is the second time a reject-severity category was added to the engine without
a corresponding L2 tree node (see the new "Keeping the tree in sync with the engine" callout added
under "Level 2 universal decision tree" above). Check that callout when adding any new reject
category to `lib/rulesEngine.js`.

### Session — REVIEWED_CLEAN_INGREDIENTS Batch 7 (whole-food coverage gap fix, July 2026)

Same pattern as Batch 6: "chickpea" (and by report, "chickpeas") was showing up in
`unverified_ingredients` across multiple scanned products. Confirmed via grep that bare "chickpea"
did not appear anywhere in `rulesEngine.js` before adding.

| Change | Description |
|--------|-------------|
| 1 | REVIEWED_CLEAN_INGREDIENTS — Batch 7: `chickpea` (singular). **`chickpeas` (plural) intentionally NOT added** — grep and a direct repro showed it is already a `GLYPHOSATE_HEAVY` trigger (edible beans section, `lib/rulesEngine.js` CONVENTIONAL_CROPS/GLYPHOSATE_HEAVY block) and is correctly caught by Pass 1 (`ALL_TRIGGERS`) before ever reaching this filter — `analyzeIngredients('chickpeas, sea salt', [], 2)` confirms it still correctly produces a `glyphosate_heavy` reject flag, verdict `red`. Adding the plural form to REVIEWED_CLEAN_INGREDIENTS would have been a dead, misleading entry (functionally inert now, but semantically wrong and a latent risk if the Pass 1/Pass 3 ordering is ever refactored) — deviated from the literal task instruction here after the verification step it explicitly asked for surfaced the conflict. Note: `WHOLE_FOOD_TOKENS_L2` already has a similarly dead/redundant `'chickpeas'` entry from an earlier session (same Pass-1-shadows-it issue) — pre-existing, not touched. |
| 2 (optional, added) | REVIEWED_CLEAN_INGREDIENTS — `monk fruit` (bare form; `monk fruit extract` was already covered from Batch 5, but the bare form is a distinct token and was separately unverified). Confirmed via grep no conflicting trigger exists. |
| 3 (optional, added) | REVIEWED_CLEAN_INGREDIENTS — `cocoa` (bare form; `cocoa powder`/`cocoa butter` were already covered). Confirmed via grep no conflicting trigger exists. |

**Tests added (block 67):** 5 new rulesEngine tests — 3 per-token suppression tests, 1 flags/verdict-unaffected
test, and 1 explicit regression guard confirming `chickpeas` (plural) still correctly flags
`glyphosate_heavy`/red (proving the omission above was deliberate, not an oversight). Total: 1,145
passing (981 rulesEngine + 164 scan).

> **CORRECTION (July 2026, PROMPT_VERSION 25) — singular "chickpea" reclassified.** The Batch 7
> `Change 1` decision above was wrong: singular `chickpea` was added to `REVIEWED_CLEAN_INGREDIENTS`
> ("confirmed clean whole food") in the same breath as noting that plural `chickpeas` is a
> deliberate `GLYPHOSATE_HEAVY` reject trigger. There is no basis for the singular and plural forms
> of the same crop carrying different glyphosate exposure risk — a label printing "Chickpea" instead
> of "Chickpeas" doesn't change how the crop was grown. Singular `chickpea` has been **removed from
> `REVIEWED_CLEAN_INGREDIENTS` and added to `GLYPHOSATE_HEAVY`** (edible beans section, alongside
> `chickpeas`), so both forms now consistently produce a `glyphosate_heavy` reject flag at L2 (and
> caution at L1, per the usual level rule). `monk fruit` and `cocoa` (Changes 2–3 above) are
> unaffected and remain in `REVIEWED_CLEAN_INGREDIENTS`. This entry is left in place rather than
> edited, per the project's non-rewrite convention — see the follow-up session below for the fix,
> new tests (block 68), and the `M. PROMPT_VERSION` bump to 25. This changes real verdict/flag
> output for any product using "chickpea"/"Chickpea" (singular) as an ingredient — e.g. the
> cereal-category products with chickpea as a primary ingredient (including barcode 860002152400
> from the earlier Node 11b investigation, which now correctly reports **two** `glyphosate_heavy`
> flags — `chickpea` and `pea protein` — instead of one). Run
> `DELETE FROM scan_cache WHERE prompt_version < 25` in Supabase before/after deploying.

### Session — chickpea singular/plural correction (July 2026, PROMPT_VERSION 25)

Follow-up to the Batch 7 session above. That session added singular `chickpea` to
`REVIEWED_CLEAN_INGREDIENTS` while *also* noting, in the same table row, that plural `chickpeas` is
a deliberate `GLYPHOSATE_HEAVY` reject trigger for pre-harvest desiccation risk. That's internally
inconsistent — "chickpea" and "chickpeas" are the same crop grown the same way; the plural `-s` on a
label doesn't change glyphosate exposure. Singular `chickpea` should never have been classified as
"confirmed clean."

**Fix**: removed `chickpea` from `REVIEWED_CLEAN_INGREDIENTS`
([lib/rulesEngine.js](lib/rulesEngine.js)) and added it to `GLYPHOSATE_HEAVY`'s edible-beans section,
directly alongside the existing `chickpeas` entry, using the same trigger format. Verified via
`findMatches()`'s longest-trigger-first sort that this doesn't disturb the existing `chickpea flour`
trigger (14 chars, still matches first and claims its own range) or double-flag plural `chickpeas`
(9 chars, still claims its full range before the new 8-char `chickpea` trigger can overlap it).

**Tests**: removed the now-incorrect Batch 7 assertion that `chickpea` is suppressed from
`unverifiedIngredients`; updated the "Batch 7 additions do not affect flags/verdict" test to drop
`chickpea` from its ingredient string (`monk fruit`/`cocoa` only, since those are unaffected). Added
new **block 68** (3 tests): singular `chickpea` now produces a `glyphosate_heavy` reject matching
plural `chickpeas`; organic-prefix clearance behaves identically for both forms; `chickpea flour`
still matches its own longer trigger and isn't double-flagged by the new bare `chickpea` trigger.
Also fixed a real regression this surfaced in `__tests__/api/scan.test.js` Suite L: test **L16**
(the exact production reproduction case from the Node 11b investigation, ingredients `"Chickpea,
Tapioca, Pea Protein, Salt"`) previously asserted the single `glyphosate_heavy` flag's
`matchedIngredient` was `'pea protein'` via `.find()` — now that `chickpea` also matches, that
product correctly carries **two** `glyphosate_heavy` reject flags, and the `.find()`-based assertion
was asserting on flag-array ordering, not on correctness. Updated to assert both flags exist with
`matchedIngredient` values `['chickpea', 'pea protein']`. Full suite: 1,147 passing (983 rulesEngine
+ 164 scan), no other regressions.

**PROMPT_VERSION bumped 24 → 25.** This changes real `flags`/`verdict` output for any previously
cached product using singular "chickpea"/"Chickpea" as an ingredient with no organic/glyphosate-free
clearance — those products were incorrectly missing a `glyphosate_heavy` reject flag (and, if
`chickpea` was their only concern, an incorrect non-red verdict). Run
`DELETE FROM scan_cache WHERE prompt_version < 25` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `25`.

### Session — REVIEWED_CLEAN_INGREDIENTS Batch 9 (unsweetened chocolate; chocolate chips deliberately excluded, July 2026)

Same pattern as Batch 6/7: investigation of a production scan ("Chocolate chip cookie," barcode
854198004810, ingredients `"Almond butter, organic honey, chocolate chips (unsweetened chocolate,
sugar, cocoa butter), pea protein, egg whites, vanilla extract, sea salt. Contains: almonds, eggs."`)
found `unsweetened chocolate` — a sub-ingredient disclosed inside the "chocolate chips" parenthetical
— surfacing in `unverified_ingredients` with no coverage anywhere in `rulesEngine.js`. A prior
investigation session (no code changes) confirmed this was an ordinary vocabulary gap, not a
tokenization/parenthetical-flattening bug — see that session's findings for the full trace of how
`parseIngredientTokens()` flattens nested parentheticals identically for both the trigger-matching
and unverified-ingredient pipelines.

| Change | Description |
|--------|-------------|
| 1 | REVIEWED_CLEAN_INGREDIENTS — Batch 9: `unsweetened chocolate` (cocoa solids + cocoa butter, no sugar/additives — same category as `cocoa butter`, already whitelisted since the original base list). Confirmed via grep no conflicting trigger exists. |
| 2 | **`chocolate chips` deliberately NOT added**, unlike prior batches' policy of whitelisting whatever term was reported. Unlike a raw whole food, "chocolate chips" is a manufactured/compound product whose composition varies by brand and near-universally includes added sugar (often soy lecithin, milk solids) that go **undisclosed** when a label lists it bare, without a parenthetical breakdown. Whitelisting the container term would cause the app to treat any product with undisclosed "chocolate chips" as confirmed-clean, masking those real ingredients — structurally the same class of mistake as the chickpea/chickpeas conflict corrected in Batch 7, just a disclosure-completeness issue instead of a direct trigger collision. When a label *does* disclose the breakdown in a parenthetical (as this cookie does), the sub-ingredients are already checked individually — `sugar` correctly flags `conventional_crops`, `cocoa butter` is already clean, and now `unsweetened chocolate` is too. No fix needed for the container term itself; bare "chocolate chips" should keep surfacing as unverified so the team is prompted to review actual composition when a label doesn't disclose it. |

**Tests added (block 69):** 3 new rulesEngine tests — `unsweetened chocolate` suppression test,
flags/verdict-unaffected test, and a regression guard confirming bare `chocolate chips` (no
disclosed breakdown) still correctly surfaces as unverified, so this container term isn't
accidentally whitelisted in a future batch without this reasoning being revisited. Total: 1,150
passing (986 rulesEngine + 164 scan). No PROMPT_VERSION bump — this is a display-only
`unverifiedIngredients` change (Pass 3 filter), not a `flags`/`verdict` change, consistent with how
Batch 6/7's additive whitelist entries were handled.

### Session — inconclusive verdict: gluten_grains masking the unverified-count check (July 2026, PROMPT_VERSION 26)

Follow-up to a production bug investigation: two real products with `clearedBy: 'organic'` and
`flags: []`-or-not got wildly inconsistent verdicts. "TRACTOR WHEELS Organic Toddler Soft-Baked Bar"
(barcode 810003512611, 9 unverified ingredients, contains oat flour + wheatgrass) incorrectly stayed
`verdict: 'green'`. "Smoothie Melts Blueberry Burst" (barcode 810003512802, only 7 unverified
ingredients, no gluten at all) correctly became `verdict: 'inconclusive'`. The product with *more*
unrecognized ingredients got the *better* verdict — backwards from the documented intent of the
inconclusive check.

**Root cause**: the inconclusive check in `pages/api/scan.js` (~line 829) read:
```js
if (ingredientsText !== null && verdict === 'green' && flags.length === 0 && unverifiedIngredients.length > 5)
```
`flags.length === 0` checked the **raw** `flags` array. But `analyzeIngredients()` in
`lib/rulesEngine.js` (~line 2337) already excludes `gluten_grains` from *its own* `verdict`
field via an `activeFlags` filter (gluten is a paywall feature, invisible at both levels, by
design — correct and unchanged) — **without** stripping `gluten_grains` entries out of the `flags`
array it actually returns. That stripping only happens later, in the L2 tree's own gluten-stripping
pre-processing step, which runs *after* this check. So any product containing a gluten grain (wheat,
oat, barley, rye, etc.) had a non-empty `flags` array purely from `gluten_grains` entries, even when
gluten was its *only* concern — the `&&` chain short-circuited before the `> 5` unverified-count
check ever ran, regardless of how unrecognized the product's ingredients actually were.

**Fix**: `pages/api/scan.js` now filters `flags` to exclude `gluten_grains` before the length check
(`nonGlutenFlagsForInconclusive = flags.filter(f => f.category !== 'gluten_grains')`), mirroring the
`activeFlags` pattern `analyzeIngredients()` uses internally, so the two can't drift apart on what
"no real flags" means. Neither the engine's own gluten exclusion nor the later L2-tree gluten-strip
step was touched — both were already correct and out of scope. Added a documentation note in the
"POST /api/scan" section flagging that this check must stay in sync with whatever `analyzeIngredients()`
excludes from its own verdict calculation, mirroring the "keep the L2 tree in sync with the engine"
callout added after the earlier `glyphosate_heavy` fix.

**Tests added (Suite I):** two new tests using the real production ingredient strings — Tractor
Wheels (gluten_grains flags present + 9 unverified → now correctly `inconclusive`) and Smoothie
Melts (zero flags + 7 unverified → still correctly `inconclusive`, an explicit real-world regression
guard alongside the existing synthetic-gibberish `ALL_UNKNOWN_OFF` fixture). Audited every other
gluten-grain-containing fixture already in `scan.test.js` (Kraft's wheat flour, Annie's organic wheat
flour, the L1/L2 wheat-flour/oat-flour/rye cases) — all have short, mostly-recognized ingredient
lists well under the `> 5` unverified threshold, so none were silently relying on the old fallthrough.
Full suite: 1,152 passing (986 rulesEngine + 166 scan), no regressions.

**PROMPT_VERSION bumped 25 → 26.** This changes real `verdict` output (green → inconclusive) for a
class of previously-cached products — any organic-cleared product containing a gluten grain with
more than 5 unverified ingredients — and `verdict`/`flags` feed directly into `buildUserMessage()` in
`explain.js` (though `inconclusive` skips Claude entirely, so the practical effect is these products
now correctly show the inconclusive-messaging card instead of a false-clean AI explanation). Run
`DELETE FROM scan_cache WHERE prompt_version < 26` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `26`.

### Session — trailing certification-note tokenizer fix (". Organic." fragment, July 2026)

Follow-up to the gluten_grains/inconclusive investigation: "Smoothie Melts Blueberry Burst"
(barcode 810003512802) surfaced a malformed `". Organic"` token in `unverifiedIngredients`, distinct
from the already-fixed gluten_grains/inconclusive bug and from the earlier granola
trailing-asterisk-footnote fix.

**Root cause**: the ingredient string ends `"...Bifidobacterium lactics (probiotic). Organic."` —
a trailing sentence-fragment certification note after the last real ingredient, not a comma-separated
item. `parseIngredientTokens()` only splits on commas/semicolons (never periods, by design — ingredient
lists are comma-separated, and general period-splitting would break decimals/abbreviations), so after
paren-flattening the closing `)` becomes a comma and `". Organic."` becomes its own token. Compounding
this, `parseIngredientTokens()` only strips **trailing** punctuation (`/[.*[\])]+$/`) — there's no
leading-punctuation strip — so the token's trailing period is removed but its leading `". "` survives,
producing the malformed `". Organic"` string observed in the cached row.

**Fix**: added one more `.replace()` to the shared `stripAllergenAdvisory()` helper in
`lib/rulesEngine.js` (already used by both the trigger-matching and unverified-token pipelines, per
the earlier allergen-advisory fix):
```js
.replace(/\.\s*(?:usda\s+)?(?:certified\s+)?organic\.?\s*$/gi, '')
```
Deliberately narrow and anchored to end-of-string: requires a literal period immediately before the
certification word, so it strips `"...(probiotic). Organic."`, `". Organic"` (no trailing period),
`"...water. Certified Organic."`, and `"...water. USDA Organic."` — but leaves mid-string periods
(decimals like `"0.5%"`, abbreviations like `"vitamin b12."`) and comma-separated ingredients that
merely *start* with "Organic" (e.g. `"salt, pepper, Organic Coconut Oil."`) completely untouched,
since those don't have a period immediately preceding a bare "organic" at the very end of the string.
Confirmed via direct regex testing against all these cases before implementing, per the task's
explicit instruction not to generalize into a "treat periods as separators" change.

**Tests added (block 70):** 6 new rulesEngine tests — exact reproduction (no more `". Organic"` or
any leading-period token), the no-trailing-period variant, `"Certified Organic."`/`"USDA Organic."`
variants, a flags/verdict-unaffected check (same two `conventional_crops` flags as before the fix,
verdict unchanged), a regression guard for mid-string abbreviation/decimal periods, and a regression
guard confirming a real trailing ingredient that merely starts with "Organic" is left alone. Full
suite: 1,158 passing (992 rulesEngine + 166 scan), no regressions in `scan.test.js` (untouched this
session).

**No PROMPT_VERSION bump.** Confirmed by direct testing (with and without the `usda-organic` label)
that this change only affects the derived `unverifiedIngredients` display list — `flags` and `verdict`
are byte-for-byte identical before and after the fix on the exact reproduction string. "Organic" was
never a substring trigger anywhere in `ALL_TRIGGERS`, and the malformed fragment sat at the very end
of the string, so it couldn't have been clearing or un-clearing anything earlier in the text via
`isPrecededByOrganic()` either. Same reasoning as the `chocolate chips`/`unsweetened chocolate` batch:
a display-only Pass 1/tokenizer change, not a `flags`/`verdict` change.

### Session — Batch 10 (probiotic, Bifidobacterium lactics, singular date; July 2026)

Same pattern as Batch 6/7/9: three vocabulary/typo gaps surfaced in the same "Smoothie Melts
Blueberry Burst" (barcode 810003512802) investigation that produced the ". Organic" tokenizer fix.

| Item | Fix | Reasoning |
|------|-----|-----------|
| 1 | `ALWAYS_IGNORE_INGREDIENTS` — added bare `probiotic`, right next to the existing `live and active probiotic` entry (same list, same "Live cultures" section). | Confirmed via grep that only the compound phrase existed; bare `probiotic` was unverified whenever a label lists it standalone (e.g. inside a parenthetical like `"(probiotic)"`). |
| 2 | `ALWAYS_IGNORE_INGREDIENTS` — added `bifidobacterium lactics` (extra "c") directly beside the existing correctly-spelled `bifidobacterium lactis`, in the "Probiotic / yogurt cultures" section. | Confirmed via grep this is a distinct string from the existing entry — a labeling variant/typo, not a new strain. Took the smaller option (a) per the task's own guidance: an additional sibling entry, not a general strain-name normalization pass — no evidence such a normalizer already exists elsewhere in the file, and one wasn't needed to fix the one confirmed variant. |
| 3 | `REVIEWED_CLEAN_INGREDIENTS` — added singular `date`, next to the existing plural `dates` (Batch 2&3 "Fruits & berries" section). | Confirmed via grep no conflicting trigger. `REVIEWED_CLEAN_INGREDIENTS` uses exact `Set.has()` matching on the whole trimmed token (not substring), so this only suppresses a token that is *literally* `"date"` — it cannot over-match into `"date sugar"`, `"date syrup"`, or any other compound token, which are already separate entries; verified directly. Same matching discipline as the existing `chickpea`/`chickpeas` and `dates` entries. |

**Regression found and fixed during verification**: fixing these three tokens dropped
`unverifiedIngredients` for the real "Smoothie Melts" product from 6 (post-". Organic" fix) to 3 —
below the `> 5` inconclusive threshold. The Suite I test that had asserted this product resolves to
`'inconclusive'` (added in the PROMPT_VERSION 26 session) was now asserting stale, incorrect
behavior — the product should no longer be inconclusive, since it's now sufficiently well-recognized
to be screened normally. Updated `__tests__/api/scan.test.js`: the test now asserts the product's
new, correct behavior (`verdict: 'yellow'`, `clearedBy: 'organic'`, a `fortified_vitamins` caution
flag from the vitamin E / tocopherols check, `unverifiedIngredients.length <= 5`), and the fixture's
JSDoc comment was updated to explain the before/after. The `TRACTOR_WHEELS_OFF` fixture's unverified
count also dropped (9 → 8, since it contains `DATE*`) but stayed well above the `>5` threshold, so
its test needed no assertion change — only its docstring comment was corrected for accuracy. No other
fixture in either test file references `probiotic`, `bifidobacterium`, or bare `date`.

**Tests added (block 71):** 9 new rulesEngine tests — per-token suppression tests for all three
items, non-interference checks confirming the pre-existing `live and active probiotic`,
`bifidobacterium lactis`, `dates`, and `date sugar` entries are unaffected, a flags/verdict-unaffected
test, and a real-world reproduction check against the Smoothie Melts string. Plus 1 corrected test in
`scan.test.js` (documented above). Total: 1,167 passing (1,001 rulesEngine + 166 scan).

**PROMPT_VERSION bumped 26 → 27 — this batch was expected to stay display-only (same as Batch
6/7/9), but direct testing found a real exception and that expectation didn't fully hold.** In
isolation, `flags`/`verdict` are unchanged for all three tokens (confirmed directly) — that part of
the display-only pattern holds. But `unverifiedIngredients.length` directly gates the `> 5`
inconclusive threshold (`pages/api/scan.js`, fixed at PROMPT_VERSION 26), so *any* vocabulary batch
that removes enough tokens from a specific product's unverified list can cross that threshold and
flip its verdict — exactly what happened here: Smoothie Melts' cached row, written under
`prompt_version: 26` with `verdict: 'inconclusive'` by the immediately preceding session's own fix,
would otherwise keep serving `'inconclusive'` indefinitely on cache hits, undermining the point of
that fix. Bumping ensures it (and any other previously-cached product whose unverified count crosses
the threshold because of these three tokens) gets recomputed. Batch 6/7/9 did not hit this exact
interaction in practice, but the underlying risk was always latent in any vocabulary batch —
worth remembering for future batches: *check whether a specific product's unverified count is near
the `>5` boundary before assuming "purely additive vocabulary" implies "no PROMPT_VERSION bump."*
Run `DELETE FROM scan_cache WHERE prompt_version < 27` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `27`.

### Session — Oxford-comma conjunction stripping, l. rhamnosus, and general purpose-note parenthetical stripping (July 2026, PROMPT_VERSION 28)

Follow-up to a production bug investigation: "Mango Chobani" (barcode 818290015365) had
`unverified_ingredients` including `"mangoes"` (a separate, legitimate vocabulary gap, left
untouched), `"vegetable juice"` (same), `"for color"`, and `"and L. Rhamnosus"` — three genuine,
independent gaps confirmed and fixed.

**Issue 1 — leading conjunction not stripped.** Oxford-comma-ending ingredient lists (`"...L. Casei,
and L. Rhamnosus"`) produced a token `"and L. Rhamnosus"` because `parseIngredientTokens()` had no
conjunction-stripping logic at all — only leading `*`/`NN%` and trailing punctuation were stripped.
**Fix**: added `.replace(/^and\s+/i, '')` to the token `.map()` chain. Whitespace-anchored so it
cannot match a real ingredient name that merely starts with the letters "and" (e.g. "andouille
sausage" has no space between "and" and "ouille" — confirmed via a dedicated regression test).

**Issue 2 — bare "l. rhamnosus" independently missing.** Confirmed via isolated testing that even
with "and " correctly stripped, `"L. Rhamnosus"` alone still surfaced as unverified — every sibling
probiotic strain (`l. casei`, `l. bulgaricus`, `l. acidophilus`, `s. thermophilus`, `bifidus`) had
its own bare `ALWAYS_IGNORE_INGREDIENTS` entry; `l. rhamnosus` did not (only the compound
`'l. paracasei and l. rhamnosus'` phrase existed, for labels printing that exact paired name — left
untouched). **Fix**: added bare `'l. rhamnosus'` alongside its siblings.

**Issue 3 — general purpose-note parenthetical stripping (the larger fix).** Parentheticals that
explain *why* an ingredient is present rather than *what* it is (`"vegetable juice (for color)"`,
`"ascorbic acid (to preserve freshness)"`) were leaking their contents as fake standalone tokens.
This previously only "worked" for one specific phrase (`'to preserve freshness'`) because that exact
string happened to already sit in `ARTIFACT_PHRASES` from an earlier session — not because of any
general rule. Confirmed via testing that this is a recurring pattern (`"for freshness"` and other
variants also leaked). **Fix**: added `stripPurposeNoteParentheticals(str)`
([lib/rulesEngine.js](lib/rulesEngine.js)), called alongside `stripAllergenAdvisory()` and folded
into the same shared `ingredientTextCleaned` variable both the trigger-matching `text` and
`parseIngredientTokens()` derive from (renamed from `ingredientTextNoAdvisory` to reflect that it now
strips more than just allergen advisories). The regex `/\(\s*(?:for|to)\b[^()]*\)/gi` requires the
parenthetical's content to start with "for"/"to" as a whole word immediately after the opening
paren — structurally distinct from a real sub-ingredient list (which starts with an ingredient noun,
e.g. `"chocolate chips (unsweetened chocolate, sugar, cocoa butter)"`, confirmed still flattens and
flags normally via a dedicated regression test). Also collapses any double space left behind when a
purpose note sits *between* two words of a trigger phrase (e.g. `"high oleic (for flavor) sunflower
oil"`), so the trigger still matches correctly across the gap.

**`ARTIFACT_PHRASES`'s `'to preserve freshness'` entry left in place, not removed** — the general
rule now covers the common parenthetical case, but the literal-phrase entry still catches the rare
case where that exact wording appears without enclosing parens (e.g. as a bare comma-separated item).
Costs nothing to keep as a redundant safeguard; removing it speculatively risked a regression for no
real benefit, consistent with this project's established non-deletion convention for cases like this
(see the `WHOLE_FOOD_TOKENS_L2` `'chickpeas'` dead-entry precedent from the Batch 7 correction).

**Tests added (block 72, rulesEngine.test.js):** 14 tests — the exact Mango Chobani reproduction;
bare `l. rhamnosus` isolated; the conjunction strip isolated from the vocabulary fix; the `andouille
sausage` regression guard; the compound `'l. paracasei and l. rhamnosus'` trigger confirmed
unaffected; `"(for color)"`/`"(for freshness)"`/`"(to preserve texture)"` variants; the chocolate-chips
sub-ingredient regression guard; the mid-phrase double-space hardening case; a **flags-changing**
confirmation (`"canola (for cooking) oil"` — see below); an engine-level flags/verdict-neutral check
for Issue 2; the pre-existing `'to preserve freshness'` case; and a combined flags/verdict-unchanged
check for the full Mango Chobani reproduction. Plus **L18** in `scan.test.js` Suite L, confirming
`l. rhamnosus` masking doesn't disturb the `fortified_vitamins` organic-path injection in
`pages/api/scan.js`. Full suite: 1,182 passing (1,015 rulesEngine + 167 scan), no regressions —
searched both test files for any other fixture using an Oxford-comma ending or a `"(for/to ...)"`
parenthetical; none exist outside this session's own new tests.

**PROMPT_VERSION bumped 27 → 28 — Issues 1 and 2 are confirmed display-only (Issue 1: `parseIngredientTokens()`
is never used for the trigger-matching `text`; Issue 2: directly tested that `l. rhamnosus` masking
doesn't change flags/verdict in either the engine-level or L2-organic-path checks), but Issue 3 is
not.** Because `stripPurposeNoteParentheticals()` is applied to the shared `text` used for trigger
matching (not just the token-derivation pipeline), and because whole-string substring matching
requires exact character contiguity, a purpose note sitting *inside* a multi-word trigger phrase can
change the match outcome. Directly confirmed with a realistic (not synthetic) label shape: `"canola
(for cooking) oil"` did **not** match the `"canola oil"` seed_oils trigger before this fix (the
parenthetical broke contiguity — a false negative), and correctly does now. This is a real,
reproducible `flags`/`verdict` change for a plausible product shape, not just theoretical risk — so,
per this session's own established standard (see the Batch 10 entry above), it gets a bump. Run
`DELETE FROM scan_cache WHERE prompt_version < 28` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `28`.

### Session — L2 tree Node 5 wild-caught clearance: missing seafood gate + missing reject-flag check (July 2026, PROMPT_VERSION 29)

Follow-up to a production bug investigation: **the highest-severity bug found in this batch of
sessions.** "Banana Berry" (barcode 079900003251), a frozen fruit product with ingredients
`"BANANA SLICES (ASCORBIC AND CITRIC ACIDS ADDED TO PROTECT COLOR), STRAWBERRIES, WILD
BLUEBERRIES."`, was cached with `verdict: 'green'`, `cleared_by: 'wild-caught'`, while its
`flags` array still contained a live `conventional_crops` reject flag (`citric acid`) — a false
"all clear" shown to users with the actual concern sitting unused in the data. Worse than the prior
`glyphosate_heavy`/`gluten_grains` verdict bugs, which under-flagged to yellow; this one produced
green over an active reject.

**Root cause**: Node 5 of the L2 tree (`pages/api/scan.js`) read:
```js
if (detectWildCaught(productName, labelsDetected, ingredientsText)) {
  verdict = 'green'; clearedBy = 'wild-caught';
} else if (isSeafood) { ... }
```
Two missing gates, both now confirmed via direct testing:
1. **No `isSeafood` check.** `detectWildCaught()` fires on the standalone word "wild" appearing
   *anywhere* in the product name or ingredients text (by design — it's a pure text-signal detector
   with no category awareness, trusting its caller to establish seafood relevance first). Node 5 never
   did. Any non-seafood product containing "wild rice," "wild honey," "wild mushrooms," "wild oats,"
   or "wild blueberries" — in either the name or ingredients — triggered this node.
2. **No reject-flag check.** Even ignoring (1), Node 5 unconditionally overwrote `verdict` to
   `'green'` with zero reference to the `flags` array, silently discarding any reject-severity flag
   already present. Confirmed this affects every reject category that survives into `flags`
   regardless of category-specific node: `conventional_crops`, `conventional_eggs`, `bioengineering`,
   `glyphosate_heavy` all reproduced directly. Two categories (`conventional_dairy`, gelatin/
   `conventional_meat` at Node 8c) are *injected* by their own later node rather than pre-existing in
   `flags`, so for those the injection simply never ran at all — no flag, no evidence, same false
   green. Only the four `INSTANT_RED_CATEGORIES` (checked at the very top of the tree, before the
   organic/non-organic split) were safe, since that check runs before Node 5 is ever reached.

Both gates mirror the existing `INSTANT_RED_CATEGORIES` precedent already in this same tree — "reject
flags always win" is enforced there by running that check first, unconditionally, before any
clearance path. Node 5 now does the same for the wild-caught clearance specifically.

**Fix**: `pages/api/scan.js` Node 5's condition is now
`isSeafood && !flags.some(f => f.severity === 'reject') && detectWildCaught(...)`. If either gate
fails, execution falls through the existing `else if` chain to whichever node actually matches — no
new behavior was invented. For non-seafood "wild X" products this means falling straight through to
the category-specific node that already existed (e.g. Node 10 for `conventional_crops`). For a
genuinely wild-caught seafood product that also happens to carry an unrelated reject flag, it falls
to Node 5b, which injects its own `conventional_meat` flag alongside the pre-existing one — the exact
wording of that injected flag ("farmed or unlabeled") is a known, accepted imprecision for this narrow
case (the product *was* identified as wild-caught; the reject is for something unrelated), but the
verdict — the part that matters — is correctly RED either way. `detectWildCaught()` itself, Node 5b,
and all four wild-caught signals were left untouched, as scoped.

**A known, accepted trade-off** (flagged directly in the fix, not hidden): Node 5 previously allowed
wild-caught clearance from a product-name/ingredient-text signal alone, with no OFF category
confirmation — this was deliberately exercised by an existing test (`Suite N, N2`: "Wild Caught
Alaskan Salmon" with `categoriesTags: []`). Gating on `isSeafoodProduct(categoriesTags)` means a
genuinely wild-caught product that OFF simply failed to categorize with a seafood tag no longer gets
the special-cased GREEN — it now falls through to a cautious default (YELLOW via Node 14) instead.
This is an intentional, safer failure mode: "falls to a cautious default" is a strictly better outcome
than "silently discards a real reject flag," which was the original bug. `N2` was corrected to assert
the new, safer behavior (with the old GREEN/wild-caught result documented in the test's comment for
context); a new `N2b` test confirms the original clearance still works correctly once OFF *does*
provide a seafood category tag.

**⚠️ A passing test does not guarantee correct behavior if its own assertions don't cover its own
docstring's claim.** `Suite Q`'s existing test 3 ("Wild Berry Jam," ingredients `"strawberries, sugar,
pectin"`) had a comment claiming the product "reaches Node 14 (default yellow)" with "no concerning
ingredients" — both false. `"sugar"` is a real `conventional_crops` reject trigger, and prior to this
fix the actual result was `verdict: 'green', clearedBy: 'wild-caught'`, exactly this bug, reproducing
*inside the existing test suite's own fixture*. The test's only assertion
(`flags.some(f => f.category === 'conventional_meat') === false`) checked an unrelated category and
never asserted on `verdict` at all, so it passed regardless — this is how the bug shipped and stayed
undetected across every session in this series until now. `Q3` was corrected to assert `verdict` and
`clearedBy` directly, with the history documented in its own comment as a reminder for future sessions
to always assert the actual claim a test's docstring makes, not just a convenient proxy.

**Tests added/corrected:** `N2` corrected (was asserting the pre-fix GREEN/wild-caught result);
`N2b` added (confirms real seafood + OFF category still clears correctly); `Q3` corrected (was
asserting only `conventional_meat` absence, not the actual `verdict`/`clearedBy`, letting the bug hide
in its own fixture); `Q3b`, `Q5`, `Q6`, `Q7` added (non-seafood "wild X" + each of
`conventional_crops`/`conventional_eggs`/`bioengineering`/`glyphosate_heavy` → confirmed no longer
silently cleared to green); `Q8` added (genuinely wild-caught seafood + an unrelated reject flag →
confirmed still correctly RED, not the wild-caught GREEN). Also directly verified (not just assumed)
that the parallel Level 1 override path (`Override 2` in `pages/api/scan.js`, "mirrors L2 nodes 5 and
6") was never vulnerable to this bug shape — it already gated on `l1IsSeafood`, and structurally never
overwrites `verdict` to `'green'` in its wild-caught branch (it only ever leaves the engine's own
already-correct verdict alone, or upgrades green→yellow elsewhere), so a reject flag there was always
correctly surfaced. No change needed or made to the L1 path. Full suite: 1,188 passing (1,015
rulesEngine + 173 scan), no other regressions — searched both test files for every fixture containing
the word "wild"; all accounted for.

**PROMPT_VERSION bumped 28 → 29 — the same urgency as the earlier `glyphosate_heavy`/`gluten_grains`
verdict fixes.** This is a currently-live false "all clear" for a class of real products across
multiple categories (frozen fruit, cereal, condiments, prepared foods) — `verdict`/`clearedBy` change
for every previously-cached product that hit this bug. Run
`DELETE FROM scan_cache WHERE prompt_version < 29` in Supabase before/after deploying — treat this
purge as high-priority given the false-clean nature of the affected cached rows. The
`M. PROMPT_VERSION` contract test was updated to assert `29`.

### Session — raw truncated JSON leaking into explanation summary (July 2026, no PROMPT_VERSION bump — see reasoning below)

Follow-up to a production bug investigation: "Pink Himalayan Salt Flatbread Crackers" (barcode
860493002284, 17 flags across 3 categories) had a cached `explanation.summary` containing raw,
truncated JSON syntax — a literal `` ```json `` markdown fence, an unescaped opening `{`, and a
sentence cut off mid-word — served directly to users as the plain-language summary, with
`explanation.details` forced to `{}` despite the product having three flagged categories that
should each have their own detailed explanation.

**Root cause**: `fetchExplanation()` (`pages/api/scan.js`) and the standalone `pages/api/explain.js`
handler each independently hand-duplicated the same Claude-response-parsing logic:
```js
try {
  return JSON.parse(rawText);
} catch {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  return { summary: rawText, details: {} };  // ← the bug
}
```
When Claude's response never contains a closing `}` (a genuine mid-generation truncation, not just
a markdown-fence-wrapping issue), the regex-recovery attempt fails to find a match, and the code
fell through to dumping the **entire raw response** — fence, brace, truncated sentence, everything
— directly into `summary`. This is a different failure mode from every other Claude-call error in
this codebase: a missing API key returns `null`; any other thrown error is caught by an outer
`catch` and also degrades to `null`/a 502. Only this one specific failure mode (an unparseable but
non-throwing response) took a different, worse path that surfaced raw garbage to the user instead
of degrading like everything else already does. Confirmed `explanation: null` is a safe, already-
handled UI state before making this the target: `VerdictScreen` renders `"Tap a concern card below
for details."` when `explanation` is falsy, and `ConcernCard` guards its own detail paragraph with
`{explanation && ...}` — no crash, no missing-data UI break, just a graceful degrade.

**Contributing factor**: `max_tokens: 1000` at both call sites. The prompt requires a summary plus
one detailed, per-category explanation (each with specific required framing — e.g. `glyphosate_heavy`
must cover the pre-harvest-desiccation angle, the farming-system-choice framing, *and* mention
glyphosate-free certification) for every flagged category. The corrupted response itself showed
direct evidence of drifting from the "1-2 sentence summary" instruction — it was already listing all
three flagged issues inside `summary` before ever reaching `details`, eating into the same token
budget meant for the per-category explanations.

**Fix**:
1. Extracted the duplicated parsing logic into a single shared `parseExplanationResponse(rawText)`
   helper, exported from `pages/api/explain.js` (same pattern already established for
   `SYSTEM_PROMPT`/`buildUserMessage`, which `scan.js` already imports from that file) and imported
   into `scan.js`. Same reasoning as every other shared-logic fix this session: hand-duplicated logic
   in two places is exactly the shape that drifts apart over time.
2. The helper now returns `null` (never the raw text) when neither `JSON.parse()` nor the
   regex-recovery attempt succeeds — including a new inner `try/catch` around the regex-recovery
   `JSON.parse(match[0])` call, which previously could itself throw uncaught if the extracted span
   was structurally complete but internally invalid (e.g. an unescaped quote), producing a different,
   also-untested failure path.
3. `fetchExplanation()` now returns `parseExplanationResponse(rawText)` directly — `null` propagates
   through its existing, already-correct `null`-degrades-gracefully contract with zero other changes
   needed. `explain.js`'s handler now returns the same `502 { error: 'Failed to generate
   explanation.' }` shape already used for its other Claude-call failures when parsing fails, instead
   of inventing new behavior.
4. `max_tokens` raised `1000` → `2000` at both call sites.
5. Strengthened the `summary` field's instruction in `buildUserMessage()`'s JSON template to
   explicitly forbid listing multiple issues in the summary itself, directing that content to
   `details` instead — directly targeting the drift observed in the corrupted response.

**Tests added:** this parsing logic had zero test coverage anywhere in the codebase before this
session. Added a new `__tests__/api/explain.test.js` (11 tests: 5 direct unit tests of
`parseExplanationResponse()` covering clean/fenced/truncated/internally-invalid/prose-wrapped
responses, plus 6 handler-level tests covering input validation and the same clean/fenced/truncated
matrix end-to-end, including a `max_tokens: 2000` assertion) and a new Suite T in `scan.test.js`
(4 tests, same clean/fenced/truncated/max_tokens matrix through the real `/api/scan` handler, using a
module-scoped `jest.mock('@anthropic-ai/sdk', ...)` with a hoisted `mockAnthropicCreate` — confirmed
safe for every pre-existing test in the file, since none of them set `ANTHROPIC_API_KEY`, so
`fetchExplanation()` already short-circuits to `null` before the mocked client is ever invoked).
Full suite: 1,203 passing (1,015 rulesEngine + 177 scan + 11 explain), no regressions.

**No PROMPT_VERSION bump — different category of decision than every other bump above, documented
explicitly so it isn't confused with a verdict-changing fix later.** This bug affects only
`explanation` text quality, never `verdict`/`flags`/`clearedBy` — confirmed directly, no rules-engine
or L2-tree code was touched. Bumping `PROMPT_VERSION` purely as a cache-repair mechanism (to force the
one known-corrupted row, and any other undiscovered ones like it, to regenerate on next scan) was
considered and rejected: a `PROMPT_VERSION` bump invalidates the **entire** `scan_cache` table, not
just corrupted rows — every already-correct cached product would be re-fetched from Open Food Facts
and would trigger a brand-new (real-money) Claude API call on its next scan, purely to fix a small,
edge-case-correlated (multi-flag-category products specifically) number of corrupted explanation
rows. That's a disproportionate, blunt-instrument cost for a cosmetic-only bug. Instead, run a
targeted one-off cleanup in Supabase for rows matching this bug's specific fingerprint:
```sql
UPDATE scan_cache
SET explanation = NULL
WHERE explanation->>'summary' LIKE '%```%'
   OR explanation->>'summary' LIKE '{%';
```
This nulls out only the rows actually showing the corruption signature (a stray markdown fence or a
literal leading brace in `summary`) — `VerdictScreen` already degrades those to the safe "tap a
concern card" state, and they'll regenerate cleanly (with the fix in place) on next scan, without
touching the vast majority of cached rows that were never affected.

### Session — "-free"/"non-" bare-word trigger false positives + manufacturer address/facility-statement leakage (July 2026, PROMPT_VERSION 30)

Follow-up to a production bug investigation: "Guava Toasted Snack Crackers" had **no eggs anywhere**
in its ingredients, yet was cached with a reject-severity `conventional_eggs` flag — the AI-generated
explanation even noted the contradiction itself ("the packaging explicitly states this product is
made in an egg-free facility — so this flag appears to be incorrect"), meaning the app was showing
users a reject flag alongside AI text telling them the flag was probably wrong. The same product's
`unverified_ingredients` also contained the manufacturer's name, street address, and city/state/ZIP,
tokenized as if they were ingredients.

**Issue 1 — bare-word triggers false-positive on "-free"/"non-" claims (the more serious issue).**
`CONVENTIONAL_EGGS`'s existing word-boundary guard only checks whether the character immediately
before/after a match is a *letter* — a hyphen is not a letter, so `"egg-free"` sailed through
untouched. Investigation found this is not eggs-specific: systematically testing `-free` claims
against every bare-word trigger confirmed false positives for `egg-free` (`conventional_eggs`),
`corn-free`/`wheat-free`/`barley-free`/`rye-free` (`gluten_grains`, `glyphosate_heavy`), and most
severely `canola-free` (`seed_oils` — an `INSTANT_RED_CATEGORIES` member, meaning a bare facility
disclaimer with zero real ingredient concern could force an entire product red). Further testing
during this session also found `sugar-free` (`conventional_crops`). A working precedent already
existed: `BIOENGINEERING_TERMS`'s bare `"gmo"` trigger already had a dedicated inline guard checking
for `"non-"`/`"non "` prefixes and `"-free"`/`" free"` suffixes (with its own test coverage), but it
was written narrowly for that one trigger only, not generalized.

**Fix**: extracted the `"gmo"` guard's logic into a single shared `isInFreeOrNonContext(text, index,
end)` helper (`lib/rulesEngine.js`, alongside `isPrecededByOrganic()`/`isPrecededBySourceNote()`),
and applied it to every bare-word trigger category: `SEED_OILS` (previously had no boundary guard of
any kind — converted from `matchAndClaim()` to direct `findMatches()` + manual claiming, so a
guarded/rejected match doesn't block another category from matching the same span), `CONVENTIONAL_CROPS`,
`CONVENTIONAL_EGGS` (added alongside its existing, still-valid letter-adjacency guard, which protects
a different case — `"eggplant"` — and was left in place), `GLUTEN_GRAINS`, `GLYPHOSATE_HEAVY`
(added alongside the existing bare-`"malt"` guard, which protects a different case —
`"maltodextrin"`/`"maltose"` — and was left in place), and `BIOENGINEERING_TERMS`'s own `"gmo"`
trigger (refactored to call the shared helper instead of its own inline copy — confirmed via direct
testing that `match.index + 3` in the old code and `match.end` in the new code are mathematically
identical for the exactly-3-character `"gmo"` trigger, so this is a pure extraction with zero
behavior change). `GLUTEN_GRAINS`'s intentional lack of letter-adjacency boundary protection (e.g.
`"wheat"` inside `"wheatgrass"` is deliberately still flagged — a real prolamin concern, not a bug)
was left untouched; only the new `-free`/`non-` check was added, not a general boundary guard.

**Issue 2 — manufacturer address / facility-statement leakage (separate root cause, smaller fix).**
Two phrasings weren't covered by any existing `stripAllergenAdvisory()` pattern: (1) `"Manufactured
by: [company] [address]"` — conceptually unrelated to the existing `"manufactured on a line"`
cross-contact pattern (that one is about shared equipment; this one is company attribution); (2)
`"THIS PRODUCT IS MADE IN A [...] FACILITY [...]."` — close in spirit to the existing `"produced in a
facility"` pattern but different exact wording, so the literal-phrase regex didn't match it. Added
both as new patterns. The `"manufactured by:"` pattern required extra care: a period-anchored
pattern (matching the style of every other pattern in this function) doesn't work here, since a
printed address routinely contains its own abbreviation periods (`"N.E."`, `"3rd."`) that would
terminate the match early and leave the rest of the address behind — and a comma-anchored fallback
doesn't work either, since addresses contain their own internal commas (`"Miami, FL 33138"`). Newline
is the only reliable boundary. Confirmed via direct testing that a naive `(?:\n|$)` end-of-string
fallback creates a real over-matching risk — `"Manufactured by: Foo Corp, real ingredient X, real
ingredient Y"` with no following newline would swallow the real ingredients too — so the end-of-string
fallback was deliberately dropped; `"manufactured by:"` with no following newline is now left
unstripped rather than risk consuming real ingredient text, a conservative trade-off documented
inline in the code and covered by its own regression test.

**Relationship between the two issues**: related but not the same root cause. Fixing Issue 2's
facility-statement stripping coincidentally also removes this specific product's `egg-free` false
positive, since `"EGG-FREE"` lives inside the exact sentence that gets stripped — but Issue 1 needed
its own general fix regardless, since `-free` claims commonly appear outside facility-disclaimer
sentences entirely (front-of-package badges, standalone "Free From: Eggs, Dairy, Soy" lists, etc.),
which a facility-specific strip would never catch.

**Tests added (block 73, rulesEngine.test.js):** 19 tests — the full confirmed blast radius
(`egg-free`, `corn-free`, `wheat-free`, `barley-free`, `rye-free`, `canola-free`, `sugar-free`, each
confirmed to no longer flag); a regression guard confirming a real, non-`"-free"` occurrence of each
trigger still correctly flags; five regression guards confirming the pre-existing `"gmo"`/`"non-gmo"`
guard behavior is byte-for-byte unchanged by the generalization (including that a real bioengineering
disclosure and a real bare `"gmo"` trigger still correctly flag); the `"manufactured by:"` strip with
and without a following newline (including the over-matching regression guard); the `"made in a ...
facility"` strip; regression guards confirming the pre-existing `"produced in a facility"` and
`"manufactured on a line"` patterns are unaffected by the new ones; and the full combined Guava
Crackers reproduction. Searched both test files for any other fixture using a `-free` phrase or
manufacturer/facility text in actual ingredient input (not just a test title) — found and confirmed
safe. Full suite: 1,222 passing (1,034 rulesEngine + 177 scan + 11 explain), no regressions.

**PROMPT_VERSION bumped 29 → 30.** This changes real `flags`/`verdict` output for a class of
previously-cached products — any product whose OFF ingredient text contains a `"-free"` facility
disclaimer or allergen claim naming an ingredient that happens to be a bare-word trigger, most
severely any `"canola-free"` product that was previously force-reded via `seed_oils` alone. Run
`DELETE FROM scan_cache WHERE prompt_version < 30` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `30`.

---

### Session — `is_meat` ingredient-text corroboration, Phase 1 (July 2026, no PROMPT_VERSION bump)

Follow-up to two live diagnosis sessions: `isMeatProduct()` in `pages/api/scan.js` had both a
false-positive and a false-negative problem, both traced to relying solely on OFF `categories_tags`
via exact `Set` lookup against a hand-maintained `MEAT_CATEGORIES` list, with zero ingredient-text
fallback.

**False positive**: `MEAT_CATEGORIES` included bare parent tags `'en:broths'` and `'en:stocks'`. OFF
applies these to vegetable/mushroom broths and stocks, not just meat ones — a scanned "Organic
Vegetable Broth" (barcode 850014634438, zero meat ingredients) was cached `is_meat: true` purely
because it carried `"en:vegetable-broths"` and its ancestor tag `"en:broths"`. This was masked in
that specific cached row only because the product also carried a USDA Organic label, which routes
the L2 tree into the organic branch (Node 4) — a branch that never checks `isMeat` at all. A
non-organic vegetable broth, or any vegetable broth at L1 (Override 2 has no organic gate), would
have shown a live, incorrect `conventional_meat` flag.

**False negative — three confirmed modes**: (A) `categories_tags` missing/undefined entirely — no
data to match, ever (e.g. "Grass fed beef," "PORK CHORIZO"). (B) `categories_tags` present but only
containing OFF's modern canonical parent tags (`"en:meats-and-their-products"`,
`"en:prepared-meats"`) rather than the specific short-form tags the set checked for
(`"en:beef"`) — common for US-contributed products, which often don't drill into leaf category
tags. Confirmed exact production repro: barcode 011110101082 ("Seasoned Roast Beef," ingredients
"ORGANIC BEEF, WATER, SEA SALT, ORGANIC BLACK PEPPER") — `is_meat: false`, skipped the entire meat
decision branch, fell through to Node 14's generic default `yellow` with zero flags, identical
treatment to a bag of uncertified pistachios. (C) `categories_tags` present but filed under an
unrelated OFF branch entirely (beef burgers under `"en:sandwiches"`, beef tallow under `"en:fats"`,
bacon under `"en:snacks"`). A scan_cache sample of 39 meat-named products found 22 (56%) with
`is_meat: false`.

**Fix**: added ingredient-text corroboration as a second, independent signal, following the existing
`MILK_DERIVED_INGREDIENTS`/`containsMilkDerived()` pattern.
- `lib/rulesEngine.js`: new `MEAT_INGREDIENT_TERMS` array (terrestrial meat only — beef/pork/
  chicken/turkey/lamb/veal and processed forms like bacon, ham, salami, sausage, deli meat) and
  `containsMeatIngredient()` helper, using the existing `matchesWholePhrase()` word-boundary
  matcher. Deliberately scoped to terrestrial meat only, this pass — seafood and game meat are
  excluded, since they interact with `isSeafoodProduct()`/`isGameMeatProduct()` and the
  wild-caught/no-cert-required tree branches (Node 5/5b/6), which need their own routing signal
  (`isSeafoodIngredient`), not just `isMeat`; conflating them would misroute a real wild-caught or
  game product into the conventional-meat organic-required branch. Eggs are excluded — that's
  `CONVENTIONAL_EGGS`/`EGG_DERIVED_INGREDIENTS`'s job already.
- New `isInFlavorOrStyleContext(text, index, end)` guard, modeled directly on the existing
  `isInFreeOrNonContext()` pattern, wired into `matchesWholePhrase()` via a new optional third
  `guard` parameter (existing callers — milk, egg, gelatin — omit it and are unaffected; confirmed
  via the full test suite). Suppresses matches inside flavor/style/imitation wording —
  `"natural beef flavor"`, `"chicken-style seasoning"`, `"imitation bacon bits"` — so plant-based
  products using meat-word seasoning names don't false-positive.
- `pages/api/scan.js`: removed `'en:broths'`/`'en:stocks'` from `MEAT_CATEGORIES` (kept the specific
  `'en:bone-broth'`/`'en:chicken-broth'`/`'en:beef-broth'`). Confirmed this doesn't regress real
  broths — a genuine chicken broth's ingredient text ("chicken broth, chicken, salt") independently
  satisfies `containsMeatIngredient()`, so the existing `conventional_eggs`+`conventional_meat` test
  (Suite P, chicken broth with eggs) passes unchanged, now via ingredient corroboration instead of
  the removed tag.
- `isMeat` is now computed as `isMeatCategory || isMeatIngredient`, with both sub-signals kept as
  separate named variables (not collapsed) and logged via `console.log` on every scan, specifically
  so the false-positive/false-negative distinction that made this bug invisible for months — a
  single opaque boolean, no way to tell which signal produced it — doesn't recur. Direct precedent:
  the compounding issue found during diagnosis where `lib/rulesEngine.js`'s `WHOLE_FOOD_TOKENS_L2`
  already contained bare `'beef'`/`'pork'`/`'chicken fat'`/`'chicken stock'`, suppressing them from
  the `unverified_ingredients` human-review queue — confirmed via code trace that this list only
  affects the display-only unverified-ingredients pipeline (`lib/rulesEngine.js` line ~2102) and has
  no connection to `flags`/`verdict`/`isMeat`, so it was left unchanged; removing those entries would
  not have helped `isMeat` in any way and would only have reintroduced them to the review queue.

**Phase 1 vs Phase 2 — explicit scope decision.** This session shipped detection + logging only. Per
direct instruction, **no `scan_cache` schema change was made** — `isMeatCategory`/`isMeatIngredient`
are not persisted, only logged server-side. Persisting them as their own `scan_cache` columns (for
post-hoc auditing without re-scanning) is deferred to an explicit Phase 2.

**Tests added:** 11 new tests in `__tests__/api/scan.test.js` Suite H, in a new "Ingredient-text
corroboration" nested block — Mode A (empty and `undefined` `categories_tags`), Mode B (exact
011110101082 repro shape), Mode C (sandwiches/hamburgers miscategorization), vegetable-broth and
chicken-broth regressions (both directions), three flavor/style guard tests, and two isolation tests
proving the category and ingredient signals each work independently of the other. Confirmed the
pre-existing Suite P chicken-broth-with-eggs test still passes, now via ingredient corroboration
(`isMeatCategory: false, isMeatIngredient: true` in the new log output) rather than the removed
`'en:broths'` tag. Full suite: 1,233 passing (1,034 rulesEngine + 188 scan + 11 explain), up from
1,222 — no regressions.

**No PROMPT_VERSION bump.** `is_meat` is not part of the rules-engine `flags`/`verdict`/`clearedBy`
contract and is not fed into `buildUserMessage()` in `explain.js` — confirmed by grep, `isMeat` is
only consulted by the L1/L2 meat-decision-tree branches themselves (which independently determine
`flags`/`verdict` once routed) and by `VerdictScreen`'s unverified-copy branch. A cached row with a
stale `is_meat` value will self-correct on its next fresh scan (cache miss) without needing a forced
table-wide purge; there is no `scan_cache` column change to invalidate against. This matches the
reasoning already used for the July 2026 "raw truncated JSON" fix, the other precedent in this file
for a real bug fix that intentionally did not bump `PROMPT_VERSION`.

---

### Session — `is_meat` ingredient-text corroboration, Phase 2: persist sub-signals (July 2026, no PROMPT_VERSION bump)

Follow-up to the Phase 1 session above. Persists `isMeatCategory`/`isMeatIngredient` — computed and
logged in Phase 1 but not written to the DB — as two new `scan_cache` columns, so a cached row's
meat classification is queryable/auditable instead of only visible in ephemeral request logs.

**Migration**: [supabase/migrations/20260710000000_add_meat_signal_columns_to_scan_cache.sql](supabase/migrations/20260710000000_add_meat_signal_columns_to_scan_cache.sql)
— `ALTER TABLE scan_cache ADD COLUMN IF NOT EXISTS is_meat_category BOOLEAN;` and the same for
`is_meat_ingredient`. Deliberately nullable with **no `DEFAULT`** (unlike the `olive_caveat`
migration's `DEFAULT false`) — old rows get `NULL`, not `false`, for both columns, so "never
computed" stays distinguishable from "computed and false." **No backfill of existing rows was run —
an explicit non-goal for this pass.** Old rows populate naturally on their next fresh scan (cache
miss); until then, both columns read `NULL` for any row written before this migration.

**⚠️ Migration-application risk, found and confirmed during this session — read before deploying.**
Before writing this migration, checked the existing `20260607000000_add_olive_caveat_to_scan_cache.sql`
migration (added June 7, 2026) against the live database via a direct PostgREST query
(`select=olive_caveat`) and confirmed: **that migration file has never actually been applied to
production**, over a month after it was added to the repo — the live table still has no
`olive_caveat` column. This is exactly the failure that produced commit `bb3e83e` ("fix: remove
olive_caveat from scan_cache upsert — column does not exist in DB"), where a prior session added
`olive_caveat` to the `scan_cache` upsert payload assuming the migration had been applied; it hadn't,
so PostgREST rejected the entire upsert on every request, silently swallowed by the existing
try/catch, resulting in zero `scan_cache` writes until caught. **The same class of failure applies
here if this migration is not run before the code below is deployed** — `is_meat_category`/
`is_meat_ingredient` in the upsert payload would cause every write to fail the same way. This repo
has no automated migration-runner in the deploy pipeline; migrations in `supabase/migrations/` are
only applied when someone manually runs them against Supabase. **Run this migration against the live
database first, then confirm column existence** (e.g. `select=barcode,is_meat_category&limit=1` via
the REST API should return the column, not a `42703` error) **before deploying this code.**

**Code changes**:
- `pages/api/scan.js` — the `scan_cache` upsert payload now includes `is_meat_category: isMeatCategory`
  and `is_meat_ingredient: isMeatIngredient` alongside the existing `is_meat: isMeat`. `is_meat`'s
  computation is unchanged — still `isMeatCategory || isMeatIngredient` from Phase 1.
- **Every `scan_cache` write path was enumerated and checked**: the main upsert (`pages/api/scan.js`,
  now updated); a fire-and-forget `last_accessed_at` "touch" `.update()` on cache hits (same file) —
  left unchanged, since it only ever sets `last_accessed_at` and never touches `is_meat`-family
  columns, so there is nothing for it to persist that isn't already in the row from its original
  write. `pages/api/explain.js` has no `scan_cache` references at all (confirmed via grep) — it only
  writes to `unverified_ingredients`, a separate table. No other file in the codebase writes to
  `scan_cache`.
- **Console.log kept, not removed** — deliberate choice, not an oversight. Even with persistence in
  place, the log gives an immediate signal during this fix's rollout (and any future rules-engine
  work) without a DB round-trip, and given the `olive_caveat` precedent above, having a redundant
  real-time confirmation that this exact write path is actually succeeding post-deploy was judged
  worth the log volume.

**Tests added**: 4 new tests in `__tests__/api/scan.test.js` Suite H, in a new "scan_cache
persistence" nested block — category-only, ingredient-only, both, and neither match, each asserting
`is_meat_category` and `is_meat_ingredient` independently in the actual upsert payload (not just that
their OR equals `is_meat`, which Phase 1's tests already covered via the API response). This required
adding the first mock of `getSupabaseServer()` in this test file's history — `jest.mock('../../lib/supabaseServer')`
at module scope, defaulting every existing test to the same `undefined`-returning (falsy) behavior
`getSupabaseServer()` already had in the test environment (`SUPABASE_SERVICE_ROLE_KEY` is not set
locally), so all 1,233 pre-existing tests are provably unaffected; only the 4 new tests opt in via
`getSupabaseServer.mockReturnValueOnce(...)`. **Note for future sessions**: before this mock existed,
the `scan_cache` upsert payload had zero test coverage in this codebase — the `if (sb)` guard around
every write was always false during `npx jest` runs, so a malformed payload (like the `olive_caveat`
incident) could never have been caught by the test suite, only by a live production request. The new
mock infrastructure in this file can now be reused for that kind of test in future sessions.

Full suite: 1,237 passing (1,034 rulesEngine + 192 scan + 11 explain), up from 1,233 — no
regressions.

**No PROMPT_VERSION bump** — same reasoning as Phase 1: `is_meat` (and now its two persisted
sub-signals) are not part of the `flags`/`verdict`/`clearedBy` contract `PROMPT_VERSION` gates, and
are not fed into `buildUserMessage()` in `explain.js`. The `M. PROMPT_VERSION` contract test was
re-checked and still asserts `30`, unchanged.

---

### Session — deploy gap incident: ~8 sessions of committed-in-documentation work was never actually pushed (July 2026, process learning)

**What happened.** A routine investigation (prompted by a user question about whether a specific
fix was live) found that local `HEAD` on `mvp-beta` was `PROMPT_VERSION 22`, while this file
documented 7+ sessions of fixes up through `PROMPT_VERSION 30`, each written up as if shipped. Every
one of those fixes — including two with a currently-live, user-facing correctness bug (the wild-caught
Node 5 false-"all clear" bug, and the "-free"/"non-" bare-word guard false-positive bug) — existed
only in this machine's local working tree. `git log --all -S"<distinctive symbol>"` confirmed several
of these fixes (`isInFreeOrNonContext`, `parseExplanationResponse`) had **zero commits anywhere** in
the repository's history, on any branch. The gap was not a wrong-branch problem — `origin/mvp-beta`
was correctly what Vercel deploys (empirically confirmed via a live API response shape that only
`mvp-beta`'s code could produce, and via a `prompt_version` field read directly off a live cache-hit
row) — it was purely "the commits were never made."

**Root cause.** Work across roughly 8 sessions was implemented, tested (1,222+ passing tests each
time), and documented in this file's changelog, but `git commit`/`git push` was never part of the
session's own closing steps — each session ended with a fully-tested, correct, but entirely
uncommitted working tree, and the next session simply continued from there. `supabase/migrations/`
being untracked (see below) is a symptom of the same pattern.

**Fix.** All accumulated work was committed (5 separate, reviewable commits — see the individual
changelog entries above for `e4223f7`, `969d237`, `b059710`, `6437b85`, `8dbf62b`) and pushed to
`origin/mvp-beta`. Deploy was confirmed live via direct empirical checks, not assumed from a push
succeeding: a fresh scan of barcode 011110101082 returned `prompt_version: 30` read directly from
the written row (not inferred from cache-hit behavior), and the same scan's `verdict`/`flags`/`isMeat`
fields matched the new code's expected output, not the old deployed code's.

**Process change going forward: commit and push at the end of every session, not just when
explicitly asked.** The gap here wasn't caused by any single mistake — it was 8 sessions in a row
each leaving work uncommitted, compounding invisibly because nothing in the workflow surfaced the
growing gap until it was directly investigated. A session that ends with passing tests and a clean
diagnosis but an uncommitted working tree is not actually "done" — CLAUDE.md documentation describing
a fix as shipped is not a substitute for `git log` showing it. `supabase/migrations/` is now tracked
in git (see the `6437b85` changelog entry) specifically so migration files can no longer silently sit
unreviewed and unbacked-up on a single machine the way `olive_caveat`'s did for over a month.

---

### Session — bare "Contains X." allergen-statement false-flag fix (July 2026, PROMPT_VERSION 31) — CORRECTNESS / URGENCY, not cosmetic

Follow-up to a diagnosis session investigating garbled `unverified_ingredients` tokens (e.g.
`"TAPIOCA FLOUR. CONTAINS MILK"`, `"VEGAN"` leaking from a `"(VEGAN):"` label prefix). The cosmetic
symptom led to a much more serious finding: **`stripAllergenAdvisory()` only handled the colon form
`"contains:"` — a bare, no-colon `"Contains X."` sentence (the common FALCPA allergen-summary wording
many labels actually use) was never stripped, and the unstripped allergen name could trip a real,
**reject-severity** trigger.** Confirmed directly: `analyzeIngredients('sunflower seeds, dried
cranberries, sea salt. Contains wheat.', [], 2)` produced a `glyphosate_heavy` **reject** flag on
`"wheat"` and a RED verdict, on a product with no wheat ingredient anywhere — the word appears only in
the allergen advisory. Systematically tested every FDA "big 9" allergen plus the common gluten-grain
companions against every trigger category; confirmed reject-severity false flags for:
`glyphosate_heavy` (`wheat`, `barley`, `rye`, `oats`), `conventional_crops` (`soybean`, `soybeans`),
and `conventional_eggs` (`egg`, `eggs`). Only `gluten_grains` (already known, caution-only,
verdict-excluded) and the previously-diagnosed cosmetic leaks were caution-or-lower; these six terms
are `reject`-severity and directly flip the verdict red. The original repro that surfaced the cosmetic
bug used a `usda-organic`-labeled product, which incidentally cleared `conventional_crops` and
`glyphosate_heavy` regardless of the bug — masking the more severe issue underneath. Non-organic
products, the common unprotected case at L2, have no such shield.

**Fix — three additions to `lib/rulesEngine.js`, all inside `stripAllergenAdvisory()` /
`stripCertPrefixLabel()` (new)**:
1. **`"contains less than X% of [the following:]"` qualifier** — strips only the qualifier phrase
   itself, leaving everything after it in the ingredient text for normal tokenization and trigger
   matching. Written to cover both real-world phrasings in one pattern: the colon form
   (`"...of the following: soy lecithin, xanthan gum, natural flavors."`) and — discovered mid-fix,
   via the existing Kraft Mac & Cheese test fixture already in this suite — the equally common
   no-colon form (`"...of citric acid, sodium phosphate, ... soybean oil, yellow 5, yellow 6)."`).
   An earlier version of this pattern only matched the colon form; the no-colon form fell through to
   pattern 2's broader match, whose greedy `[^.]*` silently deleted the entire real ingredient list —
   citric acid, soybean oil, yellow 5, and yellow 6 all stopped flagging. Caught immediately by the
   existing test suite (46 failures on first pass), not a hypothetical risk.
2. **Bare `"Contains <allergen list>."`** — the actual false-flag source; strips the whole clause
   (period-terminated and end-of-string variants, mirroring the existing `"contains:"` pattern's own
   robustness). Two guards were required after the first implementation attempt broke existing tests:
   - A negative lookahead excluding bioengineering disclosures. `"contains a bioengineered food
     ingredient"` is itself a literal `BIOENGINEERING_TERMS` trigger phrase — the first version of
     this pattern deleted that mandatory disclosure before bioengineering detection ever ran,
     breaking every bioengineering-detection test in the suite.
   - A negative lookbehind (`(?<!^\s*)`) excluding matches where "contains" opens the string. A real
     allergen/qualifier disclosure always trails the actual ingredient list on a label — it never
     opens it. This also protects a widespread pre-existing test-fixture convention throughout this
     suite (`describe` blocks 13, 14, 17) that uses `"contains <additive>"` as a whole, standalone
     `ingredientText` string to name the additive under test — e.g. `'contains azodicarbonamide'` —
     which is a real ingredient declaration by construction, not throwaway advisory text, and must
     keep flagging.
3. **`stripCertPrefixLabel()`** (new function) — narrow, curated fix for leading `"(WORD):"`
   dietary/certification-claim prefixes (`vegan`, `kosher`, `halal`, `gluten-free`, `dairy-free`,
   `non-gmo`, `plant-based`), anchored to the true start of the string via `^`. Deliberately not a
   blanket "any leading parenthetical is not an ingredient" rule — confirmed via direct regex test
   that a genuine leading ingredient like `"(Organic) Coconut Milk, ..."` is untouched, since
   `"organic"` isn't in the curated list.

**Explicitly out of scope for this fix** (per the design review): the `"(color)"`-style single-word
category-descriptor parenthetical leak, and the sub-ingredient-flattening vocabulary gaps (e.g.
`"pasteurized cream"`, `"tomato paste"` showing as unverified) — both confirmed working as intended /
a separate vocabulary-coverage concern, not a parsing defect, during the diagnosis session.

**Tests added (block 74, `lib/rulesEngine.test.js`):** 23 tests — the 8 confirmed reject-severity
false-flag terms (`wheat`, `barley`, `rye`, `oats`, `soybean`, `soybeans`, `egg`, `eggs`), each
asserting zero flags and a non-red verdict with **no organic label** (the unprotected case); 3
negative controls (`soy`, `milk`, `corn` — confirm still clean/unaffected); the qualifier tests
proving a real reject-severity ingredient (`natural_flavors`) after both the colon and no-colon
qualifier forms still flags, plus a test confirming the qualifier phrase itself never becomes an
`unverifiedIngredients` token; an explicit pattern-ordering guard; the `"(VEGAN):"` and `"(Kosher)"`
cert-prefix cases plus a regression guard for an unrelated genuine leading parenthetical; regression
guards for the pre-existing colon-form `"contains:"` patterns; regression guards for both
bioengineering disclosure phrasings; and a regression guard for the `describe` block 13/14/17
string-opening `"contains <additive>"` test-fixture convention. Full suite: 1,260 passing (1,057
rulesEngine + 192 scan + 11 explain), up from 1,237 — two rounds of regressions were caught and fixed
during implementation (46 failures, then 0) before this count was reached; see the fix description
above for both root causes.

**PROMPT_VERSION bumped 30 → 31.** This changes real `flags`/`verdict` output for a class of
previously-cached products — any product whose OFF ingredient text contains a bare, no-colon allergen
statement naming wheat, barley, rye, oats, soybean(s), or egg(s), most severely any such product with
no organic certification, which previously got an incorrect RED verdict from the advisory sentence
alone. Run `DELETE FROM scan_cache WHERE prompt_version < 31` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `31`.

**Confirmed deployed to production July 10, 2026** (not just committed): pushed as commit `2d795d9`,
Vercel auto-deployed from `origin/mvp-beta` (no manual trigger available or needed — detected via
polling the live app until a fresh, non-cache-hit scan was observed). `prompt_version: 31` confirmed
via a direct PostgREST query against a freshly-written `scan_cache` row (barcode 011110101082), not
inferred from cache-hit behavior. The fix itself was verified two ways: (1) real production
`scan_cache` data was searched for a bare "Contains wheat/soy/egg" statement with no corresponding
real ingredient — none exists (every real match found genuinely contains the named allergen elsewhere
in its ingredient list too, consistent with allergen statements usually being redundant with the real
list rather than naming something absent); (2) the confirmed repro
(`'sunflower seeds, dried cranberries, sea salt. Contains wheat.'` → previously a false
`glyphosate_heavy` reject) was re-run directly against `lib/rulesEngine.js` as it exists in the
deployed commit (confirmed byte-identical via `git diff HEAD` — zero lines), returning `flags: []`,
`verdict: 'green'`. No raw-ingredient-text debug path exists on the live `/api/scan` endpoint (it only
accepts a barcode), so this is the most direct verification available short of finding a real product
that isolates the bug.

---

### Session — L1 seafood copy fix + MEAT_CATEGORIES/SEAFOOD_CATEGORIES drift-risk fix (July 2026, PROMPT_VERSION 32)

Follow-up to a diagnosis session confirming `isConventionalMeat = isMeat && !isSeafood && !isGameMeat`
correctly routes seafood away from Node 8 at L2 (verified against real production data — no cached
seafood row shows the wrong "USDA Organic certification" messaging) — but found two smaller, real
issues in the surrounding code.

**Fix 1 — L1 seafood copy bug (user-facing correctness).** Override 2's injected `conventional_meat`
caution flag had a single hardcoded `summary` string with land-animal-only wording ("grass-fed,
pasture-raised... a farm you trust"), even though the code's own pre-existing comment ("Conventional
meat **or non-wild seafood**: inject educational caution") already acknowledged this branch also
catches farmed/unlabeled seafood. A farmed salmon or unlabeled seafood product at Level 1 was getting
land-animal sourcing copy. L2 already has correct, seafood-aware wording for the equivalent case
(`"Farmed or unlabeled seafood — wild-caught certification not found"`, confirmed live on barcode
099482477929). Fix: branch the summary text on `l1IsSeafood` (already computed, already used to gate
the wild-caught check one line above — no new signal needed), adapted to this file's L1 "Joel
explains..." educational tone (matching Override 3's `conventional_dairy` caution phrasing) rather
than L2's more direct reject-severity wording. The land-animal branch's original copy is completely
unchanged.

**Fix 2 — MEAT_CATEGORIES/SEAFOOD_CATEGORIES drift risk (defensive, not a live bug).** The two Sets
held identical seafood-related OFF tags today, but as two *separately* hardcoded literals with no
structural link — a future session editing one without remembering the other would silently
reintroduce a real gap (a fish/seafood product with `isMeatCategory: true` but `isSeafood: false`,
incorrectly routing to Node 8). Fixed by declaring `SEAFOOD_CATEGORIES` first and having
`MEAT_CATEGORIES` spread `...SEAFOOD_CATEGORIES` directly, mirroring the `LEVEL_1_YELLOW_TRIGGERS`
pattern in `lib/rulesEngine.js` (built from the actual category arrays specifically so it can't drift
from them). Confirmed zero behavior change: a drift-guard test asserts every `SEAFOOD_CATEGORIES`
entry is present in `MEAT_CATEGORIES`, and both Sets were exported from `pages/api/scan.js`
(test-only named exports, alongside the existing default `handler` export) specifically to make this
assertion possible — this is the first place in the codebase two "same tags, different lists" Sets are
checked for consistency directly rather than by inspection.

**Tests added:** 3 — a drift-guard test (Suite H) asserting `SEAFOOD_CATEGORIES ⊆ MEAT_CATEGORIES`;
an extension of the existing Suite S `S2` farmed-seafood-at-L1 test asserting the injected flag's
`summary` now contains "wild-caught" and does NOT contain "grass-fed"/"pasture-raised"; and a new
regression test confirming a genuine land-animal product (`en:beef`) at L1 still gets the original,
unchanged grass-fed/pasture-raised copy. Full suite: 1,262 passing (1,057 rulesEngine + 194 scan + 11
explain), up from 1,260.

**PROMPT_VERSION bumped 31 → 32** — for Fix 1 only; Fix 2 is confirmed zero-behavior-change (verified
by the drift-guard test and by direct comparison of the resulting Set contents before/after), so it
would not independently require a bump. Fix 1 changes the literal `summary` string stored in the
`flags` JSONB array within `scan_cache` for L1 farmed/unlabeled seafood scans — a cached row from
before this fix would keep serving the wrong land-animal copy on every future cache hit if the version
weren't bumped, the same reasoning already applied to every prior flags/verdict-content fix in this
file (v23 through v31). Note this differs from the `is_meat` Phase 1/2 sessions' "no bump" reasoning —
those changes genuinely didn't touch anything stored in the `flags` array itself; this one does. Run
`DELETE FROM scan_cache WHERE prompt_version < 32` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `32`.

**Confirmed deployed to production July 10, 2026** (not just committed): pushed as commit `96620f8`,
Vercel auto-deployed from `origin/mvp-beta` (no manual trigger available or needed — detected via
polling the live app until a fresh, non-cache-hit scan was observed at the new `prompt_version`).
`prompt_version: 32` confirmed via direct PostgREST queries against freshly-written `scan_cache` rows
for barcode 099482477929 — both `user_level: 1` and `user_level: 2` — not inferred from cache-hit
behavior. Fix 1 confirmed live and working on this real product: a fresh L1 scan (`userLevel: 1` is a
plain request-body parameter) of "Farm-Raised Atlantic Salmon Fillets" returned the new seafood-specific
`conventional_meat` caution summary verbatim — `"Farmed or unlabeled seafood — Joel explains the
difference between wild-caught and farmed: sourcing matters as much as ingredients. Look for a
wild-caught certification, or seafood from a source you trust."` — not the old land-animal
"grass-fed, pasture-raised" copy. The AI-generated `explanation.details.conventional_meat` for the same
scan also correctly picked up the seafood framing ("Farm-raised Atlantic salmon typically means fish
raised in ocean pens..."), confirming the fix propagates through to the Claude-generated explanation
as well, not just the static flag summary.

---

### Session — bare 'ada' trigger word-boundary guard: "macadamia nuts" / "Canada" false-positive fix (July 2026, PROMPT_VERSION 33)

Follow-up to the previous session's safety-net testing work (see the two "SAFETY NET" test blocks
appended to `lib/rulesEngine.test.js` and `__tests__/api/scan.test.js`): the cross-list contradiction
guard test (Test 3 of that session) surfaced a real, previously-undiscovered bug alongside 8 harmless
"dead list entry" findings. This session fixes the one real bug; the 8 dead entries are explicitly
out of scope, being handled in a separate pass.

**Root cause.** `SYNTHETIC_ADDITIVES` (`lib/rulesEngine.js`) has a bare `'ada'` trigger (abbreviation
for azodicarbonamide, a Texas SB 25 dough-conditioner disclosure). Unlike `CONVENTIONAL_EGGS` (which
applies a letter-adjacency word-boundary guard to every trigger in its loop) or the bare `'malt'`
trigger in `GLYPHOSATE_HEAVY` (which guards its trailing letter), the bare `'ada'` trigger had no
boundary guard at all — `findMatches()` does plain substring matching, so `'ada'` matched inside any
word containing that three-letter sequence. Confirmed two real false positives: **"macadamia nuts"**
(`m-a-c-ADA-mia`) and **"Canada"** (`C-ADA...`, e.g. a "Product of Canada" manufacturer statement) —
both produced a phantom `additives` reject flag and a false RED verdict with no azodicarbonamide
anywhere in the product. Reproduced directly: `analyzeIngredients('Almonds, macadamia nuts, cashews,
sea salt.', [], 2)` returned a reject-severity `additives` flag (`matchedIngredient: 'ada'`) and
`verdict: 'red'` before this fix.

**Fix.** Added a word-boundary guard for the bare `'ada'` trigger only, inside the existing
`SYNTHETIC_ADDITIVES` matching loop in `analyzeIngredients()` — mirrors the `CONVENTIONAL_EGGS`
letter-adjacency guard (checks the characters immediately before and after the match; skips if either
is a letter) rather than the bare `'flavor'` trigger's two-back check just above it in the same loop,
since `'ada'` is a mid-word substring risk on both sides, not a "`<word> flavor`" compound-descriptor
risk. Confirmed via direct testing that true positives are unaffected: bare standalone `"ADA"`,
the full chemical name `"azodicarbonamide"`, and a comma-adjacent `"Flour,ADA,salt."` (no surrounding
whitespace — the guard checks adjacent characters, not just whitespace) all still correctly flag.

**Other short bare triggers audited — two more real false-positive collisions found, NOT fixed this
session (reported per instruction, awaiting a separate decision):**
Systematically reviewed every bare (no-space), ≤4-character trigger across every substring-matched
category in `lib/rulesEngine.js` (excluding categories already protected by construction — anything
matched via `matchesWholePhrase()`, i.e. `MILK_DERIVED_INGREDIENTS`, `EGG_DERIVED_INGREDIENTS`,
`MEAT_DERIVED_INGREDIENTS`, `MEAT_INGREDIENT_TERMS`; anything in `CONVENTIONAL_EGGS`, which already
has its own loop-level word-boundary guard; and anything in the Set-based exact-match display-only
lists `WHOLE_FOOD_TOKENS_L2`, `REVIEWED_CLEAN_INGREDIENTS`, `ARTIFACT_PHRASES`, none of which do
substring matching at all). Two confirmed, reproducible false positives of the same bug class:

1. **`'oats'` (`GLYPHOSATE_HEAVY` and `GLUTEN_GRAINS`) inside `"goats"`** — `analyzeIngredients("goats'
   milk yogurt, sea salt.", [], 2)` produces `glyphosate_heavy:oats` (**reject severity — verdict-
   changing**) and `gluten_grains:oats`. "Goat milk," "goat cheese," and "goats' milk" are common real
   ingredient declarations with zero oat content. This is the more severe of the two — it flips the
   verdict RED via a `glyphosate_heavy` reject flag with no clearance available (no oats to certify
   organic/glyphosate-free), unlike the `gluten_grains` case which is caution-only and paywall-hidden.
2. **`'corn'` (`GLUTEN_GRAINS`) inside `"acorn"`** — `analyzeIngredients('acorn squash, sea salt,
   water.', [], 2)` produces `gluten_grains:corn`. Caution-only, does not change verdict (gluten_grains
   is excluded from verdict calculation and stripped from both L1/L2 display), but still incorrect data
   in the returned `flags` array.

A third candidate, **`'rice'` (`GLUTEN_GRAINS`) inside `"price"`**, was also confirmed mechanically
(`analyzeIngredients('suggested retail price may vary, salt.', [], 2)` → `gluten_grains:rice`) but is
lower priority — `ingredients_text` from Open Food Facts is the literal ingredient list, not marketing
copy, so this exact collision is unlikely to occur in a real product's ingredient text the way "goat
milk" or "acorn squash" routinely would.

Reviewed and found **no confirmed real-word collision** (kept as-is, no action needed): `'tvp'`,
`'miso'` (`CONVENTIONAL_CROPS`); `'msg'`, `'tbhq'`, `'bha'`, `'bht'`, all bare E-number triggers like
`'e330'`/`'e924'` (`SYNTHETIC_ADDITIVES` — alphanumeric E-number codes are not plausible accidental
substrings of English words); `'wonf'` (`NATURAL_FLAVORS`); `'gmo'` (`BIOENGINEERING_TERMS` — already
has the shared `isInFreeOrNonContext()` guard for the `"non-gmo"` case, though not a general
letter-adjacency guard); `'iron'` (`FORTIFIED_VITAMINS`); `'teff'`, `'masa'` (`GLUTEN_GRAINS`). Also
noted: the existing bare `'malt'` guard (`GLYPHOSATE_HEAVY`) only checks the trailing character
(protects `'maltodextrin'`/`'maltose'`) and has no leading-character check — no real collision found on
this pass, but it's an incomplete guard by the same reasoning as the `'ada'` fix above, worth revisiting
if a leading-letter collision ever surfaces.

Per instruction, **none of the `'oats'`/`'acorn'`/`'price'` findings were fixed in this session** —
each needs its own judgment call on the same "does this change real output" basis the `'ada'` fix went
through, and the user asked to review them separately before any change.

**Tests added (`lib/rulesEngine.test.js`, new "SESSION FIX" describe block):** 5 tests — `"macadamia
nuts"` no longer flags `additives`; a `"Product of Canada"` manufacturer statement no longer flags
`additives`; bare standalone `"ADA"` (true positive) still flags; the full chemical name
`"azodicarbonamide"` (true positive) still flags; a comma-adjacent `"Flour,ADA,salt."` (no surrounding
whitespace) still flags, confirming the guard is punctuation-aware rather than whitespace-only. The
previous session's cross-list contradiction safety-net test was re-run and confirmed: `"macadamia
nuts"` no longer appears in its failure output; the test still fails, but only with the 8 pre-existing,
out-of-scope "dead entry" findings (`coconut sugar`, `date sugar`, `flax seeds`, `sweet potato`,
`quinoa`, `amaranth`, `teff`, `lactic acid starter culture`) — untouched, per instruction, and being
handled in a separate pass. Full suite: 1284 passing / 1 known pre-existing failure, up from 1279
passing / 1 failing before this session's fix.

**PROMPT_VERSION bumped 32 → 33.** This changes real `flags`/`verdict` output for a class of
previously-cached products — any product whose ingredient text or product name contains "macadamia"
(nuts, oil, etc.) or the word "Canada" anywhere (most commonly a "Product of Canada" or "Made in
Canada" manufacturer statement) previously carried an incorrect reject-severity `additives` flag and,
if that was the product's only concern, an incorrect RED verdict. Run
`DELETE FROM scan_cache WHERE prompt_version < 33` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `33`.

---

### Session — 'oats'/'corn'/'rice' collision-word guards: "goat milk" / "acorn squash" / "price" false-positive fix (July 2026, PROMPT_VERSION 34)

Follow-up to the `'ada'` fix session above: the "additional findings" audit from that session flagged
three more real false positives of the same bug class (a short bare trigger substring-matching inside
an unrelated word), left unfixed at the time pending review. This session fixes the most severe one
(`'oats'` inside `"goats"` — verdict-changing) plus the two lower-priority ones batched in, per
instruction.

**Root cause.** `GLYPHOSATE_HEAVY` and `GLUTEN_GRAINS` (`lib/rulesEngine.js`) have bare `'oats'`
triggers with no word-boundary guard (`GLYPHOSATE_HEAVY` also has `'oat milk'`/`'oatmilk'`, both of
which share the same collision). `GLUTEN_GRAINS` also has bare `'corn'` and `'rice'` triggers, likewise
unguarded. All four collide with a real word that happens to start with the trigger preceded by exactly
one collision letter:

- `'oats'`/`'oat milk'`/`'oatmilk'` inside **"goat"** + suffix — `"goats' milk yogurt"` and `"goat
  milk"` both matched, producing a reject-severity `glyphosate_heavy` flag (**verdict-changing** — no
  clearance available on a goat-dairy product, since there are no actual oats to certify
  organic/glyphosate-free) plus a `gluten_grains` caution, on products containing zero oats. Reproduced
  directly: `analyzeIngredients("Goats' milk yogurt, sea salt.", [], 2)` returned `verdict: 'red'`
  before this fix.
- `'corn'` inside **"acorn"** — `"acorn squash"` matched, producing a `gluten_grains` caution
  (does not change verdict — gluten_grains is excluded from verdict calculation and stripped from
  both L1/L2 display).
- `'rice'` inside **"price"** — `"suggested retail price may vary"` matched, producing a
  `gluten_grains` caution. Lower real-world likelihood than the other two (`ingredients_text` from Open
  Food Facts is a literal ingredient list, not marketing copy), fixed anyway per instruction since it's
  the same guard mechanism.

**A blanket adjacent-letter guard (the same style used for the `'ada'` fix) is not safe here** — unlike
`'ada'`, which has no legitimate word it's a real suffix of, bare `'corn'` is legitimately a suffix of
**"popcorn"** (`analyzeIngredients('Popcorn, sea salt, water.', [], 2)` correctly produces
`gluten_grains:corn` today, and must keep doing so — popcorn genuinely is corn). A guard that skips any
letter-adjacent `'corn'` match would silently break this real, intended match. Confirmed the same risk
exists for `'rice'` (e.g. "licorice" also contains the substring "rice") and for `'oats'` (e.g. "coats"
also contains "oats") — see "Residual, out-of-scope collisions found" below.

**Fix.** Added a new shared helper, `isImmediatelyPrecededByLetter(text, index, letter)`
(`lib/rulesEngine.js`, alongside `isInFreeOrNonContext()`), that checks whether the single character
immediately before the match equals a specific `letter` AND that letter itself begins a word (the
character before *it* is not a letter). This distinguishes `"acorn"` (the `'a'` of "acorn" is
word-initial, immediately preceding `'corn'`) from `"popcorn"` (the `'p'` of "pop" precedes `'corn'`,
not `'a'`) without a blanket rule. Applied at four call sites: `GLYPHOSATE_HEAVY`'s loop (for
`'oats'`/`'oat milk'`/`'oatmilk'`, guarding against a preceding `'g'`) and `GLUTEN_GRAINS`'s loop (for
`'oats'` guarding `'g'`, `'corn'` guarding `'a'`, `'rice'` guarding `'p'`). Confirmed via direct testing
that every currently-correct match survives unchanged: bare `"oats"`, `"rolled oats"`, a real
`"Oat milk"` product, bare `"corn"`, `"popcorn"`, bare `"rice"`, and `"brown rice"` all still flag
exactly as before.

**Residual, out-of-scope collisions found during this fix — NOT fixed, reported per this project's
"don't silently expand scope" convention (same as the `'ada'` session's malt-guard note):** while
verifying the `'popcorn'` non-regression above, three more real collisions of the identical bug class
were found, all involving a *different* collision letter than the one just fixed, so they fall outside
the narrow `isImmediatelyPrecededByLetter()` calls added this session:

- **`'corn'` inside "unicorn"** (`'u-n-i-corn'`, collision letter `'i'`) — e.g. "unicorn sprinkles," a
  real novelty-food ingredient descriptor. `analyzeIngredients('unicorn sprinkles, sugar, salt.', [],
  2)` still produces `gluten_grains:corn`.
- **`'rice'` inside "licorice"** (`'l-i-c-o-rice'`, collision letter `'o'`) — licorice is a common,
  plausible real ingredient. `analyzeIngredients('licorice, sugar, salt.', [], 2)` still produces
  `gluten_grains:rice`.
- **`'oats'` inside "coats"** (collision letter `'c'`) — lower real-world relevance (a coating
  descriptor, e.g. "chocolate coats," is less commonly how it would appear verbatim in
  `ingredients_text`, but the mechanism is identical). Still produces `glyphosate_heavy:oats` and
  `gluten_grains:oats`.

Each would need its own `isImmediatelyPrecededByLetter(text, index, '<letter>')` call added at the same
two call sites — cheap to add, but deliberately left for a separate pass so each can get the same
"does this change real output" review the `'ada'`/`'oats'`/`'corn'`/`'rice'` fixes went through, per
instruction.

**Tests added (`lib/rulesEngine.test.js`, new "SESSION FIX" describe block):** 11 tests — `"goat
milk"` and `"goats' milk yogurt"` no longer trigger `glyphosate_heavy`/`gluten_grains`; regression
checks confirming bare `"oats"`, `"rolled oats"`, and a real `"Oat milk"` product still correctly
flag; `"acorn squash"` no longer triggers `gluten_grains`; regression checks confirming bare `"corn"`
and `"popcorn"` still correctly flag; `"suggested retail price"` no longer triggers anything from the
`'rice'` trigger; regression checks confirming bare `"rice"` and `"brown rice"` still correctly flag.
Full suite: 1295 passing / 1 known pre-existing failure (the previous session's cross-list
contradiction test, unchanged — still only the same 8 out-of-scope "dead entry" findings), up from
1284 passing / 1 failing before this session's fix.

**PROMPT_VERSION bumped 33 → 34.** This changes real `flags`/`verdict` output for a class of
previously-cached products — most severely, any goat-dairy product (goat milk, goat's milk yogurt,
goat cheese made with goat milk as a listed ingredient) previously carried an incorrect reject-severity
`glyphosate_heavy` flag and, since goat dairy has no oats to certify organic/glyphosate-free, an
incorrect RED verdict with no available clearance path. Also affects any product containing "acorn"
(acorn squash) or the word "price" in its ingredient text, though those are caution-only and do not
flip the verdict. Run `DELETE FROM scan_cache WHERE prompt_version < 34` in Supabase before/after
deploying. The `M. PROMPT_VERSION` contract test was updated to assert `34`.

---

### Session — allowlist-based redesign of the collision-word guard: "licorice" fix + auto-closes unicorn/coats (July 2026, PROMPT_VERSION 35)

Follow-up to the `'oats'/'corn'/'rice'` fix session above, which left three same-class collisions
unfixed pending review: `'corn'` inside `"unicorn"`, `'rice'` inside `"licorice"`, `'oats'` inside
`"coats"`. This session fixes `"licorice"` with the same urgency as the goat/oats fix (licorice is a
common real ingredient — black licorice candy, licorice root in herbal products), and replaces the
per-letter guard design so this bug class stops recurring one hand-found collision at a time.

**Why the previous design kept missing collisions.** `isImmediatelyPrecededByLetter(text, index,
letter)` required hand-confirming and hardcoding one specific collision letter per call site: `'g'` for
oats/`"goats"`, `'a'` for corn/`"acorn"`, `'p'` for rice/`"price"`. Each fix only closed the exact
collision that had already been found — it did nothing for any *other* letter that happens to precede
the same trigger inside a *different* word. `'corn'` is also a substring of `"unicorn"` (preceded by
`'i'`), `'rice'` is also a substring of `"licorice"` (preceded by `'o'`), and `'oats'` is also a
substring of `"coats"` (preceded by `'c'`) — none of which the `'g'`/`'a'`/`'p'`-specific checks could
ever catch, since they only fire for one exact letter each.

**Redesign.** Replaced `isImmediatelyPrecededByLetter()` with `isPrecededByLetterUnlessAllowlisted(text,
index, end)` (`lib/rulesEngine.js`) — a strict default (**any** letter immediately preceding a bare
trigger match blocks it, not one specific hardcoded letter) plus a new `TRIGGER_ADJACENCY_ALLOWLIST`
Set for confirmed-legitimate compounds where the letter-adjacency is real, not a collision. Only one
entry was already known: `'popcorn'` (bare `'corn'` — popcorn genuinely is corn). Applied at the same
four call sites as before (`GLYPHOSATE_HEAVY`'s `'oats'`/`'oat milk'`/`'oatmilk'`, `GLUTEN_GRAINS`'s
`'oats'`/`'corn'`/`'rice'`), now with no per-trigger letter parameter — the three `GLUTEN_GRAINS` checks
were consolidated into a single shared condition since they're now identical logic. The `'ada'` guard
(`SYNTHETIC_ADDITIVES`, fixed two sessions ago) was deliberately **left untouched** — it already checks
both adjacent sides with its own inline implementation and wasn't named for replacement; touching it
was out of scope for this session.

**A real regression was found and fixed during this change, before it ever reached a commit.** Running
the full suite against the new stricter default immediately failed an existing test: `"water, oat
groats, salt"` stopped producing a `glyphosate_heavy` flag. Root cause: `GLYPHOSATE_HEAVY` has no
dedicated `'oat groats'` or `'groats'` trigger of its own — it relied entirely on bare `'oats'`
coincidentally matching the tail of `"groats"` to flag oat groats at all. Unlike every other collision
fixed this session, this one is **not** a false positive — oat groats genuinely are oats (hulled whole
oat kernels), so the flag was correct, just produced by an accidental substring match rather than a
deliberate trigger. Added `'groats'` to `TRIGGER_ADJACENCY_ALLOWLIST` alongside `'popcorn'`, with the
same reasoning: a confirmed-legitimate compound, not a collision. Noted trade-off: this is a bare-word
allowlist entry (not scoped to `"oat groats"` specifically), so an unqualified `"Groats"` ingredient
would also stop flagging — accepted as low-impact, since real labels almost always qualify it
(oat/buckwheat/wheat groats), and `"buckwheat groats"`/`"wheat groats"` are unaffected either way
(both have their own longer, more specific `GLYPHOSATE_HEAVY` triggers claimed before bare `'oats'` is
ever tried).

**Confirmed via direct testing, both fixed automatically by the redesign with zero new code:**
`"licorice"`, `"licorice root extract"`, and `"black licorice"` no longer trigger `gluten_grains` via
`'rice'`; `"unicorn sprinkles"` no longer triggers via `'corn'`; `"coats of chocolate"` no longer
triggers via `'oats'`. Every previously-fixed case (`"goat milk"`, `"goats' milk yogurt"`, `"acorn
squash"`, `"suggested retail price"`) and every true-positive case (bare `"oats"`/`"corn"`/`"rice"`,
`"rolled oats"`, real `"Oat milk"`, `"popcorn"`, `"brown rice"`) was re-verified unchanged.

**Audit — other bare 4–6 character triggers in `SYNTHETIC_ADDITIVES`, `GLUTEN_GRAINS`, and
`GLYPHOSATE_HEAVY` checked for the same false-positive shape, per instruction not to silently expand
scope. Four more real, confirmed collisions found — NOT fixed this session, reported for a future
session's review:**

1. **`'spelt'` (`GLYPHOSATE_HEAVY` **reject** + `GLUTEN_GRAINS` caution) inside `"misspelt"`** —
   `analyzeIngredients('misspelt ingredient list, sugar, salt.', [], 2)` produces a reject-severity
   `glyphosate_heavy:spelt` flag. **Verdict-changing** — "misspelt" (British spelling of "misspelled")
   could plausibly appear in label disclaimer/description text.
2. **`'peas'` (`GLYPHOSATE_HEAVY` **reject**) inside `"peasant"`** —
   `analyzeIngredients('peasant bread, sugar, salt.', [], 2)` produces a reject-severity
   `glyphosate_heavy:peas` flag. **Verdict-changing** — "peasant bread" is a real, common bread
   product/style name, arguably at least as likely to appear on a real label as "goat milk" was.
3. **`'olean'` (`SYNTHETIC_ADDITIVES`, always reject) inside `"oleander"`** —
   `analyzeIngredients('oleander extract, salt.', [], 2)` produces an `additives:olean` flag and RED
   verdict. Confirmed mechanically, but oleander (a toxic ornamental plant) has near-zero real-world
   likelihood of appearing in food ingredient text — lowest priority of the four.
4. **`'hing'` (`GLUTEN_GRAINS`, caution-only — does not change verdict) inside `"something"`,
   `"anything"`, `"everything"`, `"nothing"`** — confirmed all four mechanically
   (`analyzeIngredients('everything bagel seasoning, salt.', [], 2)` → `gluten_grains:hing`, etc.).
   Non-urgent (caution-only, gluten_grains is excluded from verdict and stripped from display at both
   levels), but by far the **highest-frequency** collision found across all sessions — these are among
   the most common words in English, versus a specific product name or crop word.

Every other bare 4–6 character trigger across these three lists (`'bulgur'`, `'kamut'`, `'wheat'`,
`'farro'`, `'durum'`, `'emmer'`, `'barley'`, `'beans'`, `'flax'`, `'kasha'`, `'millet'`, `'hominy'`,
`'grits'`, `'maize'`, `'masa'`, `'quinoa'`, `'teff'`, `'graham'`, `'nisin'`, `'datem'`, `'tbhq'`) was
checked against plausible real-word candidates and found to have **no confirmed collision** — kept
as-is, no action needed.

**Tests added (`lib/rulesEngine.test.js`, new "SESSION FIX" describe block):** 11 tests — the three
licorice variants no longer trigger via `'rice'`; real `"rice"`/`"brown rice"` still correctly trigger;
`"unicorn sprinkles"` no longer triggers via `'corn'`; `"coats"` no longer triggers via `'oats'`;
`"popcorn"` (allowlisted) still correctly triggers; `"oat groats"` (allowlisted, the regression found
and fixed this session) still correctly triggers `glyphosate_heavy` and `gluten_grains`; and two
consolidated regression checks confirming every previous session's fix (`"goat milk"`, `"goats' milk
yogurt"`, `"acorn squash"`, `"suggested retail price"`) still holds after the redesign. Full suite:
1306 passing / 1 known pre-existing failure (the cross-list contradiction test, unchanged — still only
the same 8 out-of-scope "dead entry" findings), up from 1295 passing / 1 failing before this session's
fix.

**PROMPT_VERSION bumped 34 → 35.** This changes real `flags`/`verdict` output for a class of
previously-cached products — most directly, any product containing "licorice" (black licorice candy,
licorice root extract in herbal/tea products) previously carried an incorrect `gluten_grains` caution
flag from zero actual rice content. Also closes "unicorn"/corn and "coats"/oats, both caution-only and
lower real-world frequency. Run `DELETE FROM scan_cache WHERE prompt_version < 35` in Supabase
before/after deploying. The `M. PROMPT_VERSION` contract test was updated to assert `35`.

---

### Session — 'spelt'/'peas'/'hing' collision guards: "misspelt"/"peasant bread"/"something" family false-positive fix (July 2026, PROMPT_VERSION 36)

Follow-up to the guard-redesign session above, which left three confirmed collisions from the ongoing
bare-trigger audit unfixed pending review: `'spelt'` inside `"misspelt"`, `'peas'` inside `"peasant"`,
`'hing'` inside the `"-thing"` word family. This session fixes all three.

**Wiring check (per instruction — confirm before assuming).** None of the three triggers had
`isPrecededByLetterUnlessAllowlisted()` (as it was named at the start of this session) wired to their
call sites yet — the guard was only applied to `'oats'`/`'oat milk'`/`'oatmilk'` (`GLYPHOSATE_HEAVY`)
and `'oats'`/`'corn'`/`'rice'` (`GLUTEN_GRAINS`). `'spelt'` needed the guard added in **both** loops
(it's a trigger in both `GLYPHOSATE_HEAVY` and `GLUTEN_GRAINS`); `'peas'` only in `GLYPHOSATE_HEAVY`
(not a `GLUTEN_GRAINS` trigger — peas aren't a gluten grain); `'hing'` only in `GLUTEN_GRAINS`
(asafoetida alternative name, not in `GLYPHOSATE_HEAVY`).

**`'hing'` verified before fixing, per instruction.** Confirmed `'hing'` is the alternative name for
asafoetida (`GLUTEN_GRAINS`'s own inline comment: `// alternative name for asafoetida`). Checked every
plausible real-world `"hing"` label form before applying the guard: bare `"Hing"` as its own ingredient,
`"hing powder"` (space-separated), and parenthetical `"hing (asafoetida)"` — all either stand alone or
are separated by whitespace/punctuation, so none has a letter immediately adjacent to the match. No
legitimate letter-adjacent `"hing"` compound was found, so — unlike `'corn'`/"popcorn" and
`'oats'`/"groats" — no `TRIGGER_ADJACENCY_ALLOWLIST` entry was needed for `'hing'`.

**A new collision shape found while fixing `'peas'`: PREFIX, not SUFFIX.** Every collision fixed so far
(oats/goats, corn/acorn, rice/price, corn/unicorn, rice/licorice, oats/coats, spelt/misspelt) has the
same shape — the collision word *ends with* the trigger, so a letter immediately *precedes* the match.
`'peas'` inside `"peasant"` is the mirror image: `"peasant"` *starts with* `"peas"` — no letter precedes
the match, but letters follow it (`"ant"`). `isPrecededByLetterUnlessAllowlisted()`'s before-only check
could not catch this at all — confirmed directly: applying the existing guard unchanged left
`"peasant bread, sugar, salt."` still producing a false `glyphosate_heavy:peas` reject flag.

**Fix required extending the guard, not just wiring it up.** Renamed
`isPrecededByLetterUnlessAllowlisted()` → `isAdjacentToLetterUnlessAllowlisted(text, index, end,
checkAfter = false)` (`lib/rulesEngine.js`) — `checkAfter` is an opt-in parameter, default `false`,
preserving the existing before-only behavior for every other guarded trigger. Only the `'peas'` call
site passes `checkAfter: true`. This distinction is load-bearing, not cosmetic: extending the check to
the "after" side for `'corn'`/`'rice'` too (rather than opt-in per trigger) was tested directly and
would have broken real no-space label variants — `"cornstarch"` (bare `'corn'` followed by `'s'`) and
`"ricecake"` (bare `'rice'` followed by `'c'`) are both genuine corn/rice ingredients that rely on the
suffix-only match to correctly flag; a blanket "after" check would have silently reintroduced a false
negative on both. Confirmed via direct testing that both continue to flag correctly with the opt-in
design.

**Tests added (`lib/rulesEngine.test.js`, new "SESSION FIX" describe block):** 16 tests — `"misspelt"`
no longer triggers via `'spelt'`; real `"spelt"`/`"spelt flour"` still trigger both categories;
`"peasant bread"` no longer triggers via `'peas'`; real `"peas"`/`"green peas"` still trigger;
`"chickpeas"` (its own distinct, longer trigger) confirmed unaffected; a parameterized check
(`test.each`) confirming `"something"`/`"anything"`/`"everything"`/`"nothing"` no longer trigger via
`'hing'`; real `"hing"`, `"asafoetida"`, and parenthetical `"hing (asafoetida)"` still trigger; and two
regression guards confirming `"cornstarch"`/`"ricecake"` (no-space variants) still correctly flag,
proving `checkAfter` was correctly scoped to `'peas'` only. Full suite: 1322 passing / 1 known
pre-existing failure (the cross-list contradiction test, unchanged — still only the same 8
out-of-scope "dead entry" findings), up from 1306 passing / 1 failing before this session's fix.

**Audit pattern flagged, not silently fixed, per instruction.** This is now the second consecutive
session in which a request to fix a small, specific set of confirmed collisions surfaced yet another
gap in how thoroughly the trigger lists have actually been checked: two sessions ago, `'oats'`/`'corn'`/
`'rice'` were fixed but `'spelt'`/`'peas'`/`'hing'` were found in the *same* audit pass and left for
"a separate session" — this session. The recurring theme across all four sessions in this series is
that each audit has been a **spot-check** (brainstorming plausible collision candidates and testing
them one at a time), not an exhaustive pass over every remaining bare short trigger against a real
word corpus — and every single spot-check so far has found at least one real collision the previous
one missed. One item from two sessions ago remains open and unfixed for the same reason: `'olean'`
(`SYNTHETIC_ADDITIVES`, always reject) inside `"oleander"` — mechanically confirmed, reported, never
wired to the guard (no call site exists for it at all yet). Recommend a fourth session that applies
`isAdjacentToLetterUnlessAllowlisted()` systematically to *every* remaining bare short trigger across
`SYNTHETIC_ADDITIVES`/`GLUTEN_GRAINS`/`GLYPHOSATE_HEAVY` in one pass (checking each against a real
dictionary or word-frequency list rather than hand-picked candidates), instead of continuing to close
one hand-found collision per session.

**PROMPT_VERSION bumped 35 → 36.** This changes real `flags`/`verdict` output for a class of
previously-cached products — most directly, any product whose ingredient text or product name contains
"misspelt" or "peasant" (e.g. "peasant bread," a real bread product/style name) previously carried an
incorrect reject-severity `glyphosate_heavy` flag and, if that was the product's only concern, an
incorrect RED verdict. Also closes the `'hing'`/`"-thing"` family — caution-only, does not change
verdict, but by far the highest-frequency collision found across this entire audit series. Run
`DELETE FROM scan_cache WHERE prompt_version < 36` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `36`.

---

### Session — systematic bare-trigger audit batch: closes out the 4-session collision-word audit series (July 2026, PROMPT_VERSION 37)

Four consecutive sessions had each found "one more" bare-trigger substring collision by hand
(`'ada'`/macadamia+Canada → `'oats'`/`'corn'`/`'rice'` → `'rice'`/licorice + auto-closed unicorn/coats →
`'spelt'`/`'peas'`/`'hing'`), leaving `'olean'`/oleander still open. This session replaced hand-picked
candidate testing with a systematic tool: every bare (single-word) trigger in `SYNTHETIC_ADDITIVES`,
`GLUTEN_GRAINS`, and `GLYPHOSATE_HEAVY` was extracted from source and checked against a 274,137-word
English dictionary (the `word-list` npm package, installed in scratch space only — not a project
dependency) for substring collisions in both directions, then every hit was run through the real
engine to confirm live false positives before anything was reported or fixed.

**Full batch fixed this session:**

| Trigger | List(s) | Collision word(s) | Severity impact |
|---|---|---|---|
| `corn` | `GLUTEN_GRAINS` + `CONVENTIONAL_CROPS`'s `STANDALONE_CORN_RE` regex | `corner`, `cornea`, `cornet`, `cornice`, `cornichon`, `corned` (as in corned beef), `scorn`, `peppercorn`, `cornflower`, `cornrow(s)` | **Verdict-changing** (`conventional_crops` is reject) — "corner" is one of the most common words in English |
| `malt` | `GLYPHOSATE_HEAVY` + `GLUTEN_GRAINS` | `smalt` (a blue pigment/cobalt glass) | Verdict-changing (`glyphosate_heavy` reject) |
| `farro` | `GLYPHOSATE_HEAVY` + `GLUTEN_GRAINS` | `farrow`, `farrowing` (pig-birthing terminology) | Verdict-changing |
| `bha` | `SYNTHETIC_ADDITIVES` | `bhaji`, `bhajia`, `sambhar` (South Asian culinary terms) | Verdict-changing (always reject) |
| `beans` | `GLYPHOSATE_HEAVY` | `jellybeans` | Verdict-changing |
| `olean` | `SYNTHETIC_ADDITIVES` | `oleander` — **carried over from an earlier session, confirmed again** | Verdict-changing (always reject) |
| `rye` | `GLYPHOSATE_HEAVY` + `GLUTEN_GRAINS` | `fryer` (as in "fryer chicken") | Verdict-changing |
| `flax` | `GLYPHOSATE_HEAVY` | `toadflax` | Verdict-changing |
| `miso` | `GLUTEN_GRAINS` + its separate `CONVENTIONAL_CROPS` entry (both fixed) | `semisoft` (a real cheese classification term) | Verdict-changing (`conventional_crops` reject) |
| `hing` | `GLUTEN_GRAINS` | `hinge`, `hinges`, `hinged` | Caution-only, does not change verdict |

**Plus one true-positive regression found during verification, not the audit itself.** The wordlist
audit only searches for false *positives* (words that incorrectly flag) — it cannot surface a
legitimate compound being incorrectly *suppressed*. While re-verifying every fix's true-positive cases
(the same "does this change real output" diligence as `popcorn`/`groats`/`oat groats`), `"sweetcorn"`
was found returning zero flags: `GLUTEN_GRAINS` has no dedicated `'sweetcorn'` trigger of its own, so
it relied entirely on bare `'corn'` — which the SUFFIX-collision guard (added two sessions ago) has
been silently over-blocking ever since, since "sweetcorn" has a letter immediately before ('t') and
was never allowlisted. Added to `TRIGGER_ADJACENCY_ALLOWLIST` alongside `'popcorn'`/`'groats'`.

**`corn` uses a new mechanism: a denylist, not checkAfter+allowlist.** Every other PREFIX-shape
collision this session (`bha`, `olean`, `farro`, `malt`, `hing`) was fixed with
`isAdjacentToLetterUnlessAllowlisted(text, index, end, true)` — block by default, allowlist the rare
legitimate exception. `corn` breaks this pattern: legitimate PREFIX-shape corn compounds (cornbread,
cornmeal, cornstarch, cornflakes, corncob, cornstalk, cornhusk, cornfield, sweetcorn, popcorn...)
vastly outnumber genuine collisions (corner, cornea, cornet, cornice, cornichon, corned, scorn,
peppercorn, cornflower, cornrow), so blocking by default would need dozens of allowlist entries instead
of a dozen denylist ones. Added `CORN_COLLISION_DENYLIST` and `isDenylistedCornCollision()`
(`lib/rulesEngine.js`) — the inverse of `TRIGGER_ADJACENCY_ALLOWLIST` — checked in both `GLUTEN_GRAINS`'s
bare `'corn'` loop and `CONVENTIONAL_CROPS`'s `STANDALONE_CORN_RE` regex handling. Deliberately not
exhaustive — omits extremely obscure heraldry/entomology/geology dictionary entries
(`cornigerous`, `cornuted`, `lamellicorn`, `cornbrash`) vanishingly unlikely to appear in real product
text; extend if a genuine false positive surfaces.

**The `STANDALONE_CORN_RE` regex fix specifically:** its negative lookahead only excluded "corn"
followed by whitespace+letter (`"corn starch"` as two words) — not "corn" followed *directly* by more
letters. Tightening the lookahead itself (rather than denylisting) was considered and rejected: it
would also have broken legitimate no-space compounds this exact regex is relied on to catch (e.g.
`"cornstarch"`, `"cornmeal"` written as one word). The denylist check runs as an additional condition
on the existing match instead.

**Other guard extensions, all verified against real true-positive cases before locking in (same
diligence as `popcorn`/`groats`):**
- `malt`'s existing guard only checked the character *after* the match (protecting `maltodextrin`/
  `maltose`). Extended to `isAdjacentToLetterUnlessAllowlisted(..., true)` — checks both sides at once,
  closing the `smalt` gap while still protecting `maltodextrin`/`maltose` exactly as before. Confirmed:
  `barley malt`, `malted milk` (separate triggers) unaffected.
- `miso` exists as two separate bare entries — one in `GLUTEN_GRAINS`, one in `CONVENTIONAL_CROPS` —
  confirmed both needed the identical fix rather than assuming; `semisoft` was leaking through
  `GLUTEN_GRAINS`'s copy even after `CONVENTIONAL_CROPS`'s was fixed, caught during verification.
- `beans`: confirmed `soybeans` (its own separate `conventional_crops` trigger) and space-separated
  `"broad beans"`/`"horse beans"` are unaffected by the new suffix-collision guard.

**`wheat`/`"wheatless"` intentionally excluded from this batch — deferred to its own session.** Found
during the same audit but a structurally different bug: `"wheatless"` is a semantic-negation false
positive (a product labeled wheat-free would falsely flag as *containing* wheat), not a random-word
substring collision. It needs an extension to the existing `isInFreeOrNonContext()` "-free"/"non-"
guard to also cover "-less", not `isAdjacentToLetterUnlessAllowlisted()`. See "Pending Policy
Decisions" below — this is the next item in the series.

**Tests added (`lib/rulesEngine.test.js`, new "SESSION FIX" describe block with 10 nested
sub-`describe`s, one per trigger): 49 tests** covering every false positive fixed and every
true-positive case re-verified (including the `sweetcorn` false-negative fix, and the `soybeans`/`broad
beans`/`horse beans`/`barley malt`/`maltodextrin`/`maltose`/`olestra`/`flaxseed`/`rye flour`/`asafoetida`
regression guards). Full suite: 1371 passing / 1 known pre-existing failure (the cross-list
contradiction test, unchanged — still only the same 8 out-of-scope "dead entry" findings), up from
1322 passing / 1 failing before this session's fix.

**This closes out the bare-trigger substring-collision audit series.** All confirmed collisions from
the systematic wordlist audit have been fixed or explicitly deferred (`wheat`/`wheatless`, next up).
Any *new* collision discovered later is a fresh, one-off finding — not evidence the audit missed
something, since this pass was exhaustive against every bare trigger in the three lists as they existed
at the time.

**PROMPT_VERSION bumped 36 → 37.** This changes real `flags`/`verdict` output for a large class of
previously-cached products — most severely, any product whose ingredient text or product name contains
any of "corner", "cornea", "cornet", "cornice", "cornichon", "corned" (corned beef), "scorn",
"peppercorn", "cornflower", a cornrow reference, "smalt", "farrow"/"farrowing", "bhaji"/"sambhar",
"jellybeans", "oleander", "fryer" (chicken), "toadflax", or "semisoft" (cheese) previously carried an
incorrect reject-severity flag and, if that was the product's only concern, an incorrect RED verdict.
Also closes the `hing`/hinge family (caution-only) and fixes the `sweetcorn` false negative (a real
corn product that was incorrectly showing zero flags). Run
`DELETE FROM scan_cache WHERE prompt_version < 37` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `37`.

---

### Session — false-negative sweep fix: cowpeas/broadbeans/horsebeans (July 2026, PROMPT_VERSION 38)

Follow-up to a systematic false-negative sweep (the mirror image of the bare-trigger audit — checking
every guarded trigger's dictionary hits for a legitimate compound now silently losing its flag, instead
of an unrelated word gaining one). Found and fixed two confirmed gaps:

- **`'peas'` inside `"cowpeas"`** (black-eyed peas, a common edible legume) — was producing **zero
  flags** (should be a reject-severity `glyphosate_heavy` flag, same as the spaced `"black eyed peas"`
  form, which already correctly flagged).
- **`'beans'` inside `"broadbeans"`/`"horsebeans"`** (fava beans and a horse-feed bean variety) — same
  gap; the spaced two-word forms `"broad beans"`/`"horse beans"` already correctly flagged (confirmed
  in the previous session).

All three are one-word compounds where a letter immediately precedes the trigger ("cow", "broad",
"horse"), silently blocked by the SUFFIX-collision guard ever since it was first added — the same bug
class as `'corn'`/`"sweetcorn"`. Fixed via `TRIGGER_ADJACENCY_ALLOWLIST`, the same mechanism as
`'popcorn'`/`'groats'`/`'sweetcorn'`. Re-ran the full false-negative sweep on `'peas'` and `'beans'`
specifically after the fix (not just the three words) — confirmed no other word in either trigger's
full dictionary hit list changed behavior; everything else remains correctly unflagged (`peasant`,
`chickpeas` via its own separate trigger, `jellybeans`, `soybeans` via its own separate trigger, etc.).

**`'pease'` (archaic/dialectal, e.g. "pease pudding") and `'maltol'` (a synthesized flavor compound,
chemically distinct from actual barley malt — a genuine policy question, not a confirmed bug) were
found by the same sweep but intentionally NOT fixed** — deferred alongside `wheat`/`"wheatless"` for a
future decision, per instruction not to fix them as a side effect of this batch.

**Tests added (`lib/rulesEngine.test.js`, new "SESSION FIX" describe block):** 7 tests — the three
one-word forms now correctly trigger; the three spaced forms confirmed still correctly trigger
(regression guard); and a combined regression guard confirming `"peasant bread"`/`"jellybeans"`
(previous sessions' fixes) and `"chickpeas"`/`"soybeans"` (their own separate, longer triggers) are all
unaffected by the allowlist addition. Full suite: 1378 passing / 1 known pre-existing failure (the
cross-list contradiction test, unchanged — still only the same 8 out-of-scope "dead entry" findings),
up from 1371 passing / 1 failing before this session's fix.

**PROMPT_VERSION bumped 37 → 38.** This changes real `flags`/`verdict` output for a class of
previously-cached products — any product listing `"cowpeas"`, `"broadbeans"`, or `"horsebeans"` as a
one-word ingredient previously showed an incorrect GREEN verdict with zero flags, when it should have
been RED (`glyphosate_heavy` reject, no clearance available). Run
`DELETE FROM scan_cache WHERE prompt_version < 38` in Supabase before/after deploying. The
`M. PROMPT_VERSION` contract test was updated to assert `38`.

---

## Pending Policy Decisions

Items deferred from the June 2026 unverified ingredients audit — pending team review before adding to the engine.

- **autolyzed yeast extract** — possible SYNTHETIC_ADDITIVES addition (hidden glutamate); confirm framing before flagging
- **monocalcium phosphate, phosphoric acid, potassium salts** — pending additive flagging decision; used in many organic products as leavening agents
- **roasted sesame oil** — not in SEED_OILS, pending decision; cold-pressed sesame oil is considered clean by many practitioners
- **powdered cellulose, resistant tapioca starch, inulin, MCT powder, mirin, Mexican vanilla extract** — left in unverified_ingredients pending review
- **Gelatin explanation copy for non-meat products** (marshmallows, gummies) — `conventional_meat` flag + Joel voice may confuse users when no meat is involved; may need a tailored category or copy adjustment
- **Organic seed oils policy** — currently flagged red at L2 regardless of organic status; worth revisiting whether organic high-oleic sunflower or organic canola should be caution rather than reject
- **Vitamin D3 mandatory fortification in organic milk** — FORTIFIED_VITAMINS caution flag fires on organic dairy products that use D3 as required by organic standards; may confuse users who expect a green for organic milk
- **Node 8 vs Node 8b ordering for `en:eggs`** — found during the `is_meat` corroboration design review (July 2026): `'en:eggs'` is in `MEAT_CATEGORIES`, and in the L2 tree Node 8 (conventional meat) is evaluated before Node 8b (conventional eggs). An OFF-tagged egg product may be getting generic conventional-meat messaging instead of the dedicated egg messaging Node 8b was built for. The existing `isMeat is true for en:eggs` test (Suite H) only asserts the `isMeat` boolean, not which node actually fires or what flag/message the user sees, so this wasn't caught. Needs investigation before deciding on a fix.
- **NEXT UP — `wheat`/`"wheatless"` semantic-negation false positive** (found during the July 2026 systematic bare-trigger audit, PROMPT_VERSION 37 session, deliberately excluded from that batch): a product labeled `"wheatless"` currently flags as *containing* wheat — the exact opposite of what the label claims. This is a structurally different bug than every collision fixed in that session (`corn`/`malt`/`farro`/`bha`/`beans`/`olean`/`rye`/`flax`/`miso`/`hing`) — those are all *unrelated-word* substring collisions fixed via `isAdjacentToLetterUnlessAllowlisted()`; `wheatless` is a *semantic negation* suffix, the same class of problem `isInFreeOrNonContext()` already solves for `"-free"`/`"non-"` (e.g. `"egg-free"`, `"canola-free"`). The fix is almost certainly extending that existing guard to also recognize `"-less"`, not adding a new letter-adjacency check. Needs its own session: confirm the fix doesn't accidentally suppress a real "wheat" declaration that happens to end in "less" for an unrelated reason (none currently known, but verify), add regression tests, and bump `PROMPT_VERSION` per the usual pattern since it changes real `flags`/`verdict` output.

---

## PWA / Icons

Basic PWA installability is enabled (`public/manifest.json`, `<link rel="manifest">` in `app/layout.jsx`, `apple-touch-icon`). No service worker — offline support is not implemented.

**Icons are placeholders** — `public/icon-192.png` and `public/icon-512.png` were generated from a Gemini-generated concept image (`Gemini_Generated_Image_a2ibq4a2ibq4a2ib.png`). Replace both files with final brand assets before public launch. The source image is in the Downloads folder of the dev machine; the original path was `/mnt/user-data/uploads/Gemini_Generated_Image_a2ibq4a2ibq4a2ib.png`. When replacing, regenerate both sizes (192×192 and 512×512) and keep `"purpose": "any maskable"` in the manifest.

---

## UI / UX Decisions

### Scanner screen — "Enter Barcode" button
The manual barcode entry button in the ScannerScreen header is labeled **"Enter Barcode"** (not "Manual"). Style: `background: transparent`, `border: 1.5px solid #D4872A`, `color: #D4872A`. This gives it an amber outline appearance rather than a filled button, keeping the header uncluttered.

### Scanner screen — viewfinder tappable
The dark-blue viewfinder card is interactive — tapping it triggers the same scan/stop action as the amber button below it. `onClick={scanning ? stopCamera : startCamera}`, `cursor: pointer`. A CSS `:active` press state (opacity 0.82, 0.1s transition) is appended to the existing `<style dangerouslySetInnerHTML>` string as `.viewfinder:active{opacity:0.82;transition:opacity 0.1s;}`.

### Scanner screen — "Product Not Found" fallback in history
When a history item has no product name (empty string, null, or undefined), the Recently Scanned list displays **"Product Not Found"** in muted italic text (`color: var(--text-light), fontStyle: italic`) instead of the raw barcode number. The `addScanToHistory` call passes `data.productName || ''` — the barcode is never stored as a productName fallback.

### Verdict screen — ConcernCard expand/collapse arrow color
The expand/collapse chevron `›` on each ConcernCard is colored to match the severity dot: amber (`#D4872A`) for yellow/caution, red (`#C0392B`) for red/reject. The color updates based on the open/closed state of the card — `color: severityColors[severity]` — where `severityColors` maps `reject → #C0392B` and `caution → #D4872A`. Previously the arrow was always `var(--text-light)`.

### Verdict screen — AI summary card dynamic left border
The AI summary card on VerdictScreen has a **4px left border** whose color matches the verdict: amber for yellow, red for red, forest green for green. This provides a quick visual anchor tying the summary card to the verdict color. Implemented via `borderLeft: '4px solid ' + verdictColors[verdict]` on all three summary card render paths (normal, loading, unverified).

### ConcernCard — "Beyond Labels methodology" line removed
The non-functional `📚 Beyond Labels methodology` footer that appeared at the bottom of every expanded ConcernCard has been removed. It was a placeholder with no link or action. The expanded card body now ends after the detail text.

### First-launch disclaimer modal
`components/shared/DisclaimerModal.jsx` — a fixed bottom-sheet modal that covers the full screen on first launch. Checks `localStorage.getItem('bl_disclaimer_accepted')` on mount in `app/page.jsx`. If absent, renders the modal over both the onboarding and main-app views. Accepting sets `bl_disclaimer_accepted = '1'` in localStorage and dismisses. The modal is also accessible at any time from Profile → Legal & Privacy → Disclaimer row.

Key design: `position: fixed, inset: 0, zIndex: 1000`, `background: rgba(0,0,0,0.55)` backdrop, cream bottom card, Playfair Display heading "Disclaimer", scrollable body, amber gradient "I Understand" CTA (height 52, borderRadius 12).

### Profile screen — Legal & Privacy section
ProfileScreen has a **"Legal & Privacy"** card section (cream-dark background, borderRadius 14, padding 16) containing four rows:
1. **Disclaimer** — tappable (`›` chevron), opens `DisclaimerModal`
2. **Our Privacy Promise** — tappable (`›` chevron), opens `PrivacyPromiseModal`
3. **Privacy Policy** — muted, badge "Coming Soon", not tappable
4. **Terms of Service** — muted, badge "Coming Soon", not tappable

`PrivacyPromiseModal` (`components/shared/PrivacyPromiseModal.jsx`) follows the same fixed bottom-sheet pattern as `DisclaimerModal`. Content is rendered from a typed array (`{type: 'heading'}`, `{type: 'bullet'}`, `{type: 'paragraph'}`). Button says "Close", calls `onClose` prop.

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
- Do not initialize Supabase clients (or any client relying on `process.env`) at module load time in files under `pages/api/` or `lib/` that are used in serverless functions — e.g. `export const supabaseServer = createClient(...)` at the top level of a file. On Vercel, env vars may not be reliably available at cold-start module evaluation, causing the client to silently resolve to `null` and stay `null` for that function instance's lifetime — with no error thrown. This caused a real incident in June 2026 where `lib/supabaseServer.js` exported a pre-initialized client (`export const supabaseServer = makeServerClient()`), `sb` was `null` during a 100+ scan session, and scan_cache writes silently no-op'd with zero scans persisted. Always export a function (e.g. `getSupabaseServer()`) that constructs the client lazily inside the request handler, called fresh on each invocation.
