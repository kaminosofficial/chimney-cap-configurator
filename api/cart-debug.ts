import type { VercelRequest, VercelResponse } from '@vercel/node';
import { appendCartLogRow, type CartLogRow } from '../lib/cart-log.js';

function normalizeBody(rawBody: unknown) {
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody);
    } catch {
      return { raw: rawBody };
    }
  }

  if (rawBody && typeof rawBody === 'object') {
    return rawBody;
  }

  return { raw: rawBody ?? null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const body = normalizeBody(req.body) as any;
  const logPayload = {
    at: new Date().toISOString(),
    origin: req.headers.origin || null,
    referer: req.headers.referer || null,
    body,
  };

  console.log('[CART-DBG]', JSON.stringify(logPayload).slice(0, 12000));

  // Durable failure telemetry → Google Sheet. The client buffers terminal
  // Add-to-Cart / Buy-Now failures in localStorage (the network may be down at
  // failure time) and flushes them here once connectivity returns. We persist
  // each record as a sheet row and report whether it was actually written, so
  // the client only drops records it knows are durable. Best-effort — a failed
  // sheet write never affects the 200 response.
  if (body && body.kind === 'cart-failure-report' && Array.isArray(body.reports)) {
    const rows: CartLogRow[] = body.reports.map((r: any) => ({
      type: 'client-failure',
      at: r.at,
      requestId: r.requestId ?? null,
      action: r.action ?? null,
      phase: r.phase ?? null,
      failureKind: r.failureKind ?? null,
      variantId: r.variantId ?? null,
      variantIdObtained: r.variantIdObtained ?? null,
      serverTimingMs: r.serverTimingMs ?? null,
      attempts: r.attemptLog ?? null,
      device: r.device ?? null,
      connection: r.connection ?? null,
      configSummary: r.configSummary ?? null,
      errorMessage: r.errorMessage ?? null,
    }));
    const persisted = rows.length > 0 ? await appendCartLogRow(rows) : true;
    return res.status(200).json({ ok: true, persisted, received: rows.length });
  }

  return res.status(200).json({ ok: true });
}
