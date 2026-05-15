import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/shopify/callback
 *
 * OAuth callback endpoint. Shopify redirects here after the store owner
 * approves the app. Exchanges the authorization code for a permanent
 * offline access token and displays it.
 *
 * The token should be copied and set as SHOPIFY_ACCESS_TOKEN in Vercel
 * Environment Variables. After that, these install/callback endpoints
 * can be removed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        const shop = process.env.SHOPIFY_STORE;
        const clientId = process.env.SHOPIFY_CLIENT_ID;
        const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

        console.log('[CALLBACK] Received callback. Query params:', JSON.stringify(req.query));

        if (!shop || !clientId || !clientSecret) {
            return res.status(500).json({
                error: 'Missing Shopify environment variables.',
            });
        }

        const { code } = req.query;

        if (!code || typeof code !== 'string') {
            return res.status(400).json({ error: 'Missing authorization code from Shopify.' });
        }

        // Exchange the authorization code for a permanent access token
        console.log('[CALLBACK] Exchanging code for token...');
        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code,
            }),
        });

        if (!tokenRes.ok) {
            const errorText = await tokenRes.text();
            console.error('[CALLBACK] Token exchange failed:', tokenRes.status, errorText);
            return res.status(502).json({
                error: 'Failed to exchange code for access token.',
                status: tokenRes.status,
                details: errorText,
            });
        }

        const data = await tokenRes.json();
        const accessToken: string = data.access_token;
        const scope: string = data.scope || '';

        console.log('[CALLBACK] Token obtained successfully. Scopes:', scope);

        // Display the token to the user (one-time setup page)
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(`<!DOCTYPE html>
<html>
<head>
  <title>Shopify App Authorized</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 600px; margin: 60px auto; padding: 20px; color: #333; }
    h1 { color: #2e7d32; }
    .token-box { background: #f5f5f5; border: 2px solid #ddd; border-radius: 8px; padding: 16px; margin: 20px 0; word-break: break-all; font-family: monospace; font-size: 14px; user-select: all; cursor: text; }
    .steps { background: #fff3e0; border: 1px solid #ffe0b2; border-radius: 8px; padding: 16px 16px 16px 32px; margin: 20px 0; }
    .steps li { margin-bottom: 8px; }
    .warning { background: #fce4ec; border: 1px solid #ef9a9a; border-radius: 8px; padding: 12px 16px; margin: 20px 0; font-size: 14px; }
    code { background: #e8e8e8; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>&#10003; App Authorized Successfully</h1>
  <p>Scopes granted: <code>${scope}</code></p>

  <h3>Your Access Token:</h3>
  <div class="token-box">${accessToken}</div>

  <div class="warning">
    <strong>Important:</strong> This token is shown only once. Copy it now.
    After setting it in Vercel, you can delete the <code>/api/shopify/install.ts</code>
    and <code>/api/shopify/callback.ts</code> files.
  </div>

  <h3>Next Steps:</h3>
  <ol class="steps">
    <li>Copy the token above</li>
    <li>Go to <strong>Vercel Dashboard</strong> &rarr; your project &rarr; <strong>Settings</strong> &rarr; <strong>Environment Variables</strong></li>
    <li>Add a new variable: <code>SHOPIFY_ACCESS_TOKEN</code> = the token you copied</li>
    <li>Redeploy the project (or the next deployment will pick it up)</li>
    <li>Test "Add to Cart" on your Shopify product page</li>
  </ol>
</body>
</html>`);
    } catch (err: any) {
        console.error('[CALLBACK] Error:', err);
        return res.status(500).json({ error: err.message || 'Internal error during token exchange.' });
    }
}
