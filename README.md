# 🌿 Beyond Labels

A food-ingredient analysis app that scans grocery product barcodes, looks them up in Open Food Facts, and runs them through a custom rules engine to flag seed oils, synthetic additives, gene-modified ingredients, pesticide-risk crops, gluten, and more — then shows a plain-language verdict and suggests cleaner swaps.

---

## What It Does

| Screen | Description |
|---|---|
| **Scanner** | Real camera barcode scanning via ZXing-js. Works on mobile (back camera) and desktop (webcam). |
| **Verdict** | Traffic-light score (🔴 Reject / 🟡 Caution / 🟢 Pass) with expandable concern cards explaining each flag. |
| **Swaps** | Suggests a cleaner store-bought alternative (Annie's) and a local farm upgrade. |
| **Profile** | Full ingredient profile for the recommended swap product. |

---

## Tech Stack

- **Next.js 14** (Pages Router) — frontend + API routes
- **React 18** — UI
- **ZXing-js 0.19** (CDN) — camera barcode decoding
- **Open Food Facts API** — free public product database (no key required)
- **Custom rules engine** (`/lib/rulesEngine.js`) — 4 hard-reject categories + soft flags
- **Jest 29** — 182 unit tests covering the rules engine and API route

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
# → http://localhost:3000        (full-stack test page)
# → http://localhost:3000/prototype.html  (clickable prototype with real camera)

# Run all tests
npm test
```

> **Windows note:** If PowerShell blocks `npm`, use `"C:\Program Files\nodejs\npm.cmd"` directly.

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values before running locally.

| Variable | Required | Description |
|---|---|---|
| `OFF_API_BASE_URL` | No | Open Food Facts base URL. Defaults to `https://world.openfoodfacts.org/api/v0/product`. Override only for self-hosted mirrors. |
| `OFF_USER_AGENT_EMAIL` | Recommended | Contact email sent in the `User-Agent` header. OFF asks apps to identify themselves. |
| `NEXT_PUBLIC_APP_URL` | No | Full deployment URL (e.g. `https://beyond-labels.vercel.app`). Not required for basic operation. |

**Open Food Facts is a free public API — no API key is needed.**

---

## Deploying to Vercel

1. Push this repo to GitHub (or GitLab / Bitbucket).
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Vercel auto-detects Next.js — no build settings need changing.
4. Under **Project → Settings → Environment Variables**, add:
   - `OFF_USER_AGENT_EMAIL` → your contact email
   - `NEXT_PUBLIC_APP_URL` → your Vercel deployment URL (e.g. `https://beyond-labels.vercel.app`)
5. Click **Deploy**.

> The `vercel.json` in this repo sets `Cache-Control: no-store` on all `/api/*` routes (so barcode lookups are never stale) and adds basic security headers site-wide.

---

## Project Structure

```
beyond-labels/
├── lib/
│   ├── rulesEngine.js        # Core ingredient analysis logic
│   └── rulesEngine.test.js   # 94 unit tests
├── pages/
│   ├── index.js              # Full-stack connection test page
│   └── api/
│       ├── scan.js           # POST /api/scan — barcode → verdict
│       └── scan.test.js      # 88 API route unit tests
├── public/
│   └── prototype.html        # Full UI prototype with real camera scanning
├── .env.example              # Variable reference — copy to .env.local
├── vercel.json               # Vercel deployment config
└── package.json
```

---

## Rules Engine — What Gets Flagged

| Category | Severity | Cleared by |
|---|---|---|
| Seed Oils (soybean, canola, sunflower…) | 🔴 Reject | Nothing — always flagged |
| Gene Modified / Bioengineering | 🔴 Reject | USDA Organic or Non-GMO Project Verified label |
| Synthetic Additives (artificial dyes, phosphates…) | 🔴 Reject | USDA Organic label |
| Conventional High-Risk Crops (corn, wheat, soy…) | 🔴 Reject | Organic prefix on ingredient OR USDA Organic label |
| Gluten (wheat, barley, rye, spelt) | 🟡 Caution | Never cleared — population-specific risk |
| Natural Flavors | 🟡 Caution | Never cleared — insufficient disclosure |
