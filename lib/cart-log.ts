/* ------------------------------------------------------------------ */
/*  Durable cart telemetry → Google Sheet (via Apps Script web app)    */
/* ------------------------------------------------------------------ */
//
// Vercel runtime logs are ephemeral (the CLI only tails ~5 min and nothing
// backfills), so intermittent Add-to-Cart / Buy-Now failures were impossible to
// diagnose after the fact. This helper appends a durable row to a Google Sheet
// (the same sheet workflow the project already uses for pricing) through a tiny
// Apps Script web app, so failures survive for review.
//
// Design rules:
//  - NEVER throws and NEVER blocks the cart. Every failure path degrades to a
//    console.log and a `false` return — the caller's response is unaffected.
//  - Hard timeout so a slow/hung Apps Script can't eat the caller's function
//    budget (e.g. /api/add-to-cart only has 30s total).
//  - A shared token in the body keeps random POSTs from spamming the sheet.

const CART_LOG_WEBHOOK_URL = (process.env.CART_LOG_WEBHOOK_URL || '').trim();
const CART_LOG_TOKEN = (process.env.CART_LOG_TOKEN || '').trim();

export interface CartLogRow {
    /** ISO timestamp; filled in automatically if omitted. */
    at?: string;
    /** Row category, e.g. 'client-failure' | 'server-variant-created'. */
    type: string;
    requestId?: string | null;
    action?: string | null;
    phase?: string | null;
    failureKind?: string | null;
    variantId?: string | number | null;
    variantIdObtained?: boolean | null;
    serverTimingMs?: number | null;
    /** Per-attempt breakdown — object/array, stringified into the cell. */
    attempts?: unknown;
    device?: unknown;
    connection?: unknown;
    configSummary?: unknown;
    errorMessage?: string | null;
    [key: string]: unknown;
}

/**
 * Append one or more rows to the Cart Log Google Sheet.
 * Returns `true` only when the webhook acknowledged the write, so callers can
 * decide whether buffered records may be dropped. Returns `false` (and logs)
 * when no webhook is configured or the POST fails — never rejects.
 */
export async function appendCartLogRow(
    rows: CartLogRow | CartLogRow[],
    timeoutMs = 4000,
): Promise<boolean> {
    const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({
        at: r.at || new Date().toISOString(),
        ...r,
    }));

    if (!CART_LOG_WEBHOOK_URL) {
        // No durable sink configured — keep a console trail so local/dev runs
        // still surface the event, then report "not persisted".
        console.log('[CART-LOG] (no webhook configured)', JSON.stringify(list).slice(0, 4000));
        return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(CART_LOG_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: CART_LOG_TOKEN, rows: list }),
            signal: controller.signal,
        });
        if (!res.ok) {
            console.warn('[CART-LOG] webhook HTTP', res.status);
            return false;
        }
        return true;
    } catch (err: any) {
        console.warn('[CART-LOG] webhook failed:', err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (err?.message || err));
        return false;
    } finally {
        clearTimeout(timer);
    }
}
