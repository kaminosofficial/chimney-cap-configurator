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
    // PDF "4/17/2023" defaults for the cap configurator. Live values come from the
    // "Cap configurator" block (H/I) of the pricing sheet; these are the fallbacks.
    CAP_MULTIPLIERS: {
        skirt_flat_small: 6.47,
        skirt_flat_large: 8.09,
        skirt_hip_ridge_small: 9.03,
        skirt_hip_ridge_large: 11.29,
        skirt_hip_small: 9.39,
        skirt_hip_large: 11.73,
        skirt_standing_seam_small: 12.17,
        skirt_standing_seam_large: 15.21,
        pitched_skirt_flat_small: 7.64,
        pitched_skirt_flat_large: 9.56,
        pitched_skirt_hip_ridge_small: 9.40,
        pitched_skirt_hip_ridge_large: 11.75,
        pitched_skirt_hip_small: 10.07,
        pitched_skirt_hip_large: 12.59,
        pitched_skirt_standing_seam_small: 12.50,
        pitched_skirt_standing_seam_large: 15.63,
        top_mount_flat_small: 4.91,
        top_mount_flat_large: 6.14,
        top_mount_hip_ridge_small: 7.98,
        top_mount_hip_ridge_large: 9.98,
        top_mount_hip_small: 8.68,
        top_mount_hip_large: 10.85,
        top_mount_standing_seam_small: 8.70,
        top_mount_standing_seam_large: 10.88,
    },
    CAP_BRACKETS: {
        flat:     { w_max: 33, l_max: 67 },
        non_flat: { w_max: 45, l_max: 67 },
    },
    CAP_SURCHARGES: {
        steep_pitch_pct: 0.10,
        steep_pitch_threshold: 5,
        tall_skirt_pct: 0.05,
        tall_skirt_threshold: 4,
        extra_overhang_pct: 0.10,
        std_overhang_flat: 3,
        std_overhang_non_flat: 4,
        tall_screen_pct: 0.05,
        tall_screen_threshold: 16,
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
