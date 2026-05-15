import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchPricingFromPublicSheet, getStormCollarPrice } from '../lib/pricing-sheet.js';
import { getShopifyAccessToken, SHOPIFY_STORE } from '../lib/shopify-auth.js';
import { getHoleEdgeOffsets, holeWorld } from '../src/utils/geometry.js';
import { computePricingBreakdown } from '../src/utils/pricing.js';

const GOOGLE_SHEET_ID = (process.env.GOOGLE_SHEET_ID || '').trim();
const SHOPIFY_PRODUCT_ID = (process.env.SHOPIFY_PRODUCT_ID || '').trim() || undefined;
const SHOPIFY_VARIANT_ID = (process.env.SHOPIFY_VARIANT_ID || '').trim() || undefined;

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
    image?: string; // base64 data URL of 3D viewer screenshot
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
        showLabels: false,
        showLabelsA: false,
        showLabelsB: false,
        showLabelsC: false,
        price: 0,
        orbitEnabled: true,
        moveHolesMode: false,
        setOrbitEnabled: () => undefined,
        setMoveHolesMode: () => undefined,
        set: () => undefined,
        setCollar: () => undefined,
    } as any;

    const hole = holeWorld(id, state);
    const offsets = getHoleEdgeOffsets(hole, state);
    return `Top: ${formatFrac(offsets.top)}\" | Right: ${formatFrac(offsets.right)}\" | Bottom: ${formatFrac(offsets.bottom)}\" | Left: ${formatFrac(offsets.left)}\"`;
}

// In-memory cache for the Shopify Admin API token
function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function applyShopifyCatalogFallbacks(config: OrderConfig) {
    if (!config.shopifyVariantId && SHOPIFY_VARIANT_ID) {
        config.shopifyVariantId = SHOPIFY_VARIANT_ID;
        console.log('[DEBUG] Using env SHOPIFY_VARIANT_ID:', SHOPIFY_VARIANT_ID);
    }

    if (!config.shopifyProductId && SHOPIFY_PRODUCT_ID) {
        config.shopifyProductId = SHOPIFY_PRODUCT_ID;
        console.log('[DEBUG] Using env SHOPIFY_PRODUCT_ID:', SHOPIFY_PRODUCT_ID);
    }
}

async function fetchPricingFromSheet() {
    return fetchPricingFromPublicSheet(GOOGLE_SHEET_ID, 'pricing');
}

// Common color name lookup — best-effort from hex
function getColorName(hex: string): string {
    // Well-known basic colors and common RAL picks
    const map: Record<string, string> = {
        '#0b0e0f': 'Jet Black', '#000000': 'Black', '#ffffff': 'White',
        '#940604': 'Ruby Red', '#cc0605': 'Flame Red', '#a42b26': 'Wine Red',
        '#0e4a6b': 'Gentian Blue', '#1f4e79': 'Steel Blue', '#1d5e8c': 'Signal Blue',
        '#354733': 'Chrome Green', '#35683a': 'Leaf Green', '#4f8c45': 'Yellow Green',
        '#f9b000': 'Rape Yellow', '#e59800': 'Golden Yellow', '#fd9d00': 'Signal Yellow',
        '#b8c4cc': 'Galvanized Silver', '#e09a72': 'Copper',
    };
    const lower = hex.toLowerCase();
    if (map[lower]) return map[lower];
    // Parse hex to RGB for a rough hue-based name
    const r = parseInt(lower.slice(1, 3), 16);
    const g = parseInt(lower.slice(3, 5), 16);
    const b = parseInt(lower.slice(5, 7), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lum = (max + min) / 2;
    if (max - min < 30) {
        if (lum < 50) return 'Black';
        if (lum > 220) return 'White';
        return 'Grey';
    }
    if (r >= g && r >= b) return g > 150 ? 'Orange' : 'Red';
    if (g >= r && g >= b) return 'Green';
    return 'Blue';
}

function getMaterialLabel(material: string): string {
    if (material === 'copper') return 'Copper';
    return 'Stainless Steel';
}

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

function getHolePositionLabel(index: number, total: number): string {
    if (total === 1) return '';
    if (total === 2) return index === 0 ? 'Left' : 'Right';
    return index === 0 ? 'Left' : index === 1 ? 'Middle' : 'Right';
}

function buildHoleProperties(config: OrderConfig): { name: string; value: string }[] {
    const props: { name: string; value: string }[] = [];
    const collars = [
        { label: 'H1', id: 'A' as const, data: config.collarA },
        { label: 'H2', id: 'B' as const, data: config.collarB },
        { label: 'H3', id: 'C' as const, data: config.collarC },
    ];
    for (let i = 0; i < config.holes; i++) {
        const c = collars[i];
        if (!c.data) continue;
        const posLabel = getHolePositionLabel(i, config.holes);
        const label = config.holes === 1 ? 'Hole' : `${c.label} (${posLabel})`;
        const isRect = c.data.shape === 'rect';

        // Shape + Size on one line
        if (isRect) {
            const rw = formatFrac(c.data.rectWidth ?? c.data.dia);
            const rl = formatFrac(c.data.rectLength ?? c.data.dia);
            props.push({ name: label, value: `Rectangle ${rw}" × ${rl}" — Collar ${formatFrac(c.data.height)}" tall` });
        } else {
            props.push({ name: label, value: `Round ⌀${formatFrac(c.data.dia)}" — Collar ${formatFrac(c.data.height)}" tall` });
        }

        // Position on one line
        const cutoutOffsets = getHoleCutoutValue(c.id, config);
        props.push({
            name: `${config.holes === 1 ? '' : c.label + ' '}Position`,
            value: c.data.centered ? `Centered on cover | ${cutoutOffsets}` : cutoutOffsets,
        });
    }
    return props;
}

function buildLineItemDescription(config: OrderConfig): string {
    const lines: string[] = [];
    lines.push(`${formatFrac(config.l)}" L × ${formatFrac(config.w)}" W × ${formatFrac(config.sk)}" Skirt`);
    lines.push(`Material: ${getMaterialLabel(config.mat)} | Gauge: ${config.gauge}ga`);
    lines.push(`Drip Edge: ${config.drip ? 'Yes' : 'No'} | Diagonal Crease: ${config.diag ? 'Yes' : 'No'}`);
    if (config.pc) lines.push(`Powder Coat: ${getColorName(config.pcCol)} (${config.pcCol})`);

    const collars = [
        { label: 'H1', id: 'A' as const, data: config.collarA },
        { label: 'H2', id: 'B' as const, data: config.collarB },
        { label: 'H3', id: 'C' as const, data: config.collarC },
    ];
    for (let i = 0; i < config.holes; i++) {
        const c = collars[i];
        if (!c.data) continue;
        const posLabel = getHolePositionLabel(i, config.holes);
        const tag = config.holes === 1 ? 'Hole' : `${c.label} (${posLabel})`;
        const isRect = c.data.shape === 'rect';
        let desc: string;
        if (isRect) {
            desc = `${tag}: Rect ${formatFrac(c.data.rectWidth ?? c.data.dia)}" × ${formatFrac(c.data.rectLength ?? c.data.dia)}" — ${formatFrac(c.data.height)}" tall`;
        } else {
            desc = `${tag}: Round ⌀${formatFrac(c.data.dia)}" — ${formatFrac(c.data.height)}" tall`;
        }
        if (c.data.centered) {
            desc += ' (centered)';
        } else {
            desc += ` [Top:${formatFrac(c.data.offset3)}" Right:${formatFrac(c.data.offset4)}" Bottom:${formatFrac(c.data.offset1)}" Left:${formatFrac(c.data.offset2)}"]`;
        }
        desc += ` [${getHoleCutoutValue(c.id, config)}]`;
        lines.push(desc);
    }

    if (config.notes) lines.push(`Notes: ${config.notes}`);
    return lines.join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const config: OrderConfig = req.body;
        console.log('[DEBUG] Request context:', {
            origin: req.headers.origin || null,
            referer: req.headers.referer || null,
            host: req.headers.host || null,
            userAgent: req.headers['user-agent'] || null,
        });
        console.log('[DEBUG] Handler request body:', JSON.stringify(config));

        applyShopifyCatalogFallbacks(config);
        console.log('[DEBUG] Effective Shopify IDs after fallbacks:', {
            productId: config.shopifyProductId || null,
            variantId: config.shopifyVariantId || null,
            envProductId: SHOPIFY_PRODUCT_ID || null,
            envVariantId: SHOPIFY_VARIANT_ID || null,
        });

        // Validate required fields
        if (!config.w || !config.l || !config.sk || !config.mat || !config.gauge) {
            console.error('[DEBUG] Validation failed missing fields');
            return res.status(400).json({ error: 'Missing required configuration fields' });
        }

        // 1. Fetch Shopify auth and pricing in parallel
        console.log('[DEBUG] Fetching Shopify token and pricing...');
        const [shopifyAccessToken, pricing] = await Promise.all([
            getShopifyAccessToken(),
            fetchPricingFromSheet(),
        ]);
        console.log('[DEBUG] Shopify token and pricing fetched.');

        // 2. Fetch pricing from Google Sheet (server-side — tamper-proof)
        // 3. Calculate price server-side
        let stormCollarCost = 0;
        const collars = [config.collarA, config.collarB, config.collarC];
        for (let i = 0; i < config.holes; i++) {
            const c = collars[i];
            if (c?.stormCollar) stormCollarCost += getStormCollarPrice(c.dia, pricing.STORM_COLLAR_PRICES ?? {});
        }

        const pricingBreakdown = computePricingBreakdown(config, pricing, stormCollarCost);
        const unitPrice = pricingBreakdown.total;
        console.log('[DEBUG] Calculated unitPrice:', unitPrice);
        console.log('[DEBUG] Pricing breakdown:', { ...pricingBreakdown, paintedEnabled: config.pc });
        const quantity = Math.max(1, Math.min(99, Math.round(config.quantity || 1)));
        console.log('[DEBUG] Draft order linkage summary:', {
            productId: config.shopifyProductId || null,
            variantId: config.shopifyVariantId || null,
            quantity,
            hasImage: false,
        });

        // 4. Build human-readable description
        const description = buildLineItemDescription(config);

        // 5. Create Shopify Draft Order via Admin API
        const lineItemProperties = [
            { name: 'Dimensions', value: `${formatFrac(config.l)}" L × ${formatFrac(config.w)}" W × ${formatFrac(config.sk)}" Skirt` },
            { name: 'Material & Gauge', value: `${getMaterialLabel(config.mat)} — ${config.gauge}ga` },
            { name: 'Options', value: `Drip Edge: ${config.drip ? 'Yes' : 'No'} · Diagonal Crease: ${config.diag ? 'Yes' : 'No'}` },
            ...(config.pc && config.mat !== 'copper' ? [{ name: 'Powder Coat', value: `${getColorName(config.pcCol)} (${config.pcCol})` }] : []),
            { name: 'Holes', value: `${config.holes}` },
            ...buildHoleProperties(config),
            ...(config.notes ? [{ name: 'Special Notes', value: config.notes }] : []),
            ...(config.shopifyProductId ? [{ name: '_shopify_product_id', value: String(config.shopifyProductId) }] : []),
            ...(config.shopifyVariantId ? [{ name: '_shopify_variant_id', value: String(config.shopifyVariantId) }] : []),
            { name: '_config_json', value: JSON.stringify({ ...config, image: undefined }) },
        ];

        const draftOrderPayload = {
            draft_order: {
                line_items: [
                    {
                        title: 'Custom Chase Cover',
                        price: unitPrice.toFixed(2),
                        quantity: quantity,
                        requires_shipping: true,
                        taxable: true,
                        properties: lineItemProperties,
                    },
                ],
                note: description,
                use_customer_default_address: true,
            },
        };
        console.log('[DEBUG] Draft order line item mode:', {
            customLineItem: true,
            linkedProductId: config.shopifyProductId || null,
            linkedVariantId: config.shopifyVariantId || null,
            propertyCount: lineItemProperties.length,
        });
        console.log('[DEBUG] Draft Order Payload:', JSON.stringify(draftOrderPayload));

        console.log('[DEBUG] Sending request to Shopify...');
        const shopifyRes = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/draft_orders.json`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': shopifyAccessToken,
                },
                body: JSON.stringify(draftOrderPayload),
            }
        );

        if (!shopifyRes.ok) {
            const errorText = await shopifyRes.text();
            console.error('Shopify API error:', shopifyRes.status, errorText);
            return res.status(502).json({ error: 'Failed to create order', shopifyStatus: shopifyRes.status, details: errorText });
        }

        const shopifyData = await shopifyRes.json();
        const invoiceUrl = shopifyData.draft_order.invoice_url;

        return res.status(200).json({ checkout_url: invoiceUrl });
    } catch (err: any) {
        console.error('Create order error:', err?.stack || err);
        return res.status(500).json({ error: err.message || 'Internal server error', stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined });
    }
}
