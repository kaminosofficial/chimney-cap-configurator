import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchPricingFromPublicSheet } from '../lib/pricing-sheet.js';
import { getShopifyAccessToken, SHOPIFY_STORE, warnUnknownOrigin } from '../lib/shopify-auth.js';
import { RAL_COLORS } from '../src/config/ralColors.js';

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
/*  Server-side cap pricing (must match src/store/configStore.ts)      */
/*  The chase block in `src/utils/pricing.ts` is for chase covers and  */
/*  uses different math; we don't call it here.                         */
/* ------------------------------------------------------------------ */

interface CapPricing {
    MARGIN_RATE: number;
    PAINTED_MULTIPLIER: number;
    MATERIAL_MULT: Record<string, number>;
    CAP_MULTIPLIERS: Record<string, number>;
    CAP_BRACKETS: { flat: { w_max: number; l_max: number }; non_flat: { w_max: number; l_max: number } };
    CAP_SURCHARGES: {
        steep_pitch_pct: number; steep_pitch_threshold: number;
        tall_skirt_pct: number; tall_skirt_threshold: number;
        extra_overhang_pct: number; std_overhang_flat: number; std_overhang_non_flat: number;
        tall_screen_pct: number; tall_screen_threshold: number;
    };
}

function computeCapPriceServerSide(c: CapOrderConfig, pricing: CapPricing): number {
    const w = c.width || 24;
    const l = c.length || 36;
    const screen = c.screen_height || 10;
    const mount = c.mount || 'skirt';
    const lid_type = c.lid_type || 'flat';
    const material = c.material || 'stainless';

    let multiplier = 1;
    let baseCost = 0;

    if (mount === 'top_mount' && lid_type === 'flat') {
        const totalDim = w + l + screen;
        let bracket = '0_60';
        if (totalDim > 100) {
            bracket = '101_plus';
        } else if (totalDim > 70) {
            bracket = '71_100';
        } else if (totalDim > 60) {
            bracket = '61_70';
        }
        multiplier = pricing.CAP_MULTIPLIERS[`top_mount_flat_${bracket}`] ?? 1;
        baseCost = totalDim * multiplier;
    } else {
        const bracketDims = lid_type === 'flat' ? pricing.CAP_BRACKETS.flat : pricing.CAP_BRACKETS.non_flat;
        const bracket = w <= bracketDims.w_max && l <= bracketDims.l_max ? 'small' : 'large';
        multiplier = pricing.CAP_MULTIPLIERS[`${mount}_${lid_type}_${bracket}`] ?? 1;
        baseCost = (w + l) * multiplier;
    }

    let cost = baseCost;
    cost *= pricing.MATERIAL_MULT[material] ?? 1;

    const sur = pricing.CAP_SURCHARGES;
    if ((c.lid_pitch ?? 5) > sur.steep_pitch_threshold) cost *= 1 + sur.steep_pitch_pct;
    if (mount !== 'top_mount' && (c.vertical_skirt ?? 3) > sur.tall_skirt_threshold) cost *= 1 + sur.tall_skirt_pct;
    const stdOverhang = lid_type === 'flat' ? sur.std_overhang_flat : sur.std_overhang_non_flat;
    if ((c.lid_overhang ?? stdOverhang) > stdOverhang) cost *= 1 + sur.extra_overhang_pct;
    if (screen > sur.tall_screen_threshold) cost *= 1 + sur.tall_screen_pct;
    if (c.powder_coat && material !== 'copper') cost *= pricing.PAINTED_MULTIPLIER;

    const marginMultiplier = pricing.MARGIN_RATE > 0 ? pricing.MARGIN_RATE : 1;
    return cost * marginMultiplier;
}

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
const cachedProductHandles = new Map<string, string>();

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

async function getProductHandle(productId: string, accessToken: string): Promise<string | null> {
    const cached = cachedProductHandles.get(productId);
    if (cached) return cached;
    try {
        const res = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}.json?fields=handle`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const handle = data?.product?.handle;
        if (handle) {
            cachedProductHandles.set(productId, handle);
            return handle;
        }
    } catch (e: any) {
        console.warn('[CART] getProductHandle failed:', e.message);
    }
    return null;
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

/* ---- Storefront propagation check ---- */

async function waitForStorefrontPropagation(
    variantId: string,
    expectedPrice: string,
    storefrontDomain: string,
    productHandle: string | null,
    maxWaitMs = 18000,
    intervalMs = 1500
): Promise<boolean> {
    const start = Date.now();
    const numericId = Number(variantId);
    let attempt = 0;
    while (Date.now() - start < maxWaitMs) {
        attempt++;
        await new Promise(r => setTimeout(r, attempt === 1 ? 1000 : intervalMs));
        try {
            const res = await fetch(`https://${storefrontDomain}/cart/add.js`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    items: [{ id: numericId, quantity: 1, properties: { _propagation_check: 'true' } }],
                }),
            });

            if (res.ok) {
                const data = await res.json().catch(() => null);
                const item = Array.isArray(data?.items) ? data.items.find((i: any) => Number(i.id) === numericId) : data;
                const priceCents = Number(item?.price ?? item?.final_price ?? 0);
                if (priceCents > 0 || !expectedPrice) {
                    console.log(`[PROP] Variant ${variantId} cart-addable after ${Date.now() - start}ms`);
                    return true;
                }
            }

            if (res.status === 429) {
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }

            if (productHandle) {
                const productRes = await fetch(`https://${storefrontDomain}/products/${productHandle}.json?v=${Date.now()}`, {
                    headers: { 'Accept': 'application/json' },
                });
                if (productRes.ok) {
                    const productData = await productRes.json();
                    const found = (productData?.product?.variants || []).find((v: any) => v.id === numericId);
                    if (found && found.price === expectedPrice && found.available === true) {
                        console.log(`[PROP] Variant ${variantId} available in product JSON after ${Date.now() - start}ms`);
                        return true;
                    }
                }
            }
        } catch {
            if (productHandle) {
                const productRes = await fetch(`https://${storefrontDomain}/products/${productHandle}.json?v=${Date.now()}`, {
                    headers: { 'Accept': 'application/json' },
                }).catch(() => null);
                if (productRes?.ok) {
                    const productData = await productRes.json();
                    const found = (productData?.product?.variants || []).find((v: any) => v.id === numericId);
                    if (found && found.price === expectedPrice && found.available === true) {
                        console.log(`[PROP] Variant ${variantId} available in product JSON after ${Date.now() - start}ms`);
                        return true;
                    }
                }
            }
        }
    }
    return false;
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
        console.log('[CART] === Add-to-cart START ===', { productId: config.shopifyProductId, mount: config.mount, lid: config.lid_type });

        warnUnknownOrigin(req.headers.origin as string | undefined, 'CART');

        // Storefront domain for propagation polling (kaminos.com is faster than .myshopify.com).
        const origin = req.headers.origin || req.headers.referer || '';
        let storefrontDomain = '';
        try { storefrontDomain = new URL(origin as string).hostname; } catch { /* ignore */ }
        if (!storefrontDomain) storefrontDomain = SHOPIFY_STORE;

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

        // 2. Option name + product handle in parallel.
        const [optionName, productHandle] = await Promise.all([
            getProductOptionName(config.shopifyProductId, accessToken),
            getProductHandle(config.shopifyProductId, accessToken),
        ]);

        // 3. Server-side price (tamper-proof — recomputed from sheet pricing, never trusts client).
        const unitPrice = computeCapPriceServerSide(config, pricing as CapPricing);
        const priceStr = unitPrice.toFixed(2);
        console.log('[CART] Server-computed price:', priceStr);

        // 4. Hash → fetch variants → reuse or create.
        const hash = configHash(config, priceStr);
        const allVariants = await fetchAllVariants(config.shopifyProductId, accessToken);
        await proactiveCleanup(config.shopifyProductId, accessToken, allVariants);

        const existingId = findInVariants(allVariants, hash, priceStr);
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

        // 5. Wait until the storefront cart endpoint accepts the variant.
        let propagated = true;
        if (!existingId) {
            propagated = await waitForStorefrontPropagation(variantId, priceStr, storefrontDomain, productHandle, 18000, 1500);
        }

        // 6. Line item properties + response.
        const properties = buildCartProperties(config);
        const quantity = Math.max(1, Math.min(99, Math.round(config.quantity || 1)));
        const totalMs = Date.now() - handlerStart;
        console.log('[CART] === DONE ===', totalMs, 'ms');

        return res.status(200).json({
            success: true,
            variantId,
            variantReused: !!existingId,
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
