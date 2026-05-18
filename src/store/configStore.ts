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

export interface CapPriceStep {
  label: string;
  factor: number;        // raw multiplier (1.05 for +5%, 3.0 for × 3)
  factorLabel: string;   // human-friendly: "+5%" for surcharges, "× 3" for multipliers, "—" if skipped
  applied: boolean;
  detail: string;        // why it was / wasn't applied (e.g. "screen_height 20 > 16")
  prevCost: number;      // running cost BEFORE this step
  runningCost: number;   // running cost AFTER this step
  delta: number;         // runningCost - prevCost (0 if skipped)
}

export interface CapPriceBreakdown {
  width: number;
  length: number;
  mount: string;
  lid_type: string;
  material: string;
  bracket: 'small' | 'large';
  bracketRule: string;     // human-readable, e.g. "W ≤ 33 ✓, L ≤ 67 ✓"
  multiplierKey: string;   // e.g. "skirt_flat_small"
  multiplier: number;
  multiplierFromSheet: boolean;
  baseCost: number;        // (w + l) × multiplier
  steps: CapPriceStep[];
  marginRate: number;
  total: number;
}

// Cap pricing pipeline (sheet-driven; no Call-for-Pricing branches — every input produces a price).
//   1. base = (w + l) × MULT[mount_lid_bracket]                         (PDF 4/17/2023 multipliers)
//   2. × MATERIAL_MULT[material]                                        (copper = 3 from sheet)
//   3. × surcharges (pitch / skirt / overhang / screen — all cumulative)
//   4. × PAINTED_MULTIPLIER if powder_coat && !copper
//   5. × MARGIN_RATE (Kaminos margin, multiplier semantics)
// All thresholds and percentages live in the "Cap configurator" block (H/I) of the Google Sheet.
export function computeCapPriceBreakdown(s: Partial<StoreData>): CapPriceBreakdown {
  const w = s.width || 24;
  const l = s.length || 36;
  const screen = s.screen_height || 10;
  const mount = s.mount || 'skirt';
  const lid_type = s.lid_type || 'flat';
  const material = s.material || 'stainless';
  const pitch = s.lid_pitch ?? 5;
  const vSkirt = s.vertical_skirt ?? 3;
  const overhang = s.lid_overhang ?? (lid_type === 'flat' ? 3 : 4);

  // Bracket: small only if BOTH dimensions fit; large otherwise (no upper cap).
  const bracketDims = lid_type === 'flat' ? PRICING.CAP_BRACKETS.flat : PRICING.CAP_BRACKETS.non_flat;
  const wFits = w <= bracketDims.w_max;
  const lFits = l <= bracketDims.l_max;
  const bracket: 'small' | 'large' = wFits && lFits ? 'small' : 'large';
  const bracketRule = `W ${wFits ? '≤' : '>'} ${bracketDims.w_max} ${wFits ? '✓' : '✗'}, L ${lFits ? '≤' : '>'} ${bracketDims.l_max} ${lFits ? '✓' : '✗'}`;

  const multiplierKey = `${mount}_${lid_type}_${bracket}`;
  const multiplierFromSheet = multiplierKey in PRICING.CAP_MULTIPLIERS;
  const multiplier = PRICING.CAP_MULTIPLIERS[multiplierKey] ?? 1;

  const baseCost = (w + l) * multiplier;
  let cost = baseCost;
  const steps: CapPriceStep[] = [];

  const sur = PRICING.CAP_SURCHARGES;
  const stdOverhang = lid_type === 'flat' ? sur.std_overhang_flat : sur.std_overhang_non_flat;
  const materialMult = PRICING.MATERIAL_MULT[material] ?? 1;

  const push = (label: string, factor: number, applied: boolean, detail: string, factorLabel: string) => {
    const prevCost = cost;
    if (applied) cost *= factor;
    steps.push({ label, factor, factorLabel: applied ? factorLabel : '—', applied, detail, prevCost, runningCost: cost, delta: cost - prevCost });
  };

  // Surcharges use "+N%" labels; multiplicative factors use "× N".
  const pct = (rate: number) => `+${Math.round(rate * 100)}%`;
  const mult = (factor: number) => `× ${factor.toFixed(factor === Math.round(factor) ? 0 : 2).replace(/\.?0+$/, '')}`;

  push('Material', materialMult, materialMult !== 1, material, mult(materialMult));
  push('Steep pitch', 1 + sur.steep_pitch_pct, pitch > sur.steep_pitch_threshold,
    `lid_pitch ${pitch} ${pitch > sur.steep_pitch_threshold ? '>' : '≤'} ${sur.steep_pitch_threshold}`,
    pct(sur.steep_pitch_pct));
  push('Tall skirt', 1 + sur.tall_skirt_pct,
    mount !== 'top_mount' && vSkirt > sur.tall_skirt_threshold,
    mount === 'top_mount' ? 'top_mount: no skirt' : `vertical_skirt ${vSkirt} ${vSkirt > sur.tall_skirt_threshold ? '>' : '≤'} ${sur.tall_skirt_threshold}`,
    pct(sur.tall_skirt_pct));
  push('Extra overhang', 1 + sur.extra_overhang_pct, overhang > stdOverhang,
    `overhang ${overhang} ${overhang > stdOverhang ? '>' : '≤'} ${stdOverhang} (std)`,
    pct(sur.extra_overhang_pct));
  push('Tall screen', 1 + sur.tall_screen_pct, screen > sur.tall_screen_threshold,
    `screen_height ${screen} ${screen > sur.tall_screen_threshold ? '>' : '≤'} ${sur.tall_screen_threshold}`,
    pct(sur.tall_screen_pct));
  push('Powder coat', PRICING.PAINTED_MULTIPLIER, !!s.powder_coat && material !== 'copper',
    s.powder_coat ? (material === 'copper' ? 'copper: not applied' : 'on') : 'off',
    mult(PRICING.PAINTED_MULTIPLIER));

  // Multiplier semantics (NOT 1 + rate): sheet "300%" → MARGIN_RATE = 3.0 → final = cost × 3.0.
  // Fallback to ×1 when the sheet is unreachable so we never display $0.
  const marginRate = PRICING.MARGIN_RATE > 0 ? PRICING.MARGIN_RATE : 1;
  push('Kaminos margin', marginRate, marginRate !== 1, 'sheet "Kaminos Margin"', mult(marginRate));

  return {
    width: w, length: l, mount, lid_type, material,
    bracket, bracketRule,
    multiplierKey, multiplier, multiplierFromSheet,
    baseCost, steps, marginRate, total: cost,
  };
}

export function computeCapPrice(s: Partial<StoreData>): number {
  return computeCapPriceBreakdown(s).total;
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
  useConfigStore.setState({ price: computeCapPrice(state) });
});
