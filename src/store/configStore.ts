import { create } from 'zustand';
import { PRICING, onPricingLoaded } from '../config/pricing';

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

  // Viewer state
  orbitEnabled: boolean;
  setOrbitEnabled: (v: boolean) => void;
  showDimensions: boolean;

  set: (partial: Partial<CapConfig>) => void;
}

type StoreData = Omit<CapConfig, 'set' | 'setOrbitEnabled'>;

// Cap pricing pipeline (sheet-driven; no Call-for-Pricing branches — every input produces a price).
//   1. base = (w + l) × MULT[mount_lid_bracket]                         (PDF 4/17/2023 multipliers)
//   2. × MATERIAL_MULT[material]                                        (copper = 3 from sheet)
//   3. × surcharges (pitch / skirt / overhang / screen — all cumulative)
//   4. × PAINTED_MULTIPLIER if powder_coat && !copper
//   5. × MARGIN_RATE (Kaminos margin, multiplier semantics)
// All thresholds and percentages live in the "Cap configurator" block (H/I) of the Google Sheet.
export function computeCapPrice(s: Partial<StoreData>): number {
  const w = s.width || 24;
  const l = s.length || 36;
  const screen = s.screen_height || 10;
  const mount = s.mount || 'skirt';
  const lid_type = s.lid_type || 'flat';
  const material = s.material || 'stainless';

  // Bracket: small only if BOTH dimensions fit; large otherwise (no upper cap).
  const bracketDims = lid_type === 'flat' ? PRICING.CAP_BRACKETS.flat : PRICING.CAP_BRACKETS.non_flat;
  const bracket = w <= bracketDims.w_max && l <= bracketDims.l_max ? 'small' : 'large';
  const multiplier = PRICING.CAP_MULTIPLIERS[`${mount}_${lid_type}_${bracket}`] ?? 1;

  let cost = (w + l) * multiplier;
  cost *= PRICING.MATERIAL_MULT[material] ?? 1;

  const sur = PRICING.CAP_SURCHARGES;
  if ((s.lid_pitch ?? 5) > sur.steep_pitch_threshold) cost *= 1 + sur.steep_pitch_pct;
  if (mount !== 'top_mount' && (s.vertical_skirt ?? 3) > sur.tall_skirt_threshold) cost *= 1 + sur.tall_skirt_pct;
  const stdOverhang = lid_type === 'flat' ? sur.std_overhang_flat : sur.std_overhang_non_flat;
  if ((s.lid_overhang ?? stdOverhang) > stdOverhang) cost *= 1 + sur.extra_overhang_pct;
  if (screen > sur.tall_screen_threshold) cost *= 1 + sur.tall_screen_pct;
  if (s.powder_coat && material !== 'copper') cost *= PRICING.PAINTED_MULTIPLIER;

  // Multiplier semantics (NOT 1 + rate): sheet "300%" → MARGIN_RATE = 3.0 → final = cost × 3.0.
  // Fallback to ×1 when the sheet is unreachable so we never display $0.
  const marginMultiplier = PRICING.MARGIN_RATE > 0 ? PRICING.MARGIN_RATE : 1;
  return cost * marginMultiplier;
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
  lid_overhang: 4,
  lid_pitch: 5,
  cross_break: true,
  seam_count: 4,
  material: 'stainless',
  powder_coat: false,
  powder_coat_color: '#0B0E0F',
  quantity: 1,
  notes: '',
  price: 0,
  orbitEnabled: true,
  showDimensions: false,
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
      // Auto-disable powder coat if copper
      const overrides: Partial<CapConfig> = partial.material === 'copper'
        ? { powder_coat: false }
        : {};

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
  useConfigStore.setState({ price: computeCapPrice(state) });
});
