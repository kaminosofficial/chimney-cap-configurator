import {
    DEFAULT_GAUGE_MULT,
    DEFAULT_MATERIAL_MULT,
    DEFAULT_MODEL_COEFFICIENTS,
    type PricingLike,
} from '../utils/pricing.js';

export interface CapBracket {
    w_max: number;
    l_max: number;
}

export interface CapSurcharges {
    steep_pitch_pct: number;       // fraction, e.g. 0.10
    steep_pitch_threshold: number; // lid_pitch /12
    tall_skirt_pct: number;
    tall_skirt_threshold: number;  // inches
    extra_overhang_pct: number;
    std_overhang_flat: number;     // inches
    std_overhang_non_flat: number; // inches
    tall_screen_pct: number;
    tall_screen_threshold: number; // inches
}

export interface PricingConstants extends PricingLike {
    STORM_COLLAR_PRICES: Record<number, number>;
    /** Cap multipliers keyed `${mount}_${lid_type}_${bracket}` (lowercase). */
    CAP_MULTIPLIERS: Record<string, number>;
    CAP_BRACKETS: { flat: CapBracket; non_flat: CapBracket };
    CAP_SURCHARGES: CapSurcharges;
}

// Default values (used as fallback and for local dev)
// Storm collar diameter = hole diameter - 1". Keys = collarDia * 10.
// Prices from product catalog; sizes 15, 17, 20+ are extrapolated.
export let PRICING: PricingConstants = {
    EXT_ANCHOR: 489.33,
    EXT_S_W: 4.245,
    EXT_S_L: 2.495,
    EXT_S_AREA: 0.040,
    MARGIN_RATE: 0,
    HOLE_PRICE: 25,
    SKIRT_SURCHARGE: 75,
    SKIRT_THRESHOLD: 6,
    PAINTED_MULTIPLIER: 1.5,
    GAUGE_MULT: { ...DEFAULT_GAUGE_MULT },
    MATERIAL_MULT: { ...DEFAULT_MATERIAL_MULT },
    MODEL_COEFFICIENTS: { ...DEFAULT_MODEL_COEFFICIENTS },
    STORM_COLLAR_PRICES: {
        40: 30,
        50: 30,
        55: 30,
        60: 30,
        65: 40,
        70: 40,
        80: 40,
        90: 50,
        100: 60,
        110: 60,
        120: 60,
        130: 70,
        140: 70,
        150: 75,
        160: 80,
        170: 90,
        180: 100,
        200: 120,
        220: 140,
        240: 160,
        260: 180,
        280: 200,
        290: 210,
    },
    // Cap pricing is sheet-only — see lib/pricing-sheet.ts for the same comment.
    CAP_MULTIPLIERS: {},
    CAP_BRACKETS: {
        flat:     { w_max: 0, l_max: 0 },
        non_flat: { w_max: 0, l_max: 0 },
    },
    CAP_SURCHARGES: {
        steep_pitch_pct: 0,
        steep_pitch_threshold: 0,
        tall_skirt_pct: 0,
        tall_skirt_threshold: 0,
        extra_overhang_pct: 0,
        std_overhang_flat: 0,
        std_overhang_non_flat: 0,
        tall_screen_pct: 0,
        tall_screen_threshold: 0,
    },
};

/**
 * Returns the storm collar price for a given hole diameter.
 * Storm collar diameter = holeDia - 1". Looks up nearest size <= collar diameter.
 */
export function getStormCollarPrice(holeDia: number): number {
    const collarDiaTenths = Math.floor((holeDia - 1) * 10);
    const prices = PRICING.STORM_COLLAR_PRICES;
    const keys = Object.keys(prices).map(Number).sort((a, b) => b - a);
    for (const key of keys) {
        if (key <= collarDiaTenths) return prices[key];
    }
    return 0;
}

let _loaded = false;
let _apiReachable = false;
const _listeners: Array<() => void> = [];

export function onPricingLoaded(cb: () => void) {
    if (_loaded) { cb(); return; }
    _listeners.push(cb);
}

/** Whether the Vercel API was successfully reached at least once this session. */
export function isApiReachable(): boolean {
    return _apiReachable;
}

// Fetch pricing from the Vercel API (which reads from Google Sheets)
// This is called once on app startup.
// The API_BASE should be set in shopify-entry.tsx or detected automatically.
const PRICING_LOAD_MAX_ATTEMPTS = 3;

export async function loadPricingFromAPI(apiBase: string) {
    for (let attempt = 1; attempt <= PRICING_LOAD_MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(`${apiBase}/api/pricing`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(`Expected JSON, got ${contentType}`);
            }

            const data = await res.json();
            PRICING = {
                ...PRICING,
                ...data,
                GAUGE_MULT: { ...PRICING.GAUGE_MULT, ...(data.GAUGE_MULT ?? {}) },
                MATERIAL_MULT: { ...PRICING.MATERIAL_MULT, ...(data.MATERIAL_MULT ?? {}) },
                MODEL_COEFFICIENTS: { ...PRICING.MODEL_COEFFICIENTS, ...(data.MODEL_COEFFICIENTS ?? {}) },
                STORM_COLLAR_PRICES: { ...PRICING.STORM_COLLAR_PRICES, ...(data.STORM_COLLAR_PRICES ?? {}) },
                CAP_MULTIPLIERS: { ...PRICING.CAP_MULTIPLIERS, ...(data.CAP_MULTIPLIERS ?? {}) },
                CAP_BRACKETS: data.CAP_BRACKETS ?? PRICING.CAP_BRACKETS,
                CAP_SURCHARGES: { ...PRICING.CAP_SURCHARGES, ...(data.CAP_SURCHARGES ?? {}) },
            };
            _apiReachable = true;
            break;
        } catch (err) {
            if (attempt < PRICING_LOAD_MAX_ATTEMPTS) {
                await new Promise(r => setTimeout(r, 1500 * attempt));
                continue;
            }
            console.warn('[ChaseConfigurator] Failed to fetch pricing from API after', PRICING_LOAD_MAX_ATTEMPTS, 'attempts, using defaults:', err);
        }
    }
    _loaded = true;
    _listeners.forEach(cb => cb());
    _listeners.length = 0;
}
