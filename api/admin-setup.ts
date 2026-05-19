/**
 * Temporary admin helper — DELETE AFTER USE.
 *
 * Auth: requires `?secret=<CRON_SECRET>` query param.
 *
 * Supported actions:
 *   ?action=list-variants                      — list all variants on the configured product
 *   ?action=set-default-price&price=1500       — update the price on the non-MFC-* (default) variant
 *   ?action=set-default-image&imageUrl=<url>   — upload an image from a public URL as the default
 *                                                variant's image
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getShopifyAccessToken, SHOPIFY_STORE } from '../lib/shopify-auth.js';

const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
const SHOPIFY_PRODUCT_ID = (process.env.SHOPIFY_PRODUCT_ID || '').trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const secret = String(req.query.secret || '');
    if (!CRON_SECRET || secret !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!SHOPIFY_PRODUCT_ID) return res.status(500).json({ error: 'SHOPIFY_PRODUCT_ID not set' });

    try {
        const token = await getShopifyAccessToken();
        const action = String(req.query.action || 'list-variants');

        const listRes = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${SHOPIFY_PRODUCT_ID}/variants.json?limit=250`,
            { headers: { 'X-Shopify-Access-Token': token } }
        );
        if (!listRes.ok) {
            return res.status(502).json({ error: 'Failed to list variants', status: listRes.status });
        }
        const variants = (await listRes.json()).variants || [];
        const defaultVariant = variants.find((v: any) => !String(v.option1 || '').startsWith('MFC-'));

        if (action === 'list-variants') {
            return res.status(200).json({ count: variants.length, variants: variants.map((v: any) => ({
                id: v.id, option1: v.option1, price: v.price, image_id: v.image_id,
            })) });
        }

        if (!defaultVariant) {
            return res.status(404).json({ error: 'No default (non-MFC-*) variant found', count: variants.length });
        }

        if (action === 'set-default-price') {
            const price = String(req.query.price || '').trim();
            if (!price || !/^\d+(\.\d{1,2})?$/.test(price)) {
                return res.status(400).json({ error: 'price query param required, e.g. ?price=1500' });
            }
            const upd = await fetch(
                `https://${SHOPIFY_STORE}/admin/api/2025-10/variants/${defaultVariant.id}.json`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
                    body: JSON.stringify({ variant: { id: defaultVariant.id, price } }),
                }
            );
            const body = await upd.json();
            return res.status(upd.ok ? 200 : 502).json({ ok: upd.ok, status: upd.status, variant: body.variant });
        }

        if (action === 'set-default-image') {
            const imageUrl = String(req.query.imageUrl || '').trim();
            if (!imageUrl) return res.status(400).json({ error: 'imageUrl query param required' });

            // 1. Create a product image from the URL and attach it to the default variant.
            const create = await fetch(
                `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${SHOPIFY_PRODUCT_ID}/images.json`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
                    body: JSON.stringify({ image: { src: imageUrl, variant_ids: [defaultVariant.id] } }),
                }
            );
            const body = await create.json();
            return res.status(create.ok ? 200 : 502).json({ ok: create.ok, status: create.status, image: body.image });
        }

        return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}
