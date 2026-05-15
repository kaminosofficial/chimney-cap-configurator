import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/shopify/install
 *
 * One-time OAuth install endpoint. Redirects to Shopify's authorization
 * consent screen so the store owner can grant the app access.
 *
 * Usage:
 *   Visit https://<your-vercel-app>.vercel.app/api/shopify/install
 *   in a browser while logged into the Shopify admin for kaminosshop.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
    try {
        const shop = process.env.SHOPIFY_STORE;
        const clientId = process.env.SHOPIFY_CLIENT_ID;

        if (!shop || !clientId) {
            return res.status(500).json({
                error: 'Missing SHOPIFY_STORE or SHOPIFY_CLIENT_ID environment variables.',
                shop: shop ? 'set' : 'missing',
                clientId: clientId ? 'set' : 'missing',
            });
        }

        // Determine the callback URL from the request
        const proto = (Array.isArray(req.headers['x-forwarded-proto'])
            ? req.headers['x-forwarded-proto'][0]
            : req.headers['x-forwarded-proto']) || 'https';
        const host = (Array.isArray(req.headers['x-forwarded-host'])
            ? req.headers['x-forwarded-host'][0]
            : req.headers['x-forwarded-host']) || req.headers.host || 'chase-cover-configurator.vercel.app';
        const redirectUri = `${proto.trim()}://${String(host).trim()}/api/shopify/callback`;

        // Generate a simple random nonce for CSRF protection
        const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);

        // Required scopes for express checkout (draft orders), native cart price updates,
        // product/variant lookup fallbacks, and optional preview image uploads.
        const scopes = 'write_draft_orders,read_draft_orders,read_products,write_products,read_files,write_files';

        const authUrl =
            `https://${shop}/admin/oauth/authorize` +
            `?client_id=${clientId}` +
            `&scope=${scopes}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&state=${nonce}`;

        console.log('[INSTALL] Redirecting to Shopify OAuth:', authUrl);
        console.log('[INSTALL] Redirect URI:', redirectUri);

        // Use HTML redirect instead of Location header to avoid
        // "Invalid character in header content" errors on Vercel
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(`<!DOCTYPE html>
<html><head>
<meta http-equiv="refresh" content="0;url=${authUrl}">
</head><body>
<p>Redirecting to Shopify... <a href="${authUrl}">Click here</a> if not redirected.</p>
</body></html>`);
    } catch (err: any) {
        console.error('[INSTALL] Error:', err);
        return res.status(500).json({ error: err.message || 'Internal error' });
    }
}
