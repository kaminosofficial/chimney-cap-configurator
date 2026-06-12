import { create } from 'zustand';
import { PRICING, onPricingLoaded } from '../config/pricing';
import { computeCapPriceBreakdown as computeCapPriceBreakdownShared } from '../utils/capPricing';

export type Mount = 'skirt' | 'pitched_skirt' | 'top_mount';
export type LidType = 'flat' | 'hip' | 'hip_ridge' | 'standing_seam';
export type Mat = 'stainless' | 'copper';

export interface CapConfig {
  // Style
  mount: Mount;            // default 'skirt'
  lid_type: LidType;       // default 'hip_ridge'

  // Dimensions (inches, 1/8" snap)
  length: number;          // default 36
  width: number;           // default 24

  // Skirt + Pitched Skirt only
  vertical_skirt: number;     // default 3
  horizontal_skirt: number;   // default 2
  drip_edge: boolean;         // default true

  // Top Mount only
  flange_width: number;       // default 1.5  (bolt-down flange overhang)

  // Cage
  screen_height: number;      // default 10  (standards: 8/10/12/16)

  // Lid
  lid_overhang: number;       // default 3 for flat, 4 for others
  lid_pitch: number;          // default 5 (means n/12)  — non-Flat lids only
  cross_break: boolean;       // default true (adds diagonal crease to flat lids)
  seam_count: number;         // default 4  — Standing Seam only (per side)

  // Finish
  material: Mat;              // default 'stainless'
  powder_coat: boolean;       // default false (only when material = 'stainless')
  powder_coat_color: string;  // default '#0B0E0F'

  // Order
  quantity: number;
  notes: string;

  price: number;
  pricingLoaded: boolean;        // false until /api/pricing resolves; gates
                                 // PriceDisplay so we never flash a stale local
                                 // price before the sheet-driven total renders.

  // Viewer state
  orbitEnabled: boolean;
  setOrbitEnabled: (v: boolean) => void;
  showDimensions: boolean;       // dim-overlay popup (summary in top-right of viewer)
  showDimLabels: boolean;        // 3D yellow labels/arrows on the model itself
                                 // (gated separately from the popup so opening
                                 // the popup doesn't immediately clutter the view)

  set: (partial: Partial<CapConfig>) => void;
}

type StoreData = Omit<CapConfig, 'set' | 'setOrbitEnabled'>;

// Cap pricing lives in src/utils/capPricing.ts — ONE implementation shared with
// the server (api/add-to-cart.ts), so the displayed price and the price charged
// at checkout can never drift. These wrappers bind it to the live client
// PRICING object (sheet values merged over local defaults).
export type { CapPriceBreakdown, CapPriceStep } from '../utils/capPricing';

export function computeCapPriceBreakdown(s: Partial<StoreData>) {
  return computeCapPriceBreakdownShared(s, PRICING);
}

export function computeCapPrice(s: Partial<StoreData>): number {
  return computeCapPriceBreakdownShared(s, PRICING).total;
}

const initial: StoreData = {
  mount: 'skirt',
  lid_type: 'flat',
  length: 36,
  width: 24,
  vertical_skirt: 3,
  horizontal_skirt: 2,
  drip_edge: true,
  flange_width: 1.5,
  screen_height: 10,
  lid_overhang: 3, // standard for flat (initial lid_type). Auto-snaps when lid changes (see `set` reducer).
  lid_pitch: 5,
  cross_break: true,
  seam_count: 4,
  material: 'stainless',
  powder_coat: false,
  powder_coat_color: '#0B0E0F',
  quantity: 1,
  notes: '',
  price: 0,
  pricingLoaded: false,
  orbitEnabled: true,
  showDimensions: false,
  showDimLabels: false,
};
initial.price = computeCapPrice(initial);

const RESTORE_KEY = 'mfc-config-restore';

/** Save current config to sessionStorage before navigating to cart. */
export function saveConfigForRestore() {
  try {
    const s = useConfigStore.getState();
    const data = {
      mount: s.mount,
      lid_type: s.lid_type,
      length: s.length,
      width: s.width,
      vertical_skirt: s.vertical_skirt,
      horizontal_skirt: s.horizontal_skirt,
      drip_edge: s.drip_edge,
      flange_width: s.flange_width,
      screen_height: s.screen_height,
      lid_overhang: s.lid_overhang,
      lid_pitch: s.lid_pitch,
      cross_break: s.cross_break,
      seam_count: s.seam_count,
      material: s.material,
      powder_coat: s.powder_coat,
      powder_coat_color: s.powder_coat_color,
      quantity: s.quantity,
      notes: s.notes,
    };
    sessionStorage.setItem(RESTORE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

/** Restore config from sessionStorage (back-from-cart), then clear it.
 *  Returns true if config was restored. */
export function restoreConfigIfNeeded(): boolean {
  try {
    const raw = sessionStorage.getItem(RESTORE_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(RESTORE_KEY);
    const data = JSON.parse(raw);
    useConfigStore.getState().set(data);
    return true;
  } catch {
    sessionStorage.removeItem(RESTORE_KEY);
    return false;
  }
}

export const useConfigStore = create<CapConfig>()(
  (set) => ({
    ...initial,
    set: (partial) => set(state => {
      const overrides: Partial<CapConfig> = {};

      // Auto-disable powder coat if copper.
      if (partial.material === 'copper') overrides.powder_coat = false;

      // When lid_type changes, snap lid_overhang to the new standard ONLY if the user
      // hadn't customized it for the old lid (i.e., current value == old standard).
      // If they typed a custom value, it persists across lid switches.
      const lidChanging = partial.lid_type !== undefined && partial.lid_type !== state.lid_type;
      if (lidChanging && partial.lid_overhang === undefined) {
        const oldStd = state.lid_type === 'flat' ? 3 : 4;
        const newStd = partial.lid_type === 'flat' ? 3 : 4;
        if (state.lid_overhang === oldStd) overrides.lid_overhang = newStd;
      }

      const next = { ...state, ...partial, ...overrides };
      const nextPrice = computeCapPrice(next);
      // Only include `price` in the patch when it actually changed, so PriceDisplay (and
      // anything else subscribed to `price`) doesn't re-render on unrelated mutations like
      // notes-typing or orbitEnabled toggles.
      return nextPrice === state.price
        ? { ...partial, ...overrides }
        : { ...partial, ...overrides, price: nextPrice };
    }),
    setOrbitEnabled: (v: boolean) => set({ orbitEnabled: v }),
  })
);

onPricingLoaded(() => {
  const state = useConfigStore.getState();
  useConfigStore.setState({ price: computeCapPrice(state), pricingLoaded: true });
});
