import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchPricingFromPublicSheet } from '../lib/pricing-sheet.js';
import { getShopifyAccessToken, SHOPIFY_STORE, warnUnknownOrigin } from '../lib/shopify-auth.js';
import { RAL_COLORS } from '../src/config/ralColors.js';
import { computeCapPriceBreakdown } from '../src/utils/capPricing.js';
import { appendCartLogRow } from '../lib/cart-log.js';

const GOOGLE_SHEET_ID = (process.env.GOOGLE_SHEET_ID || '').trim();
const SHOPIFY_PRODUCT_ID = (process.env.SHOPIFY_PRODUCT_ID || '').trim() || undefined;

/* ------------------------------------------------------------------ */
/*  Types — must mirror the client payload in App.tsx (onAddToCart)    */
/* ------------------------------------------------------------------ */

interface CapOrderConfig {
    // Style
    mount: 'skirt' | 'pitched_skirt' | 'top_mount';
    lid_type: 'flat' | 'hip' | 'hip_ridge' | 'standing_seam';

    // Dimensions (inches, 1/8" snap)
    width: number;
    length: number;
    vertical_skirt: number;
    horizontal_skirt: number;
    drip_edge: boolean;
    flange_width: number;

    // Lid
    lid_overhang: number;
    lid_pitch: number;
    seam_count: number;

    // Cage / Finish
    screen_height: number;
    material: 'stainless' | 'copper';
    powder_coat: boolean;
    powder_coat_color: string;

    // Order
    quantity: number;
    notes: string;
    shopifyProductId?: string;
    shopifyVariantId?: string;
    image?: string;
    /** Client-generated id, reused across retry attempts, for client↔server log correlation. */
    requestId?: string;
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function formatFrac(n: number): string {
    if (!Number.isFinite(n)) return String(n);
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const whole = Math.floor(abs);
    const eighths = Math.round((abs - whole) * 8);
    if (eighths === 0) return `${sign}${whole}`;
    if (eighths === 4) return `${sign}${whole} 1/2`;
    if (eighths === 2) return `${sign}${whole} 1/4`;
    if (eighths === 6) return `${sign}${whole} 3/4`;
    return `${sign}${whole} ${eighths}/8`;
}

const MOUNT_LABEL: Record<CapOrderConfig['mount'], string> = {
    skirt: 'Standard Skirt',
    pitched_skirt: 'Pitched Skirt',
    top_mount: 'Top Mount',
};

const LID_LABEL: Record<CapOrderConfig['lid_type'], string> = {
    flat: 'Flat',
    hip: 'Hip',
    hip_ridge: 'Hip & Ridge',
    standing_seam: 'Standing Seam',
};

function getMaterialLabel(mat: string): string {
    if (mat === 'copper') return 'Copper';
    return 'Stainless Steel';
}

function getColorLabel(hex: string): string {
    const lower = (hex || '').toLowerCase();
    const ral = RAL_COLORS.find(c => c.hex.toLowerCase() === lower);
    return ral ? `${ral.name} (${ral.ral})` : `Custom Color (${hex})`;
}

/* ------------------------------------------------------------------ */
/*  Server-side cap pricing — same shared implementation as the client */
/*  (src/utils/capPricing.ts), called with sheet-fetched pricing so it */
/*  stays tamper-proof. The chase math in `src/utils/pricing.ts` is    */
/*  NOT used for the cap.                                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Line-item properties shown in Shopify cart / order                 */
/* ------------------------------------------------------------------ */

function buildCartProperties(c: CapOrderConfig): { key: string; value: string }[] {
    const isTopMount = c.mount === 'top_mount';
    const props: { key: string; value: string }[] = [
        { key: 'Mount Style', value: MOUNT_LABEL[c.mount] || c.mount },
        { key: 'Lid Type', value: LID_LABEL[c.lid_type] || c.lid_type },
        { key: 'Dimensions', value: `${formatFrac(c.length)}" L × ${formatFrac(c.width)}" W` },
    ];

    if (!isTopMount) {
        props.push({
            key: 'Skirt',
            value: `Vertical ${formatFrac(c.vertical_skirt)}" × Horizontal ${formatFrac(c.horizontal_skirt)}"`,
        });
        props.push({ key: 'Drip Edge', value: c.drip_edge ? 'Yes' : 'No' });
    } else {
        props.push({ key: 'Flange Width', value: `${formatFrac(c.flange_width)}"` });
    }

    props.push({ key: 'Screen Height', value: `${formatFrac(c.screen_height)}"` });

    if (c.lid_type !== 'flat') {
        props.push({ key: 'Lid Pitch', value: `${c.lid_pitch}/12` });
    }
    props.push({ key: 'Lid Overhang', value: `${formatFrac(c.lid_overhang)}"` });

    props.push({ key: 'Material', value: getMaterialLabel(c.material) });
    if (c.powder_coat && c.material !== 'copper') {
        props.push({ key: 'Powder Coat', value: getColorLabel(c.powder_coat_color) });
    }

    if (c.notes) {
        props.push({ key: 'Special Notes', value: c.notes });
    }

    // Hidden metadata (underscore-prefixed properties are hidden in Shopify cart/checkout UI).
    props.push({ key: '_config_json', value: JSON.stringify({ ...c, image: undefined }) });
    return props;
}

/* ------------------------------------------------------------------ */
/*  Deterministic variant hash + Shopify Admin API helpers              */
/* ------------------------------------------------------------------ */

/** Snap to 1/8" so the same visual config always produces the same hash. */
const r8 = (n: number) => Math.round((n || 0) * 8) / 8;

function configHash(c: CapOrderConfig, price: string): string {
    const pc = c.powder_coat && c.material !== 'copper';
    const isTopMount = c.mount === 'top_mount';
    const canonicalObj = {
        m: c.mount, lt: c.lid_type,
        w: r8(c.width), l: r8(c.length),
        vs: isTopMount ? 0 : r8(c.vertical_skirt),
        hs: isTopMount ? 0 : r8(c.horizontal_skirt),
        de: isTopMount ? false : !!c.drip_edge,
        fw: isTopMount ? r8(c.flange_width) : 0,
        sh: r8(c.screen_height),
        lo: r8(c.lid_overhang),
        lp: c.lid_type === 'flat' ? 0 : r8(c.lid_pitch),
        sc: c.lid_type === 'standing_seam' ? c.seam_count : 0,
        mat: c.material,
        pc, pcCol: pc ? c.powder_coat_color : null,
        price,
    };
    const canonical = JSON.stringify(canonicalObj);
    console.log('[CART] Hash input (canonical):', canonical);
    let h = 2166136261;
    for (let i = 0; i < canonical.length; i++) {
        h ^= canonical.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

async function fetchAllVariants(productId: string, accessToken: string): Promise<any[]> {
    try {
        const res = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants.json?limit=250`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return data.variants || [];
    } catch {
        return [];
    }
}

function findInVariants(variants: any[], hash: string, price: string): string | null {
    const target = `MFC-${hash}`;
    const found = variants.find((v: any) => v.option1 === target && v.price === price);
    return found ? String(found.id) : null;
}

/* ---- Proactive variant cleanup (same policy as chase) ---- */
const VARIANT_LIMIT = 100;
const TRIGGER_AT   = 95;
const TARGET_COUNT = 85;

async function proactiveCleanup(productId: string, accessToken: string, variants: any[]): Promise<void> {
    const total = variants.length;
    if (total < TRIGGER_AT) return;
    const MIN_AGE_MS = 24 * 60 * 60 * 1000;
    const candidates = variants
        .filter(v => String(v.option1 || '').startsWith('MFC-') && (Date.now() - new Date(v.created_at).getTime()) > MIN_AGE_MS)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const toDelete = candidates.slice(0, Math.max(0, total - TARGET_COUNT));
    if (toDelete.length === 0) {
        console.log(`[CART] Buffer cleanup triggered (${total}/${VARIANT_LIMIT}) but no eligible (< 24h old)`);
        return;
    }
    console.log(`[CART] Buffer cleanup: ${total}/${VARIANT_LIMIT} — deleting ${toDelete.length} oldest MFC-* variants`);
    let deleted = 0;
    for (const v of toDelete) {
        const delRes = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants/${v.id}.json`,
            { method: 'DELETE', headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        if (delRes.ok) {
            deleted++;
            if (v.image_id) {
                await fetch(
                    `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/images/${v.image_id}.json`,
                    { method: 'DELETE', headers: { 'X-Shopify-Access-Token': accessToken } }
                ).catch(() => {});
            }
        }
    }
    console.log(`[CART] Buffer cleanup done: freed ${deleted} slots`);
}

async function emergencyCleanup(productId: string, accessToken: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    console.log('[CART] Emergency cleanup for product', productId);
    try {
        const res = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants.json?limit=250`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        if (!res.ok) return 0;
        const data = await res.json();
        const cutoff = Date.now() - maxAgeMs;
        let deleted = 0;
        for (const v of data?.variants || []) {
            if (!String(v.option1 || '').startsWith('MFC-')) continue;
            if (new Date(v.created_at).getTime() >= cutoff) continue;
            const delRes = await fetch(
                `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants/${v.id}.json`,
                { method: 'DELETE', headers: { 'X-Shopify-Access-Token': accessToken } }
            );
            if (delRes.ok) deleted++;
        }
        return deleted;
    } catch (err: any) {
        console.error('[CART] Emergency cleanup error:', err.message);
        return 0;
    }
}

/* ---- GraphQL helpers + variant creation ---- */

async function shopifyGraphQL(query: string, accessToken: string, variables?: Record<string, any>): Promise<any> {
    const res = await fetch(
        `https://${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ query, variables }),
        }
    );
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { errors: [{ message: text.slice(0, 300) }] }; }
}

const cachedOptionNames = new Map<string, string>();

async function getProductOptionName(productId: string, accessToken: string): Promise<string> {
    const cached = cachedOptionNames.get(productId);
    if (cached) return cached;
    try {
        const gid = `gid://shopify/Product/${productId}`;
        const result = await shopifyGraphQL(
            `{ product(id: "${gid}") { options(first: 1) { name } } }`,
            accessToken
        );
        const name = result?.data?.product?.options?.[0]?.name;
        if (name) {
            cachedOptionNames.set(productId, name);
            return name;
        }
    } catch (e: any) {
        console.warn('[CART] getProductOptionName failed:', e.message);
    }
    return 'Title';
}

interface VariantCreateResult { ok: boolean; variantId?: string; error?: string; status?: number }

async function createVariant(
    productId: string,
    price: string,
    accessToken: string,
    optionName: string,
    hash: string
): Promise<VariantCreateResult> {
    const optionValue = `MFC-${hash}`;
    const gid = `gid://shopify/Product/${productId}`;
    const t0 = Date.now();
    const mutation = `
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
                productVariants { id inventoryItem { tracked } inventoryPolicy }
                userErrors { field message }
            }
        }
    `;
    const variables = {
        productId: gid,
        variants: [{
            optionValues: [{ optionName, name: optionValue }],
            price,
            inventoryPolicy: 'CONTINUE',
            inventoryItem: { tracked: false },
        }],
    };

    const result = await shopifyGraphQL(mutation, accessToken, variables);
    console.log('[CART] GraphQL variant create:', Date.now() - t0, 'ms');

    if (result?.errors?.length) {
        const errMsg = result.errors.map((e: any) => e.message).join('; ');
        return { ok: false, error: `GraphQL error: ${errMsg}`, status: 400 };
    }
    const userErrors = result?.data?.productVariantsBulkCreate?.userErrors || [];
    if (userErrors.length) {
        const errMsg = userErrors.map((e: any) => `${e.field}: ${e.message}`).join('; ');
        const isLimitError = /limit|maximum/i.test(errMsg);
        const isDuplicate = /taken|duplicate|already/i.test(errMsg);
        if (isDuplicate) {
            const existing = findInVariants(await fetchAllVariants(productId, accessToken), hash, price);
            if (existing) return { ok: true, variantId: existing };
        }
        return { ok: false, error: errMsg, status: isLimitError ? 422 : 400 };
    }

    const created = result?.data?.productVariantsBulkCreate?.productVariants?.[0];
    const gidStr = created?.id || '';
    const numericId = gidStr.split('/').pop() || gidStr;
    if (!numericId || numericId === gidStr) {
        return { ok: false, error: 'Could not extract variant ID from GraphQL response', status: 200 };
    }
    return { ok: true, variantId: numericId };
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Always set CORS headers — even on error paths — so a 500 doesn't surface
    // to the browser as an opaque CORS failure.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const handlerStart = Date.now();
        const config: CapOrderConfig = req.body;
        const requestId = (config.requestId || (req.headers['x-request-id'] as string) || '').toString().slice(0, 64);
        console.log('[CART] === Add-to-cart START ===', { requestId, productId: config.shopifyProductId, mount: config.mount, lid: config.lid_type });

        warnUnknownOrigin(req.headers.origin as string | undefined, 'CART');

        if (!config.shopifyProductId && SHOPIFY_PRODUCT_ID) {
            config.shopifyProductId = SHOPIFY_PRODUCT_ID;
        }

        // Validate
        if (!config.width || !config.length || !config.mount || !config.lid_type || !config.material) {
            return res.status(400).json({ error: 'Missing required configuration fields' });
        }
        if (!config.shopifyProductId) {
            return res.status(400).json({ error: 'Missing SHOPIFY_PRODUCT_ID — set in Vercel env or pass product-id on the mount element.' });
        }

        // 1. Auth + pricing in parallel.
        const [accessToken, pricing] = await Promise.all([
            getShopifyAccessToken(),
            fetchPricingFromPublicSheet(GOOGLE_SHEET_ID, 'pricing'),
        ]);

        // 2. Option name (handle fetch removed — it only fed the propagation probe).
        const optionName = await getProductOptionName(config.shopifyProductId, accessToken);

        // 3. Server-side price (tamper-proof — recomputed from sheet pricing, never trusts client).
        const breakdown = computeCapPriceBreakdown(config, pricing);
        // Guard: never create a purchasable variant from degraded pricing. A missed
        // multiplier key (unknown mount/lid combo) or a zeroed margin would silently
        // underprice the order by 3×+ — better to refuse and let the user retry.
        if (!breakdown.multiplierFromSheet || !(pricing.MARGIN_RATE > 0)) {
            console.error('[CART] Degraded pricing — refusing to create variant', {
                multiplierKey: breakdown.multiplierKey,
                multiplierFromSheet: breakdown.multiplierFromSheet,
                marginRate: pricing.MARGIN_RATE,
            });
            return res.status(503).json({ error: 'Pricing is temporarily unavailable. Please try again in a minute.' });
        }
        const unitPrice = breakdown.total;
        const priceStr = unitPrice.toFixed(2);
        console.log('[CART] Server-computed price:', priceStr);

        // 4. Hash → fetch variants → reuse or create.
        const hash = configHash(config, priceStr);
        const allVariants = await fetchAllVariants(config.shopifyProductId, accessToken);
        // Cleanup policy: only block the request when creation would otherwise hit
        // the 100-variant limit. Below that, run it concurrently — it proceeds while
        // we create the variant and poll propagation, and the emergency-cleanup-on-422
        // path still backstops the worst case.
        if (allVariants.length >= VARIANT_LIMIT - 1) {
            await proactiveCleanup(config.shopifyProductId, accessToken, allVariants);
        } else {
            proactiveCleanup(config.shopifyProductId, accessToken, allVariants)
                .catch(e => console.warn('[CART] Background cleanup failed:', e?.message));
        }

        const existingId = findInVariants(allVariants, hash, priceStr);
        // Reused variants created by a failed flow (e.g. Buy Now that died in
        // the cart-confirm phase) may have no screenshot attached — tell the
        // client so it can upload one (image_id comes from the REST variant).
        const existingVariant = existingId ? allVariants.find((v: any) => String(v.id) === existingId) : null;
        let variantId: string | undefined;
        let lastError = '';

        if (existingId) {
            variantId = existingId;
            console.log('[CART] Reusing existing variant:', existingId);
        } else {
            let result = await createVariant(config.shopifyProductId, priceStr, accessToken, optionName, hash);
            variantId = result.variantId;
            lastError = result.error || '';
            if (!result.ok && result.status === 422) {
                const cleaned = await emergencyCleanup(config.shopifyProductId, accessToken);
                if (cleaned > 0) {
                    result = await createVariant(config.shopifyProductId, priceStr, accessToken, optionName, hash);
                    if (result.ok) variantId = result.variantId;
                    else lastError = result.error || '';
                }
            }
        }

        if (!variantId) {
            return res.status(502).json({
                error: `Failed to create variant: ${lastError}`,
                debug: { productId: config.shopifyProductId, store: SHOPIFY_STORE },
            });
        }

        // 5. No server-side propagation wait (removed June 2026, mirroring chase).
        //    It blocked 1–3.5s per new variant and duplicated the client's own
        //    readiness loop (addToCartWithRetry handles 422/$0 with backoff).
        //    `propagated` is true only for reused variants.
        const propagated = !!existingId;

        // 6. Line item properties + response.
        const properties = buildCartProperties(config);
        // Clamp matches the client cap (MAX_QTY = 10 in CartRow.tsx).
        const quantity = Math.max(1, Math.min(10, Math.round(config.quantity || 1)));
        const totalMs = Date.now() - handlerStart;
        console.log('[CART] === DONE ===', { requestId }, totalMs, 'ms');

        // Durable correlation row — ONLY on the new-variant-creation path (the slow
        // path where the client's 30s abort happens; reused variants are instant).
        // Pairing this with a client 'client-failure' row of the same requestId and
        // variantIdObtained=false reveals an orphaned variant. Short timeout (1.5s)
        // so this telemetry can't meaningfully extend an already-slow add.
        if (!existingId) {
            await appendCartLogRow({
                type: 'server-variant-created',
                requestId,
                action: 'add-to-cart',
                variantId,
                serverTimingMs: totalMs,
                device: (req.headers['user-agent'] as string) || null,
                configSummary: {
                    mount: config.mount, lid: config.lid_type,
                    w: config.width, l: config.length,
                    vs: config.vertical_skirt, hs: config.horizontal_skirt,
                    mat: config.material, price: priceStr, hash,
                },
            }, 1500);
        }

        return res.status(200).json({
            success: true,
            requestId,
            variantId,
            variantReused: !!existingId,
            variantHasImage: existingId ? !!existingVariant?.image_id : false,
            propagated,
            quantity,
            price: priceStr,
            properties,
            _timing: { totalMs },
        });
    } catch (err: any) {
        console.error('[CART] Add-to-cart error:', err?.stack || err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
