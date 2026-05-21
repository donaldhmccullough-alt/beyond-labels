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
  rulesEngine.test.js     — Jest tests for rules engine (25 describe blocks; 709 tests total; block 20 = SYNTHETIC_ADDITIVES bucket-1 expansion (91 tests); block 21 = FD&C "No." normalization (19 tests); block 22 = mechanically separated meat (3 tests); block 23 = interesterified variants, lake forms, dye synonyms, new E-numbers, stearyl emulsifiers, cyclamate (78 tests); block 24 = synonym/E-number expansion: nitrates, BVO, bleaching agents, BHA/BHT names, SLS, E-numbers e320/e321/e924/e950–e955 (50 tests); block 25 = gluten grains expansion: ancient grains, botanical names, asafoetida/hing, smoke flavoring, brown rice syrup (34 tests))
  __tests__/api/scan.test.js — Jest integration tests for /api/scan handler (8 suites A–H; suite H = block 26: meat verdict logic, isMeatProduct detection, L2 organic requirement, L1 no-op — 13 tests)
  certifications.js       — checkUsdaOrganicCertification(labelsDetected) + checkNonGMOProject(labelsDetected); both use OFF labels_tags via normalizeLabelTags()
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

**All of SYNTHETIC_ADDITIVES** (every item stays red for both levels):
caramel color, sodium benzoate, potassium bromate, sodium nitrate, sodium nitrite,
monosodium glutamate, msg, disodium inosinate, disodium guanylate,
artificial flavors, artificial colour, artificial color, artificial flavor,
flavor enhancer, flavor base, flavouring, flavor,
sucralose, aspartame, acesulfame potassium, acesulfame-k, ace-k, saccharin,
neotame, advantame, steviol glycoside, stevia extract, rebaudioside, reb-a,
interesterified palm oil, interesterified soybean oil, interesterified oil, interesterified fat,
carrageenan, titanium dioxide, propyl gallate, octyl gallate, dodecyl gallate,
propylene glycol, acetylated monoglycerides, emulsifiers, acidity regulators,
anticaking agent, antioxidant, silicon dioxide, nisin preparation, ferrous sulfate,
mono- and diglycerides, mono and diglycerides, mono - and diglycerides, monoglycerides, diglycerides,
glycerol monostearate, glyceryl monostearate, glycerol, humectants, hydrolyzed corn protein,
folic acid, niacinamide, niacin, potassium phosphate,
thiamine mononitrate, thiamin mononitrate, thiamin mononitrite, riboflavin, reduced iron,
sodium alginate, sodium caseinate, sodium citrate, sodium diacetate, sodium phosphate, sorbic acid,
potassium benzoate, benzoic acid, potassium sorbate, calcium propionate, sodium propionate,
propionic acid, potassium nitrate, potassium nitrite, cyclamate, sodium cyclamate, natamycin, stannous chloride,
sulfur dioxide, sodium bisulfite, sodium metabisulfite, sodium sulfite,
potassium bisulfite, potassium metabisulfite, sulfites,
calcium disodium edta, disodium edta, tetrasodium edta,
sodium stearoyl-2-lactylate, sodium stearoyl lactylate, calcium stearoyl-2-lactylate,
sodium stearyl fumarate, stearyl tartrate,
salatrim, succistearin, sucroglycerides,
methylparaben, ethylparaben, propylparaben, butylparaben, heptylparaben,
yellow 5, yellow 5 lake, yellow 6, yellow 6 lake,
red 40, red 40 lake, blue 1, blue 1 lake, blue 2, blue 2 lake, green 3, green 3 lake,
brilliant blue fcf, fast green fcf, sunset yellow, tartrazine, allura red, indigotine, orange b,
tbhq, bha, bht,
red 3, red 3 lake, red 4, carmine, cochineal, erythrosine, iron oxide,
canthaxanthin, citrus red 2,
soy leghemoglobin, insect flour, ethyl vanillin, vanillin,
mechanically separated meat,
e102, e110, e127, e129, e132, e133, e143, e161g, e171,
e319, e330, e339, e388, e471, e472a, e472b, e472e, e476, e483, e485, e487, e500,
colorante amarillo 6, colorante artificial rojo 40,
jarabe de maíz de alta fructosa, aceite de palma y/o karité, aceite de palma y/o palmiste,
soya lecithin

### Level rules — YELLOW for Level 1, RED for Level 2
**Seed oils** (SEED_OILS array — trans fats are in a separate TRANS_FATS array):
high oleic sunflower/canola/safflower oil, high oleic soybean oil, high oleic soybean,
canola, canola oil, soybean oil, corn oil, sunflower oil, safflower oil,
cottonseed, cottonseed oil, grapeseed oil, rice bran oil, vegetable oil, palm oil,
rapeseed oil, peanut oil, mustard seed oil, palm kernel oil, palm olein,
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
const { analyzeIngredients, LEVEL_1_YELLOW_CATEGORIES, applyLevel2VerdictOverlay,
        SYNTHETIC_ADDITIVES_L1_YELLOW } = rulesEngine;

analyzeIngredients(ingredientText, productLabels, userLevel = 2)
// Returns: {
//   verdict:               'red'|'yellow'|'green'|'unverified',
//   flags:                 Flag[],
//   clearedBy:             string|null,
//   unverifiedIngredients: string[]
// }

LEVEL_1_YELLOW_CATEGORIES
// Set<string> — {'seed_oils', 'conventional_crops', 'bioengineering', 'natural_flavors', 'synthetic_additives'}
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
6. **SYNTHETIC_ADDITIVES** — always red at both levels; no clearance; expanded with ~200 additional EU n/n triggers. Category string: `'synthetic_additives'`. Includes lake dye forms (e.g. `yellow 5 lake`), chemical name synonyms (e.g. `tartrazine`, `allura red`), 22 E-numbers, stearyl ester emulsifiers, bare `cyclamate`, and a **"Processing methods"** section: `mechanically separated meat`. Two entries (`interesterified palm oil`, `interesterified soybean oil`) are matched in a **`PRIORITY_ADDITIVES` pre-pass** before SEED_OILS to prevent seed-oil sub-triggers (`palm oil`, `soybean oil`) from claiming the overlapping suffix and blocking the longer compound match.
7. **SYNTHETIC_ADDITIVES_L1_YELLOW** — Level 2: red; Level 1: yellow; ~60 entries from Sina's EU review (natural colors, food acids, hydrocolloids, waxes, enzymes). Category string: `'synthetic_additives'`.
8. **GLUTEN_GRAINS** — soft flag (caution/yellow only at both levels). Category string: `'gluten_grains'` (not `'gluten'`).
   - **Flags every match**, not just the first — a product with wheat flour, oats, and barley malt gets three separate `gluten_grains` flags.
   - **Bypasses the claiming system entirely** — runs `findMatches(text, GLUTEN_GRAINS, [])` with an empty blocked-ranges list, so no prior category can suppress a grain match. Prolamin protein is an independent concern from pesticide exposure, bioengineering, or seed-oil content.
   - Organic/Non-GMO clearance does **not** suppress GLUTEN_GRAINS flags — organic wheat is still a prolamin concern.
   - **Broader prolamin definition**: rice entries (`whole grain brown rice flour`, `rice flour`, `rice`, etc.) are included because rice prolamins (oryzin) can trigger sensitivity in celiac and non-celiac gluten-sensitive individuals. Added `whole grain brown rice flour` (shadows `rice flour` and `brown rice` at the same position). Also added `malt flavor` to the barley/malt section.
   - **Two false-positive filters** applied per match before a flag is emitted:
     1. `isPrecededBySourceNote()` — skips grains that appear in source-disclosure parentheticals, e.g. "maltodextrin (made from corn)" does not flag "corn".
     2. `isOilDerivative()` — skips a grain word immediately followed by ` oil` (e.g. "corn" inside "corn oil"). Refined oils carry no meaningful prolamin and are already covered by SEED_OILS.

### Verdict logic
- Any hard reject (`severity: 'reject'`) → `'red'`
- No hard rejects + soft flags (`severity: 'caution'`) → `'yellow'`
- Nothing → `'green'`
- Empty/null ingredients → `'unverified'`

### Level 2 verdict overlay (lib/certifications.js + scan.js)

For `userLevel === 2`, `scan.js` applies an allowlist overlay **after** `analyzeIngredients()` via `applyLevel2VerdictOverlay()` from `lib/rulesEngine.js`:

| Condition | L2 verdict | `clearedBy` |
|-----------|-----------|-------------|
| Any L1 flag (reject or caution) | `red` | from L1 analysis |
| No L1 flags + USDA organic label | `green` | `'usda-organic'` |
| No L1 flags + Non-GMO label | `yellow` | `'non-gmo-project'` |
| No L1 flags + no certification | `red` | `null` (conventional = assumed risk) |

**`lib/certifications.js`** — two label-check helpers called from `scan.js`:
- `checkUsdaOrganicCertification(labelsDetected)` — returns `true` if `'usda-organic'` is in the normalised OFF labels array.
- `checkNonGMOProject(labelsDetected)` — returns `true` if `'non-gmo-project-verified'` is in the array.

**Limitations**:
- OFF labels are user-contributed; coverage is good but not authoritative.
- `checkNonGMOProject` is live using OFF label data. Direct Non-GMO Project data partnership pending.
- `checkUsdaOrganicCertification` uses OFF label data. USDA OData API confirmed retired May 2026; replacement REST API returns empty results — not accessible at current api.data.gov key tier.

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
- `category` column uses one of the 8 exact values

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
  - `product_name`, `product_category` (text|null), `last_accessed_at`
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
- Returns: `{ verdict, flags, clearedBy, productName, ingredients, barcode, source, found, labelsDetected, unverifiedIngredients, explanation, productCategory, unverifiedReason }`
- `productCategory`: one of the 9 swap categories or `null` if no OFF tag matched
- `unverifiedReason`: distinguishes why a scan returned `verdict: 'unverified'`:
  - `'not_found'` — barcode not in the Open Food Facts database (`found: false`)
  - `'no_ingredients'` — product record exists in OFF but has no ingredient text (`found: true`)
  - `null` — verdict is red / yellow / green (not unverified)
- Claude is never called when `verdict === 'unverified'` — no ingredients to explain
- VerdictScreen renders a human-readable message card for unverified results (keyed on `unverifiedReason`) instead of the AI summary, and shows a "Scan Again" button instead of "See Cleaner Swaps"
- Uses `supabaseServer` (service role key) for all Supabase writes

### POST /api/explain
- Body: `{ verdict, flags, productName, ingredients, userLevel?: 1 | 2 }`
- Calls Claude Sonnet with Sina-Joel voice system prompt
- Returns: `{ summary: string, details: { [category]: string } }`
- Exports `SYSTEM_PROMPT`, `buildUserMessage`, `PROMPT_VERSION` for use by `scan.js`
- VerdictScreen skips this endpoint when `scanResult.explanation` is already populated (cache hit or fresh scan)
- **System prompt voice**: Sina McCullough (PhD Nutrition, autoimmune healing journey, science-first, rhetorical questions, inflammation/gut/gene-expression framing) + Joel Salatin (Polyface Farm, story-and-analogy thinker, farming-system angle). Together: empowering, not alarmist, skeptical of GRAS and industry-funded science.
- **Level-aware tone**: Level 1 users get encouragement and awareness-building framing; Level 2 users get direct, graduate-level honesty. Controlled by `[Level 1 awareness item]` note injected per flagged category in `buildUserMessage()`.
- **Current PROMPT_VERSION**: `3`

### GET /api/swaps
- Query params: `category` (one of 9 valid values, optional), `userLevel` (1 or 2, defaults to 2)
- Flow: check in-memory cache (1hr TTL) → fetch Google Sheet CSV if stale → filter by category → filter/tag by swap_level → shuffle → slice to 3 per tier → AI fallback if 0 results
- Returns: `{ swaps: SwapRow[], source: 'curated' | 'ai' }`
- Each swap row includes `tier: 'good' | 'better'` — used by SwapsScreen to render sections
- AI fallback prompt is level-aware — Level 2 requires certification + no seed oils; Level 1 requires no synthetic additives only

---

## Scan Cache Pattern

`lib/cacheVersion.js` exports `PROMPT_VERSION` (integer). This is the single source of truth — import it from here, never from an API route file.

To invalidate the cache after a prompt change:
1. Bump `PROMPT_VERSION` in `lib/cacheVersion.js`
2. Run the SQL from `getCacheInvalidationSQL(newVersion)` in `lib/cacheUtils.js` against the Supabase DB

Cache lookup is keyed on `(barcode, user_level, prompt_version)` — changing the user's level or bumping the prompt version both trigger a fresh Claude call and cache re-population.

**Current PROMPT_VERSION is 3.**

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

### Session — level-aware swaps system
| Hash | Description |
|------|-------------|
| `f302c69` | feat: randomize swap selections so users see variety across sessions |
| `b70adad` | fix: exact OFF tag matching for product category, flag-based fallback for unrecognized barcodes |
| `8f58aaa` | feat: level-aware swaps — product category mapping, Good/Better tiers, 8 categories |

### Session — SB 25 synthetic additives expansion
| Hash | Description |
|------|-------------|
| `66c781c` | feat: add 18 Texas SB 25 chemicals to SYNTHETIC_ADDITIVES + 36 tests |

### Session — meat verdict logic
| Hash | Description |
|------|-------------|
| `e394a6a` | feat: meat verdict logic — L2 requires organic cert, custom unverified messaging by level |

### Session — rules engine gluten grains + brown rice syrup expansion
| Hash | Description |
|------|-------------|
| `a94f61a` | feat: rules engine — gluten grains expansion (ancient grains, botanical names, asafoetida, teff, sorghum, smoke flavoring) + brown rice syrup |

### Session — rules engine synonym/E-number expansion
| Hash | Description |
|------|-------------|
| `(see git log)` | feat: rules engine — synonym/E-number expansion (nitrates, BVO, bleaching agents, BHA/BHT names, SLS, dye synonyms) |

### Session — prompt update, cache write fix, code quality
| Hash | Description |
|------|-------------|
| `82705a0` | fix: await Supabase writes before res.json() to prevent Vercel truncation |
| `db6b419` | feat: updated Sina/Joel system prompt, bumped PROMPT_VERSION to 2 |
| `83c73bc` | Consolidate duplicated code: scanHistory utils and LEVEL_1_YELLOW_CATEGORIES |
| `32f793d` | Use service role key for server-side Supabase writes |

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
- Do not add new swap categories without updating `VALID_CATEGORIES` in `pages/api/swaps.js` and `CATEGORY_TAG_MAP` in `pages/api/scan.js` (current 9 categories: `chips`, `snacks`, `cereal`, `condiments`, `beverages`, `dairy`, `bread`, `frozen`, `cooking_oils`)
