/**
 * Shared Shopify authentication module.
 * Used by api/add-to-cart.ts, api/create-order.ts, and api/variant-image.ts.
 */

const SHOPIFY_STORE = (process.env.SHOPIFY_STORE || '').trim();
const SHOPIFY_ACCESS_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim() || undefined;
const SHOPIFY_CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || '').trim() || undefined;
const SHOPIFY_CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || '').trim() || undefined;

const SHOPIFY_TOKEN_URL = `https://${SHOPIFY_STORE}/admin/oauth/access_token`;

let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get a Shopify Admin API access token.
 * Priority: static SHOPIFY_ACCESS_TOKEN env var > cached OAuth token > fresh OAuth grant.
 */
export async function getShopifyAccessToken(): Promise<string> {
    // 1. Static token (preferred for client store deployments)
    if (SHOPIFY_ACCESS_TOKEN) {
        return SHOPIFY_ACCESS_TOKEN;
    }

    // 2. Cached OAuth token (still valid for > 5 minutes)
    if (tokenCache && tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
        return tokenCache.token;
    }

    // 3. Fresh OAuth client_credentials grant
    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
        throw new Error('Missing Shopify credentials. Set SHOPIFY_ACCESS_TOKEN or CLIENT_ID/SECRET.');
    }

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
    });

    const res = await fetch(SHOPIFY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify token request failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const expiresIn = data.expires_in || 3600;
    tokenCache = { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return data.access_token;
}

/** The configured Shopify store domain. */
export { SHOPIFY_STORE };

/**
 * Log a warning if the request Origin is not from a known domain.
 * Does NOT block requests (to avoid breaking integrations), just logs.
 */
export function warnUnknownOrigin(origin: string | undefined, tag: string): void {
    if (!origin) return; // No Origin header (same-origin requests, cron jobs, etc.)

    const ALLOWED_PATTERNS = [
        /^https?:\/\/(www\.)?kaminos\.com$/,
        /^https?:\/\/chase-cover-configurator[^.]*\.vercel\.app$/,
        /^https?:\/\/localhost(:\d+)?$/,
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    ];

    const isAllowed = ALLOWED_PATTERNS.some(pattern => pattern.test(origin));
    if (!isAllowed) {
        console.warn(`[${tag}] Request from unknown origin: ${origin}`);
    }
}
