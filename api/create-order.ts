import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Legacy Shopify Draft Order endpoint.
 *
 * The live cart flow uses POST /api/add-to-cart (variant-based). This route is
 * kept as a stub for backwards compatibility — any caller still hitting it gets
 * a 410 telling them to switch.
 *
 * Removed: the chase-cover hole/collar formatting code that lived here. The
 * cap configurator has no holes, so the property block doesn't apply; if Draft
 * Orders are needed again for the cap, port the relevant bits from
 * api/add-to-cart.ts (buildCartProperties + computeCapPriceServerSide) into a
 * Draft Order payload here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    return res.status(410).json({
        error: 'Endpoint deprecated. Use POST /api/add-to-cart for the variant-based cart flow.',
    });
}
