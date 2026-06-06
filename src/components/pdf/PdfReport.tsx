import { useConfigStore } from '../../store/configStore';

// ─────────────────────────────────────────────────────────────────────────────
// PdfReport
//
// The single source of truth for the printable PDF layout.
// Accepts an optional `snapshotUrl` (base64 JPEG from the 3D canvas) which is
// rendered as the hero image at the top of the document.
//
// Portability note: this component is self-contained — it only depends on
// `useConfigStore` and the `snapshotUrl` prop. To reuse in another project,
// copy this file and update the store import.
// ─────────────────────────────────────────────────────────────────────────────

interface PdfReportProps {
  /** Base64 JPEG data-URL captured from the 3D WebGL canvas. Optional — renders a placeholder box if absent. */
  snapshotUrl?: string;
}

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

  return (
    <div
      id="print-mount"
      style={{
        width: '800px',
        background: '#ffffff',
        color: '#111111',
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: '13px',
        lineHeight: '1.5',
      }}
    >
      {/* ── Header ── */}
      <div style={{ background: '#1a1a1a', padding: '28px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '28px', fontWeight: '900', letterSpacing: '3px', color: '#ffffff' }}>KAMINOS</div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginTop: '3px', letterSpacing: '0.5px' }}>Multi-Flue Chimney Cap Specification</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>
          <div style={{ fontWeight: '600', color: 'rgba(255,255,255,0.8)', marginBottom: '3px' }}>{dateStr}</div>
          <div>kaminos.com</div>
        </div>
      </div>

      {/* ── Hero snapshot ── */}
      <div style={{ background: '#f3f3f3', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '220px', overflow: 'hidden' }}>
        {snapshotUrl ? (
          <img
            src={snapshotUrl}
            alt="Configured chimney cap"
            style={{ maxWidth: '100%', maxHeight: '280px', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🏠</div>
            <div>3D Preview not available</div>
          </div>
        )}
      </div>

      {/* ── Body: specs + pricing ── */}
      <div style={{ display: 'flex', gap: '0', borderTop: '1px solid #e8e8e8' }}>

        {/* Left: specs */}
        <div style={{ flex: '1.4', padding: '32px 32px 32px 40px', borderRight: '1px solid #e8e8e8' }}>

          <SectionLabel>Configuration</SectionLabel>

          <SpecTable>
            <SpecRow label="Mount Style"       value={fmt(config.mount)} />
            <SpecRow label="Lid Type"          value={fmt(config.lid_type)} />
            <SpecRow label="Width"             value={`${config.width}"`} />
            <SpecRow label="Length"            value={`${config.length}"`} />
            {config.lid_type !== 'flat' && (
              <SpecRow label="Lid Pitch"       value={`${config.lid_pitch}/12`} />
            )}
            <SpecRow label="Lid Overhang"      value={`${config.lid_overhang}"`} />
            {config.lid_type === 'standing_seam' && (
              <SpecRow label="Seam Count"      value={`${config.seam_count} per side`} />
            )}
            <SpecRow label="Screen Height"     value={`${config.screen_height}"`} />
          </SpecTable>

          {config.mount !== 'top_mount' && (
            <>
              <SectionLabel style={{ marginTop: '20px' }}>Skirt</SectionLabel>
              <SpecTable>
                <SpecRow label="Vertical Skirt"   value={`${config.vertical_skirt}"`} />
                <SpecRow label="Horizontal Skirt" value={`${config.horizontal_skirt}"`} />
                <SpecRow label="Drip Edge"        value={config.drip_edge ? 'Yes' : 'No'} />
              </SpecTable>
            </>
          )}

          {config.mount === 'top_mount' && (
            <>
              <SectionLabel style={{ marginTop: '20px' }}>Flange</SectionLabel>
              <SpecTable>
                <SpecRow label="Flange Width" value={`${config.flange_width}"`} />
              </SpecTable>
            </>
          )}

          <SectionLabel style={{ marginTop: '20px' }}>Material &amp; Finish</SectionLabel>
          <SpecTable>
            <SpecRow label="Material"       value={fmt(config.material)} />
            {config.material === 'stainless' && (
              <SpecRow label="Powder Coat"  value={config.powder_coat ? `Yes — ${config.powder_coat_color}` : 'No'} />
            )}
            {config.material === 'stainless' && config.lid_type === 'flat' && (
              <SpecRow label="Cross Break"  value={config.cross_break ? 'Yes' : 'No'} />
            )}
          </SpecTable>

          {config.notes && (
            <>
              <SectionLabel style={{ marginTop: '20px' }}>Special Notes</SectionLabel>
              <div style={{ fontSize: '12px', color: '#555', lineHeight: '1.6', padding: '10px 0', borderTop: '1px solid #f0f0f0' }}>
                {config.notes}
              </div>
            </>
          )}
        </div>

        {/* Right: pricing */}
        <div style={{ flex: '0 0 230px', padding: '32px 32px 32px 28px', display: 'flex', flexDirection: 'column' }}>
          <SectionLabel>Pricing</SectionLabel>

          <div style={{ marginTop: '4px' }}>
            <PriceRow label="Unit Price" value={`$${config.price.toFixed(2)}`} />
            <PriceRow label="Quantity"   value={String(config.quantity)} />
            {config.powder_coat && config.material !== 'copper' && (
              <PriceRow label="Powder Coat" value="Included" muted />
            )}
          </div>

          {/* Total */}
          <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '2px solid #1a1a1a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: '#555' }}>Total</span>
              <span style={{ fontSize: '26px', fontWeight: '900', color: '#1a1a1a', letterSpacing: '-0.5px' }}>
                ${totalPrice.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '4px' }}>
              Pricing based on current configuration
            </div>
          </div>

          {/* Powder coat swatch */}
          {config.powder_coat && config.material !== 'copper' && (
            <div style={{ marginTop: '20px', padding: '12px', background: '#f7f7f7', borderRadius: '6px', border: '1px solid #eee' }}>
              <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#888', marginBottom: '8px' }}>Powder Coat Color</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: config.powder_coat_color, border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                <div style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace' }}>{config.powder_coat_color.toUpperCase()}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ background: '#f7f7f7', borderTop: '1px solid #e8e8e8', padding: '14px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '10px', color: '#aaa' }}>
          This document is for reference only. Final pricing subject to confirmation.
        </div>
        <div style={{ fontSize: '10px', color: '#aaa' }}>
          kaminos.com · 1-888-777-9789
        </div>
      </div>
    </div>
  );
}

// ── Local helper components (keep everything in one file for portability) ──

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: '#999', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #f0f0f0', ...style }}>
      {children}
    </div>
  );
}

function SpecTable({ children }: { children: React.ReactNode }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
      <tbody>{children}</tbody>
    </table>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '5px 0', width: '45%', color: '#777', fontSize: '12px' }}>{label}</td>
      <td style={{ padding: '5px 0', fontWeight: '600', fontSize: '13px', color: '#1a1a1a' }}>{value}</td>
    </tr>
  );
}

function PriceRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
      <span style={{ color: muted ? '#aaa' : '#666', fontSize: '12px' }}>{label}</span>
      <span style={{ fontWeight: '600', fontSize: '13px', color: muted ? '#aaa' : '#1a1a1a' }}>{value}</span>
    </div>
  );
}
