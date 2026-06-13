import { useState, useEffect } from 'react';
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
// PdfReport  —  "Airy" spec-sheet layout
//
// Single source of truth for the printable PDF. Authored at A4 portrait width
// (794px ≈ 210mm @ 96dpi) so html2canvas → jsPDF maps it 1:1 onto an A4 page.
// The root is a flex column with a pinned footer (min-height = one A4 page);
// if a configuration needs more room (e.g. long notes) the page grows and
// generatePdf() slices it across multiple A4 pages — nothing is ever clipped.
//
// Accepts an optional `snapshotUrl` (base64 JPEG from the 3D canvas) rendered
// as the hero image.
// ─────────────────────────────────────────────────────────────────────────────

interface PdfReportProps {
  snapshotUrl?: string;
}

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

  // html2canvas does NOT honor object-fit / width:auto reliably — it stretches
  // images to fill their box. To prevent squishing we size the hero with an
  // explicit width AND height that preserve the image's TRUE aspect ratio,
  // bounded by a max box. Measured on load.
  const HERO_MAX_W = 440;
  const HERO_MAX_H = 230;
  const [heroDims, setHeroDims] = useState<{ w: number; h: number } | null>(null);
  function onHeroLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const r = Math.min(HERO_MAX_W / nw, HERO_MAX_H / nh);
    setHeroDims({ w: Math.round(nw * r), h: Math.round(nh * r) });
  }

  return (
    <div
      id="print-mount"
      style={{
        width: '794px',
        minHeight: '1123px',
        background: '#ffffff',
        color: C.value,
        fontFamily: FONT,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
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
              <img
                src={logoAssets.symbol}
                alt="Kaminos Logo Mark"
                style={{ height: '32px', display: 'block' }}
              />
              <img
                src={logoAssets.text}
                alt="Kaminos"
                style={{ height: '20px', display: 'block' }}
              />
            </div>
          ) : (
            <img
              src={KAMINOS_LOGO_WHITE}
              alt="Kaminos"
              width={171}
              height={61}
              style={{ width: '171px', height: '61px', display: 'block' }}
            />
          )}
          <div style={{ fontSize: '20px', letterSpacing: '0.18em', textTransform: 'uppercase', color: C.gold, fontWeight: 600, textAlign: 'left' }}>
            Multi-Flue Chimney Cap Specification
          </div>
        </div>

        {/* Date / URL pinned to the right and vertically centered */}
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', letterSpacing: '0.02em' }}>{dateStr}</div>
          <div style={{ fontSize: '12px', color: C.metaUrl, letterSpacing: '0.04em' }}>kaminos.com</div>
        </div>
      </header>

      {/* ── Hero render ── */}
      <div
        style={{
          flexShrink: 0,
          padding: '24px 53px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {snapshotUrl ? (
          <img
            src={snapshotUrl}
            alt="Configured chimney cap"
            id="pdf-hero-image"
            onLoad={onHeroLoad}
            style={
              heroDims
                ? { width: `${heroDims.w}px`, height: `${heroDims.h}px`, display: 'block' }
                : { maxWidth: `${HERO_MAX_W}px`, maxHeight: `${HERO_MAX_H}px`, width: 'auto', height: 'auto', display: 'block' }
            }
          />
        ) : (
          <div style={{ padding: '60px', textAlign: 'center', color: C.muted, fontSize: '13px' }}>
            3D preview not available
          </div>
        )}
      </div>

      {/* ── Divider (inset) ── */}
      <div style={{ height: '1px', background: C.hair, margin: '0 53px', flexShrink: 0 }} />

      {/* ── Spec body ── */}
      <div
        style={{
          flex: '1 1 auto',
          padding: '28px 53px 28px',
          display: 'flex',
          flexDirection: 'row',
          gap: '60px',
          alignItems: 'flex-start',
        }}
      >
        {/* Left column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <SectionLabel>Core Configuration</SectionLabel>
            <SpecList>
              <SpecRow label="Mount Style" value={fmt(config.mount)} />
              <SpecRow label="Lid Type" value={fmt(config.lid_type)} />
              <SpecRow label="Width" value={`${config.width}"`} />
              <SpecRow label="Length" value={`${config.length}"`} />
              {config.lid_type !== 'flat' && (
                <SpecRow label="Lid Pitch" value={`${config.lid_pitch}/12`} />
              )}
              <SpecRow label="Lid Overhang" value={`${config.lid_overhang}"`} />
              <SpecRow label="Screen Height" value={`${config.screen_height}"`} />
            </SpecList>
          </div>

          {config.mount !== 'top_mount' ? (
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
          )}

          {config.notes && (
            <div>
              <SectionLabel>Special Notes</SectionLabel>
              <div
                style={{
                  fontSize: '12px',
                  color: '#555',
                  lineHeight: 1.6,
                  padding: '12px 14px',
                  border: `1px solid ${C.hair}`,
                  borderRadius: '6px',
                  background: C.cardBg,
                  marginTop: '8px',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {config.notes}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <SectionLabel>Material &amp; Finish</SectionLabel>
            <SpecList>
              <SpecRow label="Material" value={fmt(config.material)} />
              {config.material === 'stainless' && (
                <SpecRow label="Powder Coat" value={config.powder_coat ? 'Yes' : 'No'} />
              )}
              {config.material === 'stainless' && config.lid_type === 'flat' && (
                <SpecRow label="Cross Break" value={config.cross_break ? 'Yes' : 'No'} />
              )}
            </SpecList>

            {/* Powder coat color swatch */}
            {config.powder_coat && config.material !== 'copper' && (
              <div
                style={{
                  marginTop: '14px',
                  padding: '11px 14px',
                  background: C.cardBg,
                  borderRadius: '6px',
                  border: `1px solid ${C.hair}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '4px',
                    background: config.powder_coat_color,
                    border: '1px solid rgba(0,0,0,0.12)',
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.label }}>
                    Powder Coat Color
                  </div>
                  <div style={{ fontSize: '12px', color: '#444', fontWeight: 600 }}>
                    {ralLabel(config.powder_coat_color)}
                  </div>
                  <div style={{ fontSize: '10.5px', color: C.muted, marginTop: '1px' }}>
                    {config.powder_coat_color.toUpperCase()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pricing card — anchored toward the bottom of the column */}
          <div
            style={{
              marginTop: 'auto',
              border: `1.5px solid ${C.gold}`,
              borderRadius: '10px',
              background: C.cardBg,
              padding: '20px 20px 18px',
            }}
          >
            <div
              style={{
                fontSize: '12.5px',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: C.gold,
                fontWeight: 600,
                paddingBottom: '6px',
                borderBottom: `1px solid ${C.goldSoft}`,
                marginBottom: '19px',
              }}
            >
              Pricing &amp; Summary
            </div>

            <PriceRow label="Unit Price" value={`$${config.price.toFixed(2)}`} />
            <PriceRow label="Quantity" value={String(config.quantity)} />

            <hr style={{ border: 'none', borderTop: `1.5px dashed ${C.goldSoft}`, margin: '19px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '14.5px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: C.ink }}>
                Total Price
              </span>
              <span style={{ fontSize: '30px', fontWeight: 700, color: C.ink, letterSpacing: '0.01em' }}>
                ${totalPrice.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: C.muted, textAlign: 'right', marginTop: '14px', fontStyle: 'italic' }}>
              *Estimate based on configuration
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer
        style={{
          marginTop: 'auto',
          background: C.footerBg,
          borderTop: `1px solid ${C.hair}`,
          padding: '23px 53px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: '11.5px', color: C.muted, letterSpacing: '0.01em' }}>
          This document is for reference only. Final pricing subject to confirmation.
        </div>
        <div style={{ fontSize: '11.5px', color: '#7A766F', letterSpacing: '0.03em' }}>
          kaminos.com · 1-888-777-9789
        </div>
      </footer>
    </div>
  );
}

// ── Local helper components (kept in one file for portability) ──

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '13px',
        letterSpacing: '0.20em',
        textTransform: 'uppercase',
        color: C.gold,
        fontWeight: 600,
        paddingBottom: '6px',
        marginBottom: '2px',
        borderBottom: `1px solid ${C.hairStrong}`,
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
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '8px 0',
        borderBottom: `1px solid ${C.hair}`,
      }}
    >
      <span style={{ fontSize: '14px', color: C.label, fontWeight: 400, letterSpacing: '0.01em' }}>{label}</span>
      <span style={{ fontSize: '15px', color: C.value, fontWeight: 600, letterSpacing: '0.01em', textAlign: 'right', paddingLeft: '30px' }}>
        {value}
      </span>
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
