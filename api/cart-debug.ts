import type { VercelRequest, VercelResponse } from '@vercel/node';

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

  const body = normalizeBody(req.body);
  const logPayload = {
    at: new Date().toISOString(),
    origin: req.headers.origin || null,
    referer: req.headers.referer || null,
    body,
  };

  console.log('[CART-DBG]', JSON.stringify(logPayload).slice(0, 12000));
  return res.status(200).json({ ok: true });
}
