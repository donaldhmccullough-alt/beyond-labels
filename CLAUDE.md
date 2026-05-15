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
    LevelSelectScreen.jsx — two-card level picker (NEW — current first onboarding step)
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
    SwapsScreen.jsx       — product swap suggestions
    SwapCard.jsx
  shared/
    BottomNav.jsx         — 4-tab nav: Scan / Verdict / Swaps / Profile
    Header.jsx
    LoadingSpinner.jsx
  auth/
    AuthModal.jsx         — sign in / sign up modal

lib/
  rulesEngine.js          — deterministic ingredient analysis engine (core logic)
  rulesEngine.test.js     — Jest tests for rules engine (394 tests total, 2 suites; 15 describe blocks; block 13 = SB 25 additions, 36 tests; block 14 = applyLevel2VerdictOverlay, 23 tests; block 15 = synthetic_additives/EU additives, 25 tests)
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
  swaps.js                — swap suggestions (Google Sheet CSV + AI fallback)
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

### Completed MVP_MODE items (no longer pending):
- ✅ Replaced "Upgrade to Pro — $9.99/mo" button with disabled grey "Coming Soon" in ProfileScreen
- ✅ Level-select onboarding screen built and wired into the flow
- ✅ Level system fully implemented throughout (rules engine, UI, storage, AI tone)

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
sucralose, aspartame, acesulfame potassium, acesulfame-k, ace-k, saccharin,
neotame, advantame, steviol glycoside, stevia extract, rebaudioside, reb-a,
interesterified oil, interesterified fat, carrageenan, titanium dioxide, propyl gallate,
propylene glycol, yellow 5, yellow 6, red 40, blue 1, blue 2, green 3, tbhq, bha, bht

### Level rules — YELLOW for Level 1, RED for Level 2
**Seed oils** (SEED_OILS array — trans fats are in a separate TRANS_FATS array):
high oleic sunflower/canola/safflower oil, canola oil, soybean oil, corn oil,
sunflower oil, safflower oil, cottonseed oil, grapeseed oil, rice bran oil,
vegetable oil, palm oil, rapeseed oil, peanut oil, palm kernel oil, palm olein,
fractionated palm oil, fractionated palm

**All conventional crops** (CONVENTIONAL_CROPS array; organic/Non-GMO clearance still applies)

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

### Categories
1. **TRANS_FATS** — always red at both levels; no clearance
2. **SEED_OILS** — Level 2: red; Level 1: yellow; no organic clearance
3. **CONVENTIONAL_CROPS** — Level 2: red; Level 1: yellow; clearable by `usda-organic` label, `non-gmo-project-verified` label, or "organic" word prefix on the ingredient
4. **BIOENGINEERING_TERMS** — Level 2: red; Level 1: yellow; first match only
5. **NATURAL_FLAVORS** — Level 2: red; Level 1: yellow; no clearance
6. **SYNTHETIC_ADDITIVES** — always red at both levels; no clearance; expanded with ~200 additional EU n/n triggers (full EU n/n list from Sina's review). Category string: `'synthetic_additives'`.
7. **SYNTHETIC_ADDITIVES_L1_YELLOW** — Level 2: red; Level 1: yellow; no organic clearance; ~60 entries from Sina's y/n EU review (natural colors, food acids, hydrocolloids, waxes, enzymes). Category string: `'synthetic_additives'` (same category as SYNTHETIC_ADDITIVES — unified under one category for UI and AI explanations).
8. **GLUTEN_GRAINS** — soft flag (caution/yellow only at both levels). Category string: `'gluten_grains'`.

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

**Data source**: Both use Open Food Facts `labels_tags`, normalised by `normalizeLabelTags()` in `scan.js`. This is the same data used by the rules engine for Category 2 clearance. Results are cached via `scan_cache` — neither function is called on a cache hit.

**Limitations**:
- OFF labels are user-contributed; coverage is good but not authoritative.
- Absence of a label does not mean the product is not certified — it may simply not have been tagged in OFF yet.
- `checkNonGMOProject` is live and functional using OFF label data. A direct Non-GMO Project data partnership is pending to allow authoritative lookups independent of OFF community tagging.
- `checkUsdaOrganicCertification` uses OFF label data. A direct USDA Organic Integrity API integration is pending. The USDA OData API (`OidPublicDataService.svc`) was confirmed retired as of May 2026; the replacement REST API (`OIDPublicAPI`) was investigated and found to return empty results for all queries — likely not accessible at the `api.data.gov` key tier.

### Key design principle
The trigger arrays are the single source of truth. Adding/removing/moving a trigger between levels is a one-line change. No logic scattered across multiple files.

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
  - `product_name`, `last_accessed_at`
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
- Flow: validate → sanitize barcode → check `scan_cache` (return immediately on hit) → fetch Open Food Facts → normalize labels → run `analyzeIngredients(text, labels, userLevel)` → apply Level 2 overlay (certifications.js) if userLevel === 2 → call Claude for explanation → upsert `scan_cache` → return result
- Returns: `{ verdict, flags, clearedBy, productName, ingredients, barcode, source, found, labelsDetected, unverifiedIngredients, explanation }`
- Uses `supabaseServer` (service role key) for all Supabase writes
- Exports `SYSTEM_PROMPT` and `buildUserMessage` from `explain.js` for the inline Claude call

### POST /api/explain
- Body: `{ verdict, flags, productName, ingredients, userLevel?: 1 | 2 }`
- Calls Claude Sonnet with Sina-Joel voice system prompt
- Returns: `{ summary: string, details: { [category]: string } }`
- Exports `SYSTEM_PROMPT`, `buildUserMessage`, `PROMPT_VERSION` for use by `scan.js`
- VerdictScreen skips this endpoint when `scanResult.explanation` is already populated (cache hit or fresh scan)
- **System prompt voice**: Sina McCullough (PhD Nutrition, autoimmune healing journey, science-first, rhetorical questions, inflammation/gut/gene-expression framing) + Joel Salatin (Polyface Farm, story-and-analogy thinker, farming-system angle, "Feed the Good and Starve the Bad"). Together: empowering, not alarmist, skeptical of GRAS and industry-funded science.
- **Level-aware tone**: Level 1 users get encouragement and awareness-building framing; Level 2 users get direct, graduate-level honesty. Controlled by `[Level 1 awareness item]` note injected per flagged category in `buildUserMessage()`.
- **Current PROMPT_VERSION**: `2` (bumped from 1 when Sina/Joel voice was updated — `db6b419`)

---

## Scan Cache Pattern

`lib/cacheVersion.js` exports `PROMPT_VERSION` (integer). This is the single source of truth — import it from here, never from an API route file.

To invalidate the cache after a prompt change:
1. Bump `PROMPT_VERSION` in `lib/cacheVersion.js`
2. Run the SQL from `getCacheInvalidationSQL(newVersion)` in `lib/cacheUtils.js` against the Supabase DB

Cache lookup is keyed on `(barcode, user_level, prompt_version)` — changing the user's level or bumping the prompt version both trigger a fresh Claude call and cache re-population.

**Current PROMPT_VERSION is 2.** Rows written at version 1 are invisible to the client — they will never be served and can be purged with `DELETE FROM scan_cache WHERE prompt_version < 2;`.

---

## Scan History Tap Pattern

Both `ScannerScreen` and `ProfileScreen` support tapping a history item to view its full verdict. The shared logic lives in `lib/scanHistory.js`:

```js
import { formatTime, createHistoryTapHandler } from '@/lib/scanHistory';

// Inside the component:
const handleHistoryItemTap = createHistoryTapHandler({
  supabase,
  userLevel,
  promptVersion: PROMPT_VERSION,
  onResult: onScanResult,      // or onViewVerdict in ProfileScreen
  tapInFlightRef,              // useRef(false) — synchronous concurrency guard
  setLoadingBarcode,
  setMissBarcode,
});
```

The `tapInFlightRef` guard is a ref (not state) because `onResult()` triggers navigation that unmounts the component. State setters on an unmounted component are no-ops in React 18; ref mutations are synchronous and survive unmount. The ref is always reset before calling `onResult()`.

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

**Critical pattern**: Vercel serverless functions freeze the execution context the moment `res.json()` is called. Any un-awaited promise launched before `res.json()` — including fire-and-forget `.then().catch()` chains — is silently discarded before it reaches the network. This caused the `scan_cache` upsert and `captureUnverifiedIngredients` to be dropped on every fresh scan.

**Correct pattern** — await the write, wrap in try/catch so a failure never blocks the response:
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

This applies to **all** Supabase writes in API routes, not just scan_cache. Never use fire-and-forget in a Vercel serverless handler.

---

## Commit History (mvp-beta)

### Session — category rename refactor
| Hash | Description |
|------|-------------|
| `cbf5127` | refactor: unify additive categories — synthetic_additives + gluten_grains |

### Session — EU additives expansion
| Hash | Description |
|------|-------------|
| `8fd052d` | feat: EU additives expansion — SYNTHETIC_ADDITIVES + EU_ADDITIVES_L1_YELLOW |

### Session — certifications.js cleanup + CLAUDE.md sync
| Hash | Description |
|------|-------------|
| `701b142` | docs: confirm checkNonGMOProject live via OFF labels, update CLAUDE.md |

### Session — Level 2 allowlist verdict model
| Hash | Description |
|------|-------------|
| `2e22823` | refactor: replace retired USDA OData API with OFF label lookup in certifications.js |
| `9cea010` | feat: Level 2 allowlist verdict — USDA Organic Integrity lookup + certifications.js |

### Session — SB 25 synthetic additives expansion
| Hash | Description |
|------|-------------|
| `66c781c` | feat: add 18 Texas SB 25 chemicals to SYNTHETIC_ADDITIVES + 36 tests |

### Session — prompt update, cache write fix, code quality
| Hash | Description |
|------|-------------|
| `82705a0` | fix: await Supabase writes before res.json() to prevent Vercel truncation |
| `db6b419` | feat: updated Sina/Joel system prompt, bumped PROMPT_VERSION to 2 |
| `debe4d9` | docs: update CLAUDE.md to reflect prior session changes |
| `83c73bc` | Consolidate duplicated code: scanHistory utils and LEVEL_1_YELLOW_CATEGORIES |
| `32f793d` | Use service role key for server-side Supabase writes |
| `03d1d61` | Skip /api/explain fetch when scanResult.explanation already present |
| `d176411` | chore: remove temporary diagnostic console.log from filterUnrecognizedTokens |
| `943dcb5` | debug: temporary console.log in filterUnrecognizedTokens (removed in d176411) |
| `b96d90a` | refactor: flip Level 1 unverified filter to chemical-signal detection |
| `984b063` | feat: level-aware heuristic filtering for unverifiedIngredients |
| `a6a7fc6` | feat: tap-to-verdict on ScannerScreen recent scans list |
| `85a73b0` | fix: use ref as tap-in-flight guard to prevent stuck history taps |
| `0fde5ce` | fix: reset loadingBarcode before onViewVerdict() to prevent stuck tap state |
| `2529a59` | feat: tap scan history item to view full verdict from cache |
| `8b5f65f` | fix: move PROMPT_VERSION to lib/cacheVersion.js, log cache write errors |
| `ea1722f` | feat: barcode-level scan cache in Supabase (scan_cache table) |
| `c13a2f5` | feat: add unrecognized ingredients card to VerdictScreen |

### Earlier sessions
| Hash | Description |
|------|-------------|
| `fd07f4a` | feat: unverified ingredient capture — rules engine + Supabase logging |
| `f1f3b25` | fix: sort concern cards red-first — reject flags above caution flags |
| `6f5c9cf` | fix: remove welcome screen from first-visit flow, move Level 1 banner below concern cards |
| `ece0ca7` | feat: level system — two-card onboarding, Level 1/2 rules, profile switcher, AI tone |
| `6378911` | feat(mvp-beta): simplify app to MVP launch mode |
| `640a0c0` | fix: scan history data isolation — clear localStorage on signout, Supabase-first for signed-in users |

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
