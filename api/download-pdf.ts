import type { VercelRequest, VercelResponse } from '@vercel/node';

// Serves a client-generated PDF back with `Content-Disposition: attachment` so the
// browser DOWNLOADS it instead of previewing it. This exists for iPhone/Safari:
// a blob `<a download>` opens the PDF inline on iOS, but a top-level form POST to
// this endpoint returns an attachment, which iOS saves straight to Files (its
// native download banner) without navigating away. Desktop/Android don't need it.
//
// The client (src/utils/pdfGenerator.ts → deliverPdf) submits a hidden form with
// `data` (base64 PDF) and `filename`.

function readField(body: unknown, key: string): string {
  if (body && typeof body === 'object' && typeof (body as any)[key] === 'string') {
    return (body as any)[key];
  }
  if (typeof body === 'string') {
    try { return new URLSearchParams(body).get(key) || ''; } catch { return ''; }
  }
  return '';
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  try {
    const data = readField(req.body, 'data');
    if (!data) { res.status(400).send('Missing PDF data'); return; }

    // Sanitize the filename and guarantee a .pdf extension.
    let name = (readField(req.body, 'filename') || 'document.pdf').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 120);
    if (!name) name = 'document.pdf';
    if (!/\.pdf$/i.test(name)) name += '.pdf';

    const base64 = data.replace(/^data:application\/pdf;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length || buf.length > 12 * 1024 * 1024) {
      res.status(413).send('Invalid or too-large PDF');
      return;
    }

    // iOS Safari PREVIEWS any content it can render (PDF included) inline and
    // ignores `Content-Disposition: attachment`. Sending it as octet-stream — a
    // type Safari can't preview — forces it into the download manager so it saves
    // to Files instead of opening in the browser. The .pdf filename keeps the
    // saved file openable as a normal PDF.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buf);
  } catch {
    res.status(500).send('Failed to serve PDF');
  }
}
