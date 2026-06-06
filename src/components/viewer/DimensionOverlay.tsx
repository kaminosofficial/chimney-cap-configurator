import { Html, Line } from '@react-three/drei';
import { useConfigStore } from '../../store/configStore';
import { SC } from '../../utils/geometry';
import { formatFrac } from '../../utils/format';
// NOTE: <PriceBreakdownPanel> usage is currently commented out below.
// To re-enable, uncomment the import + the JSX. The component file
// (../sidebar/PriceBreakdownPanel.tsx) is preserved.
// import { PriceBreakdownPanel } from '../sidebar/PriceBreakdownPanel';

const COLOR = '#facc15'; // Yellow (matches chase configurator)

function DimensionLine({ start, end, label, tickNormal }: { start: [number, number, number], end: [number, number, number], label: string, tickNormal: [number, number, number] }) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const ux = dx/len, uy = dy/len, uz = dz/len;

    const [nx, ny, nz] = tickNormal;
    const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    const nnx = nx / nLen, nny = ny / nLen, nnz = nz / nLen;

    const arrowLen = 0.01;
    const arrowWid = 0.008;

    const sWing1 = [start[0] + ux*arrowLen + nnx*arrowWid, start[1] + uy*arrowLen + nny*arrowWid, start[2] + uz*arrowLen + nnz*arrowWid] as [number, number, number];
    const sWing2 = [start[0] + ux*arrowLen - nnx*arrowWid, start[1] + uy*arrowLen - nny*arrowWid, start[2] + uz*arrowLen - nnz*arrowWid] as [number, number, number];

    const eWing1 = [end[0] - ux*arrowLen + nnx*arrowWid, end[1] - uy*arrowLen + nny*arrowWid, end[2] - uz*arrowLen + nnz*arrowWid] as [number, number, number];
    const eWing2 = [end[0] - ux*arrowLen - nnx*arrowWid, end[1] - uy*arrowLen - nny*arrowWid, end[2] - uz*arrowLen - nnz*arrowWid] as [number, number, number];

    const midPoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2] as [number, number, number];

    return (
        <group>
            {/* Main dotted line */}
            <Line points={[start, end]} color={COLOR} lineWidth={3} dashed={true} dashSize={0.01} gapSize={0.01} />
            {/* Arrow heads */}
            <Line points={[sWing1, start, sWing2]} color={COLOR} lineWidth={3} />
            <Line points={[eWing1, end, eWing2]} color={COLOR} lineWidth={3} />
            
            <Html position={midPoint} center zIndexRange={[10, 0]}>
                <div style={{
                    background: 'rgba(20,20,20,0.9)',
                    color: COLOR,
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    lineHeight: '16px',
                }}>
                    {label}
                </div>
            </Html>
        </group>
    );
}

export function DimensionOverlay() {
    const config = useConfigStore(s => s);

    if (!config.showDimensions) return null;

    const w = config.width * SC;
    const l = config.length * SC;
    const baseY = 0.02;

    const hw = w / 2;
    const hl = l / 2;
    const sh = config.screen_height * SC;
    const oh = config.lid_overhang * SC;
    const vs = config.vertical_skirt * SC;
    const hs = config.horizontal_skirt * SC;
    const fw = config.flange_width * SC;

    // Distribute labels to prevent crowding
    const labels = [
        // Front face, center
        { key: 'dim-width', label: `Width: ${formatFrac(config.width)}"`, p1: [-hw, baseY, hl + 0.002] as [number, number, number], p2: [hw, baseY, hl + 0.002] as [number, number, number], tickNormal: [0, 1, 0] as [number, number, number] },
        // Right face, center
        { key: 'dim-length', label: `Length: ${formatFrac(config.length)}"`, p1: [hw + 0.002, baseY, -hl] as [number, number, number], p2: [hw + 0.002, baseY, hl] as [number, number, number], tickNormal: [0, 1, 0] as [number, number, number] },
        // Front-Left corner post
        { key: 'dim-screen', label: `Screen: ${formatFrac(config.screen_height)}"`, p1: [-hw + 0.01, 0, hl + 0.002] as [number, number, number], p2: [-hw + 0.01, sh, hl + 0.002] as [number, number, number], tickNormal: [1, 0, 0] as [number, number, number] },
        // Left face, lid overhang
        { key: 'dim-overhang', label: `Overhang: ${formatFrac(config.lid_overhang)}"`, p1: [-hw, sh - 0.002, 0] as [number, number, number], p2: [-hw - oh, sh - 0.002, 0] as [number, number, number], tickNormal: [0, 0, 1] as [number, number, number] },
    ];

    if (config.mount === 'skirt' || config.mount === 'pitched_skirt') {
        // Right face, back corner
        labels.push({ key: 'dim-vskirt', label: `V-Skirt: ${formatFrac(config.vertical_skirt)}"`, p1: [hw + hs + 0.002, 0, -hl - hs / 2] as [number, number, number], p2: [hw + hs + 0.002, -vs, -hl - hs / 2] as [number, number, number], tickNormal: [0, 0, 1] as [number, number, number] });
        // Right face, halfway between center and front
        labels.push({ key: 'dim-hskirt', label: `H-Skirt: ${formatFrac(config.horizontal_skirt)}"`, p1: [hw, 0.002, hl * 0.5] as [number, number, number], p2: [hw + hs, 0.002, hl * 0.5] as [number, number, number], tickNormal: [0, 0, 1] as [number, number, number] });
    } else if (config.mount === 'top_mount') {
        labels.push({ key: 'dim-flange', label: `Flange: ${formatFrac(config.flange_width)}"`, p1: [hw, 0.002, hl * 0.5] as [number, number, number], p2: [hw + fw, 0.002, hl * 0.5] as [number, number, number], tickNormal: [0, 0, 1] as [number, number, number] });
    }

    return (
        <>
            {labels.map((sl) => (
                <DimensionLine key={sl.key} start={sl.p1} end={sl.p2} label={sl.label} tickNormal={sl.tickNormal} />
            ))}

            {/* 2D Summary Panel Overlay */}
            <Html fullscreen zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
                <div style={{
                    position: 'absolute',
                    top: '24px',
                    right: '24px',
                    background: 'rgba(252, 252, 252, 0.95)',
                    padding: '16px 24px 16px 16px',
                    borderRadius: '12px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                    pointerEvents: 'auto',
                    fontFamily: 'sans-serif',
                    color: '#444',
                    minWidth: '220px',
                }}>
                    <button 
                        onClick={() => config.set({ showDimensions: false })}
                        style={{
                            position: 'absolute',
                            top: '8px',
                            right: '12px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#999',
                            fontSize: '18px',
                            lineHeight: 1,
                            padding: 0,
                        }}
                        title="Hide Dimensions"
                    >
                        ×
                    </button>
                    <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '8px', color: '#333' }}>
                        {formatFrac(config.width)}" W × {formatFrac(config.length)}" L {config.mount !== 'top_mount' ? `× ${formatFrac(config.vertical_skirt)}" Skirt` : ''}
                    </div>
                    <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
                        Screen Height: {formatFrac(config.screen_height)}"
                        <br/>
                        Lid Overhang: {formatFrac(config.lid_overhang)}"
                        {config.mount !== 'top_mount' && (
                            <><br/>Horizontal Skirt: {formatFrac(config.horizontal_skirt)}"</>
                        )}
                        {config.mount === 'top_mount' && (
                            <><br/>Flange Width: {formatFrac(config.flange_width)}"</>
                        )}
                    </div>
                    {/* Hidden for now; may re-enable later. Component is preserved. */}
                    {/* <PriceBreakdownPanel /> */}
                </div>
            </Html>
        </>
    );
}
