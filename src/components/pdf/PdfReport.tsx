import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useConfigStore } from '../../store/configStore';
import { KAMINOS_LOGO_WHITE, getCroppedLogo } from './kaminosLogo';
import { RAL_COLORS } from '../../config/ralColors';

// Human-readable powder-coat label: "Ruby Red (RAL 3002)" (matches the cart
// line item), falling back to the hex if the color isn't a known RAL swatch.
function ralLabel(hex: string): string {
  const match = RAL_COLORS.find(c => c.hex.toLowerCase() === hex.toLowerCase());
  return match ? `${match.name} (${match.ral})` : hex.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// PdfReport  —  paginated "Airy" spec-sheet layout
//
// Renders the printable PDF as one or more explicit A4 pages (.pdf-page, each
// 794×1123px ≈ 210×297mm @ 96dpi). generatePdf() rasterizes EACH .pdf-page
// separately into its own PDF page, so:
//   • a large product image can occupy ~half of page 1,
//   • no spec section is ever split across a page boundary (whole sections flow
//     to the next page), and
//   • the Pricing & Summary card is always pinned to the BOTTOM of the last page.
//
// Pagination is measured: the flow blocks (hero + spec sections) are laid out
// once in a hidden measurer, then greedily packed into pages; the pricing+footer
// "trailer" is bottom-pinned on the last page (or its own page if it can't fit).
// ─────────────────────────────────────────────────────────────────────────────

interface PdfReportProps {
  snapshotUrl?: string;
}

const PAGE_W = 794;
const PAGE_H = 1123;
const SIDE = 53;        // left/right page padding
const PAD_V = 24;       // top/bottom content padding inside a page
const GAP = 22;         // vertical gap between flow blocks

// Airy design tokens
const C = {
  ink: '#171411',
  gold: '#C2974A',
  goldSoft: '#D9BC86',
  label: '#8E8E8E',
  value: '#1A1A1A',
  muted: '#9A9690',
  hair: '#E6E4E0',
  hairStrong: '#D8D5CF',
  footerBg: '#EFEDEA',
  cardBg: '#FBFAF8',
  metaUrl: '#9C988F',
};

const FONT = "'Jost', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const LABEL: Record<string, string> = {
  skirt: 'Skirt Mount',
  pitched_skirt: 'Pitched Skirt Mount',
  top_mount: 'Top Mount',
  flat: 'Flat',
  hip: 'Hip',
  hip_ridge: 'Hip + Ridge',
  standing_seam: 'Standing Seam',
  stainless: 'Stainless Steel',
  copper: 'Copper',
};

function fmt(v: string) {
  return LABEL[v] ?? v;
}

export function PdfReport({ snapshotUrl }: PdfReportProps) {
  const config = useConfigStore();
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalPrice = config.price * config.quantity;

  const [logoAssets, setLogoAssets] = useState<{ symbol: string; text: string } | null>(null);
  useEffect(() => {
    getCroppedLogo().then(setLogoAssets);
  }, []);

  // Hero image — bigger now (~half of page 1). html-to-image / html2canvas don't
  // honor object-fit reliably, so we size it with explicit dims that preserve the
  // image's true aspect ratio, bounded by a max box. Measured on load.
  const HERO_MAX_W = PAGE_W - SIDE * 2;   // 688 — full content width
  const HERO_MAX_H = 470;                 // ~42% of an A4 page
  const [heroDims, setHeroDims] = useState<{ w: number; h: number } | null>(null);
  function onHeroLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const r = Math.min(HERO_MAX_W / nw, HERO_MAX_H / nh);
    setHeroDims({ w: Math.round(nw * r), h: Math.round(nh * r) });
  }

  // ── Header (page 1 only) ──
  const headerNode = (
    <header
      style={{
        background: C.ink,
        color: '#fff',
        padding: '30px 53px',
        borderBottom: `2.5px solid ${C.gold}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'flex-start' }}>
        {logoAssets ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
            <img src={logoAssets.symbol} alt="Kaminos Logo Mark" style={{ height: '32px', display: 'block' }} />
            <img src={logoAssets.text} alt="Kaminos" style={{ height: '20px', display: 'block' }} />
          </div>
        ) : (
          <img src={KAMINOS_LOGO_WHITE} alt="Kaminos" width={171} height={61} style={{ width: '171px', height: '61px', display: 'block' }} />
        )}
        <div style={{ fontSize: '20px', letterSpacing: '0.18em', textTransform: 'uppercase', color: C.gold, fontWeight: 600, textAlign: 'left' }}>
          Multi-Flue Chimney Cap Specification
        </div>
      </div>
      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', letterSpacing: '0.02em' }}>{dateStr}</div>
        <div style={{ fontSize: '12px', color: C.metaUrl, letterSpacing: '0.04em' }}>kaminos.com</div>
      </div>
    </header>
  );

  // ── Hero render (big) ──
  const heroNode = (withOnLoad: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0 4px' }}>
      {snapshotUrl ? (
        <img
          src={snapshotUrl}
          alt="Configured chimney cap"
          id="pdf-hero-image"
          onLoad={withOnLoad ? onHeroLoad : undefined}
          style={
            heroDims
              ? { width: `${heroDims.w}px`, height: `${heroDims.h}px`, display: 'block' }
              : { maxWidth: `${HERO_MAX_W}px`, maxHeight: `${HERO_MAX_H}px`, width: 'auto', height: 'auto', display: 'block' }
          }
        />
      ) : (
        <div style={{ padding: '120px 60px', textAlign: 'center', color: C.muted, fontSize: '13px' }}>
          3D preview not available
        </div>
      )}
    </div>
  );

  // ── Spec sections (single column, full-width blocks) ──
  const coreConfig = (
    <div>
      <SectionLabel>Core Configuration</SectionLabel>
      <SpecList>
        <SpecRow label="Mount Style" value={fmt(config.mount)} />
        <SpecRow label="Lid Type" value={fmt(config.lid_type)} />
        <SpecRow label="Width" value={`${config.width}"`} />
        <SpecRow label="Length" value={`${config.length}"`} />
        {config.lid_type !== 'flat' && <SpecRow label="Lid Pitch" value={`${config.lid_pitch}/12`} />}
        <SpecRow label="Lid Overhang" value={`${config.lid_overhang}"`} />
        <SpecRow label="Screen Height" value={`${config.screen_height}"`} />
      </SpecList>
    </div>
  );

  const skirtOrFlange = config.mount !== 'top_mount' ? (
    <div>
      <SectionLabel>Skirt Details</SectionLabel>
      <SpecList>
        <SpecRow label="Vertical Skirt" value={`${config.vertical_skirt}"`} />
        <SpecRow label="Horizontal Skirt" value={`${config.horizontal_skirt}"`} />
        <SpecRow label="Drip Edge" value={config.drip_edge ? 'Yes' : 'No'} />
      </SpecList>
    </div>
  ) : (
    <div>
      <SectionLabel>Flange Details</SectionLabel>
      <SpecList>
        <SpecRow label="Flange Width" value={`${config.flange_width}"`} />
      </SpecList>
    </div>
  );

  const material = (
    <div>
      <SectionLabel>Material &amp; Finish</SectionLabel>
      <SpecList>
        <SpecRow label="Material" value={fmt(config.material)} />
        {config.material === 'stainless' && <SpecRow label="Powder Coat" value={config.powder_coat ? 'Yes' : 'No'} />}
        {config.material === 'stainless' && config.lid_type === 'flat' && (
          <SpecRow label="Cross Break" value={config.cross_break ? 'Yes' : 'No'} />
        )}
      </SpecList>
      {config.powder_coat && config.material !== 'copper' && (
        <div
          style={{
            marginTop: '14px', padding: '11px 14px', background: C.cardBg, borderRadius: '6px',
            border: `1px solid ${C.hair}`, display: 'flex', alignItems: 'center', gap: '12px',
          }}
        >
          <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: config.powder_coat_color, border: '1px solid rgba(0,0,0,0.12)', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.label }}>Powder Coat Color</div>
            <div style={{ fontSize: '12px', color: '#444', fontWeight: 600 }}>{ralLabel(config.powder_coat_color)}</div>
            <div style={{ fontSize: '10.5px', color: C.muted, marginTop: '1px' }}>{config.powder_coat_color.toUpperCase()}</div>
          </div>
        </div>
      )}
    </div>
  );

  const notes = config.notes ? (
    <div>
      <SectionLabel>Special Notes</SectionLabel>
      <div
        style={{
          fontSize: '12px', color: '#555', lineHeight: 1.6, padding: '12px 14px',
          border: `1px solid ${C.hair}`, borderRadius: '6px', background: C.cardBg,
          marginTop: '8px', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        }}
      >
        {config.notes}
      </div>
    </div>
  ) : null;

  // Flow blocks, in order. Pricing + footer are the bottom-pinned trailer.
  const flow: { key: string; node: React.ReactNode }[] = [
    { key: 'hero', node: heroNode(false) },
    { key: 'core', node: coreConfig },
    { key: 'skirtOrFlange', node: skirtOrFlange },
    ...(notes ? [{ key: 'notes', node: notes }] : []),
    { key: 'material', node: material },
  ];

  const pricingNode = (
    <div style={{ border: `1.5px solid ${C.gold}`, borderRadius: '10px', background: C.cardBg, padding: '20px 20px 18px' }}>
      <div
        style={{
          fontSize: '12.5px', letterSpacing: '0.18em', textTransform: 'uppercase', color: C.gold,
          fontWeight: 600, paddingBottom: '6px', borderBottom: `1px solid ${C.goldSoft}`, marginBottom: '19px',
        }}
      >
        Pricing &amp; Summary
      </div>
      <PriceRow label="Unit Price" value={`$${config.price.toFixed(2)}`} />
      <PriceRow label="Quantity" value={String(config.quantity)} />
      <hr style={{ border: 'none', borderTop: `1.5px dashed ${C.goldSoft}`, margin: '19px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '14.5px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: C.ink }}>Total Price</span>
        <span style={{ fontSize: '30px', fontWeight: 700, color: C.ink, letterSpacing: '0.01em' }}>${totalPrice.toFixed(2)}</span>
      </div>
      <div style={{ fontSize: '11px', color: C.muted, textAlign: 'right', marginTop: '14px', fontStyle: 'italic' }}>*Estimate based on configuration</div>
    </div>
  );

  const footerNode = (
    <footer
      style={{
        background: C.footerBg, borderTop: `1px solid ${C.hair}`, padding: '23px 53px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}
    >
      <div style={{ fontSize: '11.5px', color: C.muted, letterSpacing: '0.01em' }}>
        This document is for reference only. Final pricing subject to confirmation.
      </div>
      <div style={{ fontSize: '11.5px', color: '#7A766F', letterSpacing: '0.03em' }}>kaminos.com · 1-888-777-9789</div>
    </footer>
  );

  // ── Measure → paginate ──
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ pages: number[][]; trailerPage: number } | null>(null);

  useLayoutEffect(() => {
    const cont = measureRef.current;
    if (!cont) return;
    const blockEls = Array.from(cont.querySelectorAll('[data-measure-block]')) as HTMLElement[];
    const headerEl = cont.querySelector('[data-measure-header]') as HTMLElement | null;
    const trailerEl = cont.querySelector('[data-measure-trailer]') as HTMLElement | null;
    if (blockEls.length !== flow.length || !headerEl || !trailerEl) return;

    const headerH = headerEl.offsetHeight;
    const trailerH = trailerEl.offsetHeight;
    const heights = blockEls.map(el => el.offsetHeight);

    const budget1 = PAGE_H - headerH - PAD_V * 2;   // page 1 (after header)
    const budgetN = PAGE_H - PAD_V * 2;             // pages ≥ 2

    const pages: number[][] = [];
    let cur: number[] = [];
    let used = 0;
    for (let i = 0; i < heights.length; i++) {
      const budget = pages.length === 0 ? budget1 : budgetN;
      const add = heights[i] + (cur.length > 0 ? GAP : 0);
      if (cur.length > 0 && used + add > budget) {
        pages.push(cur);
        cur = [i];
        used = heights[i];
      } else {
        cur.push(i);
        used += add;
      }
    }
    if (cur.length) pages.push(cur);
    if (pages.length === 0) pages.push([]);

    // Place the trailer (pricing + footer) at the bottom of the last page if it
    // fits; otherwise give it its own page (still bottom-pinned).
    let trailerPage = pages.length - 1;
    const lastBudget = trailerPage === 0 ? budget1 : budgetN;
    const lastUsed = pages[trailerPage].reduce((s, idx, k) => s + heights[idx] + (k > 0 ? GAP : 0), 0);
    if (lastUsed + GAP + trailerH > lastBudget) {
      pages.push([]);
      trailerPage = pages.length - 1;
    }

    setLayout(prev => {
      const same = prev
        && prev.trailerPage === trailerPage
        && prev.pages.length === pages.length
        && prev.pages.every((p, i) => p.length === pages[i].length && p.every((v, j) => v === pages[i][j]));
      return same ? prev : { pages, trailerPage };
    });
  }, [logoAssets, heroDims, snapshotUrl, config.mount, config.lid_type, config.notes, config.material, config.powder_coat]);

  // Until measured, render a single page with everything (also the graceful
  // fallback if measurement never runs — content simply flows in one page).
  const pages = layout?.pages ?? [flow.map((_, i) => i)];
  const trailerPage = layout?.trailerPage ?? 0;

  return (
    <>
      {/* Hidden measurer — laid out at content width so heights match the pages. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 0, width: `${PAGE_W}px`, visibility: 'hidden', pointerEvents: 'none', fontFamily: FONT, background: '#fff' }}
      >
        <div data-measure-header>{headerNode}</div>
        <div style={{ padding: `0 ${SIDE}px` }}>
          {flow.map(b => (
            <div data-measure-block key={b.key}>{b.key === 'hero' ? heroNode(true) : b.node}</div>
          ))}
        </div>
        <div data-measure-trailer>
          <div style={{ padding: `0 ${SIDE}px` }}>{pricingNode}</div>
          {footerNode}
        </div>
      </div>

      {/* Paged output — each .pdf-page is rasterized into its own A4 PDF page. */}
      <div id="print-mount" style={{ width: `${PAGE_W}px`, background: '#fff', color: C.value, fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>
        {pages.map((idxs, pi) => (
          <div
            className="pdf-page"
            key={pi}
            style={{
              width: `${PAGE_W}px`,
              height: `${PAGE_H}px`,
              background: '#ffffff',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {pi === 0 && headerNode}
            <div style={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px`, padding: `${PAD_V}px ${SIDE}px` }}>
              {idxs.map(i => (
                <div key={flow[i].key}>{flow[i].node}</div>
              ))}
            </div>
            {pi === trailerPage && (
              <>
                <div style={{ flex: 1 }} />
                <div style={{ padding: `0 ${SIDE}px ${PAD_V}px` }}>{pricingNode}</div>
                {footerNode}
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Local helper components (kept in one file for portability) ──

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '13px', letterSpacing: '0.20em', textTransform: 'uppercase', color: C.gold,
        fontWeight: 600, paddingBottom: '6px', marginBottom: '2px', borderBottom: `1px solid ${C.hairStrong}`,
      }}
    >
      {children}
    </div>
  );
}

function SpecList({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>;
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderBottom: `1px solid ${C.hair}` }}>
      <span style={{ fontSize: '14px', color: C.label, fontWeight: 400, letterSpacing: '0.01em' }}>{label}</span>
      <span style={{ fontSize: '15px', color: C.value, fontWeight: 600, letterSpacing: '0.01em', textAlign: 'right', paddingLeft: '30px' }}>{value}</span>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0' }}>
      <span style={{ fontSize: '14px', color: C.label }}>{label}</span>
      <span style={{ fontSize: '15px', color: C.value, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
