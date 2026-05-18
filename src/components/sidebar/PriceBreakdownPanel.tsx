import { useConfigStore } from '../../store/configStore';
import { computeCapPriceBreakdown } from '../../store/configStore';

/**
 * Temporary debug panel — surfaces the live cap-pricing breakdown so we can verify
 * each step of `computeCapPriceBreakdown` is reading the right values from the
 * Google Sheet (or showing the empty-fallback when a sheet row is missing).
 *
 * Rendered inside the dim-overlay (DimensionOverlay.tsx) whenever Show Dimensions is on.
 */
export function PriceBreakdownPanel() {
  const s = useConfigStore();
  const b = computeCapPriceBreakdown(s);

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const dim: React.CSSProperties = { color: '#999' };
  const muted: React.CSSProperties = { color: '#777' };

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: '1px solid rgba(0,0,0,0.1)',
        fontSize: 11,
        lineHeight: 1.45,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        minWidth: 320,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Price breakdown (debug)</div>

      <div>
        <span style={muted}>Mount:</span> <b>{b.mount}</b>
        {' · '}
        <span style={muted}>Lid:</span> <b>{b.lid_type}</b>
        {' · '}
        <span style={muted}>Material:</span> <b>{b.material}</b>
      </div>

      <div style={{ marginTop: 4 }}>
        <span style={muted}>Bracket:</span> <b>{b.bracket}</b>{' '}
        <span style={dim}>({b.bracketRule})</span>
      </div>

      <div>
        <span style={muted}>Key:</span>{' '}
        <span style={{ fontWeight: 600, color: b.multiplierFromSheet ? '#111' : '#c0392b' }}>
          MULT_{b.multiplierKey.toUpperCase()}
        </span>{' = '}
        <b>{b.multiplier}</b>
        {!b.multiplierFromSheet && <span style={{ color: '#c0392b' }}> ⚠ not in sheet, fallback 1</span>}
      </div>

      <div style={{ marginTop: 8, paddingBottom: 4, borderBottom: '1px dashed rgba(0,0,0,0.1)' }}>
        <b>Base</b> ({b.width} + {b.length}) × {b.multiplier} = <b>{fmt(b.baseCost)}</b>
      </div>

      {b.steps.map((step, i) =>
        step.applied ? (
          <div key={i} style={{ marginTop: 6 }}>
            <div>
              <span style={{ color: '#0a7d3a', fontWeight: 700 }}>×</span>{' '}
              <b>{step.label}</b>{' '}
              <span style={{ color: '#0a7d3a', fontWeight: 600 }}>{step.factorLabel}</span>{' '}
              <span style={dim}>— {step.detail}</span>
            </div>
            <div style={{ paddingLeft: 16, color: '#555' }}>
              {fmt(step.prevCost)} <span style={dim}>→</span>{' '}
              <b style={{ color: '#111' }}>{fmt(step.runningCost)}</b>{' '}
              <span style={{ color: '#0a7d3a' }}>(+{fmt(step.delta).slice(1)})</span>
            </div>
          </div>
        ) : (
          <div key={i} style={{ marginTop: 2, color: '#aaa' }}>
            <span>·</span> {step.label} <span style={dim}>— {step.detail}</span>
          </div>
        )
      )}

      <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px solid rgba(0,0,0,0.1)', fontWeight: 700, fontSize: 13 }}>
        Total: {fmt(b.total)}
      </div>
    </div>
  );
}
