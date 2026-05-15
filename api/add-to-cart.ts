import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchPricingFromPublicSheet, getStormCollarPrice } from '../lib/pricing-sheet.js';
import { getShopifyAccessToken, SHOPIFY_STORE, warnUnknownOrigin } from '../lib/shopify-auth.js';
import { getHoleEdgeOffsets, holeWorld } from '../src/utils/geometry.js';
import { computePricingBreakdown } from '../src/utils/pricing.js';
import { RAL_COLORS } from '../src/config/ralColors.js';

const GOOGLE_SHEET_ID = (process.env.GOOGLE_SHEET_ID || '').trim();
const SHOPIFY_PRODUCT_ID = (process.env.SHOPIFY_PRODUCT_ID || '').trim() || undefined; // fallback product ID

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CollarConfig {
    shape?: 'round' | 'rect';
    dia: number;
    rectWidth?: number;
    rectLength?: number;
    height: number;
    centered: boolean;
    offset1: number;
    offset2: number;
    offset3: number;
    offset4: number;
    stormCollar?: boolean;
}

interface OrderConfig {
    w: number;
    l: number;
    sk: number;
    drip: boolean;
    diag: boolean;
    mat: string;
    gauge: number;
    pc: boolean;
    pcCol: string;
    holes: number;
    collarA?: CollarConfig;
    collarB?: CollarConfig;
    collarC?: CollarConfig;
    holeCutoutA?: string;
    holeCutoutB?: string;
    holeCutoutC?: string;
    quantity: number;
    notes: string;
    shopifyProductId?: string;
    shopifyVariantId?: string;
    image?: string;
}

/* ------------------------------------------------------------------ */
/*  Shopify Auth (same as create-order)                                */
/* ------------------------------------------------------------------ */

function applyProductIdFallback(config: OrderConfig) {
    if (!config.shopifyProductId && SHOPIFY_PRODUCT_ID) {
        config.shopifyProductId = SHOPIFY_PRODUCT_ID;
        console.log('[CART] Using env var SHOPIFY_PRODUCT_ID:', SHOPIFY_PRODUCT_ID);
    }
}

/* ------------------------------------------------------------------ */
/*  Pricing (same as create-order)                                     */
/* ------------------------------------------------------------------ */

async function fetchPricingFromSheet() {
    return fetchPricingFromPublicSheet(GOOGLE_SHEET_ID, 'pricing');
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers (same as create-order)                          */
/* ------------------------------------------------------------------ */

function formatFrac(n: number): string {
    const whole = Math.floor(n);
    const frac = n - whole;
    const eighths = Math.round(frac * 8);
    if (eighths === 0) return `${whole}`;
    if (eighths === 4) return `${whole} 1/2`;
    if (eighths === 2) return `${whole} 1/4`;
    if (eighths === 6) return `${whole} 3/4`;
    return `${whole} ${eighths}/8`;
}

/** Look up hex → RAL entry. Returns { name, ral } or null. */
function findRalColor(hex: string): { name: string; ral: string } | null {
    const lower = hex.toLowerCase();
    const found = RAL_COLORS.find(c => c.hex.toLowerCase() === lower);
    return found ? { name: found.name, ral: found.ral } : null;
}

/** Format powder coat color label for Shopify line item properties.
 *  Returns e.g. "Ruby Red (RAL 3002)" or "Custom (#940604)" if not in RAL palette. */
function getColorLabel(hex: string): string {
    const ral = findRalColor(hex);
    if (ral) return `${ral.name} (${ral.ral})`;
    // Fallback for custom/non-RAL colors: show hex
    return `Custom Color (${hex})`;
}

function getMaterialLabel(material: string): string {
    if (material === 'copper') return 'Copper';
    return 'Stainless Steel';
}

function getHoleCutoutValue(id: 'A' | 'B' | 'C', config: OrderConfig): string {
    const cachedValue = id === 'A'
        ? config.holeCutoutA
        : id === 'B'
            ? config.holeCutoutB
            : config.holeCutoutC;
    if (cachedValue) {
        return cachedValue
            .replace(/[\[\]]/g, '')
            .replace(/[A-C]\d\((Top|Right|Bottom|Left)\):/g, '$1:')
            .replace(/\s{2,}/g, ' ')
            .replace(/\s+\|/g, ' |')
            .trim();
    }

    const state = {
        ...config,
        showLabels: false, showLabelsA: false, showLabelsB: false, showLabelsC: false,
        price: 0, orbitEnabled: true, moveHolesMode: false,
        setOrbitEnabled: () => undefined, setMoveHolesMode: () => undefined,
        set: () => undefined, setCollar: () => undefined,
    } as any;

    const hole = holeWorld(id, state);
    const offsets = getHoleEdgeOffsets(hole, state);
    return `Top: ${formatFrac(offsets.top)}" | Right: ${formatFrac(offsets.right)}" | Bottom: ${formatFrac(offsets.bottom)}" | Left: ${formatFrac(offsets.left)}"`;
}

function getHolePositionLabel(index: number, total: number): string {
    if (total === 1) return '';
    if (total === 2) return index === 0 ? 'Left' : 'Right';
    return index === 0 ? 'Left' : index === 1 ? 'Middle' : 'Right';
}

function getHoleDisplayLabel(index: number, total: number): string {
    const position = getHolePositionLabel(index, total);
    return position ? `Hole ${index + 1}(${position})` : `Hole ${index + 1}`;
}

/* ------------------------------------------------------------------ */
/*  Build line item properties (for Shopify cart)                       */
/* ------------------------------------------------------------------ */

function buildCartProperties(config: OrderConfig): { key: string; value: string }[] {
    const props: { key: string; value: string }[] = [
        { key: 'Dimensions', value: `${formatFrac(config.l)}" L × ${formatFrac(config.w)}" W × ${formatFrac(config.sk)}" Skirt` },
        { key: 'Material & Gauge', value: `${getMaterialLabel(config.mat)} — ${config.gauge}ga` },
        { key: 'Options', value: `Drip Edge: ${config.drip ? 'Yes' : 'No'} | Diagonal Crease: ${config.diag ? 'Yes' : 'No'}` },
    ];

    if (config.pc && config.mat !== 'copper') {
        props.push({ key: 'Powder Coat', value: getColorLabel(config.pcCol) });
    }

    // Hole details
    const collars = [
        { id: 'A' as const, data: config.collarA },
        { id: 'B' as const, data: config.collarB },
        { id: 'C' as const, data: config.collarC },
    ];
    for (let i = 0; i < config.holes; i++) {
        const c = collars[i];
        if (!c.data) continue;
        const label = getHoleDisplayLabel(i, config.holes);
        const isRect = c.data.shape === 'rect';

        if (isRect) {
            const rw = formatFrac(c.data.rectWidth ?? c.data.dia);
            const rl = formatFrac(c.data.rectLength ?? c.data.dia);
            props.push({ key: label, value: `Rectangle ${rw}" × ${rl}" — Collar ${formatFrac(c.data.height)}" tall` });
        } else {
            props.push({ key: label, value: `Round ⌀${formatFrac(c.data.dia)}" — Collar ${formatFrac(c.data.height)}" tall` });
        }

        const cutoutOffsets = getHoleCutoutValue(c.id, config);
        props.push({
            key: config.holes === 1 ? 'Position' : `Hole ${i + 1} Position`,
            value: c.data.centered ? `Centered on cover | ${cutoutOffsets}` : cutoutOffsets,
        });
    }

    if (config.notes) {
        props.push({ key: 'Special Notes', value: config.notes });
    }

    // Hidden metadata (underscore-prefixed properties are hidden in Shopify cart/checkout UI)
    props.push({ key: '_config_json', value: JSON.stringify({ ...config, image: undefined }) });

    return props;
}

/* ------------------------------------------------------------------ */
/*  Shopify Admin API — Deterministic variant hash + reuse            */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a hash of the canonical config + price string.
 * Same configuration → same 8-hex-char hash → same variant reused across all
 * browsers/users/sessions. Different price (e.g. after sheet update) → different hash.
 */
/**
 * Snap a number to 1/8" resolution, eliminating floating-point drift between
 * mobile Safari and desktop Chrome so the same visual config → same hash.
 */
const r8 = (n: number) => Math.round(n * 8) / 8;

function normalizeCollar(c: CollarConfig | undefined): any {
    if (!c) return undefined;
    return {
        shape: c.shape || 'round',
        dia: r8(c.dia),
        rw: c.shape === 'rect' ? r8(c.rectWidth ?? c.dia) : undefined,
        rl: c.shape === 'rect' ? r8(c.rectLength ?? c.dia) : undefined,
        h: r8(c.height),
        cen: c.centered,
        o1: r8(c.offset1), o2: r8(c.offset2), o3: r8(c.offset3), o4: r8(c.offset4),
        sc: !!c.stormCollar,
    };
}

function configHash(config: OrderConfig, price: string): string {
    const pc = config.pc && config.mat !== 'copper';
    const canonicalObj = {
        w: r8(config.w), l: r8(config.l), sk: r8(config.sk),
        drip: config.drip, diag: config.diag,
        mat: config.mat, gauge: config.gauge,
        pc, pcCol: pc ? config.pcCol : null,
        holes: config.holes,
        cA: config.holes >= 1 ? normalizeCollar(config.collarA) : undefined,
        cB: config.holes >= 2 ? normalizeCollar(config.collarB) : undefined,
        cC: config.holes >= 3 ? normalizeCollar(config.collarC) : undefined,
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

/**
 * Fetch all variants for the product. Returns the full array.
 * NOTE: limit=250 is the Shopify API page-size cap. Shopify Basic caps products
 * at 100 variants, so limit=250 always returns all of them in one call.
 */
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

/**
 * Proactive buffer cleanup: when total variants >= TRIGGER_AT (95), delete the oldest
 * MFC-* variants that are >= 24h old until we're back to TARGET_COUNT (85).
 * The 24h window protects carts that are in-progress at checkout.
 * Also deletes each variant's screenshot image to keep media clean.
 */
const VARIANT_LIMIT = 100;     // Shopify Basic max
const TRIGGER_AT   = 95;       // start cleanup when this many variants exist
const TARGET_COUNT = 85;       // aim to free down to this many

async function proactiveCleanup(productId: string, accessToken: string, variants: any[]): Promise<void> {
    const total = variants.length;
    if (total < TRIGGER_AT) return;

    const MIN_AGE_MS = 24 * 60 * 60 * 1000; // only delete variants older than 24h
    const candidates = variants
        .filter(v => String(v.option1 || '').startsWith('MFC-') && (Date.now() - new Date(v.created_at).getTime()) > MIN_AGE_MS)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // oldest first

    const toDelete = candidates.slice(0, Math.max(0, total - TARGET_COUNT));
    if (toDelete.length === 0) {
        console.log(`[CART] Buffer cleanup triggered (${total}/${VARIANT_LIMIT}) but no eligible variants (all < 24h old)`);
        return;
    }

    console.log(`[CART] Buffer cleanup: ${total}/${VARIANT_LIMIT} variants — deleting ${toDelete.length} oldest`);
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
    console.log(`[CART] Buffer cleanup done: freed ${deleted} slots (${total - deleted}/${VARIANT_LIMIT} remaining)`);
}

interface VariantCreateResult {
    ok: boolean;
    variantId?: string;
    error?: string;
    status?: number;
}

/* ---- GraphQL helper ---- */

async function shopifyGraphQL(query: string, accessToken: string, variables?: Record<string, any>): Promise<any> {
    const res = await fetch(
        `https://${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({ query, variables }),
        }
    );
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { errors: [{ message: text.slice(0, 300) }] }; }
}

/* ---- Caches for product metadata ---- */
const cachedOptionNames = new Map<string, string>();
const cachedProductHandles = new Map<string, string>();

async function getProductOptionName(productId: string, accessToken: string): Promise<string> {
    const cachedOptionName = cachedOptionNames.get(productId);
    if (cachedOptionName) return cachedOptionName;

    const t0 = Date.now();
    try {
        const gid = `gid://shopify/Product/${productId}`;
        const result = await shopifyGraphQL(
            `{ product(id: "${gid}") { options(first: 1) { name } } }`,
            accessToken
        );
        const name = result?.data?.product?.options?.[0]?.name;
        console.log('[CART] getProductOptionName:', name, 'in', Date.now() - t0, 'ms');
        if (name) {
            cachedOptionNames.set(productId, name);
            return name;
        }
    } catch (e: any) {
        console.warn('[CART] Failed to get option name in', Date.now() - t0, 'ms:', e.message);
    }
    return 'Title'; // Shopify's default option name
}

/* ---- Cache for product handle ---- */

async function getProductHandle(productId: string, accessToken: string): Promise<string | null> {
    const cachedProductHandle = cachedProductHandles.get(productId);
    if (cachedProductHandle) return cachedProductHandle;

    const t0 = Date.now();
    try {
        const res = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}.json?fields=handle`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        if (!res.ok) {
            console.warn('[CART] getProductHandle failed:', res.status, 'in', Date.now() - t0, 'ms');
            return null;
        }
        const data = await res.json();
        const handle = data?.product?.handle;
        console.log('[CART] getProductHandle:', handle, 'in', Date.now() - t0, 'ms');
        if (handle) {
            cachedProductHandles.set(productId, handle);
            return handle;
        }
    } catch (e: any) {
        console.warn('[CART] Failed to get product handle in', Date.now() - t0, 'ms:', e.message);
    }
    return null;
}

/* ---- Storefront propagation check ---- */

/**
 * After creating a new variant via Admin API, the Shopify storefront has an
 * eventual consistency delay (~9-10s average) before /cart/add.js accepts it.
 *
 * This function polls the storefront's /cart/add.js directly — the definitive
 * test of purchasability. A stateless POST (no cookies) creates an ephemeral
 * anonymous cart that Shopify garbage-collects automatically.
 *
 * Once the variant appears in the product JSON with the correct price, the
 * client's /cart/add.js call will succeed immediately (both endpoints reflect
 * the same storefront propagation state for browser clients).
 *
 * IMPORTANT: Uses the customer-facing storefront domain (e.g. kaminos.com),
 * NOT the .myshopify.com admin domain, because propagation is faster on the
 * custom domain. Uses the lightweight GET /products/{handle}.json endpoint
 * instead of POST /cart/add.js to avoid storefront rate limits (429).
 */
async function waitForStorefrontPropagation(
    variantId: string,
    expectedPrice: string,
    storefrontDomain: string,
    productHandle: string | null,
    maxWaitMs: number = 18000,
    intervalMs: number = 1500
): Promise<boolean> {
    if (!productHandle) {
        console.warn('[PROP] No product handle — skipping propagation check');
        return false;
    }

    const start = Date.now();
    const numericId = Number(variantId);
    let attempt = 0;

    console.log(`[PROP] Polling https://${storefrontDomain}/products/${productHandle}.json for variant ${variantId} at $${expectedPrice}`);

    while (Date.now() - start < maxWaitMs) {
        attempt++;
        // Wait before each poll (including the first — give Shopify initial propagation time)
        await new Promise(r => setTimeout(r, attempt === 1 ? 1000 : intervalMs));

        try {
            const url = `https://${storefrontDomain}/products/${productHandle}.json?v=${Date.now()}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });

            if (res.status === 429) {
                console.log(`[PROP] Poll ${attempt}: rate limited (429) — waiting 3s (${Date.now() - start}ms)`);
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }

            if (!res.ok) {
                console.warn(`[PROP] Poll ${attempt}: HTTP ${res.status} (${Date.now() - start}ms)`);
                continue;
            }

            const data = await res.json();
            const variants = data?.product?.variants;
            if (!Array.isArray(variants)) continue;

            const found = variants.find((v: any) => v.id === numericId);
            if (found && found.price === expectedPrice) {
                console.log(`[PROP] Variant ${variantId} visible at $${expectedPrice} after ${Date.now() - start}ms (${attempt} polls)`);
                return true;
            }

            if (attempt <= 3 || attempt % 4 === 0) {
                const status = found ? `price=${found.price}` : 'not found';
                console.log(`[PROP] Poll ${attempt}: variant ${status} (${Date.now() - start}ms)`);
            }
        } catch (e: any) {
            console.warn(`[PROP] Poll ${attempt} error: ${e.message}`);
        }
    }

    console.warn(`[PROP] Timed out after ${Date.now() - start}ms (${attempt} polls)`);
    return false;
}

/* ---- Create variant via GraphQL (tracked=false in single call) ---- */

async function createVariant(
    productId: string,
    price: string,
    accessToken: string,
    optionName: string,
    hash: string
): Promise<VariantCreateResult> {
    const optionValue = `MFC-${hash}`;
    const gid = `gid://shopify/Product/${productId}`;

    console.log('[CART] Creating variant via GraphQL:', { productId, price, optionValue, optionName });

    const t0 = Date.now();
    const mutation = `
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
                productVariants {
                    id
                    inventoryItem { tracked }
                    inventoryPolicy
                }
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
    console.log('[CART] GraphQL mutation took', Date.now() - t0, 'ms');

    // Check for GraphQL-level errors
    if (result?.errors?.length) {
        const errMsg = result.errors.map((e: any) => e.message).join('; ');
        console.error('[CART] GraphQL errors:', errMsg);
        return { ok: false, error: `GraphQL error: ${errMsg}`, status: 400 };
    }

    // Check for user errors (validation failures)
    const userErrors = result?.data?.productVariantsBulkCreate?.userErrors || [];
    if (userErrors.length > 0) {
        const errMsg = userErrors.map((e: any) => `${e.field}: ${e.message}`).join('; ');
        console.error('[CART] Variant creation user errors:', errMsg);
        const isLimitError = errMsg.toLowerCase().includes('limit') || errMsg.toLowerCase().includes('maximum');
        // Race condition: another request created the same hash variant just now — treat as success
        const isDuplicate = errMsg.toLowerCase().includes('taken') || errMsg.toLowerCase().includes('duplicate') || errMsg.toLowerCase().includes('already');
        if (isDuplicate) {
            console.log('[CART] Duplicate option value (race condition) — re-fetching existing variant');
            const existing = findInVariants(await fetchAllVariants(productId, accessToken), hash, price);
            if (existing) return { ok: true, variantId: existing };
        }
        return { ok: false, error: errMsg, status: isLimitError ? 422 : 400 };
    }

    // Extract the created variant
    const variants = result?.data?.productVariantsBulkCreate?.productVariants || [];
    if (variants.length === 0) {
        return { ok: false, error: 'No variant returned from GraphQL', status: 200 };
    }

    const createdVariant = variants[0];
    // GraphQL returns GID like "gid://shopify/ProductVariant/12345" — extract numeric ID
    const gidStr = createdVariant.id || '';
    const numericId = gidStr.split('/').pop() || gidStr;
    const tracked = createdVariant?.inventoryItem?.tracked;
    const policy = createdVariant?.inventoryPolicy;

    console.log('[CART] Variant created via GraphQL:', {
        variantId: numericId, price, optionValue, tracked, policy,
        totalMs: Date.now() - t0,
    });

    if (!numericId || numericId === gidStr) {
        return { ok: false, error: 'Could not extract variant ID from GraphQL response', status: 200 };
    }

    return { ok: true, variantId: numericId };
}

/** Emergency cleanup: delete MFC-* variants older than the given threshold */
async function emergencyCleanup(productId: string, accessToken: string, maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    console.log('[CART] Running emergency cleanup for product', productId);
    try {
        const listRes = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants.json?limit=250`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        if (!listRes.ok) return 0;

        const listData = await listRes.json();
        const variants = listData?.variants || [];
        const cutoff = Date.now() - maxAgeMs;
        let deleted = 0;

        for (const v of variants) {
            const opt = String(v.option1 || '');
            if (!opt.startsWith('MFC-')) continue;
            const createdAt = new Date(v.created_at).getTime();
            if (createdAt >= cutoff) continue;

            const delRes = await fetch(
                `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants/${v.id}.json`,
                { method: 'DELETE', headers: { 'X-Shopify-Access-Token': accessToken } }
            );
            if (delRes.ok) deleted++;
        }

        console.log('[CART] Emergency cleanup deleted', deleted, 'stale variants');
        return deleted;
    } catch (err: any) {
        console.error('[CART] Emergency cleanup error:', err.message);
        return 0;
    }
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const handlerStart = Date.now();
        const config: OrderConfig = req.body;
        const hasImage = !!config.image;
        console.log('[CART] === Add-to-cart START ===', { productId: config.shopifyProductId, hasImage });

        warnUnknownOrigin(req.headers.origin as string | undefined, 'CART');

        // Extract storefront domain from request origin/referer.
        // The .myshopify.com admin domain has much slower propagation than the
        // custom storefront domain (kaminos.com), so we MUST use the custom one.
        const origin = req.headers.origin || req.headers.referer || '';
        let storefrontDomain = '';
        try {
            const parsed = new URL(origin);
            storefrontDomain = parsed.hostname;
        } catch { /* ignore */ }
        // Fallback: use SHOPIFY_STORE if no origin (shouldn't happen in production)
        if (!storefrontDomain) storefrontDomain = SHOPIFY_STORE;
        console.log('[CART] Storefront domain:', storefrontDomain);

        applyProductIdFallback(config);

        // Validate
        if (!config.w || !config.l || !config.sk || !config.mat || !config.gauge) {
            return res.status(400).json({ error: 'Missing required configuration fields' });
        }

        // 1. Auth + pricing in parallel
        const t1 = Date.now();
        const [accessToken, pricing] = await Promise.all([
            getShopifyAccessToken(),
            fetchPricingFromSheet(),
        ]);
        const authPricingMs = Date.now() - t1;
        console.log('[CART] [1] Auth+pricing:', authPricingMs, 'ms');

        // 2. Resolve product ID if missing
        if (!config.shopifyProductId) {
            const t2 = Date.now();
            console.log('[CART] No product ID — listing products to find chase cover...');
            try {
                const listRes = await fetch(
                    `https://${SHOPIFY_STORE}/admin/api/2025-10/products.json?limit=50&fields=id,title`,
                    { headers: { 'X-Shopify-Access-Token': accessToken } }
                );
                if (listRes.ok) {
                    const listData = await listRes.json();
                    const products = listData?.products || [];
                    const chaseProduct = products.find((p: any) =>
                        p.title?.toLowerCase().includes('chase')
                    ) || products[0];
                    if (chaseProduct?.id) {
                        config.shopifyProductId = String(chaseProduct.id);
                        console.log('[CART] [2] Resolved product:', chaseProduct.title, '→', config.shopifyProductId, 'in', Date.now() - t2, 'ms');
                    }
                }
            } catch (err: any) {
                console.error('[CART] Product list error:', err.message);
            }
        }

        if (!config.shopifyProductId) {
            return res.status(400).json({
                error: 'Could not resolve a Shopify product. Set SHOPIFY_PRODUCT_ID env var in Vercel or pass product-id on the mount element.',
                debug: { envProductId: SHOPIFY_PRODUCT_ID || null, store: SHOPIFY_STORE },
            });
        }

        // 3. Get option name + product handle + calculate price IN PARALLEL
        const t3 = Date.now();
        const [optionName, productHandle] = await Promise.all([
            getProductOptionName(config.shopifyProductId, accessToken),
            getProductHandle(config.shopifyProductId, accessToken),
        ]);
        const optionNameMs = Date.now() - t3;

        let stormCollarCost = 0;
        const collars = [config.collarA, config.collarB, config.collarC];
        for (let i = 0; i < config.holes; i++) {
            const c = collars[i];
            if (c?.stormCollar) stormCollarCost += getStormCollarPrice(c.dia, pricing.STORM_COLLAR_PRICES ?? {});
        }
        const pricingBreakdown = computePricingBreakdown(config, pricing, stormCollarCost);
        const unitPrice = pricingBreakdown.total;
        const priceStr = unitPrice.toFixed(2);
        console.log('[CART] [3] OptionName+pricing:', optionNameMs, 'ms, price:', priceStr);

        // 4. Fetch variant list once → buffer cleanup if near limit → reuse or create
        const t4 = Date.now();
        const hash = configHash(config, priceStr);
        console.log('[CART] Config hash:', hash);

        const allVariants = await fetchAllVariants(config.shopifyProductId, accessToken);
        console.log(`[CART] Total variants: ${allVariants.length}/${VARIANT_LIMIT}`);

        // Proactive cleanup when within 5 slots of the Shopify Basic limit
        await proactiveCleanup(config.shopifyProductId, accessToken, allVariants);

        const existingId = findInVariants(allVariants, hash, priceStr);
        let variantId: string | undefined;
        let lastError = '';
        let variantMs: number;

        if (existingId) {
            variantId = existingId;
            variantMs = Date.now() - t4;
            console.log('[CART] [4] Reusing existing variant:', existingId, 'in', variantMs, 'ms');
        } else {
            const firstAttempt = await createVariant(config.shopifyProductId, priceStr, accessToken, optionName, hash);
            variantId = firstAttempt.variantId;
            lastError = firstAttempt.error || '';
            variantMs = Date.now() - t4;
            console.log('[CART] [4] createVariant:', variantMs, 'ms, ok:', firstAttempt.ok);

            // If variant limit reached (Shopify Basic = 100 max), emergency cleanup + retry once
            if (!firstAttempt.ok && firstAttempt.status === 422) {
                console.warn('[CART] Variant limit hit — attempting emergency cleanup');
                const cleaned = await emergencyCleanup(config.shopifyProductId, accessToken);
                if (cleaned > 0) {
                    console.log('[CART] Emergency cleanup freed', cleaned, 'slots — retrying');
                    const retry = await createVariant(config.shopifyProductId, priceStr, accessToken, optionName, hash);
                    if (retry.ok) variantId = retry.variantId;
                    else lastError = retry.error || '';
                }
            }
        }

        if (!variantId) {
            return res.status(502).json({
                error: `Failed to create variant: ${lastError}`,
                debug: { productId: config.shopifyProductId, store: SHOPIFY_STORE },
            });
        }

        // 5. Quick propagation hint (3s max — client owns the real retry loop)
        let propagated = true;
        let propagationMs = 0;
        if (!existingId && variantId) {
            const tProp = Date.now();
            propagated = await waitForStorefrontPropagation(variantId, priceStr, storefrontDomain, productHandle, 1000, 500);
            propagationMs = Date.now() - tProp;
            console.log(`[CART] [5] Propagation hint: ${propagated ? 'confirmed' : 'not yet'} in ${propagationMs}ms`);
        } else if (existingId) {
            console.log('[CART] [5] Reused variant — skipping propagation');
        }

        // 6. Build line item properties
        const properties = buildCartProperties(config);
        const quantity = Math.max(1, Math.min(99, Math.round(config.quantity || 1)));

        const totalMs = Date.now() - handlerStart;
        console.log('[CART] === DONE ===', totalMs, 'ms total | auth+pricing:', authPricingMs, '| optionName:', optionNameMs, '| variant:', variantMs, '| propagation:', propagationMs);

        return res.status(200).json({
            success: true,
            variantId,
            variantReused: !!existingId,
            propagated,
            quantity,
            price: priceStr,
            properties,
            _timing: { authPricingMs, optionNameMs, variantMs, propagationMs, totalMs },
        });
    } catch (err: any) {
        console.error('[CART] Add-to-cart error:', err?.stack || err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
