# Chase Cover Configurator — Project Documentation

## Overview

This is a 3D chase cover configurator built for **Kaminos**. Users configure custom chase covers by setting dimensions, hole placements, material, gauge, and options. The 3D model updates in real-time and supports AR preview. The app is deployed on **Vercel** and integrates with **Shopify** (variant-based cart flow) and **Google Sheets** (dynamic pricing).

**Tech stack**: React + TypeScript + Vite + Zustand (state) + React Three Fiber (3D) + Three.js (geometry)

**Hosting**: Vercel (serverless functions + static assets + Shopify IIFE bundle)

**Live URL**: `https://chase-cover-configurator.vercel.app`

---

## File Structure

```
chase-cover-configurator/
├── api/                                 # Vercel serverless functions
│   ├── pricing.ts                       # GET /api/pricing — returns Google Sheet pricing (cached 5 min)
│   ├── add-to-cart.ts                   # POST /api/add-to-cart — creates/reuses Shopify variant, returns variant ID
│   ├── variant-image.ts                # POST /api/variant-image — uploads 3D screenshot to Shopify CDN
│   ├── cleanup-variants.ts             # GET /api/cleanup-variants — management UI + cron for variant cleanup
│   ├── create-order.ts                  # POST /api/create-order — legacy Draft Order flow (not primary)
│   └── cart-debug.ts                    # POST /api/cart-debug — receives client-side debug telemetry
├── lib/
│   ├── pricing-sheet.ts                 # Shared pricing fetch logic (Google Sheets → PricingConstants)
│   └── shopify-auth.ts                  # Shared Shopify auth (token management, origin validation)
├── vercel.json                          # Vercel build config, CORS headers, rewrites, function timeouts
├── .env                                 # Environment variables (see "Environment Variables" section)
├── package.json                         # Scripts: dev, build, build:shopify, build:vercel
├── vite.config.ts                       # Multi-target build config (SPA / Shopify IIFE / Vercel)
├── scripts/
│   └── sync-shopify-css.mjs             # Copies globals.css -> globals-scoped.css before Shopify build
├── CLAUDE.md                            # This file
├── SHOPIFY-INTEGRATION-GUIDE.md         # Step-by-step Shopify + Vercel integration guide
├── dist/                                # Vercel output (SPA + IIFE copy)
├── dist-shopify/                        # Shopify IIFE build output
├── src/
│   ├── App.tsx                          # Main layout, dim-overlay, AR launch, Add to Cart + Buy Now handlers
│   ├── main.tsx                         # React entry point (standalone SPA mode)
│   ├── shopify-entry.tsx                # Shopify IIFE entry (Shadow DOM, portal, API base detection)
│   ├── web-component.tsx                # Legacy web component entry (not used in production)
│   ├── store/configStore.ts             # Zustand store, pricing logic, session restore helpers
│   ├── config/
│   │   ├── index.ts                     # Re-exports pricing + ralColors
│   │   ├── pricing.ts                   # Pricing constants, loadPricingFromAPI(), onPricingLoaded()
│   │   └── ralColors.ts                 # RAL color palette data
│   ├── utils/
│   │   ├── geometry.ts                  # 3D model generation (buildScene, holeWorld, mkMat)
│   │   ├── pricing.ts                   # computePricingBreakdown() — shared between client and server
│   │   ├── ar.ts                        # AR export (GLB) and config serialization
│   │   ├── cameraRef.ts                 # Camera action bindings (reset, top, front)
│   │   ├── format.ts                    # formatFrac() — fraction display (e.g. 48 1/2)
│   │   └── pdfGenerator.ts             # PDF generation via html2canvas + jsPDF
│   ├── components/
│   │   ├── viewer/
│   │   │   ├── ChaseViewer.tsx          # R3F Canvas, lights, environment
│   │   │   ├── ChaseModel.tsx           # Geometry rebuild on config changes; drag-to-move holes
│   │   │   └── DimensionOverlay.tsx     # 3D labels with arrows (A1-A4)
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx              # Main sidebar layout + price breakdown
│   │   │   ├── DimensionField.tsx       # Length/Width/Skirt inputs with limits (order: L, W, Sk)
│   │   │   ├── CollarGroup.tsx          # Per-hole controls (shape, dia/rect, height, offsets)
│   │   │   ├── HoleSelector.tsx         # 0-3 hole selection buttons
│   │   │   ├── GaugeSelect.tsx          # Gauge dropdown
│   │   │   ├── MaterialChips.tsx        # Galvanized / Copper toggle
│   │   │   ├── ToggleRow.tsx            # Toggle switches (drip, diag, pc)
│   │   │   ├── PowderCoatSection.tsx    # Color picker + RAL trigger
│   │   │   ├── PriceDisplay.tsx         # Estimated price display
│   │   │   ├── CartRow.tsx              # Dawn-style quantity selector + Add to Cart + Buy with Shop + Download PDF
│   │   │   ├── NotesField.tsx           # Special notes textarea (200-word limit)
│   │   │   └── InfoTooltip.tsx          # ⓘ hover tooltip component
│   │   ├── pdf/
│   │   │   └── PdfReport.tsx            # Hidden PDF report template (rendered off-screen)
│   │   ├── ral/RalModal.tsx             # RAL color palette modal
│   │   └── ar/                          # AR-related components
│   ├── styles/
│   │   ├── globals.css                  # All CSS (standalone mode + source for Shopify sync)
│   │   └── globals-scoped.css           # Scoped CSS injected into Shadow DOM (auto-synced from globals.css)
│   ├── vite-env.d.ts                    # Vite type declarations
│   └── model-viewer.d.ts               # Type declarations for <model-viewer> web component
```

---

## Environment Variables

All environment variables are set in Vercel (Settings > Environment Variables) and in `.env` for local dev.

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_SHEET_ID` | Google Sheet ID containing pricing constants | `1L9qAQ...` |
| `SHOPIFY_STORE` | Shopify store domain | `your-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Static Shopify Admin API token (`shpat_...`) — **preferred method** | `shpat_abc123...` |
| `SHOPIFY_CLIENT_ID` | Shopify App Client ID (fallback OAuth only — see caveats) | `18e8d5...` |
| `SHOPIFY_CLIENT_SECRET` | Shopify App Client Secret (fallback OAuth only — see caveats) | `shpss_e7...` |
| `SHOPIFY_PRODUCT_ID` | Fallback product ID if not passed from Shopify template | `7983854...` |
| `CRON_SECRET` | Secret for authenticating cleanup-variants cron/manual triggers | `my-secret` |

**Auth priority** (in `lib/shopify-auth.ts`, shared by all API endpoints):
1. If `SHOPIFY_ACCESS_TOKEN` is set → use it directly (**always use this for client stores**)
2. Otherwise → try `client_credentials` OAuth grant using `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`

> ⚠️ **IMPORTANT — Shopify OAuth Caveat**: The `client_credentials` grant **only works when the app and the store are in the same Shopify organization**. If the app was created via the Partners Dashboard in the partner's org and installed on a client's store (different org), Shopify will return `shop_not_permitted`. **Always use `SHOPIFY_ACCESS_TOKEN`** for client store deployments. Create the app directly in the client's store Admin > Settings > Apps > Develop apps.

---

## Build System

### Build Targets (via `vite.config.ts`)

| Command | `BUILD_TARGET` | Output | Description |
|---------|---------------|--------|-------------|
| `npm run dev` | — | — | Local dev server (port 5173) |
| `npm run build` | — | `dist/` | Standard SPA build (standalone hosting) |
| `npm run build:shopify` | `shopify` | `dist-shopify/` | IIFE bundle for Shopify embedding |
| `npm run build:vercel` | — | `dist/` | Both SPA + IIFE (copies IIFE into `dist/`) |

### Vercel Build (`build:vercel`)

Runs `npm run build && npm run build:shopify && node -e "...copy IIFE to dist/..."`. This produces:
- `dist/index.html` + assets — standalone SPA (accessible at the Vercel URL root)
- `dist/chase-cover-configurator.iife.js` — the IIFE bundle loaded by Shopify
- `dist/chase-configurator.iife.js` — legacy filename alias (also copied for backwards compat)
- `api/*.ts` — Vercel serverless functions (auto-detected)

### CSS Sync (`sync:shopify-css`)

Before the Shopify IIFE build, `scripts/sync-shopify-css.mjs` copies `globals.css` → `globals-scoped.css` so both builds stay in sync. **Never edit `globals-scoped.css` directly** — edit `globals.css` and let the sync handle it.

### `vercel.json`

- `buildCommand`: `npm run build:vercel`
- `outputDirectory`: `dist`
- CORS headers on `/api/*` and both IIFE filenames (Access-Control-Allow-Origin: *)
- Cache-Control on IIFE: `public, max-age=60, s-maxage=300`
- Function timeouts: `add-to-cart.ts` = 30s, `variant-image.ts` = 25s
- Cron: `cleanup-variants` runs every 3 days at midnight UTC

### Manual Deploy

If Vercel's GitHub integration doesn't auto-trigger (e.g., due to permissions), deploy manually:
```bash
npx vercel --prod
```

---

## Shopify Integration (Summary)

See `SHOPIFY-INTEGRATION-GUIDE.md` for full step-by-step setup.

### How It Works (Variant-Based Cart Flow)

1. **Shopify product page** loads `<script src="https://chase-cover-configurator.vercel.app/chase-cover-configurator.iife.js">`
2. The IIFE (`shopify-entry.tsx`) attaches a **Shadow DOM** to `<chase-cover-configurator>` for CSS isolation
3. On load, it calls `GET /api/pricing` to fetch pricing constants from Google Sheets
4. User configures the chase cover; price updates in real-time
5. **"Add to Cart"** calls `POST /api/add-to-cart` which:
   - Re-fetches pricing from Google Sheets (tamper-proof)
   - Recalculates price server-side
   - Creates a **deterministic variant** on the Shopify product (or reuses an existing one with matching config hash)
   - Returns `{ variantId, price, properties, variantReused, propagated }`
6. Client-side adds the variant to Shopify's cart via `/cart/add.js` with a unified retry loop (`addToCartWithRetry`)
7. Cart drawer opens with correct price (sections are validated before display)
8. **"Buy Now"** follows the same flow but clears the cart first and redirects to `/checkout`
9. If user presses **back** from checkout, their configuration is automatically restored

### Shadow DOM & Portals

- The configurator renders inside a **Shadow DOM** (`shopify-entry.tsx`) for complete CSS isolation from Shopify themes
- CSS is injected as `globals-scoped.css?inline` into the shadow root
- AR/QR overlays are **portaled to the light DOM** (`#chase-cover-configurator-portal`) because `<model-viewer>` requires light DOM for AR to work
- Google Fonts and QRious are injected into the document head (light DOM)

### Product & Variant ID Linking

The Shopify Liquid template can pass product/variant IDs:
```html
<chase-cover-configurator
  product-id="{{ product.id }}"
  variant-id="{{ product.variants.first.id }}"
  style="display:block;width:100%;height:800px;">
</chase-cover-configurator>
```

These are read by `shopify-entry.tsx` and passed to `App` as props. The `product-id` is also resolved at runtime from multiple Shopify DOM sources (see `resolveRuntimeShopifyIds` in `App.tsx`).

### API Base URL Detection

The IIFE detects its own origin by scanning `<script>` tags for one containing `chase-cover-configurator` or `chase-configurator` in the `src`. The origin of that script URL becomes the API base (`window.__chaseApiBase`), so API calls always go back to the Vercel deployment regardless of which Shopify domain hosts the page.

---

## Serverless API Functions (Vercel)

### `GET /api/pricing`

- Fetches pricing constants from Google Sheets (public gviz endpoint)
- In-memory cache with 5-minute TTL
- Returns JSON with pricing constants (EXT_ANCHOR, EXT_S_W, EXT_S_L, etc.)
- **Fallback**: If Google Sheets is unreachable, returns hardcoded default constants (see `DEFAULT_PRICING` in `lib/pricing-sheet.ts`) with a server-side warning log

### `POST /api/add-to-cart` (Primary cart flow)

- **Max duration**: 30s (configured in `vercel.json`)
- Receives full configuration as JSON body
- Authenticates with Shopify via `lib/shopify-auth.ts`
- Fetches pricing from Google Sheets server-side (tamper-proof)
- Computes price via `computePricingBreakdown()` from `src/utils/pricing.ts`
- **Variant creation/reuse**:
  1. Generates a deterministic FNV-1a hash from config + price (`configHash()`)
  2. Fetches all existing variants; finds match by hash + price
  3. If found → reuses existing variant (instant, no propagation needed)
  4. If not found → creates new variant via `productVariantsBulkCreate` GraphQL
  5. Quick propagation hint (3s max) — client owns the real retry loop
- **Variant cleanup**: Proactive cleanup when nearing 100-variant Shopify Basic limit (deletes CC-* variants older than 24h)
- Returns `{ variantId, variantReused, propagated, price, properties, _timing }`
- Line item `properties` include: Dimensions, Material & Gauge, Options, Powder Coat, Holes, per-hole details, Special Notes, hidden `_config_json`

### `POST /api/variant-image`

- **Max duration**: 25s (configured in `vercel.json`)
- Receives `{ variantId, productId, image }` where image is base64 data URL
- **Image size validation**: Rejects images > ~500KB decoded (returns 413)
- Upload flow:
  1. `stagedUploadsCreate` GraphQL → temporary upload URL
  2. HTTP `PUT` binary to staged URL
  3. REST `POST` to attach image to product + variant
- Returns `{ imageUrl }` (Shopify CDN URL)
- **Requirement**: Shopify app must have `write_files` scope

### `GET /api/cleanup-variants`

- Management dashboard for variant cleanup
- Cron: runs every 3 days (deletes CC-* variants older than 3 days)
- Manual: accessible via browser with `?secret=CRON_SECRET` for management UI
- Auth: `CRON_SECRET` env var, passed as query param or Bearer header

### `POST /api/create-order` (Legacy Draft Order flow)

- Creates a Shopify Draft Order with full configuration
- Not the primary flow — kept for backwards compatibility
- Uses shared auth from `lib/shopify-auth.ts`

### `POST /api/cart-debug`

- Receives client-side debug telemetry for troubleshooting cart issues
- Logs to Vercel function logs

---

## Cart Flow: Add to Cart (Detailed)

**Files**: `src/App.tsx` (`onAddToCart` handler, `addToCartWithRetry()`, `waitForUsableRenderedSections()`)

### Flow

1. **Kick off screenshot capture** of 3D canvas (JPEG, white background composite). Labels (`showLabels`, `showLabelsA/B/C`) are temporarily hidden during capture and restored after, so the cart image is clean.
2. **Call `POST /api/add-to-cart`** with config (no image — image uploaded separately)
3. **Image upload (pre-drawer)**: As soon as the variant is created (and only when not reused), `POST /api/variant-image` is fired in parallel using the screenshot promise. The system waits up to 1.2s before opening the drawer to seed the image into the first section render.
4. **Unified cart retry** (`addToCartWithRetry()` / shared `retryCartAdd()` helper used by both Add to Cart and Buy Now):
   - POST `/cart/add.js` with variant ID + sections
   - If 422 ("sold out" / variant not propagated) → retry with **exponential backoff + jitter** (~570ms, ~1.1s, ~2.3s; ~4s worst case vs prior 9s linear)
   - If 429 rate limit → retry with longer backoff
   - If 200 OK → check price on the specific variant via `findTargetCartItem(cartData, variantId)`: price > 0 = success, price = 0 = enter price-wait phase
   - Price-wait phase: poll `/cart.js` for non-zero price on our variant (mobile timeouts: 8s for add, 10s for buy — networks slower for variant propagation)
   - One timeout budget (25s default, 30s on iPhone Safari)
   - Propagation timeout → `continueCartPreparationUntilVerified()` polls in background until price confirmed; user is **never shown a "sold out" error** — friendly "try again" message only on real failure
5. **Section readiness check** (`waitForUsableRenderedSections()`):
   - Fetches rendered cart drawer sections from Shopify
   - Rejects sections containing `$0` or `$0.00`
   - Tries seed sections first (bundled from cart/add response), then fresh fetches
6. **Apply sections, then open drawer** — sections are applied to the DOM **before** the drawer opens (not after). Once open, the drawer DOM is **never replaced via `innerHTML`** (that destroys event listeners, scroll lock, and open state). All subsequent updates dispatch cart events for the theme to react to.
7. **Mobile drawer**: On mobile the drawer is lazy-loaded — DOM doesn't exist until opened. Flow is open-first, then apply section updates after a 300ms delay, then fetch a fresh `/cart.js` with sections and dispatch events.
8. **Post-open image refresh**: If the image upload completes after the drawer opens, fresh sections are fetched and cart events are dispatched (no DOM replacement) so the theme can re-render with the image.

### Key Design Decisions

- **$0 prevention**: Sections are validated before display. If $0 is detected, sections are rejected and re-fetched. Never shows $0 to user.
- **Price check on specific variant**: Uses `findTargetCartItem(cartData, variantId)` to check OUR variant's price, not the overall cart total.
- **No exact price text match**: Section validation only checks for `$0` presence, NOT for exact expected price text. This avoids false rejections when quantity > 1 (line total differs from unit price).
- **429 is retryable**: Shopify's storefront rate limit is retried with backoff, never surfaced as error to user.
- **Non-blocking drawer**: Drawer opens immediately after `/cart/add.js` returns 200 with non-zero price — price/image sync happens in the background after open. No more waiting on slow propagation before showing the cart.
- **Drawer DOM preservation**: After the drawer is open, **never** call `applySectionUpdates()` (which replaces `innerHTML`) — only dispatch cart events. Replacing innerHTML caused the drawer to close instantly and broke scroll lock cleanup.
- **Labels hidden during screenshot**: Dimension labels (A/B/C measurement arrows + side labels) are toggled off for the capture frame so the cart thumbnail isn't cluttered. State is restored in a `finally` block.

### Buy Now Flow

Same as Add to Cart but:
1. Calls `/cart/clear.js` first (clears existing cart — standard Shopify "Buy Now" behavior)
2. 300ms pause after clear to avoid 429
3. No sections needed (redirects to `/checkout` instead of opening drawer)
4. Image upload is `await`ed before redirect (prevents mobile browser from cancelling in-flight request)

### API Reachability & Connection Warm-Up

`loadPricingFromAPI()` (in `src/config/pricing.ts`) retries up to **3× with backoff** on cold-start / network failure and tracks reachability via `isApiReachable()`. If pricing never loaded (poisoned HTTP/2 connection pool to Vercel), Add to Cart / Buy Now first **warm up the connection** before posting — this prevents instant `Failed to fetch` errors caused by a broken connection from a silent earlier failure.

---

## Dynamic Pricing (Google Sheets)

Pricing constants are stored in a Google Sheet and fetched at two points:
1. **Client-side** (`loadPricingFromAPI`): On app startup, fetches via `GET /api/pricing` for real-time price display
2. **Server-side** (`add-to-cart.ts` / `create-order.ts`): Re-fetches directly from Google Sheets API before creating the variant/order (tamper-proof)

When remote pricing loads, the Zustand store's `onPricingLoaded` callback triggers a price recompute.

**Fallback**: If Google Sheets is unreachable (network error, API down), `lib/pricing-sheet.ts` returns hardcoded `DEFAULT_PRICING` constants and logs a warning. The configurator continues to work with default prices.

### Google Sheet Structure

The sheet uses a key-value format with rows like:

| Key prefix | Example | Description |
|------------|---------|-------------|
| `EXT_ANCHOR` | 489.33 | Model coefficient |
| `EXT_S_W`, `EXT_S_L`, `EXT_S_AREA` | varies | Model coefficients for pricing |
| `HOLE_PRICE` | 25 | Per-hole surcharge |
| `SKIRT_SURCHARGE` | 75 | Applied if skirt >= threshold |
| `SKIRT_THRESHOLD` | 6 | Inches |
| `PAINTED_MULTIPLIER` | 1.5 | Powder coat multiplier |
| `GAUGE_*` | GAUGE_24=1.0, GAUGE_10=3.4 | Gauge multipliers |
| `MAT_*` | MAT_galvanized=1.0, MAT_copper=3.0 | Material multipliers |
| `SC_*` | SC_40=30, SC_100=60 | Storm collar prices by size (tenths of inches) |
| `COEF_*` | varies | Model coefficients |

Changes take effect within **5 minutes** (server cache TTL). No code changes or redeployment needed.

---

## Pricing Formula

**Files**: `src/utils/pricing.ts` (shared) + `store/configStore.ts` (client) + `api/add-to-cart.ts` (server)

The pricing formula is implemented in `computePricingBreakdown()` which is shared between client and server. See `src/utils/pricing.ts` for the full implementation.

**Powder coat**: Charged only when `pc === true && mat !== 'copper'`. When copper is selected, powder coat state is preserved in the store but the charge and color swatch are not applied.

**Gauge multipliers**: 24ga=1.0, 20ga=1.3, 18ga=1.4, 16ga=1.6, 14ga=1.8, 12ga=2.7, 10ga=3.4

**Material multipliers**: Galvanized=1.0, Copper=3.0

---

## Variant System

### Deterministic Hashing (`configHash` in `api/add-to-cart.ts`)

Each configuration produces a deterministic hash using FNV-1a:
- Config values are snapped to 1/8" (`r8 = Math.round(n * 8) / 8`) to prevent floating-point drift
- Hash input includes: dimensions, material, gauge, toggles, holes, collar settings, price
- Hash format: `CC-XXXXXXXX` (8-char hex)
- Same config + same price = same hash → variant reused (no propagation delay)

### Variant Lifecycle

1. **Creation**: Via `productVariantsBulkCreate` GraphQL mutation
2. **Propagation**: New variants take ~9-10s to appear on Shopify's storefront (eventual consistency)
3. **Reuse**: Identical configs reuse existing variants — instant, no propagation needed
4. **Cleanup**: Proactive cleanup at 95+ variants (target: 85), emergency cleanup on 422, cron every 3 days
5. **Limit**: Shopify Basic plan = 100 variants max. Do NOT raise above 100.

### Image Attachment

- 3D canvas is captured as JPEG (white background composite) via `captureCanvasScreenshot()` with `hideLabels: true`
- Uploaded to Shopify via `POST /api/variant-image` (separate from variant creation)
- Attached to the variant so it appears in cart drawer and checkout
- For Add to Cart: capture begins immediately; upload starts as soon as the variant ID is known. The flow waits up to 1.2s for the upload before opening the drawer (so the first section render can include the image). If still pending, drawer opens and sections are refreshed via cart events when the upload completes.
- Upload is `await`ed for Buy Now (prevents mobile browser from cancelling mid-flight)

---

## PDF Generation

Users can download a PDF specification/pricing worksheet via the "Download PDF" button in `CartRow.tsx`.

### How It Works

1. `PdfReport.tsx` renders a hidden HTML report off-screen (`position: absolute; top: -9999px`)
2. The report includes:
   - Kaminos header with date and order number field
   - Top-down SVG drawing of the cover with holes positioned using `holeWorld()` from `geometry.ts`
   - Dimensions, hole configurations, material, gauge, options
   - Pricing summary (unit price, quantity, total)
3. `pdfGenerator.ts` uses `html2canvas` to capture the hidden element, then `jsPDF` to create a letter-size PDF
4. File is downloaded as `KAMINOS-ChaseCover-YYYY-MM-DD.pdf`

---

## Dimension Limits

| Field | Min | Max | Default | Unit | Snap |
|-------|-----|-----|---------|------|------|
| Length | 16 (dynamic) | 120 | 60 | inches | 1/8" |
| Width | 16 (dynamic) | 60 | 48 | inches | 1/8" |
| Skirt | 1 | 12 | 3 | inches | 1/8" |

Note: The sidebar shows **Length first, then Width** (this order was intentional UX — matches typical how-to-measure instructions).

**Dynamic minimums** (`DimensionField.tsx`):
- Width min = max(16, `largestHoleDia + 1"`)
- Length min depends on hole count:
  - 1 hole: max(16, `diaA + 1"`)
  - 2 holes: max(16, `diaA + diaB + 2"`, `2*diaA + 2"`, etc.)
  - 3 holes: similar but with 3 hole diameters

All inputs snap to nearest 1/8 inch.

---

## Hole Placement Logic

### Holes (0-3)
Each hole has: shape (round/rect), diameter or rect dimensions (3-30"), collar height (1-52"), centered flag, 4 offsets, storm collar toggle (round only).

### Hole Shapes
- **Round**: Defined by `dia` (diameter in inches). Shown as `⌀10"` in UI and order.
- **Rectangle**: Defined by `rectWidth` × `rectLength`. Shown as `8" × 8" rect` in UI and order.
- **Storm collar**: Only available for round holes. Hidden in UI when hole shape is `rect`.

### Centered Mode
When centered, holes auto-position along the Z axis (length direction):
- **1 hole**: center of cover (0, 0)
- **2 holes**: spaced at +/-L/4 from center (or further if diameters require it)
- **3 holes**: A at +L/3, B at center (0), C at -L/3 (adjusted for diameter)

**Overlap prevention**: Centered holes enforce a minimum gap of 1" between hole edges:
```
spacing = max(defaultSpacing, radiusA + radiusB + 1")
```

**Centered → Manual toggle (no drift)**: When unchecking "Centered on Cover", the current world position is precisely converted to offsets with no rounding, preventing any visible position change.

### Manual Offset Mode
When "Centered on Cover" is unchecked, user controls 4 offsets:

| Label | Offset Key | Meaning |
|-------|-----------|---------|
| X1 (Top) | offset3 | Distance from top edge to hole edge |
| X2 (Right) | offset4 | Distance from right edge to hole edge |
| X3 (Bottom) | offset1 | Distance from bottom edge to hole edge |
| X4 (Left) | offset2 | Distance from left edge to hole edge |

**Collision detection** (`CollarGroup.tsx:clampForCollision`):
When editing offsets, the system checks distance to all other holes and ensures `dist >= r1 + r2 + 1"`. If violated, the proposed offset is pushed back to maintain the gap.

**Offset constraints**: Each offset is clamped to `[0, coverDim - holeDia]`.

### Drag-to-Move Holes (3D Viewport)

When holes > 0, a **"Move Holes"** button appears in the viewport toolbar. Clicking it enters move mode:
- Each hole shows an orange ring handle at the top of its collar
- Dragging the handle repositions the hole in real-time using raycasting against a horizontal plane
- Orbit is disabled while dragging
- Collision detection prevents holes from overlapping during drag
- If the final position is invalid (still overlapping after all clamping), the hole reverts to its start position

---

## Dim-Overlay (Top-Right Info Box)

Collapsed state: ruler icon button (SVG, grey, no background). Clicking opens the overlay.

Expanded state shows:
```
48" W x 60" L x 3" Skirt
H1: ⌀10" (on center)
H1: ⌀10" [A1: 5" A2: 8" A3: 5" A4: 8"]
```

When not centered, shows all 4 offsets: A1=offset3 (Top), A2=offset4 (Right), A3=offset1 (Bottom), A4=offset2 (Left).

---

## 3D Label System (DimensionOverlay)

Labels float above the model using `@react-three/drei Html` components with `distanceFactor={8}` for stable sizing. Each hole shows 4 measurement arrows:
- Arrow from each edge to the hole perimeter (not center)
- Color coded: A=yellow (#facc15), B=sky blue (#38bdf8), C=green (#4ade80)
- Arrows have heads at both ends

Side labels (Top/Right/Bottom/Left) shown when "Show Side Labels" is checked and holes > 0.

Per-hole labels are individually toggleable via "Show Labels" checkbox.

---

## 3D Geometry (`geometry.ts`)

### Scale
`SC = 0.02` — world units per inch. All calculations convert inches to world units.

### Gauge Thickness (inches)
10ga=0.1345, 12ga=0.1046, 14ga=0.0747, 16ga=0.0598, 18ga=0.0478, 20ga=0.0359, 24ga=0.0239

### Model Components

1. **Lid (top surface)**:
   - **Flat** (diag off): `ExtrudeGeometry` rectangle with circular/rectangular holes via `Shape.holes`
   - **Sloped** (diag on): 60x60 tessellated grid. Height at each point: `edgeY + SLOPE * (1 - max(|px|, |pz|))` where px/pz are normalized coords (Chebyshev distance). Vertices near diagonals snap to create sharp crease lines. Triangle edges align along diagonals for visible ridges. SLOPE = `sqrt(W^2 + L^2) * 0.035`.

2. **Skirt**: 4 `BoxGeometry` panels around the perimeter, height = skirt value.

3. **Drip Edge**: 4 beveled strips (0.5" out, 0.5" down at 45deg) as custom `BufferGeometry` quads.

4. **Collars**: Custom `BufferGeometry` cylinders (48 segments) for round holes; rectangular collar geometry for rect holes. Bottom vertices follow `getRoofY()` for smooth intersection with sloped roof. Top ring cap via `RingGeometry`.

5. **Storm Collars**: Optional cylindrical flashing rings rendered above the collar opening. Price varies by hole diameter (looked up from Google Sheet `SC_*` rows). Only available for round holes.

6. **Bottom face** (sloped mode only): Flat `ExtrudeGeometry` with hole cutouts at skirt height. Uses `three-csg-ts` CSG operations for hole subtraction.

### Hole Cutouts on Sloped Roof
Grid vertices near hole boundaries snap to the hole radius/rect boundary. Triangles inside holes or entirely on the hole boundary are culled.

---

## AR System (`ar.ts`)

### Export
`exportToGLB(group)`: Clones the scene group, scales to real-world meters (0.0254/SC), strips environment maps, exports as base64 GLB via `GLTFExporter`.

### Serialization
`getConfigState(config)`: Serializes config to base64 JSON for URL hash. Includes dimensions, toggles, and per-hole collar settings.

`applyConfigState(base64)`: Restores config from URL hash on page load (mobile AR flow).

### Flow (Desktop)
1. Clicking "View in AR" generates a QR code with the current config serialized in the URL hash
2. The URL uses the page's canonical `<link>` if available (avoids Shopify preview paths that 404)
3. Mobile user scans QR → page loads with `#ar=` hash → config restored → AR prompt shown

### Flow (Mobile)
- On mobile (`window.innerWidth <= 767` or `Mobi|Android|iPhone` UA), clicking the AR icon in the bottom-left launches AR directly (bypasses QR code)
- `<model-viewer>` is loaded dynamically on first AR trigger
- GLB exported from scene → passed to `<model-viewer>` for WebXR/Scene Viewer

### model-viewer
The `<model-viewer>` element is portaled to light DOM on Shopify (via `#chase-cover-configurator-portal`) because AR requires light DOM to work through Shadow DOM.

---

## Materials

Material rendering is handled by `mkMat()` in `geometry.ts`. The result is memoized in `ChaseModel.tsx` via `useMemo` keyed on `mat`, `pc`, `pcCol`.

Priority order:
1. **Copper** (`mat === 'copper'`): Always renders copper color, regardless of powder coat state — `color=#e09a72, metalness=0.85, roughness=0.15`
2. **Powder Coat** (`mat === 'galvanized' && pc === true`): User-selected color — `metalness=0.3, roughness=0.6`
3. **Galvanized** (default): `color=#b8c4cc, metalness=0.9, roughness=0.25`

**Powder coat + copper behavior**: When switching to copper, the `pc` boolean is preserved in state but copper color is always shown. When switching back to galvanized, if `pc` was true before, the powder coat color is automatically shown again. The powder coat section is hidden in the sidebar while copper is selected.

---

## State Management (Zustand)

Single store `useConfigStore` with flat state. Mutation methods:
- `set(partial)`: Updates any top-level config and recomputes price
- `setCollar(id, partial)`: Updates a specific collar (A/B/C) and recomputes price
- `setOrbitEnabled(v)`: Enables/disables orbit controls (disabled during hole dragging)

Defaults: W=48, L=60, Skirt=3, 1 hole, 10" dia, 2" collar height, centered, galvanized, 24ga, drip on, diagonal crease on.

On startup, `loadPricingFromAPI()` fetches remote pricing. When it resolves, `onPricingLoaded()` triggers a price recompute in the store so the displayed price reflects the latest Google Sheet values.

### Session Config Restore (Back-from-Cart)

**No Zustand `persist` middleware is used.** Config is stored in `sessionStorage` only when the user clicks "Add to Cart" or "Buy Now" and is about to be redirected:

```
saveConfigForRestore()   → saves config to sessionStorage key 'chase-cover-restore'
```

On page mount, `restoreConfigIfNeeded()` is called:
- If the key exists → restore the config and **immediately delete the key**
- If the key doesn't exist → load defaults

**Result**:
- Manual page refresh → defaults (key was never set or was already cleared)
- Back from cart/checkout → config restored (key was set before redirect)
- Refresh after back → defaults (key was cleared on first restore)

---

## Entry Points

### Standalone SPA (`main.tsx`)
- Used for local dev (`npm run dev`) and the Vercel-hosted standalone page
- Renders `<App>` into `#root`
- Calls `loadPricingFromAPI(window.location.origin)` on startup
- No Shadow DOM; uses `globals.css` directly

### Shopify IIFE (`shopify-entry.tsx`)
- Built via `npm run build:shopify` (BUILD_TARGET=shopify)
- Self-executing IIFE that:
  1. Patches iOS viewport (prevents zoom on input focus)
  2. Injects Google Fonts + QRious into document head
  3. Finds `<chase-cover-configurator>`, `<chase-configurator>`, `#chase-cover-configurator-mount`, or `#chase-configurator-mount`
  4. **Applies a responsive mount height** — desktop (≥768px) overrides the inline height to `max(640px, 80vh)` so the configurator fills more of the viewport on large screens; mobile keeps the original inline/`100%` height. Re-applies on `resize`, `load`, and at +250ms / +1000ms to handle Shopify themes that reflow late.
  5. Attaches Shadow DOM with `globals-scoped.css` injected as `<style>`
  6. Creates a light-DOM portal container for AR/QR overlays with portal-scoped CSS in `<head>`
  7. Detects API base URL from the script's own `src` attribute
  8. Reads `product-id` and `variant-id` attributes from the mount element
  9. Calls `loadPricingFromAPI(apiBase)` and renders `<App>` into shadow root

### Legacy Web Component (`web-component.tsx`)
- Not used in current production flow
- Defines a `<chase-cover-configurator>` custom element with Shadow DOM

---

## UI Breakpoints & Responsive Behavior

| Breakpoint | Behavior |
|-----------|---------|
| > 767px | Desktop layout: side-by-side 3D viewer + sidebar |
| ≤ 767px | Mobile layout: stacked viewer (top) + sidebar (bottom), draggable divider |

- **iPad** (768px+) intentionally gets the **desktop layout** (sidebar always visible)
- Mobile: viewer height defaults to 40% of screen, adjustable by dragging the divider handle
- Mobile: AR button is a round icon (bottom-left of viewport), not text
- Shopify embed (desktop): mount element height is overridden to `max(640px, 80vh)` by `shopify-entry.tsx` so the configurator fills most of the viewport on Kaminos product pages

---

## Cart UI (CartRow, Sidebar)

**File**: `src/components/sidebar/CartRow.tsx`

The cart row sits at the bottom of the sidebar and matches the styling of Kaminos product pages (Dawn theme conventions).

### Quantity Selector

- Dawn-style: `Quantity` label on the left, then `−` / number input / `+` controls
- Cap: `MAX_QTY = 10`
- Input uses `font-size: 16px` on mobile to prevent iOS zoom on focus
- Empty input is allowed during typing; commits the previous value if left empty

### Add to Cart Button

- Color: tan **`#C9A870`** with white **fill-from-bottom** hover animation; text color animates from white → tan on hover
- Lowercase **"Add to cart"** label (matches Kaminos convention)
- Heights: 46px desktop / 44px mobile
- Font sizes: 16px desktop / 14px mobile
- Disabled state palette matches the new tan scheme; loading states cycle through `Preparing... → Adding... → Finalizing... → Almost there...`

### Buy with Shop Button

- Color: Shopify purple **`#5a31f4`** with subtle opacity-darken hover (no fill animation)
- Uses the **official Shop wordmark SVG** inlined from Shopify's shop-js CDN bundle (italic "shop" with bag-handle "o"). Embedded directly as React component (`ShopLogo`) so it renders inside the Shadow DOM. **No "Pay" wordmark** — just the Shop wordmark.
- Same height/font sizing as Add to Cart for visual consistency
- Loading states: `Preparing... → Preparing checkout... → Finalizing... → Almost there... → Off we go!`

### Sidebar Price Section

- The expandable **"Price Breakdown"** panel was **removed** in commit `7695a1c`. The sidebar now only renders `<PriceDisplay />` (estimated total) above the cart row. The shared `computePricingBreakdown()` is still used internally and on the server for variant pricing — it's just no longer surfaced as a UI accordion.

---

## Debugging

### Client-Side Debug Logging

All `console.log` calls in `App.tsx` are gated behind `window.__chaseDebug`. To enable verbose cart/image logging:

```javascript
window.__chaseDebug = true
```

This shows tagged logs like `[CART]`, `[IMG]`, `[BUY]` with timing breakdowns. `console.warn` and `console.error` are always visible.

### Server-Side Debug Telemetry

The client sends debug events to `POST /api/cart-debug` via `emitCartDebug()`. These include:
- API results, retry attempts, section readiness
- Cart DOM snapshots, section mount points
- Image upload status
- Drawer open/close events

These are visible in Vercel function logs.

### Origin Validation

API handlers log warnings for requests from unknown origins via `warnUnknownOrigin()` in `lib/shopify-auth.ts`. Known origins: kaminos.com, chase-cover-configurator*.vercel.app, localhost.

---

## Key Decisions & History

- **Variant-based cart flow**: The primary cart flow uses Shopify product variants (not Draft Orders). Each config creates a deterministic variant on a single product. This integrates naturally with Shopify's cart, checkout, and order system.
- **Shopify auth**: `client_credentials` fails when app org ≠ store org. Use static `SHOPIFY_ACCESS_TOKEN` from a **Store Admin custom app** (created in the client store's Admin > Settings > Apps > Develop apps). Auth is shared via `lib/shopify-auth.ts`.
- **CSS isolation**: Shadow DOM used for Shopify embedding. `globals-scoped.css` is auto-synced from `globals.css` via a pre-build script — only ever edit `globals.css`.
- **Hole position drift fix**: Unchecking "Centered on Cover" previously caused slight position drift due to 1/8" rounding. Fixed by removing rounding in the centered→offset conversion.
- **Copper + powder coat**: Copper material always renders copper color. The `pc` boolean state is preserved so switching back to galvanized re-applies the powder coat color.
- **Session persistence**: Zustand `persist` middleware was removed. Config is now saved to `sessionStorage` only immediately before cart redirect, and cleared immediately after restoration. This gives "back from cart restores config" without "refresh loads last session".
- **Cart image**: 3D canvas is captured as JPEG (white background composite) and uploaded to Shopify via `stagedUploadsCreate` + product image REST API. Requires `write_files` scope. Fails silently — cart is always updated even if image upload fails.
- **$0 price prevention**: Cart drawer sections are validated before display. Sections containing `$0` are rejected and re-fetched (up to 18s total). Never redirects to `/cart` page (which would also show $0).
- **429 rate limiting**: Shopify storefront 429s are retried with backoff (not treated as errors). Users never see rate limit messages.
- **Storm collar for rect holes**: Storm collar toggle is completely hidden (not just disabled) when hole shape is rectangle. Switching shape to rect auto-disables storm collar.
- **Variant limit**: Shopify Basic plan = 100 variants max. Do NOT raise above 100. Proactive cleanup runs at 95+, emergency cleanup on 422.
- **Google Sheets fallback**: If Google Sheets is unreachable, pricing falls back to hardcoded defaults in `lib/pricing-sheet.ts`. The configurator keeps working rather than breaking.
- **Image size limit**: Server rejects images > ~500KB to prevent OOM (413 response).
- **Drawer DOM never replaced after open**: A previous bug closed the drawer instantly because `applySectionUpdates()` replaced `innerHTML` on an open drawer, destroying event listeners and scroll lock cleanup. Fix: apply sections **before** opening; once open, only dispatch cart events. Background price polling and post-image refresh dispatch events instead of replacing DOM.
- **Drawer opens immediately on success**: Previously waited for full price/section verification before opening. Now the drawer opens as soon as `/cart/add.js` returns 200 with non-zero price; price/image sync continues in the background.
- **Exponential backoff with jitter**: Cart add retries use `~570ms / ~1.1s / ~2.3s` exponential backoff (worst case ~4s) instead of the prior linear `1.5s / 3s / 4.5s` (worst case ~9s).
- **No "sold out" error to user**: Variant propagation 422s are a Shopify timing issue, not real stock. User sees a friendly "try again" message only on real failure, never raw "sold out".
- **RAL code in cart**: Cart line items show the human-readable RAL name + code (e.g. `Ruby Red (RAL 3002)`) instead of the hex value. Server does the hex → RAL lookup before creating/reusing the variant.
- **Pricing API retry + connection warm-up**: `loadPricingFromAPI()` retries 3× with backoff and tracks reachability. If the initial pricing fetch silently failed, Add to Cart / Buy Now warm up the HTTP/2 connection to Vercel before posting — fixes "Failed to fetch" caused by a poisoned connection pool from a cold-start failure.
- **Sidebar Price Breakdown removed**: The expandable breakdown accordion was removed from the sidebar; only `PriceDisplay` (estimated total) is shown above the cart row.
- **Cart button styling**: Tan `#C9A870` Add to Cart with hover fill animation; purple `#5a31f4` Buy with Shop using the official Shop wordmark SVG (no "Pay"). Heights 46px desktop / 44px mobile, font 16px desktop / 14px mobile to match Kaminos product pages.
- **Screenshot hides labels**: Dimension labels (A/B/C arrows + side labels) are temporarily toggled off during canvas capture so the cart thumbnail/preview is clean. State is restored in a `finally` block.
- **Responsive mount height**: `shopify-entry.tsx` overrides the mount element height on desktop (≥768px) to `max(640px, 80vh)` so the configurator fills most of the viewport on Kaminos product pages.
