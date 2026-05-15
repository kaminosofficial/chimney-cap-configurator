import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getShopifyAccessToken, SHOPIFY_STORE, warnUnknownOrigin } from '../lib/shopify-auth.js';

const SHOPIFY_PRODUCT_ID = (process.env.SHOPIFY_PRODUCT_ID || '').trim() || undefined;

/* ---- GraphQL helper ---- */

async function shopifyGraphQL(query: string, accessToken: string): Promise<any> {
    const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({ query }),
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { errors: [{ message: text.slice(0, 300) }] }; }
}

/* ---- Handler ---- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    warnUnknownOrigin(req.headers.origin as string | undefined, 'IMG');

    const { variantId, productId: rawProductId, image } = req.body || {};
    const productId = rawProductId || SHOPIFY_PRODUCT_ID;

    if (!variantId || !image) {
        return res.status(400).json({ error: 'Missing variantId or image' });
    }
    if (!productId) {
        return res.status(400).json({ error: 'Missing productId' });
    }

    // Reject oversized images to prevent OOM (500KB decoded ≈ 666KB base64)
    const MAX_BASE64_LENGTH = 700_000;
    if (typeof image === 'string' && image.length > MAX_BASE64_LENGTH) {
        const sizeKB = Math.round(image.length * 0.75 / 1024);
        console.warn(`[IMG] Rejected oversized image: ~${sizeKB}KB (max ~500KB)`);
        return res.status(413).json({ error: `Image too large (~${sizeKB}KB). Maximum is ~500KB.` });
    }

    const t0 = Date.now();
    try {
        const accessToken = await getShopifyAccessToken();
        const t1 = Date.now();

        // Detect image type from data URL prefix (client now sends JPEG)
        const isJpeg = image.startsWith('data:image/jpeg');
        const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
        const ext = isJpeg ? 'jpg' : 'png';
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `chase-cover-${variantId}.${ext}`;
        console.log(`[IMG] ① Starting | variantId=${variantId} | size=${Math.round(buffer.length / 1024)}KB | type=${mimeType}`);

        // Step 1: Create staged upload target
        const stageResult = await shopifyGraphQL(`
            mutation {
                stagedUploadsCreate(input: [{
                    resource: PRODUCT_IMAGE
                    filename: "${filename}"
                    mimeType: "${mimeType}"
                    httpMethod: PUT
                }]) {
                    stagedTargets { url resourceUrl }
                    userErrors { field message }
                }
            }
        `, accessToken);
        const t2 = Date.now();

        const target = stageResult?.data?.stagedUploadsCreate?.stagedTargets?.[0];
        const stageErrors = stageResult?.data?.stagedUploadsCreate?.userErrors;
        if (!target?.url) {
            console.warn('[IMG] ① Staged upload mutation failed:', JSON.stringify(stageErrors));
            return res.status(502).json({ error: 'Staged upload failed', details: stageErrors });
        }
        console.log(`[IMG] ② Staged target obtained: ${t2 - t1}ms | resourceUrl=${target.resourceUrl?.slice(0, 80)}...`);

        // Step 2: PUT binary to S3/GCS staged URL
        const uploadRes = await fetch(target.url, {
            method: 'PUT',
            headers: { 'Content-Type': mimeType },
            body: buffer,
        });
        const t3 = Date.now();
        if (!uploadRes.ok) {
            const body = await uploadRes.text().catch(() => '');
            console.error(`[IMG] ③ PUT to staged URL failed: HTTP ${uploadRes.status} (${t3 - t2}ms) | ${body.slice(0, 200)}`);
            return res.status(502).json({ error: `Staged PUT failed: ${uploadRes.status}` });
        }
        console.log(`[IMG] ③ Binary uploaded to stage: ${t3 - t2}ms`);

        // Step 3: Attach to product + variant via REST
        const imgRes = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/images.json`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                body: JSON.stringify({
                    image: { src: target.resourceUrl, variant_ids: [Number(variantId)] },
                }),
            }
        );
        const imgData = await imgRes.json().catch(() => null);
        const t4 = Date.now();
        const imageUrl = imgData?.image?.src;

        if (!imageUrl) {
            console.warn(`[IMG] ④ Attach to variant failed: HTTP ${imgRes.status} (${t4 - t3}ms) | response:`, JSON.stringify(imgData)?.slice(0, 300));
            return res.status(502).json({ error: 'Failed to attach image to variant', details: imgData });
        }
        console.log(`[IMG] ④ Attached to variant: ${t4 - t3}ms | imageUrl=${imageUrl?.slice(0, 80)}`);
        console.log(`[IMG] ✓ TOTAL: ${t4 - t0}ms | breakdown: auth=${t1 - t0}ms stage=${t2 - t1}ms put=${t3 - t2}ms attach=${t4 - t3}ms`);

        return res.status(200).json({ success: true, imageUrl, ms: t4 - t0 });
    } catch (err: any) {
        console.error('[IMG] Error:', err.message, err.stack?.slice(0, 300));
        return res.status(500).json({ error: err.message });
    }
}
