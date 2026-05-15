# Chase Cover Configurator — Shopify + Vercel Integration Guide

## Goal

Integrate the chase cover 3D configurator into a Shopify store so that:
1. The configurator IIFE is hosted on Vercel (instant updates on git push / `vercel --prod`, no re-uploading to Shopify)
2. Pricing constants are stored in a Google Sheet (editable without touching code)
3. **"Add to Cart"** creates (or reuses) a deterministic Shopify product variant at the server-calculated price and adds it to the native Shopify cart, opening the theme's cart drawer
4. **"Buy with Shop"** does the same but clears the cart first and redirects to `/checkout`
5. The standalone configurator is also accessible at the Vercel URL (for testing / direct access)
6. If the customer presses Back from checkout, their configuration is automatically restored

No iframe is used. The IIFE loads as a `<script>` tag directly on the Shopify page inside a Shadow DOM for CSS isolation.

> **Primary cart flow is variant-based, not Draft Orders.** The legacy `POST /api/create-order` (Draft Order) endpoint still exists for backwards compatibility but is **not** used by the live cart UI. See the "Variant-Based Cart Flow" section below.

---

## Architecture

```
Shopify Product Page
  |
  +-- <chase-cover-configurator product-id="..." variant-id="...">
  |     Renders inside Shadow DOM (CSS isolated from Shopify theme)
  |     Desktop mount height auto-set to max(640px, 80vh)
  |
  +-- <script src="https://chase-cover-configurator.vercel.app/chase-cover-configurator.iife.js">
        |
        +-- On load: GET /api/pricing  (retried up to 3× with backoff)
        |     -> Vercel serverless function
        |     -> Fetches pricing from Google Sheets (cached 5 min, falls back to defaults)
        |     -> Returns JSON pricing constants
        |
        +-- User configures cover -> price updates in real-time
        |
        +-- "Add to cart" -> POST /api/add-to-cart
        |     -> Vercel serverless function (lib/shopify-auth.ts)
        |     -> Re-fetches pricing from Google Sheets (tamper-proof)
        |     -> Recalculates price server-side
        |     -> Generates deterministic FNV-1a hash from config + price
        |     -> Reuses matching CC-* variant OR creates new variant via productVariantsBulkCreate
        |     -> Returns { variantId, price, properties, variantReused, propagated }
        |   |
        |   +-- POST /api/variant-image (in parallel)
        |   |     -> Uploads 3D screenshot to Shopify CDN
        |   |     -> Attaches image to product + variant
        |   |
        |   +-- POST /cart/add.js (Shopify storefront, with retry + exponential backoff)
        |         -> Adds variant to cart drawer
        |         -> Theme drawer opens with correct price + image
        |
        +-- "Buy with shop" -> same flow + /cart/clear.js first, then redirect to /checkout

Vercel Deployment (https://chase-cover-configurator.vercel.app)
  +-- /                                        Standalone SPA (for testing / direct access)
  +-- /chase-cover-configurator.iife.js        IIFE bundle loaded by Shopify
  +-- /chase-configurator.iife.js              Legacy filename alias (same file)
  +-- /api/pricing                             Serverless: Google Sheets -> JSON (5min cache)
  +-- /api/add-to-cart                         Serverless: Config -> Shopify variant (PRIMARY)
  +-- /api/variant-image                       Serverless: Screenshot -> Shopify CDN
  +-- /api/cleanup-variants                    Serverless: Cron + admin UI for variant cleanup
  +-- /api/create-order                        Serverless: Draft Order (LEGACY, not used by UI)
  +-- /api/cart-debug                          Serverless: Receives client debug telemetry
```

---

## Prerequisites

### 1. Shopify Admin API Access — IMPORTANT

> ⚠️ **Always use Option A (Static Token)**. Option B (`client_credentials` OAuth) only works when the app was created inside the same Shopify organization as the store. If you are a Shopify Partner deploying to a **client store**, you must use Option A — otherwise you will get `shop_not_permitted` errors.

#### Option A: Static Admin API Access Token ✅ (Recommended — always use this for client stores)

1. Log into the **client's** Shopify Admin (not your Partners Dashboard)
2. Go to **Settings > Apps and sales channels > Develop apps**
3. Click **"Create an app"** → name it e.g. "Chase Cover Configurator"
4. Click **"Configure Admin API scopes"** → enable:
   - `write_products` ← **required for variant creation/cleanup (primary cart flow)**
   - `read_products`
   - `write_inventory` ← **required to disable inventory tracking on new variants**
   - `read_inventory`
   - `write_files` ← **required for cart image upload**
   - `read_files`
   - `write_draft_orders` ← only if using legacy `/api/create-order`
   - `read_draft_orders` ← only if using legacy `/api/create-order`
5. Click **"Save"**, then click **"Install app"**
6. Copy the **Admin API access token** (`shpat_...`) — it's shown **only once**, save it securely!
7. Set this as `SHOPIFY_ACCESS_TOKEN` in Vercel environment variables
8. Set `SHOPIFY_STORE` to the store's `.myshopify.com` domain

#### Option B: OAuth Client Credentials ⚠️ (Only works within same Shopify org — avoid for client stores)

1. Go to the **Shopify Partners Dashboard** > Apps > your app
2. Under "API credentials", copy:
   - **Client ID** → set as `SHOPIFY_CLIENT_ID`
   - **Client Secret** → set as `SHOPIFY_CLIENT_SECRET`
3. The server will attempt a `client_credentials` grant on each order
4. **This will fail** (`shop_not_permitted`) if the app org ≠ the store's org

**Auth priority** (shared by all API endpoints via `lib/shopify-auth.ts`):
1. If `SHOPIFY_ACCESS_TOKEN` is set → use it (always preferred)
2. Otherwise → attempt `client_credentials` via `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`

`lib/shopify-auth.ts` also trims env vars to strip trailing CRLF (a common copy/paste issue from Vercel's UI) and logs warnings for requests from unknown origins.

### 2. Google Sheet for Pricing Config

1. Create a new Google Sheet
2. In `Sheet1`, set up this structure (Column A = key, Column B = value):

| Row | A (Key) | B (Value) |
|-----|---------|-----------|
| 1 | AREA_RATE | 0.025 |
| 2 | LINEAR_RATE | 0.445 |
| 3 | BASE_FIXED | 178.03 |
| 4 | HOLE_PRICE | 25 |
| 5 | POWDER_COAT | 45 |
| 6 | SKIRT_SURCHARGE | 75 |
| 7 | SKIRT_THRESHOLD | 6 |
| 8 | GAUGE_24 | 1.0 |
| 9 | GAUGE_20 | 1.3 |
| 10 | GAUGE_18 | 1.4 |
| 11 | GAUGE_16 | 1.6 |
| 12 | GAUGE_14 | 1.8 |
| 13 | GAUGE_12 | 2.7 |
| 14 | GAUGE_10 | 3.4 |
| 15 | MAT_galvanized | 1.0 |
| 16 | MAT_copper | 3.0 |

3. Click File > Share > "Anyone with the link" > set to **Viewer**
4. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`

### 3. Google Sheets API Key

1. Go to https://console.cloud.google.com/
2. Create a new project (or use existing)
3. Enable "Google Sheets API"
4. Go to Credentials > Create Credentials > API Key
5. (Recommended) Restrict the key to "Google Sheets API" only
6. Copy the API key

### 4. Vercel Account

1. Sign up at https://vercel.com (free tier works)
2. Install Vercel CLI: `npm i -g vercel`
3. Link the project: `cd chase-cover-configurator && vercel link`

---

## Environment Variables

### Required Variables

Set these in the **Vercel Dashboard** (Settings > Environment Variables) and in `.env` for local development:

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `GOOGLE_SHEET_ID` | Yes | Google Sheet ID (from the URL) | `1L9qAQbB-5dU...` |
| `GOOGLE_SHEETS_API_KEY` | Optional | Google Cloud API key (only needed if using non-public Sheets read; current code uses the public gviz endpoint) | `AIzaSyA48c...` |
| `SHOPIFY_STORE` | Yes | Shopify store `.myshopify.com` domain | `kaminos.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | **Yes (Option A)** | Static Admin API token | `shpat_abc123...` |
| `SHOPIFY_CLIENT_ID` | Option B only | Shopify App Client ID | `18e8d566e8...` |
| `SHOPIFY_CLIENT_SECRET` | Option B only | Shopify App Client Secret | `shpss_e733...` |
| `SHOPIFY_PRODUCT_ID` | Optional | Fallback product ID if the Liquid template doesn't pass `product-id` | `7983854...` |
| `CRON_SECRET` | Yes (for cleanup) | Secret used to gate the variant-cleanup cron + admin UI | any opaque string |

### Setting via CLI

```bash
vercel env add GOOGLE_SHEET_ID        # paste your Google Sheet ID
vercel env add GOOGLE_SHEETS_API_KEY  # paste your Google API key
vercel env add SHOPIFY_STORE          # e.g. "kaminos.myshopify.com"
vercel env add SHOPIFY_ACCESS_TOKEN   # paste shpat_... token
```

### Local `.env` File

For local development, create a `.env` file in the project root:

```env
# Google Sheets
GOOGLE_SHEET_ID=your-sheet-id-here
GOOGLE_SHEETS_API_KEY=your-api-key-here

# Shopify
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_your_token_here
```

> **Important**: The `.env` file is gitignored. Never commit secrets to the repository.

---

## Project Structure (Integration-Specific Files)

```
chase-cover-configurator/
├── api/                              # Vercel serverless functions (auto-detected)
│   ├── pricing.ts                    # GET /api/pricing
│   ├── add-to-cart.ts                # POST /api/add-to-cart  (PRIMARY cart flow)
│   ├── variant-image.ts              # POST /api/variant-image (3D screenshot upload)
│   ├── cleanup-variants.ts           # GET /api/cleanup-variants (cron + admin UI)
│   ├── create-order.ts               # POST /api/create-order  (LEGACY, not used by UI)
│   └── cart-debug.ts                 # POST /api/cart-debug (client telemetry)
├── lib/
│   ├── pricing-sheet.ts              # Shared pricing fetch/parse logic + DEFAULT_PRICING fallback
│   └── shopify-auth.ts               # Shared Shopify auth (token / OAuth) + origin validation
├── vercel.json                       # Vercel config (build, CORS, function timeouts, cron)
├── src/
│   ├── shopify-entry.tsx             # Shopify IIFE entry point (Shadow DOM, responsive mount)
│   ├── main.tsx                      # Standalone SPA entry point
│   ├── store/configStore.ts          # Zustand store + saveConfigForRestore / restoreConfigIfNeeded
│   ├── config/pricing.ts             # Client-side pricing (fetches from /api/pricing, retry + isApiReachable)
│   └── styles/
│       ├── globals.css               # CSS source (edit this one!)
│       └── globals-scoped.css        # Auto-synced from globals.css before Shopify build
├── scripts/
│   └── sync-shopify-css.mjs          # Pre-build script: copies globals.css → globals-scoped.css
├── dist/                             # Vercel output dir (SPA + IIFE)
└── dist-shopify/                     # Shopify IIFE build output
```

---

## Build & Deploy

### Build Commands

```bash
# Local development (standalone SPA)
npm run dev

# Build standalone SPA only
npm run build

# Build Shopify IIFE only (also syncs CSS first)
npm run build:shopify

# Build everything for Vercel (SPA + IIFE + copies IIFE into dist/)
npm run build:vercel

# Deploy to Vercel production (use this if GitHub auto-deploy doesn't trigger)
npx vercel --prod
```

### How `build:vercel` Works

```bash
npm run build              # Standard Vite SPA build -> dist/
npm run build:shopify      # Syncs CSS, then IIFE build (BUILD_TARGET=shopify) -> dist-shopify/
node -e "..."              # Copies IIFE into dist/ (both filenames)
```

Vercel then serves `dist/` as static files and auto-deploys `api/*.ts` as serverless functions.

### Deploy to Vercel

```bash
# If GitHub integration is connected, push to main:
git push origin main

# If Vercel doesn't auto-trigger (permissions issue), deploy manually:
npx vercel --prod
```

### Verify Deployment

After deploying, verify these URLs work:

| URL | Expected |
|-----|----------|
| `https://chase-cover-configurator.vercel.app/` | Standalone configurator SPA |
| `https://chase-cover-configurator.vercel.app/chase-cover-configurator.iife.js` | JavaScript IIFE bundle |
| `https://chase-cover-configurator.vercel.app/api/pricing` | JSON with pricing constants |

---

## Shopify Theme Setup

### Basic Setup

Add this to your Shopify product page template (Liquid):

```liquid
<chase-cover-configurator style="display:block;width:100%;height:800px;"></chase-cover-configurator>
<script src="https://chase-cover-configurator.vercel.app/chase-cover-configurator.iife.js"></script>
```

### With Product/Variant ID Linking (recommended)

The variant-based cart flow needs to know **which Shopify product** to create variants on. The cleanest way is to pass the IDs from Liquid:

```liquid
<chase-cover-configurator
  product-id="{{ product.id }}"
  variant-id="{{ product.variants.first.id }}"
  style="display:block;width:100%;height:800px;">
</chase-cover-configurator>
<script src="https://chase-cover-configurator.vercel.app/chase-cover-configurator.iife.js"></script>
```

`product-id` is required (or set `SHOPIFY_PRODUCT_ID` in Vercel as a fallback). `variant-id` is optional — it's a hint for the initial render only; the actual cart variant is the deterministic CC-* variant created/reused by `/api/add-to-cart`.

If neither is supplied, `App.tsx` runs `resolveRuntimeShopifyIds()` which scans the page DOM for product IDs in common Shopify theme structures.

### Alternative Mount Point

If you can't use a custom element, use a div with a specific ID:

```html
<div id="chase-cover-configurator-mount" style="width:100%;height:800px;"></div>
<script src="https://chase-cover-configurator.vercel.app/chase-cover-configurator.iife.js"></script>
```

### What the IIFE Does on Load

1. Patches iOS viewport (prevents zoom on input focus)
2. Injects Google Fonts (`DM Sans`, `JetBrains Mono`) into `<head>`
3. Injects QRious library (for QR codes) into `<head>`
4. Finds `<chase-cover-configurator>`, `<chase-configurator>`, `#chase-cover-configurator-mount`, or `#chase-configurator-mount`
5. **Sets a responsive mount height** — on desktop (≥768px) overrides the inline `height` to `max(640px, 80vh)`. Re-applies on `resize`, `load`, and again at +250ms / +1000ms to handle themes that reflow late. Mobile keeps the original `height` attribute.
6. Attaches a **Shadow DOM** to the mount element
7. Injects scoped CSS (`globals-scoped.css`) into the shadow root
8. Creates a light-DOM container (`#chase-cover-configurator-portal`) for AR/QR overlays + injects portal CSS
9. Detects the API base URL from the script's own `src` attribute
10. Reads `product-id` and `variant-id` attributes
11. Fetches pricing from `/api/pricing` (retried up to 3× on cold-start failures, tracked via `isApiReachable()`)
12. Renders the React app into the shadow root

---

## API Reference

### `GET /api/pricing`

Returns current pricing constants from the Google Sheet.

**Response** (200): JSON with the keys defined in `lib/pricing-sheet.ts` — `EXT_ANCHOR`, `EXT_S_W`, `EXT_S_L`, `EXT_S_AREA`, `MARGIN_RATE`, `HOLE_PRICE`, `SKIRT_SURCHARGE`, `SKIRT_THRESHOLD`, `PAINTED_MULTIPLIER`, `GAUGE_MULT`, `MATERIAL_MULT`, `MODEL_COEFFICIENTS`, `STORM_COLLAR_PRICES`.

**Caching**: Server-side in-memory cache (5 min TTL) + HTTP `Cache-Control: public, max-age=60, s-maxage=300`.

**Fallback**: If Google Sheets is unreachable, returns hardcoded `DEFAULT_PRICING` from `lib/pricing-sheet.ts` and logs a server-side warning. The configurator keeps working with default prices.

### `POST /api/add-to-cart` (PRIMARY cart flow)

Re-fetches pricing server-side, computes the price, and creates (or reuses) a deterministic Shopify product variant. Does **not** touch the Shopify cart — the client adds the returned `variantId` to `/cart/add.js` itself.

**Max duration**: 30s (configured in `vercel.json`).

**Request body**: full configuration JSON (`w`, `l`, `sk`, `drip`, `diag`, `mat`, `gauge`, `pc`, `pcCol`, `holes`, `collarA/B/C`, `quantity`, `notes`, `shopifyProductId`, `shopifyVariantId`).

**Response** (200):
```json
{
  "variantId": "gid://shopify/ProductVariant/12345...",
  "variantReused": false,
  "propagated": true,
  "price": 612.45,
  "properties": { /* line item properties Shopify will store */ },
  "_timing": { /* server-side timing breakdown */ }
}
```

Variant naming: `CC-XXXXXXXX` (deterministic 8-char FNV-1a hex from config + price). Identical config + price = same hash = variant reused (no propagation delay).

### `POST /api/variant-image`

Uploads the 3D screenshot and attaches it to the variant + product.

**Max duration**: 25s (configured in `vercel.json`).

**Request body**: `{ variantId, productId, image }` — `image` is a base64 data URL.

**Response** (200): `{ imageUrl }` (Shopify CDN URL).

**Errors**:
- `413` if decoded image > ~500KB (server-side cap to prevent OOM)
- Requires the `write_files` scope on the Shopify app

### `GET /api/cleanup-variants`

- **Cron**: runs every 3 days at midnight UTC (configured in `vercel.json`); deletes CC-* variants older than 3 days
- **Manual UI**: open in a browser with `?secret=<CRON_SECRET>` for the management dashboard
- Auth: `CRON_SECRET` env var, passed as query param or `Bearer` header. Falls back to OAuth `client_credentials` if `SHOPIFY_ACCESS_TOKEN` isn't set.

### `POST /api/cart-debug`

Receives client-side telemetry (cart attempts, retries, drawer events, image upload status). Logged to Vercel function logs. Useful when reproducing customer issues.

### `POST /api/create-order` (LEGACY — Draft Order flow, not used by the live UI)

Still functional, kept for backwards compatibility with older integrations that hit it directly. Creates a Shopify Draft Order from a configuration and returns a `checkout_url`. Uses shared auth from `lib/shopify-auth.ts`. **The live cart UI does not call this endpoint** — it uses the variant flow above.

---

## How Orders Appear in Shopify Admin

Each cart/checkout that ships from this flow lands as a normal Shopify order against a **CC-* variant** of the configured product. The order line item shows:

### Line Item
- **Title**: the configured product's title (e.g. "Custom Chase Cover")
- **Variant**: `CC-XXXXXXXX` (the deterministic hash; reused for identical configs)
- **Price**: server-calculated price (tamper-proof, re-fetched from Google Sheets)
- **Image**: 3D screenshot uploaded via `/api/variant-image` (requires `write_files` scope)
- **Quantity**: as selected by user

### Line Item Properties

Properties are combined into fewer lines for readability:

```
Dimensions:        60" L × 48" W × 3" Skirt
Material & Gauge:  Galvanized — 24ga
Options:           Drip Edge: Yes · Diagonal Crease: Yes
Powder Coat:       Ruby Red (RAL 3002)
Holes:             2
H1 (Left):         Round ⌀10" — Collar 3" tall
H1 Position:       Centered on cover
H2 (Right):        Rectangle 8" × 8" — Collar 2" tall
H2 Offsets:        Top: 5" · Right: 12" · Bottom: 5" · Left: 12"
Special Notes:     Customer note here
_config_json:      { …full JSON config… }
```

> Properties starting with `_` are hidden from customers in the checkout UI. Powder coat now shows the human-readable RAL name + code (e.g. `Ruby Red (RAL 3002)`) instead of the raw hex value — the server does the hex→RAL lookup before creating/reusing the variant.

### Hole Position Labels

| Hole Count | H1 Label | H2 Label | H3 Label |
|-----------|---------|---------|---------|
| 1 hole | "Hole" | — | — |
| 2 holes | "H1 (Left)" | "H2 (Right)" | — |
| 3 holes | "H1 (Left)" | "H2 (Middle)" | "H3 (Right)" |

### Order Note

Human-readable multi-line description:
```
60" L × 48" W × 3" Skirt
Material: Galvanized | Gauge: 24ga
Drip Edge: Yes | Diagonal Crease: Yes
H1 (Left): Round ⌀10" — 3" tall (centered)
H2 (Right): Rect 8" × 8" — 2" tall [Top:5" Right:12" Bottom:5" Left:12"]

Preview: https://cdn.shopify.com/…
```

---

## Cart Image (3D Screenshot)

When "Add to cart" is clicked, the app:
1. Captures the 3D canvas as a JPEG (white background composite) via `captureCanvasScreenshot()` — dimension labels are temporarily hidden during capture so the thumbnail is clean
2. As soon as the variant ID returns from `/api/add-to-cart`, fires `POST /api/variant-image` in parallel with the cart-add retry loop
3. The server (a) uploads the image via `stagedUploadsCreate` GraphQL → HTTP `PUT` binary → REST POST to attach to product + variant
4. Returns `{ imageUrl }` (Shopify CDN URL); the variant now displays the image in the cart drawer and checkout

The flow waits up to 1.2s for the upload before opening the cart drawer (so the first render can include the image). If the upload is still in flight, the drawer opens without the image and the theme is notified via cart events when the image is ready.

For **Buy with Shop**, the image upload is `await`ed before the redirect — mobile browsers cancel in-flight requests on navigation, so we ensure it lands first.

### Requirements for Image Upload

The Shopify app **must have** these scopes:
- `write_files`
- `read_files`

The server enforces a **~500KB decoded image cap** (returns 413 if exceeded) to prevent OOM on Vercel's serverless functions.

If `write_files` is missing, the upload fails silently — the cart line item is still created with the correct price/properties, just without the image.

### Adding `write_files` Scope

1. Shopify Admin > Settings > Apps and sales channels > Develop apps > your app
2. Click "Configure Admin API scopes"
3. Enable `write_files` and `read_files`
4. Click Save → re-install the app (you'll get a new `shpat_...` token)
5. Update `SHOPIFY_ACCESS_TOKEN` in Vercel with the new token

---

## Pricing: How It Works End-to-End

### Client-Side (for display only)

1. On app startup, `loadPricingFromAPI(apiBase)` calls `GET /api/pricing`
2. Response updates the `PRICING` object in `src/config/pricing.ts`
3. `onPricingLoaded()` triggers a price recompute in the Zustand store
4. As users change configuration, price updates instantly using the fetched constants

### Server-Side (tamper-proof, for actual orders)

1. When "Add to cart" is clicked, `POST /api/add-to-cart` is called
2. The server re-fetches pricing directly from Google Sheets (not from client-supplied values)
3. Price is recalculated server-side via `computePricingBreakdown()` (shared with the client in `src/utils/pricing.ts`)
4. A deterministic FNV-1a hash is generated from the snapped config + price, and the variant is created/reused at the **server-calculated price**
5. Even if someone tampers with client-side data, the variant price (and therefore the cart price) is always correct

### Updating Prices

Just edit values in the Google Sheet. Changes propagate:
- To the **client** (displayed price): within ~5 minutes (server cache + HTTP cache)
- To **new orders** (actual price): immediately on next order (server always re-fetches fresh from Google Sheets)

No code changes or redeployment needed.

---

## Session Config Restore (Back-from-Cart)

When the user clicks "Add to cart" or "Buy with shop":
1. The full configuration is saved to `sessionStorage` under key `chase-cover-restore` **before** the cart-add request fires (so even if the user closes the drawer or hits back from checkout, the config can be restored)
2. For Buy Now: the user is redirected to the Shopify checkout URL after the variant + cart are ready

When the page loads:
- If `chase-cover-restore` exists in `sessionStorage` → config is restored and the key is **immediately deleted**
- If it doesn't exist → default config loads

**Effect**:
- Press Back from checkout → config restored ✅
- Close the cart drawer and navigate away → config restored on the next visit ✅
- Manually refresh the page (after the key was cleared on first restore) → default config loads ✅

---

## Security Summary

| Layer | Protection |
|-------|-----------|
| Client-side pricing | Display only — calculated from fetched constants, not trusted for orders |
| Server-side pricing | Re-fetched from Google Sheets on every order — tamper-proof |
| Shopify Auth | `shpat_` token never exposed to client; used server-side only |
| Google Sheet | Shared as "Viewer" only — not editable by public |
| CORS | API endpoints allow `*` origin (required for cross-origin Shopify embedding) |
| Shadow DOM | CSS isolation prevents Shopify theme from breaking configurator styles |
| `_` properties | Hidden line item properties (prefixed `_`) are not shown to customers in checkout |

---

## Troubleshooting

### "Configuration error: API base not found"
The IIFE couldn't detect its own script URL. Make sure the `<script>` tag `src` contains `chase-cover-configurator` or `chase-configurator` in the filename.

### Price shows $0 or incorrect value
- Check browser console for pricing fetch errors
- Verify `GET /api/pricing` returns valid JSON
- Check that Google Sheet is shared as "Viewer"
- If pricing failed silently on cold start, the HTTP/2 connection pool to Vercel may be poisoned. The client retries `loadPricingFromAPI()` 3× with backoff and warms the connection before Add to Cart — but if you see `Failed to fetch` instantly on the first cart attempt, that's the cause

### Cart drawer briefly shows $0 price (then refreshes)
- This is a Shopify variant-propagation timing issue. The client polls `/cart.js` for the specific variant's price and only opens the drawer once it returns non-zero. Sections that contain `$0` are rejected and re-fetched.
- If you see persistent $0, check `/api/cart-debug` logs in Vercel for the variant ID and confirm the variant was created with the right price.

### Cart drawer closes instantly after opening
- Caused by something replacing the drawer's `innerHTML` while it's open — destroys event listeners and scroll lock. The configurator avoids this (applies sections **before** opening; only dispatches events afterwards). If you see this, your theme/another script is interfering.

### "Add to Cart" fails with `shop_not_permitted`
- You are using `client_credentials` OAuth for a cross-organization store
- **Fix**: Create a custom app directly in the client's Shopify Admin and use the static `SHOPIFY_ACCESS_TOKEN`

### "Add to Cart" fails with `application_cannot_be_found`
- `SHOPIFY_CLIENT_ID` is incorrect or the app was deleted
- **Fix**: Use `SHOPIFY_ACCESS_TOKEN` from a Store Admin custom app instead

### "Add to Cart" fails with `Variant limit reached` / 422 on variant creation
- Shopify Basic plan caps a product at 100 variants
- The cleanup endpoint runs on cron every 3 days, and proactive cleanup runs at 95+; emergency cleanup runs on 422
- Trigger a manual cleanup via `https://chase-cover-configurator.vercel.app/api/cleanup-variants?secret=<CRON_SECRET>`

### "Add to Cart" fails with other error
- Check Vercel function logs: `vercel logs` or Vercel Dashboard > Deployments > Functions
- Verify all required env vars are set (no trailing CRLF — `lib/shopify-auth.ts` trims them but UI-pasted values can still surprise you)
- Ensure the Shopify app has `write_products`, `write_inventory`, and `write_files` scopes (and `write_draft_orders` only if you also use the legacy endpoint)

### Configurator doesn't render on Shopify
- Verify the IIFE URL returns JavaScript (not 404)
- Check browser console for errors
- Ensure `<chase-cover-configurator>` element exists in the DOM before the script loads

### AR doesn't work on Shopify
- AR overlays are portaled to light DOM (`#chase-cover-configurator-portal`) — required for `<model-viewer>`
- On desktop: AR shows a QR code for mobile scanning
- On mobile: `<model-viewer>` is loaded dynamically on first AR tap, then AR launches directly

### Cart image is empty / no image in checkout
- App is missing `write_files` scope — see "Adding `write_files` Scope" above
- After adding scope you must re-install the app and update `SHOPIFY_ACCESS_TOKEN` in Vercel

### PDF download not working
- The PDF is generated from a hidden HTML element rendered off-screen
- Check browser console for `html2canvas` errors
- Ensure the `PdfReport` component is mounted (it's rendered in `App.tsx`)

### Config is lost after clicking Add to Cart
- The config is saved to `sessionStorage` right before redirect and restored on the next page load
- If user opens a new tab or clears storage, config won't restore — this is by design

### Vercel doesn't auto-deploy on git push
- GitHub integration may require re-authorization in Vercel Dashboard
- Use `npx vercel --prod` to deploy manually at any time

---

## Testing Checklist

### Initial Setup
1. [ ] Google Sheet is set up with pricing values and shared as "Viewer"
2. [ ] Vercel env vars are set: `GOOGLE_SHEET_ID`, `SHOPIFY_STORE`, `SHOPIFY_ACCESS_TOKEN`, `CRON_SECRET`
3. [ ] Shopify app has scopes: `write_products`, `read_products`, `write_inventory`, `read_inventory`, `write_files`, `read_files`
4. [ ] `npx vercel --prod` deploys successfully

### Vercel URLs
5. [ ] `https://chase-cover-configurator.vercel.app/` shows the standalone configurator
6. [ ] `/chase-cover-configurator.iife.js` returns the JS bundle
7. [ ] `/api/pricing` returns JSON with pricing constants

### Shopify Integration
8. [ ] Shopify product page loads the configurator without CSS conflicts
9. [ ] Desktop mount fills `max(640px, 80vh)` of the viewport
10. [ ] Price updates in real-time as user changes options
11. [ ] "Add to cart" opens the theme's cart drawer with the correct price (no $0 flash)
12. [ ] Cart line item shows combined properties (Dimensions, Material & Gauge, Options, hole details, RAL name + code for powder coat)
13. [ ] Hole position labels show Left/Middle/Right correctly
14. [ ] "Buy with shop" clears the cart and redirects to `/checkout`
15. [ ] Identical configurations reuse the same `CC-*` variant (no duplicate creates)

### Material & Config Behavior
16. [ ] Switching to Copper always shows copper color in 3D model
17. [ ] Enabling powder coat → switching to copper → switching back to galvanized restores powder coat color
18. [ ] Powder coat is not charged when material is copper
19. [ ] Rectangular hole shows "Rectangle W" × H"" in order, not "Round ⌀"

### Session & Navigation
20. [ ] Pressing Back from checkout (Buy Now flow) restores configuration
21. [ ] Manually refreshing the page loads defaults (not saved session)

### Features
22. [ ] Changing a value in Google Sheet updates displayed pricing within 5 minutes
23. [ ] AR QR code appears on desktop, AR placement works on mobile (direct launch)
24. [ ] PDF download generates a valid specification worksheet
25. [ ] "Move Holes" drag mode works — holes can be repositioned in 3D viewport
26. [ ] Cart image shows 3D screenshot in Shopify cart drawer + checkout (requires `write_files` scope)
27. [ ] Variant cleanup admin UI loads at `/api/cleanup-variants?secret=<CRON_SECRET>`
