# Kaminos Multi-Flue Chimney Cap Configurator

3D parametric configurator for Kaminos multi-flue chimney caps. Users pick mount style, lid type, dimensions, gauge/material, and finish; the 3D model updates in real time and the price is computed from a Google Sheet. Hosted on Vercel and embeddable into Shopify via a single IIFE bundle.

**Live:** https://chimney-cap-configurator.vercel.app
**Repo:** https://github.com/kaminosofficial/chimney-cap-configurator

This project was forked from the chase cover configurator and reskinned around the cap model (`CapModel` / `CapViewer`, `configStore.computeCapPrice`). The original chase cover lives at https://chase-cover-configurator.vercel.app — it is a **separate Vercel project** and is not touched by this repo's deploys.

---

## Tech stack

- React 19 + TypeScript + Vite 7
- Zustand (client state)
- React Three Fiber + Three.js (3D)
- Vercel serverless functions (API + Shopify variant cart flow)
- Google Sheets (live pricing)

## Quickstart

```bash
npm install
npm run dev          # http://localhost:5173
```

Build targets:

| Command | Output |
|---|---|
| `npm run build` | `dist/` — standalone SPA |
| `npm run build:shopify` | `dist-shopify/chimney-cap-configurator.iife.js` — Shopify IIFE bundle. The build also writes `chase-cover-configurator.iife.js` and `chase-configurator.iife.js` to `dist/` as byte-identical legacy aliases. |
| `npm run build:vercel` | both of the above, copied into `dist/` for Vercel |

## Deploy

```bash
vercel deploy --prod --scope kaminos-official-s-projects
```

GitHub→Vercel auto-deploy is not wired up yet — see "GitHub → Vercel auto-deploy" in [AGENTS.md](AGENTS.md) (or [claude.md](claude.md)) for the manual deploy steps and the env-var setup checklist.

## Pricing

Price = `(width + length) × multiplier × MATERIAL_MULT × surcharges × MARGIN_RATE`, where the **multiplier** comes from a 24-row matrix (3 mounts × 4 lids × 2 size brackets) defined in the **"Cap configurator"** block (columns H/I) of the pricing Google Sheet. Surcharges (steep pitch, tall skirt, extra overhang, tall screen) and bracket dimension thresholds are also editable from the sheet. Every input combination produces a numeric price — there is no "Call for Pricing" state. Full details and the live multiplier matrix: [AGENTS.md → Cap Pricing](AGENTS.md#cap-pricing).

## Docs

- [AGENTS.md](AGENTS.md) / [claude.md](claude.md) — full project documentation (architecture, build, Shopify, pricing)
- [SHOPIFY-INTEGRATION-GUIDE.md](SHOPIFY-INTEGRATION-GUIDE.md) — step-by-step Shopify embed + auth setup
