import { useConfigStore } from '../../store/configStore';
import { computeCapPriceBreakdown } from '../../store/configStore';

/**
 * Temporary debug panel — surfaces the live cap-pricing breakdown so we can verify
 * each step of `computeCapPriceBreakdown` is reading the right values from the
 * Google Sheet (or showing the empty-fallback when a sheet row is missing).
 *
 * Rendered inside the dim-overlay in App.tsx whenever `showDimensions === true`.
 */
export function PriceBreakdownPanel() {
  const s = useConfigStore();
  const b = computeCapPriceBreakdown(s);

  const labelStyle: React.CSSProperties = { color: '#666', fontWeight: 500 };
  const valueStyle: React.CSSProperties = { color: '#111', fontWeight: 600 };
  const dim: React.CSSProperties = { color: '#999' };
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: '1px solid rgba(0,0,0,0.1)',
        fontSize: 11,
        lineHeight: 1.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        minWidth: 280,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Price breakdown (debug)</div>

      <div><span style={labelStyle}>Mount:</span> <span style={valueStyle}>{b.mount}</span>{' · '}
        <span style={labelStyle}>Lid:</span> <span style={valueStyle}>{b.lid_type}</span>{' · '}
        <span style={labelStyle}>Material:</span> <span style={valueStyle}>{b.material}</span></div>

      <div style={{ marginTop: 4 }}>
        <span style={labelStyle}>Bracket:</span> <span style={valueStyle}>{b.bracket}</span>{' '}
        <span style={dim}>({b.bracketRule})</span>
      </div>

      <div>
        <span style={labelStyle}>Key:</span>{' '}
        <span style={{ ...valueStyle, color: b.multiplierFromSheet ? '#111' : '#c0392b' }}>
          MULT_{b.multiplierKey.toUpperCase()}
        </span>{' = '}
        <span style={valueStyle}>{b.multiplier}</span>
        {!b.multiplierFromSheet && <span style={{ color: '#c0392b' }}> ⚠ not in sheet, fallback 1</span>}
      </div>

      <div style={{ marginTop: 6 }}>
        <span style={labelStyle}>Base:</span>{' '}
        ({b.width} + {b.length}) × {b.multiplier} = <span style={valueStyle}>{fmt(b.baseCost)}</span>
      </div>

      <table style={{ marginTop: 4, borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {b.steps.map((step, i) => (
            <tr key={i} style={{ color: step.applied ? '#111' : '#aaa' }}>
              <td style={{ paddingRight: 6 }}>{step.applied ? '×' : '·'}</td>
              <td style={{ paddingRight: 6, fontWeight: 500 }}>{step.label}</td>
              <td style={{ paddingRight: 6 }}>
                <span style={dim}>{step.detail}</span>
              </td>
              <td style={{ textAlign: 'right', fontWeight: step.applied ? 600 : 400 }}>
                {step.applied ? fmt(step.runningCost) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 6, fontWeight: 700, fontSize: 12 }}>
        Total: {fmt(b.total)}
      </div>
    </div>
  );
}
