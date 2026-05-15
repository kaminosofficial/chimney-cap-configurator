import { useConfigStore } from '../../store/configStore';


export function PdfReport() {
  const config = useConfigStore();

  const formatPrice = (p: number) => `$${p.toFixed(2)}`;
  const MAX_SVG_WIDTH = 450;
  const MAX_SVG_HEIGHT = 250;
  const L = config.length;
  const W = config.width;
  const scale = Math.min(MAX_SVG_WIDTH / L, MAX_SVG_HEIGHT / W);
  const drawW = L * scale;
  const drawH = W * scale;
  const cx = MAX_SVG_WIDTH / 2;
  const cy = MAX_SVG_HEIGHT / 2;
  const rectX = cx - drawW / 2;
  const rectY = cy - drawH / 2;

  const isCallForPricing = config.price === 0;

  return (
    <div
      id="print-mount"
      style={{
        width: '800px',
        padding: '50px',
        background: 'white',
        color: '#111',
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif'
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '2px solid #333', paddingBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '36px', fontWeight: '900', letterSpacing: '2px' }}>KAMINOS</h1>
        <h2 style={{ margin: '10px 0 0 0', fontSize: '18px', fontWeight: 'normal', color: '#555' }}>Multi-Flue Chimney Cap Specification</h2>
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '20px', fontSize: '14px', color: '#666' }}>
          <div><strong>Date:</strong> {new Date().toLocaleDateString()}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '40px' }}>
        <div style={{ flex: '1.2' }}>
          <div style={{ marginBottom: '25px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px', color: '#555', borderBottom: '1px solid #ddd', paddingBottom: '5px' }}>Configuration Blueprint</h3>
            <div style={{ border: '2px solid #222', padding: '15px' }}>
              <svg width={MAX_SVG_WIDTH} height={MAX_SVG_HEIGHT} style={{ display: 'block', margin: '0 auto' }}>
                <rect x={rectX} y={rectY} width={drawW} height={drawH} fill="#f8f9fa" stroke="#222" strokeWidth="2" />
                <text x={cx} y={rectY - 14} fontSize="13" fontWeight="bold" textAnchor="middle" fill="#444">L: {config.length}"</text>
                <text x={rectX - 14} y={cy} fontSize="13" fontWeight="bold" textAnchor="middle" fill="#444" transform={`rotate(-90 ${rectX - 14} ${cy})`}>W: {config.width}"</text>
              </svg>
            </div>
          </div>

          <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px', color: '#555', borderBottom: '1px solid #ddd', paddingBottom: '5px' }}>Specifications</h3>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 0', width: '35%', color: '#666' }}>Dimensions</td>
                  <td style={{ padding: '4px 0', fontWeight: '500' }}>{config.length}" L &times; {config.width}" W</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 0', color: '#666' }}>Mount Style</td>
                  <td style={{ padding: '4px 0', fontWeight: '500' }}>{config.mount.replace('_', ' ').toUpperCase()}</td>
                </tr>
                {config.mount !== 'top_mount' && (
                  <tr>
                    <td style={{ padding: '4px 0', color: '#666' }}>Skirt</td>
                    <td style={{ padding: '4px 0', fontWeight: '500' }}>{config.vertical_skirt}" Vertical, {config.horizontal_skirt}" Horizontal {config.drip_edge ? '(w/ Drip Edge)' : ''}</td>
                  </tr>
                )}
                {config.mount === 'top_mount' && (
                  <tr>
                    <td style={{ padding: '4px 0', color: '#666' }}>Flange Width</td>
                    <td style={{ padding: '4px 0', fontWeight: '500' }}>{config.flange_width}"</td>
                  </tr>
                )}
                <tr>
                  <td style={{ padding: '4px 0', color: '#666' }}>Lid Type</td>
                  <td style={{ padding: '4px 0', fontWeight: '500' }}>{config.lid_type.replace('_', ' ').toUpperCase()}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 0', color: '#666' }}>Lid Settings</td>
                  <td style={{ padding: '4px 0', fontWeight: '500' }}>
                    {config.lid_overhang}" Overhang
                    {config.lid_type !== 'flat' && `, ${config.lid_pitch}/12 Pitch`}
                    {config.lid_type === 'standing_seam' && `, ${config.seam_count} Seams`}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 0', color: '#666' }}>Screen Height</td>
                  <td style={{ padding: '4px 0', fontWeight: '500' }}>{config.screen_height}"</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 0', color: '#666' }}>Material</td>
                  <td style={{ padding: '4px 0', fontWeight: '500' }}>{config.material === 'copper' ? 'Copper' : 'Stainless Steel'}</td>
                </tr>
                {config.material === 'stainless' && (
                  <tr>
                    <td style={{ padding: '4px 0', color: '#666' }}>Powder Coat</td>
                    <td style={{ padding: '4px 0', fontWeight: '500' }}>{config.powder_coat ? `Yes (${config.powder_coat_color})` : 'No'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ flex: '0.8', display: 'flex', flexDirection: 'column' }}>
          <div style={{ border: '2px solid #222', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ background: '#222', color: '#fff', padding: '12px 15px', fontWeight: 'bold', fontSize: '14px', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Price Breakdown
            </div>
            <div style={{ padding: '20px 15px', fontSize: '14px' }}>
              {isCallForPricing ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#c9873b', marginBottom: '10px' }}>Call for Pricing</div>
                  <div style={{ color: '#666' }}>This configuration requires custom quoting. Please call us at 1-888-777-9789.</div>
                </div>
              ) : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '6px 0', color: '#444' }}>Base Cap</td>
                        <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: '500' }}>Included</td>
                      </tr>
                      {config.powder_coat && (
                        <tr>
                          <td style={{ padding: '6px 0', color: '#444' }}>Powder Coating</td>
                          <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: '500' }}>Added</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  <div style={{ borderTop: '1px solid #ddd', margin: '15px 0' }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '14px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Unit Price</span>
                    <span style={{ fontSize: '18px', fontWeight: 'bold' }}>{formatPrice(config.price)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <span style={{ fontSize: '14px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quantity</span>
                    <span style={{ fontSize: '16px', fontWeight: 'bold' }}>{config.quantity}</span>
                  </div>

                  <div style={{ borderTop: '2px solid #222', margin: '15px 0' }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8f9fa', padding: '15px', borderRadius: '4px', border: '1px solid #eee' }}>
                    <span style={{ fontSize: '16px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Total</span>
                    <span style={{ fontSize: '24px', fontWeight: '900', color: '#111' }}>{formatPrice(config.price * config.quantity)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
