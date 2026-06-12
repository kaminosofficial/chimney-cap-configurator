/* ------------------------------------------------------------------ */
/*  Shared cap pricing — single source of truth for client AND server. */
/*                                                                      */
/*  Client: src/store/configStore.ts wraps this with the live PRICING   */
/*  object (sheet values merged over local defaults).                   */
/*  Server: api/add-to-cart.ts calls it with the sheet pricing fetched  */
/*  via lib/pricing-sheet.ts — tamper-proof, never trusts the client.   */
/*                                                                      */
/*  Keep this module dependency-free so both bundles can import it.     */
/* ------------------------------------------------------------------ */

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
  bracket: string;
  bracketRule: string;     // human-readable, e.g. "W ≤ 33 ✓, L ≤ 67 ✓"
  multiplierKey: string;   // e.g. "skirt_flat_small"
  multiplier: number;
  multiplierFromSheet: boolean;
  baseCost: number;        // (w + l) × multiplier or (w + l + h) × multiplier
  steps: CapPriceStep[];
  marginRate: number;
  total: number;
}

/** The subset of pricing constants the cap pipeline needs. Both the client
 *  PRICING object and the server PricingConstants satisfy this shape. */
export interface CapPricingConstants {
  MARGIN_RATE: number;
  PAINTED_MULTIPLIER: number;
  MATERIAL_MULT: Record<string, number>;
  CAP_MULTIPLIERS: Record<string, number>;
  CAP_BRACKETS: { flat: { w_max: number; l_max: number }; non_flat: { w_max: number; l_max: number } };
  CAP_SURCHARGES: {
    steep_pitch_pct: number; steep_pitch_threshold: number;
    tall_skirt_pct: number; tall_skirt_threshold: number;
    extra_overhang_pct: number; std_overhang_flat: number; std_overhang_non_flat: number;
    tall_screen_pct: number; tall_screen_threshold: number;
  };
}

/** Config fields the pipeline reads. Store state (client) and the cart
 *  payload (server) are both structurally assignable to this. */
export interface CapPricingInput {
  width?: number;
  length?: number;
  screen_height?: number;
  mount?: string;
  lid_type?: string;
  material?: string;
  lid_pitch?: number;
  vertical_skirt?: number;
  lid_overhang?: number;
  powder_coat?: boolean;
}

// Cap pricing pipeline (sheet-driven; no Call-for-Pricing branches — every input produces a price).
//   1. base = (w + l) × MULT[mount_lid_bracket] or (w + l + screen) × MULT[top_mount_flat_bracket] (PDF 5/1/2026 multipliers)
//   2. × MATERIAL_MULT[material]                                        (copper = 3 from sheet)
//   3. × surcharges (pitch / skirt / overhang / screen — all cumulative)
//   4. × PAINTED_MULTIPLIER if powder_coat && !copper
//   5. × MARGIN_RATE (Kaminos margin, multiplier semantics)
// All thresholds and percentages live in the "Cap configurator" block (H/I) of the Google Sheet.
export function computeCapPriceBreakdown(s: CapPricingInput, PRICING: CapPricingConstants): CapPriceBreakdown {
  const w = s.width || 24;
  const l = s.length || 36;
  const screen = s.screen_height || 10;
  const mount = s.mount || 'skirt';
  const lid_type = s.lid_type || 'flat';
  const material = s.material || 'stainless';
  const pitch = s.lid_pitch ?? 5;
  const vSkirt = s.vertical_skirt ?? 3;

  const sur = PRICING.CAP_SURCHARGES;
  const stdOverhang = lid_type === 'flat' ? sur.std_overhang_flat : sur.std_overhang_non_flat;
  // Default to the sheet-driven standard so client and server agree even when
  // lid_overhang is absent from the payload.
  const overhang = s.lid_overhang ?? stdOverhang;

  let bracket: string;
  let bracketRule: string;
  let multiplierKey: string;
  let baseCost: number;

  if (mount === 'top_mount' && lid_type === 'flat') {
    const totalDim = w + l + screen;
    if (totalDim <= 60) {
      bracket = '0_60';
    } else if (totalDim <= 70) {
      bracket = '61_70';
    } else if (totalDim <= 100) {
      bracket = '71_100';
    } else {
      bracket = '101_plus';
    }
    bracketRule = `W + L + H = ${w} + ${l} + ${screen} = ${totalDim}`;
    multiplierKey = `top_mount_flat_${bracket}`;
    const multiplier = PRICING.CAP_MULTIPLIERS[multiplierKey] ?? 1;
    baseCost = totalDim * multiplier;
  } else {
    // Bracket: small only if BOTH dimensions fit; large otherwise (no upper cap).
    const bracketDims = lid_type === 'flat' ? PRICING.CAP_BRACKETS.flat : PRICING.CAP_BRACKETS.non_flat;
    const wFits = w <= bracketDims.w_max;
    const lFits = l <= bracketDims.l_max;
    bracket = wFits && lFits ? 'small' : 'large';
    bracketRule = `W ${wFits ? '≤' : '>'} ${bracketDims.w_max} ${wFits ? '✓' : '✗'}, L ${lFits ? '≤' : '>'} ${bracketDims.l_max} ${lFits ? '✓' : '✗'}`;
    multiplierKey = `${mount}_${lid_type}_${bracket}`;
    const multiplier = PRICING.CAP_MULTIPLIERS[multiplierKey] ?? 1;
    baseCost = (w + l) * multiplier;
  }

  const multiplierFromSheet = multiplierKey in PRICING.CAP_MULTIPLIERS;
  const multiplier = PRICING.CAP_MULTIPLIERS[multiplierKey] ?? 1;
  let cost = baseCost;
  const steps: CapPriceStep[] = [];

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
