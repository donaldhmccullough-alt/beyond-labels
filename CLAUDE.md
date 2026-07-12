# Beyond Labels — Claude Code Project Memory

## What This App Is
Beyond Labels is a mobile-first food ingredient scanner app. Users scan a product barcode, the app fetches ingredients from Open Food Facts, runs them through a deterministic rules engine, and returns a red/yellow/green verdict with AI-generated plain-language explanations in the voice of hosts Sina McCullough (PhD nutritionist) and Joel Salatin (regenerative farmer).

---

## Tech Stack
- **Framework**: Next.js 14 (App Router for UI, Pages Router for API routes)
- **React**: 18.3
- **Database/Auth**: Supabase JS v2 (`@supabase/supabase-js`) — no auth-helpers package
- **Barcode scanning**: `@zxing/library` 0.21.3
- **AI explanations**: `@anthropic-ai/sdk` `0.111.0` — Claude Sonnet, called from `/pages/api/scan.js` (inline) and `/pages/api/explain.js` (standalone endpoint). Model string is centralized in `lib/aiConfig.js` (`ANTHROPIC_MODEL`) — update it there when upgrading models; do not hardcode the string in individual API files. Bumped from `0.80.0` in July 2026 as part of an `npm audit` remediation pass (two moderate CVEs, both in the SDK's local filesystem Memory Tool — a feature this project doesn't use). Verified directly against the installed SDK's type definitions that `Message.content: Array<ContentBlock>` (the `{type: 'text', text: string}` shape both `fetchExplanation()` in `scan.js` and the `explain.js` handler read) and `APIError.status` are unchanged across the bump — no behavior change to `parseExplanationResponse()` or its callers.
- **Node**: 24.x (pinned in `.nvmrc` and `package.json` engines). Upgraded from 20.x in July 2026 — Vercel deprecated Node 20.x for builds, with a hard deadline that deployments created on or after 2026-10-01 fail on 20.x. Pure tooling/infra change: confirmed the full test suite (1378 tests) passes unmodified under Node 24, and no dependency in the tree (direct or transitive) declares an upper-bound Node engines constraint that would exclude 24.x.
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

For `userLevel === 2`, `scan.js` applies a universal 14-node decision tree **after** `analyzeIngredients()` runs. Applies to all 10 product categories. First matching node wins for **verdict/clearedBy purposes**. Does not run for `unverified` or `inconclusive` verdicts.

**⚠️ Architecture note — Phase A (flag injection) vs. Phase B (verdict/clearedBy determination), added PROMPT_VERSION 42.** The tree is now split into two structurally separate passes, run in this order:

1. **Phase A — unconditional corroboration-signal injection.** Before the priority chain below ever runs, `scan.js` evaluates every corroboration signal for `conventional_meat`, `conventional_dairy`, and the three organic sub-tree categories (`fortified_vitamins`, `natural_colorants`, `olive_oil_adulteration`) **exactly once**, unconditionally, and adds whichever apply to `flags`. This mirrors the exact same priority/conditions the tree nodes below always used (e.g. the wild-caught/game-meat exemptions for `conventional_meat` are preserved intact), but decouples *whether a flag gets added* from *which node ends up winning the verdict*.
2. **Phase B — verdict/clearedBy determination.** The 14-node priority chain below is **unchanged in shape and priority order** — it still runs first-match-wins exactly as before. The only difference is it now reads from (and, for the five categories above, no longer re-injects into) an already-complete `flags` array, plus one deliberate `clearedBy` change (see below).

**Why this split exists:** before PROMPT_VERSION 42, `conventional_meat`/`conventional_dairy`/the three organic sub-tree flags were only ever added *by* the node that also decided verdict — meaning if an earlier-firing node (most commonly `hasInstantRedFlag`, but also e.g. Node 7's non-GMO check) resolved the chain first, those categories were never even **evaluated**, not just suppressed. A July 2026 production data audit found this affected the majority of real products in the affected categories: **64.6% of dairy products and 44.2% of meat products with an instant-red flag never got their sourcing flag at all.** Organic products with an instant-red flag never had the organic sub-tree evaluated either, since Node 4 was itself nested inside the same `else` branch. See the "Session — L2 tree flag-injection unification" changelog entry below for the full investigation and both implementation commits.

**The one deliberate verdict-adjacent behavior change (Phase B, part of PROMPT_VERSION 42):** when `hasInstantRedFlag` fires (Nodes 1–3b), `clearedBy` is now `'organic'` instead of being discarded to `null`, **if** the product also carries the `usda-organic` label — verdict still goes red either way (a real synthetic additive/seed oil/trans fat is not excused by organic certification), but the cert context is no longer silently dropped from the response. This holds regardless of whether any of the three organic sub-tree flags actually fired, since `clearedBy` describes certification status, not which concerns were found.

**⚠️ Non-obvious invariant — `conventional_meat`/`conventional_dairy` and `clearedBy: 'organic'` are mutually exclusive by design, and this is intentional, not a gap.** Phase A's meat/dairy injection block is gated on `!hasOrganic` — a genuinely organic-certified product correctly should never get a "conventional [meat/dairy], no cert" flag, since it does have a cert. This means a product can never simultaneously show `conventional_meat` (or `conventional_dairy`) **and** `clearedBy: 'organic'` in the same response. Confirmed directly during implementation (Part 2's own test suite, X4a/X4b): writing a test that expected both together for a real organic-labeled meat product failed outright (Phase A never injected the meat flag at all, since `hasOrganic` was true — verdict came back `green`, not `red`). If a future session is tempted to "fix" this by removing the `!hasOrganic` gate so meat/dairy flags fire regardless of organic status, don't — that would mean a certified-organic product gets flagged for lacking the certification it demonstrably has. The correct read of `clearedBy: 'organic'` alongside a red verdict (from an unrelated instant-red flag) is "this product is organic-certified, but has an unrelated synthetic-additive/seed-oil/trans-fat/natural-flavor concern" — not "this product's meat/dairy sourcing is unconfirmed."

**Decision tree:**
| Node | Condition | Verdict | `clearedBy` |
|------|-----------|---------|-------------|
| 1 | `additives` flag present | RED | `'organic'` if `usda-organic` label present, else `null` (Phase B, PROMPT_VERSION 42 — previously always `null`) |
| 2 | `seed_oils` flag present | RED | same as Node 1 |
| 3 | `trans_fats` flag present | RED | same as Node 1 |
| 3b | `natural_flavors` flag present | RED | same as Node 1 |
| 4 | `usda-organic` label | → organic sub-tree | `'organic'` |
| 5 | `isSeafood` AND no reject-severity flag already present AND `detectWildCaught()` returns true (OFF label OR product name contains wild-caught signal, no farmed exclusions) — **both the `isSeafood` gate and the reject-flag gate were added PROMPT_VERSION 29, see changelog; before that, this node had neither and could silently force GREEN over a real reject flag on any product, seafood or not** | GREEN | `'wild-caught'` |
| 5b | `isSeafood` + no wild-caught signal detected | RED (`conventional_meat` flag present — injected unconditionally by Phase A, not by this node) | null |
| 6 | Game meat category (`en:game-meats`) | GREEN | null |
| 7 | `non-gmo-project-verified` label | YELLOW | `'non-gmo-project-verified'` |
| 8 | `isMeat` (non-seafood, non-game) | RED (`conventional_meat` flag present — injected by Phase A) | null |
| 8b | `conventional_eggs` flag present (from engine) | RED (engine already has the flag with matchedIngredient — never tree-injected, unaffected by Phase A/B) | null |
| 9 | `containsMilkDerived(maskedText)` | RED (`conventional_dairy` flag present — injected by Phase A) | null |
| 10 | `conventional_crops` flag present | RED | null |
| 11 | `bioengineering` flag present | RED | null |
| 11b | `glyphosate_heavy` flag present with `severity: 'reject'` (added PROMPT_VERSION 24 — see changelog; mutually exclusive with node 12 by construction, since the engine already downgrades this flag's own severity to `'caution'` when `glyphosate-free`/`usda-organic` clearance applies) | RED | null |
| 12 | `glyphosate-free` label | YELLOW | `'glyphosate-free'` |
| 13 | `glyphosate-heavy` label | RED | null |
| 14 | Default | YELLOW | null |

**Organic sub-tree (entered at node 4):**
| Check | Verdict |
|-------|---------|
| `containsFortifiedVitamins(maskedText)` | YELLOW (`fortified_vitamins` caution flag present — injected by Phase A) |
| `containsNaturalColorants(maskedText)` | YELLOW (`natural_colorants` caution flag present — injected by Phase A) |
| `maskedText.includes('olive oil')` | YELLOW, `oliveCaveat: true` (`olive_oil_adulteration` flag present — injected by Phase A) |
| None of the above | GREEN |

As of PROMPT_VERSION 42, all three of these checks are evaluated by Phase A **unconditionally whenever `hasOrganic` is true** — including when `hasInstantRedFlag` is also true, a case Node 4 itself never even reaches (it's nested in the `else` branch after the instant-red check). This sub-tree's own verdict logic (still if-elseif, first-match-wins for the purpose of deciding YELLOW vs GREEN) is otherwise unchanged from before — the only difference is that Phase A may have already injected more than one of these three flags into `flags` simultaneously (a product can have both fortified vitamins and olive oil, for instance), even though this sub-tree's verdict computation still only looks for the first one that applies.

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
- As of PROMPT_VERSION 42: `conventional_meat`, `conventional_dairy`, and the three organic sub-tree flags are injected by a separate unconditional "Phase A" pass, not by whichever tree node happens to fire — see the "Architecture note" above for the full shape and the reasoning.

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
When a user taps "See Cleaner Swaps" on the VerdictScreen, the app surfaces curated store-bought alternatives from the `swap_products` Supabase table. Swaps are level-aware and category-matched to the scanned product.

### swap_products table (source of truth as of Phase 0, July 2026)
Swap data lives in the `swap_products` Supabase table — see the `swap_products` entry under "Supabase → Tables" below for the full column list. Previously sourced from a public Google Sheet (`SWAP_SHEET_ID`, CSV export); migrated in Phase 0 of the swaps system overhaul so a later admin approval workflow (`source = 'scan_approved'`) has a real table to write to instead of a spreadsheet. `SWAP_SHEET_ID` is no longer read by `pages/api/swaps.js` — see "Env vars needed" below.
- `pages/api/swaps.js` queries the full table via `getSupabaseServer()` (service role key, lazy-initialized inside the request handler — never a module-level client) and caches the result in-memory for 1 hour, same TTL and cache-invalidation-on-restart behavior as the old CSV pipeline.
- `certifications`, `why_it_passes`, and `where_to_buy` are real Postgres `text[]` columns in the table. `pages/api/swaps.js` re-joins them into the same semicolon/comma-delimited strings the old CSV pipeline produced (`certifications`/`why_it_passes` → `;`-joined, `where_to_buy` → `,`-joined) before returning them, so the response shape is unchanged and `SwapCard.jsx`'s existing client-side `.split(';')`/`.split(',')` calls needed no changes.
- `certifications` values: exact strings `usda-organic` and/or `non-gmo-project-verified` (unchanged convention from the Sheet era).
- `swap_level`: `1` (passes Level 1 criteria) or `2` (passes Level 2 strict criteria) — stored as an `integer` in the table; `pages/api/swaps.js` normalizes it back to a string (`'1'`/`'2'`) on read so the existing tier-filtering logic (`r.swap_level === '2'`) needed zero changes.
- One-time backfill from the Sheet: `scripts/migrateSwapsFromSheet.js` (`node scripts/migrateSwapsFromSheet.js [--force]`) — reuses the Sheet CSV fetch/parse logic as it existed in `pages/api/swaps.js` at migration time (duplicated into the script itself, since it's a plain `node` script and `pages/api/swaps.js` uses ES module syntax a bare `node` process can't parse — same limitation documented for `pages/api/scan.js` under "Golden Master Snapshot"). Refuses to insert if `swap_products` already has rows, unless `--force` is passed. Sets `source = 'curated'` on every migrated row.

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

If no OFF tag matches, `productCategory` returns `null`. `SwapsScreen` falls back to a `FLAG_CATEGORY_MAP` derived from the top scan flag — exported as a named export from `SwapsScreen.jsx` (module scope, not inside the component) specifically so it's a plain, testable data structure; see `__tests__/components/SwapsScreen.test.js`:
```js
export const FLAG_CATEGORY_MAP = {
  trans_fats:          'condiments',
  seed_oils:           'snacks',
  conventional_crops:  'snacks',
  bioengineering:      'snacks',
  natural_flavors:     'snacks',
  synthetic_additives: 'snacks',
  gluten_grains:       'cereal',
  conventional_meat:   'meat',   // fixed July 2026 (Phase 1) — was null; see changelog
};
```
If both are null, the API returns all rows unfiltered.

### Product subcategory mapping (Phase 1, July 2026 — bread scheme + `plant_milk` revised in a same-month follow-up session)
5 of the 10 top-level categories have subcategory support — enough real subcategory variety within each to be worth splitting further for swap matching. The other 5 (`snacks`, `cereal`, `condiments`, `frozen`, `cooking_oils`) do not, and `productSubcategory` is always `null` for them.

| Category | Subcategories |
|---|---|
| `chips` | `tortilla`, `potato`, `veggie`, `other` |
| `dairy` | `milk`, `cheese`, `yogurt`, `butter` |
| `meat` | `beef`, `poultry`, `pork`, `seafood`, `deli` |
| `beverages` | `soda`, `juice`, `sparkling_water`, `coffee_tea`, `plant_milk` |
| `bread` | `sprouted_grain`, `gluten_free`, `keto_low_carb`, `sandwich`, `bagels_muffins`, `tortillas_wraps` |

`bread`'s subcategory scheme was redesigned in the follow-up session — the original `sliced`/`tortillas_wraps`/`bagels_buns` split didn't hold up against the real backfill results (most real bread products are diet/format-driven — sprouted, gluten-free, keto — not "sliced vs. not," and the original scheme had no bucket for any of that). `plant_milk` was added to `beverages` for the same reason: real oat/almond/soy/coconut milk products kept showing up unclassified since "milk" was only ever a `dairy` subcategory keyword, even though these products are filed under the `beverages` top-level category in `swap_products`.

`SUBCATEGORY_TAG_MAP` (`lib/scanHelpers.js`, alongside `CATEGORY_TAG_MAP`) maps real, verified OFF `categories_tags` values to these subcategories — same exact-match discipline as `CATEGORY_TAG_MAP` (no substring matching). Every tag was confirmed against real OFF product data via direct barcode lookups (`GET /api/v0/product/{barcode}.json`, which stayed up both sessions) rather than the OFF search/facet API (down for bulk category queries at research time, both sessions) or guessed — see the git history of this file for the specific real barcodes checked per subcategory if that research needs to be redone later.

**`beverages:plant_milk`** — confirmed across 8 real products spanning oat/almond/soy milk (3 independent brands each): every one carries both `en:plant-based-milk-alternatives` and `en:milk-substitutes` regardless of base ingredient. Notably, none carried `en:oat-milks`/`en:almond-milks` — the two tags already sitting in `CATEGORY_TAG_MAP`'s `dairy` list (untouched by this session; a real oat milk product actually routes to top-level `beverages` via `en:beverages`/`en:plant-based-beverages`, not to `dairy`, since those `dairy`-list tags don't match real product data either).

**Four subcategories are intentionally left unmapped in `SUBCATEGORY_TAG_MAP`** — no confident, distinct real-tag evidence was found for any of them:
- `chips:veggie` — real veggie-chip products (Sensible Portions, Terra, generic store brands) consistently carried the *same* tag potato chips do (`en:salty-snacks-made-from-potato`) or no useful tag at all — no distinct "veggie chips" tag family exists in OFF's real data, likely because most veggie chips are potato-starch-based and OFF categorizes by composition, not marketing name.
- `meat:deli` — real deli-meat products (Oscar Mayer, Boar's Head, Aldi deli slices) were either sparsely tagged (empty `categories_tags`) or filed under their base protein (e.g. Oscar Mayer's own "Deli Fresh Oven Roasted Turkey Breast" carries `en:poultries`/`en:turkeys`, not a deli-specific tag) — no distinct "deli" tag family found.
- `bread:keto_low_carb` and `bread:sandwich` — checked across 6 and 5 real products respectively (multiple brands each, including products literally named "Keto Bread" and "Sandwich Bread"): every one carries only the same generic `en:breads`/`en:sliced-breads`/`en:white-breads`/`en:wheat-breads` tags every other bread type already uses. No distinct tag family for either concept exists in OFF's real data — a "Keto Bread" and an ordinary sliced white loaf are tagged identically.

A product in any of these four buckets simply falls back to category-level matching (`productSubcategory` stays `null`) — the same safe default any unmatched tag already produces. `chips:other` has no tag mapping either, by design — it's a leftover/manual-classification bucket, not something a live OFF tag should ever assert. The backfill script (below) *can* still classify all four of these — `chips:veggie`, `meat:deli`, `bread:keto_low_carb`, `bread:sandwich` — via keyword matching on curated product names, since that gap is specifically about live OFF *tag* evidence, not product-name text (a human reviewing a real, specific product name by hand doesn't have the same ambiguity a missing/incomplete OFF tag does).

`mapProductSubcategory(category, categoriesTags)` (`lib/scanHelpers.js`) — takes the already-resolved top-level `productCategory` plus the raw `categoriesTags`, and returns the first matching subcategory or `null`. Called from `pages/api/scan.js` right after `mapProductCategory()`; the result is `productSubcategory`, included in the scan response and persisted to `scan_cache.product_subcategory`.

`GET /api/swaps` accepts an optional `?subcategory=` param (free text, no server-side enum validation — matches the DB column's own lack of a `CHECK` constraint). When provided alongside `?category=`, the (category, subcategory) pool is used for the existing shuffle/tier/slice-to-20 logic *only if that narrower pool is non-empty* — zero subcategory matches silently falls back to the category-wide pool, so a swap row the backfill script couldn't confidently classify (subcategory `null`) never dead-ends to no swaps shown. This fallback is not treated as the "zero curated results" case — the AI fallback still only triggers when the category-wide pool itself is empty, unchanged from before subcategory support. `SwapsScreen.jsx` passes `productSubcategory` from the scan result alongside `category` — but only when a real `productCategory` was resolved (the flag-derived `fallbackCategory` path has no corresponding subcategory signal to pass).

### Randomization
The API shuffles matching rows before slicing to `RESULTS_PER_TIER` (20, raised from 3 in Phase 2, July 2026 — see "'Show More' expansion" below), so users see different products across sessions. The `swap_products` table query is cached in-memory for 1 hour; the shuffle is fresh per request.

### "Show More" expansion (Phase 2, July 2026)
`GET /api/swaps` returns up to `RESULTS_PER_TIER` (20) rows per tier instead of 3 — every category/subcategory/level filter, the shuffle, and the AI-fallback trigger condition are all otherwise byte-for-byte unchanged; only the slice count moved. `SwapsScreen.jsx` still renders only the first `INITIAL_VISIBLE_SWAPS` (3) items per tier initially, matching the pre-Phase-2 look exactly. Below a tier's cards, if that tier has more than 3 items **and** the tier came from `source: 'curated'` (never for AI-generated results), a "Show More" text link appears; tapping it reveals the rest of that tier's already-fetched items with **no second network request** — the full (up to 20) pool was already sitting in component state from the one fetch. It's a one-way expand — no collapse-back control. Good and Better tiers track independent `goodExpanded`/`betterExpanded` state, so expanding one never affects the other; both reset to collapsed whenever a new fetch starts (category/subcategory/userLevel change).

The "how many to show" and "should the button appear" logic is intentionally two small pure functions — `getVisibleSwaps(items, expanded)` and `shouldShowExpandButton(items, expanded, source)` — exported at module scope from `SwapsScreen.jsx` alongside `INITIAL_VISIBLE_SWAPS`, same reasoning as the `FLAG_CATEGORY_MAP` extraction: this project has no React rendering test infrastructure (`jest.config.js` sets `testEnvironment: 'node'`, no `@testing-library/react`), so pulling the actual decision logic out into plain functions is what makes it unit-testable at all. See `__tests__/components/SwapsScreen.test.js`. The "Show More" button itself reuses the app's existing tappable-text-link style (amber, 600 weight, transparent background/border — the same pattern as the header's "← Verdict" button) rather than introducing a new visual treatment.

### AI fallback
If 0 curated swaps exist for a category, Claude Sonnet is called to suggest 2-3 real products. The prompt is level-aware — Level 2 requires certification + no seed oils; Level 1 requires no synthetic additives or trans fats only.

### Adding new swap products
Insert rows directly into the `swap_products` table (service role key, e.g. via the Supabase SQL editor or table editor — no admin UI exists yet, that's a planned later phase). The app picks up new rows within 1 hour (cache TTL). Always verify:
- No synthetic additives or trans fats (required for any level)
- No seed oils, conventional crops, or natural flavors (required for `swap_level=2`)
- `certifications` array uses exact strings only (`usda-organic`, `non-gmo-project-verified`)
- `category` column uses one of the 9 exact values (see "Swap categories" above)
- `source` defaults to `'curated'` — leave it unless the row came from the (not-yet-built) scan-approval workflow, which will use `'scan_approved'`

### Admin swap-candidate review (Phase 3 complete, July 2026 — 3a: schema/auth/discovery; 3b: the review screen + approve/reject actions)
Automatically surfaces real scanned products that are good swap candidates, instead of relying entirely on hand-curated rows. Direct-URL-only — `pages/admin/swap-candidates.jsx` has no nav link anywhere in the regular app UI, by design.

**`lib/requireAdmin.js`** — the reusable admin-auth check every admin-only API route uses. The client sends its own Supabase session access token (`session.access_token` from `lib/auth.js`'s `getSession()`) as `Authorization: Bearer <token>`; `requireAdmin(req)` verifies it server-side via `supabase.auth.getUser(token)` — a real round-trip to Supabase Auth, not a local JWT decode, so an expired/revoked/forged token is rejected — then checks the resulting email against `ADMIN_EMAILS` (comma-separated, case-insensitive, whitespace trimmed). Returns the Supabase user object on success or `null` on any failure (missing/malformed header, invalid token, non-admin email, Supabase unavailable); callers respond `401` when it returns `null`. Reuses `getSupabaseServer()` (lazy, service-role) rather than constructing a second client.

**`GET /api/admin/swap-candidates`** — `401` if `requireAdmin()` rejects the request. Otherwise:
1. Query `scans` (not `scan_cache` — `scan_cache` only ever holds the *current* state per `(barcode, user_level)`, not historical scan events) for `verdict = 'green'` rows, group by barcode in JS, keep only barcodes with `>= 3` distinct `user_id` values. Rows with a null `barcode` or `user_id` (anonymous, not-signed-in scans) are skipped — they can't contribute to a "distinct users" count. Repeated scans by the same user count once, not per-scan.
2. Exclude barcodes already present in `swap_products` — already a real swap, nothing to review.
3. Exclude barcodes already present in `swap_candidate_reviews`, **regardless of decision** — a rejected barcode must never resurface, and an approved one is already reflected in `swap_products` via step 2 anyway.
4. For every remaining candidate, join `scan_cache` rows for both `user_level` 1 and 2 (whichever exist — `scan_cache`'s own unique constraint on `(barcode, user_level)` already guarantees at most one current row per level, so no extra "most recent" ordering is needed) to attach `product_name`/`product_category`/`product_subcategory` and each level's current `verdict`, `explanation`, and `promptVersion` (the last one added in Phase 3b — see "Verification status" below). **Deliberately not filtered to `verdict = 'green'`** — a candidate may have gone green for enough distinct users historically (step 1) while its current `scan_cache` state at one level has since drifted (a rules-engine change, cache invalidation, etc.); reporting the real current per-level verdict lets an admin see that instead of a stale assumption baked into the response.
5. Returns `{ candidates: [{ barcode, distinctScanCount, productName, productCategory, productSubcategory, levels: { [1]?: {verdict, explanation, promptVersion}, [2]?: {verdict, explanation, promptVersion} } }] }`. Early-returns `{ candidates: [] }` (skipping later queries entirely) as soon as no barcodes remain at any filtering stage — confirmed via test assertions on which tables actually got queried, not just the response shape.

The `scans`-table aggregation is done in JS (fetch all `verdict='green'` rows, group/count in memory), not a SQL `GROUP BY ... HAVING`, following this codebase's existing convention of "simple queries to Supabase, business logic in JS" (e.g. `pages/api/swaps.js` fetches the entire `swap_products` table and filters/shuffles/tiers in JS) rather than introducing the project's first stored procedure / RPC function.

**`pages/admin/swap-candidates.jsx`** (Phase 3b) — the actual review screen. On mount, fetches its own Supabase session token and calls `GET /api/admin/swap-candidates` with it; a `401` (or no session at all) hard-redirects to `/` via `window.location.href` (not `next/router`'s `router.replace()` — this page is Pages Router, the redirect target `/` is rendered by App Router, and crossing that boundary with a soft client-side navigation was observed to stall rather than complete in manual testing; a full-page redirect sidesteps that path entirely and is a reasonable cost for a rare, security-relevant redirect on an admin-only page). The session check itself is wrapped in an 8-second timeout (`getSessionWithTimeout()`) as a general defensive measure — an auth check must never be allowed to hang the page forever if the underlying SDK call stalls for any reason.

Renders one card per candidate: product name/brand/barcode/distinct scan count, badges for whichever level(s) are present with their current verdict, a verification-status banner (see below), and an editable form — category/subcategory (pre-filled from the API response), a "why it passes" textarea (pre-filled from the higher-available level's cached `explanation.summary`, one reason per line), two certification checkboxes (`usda-organic`/`non-gmo-project-verified` — modeled as checkboxes rather than free text specifically so an invalid certification string is unrepresentable), a swap-level selector, and a dynamic purchase-links editor (add/remove retailer + affiliate URL pairs). Approve/Reject POST to `POST /api/admin/swap-candidates/review`.

**Verification status** — `getVerificationStatus(candidate, currentPromptVersion)`, checked in priority order against whatever `GET /api/admin/swap-candidates` already returned (no extra network call):
| State | Meaning | Banner tone |
|---|---|---|
| `no_cache` | Zero `scan_cache` levels present for this barcode at all | warn |
| `stale_prompt_version` | At least one present level's `promptVersion` is behind the live `PROMPT_VERSION` constant (`lib/cacheVersion.js`) — checked *before* the green check, since a stale row's own verdict predates the current rules and can't be trusted regardless of what it says | warn |
| `not_green` | Every present level is at the current `PROMPT_VERSION`, but at least one isn't `verdict === 'green'` | warn |
| `confirmed` | At least one level present, all present levels are current *and* green | good |

Only `confirmed` enables Approve outright. Any other state requires the admin to explicitly check "I'm approving without current verification" (`isApproveEnabled()`) — checked *in addition to* the form itself passing `validateApprovalForm()`, never in place of it.

**`POST /api/admin/swap-candidates/review`** — single endpoint keyed by a `decision` field (`'approved' | 'rejected'`) rather than two separate routes, since both share almost all their validation and both ultimately insert into `swap_candidate_reviews`; only `'approved'` additionally inserts into `swap_products` first. `401` via `requireAdmin()` same as the list endpoint.
- **`rejected`**: inserts one `swap_candidate_reviews` row (`decision: 'rejected'`, `note` = the optional reason, trimmed, or `null`). Never touches `swap_products`.
- **`approved`**: inserts one `swap_products` row (`source: 'scan_approved'`, all the submitted fields), then one `swap_candidate_reviews` row (`decision: 'approved'`, `swap_product_id` set to the new row's id; `note` set to `"approved without current scan_cache verification"` when the client's `confirmedCurrent` field is `false`, else `null`). The client sends `confirmedCurrent` computed from the verification status at submit time (`buildApprovePayload()`), not re-derived server-side — the server trusts the client's own status snapshot rather than re-running `getVerificationStatus()` itself.
- **Partial-failure handling**: no real multi-table transaction (same "no stored procedures/RPC in this codebase" reasoning as the list endpoint's JS-side aggregation) — if the `swap_candidate_reviews` insert fails *after* the `swap_products` insert already succeeded, the `swap_products` row is deleted as a compensating action so it's never left orphaned (a swap that looks approved with no review record explaining why). This is "handle partial failure sensibly," not a true transaction — a hard crash between the two writes (as opposed to the second write returning an error) could still leave an orphaned row; that residual risk is accepted, consistent with every other multi-step Supabase write in this codebase.

**⚠️ Never exercised by a real human click-through.** This write path (both `approved` and `rejected`) has automated test coverage only (`__tests__/api/admin/swap-candidates/review.test.js`) — no one has actually clicked Approve or Reject on a real candidate card in a running app and confirmed the resulting `swap_products`/`swap_candidate_reviews` rows look right end-to-end. It is live in production as of the July 12, 2026 deploy (see "Deploy status" below), so it *can* be triggered by a real admin right now — worth a real click-through on a real (or synthetic) candidate before trusting it for a real approval.

**⚠️ Browser UI verification limitation, noted explicitly rather than claimed as done**: the pure logic (`getVerificationStatus`, form validation, payload shaping) and both API routes are thoroughly unit-tested and were exercised directly. The actual rendered page, however, could not be interactively verified end-to-end in this session's browser preview — a **freshly created, completely trivial Pages Router test page** (bare `useState` + `useEffect`, no imports from this project at all) exhibited the identical symptom (`useEffect` never firing) in the same preview environment, which points at a Pages-Router-specific limitation in that preview tooling rather than a defect in this page's code — but that inference wasn't fully proven, either. If this page doesn't render/redirect correctly in a real browser, start there.

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
  - `product_name`, `product_category` (text|null), `product_subcategory` (text|null — Phase 1 swaps overhaul, July 2026, migration SQL in [supabase/migrations/20260712030000_add_product_subcategory_to_scan_cache.sql](supabase/migrations/20260712030000_add_product_subcategory_to_scan_cache.sql); null for any category without subcategory support, or when no subcategory tag matched within a covered category), `is_meat` (boolean, default false), `last_accessed_at`
  - Unique constraint on `(barcode, user_level)` — upserted on every fresh scan
  - Cache hit returns `source: 'cache'`; miss falls through to Open Food Facts
  - Invalidated by bumping `PROMPT_VERSION` in `lib/cacheVersion.js`
  - **RLS requirements**: service role key for writes (server-side, `scan.js`); anon SELECT policy required for client-side tap-to-verdict reads (`scanHistory.js`); no anon INSERT/UPDATE policies needed
- `unverified_ingredients` — team review queue for tokens not matched by any trigger:
  - `id`, `ingredient` (text, lowercase), `product_name`, `barcode`
  - `first_seen` (timestamptz), `occurrence_count` (integer)
  - Populated by `pages/api/scan.js` after each fresh scan (awaited, not fire-and-forget)
- `swap_products` — source of truth for the Swaps System (Phase 0 migration, July 2026 — see "Swaps System" section above; migration SQL in [supabase/migrations/20260712010000_create_swap_products.sql](supabase/migrations/20260712010000_create_swap_products.sql)):
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `product_name` (text, not null), `brand` (text), `category` (text, not null), `subcategory` (text, nullable, no `CHECK`/enum constraint by design — Phase 1 swaps overhaul, July 2026; migration SQL in [supabase/migrations/20260712020000_add_subcategory_to_swap_products.sql](supabase/migrations/20260712020000_add_subcategory_to_swap_products.sql)), `barcode` (text, nullable)
  - `certifications` (text[]), `why_it_passes` (text[]), `where_to_buy` (text[]), `image_url` (text)
  - `purchase_links` (jsonb, not null, default `'[]'::jsonb` — Phase 3a swaps overhaul, July 2026; migration SQL in [supabase/migrations/20260712050000_add_purchase_links_to_swap_products.sql](supabase/migrations/20260712050000_add_purchase_links_to_swap_products.sql)). Each element will be shaped `{ retailer: string, affiliate_url: string }` once something populates it — added as a schema foundation only, not yet wired into any code path. `where_to_buy` (text[]) is unrelated and untouched — `pages/api/swaps.js` keeps reading/returning it exactly as before; the two columns are not migrated into each other.
  - `swap_level` (integer, not null, check in `(1,2)`)
  - `source` (text, not null, default `'curated'`, check in `('curated','scan_approved')`) — `'curated'` for hand-reviewed rows (including everything backfilled from the old Sheet); `'scan_approved'` reserved for the admin approval workflow (Phase 3a, July 2026, added the read-only candidate-discovery foundation for this — see "Admin swap-candidate review" below; the actual approve action that writes `source: 'scan_approved'` rows is Phase 3b, not yet built)
  - `created_at`, `updated_at` (timestamptz, default `now()`)
  - **RLS**: enabled, zero policies — same pattern as `verdict_shadow_diffs`. Read/written exclusively server-side via `getSupabaseServer()` (service role key, bypasses RLS); no anon SELECT/INSERT/UPDATE policy exists or is needed, since `pages/api/swaps.js`'s in-memory 1hr cache means the table itself is only hit once per hour per server instance, not per request
- `swap_candidate_reviews` — records an admin's approve/reject decision on a swap candidate barcode (Phase 3a, July 2026; migration SQL in [supabase/migrations/20260712040000_create_swap_candidate_reviews.sql](supabase/migrations/20260712040000_create_swap_candidate_reviews.sql)), so a decided barcode never resurfaces in `GET /api/admin/swap-candidates` again:
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `barcode` (text, not null), `decision` (text, not null, check in `('approved','rejected')`)
  - `reviewed_at` (timestamptz, not null, default `now()`), `note` (text, nullable)
  - `swap_product_id` (uuid, nullable, references `swap_products(id)`) — populated by Phase 3b's (not yet built) approve action once it creates the corresponding `swap_products` row; always `null` for a `'rejected'` decision
  - **RLS**: enabled, zero policies — same pattern as `swap_products`. Read/written exclusively via `getSupabaseServer()` from admin-only routes (see `lib/requireAdmin.js` below)

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
SWAP_SHEET_ID=                     # Google Sheet ID — NO LONGER READ by pages/api/swaps.js as of the
                                    # Phase 0 swap_products migration (July 2026); still listed here in
                                    # case of rollback, and scripts/migrateSwapsFromSheet.js still uses
                                    # it for a one-time backfill re-run. Do not remove yet.
ADMIN_EMAILS=                      # server-side only — comma-separated allowlist of admin email
                                    # addresses (case-insensitive, whitespace around entries is
                                    # trimmed), e.g. "alice@example.com,bob@example.com". Checked by
                                    # lib/requireAdmin.js (Phase 3a, July 2026) against the email on a
                                    # verified Supabase session token — see "Admin swap-candidate
                                    # review" below. Unset means every request is rejected (no admins),
                                    # not "admin check disabled" — there is no bypass.
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
- Returns: `{ verdict, flags, clearedBy, productName, ingredients, barcode, source, found, labelsDetected, unverifiedIngredients, explanation, productCategory, productSubcategory, unverifiedReason, isMeat, oliveCaveat }`
- `oliveCaveat`: boolean, `true` when the L2 organic path hits the olive oil adulteration branch. Not yet persisted to `scan_cache` (no column); cache hits always return `false` until the column is added.
- `productCategory`: one of the 9 swap categories or `null` if no OFF tag matched
- `productSubcategory` (Phase 1 swaps overhaul, July 2026): a subcategory value for the 5 categories with subcategory support (`chips`, `dairy`, `meat`, `beverages`, `bread` — see "Swaps System" → "Product subcategory mapping"), or `null` for any other category or when no subcategory tag matched. Detected via `mapProductSubcategory()` in `lib/scanHelpers.js`, persisted to `scan_cache.product_subcategory`.
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
- Query params: `category` (one of 10 valid values, optional), `subcategory` (free text, optional, Phase 1 — see "Swaps System" above), `userLevel` (1 or 2, defaults to 2)
- Flow: check in-memory cache (1hr TTL) → query `swap_products` Supabase table if stale (Phase 0 — no longer a Google Sheet CSV; this bullet was stale until corrected in the Phase 2 session) → filter by category → narrow by subcategory if provided and non-empty → filter/tag by swap_level → shuffle → slice to `RESULTS_PER_TIER` (20, raised from 3 in Phase 2, July 2026 — see "Swaps System" → "'Show More' expansion") per tier → AI fallback if 0 results
- Returns: `{ swaps: SwapRow[], source: 'curated' | 'ai' }`
- Each swap row includes `tier: 'good' | 'better'` — used by SwapsScreen to render sections, and `subcategory` (Phase 1)
- AI fallback prompt is level-aware — Level 2 requires certification + no seed oils; Level 1 requires no synthetic additives only

---

## Scan Cache Pattern

Cache is keyed on `(barcode, user_level, prompt_version)` — see the `scan_cache` table in the Supabase section for the full schema, and `POST /api/scan` for the hit/miss flow. `PROMPT_VERSION` is the single source of truth in `lib/cacheVersion.js` — import it from there, never from an API route file.

To invalidate the cache after a prompt change:
1. Bump `PROMPT_VERSION` in `lib/cacheVersion.js`
2. Run the SQL from `getCacheInvalidationSQL(newVersion)` in `lib/cacheUtils.js` against the Supabase DB
3. Deploy — new scans rebuild the cache at the new version

**Current PROMPT_VERSION is 42** (L2 tree flag-injection unification — `conventional_meat`/`conventional_dairy`/organic sub-tree flags are now injected unconditionally instead of only when the tree happens to reach their node, plus `clearedBy: 'organic'` now persists alongside a red verdict from an unrelated instant-red flag — see the "Session — L2 tree flag-injection unification" changelog entry below). `scan_cache` has **not yet been invalidated** for this bump — run `DELETE FROM scan_cache WHERE prompt_version < 42` in Supabase before/after deploying. Per the deploy-gap incident documented below, treat "committed" and "confirmed deployed" as separate claims until verified live. As of a follow-up session, `PROMPT_VERSION 42` also includes the `maskIgnoredIngredients()` word-boundary fix (see "Session — maskIgnoredIngredients() word-boundary fix" below) — folded in without a bump since zero `scan_cache` rows existed at `prompt_version = 42` at the time it shipped, confirmed by direct query before the fix was written.

**⚠️ Deploy-without-purge in progress (July 2026) — deliberate, temporary, not an oversight.** The commits carrying the PROMPT_VERSION 40→41 and 41→42 bumps (`61d258e` through `a5998a2`) had themselves been sitting local-only for an unknown stretch — `origin/mvp-beta` was still on the PROMPT_VERSION **40** code the entire time, meaning the actually-deployed app has been stamping every fresh scan with `prompt_version: 40`, not 41 or 42, until this push. Those 9 commits were pushed to `origin/mvp-beta` via a fast-forward (`git push origin a5998a2:mvp-beta`) specifically **without** running either purge — no `DELETE FROM scan_cache WHERE prompt_version < 41` and no `< 42`. This was an explicit choice, not a skipped step: the purge is being **intentionally deferred** so that today's `scan_cache` rows (all currently at `prompt_version: 40`, since that's what the live app had been running) can be reviewed first, before they're irreversibly deleted.

**What this means concretely, until the purge is run**: every `(barcode, user_level)` pair already in `scan_cache` — including every row written today — keeps serving its existing stored `verdict`/`flags`/`clearedBy` exactly as before, regardless of the fact that the corrected v41/v42 code is now live. Deploying the code does nothing retroactive to rows already sitting in the table; a cache **hit** just returns what's already there. The v41/v42 fixes only actually take effect for a given barcode once that specific `(barcode, user_level)` pair is rescanned fresh (a cache **miss**), at which point the new scan is computed with the corrected code and written back at `prompt_version: 42`. Also note this means `getVerificationStatus()`'s `stale_prompt_version` state (see "Admin swap-candidate review" above) will currently flag *every* existing `scan_cache` row as stale — expected and correct, not a bug, since every row genuinely does predate the live `PROMPT_VERSION` constant right now. Do not assume a `scan_cache` row's `verdict`/`flags` reflect the v41/v42 logic just because the code has been deployed — check `prompt_version` on the row itself.

Separately, PROMPT_VERSION 40 (L1/L2 unification Stage 5c — `VERDICT_ENGINE_MODE=live` wired to `lib/verdictEngine.js`'s `computeCorrectedVerdict()`) remains **not yet activated** — see the "Session — L1/L2 unification Stage 5c" changelog entry and its "Stage 5c — pending activation steps" for the exact remaining manual sequence (deploy confirmation, then `VERDICT_ENGINE_MODE=live` in Vercel, then cache invalidation). That activation is independent of and unaffected by this session's v41 bump.

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

## Test Data Tracking — off-test-results-cumulative.csv

`scripts/off-test-results-cumulative.csv` (tracked in Git as of July 2026) is a cumulative,
append-only log of rules-engine test results — L1/L2 verdicts, decisive/optional flags, and
ingredient text — across real products. It's used to spot-check the rules engine's behavior
against a growing corpus of real-world ingredient lists over time, independent of the Jest test
suite (which uses hand-picked fixtures). **2248 rows as of July 2026.**

Two separate tools write to this file — do not confuse them:

- **`scripts/off-rules-tester.js`** — fetches products directly from Open Food Facts (by category
  and brand search) and re-derives both L1 and L2 verdicts from whatever rules engine code is
  currently on disk. Its own internal `CSV_COLUMNS` constant and verdict-label mapping do **not**
  match this file's real header (a historical mismatch — this script was never actually the tool
  that produced the file's current column conventions). Treat its scan_cache-sourcing code path
  as unused/superseded by the tool below; its OFF category/brand-search phase is still the way to
  add fresh non-scan_cache products.
- **`scripts/appendScanCacheToOffResults.js`** — the tool to use for appending **new scan_cache
  products** to this CSV going forward. Appends only barcodes not already present anywhere in the
  file's `barcode` column; never modifies existing rows. Critically, it logs L2 verdicts/flags
  **exactly as scan_cache recorded them** (historical, never re-derived against current code) —
  L1 is populated from a real cached `user_level=1` scan_cache row when one exists for that
  barcode, falling back to running the current rules engine (`analyzeIngredients(text, [], 1)`)
  otherwise, since scan_cache doesn't store the OFF label/category data needed to reproduce
  scan.js's full L1 override logic (meat/dairy/seafood handling).
  - `node scripts/appendScanCacheToOffResults.js --dry-run` — preview counts/breakdown with no
    file changes.
  - `node scripts/appendScanCacheToOffResults.js --sample` — additionally print the first 3 new
    rows as JSON, for sanity-checking format/content before a real run.
  - Full column conventions (verdict label vocabulary, decisive-vs-optional flag splitting,
    `ingredients_preview` truncation length, language-skip detection) are documented in the
    script's own header comment — read it before writing any other tool that touches this CSV, so
    conventions don't drift.

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

### Session — Node 7 non-gmo-project-verified reject-flag gate (July 2026, PROMPT_VERSION 39)

Follow-up to the Stage 1 golden-master snapshot session above: the Step 3 spot-check found a real,
previously-undocumented bug — `clear-non-gmo-bioengineering-l2` (input `"Bioengineered ingredient,
salt, water."` + `en:non-gmo-project-verified` label) returned `verdict: 'yellow'` while `flags`
still contained a `severity: 'reject'` `bioengineering` flag.

**Root cause.** Node 7 of the L2 decision tree (`pages/api/scan.js`) — `else if (hasNonGmo) { verdict
= 'yellow'; clearedBy = 'non-gmo-project-verified'; }` — fired unconditionally on the label alone,
with no check for a pre-existing reject-severity flag, and nothing stripped that flag afterward. This
is the exact same shape as the Node 5 wild-caught bug fixed at PROMPT_VERSION 29: an unconditional
label-based verdict override with no `!flags.some(f => f.severity === 'reject')` gate. The
contradictory reject flag survived into the response and still fed `buildUserMessage()` in
`explain.js`, so the AI-generated explanation could also contradict the true severity.

**Audit of every other L2 tree node for the same shape (per instruction — report, don't fix without
confirmation).** Traced every node's condition against what reject-severity flags could still be
present in `flags` at that point in the chain, cross-referenced against which categories are cleared
at the *engine* level (`lib/rulesEngine.js`) by `hasUsdaOrganic`/`hasNonGmo` before ever reaching
`scan.js`. Two more confirmed instances of the identical shape — **NOT fixed this session, reported
for a separate decision**:

1. **Node 4 (organic path, `hasOrganic`)** — narrower exposure than Node 7, but real. The engine
   clears `conventional_crops`, `conventional_eggs`, and `glyphosate_heavy` via `hasUsdaOrganic`
   directly in their own trigger loops (confirmed via grep of `lib/rulesEngine.js` — each has its own
   `if (hasUsdaOrganic || ...) continue;` guard), so none of those can survive into `flags` when
   Node 4 runs. But `BIOENGINEERING_TERMS`'s loop has **no** `hasUsdaOrganic` check anywhere —
   confirmed by direct read. A product carrying both a `usda-organic` label and a literal
   "bioengineered"/"genetically modified" disclosure produces a `bioengineering: reject` flag that
   Node 4 silently ignores; if none of the organic branch's own checks (`fortified_vitamins`,
   `natural_colorants`, `olive_oil_adulteration`) match, the product gets a full GREEN with a live
   reject flag sitting unused in the response.
2. **Node 6 (game meat, `isGameMeat`)** — `else if (isGameMeat) { verdict = 'green'; clearedBy = null;
   }`, positioned before Nodes 7, 8b, 9, 10, 11, and 11b in the chain. Unlike Node 4, none of those
   later categories are cleared by anything specific to game meat, so Node 6 is exposed to all of
   them: `conventional_eggs`, `conventional_crops`, `bioengineering`, and `glyphosate_heavy` (reject)
   flags can all still be present in `flags` when this node fires and would be silently discarded the
   same way.

Every other node was confirmed safe: Nodes 5b/8/8b/8c/9/10/11/11b/13 all set `verdict = 'red'` (never
a downgrade, and 5b/8/8c prepend their own flag while keeping existing ones — no discarding), and
Node 12 (glyphosate-free) sits *after* every reject-category check in the chain (Nodes 8b, 9, 10, 11,
11b), so by construction nothing reject-severity can still be unaccounted-for by the time it runs —
this is exactly the ordering the "Keeping the tree in sync with the engine" callout already
documents. Node 14's safety likewise depends on that same ordering invariant holding, which is a
pre-existing, separately-documented maintenance concern, not a new finding.

**Fix.** Node 7's condition became `hasNonGmo && !flags.some(f => f.severity === 'reject')` — the
identical pattern used at Node 5, gating on *any* reject-severity flag rather than bioengineering
specifically. This mirrors Node 5's own resolution: when the gate fails, Node 7 is skipped entirely
and execution falls through to whichever later node actually matches the flag's category (Node 11 for
bioengineering, Node 10 for conventional_crops, Node 8b for conventional_eggs, Node 11b for
glyphosate_heavy reject) — that node sets the correct RED verdict and leaves `clearedBy` at `null`
rather than falsely stamping `'non-gmo-project-verified'` over a real reject. A category-specific gate
(e.g. only checking for a bioengineering reject) was considered and rejected — there's no principled
reason non-GMO clearance should apply to *some* reject categories and not others, and "any reject flag
blocks any downstream downgrade" is already the established precedent from Node 5 and
`INSTANT_RED_CATEGORIES`.

**Tests added (Suite L, L19–L20, `__tests__/api/scan.test.js`):** L19 reproduces the exact bug case
(`"Bioengineered ingredient, salt, water."` + non-gmo-project-verified label) and asserts
`verdict: 'red'`, `clearedBy: null`, and the `bioengineering` flag retaining `severity: 'reject'`.
L20 is a regression guard confirming legitimate non-gmo-project-verified clearance (no pre-existing
reject flag) still correctly produces `verdict: 'yellow'`, `clearedBy: 'non-gmo-project-verified'`.
**A wrong assumption was caught before landing**: L20 was initially written using an oats-based
fixture (`"Non-GMO oats, salt, water."`), expecting the non-gmo label to leave no reject flag behind —
confirmed via direct testing against `analyzeIngredients()` that this assumption was false. Only
`hasUsdaOrganic` fully clears `GLYPHOSATE_HEAVY` at the engine level, and only `hasGlyphosateFree`
downgrades it to caution; `hasNonGmo` does neither, so oats still produces a `severity: 'reject'`
`glyphosate_heavy` flag even with the non-gmo label present — which would have tripped the new L19
gate too, making the test assert the wrong thing. Switched to `"Almonds, sea salt, water."`, confirmed
via the same direct check to produce zero flags in any category, before finalizing. Full suite: 1380
passing / 1 known pre-existing failure (the cross-list contradiction test, unchanged — still only the
same 8 out-of-scope "dead entry" findings from the collision-word audit series), up from 1378 passing
/ 1 failing before this session's fix.

**PROMPT_VERSION bumped 38 → 39.** This changes real `verdict`/`clearedBy` output for a class of
previously-cached products — any product carrying a `non-gmo-project-verified` label alongside a
reject-severity flag from an unrelated category (most plausibly `bioengineering`, since a formulation
change or a minor sub-ingredient could trigger the mandatory disclosure without invalidating an
already-issued Non-GMO Project certification) previously showed an incorrect YELLOW verdict instead of
RED, with the contradicting reject flag silently along for the ride. Run
`DELETE FROM scan_cache WHERE prompt_version < 39` in Supabase before/after deploying — **holding off
on running this per an explicit standing decision**, not yet executed as of this session. The
`M. PROMPT_VERSION` contract test was updated to assert `39`.

**Golden master snapshot regenerated once, intentionally, to reflect this fix** — see the note added
to the "Golden Master Snapshot" section immediately below.

---

### Session — L1/L2 unification Stage 4: shadow-mode comparison + two Stage 3 design revisions (July 2026)

Built `scripts/shadowMode/compareVerdicts.js` — a standalone analysis script that runs all 135
Golden Master cases through the real `analyzeIngredients()` (genuinely imported from
`lib/rulesEngine.js`, not copied) plus a hand-written interpreter of `lib/verdictRules.js`'s Stage 3
rule table, and diffs the result against the real, frozen `scan.js` output already captured in
`scripts/goldenMaster/snapshot-baseline.json`. Since `pages/api/scan.js` only exports `handler` and
two small Sets (and its ES module syntax means plain `node` can't `require()` it at all), the script
carries hand-written mirrors of every other private helper it needs (`normalizeLabelTags`,
`isMeatProduct`, `isSeafoodProduct`, `isGameMeatProduct`, `detectWildCaught`,
`allIngredientsPrefixedOrganic`, `allIngredientsAreWaterSafe`, `maskIgnoredIngredients`,
`mapProductCategory`, `GAME_MEAT_CATEGORIES`) — each explicitly commented as a manual copy, "as of"
a specific commit and date, that will silently drift if `scan.js` changes before the script is next
run. Comparison scope: `verdict`, `flags` (by category+severity, summary text excluded as
presentation), `clearedBy`, `isMeat`, `oliveCaveat` — `unverifiedIngredients` and `productCategory`
are explicitly out of scope (unrelated to verdict logic). No `scan.js`/`rulesEngine.js`/
`verdictRules.js` production wiring anywhere; no `PROMPT_VERSION` bump — pure analysis.

**First run**: 130/135 matching, 5 expected diffs (all attributable to Stage 3's three corrections —
bioengineering organic/non-gmo clearance, conventional_meat game-meat handling, conventional_eggs
priority over conventional_meat), 0 unexpected. Two of those expected diffs surfaced findings that led
to revising the Stage 3 design itself (`lib/verdictRules.js`), not just the shadow interpreter:

**a. Bioengineering clearance narrowed.** `non-gmo-project-verified-label` was removed as a clearance
mechanism for the `bioengineering` reject flag; `usda-organic-label` and `organic-ingredient-prefix`
clearance are unchanged. Reasoning: USDA organic certification is a legal GMO prohibition, so a
product carrying both an organic label and a bioengineering disclosure is almost certainly a
data/mislabeling artifact — full clearance there remains safe. Non-GMO Project Verified is different
in kind: a private, point-in-time certification based on ingredient testing that can go stale relative
to a product's current formulation, particularly now that the federal Bioengineered Food Disclosure
Standard requires many products to carry an explicit, currently-accurate disclosure phrase independent
of any private cert's testing date. `bioengineering` is a reject-severity flag — the app's strongest
signal — so a false negative from a possibly-stale private label is worse than an over-cautious
verdict. This was an **explicit product decision made after reviewing Stage 4 shadow-mode findings,
not a bug fix** — see `DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded` in `lib/verdictRules.js`
for the full reasoning, dated 2026-07-11.

**b. Game-meat correction changed from full no-op removal to gated green.** The original Stage 3 draft
modeled game-meat detection as a full no-op removed from the L2 priority chain entirely. Shadow-mode
comparison surfaced an unstated side effect: removing the branch meant a **clean** game-meat product
(zero other flags) fell through to the default-yellow node instead of getting an automatic green — a
new L1/L2 asymmetry (L1's equivalent no-op still gives a clean game-meat product green, via the
engine's own default) that nobody had actually decided on. Fixed by changing the mechanism to a
**gated green**, mirroring the existing wild-caught Node 5 pattern exactly: game-meat category present
AND no pre-existing reject-severity flag → green; if a reject flag IS present, it is left alone (not
discarded) and the rest of the chain evaluates normally. The `DESIGN_DECISIONS` key was renamed from
`correctedGameMeatNoOpAtL2` to `correctedGameMeatGatedGreenAtL2` to stop describing a no-op that no
longer exists; the shadow interpreter was updated to match (`isGameMeat && !flags.some(reject) →
green`, the same shape as the wild-caught branch immediately above it).

**Second run** (after both revisions): 133/135 matching, 2 expected diffs, 0 unexpected. The 2
remaining diffs are both `multi-eggs-and-meat-l1`/`-l2`, unchanged from the first run and still
correctly attributable to correction #4 (conventional_eggs priority over the generic conventional_meat
injection) — neither revision touched that correction.

`lib/verdictRules.test.js`: +5 tests (73 total) — the narrowed bioengineering clearance (asserting
`non-gmo-project-verified-label` is now `INTENTIONALLY-NOT-CLEARED`, matching the existing
`conventional_eggs` pattern), the design-decision reasoning is present and dated, and both gated-green
game-meat scenarios (clean product → documented as resolving to green; product with a separate reject
flag → documented as being left alone, not discarded). Full test suite: **1453 passing** (up from
1448), the one known pre-existing dead-entry failure unchanged (tracked separately, zero-risk cleanup
item — see the collision-word audit series above).

**Two coverage gaps identified and flagged, not filled** (deferred to a future Stage 1 supplement —
see the "Known coverage gaps" note under "Golden Master Snapshot" below for full detail): no
golden-master case tests game meat together with a separate reject-severity flag (the actual
discriminating scenario the gated-green fix exists to handle is unverified by any real case), and no
case tests bioengineering's one remaining clearance path (the `usda-organic` label) now that the
non-GMO path no longer clears it.

**Still true, unchanged**: `lib/verdictRules.js` itself (the data table) is not wired into any live
path — `pages/api/scan.js` does not reference it, enforced by a drift-guard test. No `PROMPT_VERSION`
bump. `scripts/shadowMode/compareVerdicts.js` was a standalone dev analysis tool with its own
hand-mirrored copy of the corrected interpreter as of this session — see the Stage 5a entry
immediately below for how that duplication was resolved.

---

### Session — L1/L2 unification Stage 5a: shared helper extraction + dormant gated engine (July 2026)

First session in this project to touch `pages/api/scan.js` itself — treated with the same care as
every prior read-only stage. Goal: extract the corrected decision logic into a real, callable
production module, gated behind a flag that defaults to today's existing behavior, with zero verdict
change for any real user. Investigated and planned before writing any code; built only after explicit
sign-off.

**`lib/scanHelpers.js` created.** All 9 of `pages/api/scan.js`'s private helpers —
`normalizeLabelTags`, `isMeatProduct`, `isSeafoodProduct`, `isGameMeatProduct`, `detectWildCaught`,
`allIngredientsPrefixedOrganic`, `allIngredientsAreWaterSafe`, `maskIgnoredIngredients`,
`mapProductCategory` — plus `MEAT_CATEGORIES`/`SEAFOOD_CATEGORIES`/`GAME_MEAT_CATEGORIES` and their
supporting literals (`OFF_LABEL_MAP`, `CERT_UNCONFIRMED_TRIVIAL`, `WATER_SAFE_INGREDIENTS`,
`CATEGORY_TAG_MAP`), extracted verbatim. None of the nine closed over any `handler`-local state
(`req`/`res`/`sb`/etc.) — each depended only on its own parameters and sibling module-level constants,
confirmed before extraction, so this was a pure relocation with zero logic changes. CommonJS on
purpose (`module.exports`, matching `lib/rulesEngine.js`/`lib/verdictRules.js`), so the file is
`require()`-able directly from plain Node scripts as well as `import`-able from `scan.js`.

**`pages/api/scan.js` updated.** Now imports all of the above from `lib/scanHelpers.js` instead of
defining them locally, and re-exports `MEAT_CATEGORIES`/`SEAFOOD_CATEGORIES` unchanged — so
`__tests__/api/scan.test.js`'s existing drift-guard test needed **zero** modifications. The existing
L1-override / L2-tree decision logic (previously inline in the handler) was relocated verbatim into a
new local function, `computeVerdictLegacy(...)` — same code, new location, callable from a branch
point instead of always running inline.

**New `VERDICT_ENGINE_MODE` gate.** Reads `process.env.VERDICT_ENGINE_MODE` once at the top of the
handler; recognizes `'shadow'` and `'live'`, defaults to `'legacy'` for anything else (including
unset — the common case in production today). All three branches currently call
`computeVerdictLegacy(...)` identically — the branch *shape* exists now so Stage 5b/5c don't need to
touch `scan.js`'s control flow again, but nothing diverges yet. Verified this is truly inert: full
test suite passes unchanged, and a throwaway probe (built, run, and deleted within the session — never
committed) confirmed `legacy`, `shadow`, `live`, and unset all produce byte-identical handler output
for the same input today.

**`lib/verdictEngine.js` created** — `computeCorrectedVerdict()`, a cleaned-up production port of the
Stage 4 shadow interpreter (previously hand-written inside `compareVerdicts.js`), built on the new
shared helpers plus `lib/rulesEngine.js` and `lib/verdictRules.js`'s `CROSS_CUTTING_RULES`. Encodes the
three Stage 3 corrections (bioengineering organic-label-only clearance, gated-green game meat,
conventional_eggs priority over the generic conventional_meat injection). Deliberately hand-written
control flow, not dynamically driven by iterating `VERDICT_RULES` row-by-row — Stage 2 already
established the rule table intentionally doesn't encode full control flow, only per-category facts,
so a data-driven engine would have been a bigger, riskier redesign than this stage called for; porting
the already-validated interpreter was judged lower-risk than a fourth reimplementation of the same
tree. **Standalone as of this session** — built and usable, but not yet wired into `scan.js`'s
shadow/live branches (that's explicitly Stage 5b/5c's job).

**`scripts/shadowMode/compareVerdicts.js` updated** — deleted every hand-mirrored "will drift" helper
copy from Stage 4 and its own local interpreter function; now genuinely `require()`s
`lib/scanHelpers.js` (transitively, via `lib/verdictEngine.js`) and `lib/verdictEngine.js`'s
`computeCorrectedVerdict()` directly. The duplication Stage 4 flagged as a standing drift risk no
longer exists anywhere in the codebase.

**Verification**: full suite **1453 passing**, same one known pre-existing dead-entry failure,
unchanged. Re-ran the shadow-mode comparison after the extraction — **135 total / 133 matching / 2
expected diffs / 0 unexpected**, byte-identical to the pre-extraction run, same two cases
(`multi-eggs-and-meat-l1`/`-l2`, correction #4) as before. This is the load-bearing proof: since the
"live" side of every diff comes from the frozen `snapshot-baseline.json` and the "corrected" side is
recomputed through the now-shared helpers, any behavior drift introduced by the extraction would have
shown up as a numeric change here — it didn't.

**No `PROMPT_VERSION` bump** — the legacy path (what every real user hits today, regardless of the new
env var) is byte-for-byte unchanged; this is infrastructure/refactor, not a verdict-logic change.

**Next steps, still open**: Stage 5b (shadow mode in production — run both engines on real traffic,
log disagreement, still serve the legacy result to users) and Stage 5c (full cutover to
`lib/verdictEngine.js`) remain unbuilt.

---

### Session — L1/L2 unification Stage 5b: shadow mode in production (July 2026)

**✅ Shadow mode is built AND confirmed active.** The migration has been run against the live Supabase
database and `VERDICT_ENGINE_MODE=shadow` is set in Vercel — see "Stage 5b — activation confirmed"
below for the end-to-end verification that proves this, not just that the code shipped.

**`pages/api/scan.js`**: the `'shadow'` branch (dormant since Stage 5a) now genuinely runs
`lib/verdictEngine.js`'s `computeCorrectedVerdict()` alongside the legacy path on real traffic, gated
by both `VERDICT_ENGINE_MODE=shadow` and a new `VERDICT_ENGINE_SHADOW_SAMPLE_RATE` env var (0-100,
**code default is 10** — a conservative canary rollout, not 100%, by deliberate choice, so real
divergence data can be reviewed before ramping up. **Currently set to 100 in Vercel**, temporarily, for
the July 11 end-to-end verification below — see "Stage 5b — activation confirmed" for why this needs
revisiting before real user traffic accumulates). `verdictResult` stays bound to `computeVerdictLegacy()`'s
output unconditionally — confirmed via `git diff` that `computeVerdictLegacy`'s body and the `'live'`/
`else` branches are byte-for-byte untouched by this session. The corrected engine's output is used
**only** for comparison — never passed to `fetchExplanation`, `captureUnverifiedIngredients`, or the
`scan_cache` upsert.

**Silent-wrong-answer bug closed with a dedicated regression test.** `computeCorrectedVerdict()`
normalizes labels internally, so it must receive the **raw** `product.labels_tags`, never the
already-normalized `labelsDetected` the legacy path uses — passing the normalized array would silently
double-normalize (`normalizeLabelTags()` finds no match for e.g. `'usda-organic'`, since
`OFF_LABEL_MAP`'s keys are the raw `'en:usda-organic'` form) and produce a wrong-but-plausible
corrected result with no error thrown. `lib/verdictEngine.test.js` (new) proves, on a real fixture
(`"Oats, salt, water."` + `usda-organic`), that raw vs. normalized labels produce **genuinely
different** `computeCorrectedVerdict()` output (green/`organic` vs. red/`null`) — not just an
"argument was called with X" check, which wouldn't catch a silent-wrong-answer class of bug.
`__tests__/api/scan.test.js` Suite U's regression test exercises the real handler end-to-end on this
same fixture and asserts no divergence is recorded — which is only possible if the raw label was
actually used.

**Logging**: on mismatch only — `console.warn('[scan] shadow mode divergence:', {...})` plus an
**awaited**, try/caught insert into a new `verdict_shadow_diffs` Supabase table (migration written in
`supabase/migrations/20260712000000_create_verdict_shadow_diffs.sql`, **not yet run**). Agreement logs
nothing, so log/table volume scales with real divergence, not with sampled traffic volume. Comparison
scope matches Stage 4's convention: `verdict`, `flags` (category+severity+matchedIngredient, summary
text omitted), `clearedBy`, `isMeat`, `oliveCaveat`.

**Failure isolation**: the corrected-engine call and the Supabase insert each have independent
`try`/`catch` blocks. A throw in either is caught, `console.error`'d, and the request proceeds with
the already-computed legacy `verdictResult` — confirmed with two dedicated tests (a throwing
`computeCorrectedVerdict()`, and a throwing Supabase insert), both showing the legacy response
untouched. Shadow mode can fail silently even if `computeCorrectedVerdict()` has a bug nobody has
found yet.

**Verification**: full suite **1463 passing** (up from 1453, all 10 new — 3 in
`lib/verdictEngine.test.js`, 7 in Suite U), same one known pre-existing dead-entry failure, unchanged.
Dormancy re-confirmed two ways: `git diff` showing the legacy/live code paths literally unedited, and
a runtime probe (built, run, and deleted within the session — never committed) showing `legacy`,
`unset`, and `shadow` with sample rate `0` all produce byte-identical handler output today.
`lib/verdictEngine.js` and `lib/scanHelpers.js` confirmed untouched (`git diff --stat` empty for both);
`scripts/shadowMode/compareVerdicts.js` re-run shows the same **135 total / 133 matching / 2 expected
diffs / 0 unexpected** result as the Stage 5a run.

**No `PROMPT_VERSION` bump** — shadow mode never changes what a real user sees, regardless of sampling
rate, until someone deliberately activates it.

#### Stage 5b — activation confirmed (July 11, 2026)

Both prerequisite manual steps are done and independently verified, not just assumed:

1. **Migration run** — `supabase/migrations/20260712000000_create_verdict_shadow_diffs.sql` applied
   to the live Supabase database, confirmed reachable via a direct `select 1 from verdict_shadow_diffs
   limit 1` (success, zero rows, no error) before any verification write.
2. **`VERDICT_ENGINE_MODE=shadow`** set in Vercel.

**End-to-end verification against the real deployed app and real database**, same day: a throwaway
probe (built, run, and deleted — never committed) invoked the real `pages/api/scan.js` handler
in-process against the real Supabase project, using two golden-master fixtures on fresh synthetic
barcodes.

- **Known-divergent fixture** (Chicken Noodle Soup — `chicken broth, egg noodles, eggs, chicken, salt`,
  correction #4's eggs-vs-generic-meat case) correctly produced a persisted `verdict_shadow_diffs` row
  with the exact expected signature: `legacy_flags` containing the generic `conventional_meat` flag
  alongside `conventional_eggs`, `corrected_flags` with only `conventional_eggs` (the generic flag
  correctly dropped), `diverging_fields: ["flags"]`, both verdicts agreeing at `red`. `console.warn`
  fired with the matching payload. The row's `id` was `1` — the first row the table had ever received,
  confirming no divergence had been silently persisted before this point either.
- **Agreeing fixture** (`"Canola oil, salt, water."`) correctly produced **no row and no
  `console.warn`** — confirming silence-on-agreement, not just noise-on-divergence.
- **In both cases, the response actually returned to the user was the legacy verdict**, unchanged —
  the thing shadow mode must never affect.

Two real side-effect rows this verification left behind (both in `scan_cache`, both obviously-synthetic
test barcodes, both cleanup SQL handed to the user directly rather than deleted by the agent) and one
real `verdict_shadow_diffs` row (`id: 1`, cleanup SQL also handed off) — left in place at the user's
explicit instruction pending their own review before deletion.

**⚠️ `VERDICT_ENGINE_SHADOW_SAMPLE_RATE` is currently `100` in Vercel, not the code's conservative
default of `10`** — set deliberately high for this verification so a real divergence would be easy to
observe on the very small amount of real traffic this app currently sees. **Revisit this once real user
traffic begins** — 100% means every real scan now runs `computeCorrectedVerdict()` a second time and
writes to `verdict_shadow_diffs` on every disagreement, not just a 10% sample. Dial it back down in
Vercel once enough real-world divergence data has accumulated, per the original Stage 5b design intent.

**Next steps, still open**: once real divergence data has been reviewed and looks sane, ramp back down
to (or re-confirm) a sampled rate, then Stage 5c (full cutover — `VERDICT_ENGINE_MODE=live` actually
wired to return `computeCorrectedVerdict()`'s result directly) remains unbuilt.

#### Stage 5b — real-traffic review: zero divergences observed (July 2026)

After running shadow mode (`VERDICT_ENGINE_SHADOW_SAMPLE_RATE=100`) against roughly 100 real
production scans (~50 products, both `userLevel` 1 and 2, deliberately varied categories),
`verdict_shadow_diffs` was queried directly (read-only, service-role key — the table has RLS enabled
with zero policies, so the anon key cannot see it at all) and returned **zero rows**. This confirms
the mechanism itself works (already independently verified end-to-end in the July 11 activation
check above) but that real traffic simply hasn't yet produced a case matching any of the three known
corrections — including, specifically, neither of the two coverage gaps flagged in Stage 4 (game meat
+ a separate reject-severity flag; bioengineering + a `usda-organic` label). Zero rows is not evidence
those gaps are closed — it only means neither has been observed yet; both remain genuinely untested by
real traffic to date.

**Explicit product decision, made 2026-07-11**: proceed toward Stage 5c cutover
without first closing these two coverage gaps via a deliberately constructed test case. Weighed the
cost of waiting for a rare real-world case to naturally occur (unknown, possibly long, timeline) against
the safety of keeping the legacy code path available as a dormant fallback after cutover — `scan.js`'s
`VERDICT_ENGINE_MODE` gate is not removed by Stage 5c, only its default target changes, so `legacy`
remains one env var away at any point if `live` mode ever misbehaves on one of these untested
combinations in production. This is a documented risk acceptance, not a claim that the gaps don't
matter — see the "Known coverage gaps" note under "Golden Master Snapshot" below, which remains open.

**Superseded note**: the coverage-gap risk acceptance above was the plan going into Stage 5c. In
practice, Stage 5c (immediately below) closed both gaps via direct unit fixtures instead of carrying
them forward again — the "Known coverage gaps" note under "Golden Master Snapshot" has been updated
to reflect this; it is no longer an open item as of this session.

---

### Session — L1/L2 unification Stage 5c: full cutover wiring (July 2026, PROMPT_VERSION 40)

Wires `VERDICT_ENGINE_MODE=live` to actually return `lib/verdictEngine.js`'s `computeCorrectedVerdict()`
result — the first stage in this whole project that changes real, user-facing verdict output (every
prior stage was read-only analysis or a dormant/shadow code path). Treated with the caution that
implies: investigated and reported a written plan first (exact wiring mechanism, rollout mechanism,
PROMPT_VERSION impact, test-suite impact, rollback plan), got explicit sign-off on every open judgment
call, then implemented.

**`pages/api/scan.js`**: the `'live'` branch (dormant since Stage 5a — see that entry above) now calls
`computeCorrectedVerdict()` for real, using the same raw-label-passing pattern already regression-tested
in the `'shadow'` branch: `productLabels: product.labels_tags` (raw OFF form, e.g. `'en:usda-organic'`),
never the already-normalized `labelsDetected` — `computeCorrectedVerdict()` calls `normalizeLabelTags()`
internally, so passing the normalized array would silently double-normalize and produce a
wrong-but-plausible result with no error thrown (the same failure class Stage 5b's regression test
exists to catch). Wrapped in a `try`/`catch` that falls back to `computeVerdictLegacy()` on any error,
logged via `console.error('[scan] live mode computeCorrectedVerdict failed, falling back to legacy:', err)`
— unlike shadow mode, live mode has no already-computed legacy result sitting around to keep serving if
the corrected engine throws, so without this fallback a bug there would 500 the endpoint instead of
degrading to today's known-good behavior. **Scoped diff confirmed single-hunk** via `git diff
pages/api/scan.js` — `computeVerdictLegacy()`'s definition, the full L1-override block and L2 tree
inside it, and the `'shadow'` branch are byte-identical to before this change; nothing outside the
`'live'` branch body was touched.

**Rollout decision: binary flip, not sample-rate-gated.** `VERDICT_ENGINE_MODE=live` is a straight
on/off switch for everyone at once — no `VERDICT_ENGINE_SHADOW_SAMPLE_RATE`-style gradual ramp was
built for live mode, and none is planned. Reasoning: shadow mode's cautious default sample rate exists
to limit exposure while *validating* a new engine against real traffic without affecting anyone: that
risk doesn't apply here, since there are no real users yet — affecting users isn't a cost to manage at
this stage, it's the entire point of shipping this. The corrected engine already cleared a materially
higher bar than shadow mode's own validation required before this cutover was considered: 133/135
golden-master exact matches (2 known, understood diffs, both attributable to correction #4) plus
roughly 100 real production shadow-mode scans with zero unexpected divergence (see "Stage 5b —
real-traffic review" above). A sample-rate-gated live mode would also introduce a strictly worse
property than either extreme: two different users scanning the identical barcode could get two
different verdicts depending on random chance — non-reproducible and confusing if noticed, for no
real safety benefit, since the actual safety net here is the rollback mechanism (see below), not a
slow ramp. A gradual rollout mainly buys time to notice a problem that a config-flip rollback already
makes instantly and fully reversible — for a zero-user app, that time isn't worth much. The dormant
`legacy`/`shadow` code paths and the `VERDICT_ENGINE_SHADOW_SAMPLE_RATE` machinery are left completely
intact and untouched by this decision — they remain available as-is for any future need.

**New "V. Live mode" test suite (5 tests, `__tests__/api/scan.test.js`)**, mirroring Suite U's
structure (self-contained helpers duplicated locally rather than sharing Suite U's, which are scoped
inside its own `describe` block — this keeps Suite U itself completely untouched):
1. Correction #4 (eggs vs. generic `conventional_meat`) is reflected in the **actual response** at
   `live` mode — `conventional_eggs` present, the generic injected `conventional_meat` flag absent
   (the same fixture Suite U's shadow-divergence test already proved diagnostic).
2. A plain, uncontroversial product (`"Canola oil, salt, water."`) still scores correctly at live mode
   — a sanity check that ordinary products aren't broken by the cutover.
3. Regression guard — raw `product.labels_tags`, not normalized `labelsDetected`, reaches
   `computeCorrectedVerdict()` from the `'live'` branch (mirrors Suite U's identically-purposed guard
   for the `'shadow'` branch).
4. A throwing `computeCorrectedVerdict()` falls back to the legacy result instead of failing the
   request — proves the new `try`/`catch` actually works, not just that it was written.
5. The exact same eggs+meat fixture from test 1, re-run with `VERDICT_ENGINE_MODE` **unset** (legacy
   default) — confirms the old shape (both flags present) still comes back, proving the change is
   scoped to `'live'` only and the default production behavior is unaffected until the env var is
   actually set in Vercel.

**Both previously-open coverage gaps closed via direct unit fixtures — no longer carried forward as
open questions.** `lib/verdictEngine.test.js` grew from 3 tests to 9:
- **Correction #1 (bioengineering + `usda-organic` label)**: L2 — organic label clears the
  bioengineering flag entirely (green, `clearedBy: 'organic'`, no bioengineering flag survives); L2
  contrast — the identical ingredient text with no label still correctly flags red (proves the fixture
  is genuinely diagnostic, not just unconditionally green); L1 — the clearance runs before the L1/L2
  split in `computeCorrectedVerdict()`, so it applies at L1 too (green); L1 contrast — no label
  produces the ordinary L1 caution (yellow), confirming the flag is real and merely caution-severity
  absent the label.
- **Correction #2 (game meat + a co-occurring reject-severity flag)**: game meat (`en:game-meats`)
  with a real `conventional_crops` reject trigger (bare `"sugar"`, no organic clearance available) →
  red, flag preserved — the exact discriminating scenario the gated-green fix (vs. a full no-op) exists
  to handle, and the one no golden-master case or real shadow-mode scan had ever exercised (see Stage 4
  and the Stage 5b real-traffic review above); contrast — clean game meat with no reject flag still
  correctly resolves to green (the gated-green behavior, confirming it isn't a regression to the
  no-op the original Stage 3 draft used before Stage 4's revision).

**PROMPT_VERSION bumped 39 → 40.** This is the largest single verdict-output change in this
project's PROMPT_VERSION history — not one correction but three activated simultaneously (bioengineering
organic-label clearance, game-meat gated-green, conventional_eggs priority over the generic
conventional_meat injection) — consistent with the established convention that any change to real
`flags`/`verdict`/`clearedBy` output requires a bump. Contract test in `__tests__/api/scan.test.js`
updated and confirmed passing in isolation.

**Golden master snapshot confirmed untouched — no regeneration needed or performed.** `git status
--short scripts/goldenMaster/` showed zero changes after this session. Per the snapshot's own
regeneration rule (see "Golden Master Snapshot" below), regeneration is only required when *pre-refactor
(legacy) behavior* is intentionally changed — this stage doesn't touch legacy behavior at all, it
activates a separate, already-validated code path behind a mode flag. The snapshot still faithfully
represents what it was built to represent.

**Full suite: 1474 passing, 1 known pre-existing failure** — the same long-tracked
`rulesEngine.test.js` cross-list contradiction test (`coconut sugar`, `flax seeds`, `sweet potato`,
`quinoa`, `amaranth`, `teff`, `date sugar`, `lactic acid starter culture` — the same 8 out-of-scope
dead-entry findings tracked across many prior sessions in this file), unrelated to this work and
unchanged by it.

**Rollback plan, stated explicitly**: revert by setting `VERDICT_ENGINE_MODE` back to `legacy` (or
removing the env var entirely — the code only recognizes `'shadow'`/`'live'` and falls back to
`'legacy'` for anything else, including unset) in Vercel. **No code change, no different commit to
redeploy** — the dormant legacy path ships in the same bundle as `'live'` mode from this commit
onward, so both are always available; only the env var controls which one actually runs.

#### Stage 5c — pending activation steps (not yet done)

This commit ships the **code** for the full cutover. It does **not** activate it. Same pattern as the
Stage 5b entry above ("Migration run" / "`VERDICT_ENGINE_MODE=shadow` set in Vercel" as separate,
explicit, verified steps before that stage was considered "live") — deliberately not doing these out
of order:

1. **Deploy** this commit to `mvp-beta` (Vercel auto-deploys from the branch, per this project's
   existing pattern — no manual trigger needed or available).
2. **Confirm the deploy actually landed** before touching any env var — per the deploy-gap incident
   documented elsewhere in this file, "pushed" and "deployed" are separate claims; confirm via a live
   scan showing `prompt_version: 40` read directly off a freshly-written `scan_cache` row, the same
   verification pattern used for every prior PROMPT_VERSION bump in this project.
3. **Set `VERDICT_ENGINE_MODE=live`** in Vercel, then **confirm Vercel actually picked up the change**
   without requiring a manual "Redeploy" click on the existing build — this specific mechanic was
   flagged as unverified in the Stage 5c investigation report (Vercel env var changes do not always
   take effect on already-deployed serverless function instances without an explicit redeploy of the
   same build). Confirm this empirically the first time, the same way the Stage 5b activation was
   independently verified end-to-end rather than assumed from a push succeeding — do not assume a
   dashboard save alone is sufficient.
4. **Invalidate `scan_cache`** — run `DELETE FROM scan_cache WHERE prompt_version < 40;` in Supabase.
   Per the established convention in this file, this can be run before or after the deploy step, but
   must happen before real users start hitting cached rows from below `prompt_version: 40` once `live`
   mode is active, or a cache hit could return stale `flags`/`verdict` computed under the wrong engine
   for that barcode/user_level pair.
5. Only after all of the above: `VERDICT_ENGINE_MODE=live` is genuinely active in production, not just
   committed. Until step 3 is done, this project's real, deployed behavior is unchanged — `legacy`
   remains the default exactly as it has been since Stage 5a.

None of these five steps were performed as part of this session — they are explicitly deferred to a
deliberate, separate activation pass, per instruction.

---

### Session — meat detection fixes: allergen-advisory data loss, MSM species trigger, unverified suppression (July 2026, PROMPT_VERSION 41)

Follow-up to a prior investigation session (report-only, no code changed) that confirmed three
issues found while auditing `scan_cache` data for meat products. This session implements all three
as isolated, separately-tested fixes.

**Fix 1 — `stripAllergenAdvisory()` data-loss bug on "contains X% or less of" phrasing.** The
qualifier-stripping regex (`lib/rulesEngine.js`, `stripAllergenAdvisory()`) only recognized
`"contains less than X% of"` — a label using the equally common `"contains X% or less of"` phrasing
instead (with or without a trailing colon) fell through to the greedy bare-`"contains"` fallback,
which deletes everything from `"contains"` to the ingredient list's final period. Confirmed real
production impact: barcode 888313971800 ("Beef Franks," ingredients ending `"...contains 2% or less
of salt, sorbitol, sodium lactate, natural flavorings, sodium phosphates, hydrolyzed corn protein,
paprika, sodium diacetate, sodium erythorbate, sodium nitrite."`) had all five of the trailing
additive/flavor ingredients silently deleted before trigger matching ever ran, producing only a
`conventional_meat` flag when the correct result includes `conventional_crops`, `natural_flavors`,
and four separate `additives` reject flags. Broadened the qualifier regex to accept either quantity
phrasing (`"less than X%"` or `"X% or less"`) and made the trailing `"the following"`/colon handling
colon-position-agnostic (`\s*(?:the\s+following)?:?\s*` instead of requiring the colon immediately
after `"the following:"`), so a colon sitting directly against `"of"` with no space (`"...of: salt"`)
is also handled correctly — an earlier attempt at this fix still required whitespace before the
colon and silently failed on that exact real-world shape until corrected. 7 new tests (describe block
75): the exact repro string, the colon variant, and regression guards confirming the existing
`"less than"` qualifier stripping, the Kraft-style no-colon phrasing, the genuine bare `"Contains
wheat."` advisory-stripping fallback, and the non-percentage `"one or more of the following"`
qualifier are all unchanged.

**Fix 2 — "mechanically separated meat" never matches real labels.** `SYNTHETIC_ADDITIVES` had only
the literal phrase `'mechanically separated meat'` — real labels always name the species (`"MECHANICALLY
SEPARATED CHICKEN"`, `"mechanically separated pork"`, etc.), never the generic word "meat," so this
trigger never matched a real product; confirmed directly against two real cached products (Bologna,
barcode 044700008577; Classic Franks, barcode 015900134014) where the species-qualified phrase landed
in `unverified_ingredients` instead of flagging `additives`. Changed to a bare, species-agnostic
`'mechanically separated'` trigger. Confirmed safe without a dedicated collision guard
(`isAdjacentToLetterUnlessAllowlisted()`-style): at 23 characters, this is far too long and
distinctive a phrase for any plausible accidental substring collision, unlike the short bare triggers
(`corn`/`oats`/`ada`) that needed one. `matchedIngredient` now reports the bare trigger text
(`'mechanically separated'`) rather than the old full literal phrase — the three pre-existing
describe-22 tests were updated accordingly (regression guards confirming the original literal phrase
still matches). Also confirmed `containsMeatIngredient()`/`isMeatIngredient` detection was **already
correct** for both real-world repro fixtures independent of this fix, since bare `'chicken'`/`'pork'`
(already in `MEAT_INGREDIENT_TERMS`) match the species word regardless of the "mechanically separated"
prefix — so no `MEAT_INGREDIENT_TERMS` change was needed for this fix. 6 new tests (describe block 22,
renamed to reflect the species-agnostic trigger): chicken/pork/turkey/beef variants via `test.each`, a
mixed-species single-fire guard (confirms the flag doesn't double-fire per species word in the same
ingredient list), and an unverified-ingredients regression check on the real Bologna repro string.

**Fix 3 — meat/dairy corroboration arrays never suppress `unverified_ingredients`.**
`MEAT_INGREDIENT_TERMS`, `MEAT_DERIVED_INGREDIENTS`, and `MILK_DERIVED_INGREDIENTS` were never spread
into `ALL_TRIGGERS` (the array Pass 1 of unverified-token filtering checks against), so ingredients
already corroborated by `containsMeatIngredient()`/`containsMeatDerived()`/`containsMilkDerived()` —
e.g. `"chicken breast"` (barcode 051900016042, Oven Roasted Chicken Breast) and `"angus beef"`
(barcode 044700073377, Jumbo Angus Beef Uncured Franks) — still showed up in
`unverified_ingredients` despite `is_meat_ingredient: true` in the cached row. Confirmed the identical
gap for dairy (`"whey protein concentrate"`). Spread all three arrays into `ALL_TRIGGERS`, mirroring
how `FORTIFIED_VITAMINS` was added there for the same reason (see that array's own inline comment).
7 new tests (describe block 76): suppression checks for all three real fixtures, matching
flags/verdict-unaffected regression guards (confirms this is purely a Pass-1 display change), and an
`"andouille sausage"` suppression check.

**One pre-existing test updated as a necessary consequence of Fix 3, not a new bug**: describe block
72's `"andouille sausage"` regression guard previously asserted the token *appears* in
`unverifiedIngredients` as proof its tokenization wasn't corrupted by an unrelated Oxford-comma
conjunction-stripping fix. That assertion no longer holds — `"sausage"` is a real
`MEAT_INGREDIENT_TERMS` entry, so `"andouille sausage"` is now correctly suppressed as a real,
already-corroborated meat product. Replaced the assertion with a check that the token isn't mangled
into a stripped-prefix form (`"ouille sausage"`), which is what that test was actually meant to prove.

**One known, accepted low-severity edge case from Fix 3 — flagged, not fixed, out of scope for this
session**: bare `'ham'` in `MEAT_INGREDIENT_TERMS` would also suppress an unrelated real ingredient
like `"Hamlin orange juice"` (a real Florida orange variety) from the unverified review queue via
substring match, since `ALL_TRIGGERS`'s Pass-1 filter is substring-only, not word-boundary-aware.
Display-only (no flags/verdict impact) and mirrors already-accepted substring risk elsewhere in
`ALL_TRIGGERS` — see the collision-word audit series above for the same accepted-risk shape on other
bare short triggers. Left for a future session's review rather than fixed here, per instruction to
keep this session scoped to the three confirmed fixes.

**PROMPT_VERSION bumped 40 → 41 — covers Fixes 1 and 2 only.** Both change real `flags`/`verdict`
output for previously-cached products: Fix 1 for any product using `"contains X% or less of"`
phrasing (most severely, processed-meat products with several trailing additive/preservative
ingredients after the qualifier — exactly the shape that silently lost real reject-severity flags);
Fix 2 for any mechanically-separated-meat product (bologna, hot dogs, classic franks) that previously
showed zero `additives` flag for its processing method. Run `DELETE FROM scan_cache WHERE
prompt_version < 41` in Supabase before/after deploying. **Fix 3 does NOT bump `PROMPT_VERSION`** —
it only changes the display-only `unverified_ingredients` list, never `flags`/`verdict`, consistent
with how the Batch 6/7/9 whole-food whitelist entries shipped previously. The `M. PROMPT_VERSION`
contract test in `__tests__/api/scan.test.js` was updated to assert `41`.

Full suite: **1494 passing** (up from 1474; +20 net across all three fixes), same one known
pre-existing failure (the cross-list contradiction test — `coconut sugar`, `flax seeds`, `sweet
potato`, `quinoa`, `amaranth`, `teff`, `date sugar`, `lactic acid starter culture` — unrelated to this
session, unchanged, tracked separately since the collision-word audit series).

---

### Session — L2 tree flag-injection unification (July 2026, PROMPT_VERSION 42)

Follow-up to an investigation session (report-only, no code changed) into a structural gap
distinct from — but adjacent to — every prior fix in this file: `conventional_meat`,
`conventional_dairy`, and the three organic sub-tree flags (`fortified_vitamins`,
`natural_colorants`, `olive_oil_adulteration`) were only ever injected *by* the specific L2 tree
node that also decided verdict — meaning an earlier-firing node (most commonly an instant-red flag,
but also e.g. Node 7's non-GMO check) silently prevented those categories from ever being
**evaluated at all**, not merely suppressed after the fact. Confirmed via a `scan_cache` production
data audit: **64.6% of dairy products and 44.2% of meat products with an instant-red flag never got
their sourcing flag.** Organic products with an instant-red flag never had the organic sub-tree
evaluated either, since Node 4 was nested inside the same `else` branch as the check that discarded
it — a `usda-organic`-labeled product with a synthetic additive would silently never have its
fortified-vitamins/colorant/olive-oil status checked, and would additionally lose its `clearedBy:
'organic'` context entirely (discarded to `null`).

**What changed** — implemented as two separately committed, separately tested parts:

- **Part 1 (`384a79d`) — Phase A: unconditional flag injection.** Every corroboration signal for the
  five affected categories is now evaluated and injected into `flags` exactly once, before the
  existing 14-node priority chain runs — not by whichever node the chain happens to reach. The five
  tree nodes that used to inject these flags (5b, 8, 8c, 9, and the three branches inside Node 4)
  had their own duplicate injection removed; their verdict/clearedBy-setting logic was left
  otherwise untouched. One necessary correctness fix was bundled in: Node 5 (wild-caught) and Node 7
  (non-GMO) each gate on "no reject flag already present" — a check written when the only way a
  reject flag could exist at that point was via the engine itself. Snapshotting reject-flag presence
  into `hasRejectFlagBeforeInjection` (deliberately excluding `INSTANT_RED_CATEGORIES`, which could
  never have been present at that point in the original chain either) prevents Phase A's own
  injected reject flags from retroactively defeating the wild-caught/non-GMO exemptions — caught
  during implementation by a real regression (wild-caught salmon + an unrelated seed-oil flag
  incorrectly losing its `conventional_meat` exemption) before the commit landed.
- **Part 2 (`e45f041`) — Phase B: `clearedBy` behavior change.** The 14-node priority chain's shape
  and order is otherwise completely unchanged — same first-match-wins verdict logic as before. The
  one deliberate change: when `hasInstantRedFlag` fires, `clearedBy` is now `'organic'` instead of
  `null` if the product also carries the `usda-organic` label. Verdict still goes red either way (an
  organic label doesn't excuse a real synthetic additive/seed oil/trans fat), but the cert context
  is no longer silently dropped from the response. This holds whether or not any of the three organic
  sub-tree flags actually fired.

**A genuine, confirmed invariant, not a residual gap:** `conventional_meat`/`conventional_dairy` and
`clearedBy: 'organic'` can never co-occur in the same response, because Phase A's meat/dairy
injection block is gated on `!hasOrganic` — a certified-organic product correctly should never get a
"no cert" flag for meat or dairy sourcing it does have a cert for. This was confirmed directly during
Part 2's own implementation: a test written to expect `conventional_meat` + `clearedBy: 'organic'`
together for a realistic organic-labeled beef-hot-dog fixture failed outright (verdict came back
`green` — Phase A never injected the meat flag at all once `hasOrganic` was true). The real
production barcode this investigation started from (025317161916, "The Great Organic Uncured Beef
Hot Dog") was re-examined in light of this: the original investigation's own query had already
selected only rows where `cleared_by !== 'organic'`, meaning the *real* cached row's `clearedBy` was
already `null` — consistent with the already-documented "product name says Organic but OFF has no
real `usda-organic` tag" data gap (see "Known Limitations"), not a contradiction of the new
invariant. See the full CLAUDE.md "Level 2 universal decision tree" section above (Architecture
note) for the complete reasoning — a future session should not attempt to "fix" this mutual
exclusivity by removing the `!hasOrganic` gate.

**Tests**: 13 new tests in Part 1 (Suite W, `__tests__/api/scan.test.js`) — meat+additives and
dairy+seed_oils co-occurrence, wild-caught/game-meat exemptions preserved despite an unrelated
instant-red flag, all three organic sub-tree flags now injecting alongside an additive, and
regression guards confirming every existing single-category case (meat alone, dairy alone,
organic-clean-green, wild-caught alone, game-meat alone, gelatin-only) produces identical flags to
before. 8 new tests in Part 2 (Suite X in `scan.test.js`, 5 tests; Suite A2 in
`__tests__/api/explain.test.js`, 3 tests) — organic + additives with none of the three sub-tree
conditions applicable still showing `clearedBy: 'organic'`; regression guards for the
organic-clean-green and non-organic-instant-red cases; the X4a/X4b real-world-shaped pair described
above; and confirmation that `buildUserMessage()` in `explain.js` handles the new `clearedBy:
'organic'` + `verdict: 'red'` combination correctly (its `flagsSection` ternary is keyed first on
whether `flags` is non-empty, so this combination routes through the ordinary "Flagged categories"
branch — `clearedBy` is never even consulted there, since it's only read in the ternary's "no flags"
branches).

**PROMPT_VERSION bumped 41 → 42.** This changes real `flags`/`clearedBy` output for previously-cached
products: any dairy or meat product with an instant-red flag now correctly also carries its
`conventional_dairy`/`conventional_meat` flag; any organic product with an instant-red flag now
correctly shows `clearedBy: 'organic'` instead of `null`, and may now also carry
`fortified_vitamins`/`natural_colorants`/`olive_oil_adulteration` flags that were never evaluated
before. Run `DELETE FROM scan_cache WHERE prompt_version < 42` in Supabase before/after deploying.
The `M. PROMPT_VERSION` contract test in `__tests__/api/scan.test.js` was updated to assert `42`.

Full suite: **1515 passing** (up from 1494 at the end of the prior session), same one known
pre-existing failure (the cross-list contradiction test, unrelated, unchanged, tracked separately
since the collision-word audit series).

---

### Session — swaps data source migration, Phase 0: Google Sheet → swap_products (July 2026)

Migrates the Swaps System's data source from the public Google Sheet (`SWAP_SHEET_ID`, CSV export)
to a first-class Supabase table, `swap_products` — scoped strictly to the migration itself, per
instruction: no changes to `VALID_CATEGORIES`, `CATEGORY_TAG_MAP`, the `conventional_meat` swap
fallback mapping, pagination, or any UI. Phase 1 (an admin approval workflow building on top of this)
is a separate, later session.

**New table**: [supabase/migrations/20260712010000_create_swap_products.sql](supabase/migrations/20260712010000_create_swap_products.sql)
— see the "swap_products" entry under "Supabase → Tables" above for the full column list. Same
server-only RLS pattern as `verdict_shadow_diffs`: enabled, zero policies, read/written exclusively
via `getSupabaseServer()`. **This migration must be run manually against the live Supabase database
before the code in this session's commit is deployed** — per the project's documented deploy-gap and
`olive_caveat` migration-application incidents, a migration file sitting in the repo is not the same
claim as "applied to production."

**`scripts/migrateSwapsFromSheet.js`** (new, one-time, run via `node`, not part of any API route) —
fetches and parses the Sheet CSV using the same column order and parsing logic `pages/api/swaps.js`
used at the time of this migration (duplicated into the script rather than imported, since the script
runs under plain `node` and `pages/api/swaps.js` uses ES module `import`/`export` syntax a bare `node`
process can't parse — the same limitation already documented for `pages/api/scan.js` under "Golden
Master Snapshot"). Converts the Sheet's semicolon/comma-delimited strings into the table's real
`text[]` columns, sets `source = 'curated'` on every row, and uses a lazy, function-scoped
`getSupabaseServer()`-style client — mirroring `lib/supabaseServer.js`'s own lazy-init discipline
rather than importing it directly, for the same ESM/CJS reason. Reads Supabase/Sheet credentials from
`.env.local`/`.env` manually (plain `node` doesn't load Next's env files), same convention already
established in `scripts/appendScanCacheToOffResults.js`. Refuses to insert if `swap_products` already
has rows unless `--force` is passed, to guard against accidental duplicate runs.

**`pages/api/swaps.js`** — the Google Sheet CSV fetch/parse code (`COLUMNS`, `parseCSV`, the Sheet
`fetch()` call) was removed entirely; `getSwapRows()` now queries `swap_products` via
`getSupabaseServer()` (lazy-initialized inside the function, never at module scope) and caches the
full table result in the same in-memory, 1-hour-TTL `_cache` variable the CSV pipeline used. A new
`normalizeSwapRow()` re-joins the table's `text[]` columns back into the same semicolon/comma-delimited
strings the CSV pipeline produced (`certifications`/`why_it_passes` → `;`-joined, `where_to_buy` →
`,`-joined) and stringifies `swap_level` back to `'1'`/`'2'` — so every line of the existing
category-filter / swap_level-tiering / shuffle / slice-to-3 / AI-fallback logic below it is
byte-for-byte unchanged, and the response shape (`{ swaps, source }`, each row still carrying
`tier: 'good' | 'better'`) is identical to before. `SwapCard.jsx`'s existing client-side
`.split(';')`/`.split(',')` calls needed no changes as a result.

**`__tests__/api/swaps.test.js`** (new — this endpoint had zero test coverage before this session,
per CLAUDE.md's own "Common Patterns" section). 18 tests across 5 suites: category filtering (3),
swap_level tiering into good/better including the existing slice-to-3 behavior (4), the empty-result
AI fallback trigger — including the no-category case correctly NOT triggering it, and the
no-`ANTHROPIC_API_KEY` case correctly degrading to an empty array without ever calling the Claude
client (4), response shape — including a dedicated check that array columns come back as delimited
strings, not raw arrays, and that null DB columns normalize to `''` not `null` (4), and basic input
validation (3). `getSupabaseServer()` is mocked; `jest.resetModules()` runs before every test since
`pages/api/swaps.js`'s in-memory `_cache` is module-scoped and would otherwise leak mock data from
one test into the next.

**Migration run**: executed after the user ran the SQL migration against the live database (confirmed
first via a live PostgREST query — `PGRST205` "Could not find the table" before the SQL ran, `200`
with an empty array immediately after). `node scripts/migrateSwapsFromSheet.js` inserted **131 rows**
into `swap_products`, matching the Sheet's own row count exactly. Verified end-to-end against the real
local dev server (`GET /api/swaps?category=beverages&userLevel=1`): correct `good`/`better` tiering,
`certifications`/`why_it_passes`/`where_to_buy` correctly re-joined into delimited strings (not raw
arrays), `swap_level` correctly stringified — response shape byte-identical to the pre-migration CSV
pipeline's output.

**No PROMPT_VERSION bump** — this migration touches only the swaps recommendation feature, not
`analyzeIngredients()`'s `flags`/`verdict`/`clearedBy` contract or anything `scan_cache` stores;
`PROMPT_VERSION` gates the rules engine's verdict output specifically, unrelated to this change.

Full suite: **1533 passing** (up from 1515 — 18 new `swaps.test.js` tests), same one known
pre-existing failure (the cross-list contradiction test, unrelated, unchanged).

---

### Session — swaps subcategory support, Phase 1 (July 2026)

Adds subcategory support for 5 of the 10 swap categories (`chips`, `dairy`, `meat`, `beverages`,
`bread`) plus one bug fix (`conventional_meat` FLAG_CATEGORY_MAP fallback). Scoped strictly to this,
per instruction — no changes to pagination or the (not-yet-built) admin approval workflow.

**New columns**: `swap_products.subcategory` (text, nullable, no `CHECK`/enum constraint — deliberately
free text, see [supabase/migrations/20260712020000_add_subcategory_to_swap_products.sql](supabase/migrations/20260712020000_add_subcategory_to_swap_products.sql))
and `scan_cache.product_subcategory` (text, nullable, see
[supabase/migrations/20260712030000_add_product_subcategory_to_scan_cache.sql](supabase/migrations/20260712030000_add_product_subcategory_to_scan_cache.sql)).
Both purely additive — no `PROMPT_VERSION` bump, no cache invalidation; existing `scan_cache` rows
read `product_subcategory: null` until rescanned, same pattern as `is_meat_category`/`is_meat_ingredient`
and `olive_caveat` before them.

**`SUBCATEGORY_TAG_MAP` / `mapProductSubcategory()`** (`lib/scanHelpers.js`) — see "Swaps System" →
"Product subcategory mapping" above for the full subcategory list, the real-OFF-tag research method,
and why `chips:veggie` and `meat:deli` are intentionally left unmapped (no confident distinct tag
evidence found in real product data — veggie chips share potato chips' own tag; deli meats get filed
under their base protein or carry no tag at all). Wired into `pages/api/scan.js` immediately after
`mapProductCategory()`; the result (`productSubcategory`) is included in the scan response and
persisted to `scan_cache.product_subcategory` on write, mirroring `productCategory` exactly.

**`pages/api/swaps.js`** — new optional `?subcategory=` query param. When provided alongside
`?category=`, narrows to the (category, subcategory) pool for the existing shuffle/tier/slice-to-3
logic *only if that pool is non-empty*; zero subcategory matches falls back to the category-wide pool
silently, so a swap row with no confidently-classified subcategory (`null`) never dead-ends to no
swaps shown. This fallback is explicitly not treated as "zero curated results" — the AI fallback still
only triggers when the category-wide pool itself is empty, unchanged from before this session.
`normalizeSwapRow()` now also passes through `subcategory` on each response row.

**`components/swaps/SwapsScreen.jsx`** — two changes:
1. Passes `productSubcategory` from the scan result alongside `category` in the `GET /api/swaps` call
   — but only when a real `productCategory` was resolved (the flag-derived `fallbackCategory` path has
   no corresponding subcategory signal).
2. **Bug fix**: `FLAG_CATEGORY_MAP.conventional_meat` changed from `null` to `'meat'`. This map was
   written before `meat` existed as a real swap category (Phase 0 added it with real `swap_products`
   rows); the stale `null` meant any scan whose only category signal was a `conventional_meat` flag
   (no OFF `productCategory` resolved) dead-ended straight to the "Local Farm Upgrade" card with zero
   curated or AI swaps shown, even though real meat swaps now exist. `FLAG_CATEGORY_MAP` was also
   extracted from component-instance scope to module scope and given a named export, specifically so
   this fix has a plain, testable data structure to assert against — this project has no React
   rendering test infrastructure (`jest.config.js` sets `testEnvironment: 'node'`, no
   `@testing-library/react`), so a component-render test wasn't an option; see
   `__tests__/components/SwapsScreen.test.js`, a new file that imports the named export directly
   without rendering the component (safe under `testEnvironment: 'node'` — the component function body,
   which uses `useState`/`useEffect`/JSX, is never invoked, only defined).

**`scripts/backfillSwapProductSubcategories.js`** (new, one-time, run via `node`) — best-effort
subcategory classification for existing `swap_products` rows via simple keyword matching against
`product_name + brand` (lowercased), **not** the OFF-tag-based `SUBCATEGORY_TAG_MAP` (swap_products
rows carry no OFF `categories_tags` data). Only touches rows in the 5 covered categories whose
`subcategory` is currently `null` — never overwrites an already-set value, so safe to re-run after new
rows are added later. For each row, every keyword group for its category is tested; a row is only
classified when **exactly one** group matches — zero or multiple (ambiguous, e.g. "beef bacon"
matching both `beef` and `pork`) both leave `subcategory` null, same "don't guess when uncertain"
discipline as `SUBCATEGORY_TAG_MAP` itself. Unlike the live-scan tag map, this keyword approach *can*
classify `veggie` and `deli` (matching on `"veggie"`/`"vegetable"` or `"deli"`/`"ham"`/`"lunch meat"` in
the product name) — that gap was specifically about live OFF *tag* evidence, not product name text.
Run with `node scripts/backfillSwapProductSubcategories.js [--dry-run]`; prints a full list of rows
left unclassified for manual review.

**Migration run**: executed after the user ran both SQL migrations against the live database
(confirmed first via a live PostgREST query against each new column — `swap_products?select=id,subcategory`
and `scan_cache?select=barcode,product_subcategory` both returned `200`, not a missing-column error).
`node scripts/backfillSwapProductSubcategories.js` then ran against the real 131-row `swap_products`
table. **35 classified, 26 left null (ambiguous or no keyword match)**, out of 61 rows in the 5 covered
categories (`chips` 12, `dairy` 14, `meat` 10, `beverages` 15, `bread` 10 = 61; the other 70 rows, in
the 5 uncovered categories, were correctly untouched — reconciled via a direct per-category count
query: 61 + 70 = 131, 35 + 26 = 61).

By subcategory: `beef` 4, `poultry` 4, `pork` 2, `tortilla` 4, `potato` 3, `milk` 4, `yogurt` 4,
`butter` 2, `coffee_tea` 5, `juice` 1, `sparkling_water` 1, `tortillas_wraps` 1.

Unclassified rows (26) — for manual review:
- **beverages** (8): Califia Farms Oat Barista Blend; Boxed Water (Boxed Water Is Better); Harmless
  Harvest Organic Coconut Water; GT's Synergy Organic Kombucha (GT's Living Foods); Malk Organics Oat
  Milk; Elmhurst 1925 Oat Milk; REBBL Organic Coconut Milk Elixir; Organic Valley Grassmilk Whole Milk
  — none contain a `soda`/`juice`/`sparkling water`/`coffee`/`tea` keyword; several are plant milks,
  which have no beverages-subcategory keyword group at all in this backfill's scheme (`milk` is a
  `dairy` subcategory, not a `beverages` one, per the task's own subcategory list — these products are
  filed under `beverages` in `swap_products`, so they can never keyword-match a `dairy` group).
- **bread** (9): Dave's Killer Bread Organic 21 Whole Grains; Canyon Bakehouse Gluten Free Heritage
  Style Bread; Rudi's Organic Bakery Sandwich Bread; Angelic Bakehouse Sprouted Grain Bread; Base
  Culture Original Keto Bread; Food for Life Ezekiel 4:9 Sprouted Grain Bread; Food for Life Ezekiel
  4:9 English Muffins; Alvarado Street Bakery Sprouted Wheat Bread; Silver Hills Sprouted Power Bread
  — none contain `sliced`/`loaf`/`tortilla`/`wrap`/`bagel`/`bun`; these are all standard loaf-style
  breads whose names just don't happen to say "sliced" or "loaf".
- **dairy** (4): Siggi's Plain Whole Milk Yogurt; Chobani Plain Whole Milk Yogurt; Stonyfield Organic
  Whole Milk Yogurt; Nancy's Organic Whole Milk Yogurt — each matched **both** the `milk` and `yogurt`
  keyword groups (literally named "Whole Milk Yogurt"), which the backfill's "classify only on exactly
  one match" rule correctly treats as ambiguous rather than guessing.
- **chips** (5): Barnana Organic Plantain Chips (×2, two separate SKUs); Artisan Tropic Cassava Strips
  Sea Salt; Brad's Organic Crunchy Kale Chips; Beanfields Sea Salt Bean Chips — plantain, cassava, kale,
  and bean chips are all real chip products with no `tortilla`/`potato`/`veggie`/`vegetable` keyword
  match; none of these snack-chip variants map onto the 4-value subcategory list at all.

No `meat` rows were left unclassified — all 10 matched exactly one of `beef`/`poultry`/`pork`/`seafood`/`deli`.

**Tests — net +37, reconciled explicitly since the arithmetic matters here**:
- `__tests__/api/swaps.test.js`: **+6** (18 → 24) — new Suite F (F1–F6): narrowing, fallback on zero
  matches, unchanged behavior when `subcategory` omitted, tiering within a narrowed pool, response
  shape, no-category edge case. Zero modifications to existing suites A–E, zero removals. (The shared
  `makeSwapProductRow()` helper gained a `subcategory: null` default field — an additive change to test
  infrastructure, not a test case, and confirmed not to affect any existing assertion.)
- `__tests__/api/scan.test.js`: **+28** (all new — brand-new Suite Y, appended at the end; suites A–X
  untouched). Broken down: 19 from a `test.each` over `COVERED_CASES` (one real-tag case per confirmed
  subcategory across the 5 covered categories), 5 from `test.each` over `UNCOVERED_CASES` (the 5
  categories with no subcategory support, always `null`), 4 standalone (no-subcategory-tag-present for
  chips and meat, empty `categories_tags`, the 404 response). 19+5+4=28.
- `__tests__/components/SwapsScreen.test.js`: **+3** (new file — no prior test of `FLAG_CATEGORY_MAP`
  existed anywhere in the codebase, so this was necessarily an addition, not an update to an existing
  test).

6 + 28 + 3 = 37, matching 1533 → **1570 passing** exactly. Same one known pre-existing failure (the
cross-list contradiction test, unrelated, unchanged).

**No `PROMPT_VERSION` bump** — same reasoning as Phase 0: this touches only the swaps recommendation
feature and `scan_cache`'s purely-additive `product_subcategory` column, not `analyzeIngredients()`'s
`flags`/`verdict`/`clearedBy` contract.

---

### Session — subcategory follow-up: plant_milk, bread redesign, chips 'other' default, dairy tie-break (July 2026)

Follow-up to the Phase 1 subcategory session, fixing four gaps the first backfill run's results
surfaced (61 rows in the 5 covered categories, 35 classified / 26 unclassified). See "Product
subcategory mapping" above for the current (post-fix) subcategory table and per-subcategory tag
research; this entry covers the change itself and the numbers.

**1. `beverages:plant_milk` added.** Real oat/almond/soy/coconut milk products were showing up
unclassified because "milk" was only ever a `dairy` subcategory keyword — these products are filed
under the `beverages` top-level category in `swap_products`, so they could never match. Live-scan
tag evidence: `en:plant-based-milk-alternatives` and `en:milk-substitutes`, confirmed across 8 real
products (3 brands each of oat/almond/soy milk). Backfill keywords: oat/almond/soy/coconut/cashew/
macadamia milk (space-optional, `oat\s?milk` matches both "oat milk" and "oatmilk"), "plant milk",
"non-dairy milk", "barista blend".

**2. `bread` redesigned.** `sliced`/`tortillas_wraps`/`bagels_buns` → `sprouted_grain`, `gluten_free`,
`keto_low_carb`, `sandwich`, `bagels_muffins`, `tortillas_wraps`. Live-tag research found confident
evidence for only 4 of the 6: `en:sprouted-wheat` (sprouted_grain), `en:gluten-free-breads`
(gluten_free), `en:bagel-breads`/`en:english-muffins` (bagels_muffins), `en:flatbreads`/`en:wraps`
(tortillas_wraps, carried over unchanged). `keto_low_carb` and `bread:sandwich` have **no**
`SUBCATEGORY_TAG_MAP` entry — checked 6 and 5 real products respectively (multiple brands, including
products literally named "Keto Bread" and "Sandwich Bread") and every one carries only the same
generic `en:breads`/`en:sliced-breads`/`en:white-breads` tags every other bread type already uses.
Backfill keywords: `sprouted` → sprouted_grain; `gluten[\s-]?free|\bgf\b` (word-boundary "gf", not
substring, per instruction) → gluten_free; `\bketo\b|low[\s-]?carb` → keto_low_carb;
`sandwich|sliced|\bloaf\b` → sandwich; `english muffin|\bbagel` → bagels_muffins (note: no longer
matches bare "bun" — that was `bagels_buns`' scope, not `bagels_muffins`'); `tortilla|\bwrap` →
tortillas_wraps (unchanged).

**3. `chips` defaults to `'other'` on zero keyword matches — backfill script only, not live-scan.**
`other` was always meant to be the 4th chips bucket (tortilla/potato/veggie/other); the fallback just
wasn't implemented in the first backfill pass. `DEFAULT_SUBCATEGORY_ON_NO_MATCH = { chips: 'other' }`
in `scripts/backfillSwapProductSubcategories.js` — applies only when `classify()` finds **zero**
matching groups; an ambiguous multi-group match still stays `null`, unaffected. Deliberately **not**
mirrored in `lib/scanHelpers.js`'s live-scan `mapProductSubcategory()`: an OFF product with no
matching tag there could mean missing/incomplete tag data, not a genuine "other"-type product — that
ambiguity doesn't exist when a human is reviewing one specific real curated product name by hand.

**4. Dairy milk/yogurt tie-break.** A product name matching both the `milk` and `yogurt` keyword
groups (e.g. "Whole Milk Yogurt") now resolves to `yogurt` — a general rule in `classify()`
(`scripts/backfillSwapProductSubcategories.js`), not a one-off patch to the 4 rows
that originally surfaced it. Scoped narrowly: only the exact `{milk, yogurt}` two-match combination
triggers the tie-break; every other dairy multi-match combination (e.g. cheese+butter) is still
genuinely ambiguous and stays `null`.

**Re-run against the live 131-row table** (only rows with `subcategory IS NULL` are ever touched —
verified the previous 35 non-null rows were structurally guaranteed untouched by the query itself, not
just by chance, and confirmed directly via a live per-row query after the run): **21 newly classified,
5 left null**, out of the 26 rows the first run left unclassified.

By new subcategory: `plant_milk` 4, `sprouted_grain` 4, `other` 5, `yogurt` 4 (the tie-break
reclassifications — dairy's total `yogurt` count is now 8: 4 from the first run + these 4),
`gluten_free` 1, `keto_low_carb` 1, `sandwich` 1, `bagels_muffins` 1.

Still unclassified (5): Boxed Water (Boxed Water Is Better) — no plant-milk or other beverages
keyword; Harmless Harvest Organic Coconut Water — coconut *water*, not coconut *milk*, correctly not
matched; GT's Synergy Organic Kombucha — no beverages keyword; Organic Valley Grassmilk Whole Milk —
real dairy milk filed under `beverages` with no plant qualifier, correctly not matched as plant_milk;
Dave's Killer Bread Organic 21 Whole Grains — no bread keyword from the new 6-value scheme.

**Manual one-off fixes applied directly to `swap_products` after this session** (2 of the 5 rows
above; not via the backfill script — these needed judgment calls a keyword rule shouldn't try to
generalize from):
- **Organic Valley Grassmilk Whole Milk** — `category` corrected `beverages` → `dairy` (it's real cow
  milk, not a plant milk; it was simply miscategorized at the source), `subcategory` set to `milk`.
- **Dave's Killer Bread Organic 21 Whole Grains** — `subcategory` set to `sandwich` (a standard loaf,
  correctly the "sandwich" bucket; its name just never happened to say "sandwich"/"sliced"/"loaf").
- **Boxed Water, Harmless Harvest Organic Coconut Water, GT's Synergy Organic Kombucha** —
  confirmed left `null` deliberately, not reprocessed. No existing bucket fits (water and kombucha
  aren't juice/soda/sparkling-water/coffee-tea/plant-milk); forcing a match into an ill-fitting bucket
  would be worse than leaving them for manual review. **Future subcategory candidate**: a dedicated
  `water`/`kombucha`-style bucket if volume in that space grows.

**Final overall state** (verified via a fresh per-category-subcategory live query, after the manual
fixes above): 131 total rows, **58 classified across the 5 covered categories** (35 from Phase 1 + 21
from the follow-up session + 2 manual fixes), **3 permanently unclassified** (the water/kombucha trio
above), 70 in the 5 uncovered categories (untouched throughout). `58 + 3 = 61` (the covered total),
`61 + 70 = 131`. `bread` and `dairy` are now both fully classified (10/10 and 15/15 respectively —
`dairy`'s row count rose from 14 to 15 and `beverages`' fell from 15 to 14 as a direct result of the
Grassmilk category correction).

**Tests — net +47, reconciled explicitly (per the standing instruction to reconcile counts, not just
report file totals)**:
- `__tests__/api/scan.test.js` (Suite Y): 28 → 32, **net +4**. Not a pure addition — 7 additions (2
  `plant_milk` cases, 4 replacement bread cases for `sprouted_grain`/`gluten_free`/`bagels_muffins`×2,
  1 new standalone "bread with only generic tags" test) minus 3 removals (the retired
  `bread:sliced` and `bread:bagels_buns`×2 `test.each` entries). 7 − 3 = 4.
- `__tests__/scripts/backfillSwapProductSubcategories.test.js`: new file, **net +43** — direct unit
  tests of `classify()` (newly exported via a `require.main === module` guard so requiring the script
  for tests doesn't trigger a live Supabase call). 15 for `plant_milk`, 17 for the bread redesign
  (including a regression check that "Hamburger Buns" alone no longer matches `bagels_muffins`, unlike
  the old `bagels_buns`), 4 for the chips `'other'` default (including confirming it's NOT applied to
  any other category), 7 for the dairy tie-break (including a check that the tie-break does NOT
  generalize to other ambiguous combinations like cheese+butter).
- `__tests__/api/swaps.test.js` and `__tests__/components/SwapsScreen.test.js`: untouched this
  session, 0 net change.

4 + 43 = 47, matching 1570 → **1617 passing** exactly. Same one known pre-existing failure (the
cross-list contradiction test, unrelated, unchanged).

**No `PROMPT_VERSION` bump** — same reasoning as Phase 0/Phase 1: subcategory classification only,
no `analyzeIngredients()` `flags`/`verdict`/`clearedBy` impact.

---

### Session — Phase 2: "Show More" expansion, no second network request (July 2026)

Adds a client-side "Show More" expansion to swap results — see "Swaps System" → "'Show More'
expansion" above for the full behavior. Scoped strictly to this; no pagination or admin-approval-
workflow changes.

**`pages/api/swaps.js`**: `RESULTS_PER_TIER` constant added (20, was a literal `3` in two `.slice(0,
3)` calls). Every other line of the category/subcategory filtering, shuffle, swap_level tiering, and
AI-fallback trigger condition (`swaps.length === 0 && category`) is untouched — confirmed by diff, not
just by description. Also fixed a stale doc comment in the "API Routes" section that still described
this endpoint as reading a Google Sheet CSV, left uncorrected since the Phase 0 migration.

**`components/swaps/SwapsScreen.jsx`**: three new module-scope exports, same "extract for
testability" reasoning as `FLAG_CATEGORY_MAP` (Phase 1) — this project has no React rendering test
infrastructure, so pure functions are the only way to get real unit coverage on this logic:
- `INITIAL_VISIBLE_SWAPS = 3`
- `getVisibleSwaps(items, expanded)` — returns the first 3 items, or all of them once expanded
- `shouldShowExpandButton(items, expanded, source)` — `true` only when `source !== 'ai'`, not already
  expanded, and more than 3 items exist. The `source !== 'ai'` check is asserted explicitly rather than
  relied on as a side effect of the AI path never populating `swaps` — the instruction was "never show
  Show More for AI results," so that's now a direct, testable rule instead of an emergent one.

New `goodExpanded`/`betterExpanded` state, independent per tier, both reset to `false` whenever a new
fetch starts (category/subcategory/userLevel change) so a stale expansion never survives into a new
scan's results. A new `source` state variable was also added (previously the fetched `data.source`
was consulted once inline and discarded) specifically so `shouldShowExpandButton` has it to check.
Level 2's flat list (previously unconditionally rendering every fetched "better" row) now goes through
the same `visibleBetterSwaps`/`shouldShowExpandButton` path as Level 1's Better tier — Level 2 gets
"Show More" too, since the instruction was "per tier," not "Level 1 only," and Level 2's one tier is
still a tier.

**Visual style**: the "Show More" button reuses the app's existing tappable-text-link pattern — same
amber color, 600 weight, transparent background/border as the header's "← Verdict" button — rather
than introducing a new visual treatment, per instruction.

**Verified live, not just via unit tests**: built a throwaway `/dev-swaps-test` route rendering
`SwapsScreen` directly against a real category (`condiments`, chosen because a live query confirmed it
has more than 3 rows in both tiers), confirmed in the running dev server that (1) exactly 3 items per
tier render initially with a "Show More" link below each, (2) tapping Good Swap's "Show More" reveals
all remaining fetched items for that tier only — `read_network_requests` showed the exact same set of
`/api/swaps` calls before and after the click, confirming zero new requests fired, (3) Better Swap's
own "Show More" was untouched and still showed only its first 3 — confirming the two tiers expand
independently, as required. The throwaway route was deleted after verification; it was never part of
the app's real routing.

**Tests — net +13, reconciled explicitly**:
- `__tests__/api/swaps.test.js`: 24 → 27, **net +3**. B4 ("level-2 slices to at most 3 results") was
  *modified in place* to assert the new 20-item cap against 25 available rows — not counted as a new
  test, since it's the same test slot with an updated assertion. B5 (level-1 dual-tier 20-cap, 25+25
  rows → 20+20), B6 (10 rows, between the old and new cap, returns all 10 — confirms the cap didn't
  just move from 3 to some other wrong number), and B7 (1 row, the pre-Phase-2 small-count case, still
  returns exactly what exists) are pure additions.
- `__tests__/components/SwapsScreen.test.js`: 3 → 13, **net +10**, all additions — 1 for
  `INITIAL_VISIBLE_SWAPS`, 4 for `getVisibleSwaps` (not expanded, expanded, ≤3 items unaffected, empty
  array), 5 for `shouldShowExpandButton` (the normal true case, already-expanded, ≤3 items, AI source,
  and AI+expanded+few-items combined to confirm every condition fails independently, not just the
  first one checked).
- No removals in either file, no other test files touched.

3 + 10 = 13, matching 1617 → **1630 passing** exactly. Same one known pre-existing failure (the
cross-list contradiction test, unrelated, unchanged).

**No `PROMPT_VERSION` bump** — no `analyzeIngredients()` `flags`/`verdict`/`clearedBy` impact; this is
a swaps-recommendation-display change only.

---

### Session — Phase 3a: admin swap-candidate foundation (July 2026)

Foundation for surfacing real scanned products as swap candidates instead of relying entirely on
hand-curated `swap_products` rows. **Explicitly 3a of 3** — schema, admin access control, and the
candidate-discovery query only. No admin UI page, and no approve/reject action, exist yet (Phase 3b).
See "Swaps System" → "Admin swap-candidate review" above for the full behavior.

**New table `swap_candidate_reviews`** ([supabase/migrations/20260712040000_create_swap_candidate_reviews.sql](supabase/migrations/20260712040000_create_swap_candidate_reviews.sql))
— `id`, `barcode`, `decision` (check in `('approved','rejected')`), `reviewed_at`, `note`,
`swap_product_id` (nullable, FK to `swap_products(id)`, populated by Phase 3b's not-yet-built approve
action). Same RLS pattern as `swap_products`: enabled, zero policies, service-role-only.

**New column `swap_products.purchase_links`** ([supabase/migrations/20260712050000_add_purchase_links_to_swap_products.sql](supabase/migrations/20260712050000_add_purchase_links_to_swap_products.sql))
— `jsonb not null default '[]'::jsonb`. Each element will be shaped `{ retailer, affiliate_url }` once
something populates it — purely a schema foundation this session, not wired into any code path.
`where_to_buy` (the existing `text[]` column) is deliberately untouched — no migration, no backfill,
`pages/api/swaps.js` keeps reading/returning it exactly as before.

**`lib/requireAdmin.js`** (new) — the reusable admin-auth check, built specifically so Phase 3b's
approve/reject actions can reuse it rather than each admin route reinventing the check. No prior
precedent existed in this codebase for verifying *which* signed-in user is calling an API route
(`scan.js` doesn't need caller identity; `scanHistory.js` goes direct-to-Supabase client-side under
RLS, never through an API route) — this is the first. Verifies the client-sent
`Authorization: Bearer <supabase access token>` via a real `supabase.auth.getUser(token)` round-trip
(rejects expired/revoked/forged tokens, unlike a local JWT decode), then checks the resulting email
against the new `ADMIN_EMAILS` env var (comma-separated, case-insensitive, whitespace-trimmed).
Reuses `getSupabaseServer()` rather than constructing a second Supabase client.

**`GET /api/admin/swap-candidates`** (new) — `401` via `requireAdmin()` if the caller isn't an admin.
Otherwise: aggregates `scans` (not `scan_cache`, which only holds current per-level state, not
historical events) for `verdict='green'` rows with `>= 3` distinct `user_id`s per barcode (JS-side
grouping, not a SQL `GROUP BY ... HAVING` — see the "Swaps System" section above for why this
follows the project's existing "simple queries, business logic in JS" convention rather than
introducing the first stored procedure); excludes barcodes already in `swap_products` or already
present in `swap_candidate_reviews` (either decision — a rejected barcode must never resurface); joins
`scan_cache` for the remaining candidates to attach product info and **both** L1 and L2 verdict data
when present, deliberately not filtered to currently-green (a candidate's historical qualification and
its current cached state can drift apart, and an admin should see that drift, not a stale assumption).

**Tests — net +33, both entirely new files, reconciled explicitly**:
- `lib/requireAdmin.test.js`: **+11** — valid admin token, non-admin email, missing header, malformed
  header, empty-token header, Supabase auth error, thrown exception, unavailable Supabase client,
  case-insensitive email match, multi-entry `ADMIN_EMAILS` with whitespace, and `ADMIN_EMAILS` unset
  entirely (every user rejected, not "check disabled").
- `__tests__/api/admin/swap-candidates.test.js`: **+22** across 7 suites — admin auth wiring (401,
  200, 405-before-auth-check), the distinct-scanner threshold at exactly 2 (excluded) and exactly 3
  (included) plus same-user-repeat-scan and null-`user_id` guards, `swap_products` exclusion,
  `swap_candidate_reviews` exclusion for both decision values, the multi-level `scan_cache` join
  (both levels present, only one level present, product info attached, no `scan_cache` row at all,
  `explanation` passed through), and response-shape/early-return edge cases including asserting via
  the mock's own call log which tables are (and are NOT) queried once a candidate pool empties out.

11 + 22 = 33, matching 1630 → **1663 passing** exactly. Same one known pre-existing failure (the
cross-list contradiction test, unrelated, unchanged). No modifications to any existing test file, no
removals — both files are new.

**No `PROMPT_VERSION` bump** — no `analyzeIngredients()` `flags`/`verdict`/`clearedBy` impact.

---

### Session — Phase 3b: admin review screen + approve/reject actions (3b of 3 — Phase 3 complete, July 2026)

Builds the actual admin UI on top of Phase 3a's read-only discovery endpoint: the review screen
(`pages/admin/swap-candidates.jsx`), the approve/reject action endpoint
(`POST /api/admin/swap-candidates/review`), and the four-state verification-status logic that gates
approval when a candidate's historical green verdict can no longer be confirmed current. Full design
— the verification-status states, the single-endpoint approve/reject shape, and the compensating-delete
partial-failure handling — is documented in the "Admin swap-candidate review" section under "Swaps
System" above; this entry covers what changed and the test reconciliation.

**`GET /api/admin/swap-candidates` extended** — each level's response object gained a `promptVersion`
field (straight passthrough of `scan_cache.prompt_version`), specifically so the client can determine
staleness against the live `PROMPT_VERSION` constant without an extra round-trip.

**Pure-function extraction, same discipline as `FLAG_CATEGORY_MAP`/`getVisibleSwaps` in Phase 1/2** —
this project has no React rendering test infrastructure (`testEnvironment: 'node'`), so every
non-trivial decision in the new page is a plain, module-scope-exported function, not buried in
component state: `getVerificationStatus()` (the four-state check), `validatePurchaseLinks()`,
`validateApprovalForm()`, `isApproveEnabled()`, `buildApprovePayload()`, `buildRejectPayload()`,
`buildInitialFormState()`.

**Two defensive fixes made independent of any specific bug, both justified on their own merits:**
`window.location.href` is used for the unauthenticated-redirect instead of `next/router`'s
`router.replace()` — this page is Pages Router redirecting to `/`, which App Router renders, and a
full-page redirect is a reasonable, cheap cost for a rare, security-relevant redirect on an admin-only
page rather than relying on a cross-router soft navigation. The session check itself
(`getSessionWithTimeout()`) is wrapped in an 8-second timeout — an auth gate should never be able to
hang a page forever if the underlying SDK call stalls.

**⚠️ Live browser verification not achieved this session — disclosed here rather than silently
skipped.** The pure logic and both API routes are thoroughly unit-tested and exercised directly
against real request/response shapes. The rendered page's actual runtime behavior (redirect-on-401,
form interactions, submit flow) could not be confirmed interactively in this session's browser preview
tooling: a bare, throwaway Pages Router test page containing nothing but a trivial `useState`/`useEffect`
(no imports from this project at all) exhibited the identical symptom — the effect never firing — in
the same preview environment, pointing at a tooling limitation specific to Pages Router pages in this
preview harness (this is the first Pages Router UI page added to this project; every previously
browser-verified page in this codebase has been under `app/`) rather than a defect in this page's own
code. That inference is reasonably strong but not proven. If a future session finds this page failing
to redirect or render in a real browser, start the investigation there rather than assuming the page
itself is broken from scratch.

**Tests — net +71, reconciled explicitly**:
- `__tests__/api/admin/swap-candidates.test.js`: 22 → 23, **net +1** (E6 — `promptVersion` passthrough
  from `scan_cache.prompt_version` into each level's response object).
- `__tests__/pages/admin/swap-candidates.test.js` (new file): **+50** across 7 suites —
  `getVerificationStatus()` (all four states, priority ordering when multiple conditions could apply,
  the default-parameter case), `validatePurchaseLinks()`, `validateApprovalForm()`,
  `isApproveEnabled()` (confirmed-status bypass vs. explicit-checkbox requirement), `buildApprovePayload()`
  (why-it-passes line-splitting, certification-checkbox-to-array mapping, purchase-link filtering,
  `confirmedCurrent` derivation), `buildRejectPayload()`, `buildInitialFormState()` (pre-fill from the
  higher-available level, empty-candidate defaults). `lib/auth` is mocked so the test file never
  constructs a real Supabase client via `lib/supabase.js`'s module-load-time singleton.
- `__tests__/api/admin/swap-candidates/review.test.js` (new file): **+20** across 5 suites — admin auth
  wiring (401 with zero Supabase queries made, 405-before-auth-check, valid-admin pass-through), input
  validation (missing barcode, invalid `decision`, missing `product_name`/`category` on approve, invalid
  `swap_level`), the reject flow (correct `swap_candidate_reviews` row, null-reason handling, confirms
  `swap_products` is never touched, insert-failure → 500), the approve flow (correct `swap_products`
  payload including `source: 'scan_approved'`, correct `swap_candidate_reviews` row with
  `swap_product_id` linked, the `confirmedCurrent: false` → verification-note case, response shape), and
  partial-failure handling (a failed `swap_products` insert never attempts the review insert; a failed
  `swap_candidate_reviews` insert triggers the compensating delete of the just-created `swap_products`
  row and returns 500; the success path never calls delete at all).

1 + 50 + 20 = 71, matching 1663 → **1734 passing** exactly. Same one known pre-existing failure (the
cross-list contradiction test, unrelated, unchanged since the collision-word audit series).

**No `PROMPT_VERSION` bump** — no `analyzeIngredients()` `flags`/`verdict`/`clearedBy` impact.

**Phase 3 of the swaps overhaul is now complete**: 3a (schema, admin auth, candidate discovery) + 3b
(the review screen and approve/reject actions) together give real scanned green-verdict products a path
into `swap_products` without hand-curation, gated by human review and an explicit acknowledgment when
a candidate's current status can't be automatically confirmed.

**Deploy status: pushed and deployed, not just committed.** Phases 0 through 3b (`a344817` through
`f71d889`) were pushed to `origin/mvp-beta` via a clean fast-forward on July 12, 2026. Per this
project's own "committed ≠ deployed" discipline (see the deploy-gap incident elsewhere in this file),
this was independently confirmed rather than assumed from the push succeeding: GitHub's commit status
API (`GET /repos/.../commits/f71d889.../status`) shows a `Vercel` context with `state: success` and
`description: "Deployment has completed"`, timestamped `2026-07-12T19:03:35Z`. So all of Phases 0–3b
described above — the `swap_products` migration, subcategory support, Show More, and the full admin
review workflow including the approve/reject write path — is live in production as of that timestamp,
not merely sitting in a local branch. No `scan_cache` purge was run or needed as part of this push —
none of these commits touch `analyzeIngredients()`/verdict logic, so it's unrelated to the separate,
deliberately-deferred PROMPT_VERSION 41/42 purge decision documented under "Scan Cache Pattern" above.

---

### Session — sign-out fix: stuck spinner + false re-login on network error (July 2026)

Fixes a reported bug: tapping "Sign Out" on ProfileScreen sometimes worked, but most of the time left
the UI in a stuck/loading state instead of a clean logged-out screen — and refreshing or navigating
away and back never showed a logged-out state either, snapping straight back to the signed-in Profile
view as if sign-out had never happened.

**Root cause**, confirmed by reading the installed `@supabase/auth-js` source directly
(`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`, `_signOut()`): `supabase.auth.signOut()`
(the default `scope: 'global'`) only clears the local session token and fires the `SIGNED_OUT` event
**after a successful network round-trip** to revoke the session server-side. If that round-trip fails
for any reason other than an ignorable 401/403/404 (a plain network error, offline, a slow/flaky
connection — plausible for a barcode-scanning app used in stores), `_signOut()` returns early:
`_removeSession()` — the function that both clears `localStorage` and fires `SIGNED_OUT` — is never
called. There was also no client-side timeout on the call, so a hanging request left the "Sign Out"
button showing `...` indefinitely (the "stuck" symptom). Compounding this, `lib/auth.js`'s `signOut()`
did correctly `await` the call, but `components/profile/ProfileScreen.jsx`'s `handleSignOut()` never
inspected the `{ error }` it returned — it silently proceeded as if sign-out had succeeded, so the UI
gave no indication anything had gone wrong, and its only path to reflecting sign-out was the
`onAuthStateChange` listener in `app/page.jsx`, which never fired on this failure path.

**Fix, three files**:
- [lib/auth.js](lib/auth.js) — `signOut()` now wraps `supabase.auth.signOut()` in a 6-second timeout
  (`withTimeout()`), so a hanging network call can no longer block the button forever. On any error or
  timeout, it now also force-clears the local session directly via a new `clearLocalSupabaseSession()`
  helper — removes any `localStorage` key matching `sb-*-auth-token` (confirmed via the installed
  `@supabase/supabase-js` bundle that this is the client's actual default storage-key format, so no
  project-ref needs to be hardcoded). This guarantees the local session is actually gone after
  `signOut()` resolves, regardless of whether the server-side revoke succeeded — closing the "refresh
  snaps back to signed-in" symptom, since the stale token genuinely can't survive anymore.
- [components/profile/ProfileScreen.jsx](components/profile/ProfileScreen.jsx) — `handleSignOut()` now
  calls a new `onSignOut` prop unconditionally in its `finally` block, after `signOut()` settles —
  regardless of whether it returned an error. This stops the UI from depending on the async
  `onAuthStateChange` listener (which never fires on the fallback-clear path) as the only way to learn
  sign-out happened.
- [app/page.jsx](app/page.jsx) — passes `onSignOut={() => setUser(null)}` to `<ProfileScreen>`, so
  `user` state updates deterministically the moment `handleSignOut()` finishes, independent of whether
  Supabase's own event system ever fires. (The existing `onAuthStateChange` listener is untouched and
  still handles the success path redundantly — harmless, `setUser(null)` twice is a no-op the second
  time.)

**Tests**: new [lib/auth.test.js](lib/auth.test.js) (7 tests) — success path (awaits correctly, returns
no error, doesn't touch a session it didn't need to clear), scan-localStorage wipe on success (verifies
`bl_profile` is deliberately left alone, matching `clearScanLocalStorage()`'s existing contract), a
returned network error force-clearing the local `sb-*-auth-token` key, `supabase.auth.signOut()`
rejecting outright handled the same way, a hanging call resolving via the new timeout (driven with
`jest.useFakeTimers()`/`advanceTimersByTimeAsync()` rather than a real 6-second wait), the fallback
clearing only the `sb-*-auth-token` key pattern and leaving unrelated keys (including a
differently-shaped `sb-*-auth-token-code-verifier` key) untouched, and confirming the fallback does
**not** fire redundantly on the success path. `lib/supabase.js` is mocked so no real Supabase client is
constructed; `testEnvironment: 'node'` (project-wide, per `jest.config.js`) meant a minimal
`window`/`localStorage` stand-in had to be built via `global.window`/`global.localStorage` — the mock
had to specifically replicate real `localStorage`'s behavior of exposing stored keys as the object's
own *enumerable* properties (via `Object.defineProperties` with `enumerable: false` on the
Storage-interface methods), since `clearLocalSupabaseSession()` relies on `Object.keys(window.localStorage)`
to find what to remove — an earlier version of the mock that used plain method properties instead
caused `Object.keys()` to return method names instead of stored keys, silently defeating every
error-path assertion. Confirmed the tests are actually diagnostic, not just passing by construction: 4
of the 7 fail against the pre-fix `lib/auth.js` (checked via `git stash`) and all 7 pass against the
fix. Full suite: 1741 passing, 1 known pre-existing failure (the cross-list contradiction test from the
collision-word audit series, unrelated, unchanged).

**⚠️ Verified via unit tests only — no live browser click-through.** Reproducing this bug faithfully
requires a real, authenticated Supabase session plus a simulated network failure during the sign-out
call itself; the unit tests exercise the actual failure mechanism directly (mocking
`supabase.auth.signOut()` to reject/hang, matching the exact code path confirmed in the installed
`@supabase/auth-js` source) rather than attempting to fake that combination through the browser preview
tooling, which has no real Supabase credentials or a way to inject a network fault mid-request.
**Manual live sign-in/sign-out testing is still pending from the product side** — ideally exercised on
a slow or flaky connection, not fast wifi, since a fast connection won't exercise the failure path this
fix targets at all (only the always-safe success path). Do not consider this fix fully confirmed until
that manual pass has been done.

**Deploy status**: pushed to `origin/mvp-beta` as commit `1e049ed` on July 12, 2026. Confirmed deployed
(not just pushed) via GitHub's commit status API — the `Vercel` context shows `state: success`,
`description: "Deployment has completed"`, timestamped `2026-07-12T20:03:47Z`.

**No `PROMPT_VERSION` bump** — this is a client-side auth-session fix with no `analyzeIngredients()`
`flags`/`verdict`/`clearedBy` impact, and no `scan_cache` schema or contract change.

---

### Session — maskIgnoredIngredients() word-boundary fix: "cultured milk"/"unsalted butter"/"salted butter" silently missing conventional_dairy (July 2026)

Follow-up to an investigation session (report-only, no code changed) into a real-world verdict
inconsistency: two plain, non-organic dairy products — "Medium Cheddar" (barcode 072830005517,
`"CULTURED MILK, SALT, ENZYMES, ANNATTO (COLOR)"`) and "Semisoft Cheese"/Bel (barcode 041757026288,
`"PASTEURIZED CULTURED MILK, SALT, QUEST MICROBIAL ENZYMES..."`) — came back `verdict: 'yellow'` with a
completely **empty** `flags` array, while two structurally identical dairy products ("Whole Milk
Mozzarella," "Light String Cheese") correctly came back red with a `conventional_dairy` flag. That
investigation traced the divergence to `maskIgnoredIngredients()` (`lib/scanHelpers.js`) and confirmed
it as a real bug, not an intentional distinction — this session fixes it.

**Root cause**: `maskIgnoredIngredients()` masks every `ALWAYS_IGNORE_INGREDIENTS` term via plain
substring search with no word-boundary check. Bare `'culture'` is a literal 7-character substring of
`'cultured'` (`culture` + `d`) — masking it stripped `cultur` + `e` out of `"cultured milk"`, leaving
`"       d milk"`, which no longer contains the `MILK_DERIVED_INGREDIENTS` trigger `'cultured milk'` as
a contiguous substring. Same mechanism, different term: bare `'salt'` is a substring of
`'unsalted'`/`'salted'`, corrupting the `'unsalted butter'`/`'salted butter'` triggers identically. Both
silently suppressed `conventional_dairy` detection for any non-organic dairy product whose only dairy
signal was one of these phrases — confirmed directly: `containsMilkDerived()` returned `false` on the
masked text for all four corrupted phrases, `true` on the unmasked text.

**Step 0 — PROMPT_VERSION bump check, done before touching any code.** Queried `scan_cache` directly
(read-only, service-role key) for rows at `prompt_version = 42`: **zero rows found** — the table's full
distribution is `{40: 86}`, consistent with the already-documented deploy-without-purge state (no fresh
scans have landed since the v41/v42 code went live). Per explicit instruction, since no v42-cached data
exists yet to be silently invalidated by this fix, it ships folded directly into the current
`PROMPT_VERSION 42` — **no bump to 43**.

**Step 1 — full collision audit, not just the two known terms.** Cross-checked every
`ALWAYS_IGNORE_INGREDIENTS` term against every trigger phrase in every list actually consumed via
`maskIgnoredIngredients()`'s output (confirmed via grep of `pages/api/scan.js`: `MILK_DERIVED_INGREDIENTS`,
`MEAT_DERIVED_INGREDIENTS`, `FORTIFIED_VITAMINS`, `NATURAL_COLORANTS`, `MEAT_INGREDIENT_TERMS`, plus the
literal `'olive oil'` check — `allIngredientsPrefixedOrganic()` was confirmed to run on raw, unmasked
text and is out of scope). Found **7 total collisions**, split into two structurally different shapes:

| Term | Corrupts | Shape | Fixed by this change? |
|---|---|---|---|
| `culture` | `cultured milk`, `cultured pasteurized milk`, `cultured lowfat milk`, `cultured butter` (all `MILK_DERIVED_INGREDIENTS`) | letter-adjacent — embedded inside a larger word | ✅ yes |
| `salt` | `unsalted butter`, `salted butter` (`MILK_DERIVED_INGREDIENTS`) | letter-adjacent — embedded inside a larger word | ✅ yes |
| `yeast` | `selenium yeast` (`FORTIFIED_VITAMINS`, its *only* selenium trigger) | **bounded** — `yeast` is a genuine standalone word within the trigger, not embedded in a larger word | ❌ no — different bug shape, out of scope for a letter-adjacency fix; logged as its own item under "Pending Policy Decisions" |

The `selenium yeast` case is real and live (confirmed: `containsFortifiedVitamins()` returns `true` on
unmasked `"...selenium yeast..."`, `false` after masking) but a letter-adjacency boundary check can't
fix it — `yeast` legitimately stands alone there, the same way it legitimately stands alone as its own
ignorable ingredient everywhere else. Fixing it would need a different mechanism (e.g. excluding
`'selenium yeast'` from ever being masked, or checking that one trigger against unmasked text). Left
unfixed, per instruction, with a `test()` that documents the current (still-incorrect) behavior
explicitly rather than silently omitting coverage.

**Step 2 — the fix.** Added `isLetterAdjacentMatch(text, idx, term)` to `lib/scanHelpers.js`, mirroring
the boundary-check shape already established in `lib/rulesEngine.js`'s
`isAdjacentToLetterUnlessAllowlisted()` for the identical bug class on the trigger-matching side (see
the July 2026 collision-word audit series). `maskIgnoredIngredients()`'s matching loop now skips masking
any occurrence where the character immediately before or after is a letter, applied generally across
every `ALWAYS_IGNORE_INGREDIENTS` term — not a one-off carve-out for `culture`/`salt` — so any other
letter-adjacent collision (present or introduced later) is covered by construction. Confirmed genuinely
standalone occurrences (bare `"cheese culture"`, bare `"salt"`) are still masked exactly as before.

**Step 3 — tests.** New [lib/scanHelpers.test.js](lib/scanHelpers.test.js) (15 tests, this file's first
test coverage) — all 6 confirmed letter-adjacent collisions now correctly flag `conventional_dairy`
(`cultured milk`, `cultured pasteurized milk`, `cultured lowfat milk`, `cultured butter`, `unsalted
butter`, `salted butter`); the exact Medium Cheddar and Bel Semisoft Cheese production repro strings
(including the latter's garbled trailing OCR/packaging text, confirmed as a red herring — it doesn't
affect the outcome); regression guards confirming the already-working Whole Milk Mozzarella / Light
String Cheese cases are unaffected; regression guards confirming genuinely standalone `culture`/`salt`/
`cultures` are still masked correctly, including a string-edge-boundary case (term at the very start or
end of the text, where there's no adjacent character at all); and one test documenting the deliberately
unresolved `selenium yeast` finding, with an explicit comment instructing future sessions to update
(not silently delete) it if that gap is ever closed. Full suite: **1756 passing** (up from 1741), same
one known pre-existing failure (the cross-list contradiction test from the collision-word audit series,
unrelated, unchanged).

**PROMPT_VERSION**: stays at **42**, per the Step 0 finding above — no bump, no `scan_cache` purge
beyond what's already pending from the documented v41/v42 deploy-without-purge state. This fix changes
real `flags`/`verdict` output going forward (any non-organic dairy product whose only dairy signal is a
`cultured ___` or `un/salted ___` phrase now correctly gets `conventional_dairy` + red instead of a
false clean/yellow), but since it ships before any v42-stamped row exists, there's nothing already
cached under v42 that would need distinguishing from this fixed behavior.

**Confirmed pushed and deployed to production July 12, 2026** (not just committed). Before pushing,
`git fetch` + `git merge-base --is-ancestor origin/mvp-beta HEAD` confirmed a clean fast-forward with no
divergence — local `HEAD` (`ede48bf`) sat directly on top of `origin/mvp-beta`'s prior tip (`3fb6a2e`,
the sign-out-fix docs commit), and `git push --dry-run` showed a simple `3fb6a2e..ede48bf` fast-forward
before the real push ran. Pushed via `git push origin mvp-beta`; confirmed `origin/mvp-beta` moved to
`ede48bf` via a post-push `git fetch` + `git log`. Deploy confirmed via GitHub's commit status API (same
method used for every prior deploy check in this file) — the `Vercel` context for `ede48bf` shows
`state: success`, `description: "Deployment has completed"`, timestamped `2026-07-12T22:06:50Z`. A live
check of `beyond-labels-eight.vercel.app` immediately after confirmed the app loads normally (root `GET
/` → 200, all static assets 200, disclaimer/onboarding screen renders with real content, no console
errors) — not a full manual scan test, just confirmation the deploy didn't break the app. No
`scan_cache` purge was run or needed — Step 0 of the investigation that produced this fix already
confirmed zero rows exist at `prompt_version = 42`, so there was nothing stale to invalidate.

---

### Session — ConcernCard rules-engine summary fallback + explanation-failure observability logging (July 2026)

Follow-up to the "Nutty Buddy Creme Pies" investigation (barcode 024300043130, report-only, no code
changed) into a `scan_cache` row with `explanation: null` and 7 flagged categories — the only
null-explanation row in the entire table, and the only row above 5 categories. That investigation
confirmed the `null` degradation itself is working as designed (not a regression to the old
raw-JSON-leak bug), but surfaced two real, independent gaps: (1) `ConcernCard` renders nothing at all
for a category when the AI explanation is missing, even though the rules engine already generates a
perfectly good plain-language `flag.summary` for every flag, sitting unused in the same `scan_cache`
row; (2) three structurally different failure causes (missing API key / thrown exception / genuinely
unparseable response) all silently collapse into the same `explanation: null`, with no way to tell
them apart after the fact — that gap is exactly why the investigation could confirm the fix was
*working* but couldn't confirm *why* this specific row failed. This session closes both. Neither
touches verdict/flags/explanation-generation logic — display and logging only.

**Part 1 — `components/verdict/ConcernCard.jsx`.** Added `getFallbackSummary(flags)`, exported at
module scope (same "extract for testability" pattern as `SwapsScreen.jsx`'s `FLAG_CATEGORY_MAP` — this
project has no React rendering test infrastructure). Returns the **first** flag's `.summary`, not one
paragraph per matched ingredient — a category like `conventional_crops` can carry a dozen-plus flags
whose summaries are the same template sentence with only the ingredient name swapped (confirmed
directly from the Nutty Buddy row's real data), so stacking all of them would read as repetitive noise.
One representative sentence in the same single-paragraph slot the AI explanation normally occupies
matches how the *working* AI explanation already behaves (one category-level explanation, not one per
ingredient) — the ingredient chips above the text already list every matched ingredient regardless.
`ConcernCard` now computes `displayExplanation = explanation || getFallbackSummary(flags)` and renders
that instead of the raw `explanation` prop. Because `VerdictScreen.jsx` already passes
`explanation?.details?.[cat]` (not the whole `explanation` object) into `ConcernCard`, this single
change correctly covers both failure shapes named in the task — the whole AI explanation being `null`,
and the whole explanation succeeding but one specific category's `details` entry being absent — without
any special-casing, since both collapse to the same falsy `explanation` prop from `ConcernCard`'s point
of view.

**Part 2 — observability logging, `fetchExplanation()` (`pages/api/scan.js`) and the standalone
`pages/api/explain.js` handler.** Added `console.error` at each of the three failure points, using this
codebase's existing `[scan]`/(new) `[explain]` log-prefix convention:
- Missing API key: `'[scan] explanation fetch: missing API key'` / `'[explain] explanation fetch: missing API key'`
- Any thrown exception: `'[scan] explanation fetch: API error:', err` / `'[explain] explanation fetch: API error:', err`
- Unparseable/truncated response: `` `[scan] explanation fetch: unparseable response, category count: ${N}, flag count: ${M}` `` (same shape for `[explain]`) — the raw Claude response text is never logged, only the counts. Category count is computed via `new Set(flags.map(f => f.category)).size`, not the raw flag count, since the working theory (category count driving truncation risk, not flag count) is specifically what this logging exists to confirm or rule out going forward.

Console output only — nothing added to any `scan_cache` upsert or any other DB write, per instruction.

**Tests — net +16, reconciled**: `__tests__/components/ConcernCard.test.js` (new file, **+10**) — direct
unit tests of `getFallbackSummary()` (single flag, multiple flags returning only the first and not a
joined/repeated list, missing/empty `summary` field, empty/undefined `flags`) plus the
`explanation || getFallbackSummary(flags)` selection logic mirrored from the component (AI explanation
present is never overridden by the fallback; AI explanation missing falls back correctly; the
whole-object-null vs. single-category-missing scenarios are confirmed to hit the identical code path).
`__tests__/api/scan.test.js` Suite T (**+3**: T5–T7) and `__tests__/api/explain.test.js` Suite C
(**+3**: C5–C7) — each confirms the exact log message and argument for all three failure causes,
including a deliberately-crafted 4-flags/3-categories fixture (trans_fats ×1, seed_oils ×2,
conventional_crops ×1) proving the category count is a real `Set`-based dedup, not just the flag count
relabeled. 10 + 3 + 3 = 16, matching 1756 → **1772 passing** exactly. Same one known pre-existing
failure (the cross-list contradiction test from the collision-word audit series, unrelated, unchanged).

**No `PROMPT_VERSION` bump** — confirmed no `analyzeIngredients()` `flags`/`verdict`/`clearedBy` impact;
this is a rendering fallback plus console-only logging, nothing persisted differently to `scan_cache`.

**Confirmed pushed and deployed to production July 12, 2026** (not just committed). Before pushing,
`git fetch` + `git merge-base --is-ancestor origin/mvp-beta HEAD` confirmed a clean fast-forward with no
divergence — local `HEAD` (`ed85fc0`) sat directly on top of `origin/mvp-beta`'s prior tip (`b54ebe7`,
the maskIgnoredIngredients deploy-status docs commit), and `git push --dry-run` showed a simple
`b54ebe7..ed85fc0` fast-forward before the real push ran. Pushed via `git push origin mvp-beta`;
confirmed `origin/mvp-beta` moved to `ed85fc0` via a post-push `git fetch` + `git log`. Deploy confirmed
via GitHub's commit status API (same method used for every prior deploy check in this file) — the
`Vercel` context for `ed85fc0` shows `state: success`, `description: "Deployment has completed"`,
timestamped `2026-07-12T22:33:52Z`.

Live-checked `beyond-labels-eight.vercel.app` immediately after: confirmed the app loads normally, then
went further than a basic load check — used the manual "Enter Barcode" entry (no camera needed) to
scan barcode `024300043130` ("Nutty Buddy Creme Pies") directly, the exact product this whole session's
fix was built around. The verdict screen rendered correctly (red "AVOID", all 7 concern cards, correct
ingredient chips), and expanding the `conventional_crops` card showed its real AI-generated explanation
text — confirming the normal (non-fallback) `ConcernCard` path is unaffected by this session's change.
**One notable, unplanned finding from this check**: the re-scan did NOT reproduce the original
`explanation: null` state — Claude's fresh call succeeded this time, generating a complete
`explanation.details` entry for all 7 categories. This happened because the cached row was stale
relative to the live `PROMPT_VERSION` (the row was written at `prompt_version: 40`, live is `42`), so
the read was treated as a cache miss and `scan.js` re-fetched from Open Food Facts and re-ran the
Claude call fresh (`source: 'open-food-facts'` in the response, not `'cache'`) rather than serving the
stale cached row — meaning `scan_cache` reads **are** version-gated on read, not just relying on the
documented manual purge, a detail worth remembering for future investigations that assumed otherwise.
Net effect: the specific null-explanation fallback UI could not be directly observed live in this
check, since production no longer has a reproducible null case for this barcode — but the fallback
logic itself was already verified by the 16 new unit tests (10 specifically for `getFallbackSummary()`
and the `explanation || getFallbackSummary(flags)` selection logic), and this live check positively
confirms the deploy didn't break the surrounding rendering path.

No `scan_cache` purge was run — not needed, this change doesn't touch verdict/flags/explanation-generation
data, only how existing data renders and is logged.

---

## Golden Master Snapshot (L1/L2 Unification Project — Stage 1)

The rules engine (`lib/rulesEngine.js`) and the L1/L2 post-processing logic in `pages/api/scan.js`
have grown into two separate layers of decision logic that duplicate similar concepts (severity
levels, clearance mechanisms, category checks) in two different places. A future session is
planned to unify them into a single decision layer. Before that refactor begins, this session
captured a **golden master snapshot** — a frozen record of the app's exact CURRENT input/output
behavior (bugs included, not fixed) — so the refactor can be verified against real present-day
behavior instead of against what CLAUDE.md merely claims the behavior should be.

**Location**: `scripts/goldenMaster/`
- `generateInputs.js` — generates 135 test cases (`{ ingredientText, productLabels, categoriesTags,
  productName, userLevel }`) covering every flag category at both user levels, every clearance
  mechanism, seafood/game-meat/conventional-meat routing, the four special verdict paths (pure-water,
  cert_unconfirmed, inconclusive, default-yellow/Node 14), 12 specific historical bug-fix regressions
  (macadamia, Product of Canada, goat milk, licorice, cowpeas, oat groats, sweetcorn, etc.), text
  preprocessing edge cases (allergen advisory stripping, purpose-note parentheticals, "-free"/"non-"
  contexts, FD&C "No." normalization), and several multi-flag-category products for interaction
  effects. Run with `node scripts/goldenMaster/generateInputs.js` → writes `inputs.json`.
- `inputs.json` — the generated 135 cases (committed, since it's the traceable Step-1 artifact —
  regenerating it isn't guaranteed to produce byte-identical output if the source data it pulls real
  fixture strings from ever changes).
- `captureSnapshot.js` — runs every case in `inputs.json` through the real, unmodified
  `pages/api/scan.js` handler (real `analyzeIngredients()` call, real L1 override block, real L2
  tree — not a hand-ported duplicate, to avoid transcription drift) and records `verdict`, `flags`,
  `clearedBy`, `unverifiedIngredients`, `isMeat`, `oliveCaveat`, `unverifiedReason`, and
  `productCategory` for each. **Must be run through Jest, not plain `node`** — `scan.js` uses ESM
  `import`/`export` syntax that only Next.js's bundler or Jest's `next/jest` transform can parse; a
  bare `node`/`require()` fails with `ERR_MODULE_NOT_FOUND`. Run with:
  ```
  npx jest --testMatch "**/scripts/goldenMaster/captureSnapshot.js" --runInBand
  ```
  The `--testMatch` override is CLI-only for this one invocation — `jest.config.js` itself is not
  modified. No real Supabase or Anthropic calls occur (`SUPABASE_SERVICE_ROLE_KEY`/`ANTHROPIC_API_KEY`
  are never set under Jest, so both short-circuit to `null`/no-op as they already do in the existing
  test suite).
- `snapshot-baseline.json` — the frozen output (135 entries, ~134KB). This is the ground truth the
  refactor will be diffed against.

**⚠️ This file captures current behavior AS-IS** — it is deliberately not "corrected" before being
frozen. The point of Stage 1 is a faithful snapshot of what the app does today, not what it should do.
The Node 7 non-gmo-project-verified bug found during the original spot-check (see below) has since
been fixed at PROMPT_VERSION 39, and the snapshot was **regenerated once, intentionally**, to reflect
that fix — see "Snapshot regeneration log" below. Two related, still-unfixed findings from that same
fix session's audit (Node 4 and Node 6 sharing the identical unconditional-override shape) remain
live in this snapshot, pending a separate decision — see the PROMPT_VERSION 39 changelog entry above
for details.

**Regeneration rule**: if pre-refactor behavior is ever intentionally changed for an unrelated reason
(e.g. another bug fix session, per the ongoing collision-word audit series) before the L1/L2
refactor lands, **regenerate `snapshot-baseline.json` by re-running `captureSnapshot.js`** — do not
hand-edit the JSON file. A hand-edited snapshot defeats its own purpose as an independent ground-truth
check.

### Snapshot regeneration log

- **July 2026 (PROMPT_VERSION 39 session)** — regenerated after the Node 7 non-gmo-project-verified
  reject-flag gate fix (see the PROMPT_VERSION 39 changelog entry above). This is the one exception to
  "capture behavior as-is, bugs included": the bug this regeneration corrects for was found *by* the
  Stage 1 spot-check itself, was fixed in the same session per explicit instruction, and leaving the
  baseline frozen on the pre-fix (buggy) output would have meant Stage 2's refactor got verified
  against behavior everyone already agreed was wrong. `clear-non-gmo-bioengineering-l2` now correctly
  shows `verdict: 'red'`, `clearedBy: null`, with the `bioengineering` reject flag intact — confirmed
  directly against the regenerated `snapshot-baseline.json`. No other entries changed as a side effect
  (the fix only narrows Node 7's own condition; every other case's routing was independently
  reconfirmed by the passing test suite, not just assumed).

### Golden Master spot-check findings (Stage 1, July 2026)

Spot-checked 28 entries from the snapshot against CLAUDE.md's documented decision-tree logic. All
matched documented behavior except one, which has since been fixed (see "Snapshot regeneration log"
above):

**`clear-non-gmo-bioengineering-l2`** (input `"Bioengineered ingredient, salt, water."` +
`en:non-gmo-project-verified` label) returned `verdict: 'yellow'`, `clearedBy:
'non-gmo-project-verified'`, but `flags` still contained a `severity: 'reject'` `bioengineering` flag.
Node 7 (`non-gmo-project-verified` label → YELLOW) fired unconditionally on the label alone with no
check for a pre-existing reject-severity flag, and nothing stripped the flag afterward — the same bug
shape already found and fixed once for Node 5's wild-caught clearance at PROMPT_VERSION 29. **Fixed at
PROMPT_VERSION 39** — see that changelog entry above for the full root cause, fix, and the audit of
every other L2 tree node for the same shape (which surfaced two more unfixed instances at Node 4 and
Node 6, reported there pending a separate decision).

### Known coverage gaps (Stage 4, July 2026) — deferred, NOT a Stage 1 regeneration trigger

Stage 4's shadow-mode comparison (see "Session — L1/L2 unification Stage 4" below) identified two
gaps in the current 135-case input set. Both are flagged for a **future Stage 1 supplement** (adding
new cases) — **neither requires regenerating the existing 135 cases or re-running
`captureSnapshot.js`**; the current snapshot is still accurate for everything it covers, it simply
doesn't cover these two scenarios yet:

1. **No case tests bioengineering's remaining clearance path.** After the Stage 4 revision that
   removed non-gmo-project-verified as a clearance mechanism for `bioengineering` (see
   `DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded` in `lib/verdictRules.js`), the only clearance
   mechanisms left are the `usda-organic` label and an organic ingredient prefix — and no golden-master
   case combines a bioengineering disclosure with either one.
2. **No case tests "game meat + a separate reject-severity flag present at the same time."** The two
   existing game-meat cases (`meat-game-l1`/`meat-game-l2`) both use a single clean fixture
   (`"venison, water, salt"`) with zero flags in either category — so the actual discriminating
   behavior of the gated-green correction (`DESIGN_DECISIONS.correctedGameMeatGatedGreenAtL2`) —
   leaving a real reject flag alone instead of discarding it — has never been exercised by a real case.

**Closed by direct unit fixtures, not by a golden-master supplement — see "Session — L1/L2
unification Stage 5c" above.** Both scenarios are now covered by dedicated tests in
`lib/verdictEngine.test.js` (6 new fixtures, added as a Stage 5c prerequisite per an explicit
2026-07-11 decision to close these now rather than defer them again). **Precision on what changed and
what didn't**: the 135-case golden-master input set itself (`scripts/goldenMaster/inputs.json`) was
**not** modified — neither gap listed above is technically untrue as a statement about that specific
file, and the "future Stage 1 supplement" described below remains a valid, still-open piece of
optional cleanup if someone wants the golden-master set itself to also carry these cases for its own
completeness. What changed is the broader claim this note used to make: it is no longer accurate to
say these two scenarios are "genuinely untested by real traffic or by any test" — they are now
directly, deterministically tested, independent of whether real production traffic ever happens to
produce a matching product. Roughly 100 real production shadow-mode scans (see "Stage 5b —
real-traffic review" above) still produced zero divergence rows for either scenario, so real traffic
still hasn't confirmed either — but that no longer matters the way it did before Stage 5c, since the
behavior is now pinned down by fixtures instead of waiting on real-world occurrence.

---

## Unified Verdict Rule Table (L1/L2 Unification Project — Stage 3)

**Location**: [lib/verdictRules.js](lib/verdictRules.js), tested by [lib/verdictRules.test.js](lib/verdictRules.test.js).

**What it is**: a standalone data structure — one entry per flag category (all 14: `trans_fats`,
`seed_oils`, `conventional_crops`, `bioengineering`, `natural_flavors`, `additives`,
`glyphosate_heavy`, `gluten_grains`, `conventional_eggs`, `conventional_meat`, `conventional_dairy`,
`fortified_vitamins`, `natural_colorants`, `olive_oil_adulteration`) — plus cross-cutting rules that
don't fit a per-category shape (instant-red priority tier, gluten-strip mechanism, cert_unconfirmed,
pure-water path, inconclusive-verdict check, the `oliveCaveat` side effect, shared input signals) and
a design-decisions log. It is the design output of Stage 2 (a full report reading `pages/api/scan.js`
and `lib/rulesEngine.js` line-by-line and cataloguing every place L1 and L2 disagree) and Stage 3
(this table), built toward eventually replacing the two separately-evolved L1-override/L2-tree code
paths with one unified system.

**⚠️ NOT YET CONNECTED TO LIVE TRAFFIC.** This file is imported by nothing in production —
`pages/api/scan.js` does not reference it (enforced by a drift-guard test in
`lib/verdictRules.test.js` Suite J). It exists purely as a reviewed, tested source of truth for a
future cutover session.

**⚠️ Deliberately disagrees with today's live `scan.js` in three places — this is intentional, not
a bug in the table.** Per explicit instruction, three rows encode CORRECTED target behavior instead
of transcribing what `scan.js` currently does, so the eventual cutover fixes these by construction
rather than needing a separate patch first:

1. **`bioengineering`** — the table gives it organic-label and organic-ingredient-prefix clearance
   (matching `conventional_eggs`/`glyphosate_heavy`'s narrower pattern, **not** `conventional_crops`'s
   fuller organic-or-non-gmo pattern). Today's live `lib/rulesEngine.js` has **no** such clearance for
   this category at all, which is the root cause of the live L2 Node 4 bug (a `usda-organic`-labeled
   product with a bioengineering disclosure gets a false GREEN, silently discarding the reject flag).
   **Revised after Stage 4 shadow-mode review** (see "Session — L1/L2 unification Stage 4" below):
   `non-gmo-project-verified` was granted clearance in the original Stage 3 draft, then deliberately
   removed — reasoning in `DESIGN_DECISIONS.bioengineeringNonGmoLabelExcluded`.
2. **`conventional_meat`** — the table gives game-meat detection a **gated green** at L2 (green only
   if no pre-existing reject-severity flag is present; a real reject flag is left alone, not
   discarded), mirroring the existing wild-caught Node 5 pattern exactly. Today's live L2 Node 6
   unconditionally overrides verdict to GREEN with no reject-flag gate at all — the same bug shape
   already fixed for Node 5 (PROMPT_VERSION 29) and Node 7 (PROMPT_VERSION 39), but never fixed at
   Node 6. **Revised after Stage 4 shadow-mode review**: the original Stage 3 draft modeled this as a
   full no-op removed from the priority chain entirely, which turned out to have an undecided side
   effect — see `DESIGN_DECISIONS.correctedGameMeatGatedGreenAtL2`.
3. **`conventional_eggs`** — the table gives it strict priority over the generic `conventional_meat`
   injection at both levels. Today's live L2 Node 8 (conventional meat) fires before Node 8b
   (conventional eggs) for any OFF-tagged egg product, and the equivalent ordering gap exists in the
   L1 override too — see the Stage 2 report for the full mechanism.

**One intentional non-fix, documented not applied:** `conventional_eggs` is deliberately **not**
cleared by `non-gmo-project-verified` in the table, unlike `conventional_crops` — reasoning captured
directly in `DESIGN_DECISIONS.intentionalEggsNonGmoExclusion`: Non-GMO Project Verification is
fundamentally a crop-genetics certification; applied to eggs it's really a claim about hen feed, a
materially narrower/different claim than what the label means on a plant crop.

**One dead-code note, not carried forward:** today's live L2 tree has a post-waterfall step that
strips any surviving `conventional_crops` flag when `clearedBy==='organic'`. Stage 2 traced every
`clearedBy` assignment and believes this line is unreachable given `conventional_crops`'s existing
engine-level organic clearance — but wasn't asserted with total certainty. It is **not** represented
anywhere in the table (per explicit instruction — the table only encodes active, real rules); the
reasoning and a reminder to double-check before deletion live in
`DESIGN_DECISIONS.deadCodePostTreeConventionalCropsStrip` for whoever eventually retires the old
`scan.js` L2 tree.

**If you land in this file confused about why it "disagrees" with `scan.js`: it's supposed to.**
Do not try to reconcile the table to match live `scan.js` — the divergences are the point. Each
diverging row has `level2.divergesFromLiveScanJs: true` with a `divergenceReason` explaining exactly
what changed and why; `lib/verdictRules.test.js` has a dedicated sanity-check test
(`CORRECTION #1 — today's live rulesEngine.js truly has no such clearance`) that calls the real
engine directly to confirm the divergence is still real and hasn't been separately fixed elsewhere in
the meantime.

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
- **bare `'yeast'` corrupts the FORTIFIED_VITAMINS trigger `'selenium yeast'`** (found during the July 2026 `maskIgnoredIngredients()` word-boundary audit — see "Session — maskIgnoredIngredients() word-boundary fix" below): unlike the `culture`/`salt` collisions fixed in that session, `'yeast'` occurs as a genuine standalone word within `'selenium yeast'` (bounded by a space, not embedded inside a larger word) — so the letter-adjacency boundary check doesn't and shouldn't protect it; masking `'yeast'` there is "correctly" behaving per that check's own rule, just wrong for this one specific compound trigger. `'selenium yeast'` is FORTIFIED_VITAMINS's *only* selenium-related trigger (confirmed via grep — no bare `'selenium'` fallback), so this is a real, live information-loss bug: an organic product listing "selenium yeast" as a fortification ingredient silently fails to get the `fortified_vitamins` caution flag. Confirmed via direct testing (`containsFortifiedVitamins()` returns `true` on unmasked text, `false` after masking). Needs its own decision — options include excluding `'selenium yeast'` specifically from ever being masked, or having `containsFortifiedVitamins()` check against unmasked text for just this trigger — before implementing, since either approach has its own trade-offs worth reviewing first.

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
