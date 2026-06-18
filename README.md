# Kaminos Multi-Flue Chimney Cap Configurator

The interactive 3D product configurator embedded on the Kaminos **chimney cap**
product page. Customers pick mount style, lid type, dimensions, gauge/material
and finish; they see a live 3D preview and price, then add their custom build
straight to the cart (with AR preview and a downloadable PDF spec sheet).

- **Live (production):** https://chimney-cap-configurator.vercel.app
- **Embedded on:** the Kaminos Shopify chimney-cap product page
- **Repo:** https://github.com/kaminosofficial/chimney-cap-configurator

> Forked from the chase cover configurator and reskinned around the cap model.
> The chase cover (https://chase-cover-configurator.vercel.app) is a **separate**
> project and is not affected by this repo.

---

## For the store owner (no developer needed)

### Change prices
All prices come from a **Google Sheet**. Edit the sheet and the new prices go
live **within about 5 minutes** — no code change, no developer, no redeploy.
Pricing is driven by the **"Cap configurator"** block (a 24-row mount × lid ×
size matrix, plus surcharges).

- The sheet is the pricing sheet shared with you (ask your developer for the link
  if you don't have it).
- Edit the **values** only. Don't rename, move, or delete the label cells next to
  them — those are how the site finds each price.
- A change takes up to ~5 minutes to appear (the site caches prices briefly).

### If something looks wrong
1. Hard-refresh the product page (Ctrl/Cmd + Shift + R).
2. Check the pricing sheet is reachable and the values look right.
3. Still wrong? Contact your developer — full technical docs and history are in
   [AGENTS.md](AGENTS.md) / [claude.md](claude.md).

---

## For developers

- **Full technical docs:** [AGENTS.md](AGENTS.md) / [claude.md](claude.md) —
  architecture, Shopify cart flow, cap pricing, decision history.
- **How to ship changes safely:** [SHIPPING.md](SHIPPING.md) — branches,
  previews, the automatic check, the merge flow.
- **Shopify embed setup:** [SHOPIFY-INTEGRATION-GUIDE.md](SHOPIFY-INTEGRATION-GUIDE.md).

Quickstart:

```bash
npm install
npm run dev          # http://localhost:5173
```

Deploy (manual — GitHub→Vercel auto-deploy not wired up yet):

```bash
vercel deploy --prod --scope kaminos-official-s-projects
```
