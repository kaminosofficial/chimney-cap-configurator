import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchPricingFromPublicSheet } from '../lib/pricing-sheet.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = 'pricing';

async function fetchPricing() {
    return fetchPricingFromPublicSheet(SHEET_ID, SHEET_NAME);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    try {
        const pricing = await fetchPricing();
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).json(pricing);
    } catch (err: any) {
        console.error('Pricing fetch error:', err);
        return res.status(500).json({ error: 'Failed to fetch pricing' });
    }
}
