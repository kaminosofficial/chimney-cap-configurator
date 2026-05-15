import React, { useEffect, useState } from 'react';
import QRious from 'qrious';
import { useConfigStore } from '../../store/configStore';
import { getConfigState } from '../../utils/ar';

export function ARButton() {
    const [showQR, setShowQR] = useState(false);

    const config = useConfigStore(s => s);

    const isMobile = window.innerWidth <= 900 || /Mobi|Android|iPad|iPhone/i.test(navigator.userAgent) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);

    const launchAR = async () => {
        if (!isMobile) {
            setShowQR(true);
            return;
        }

        // Yield to let React render loading state
        setTimeout(async () => {
            try {
                await import('../../utils/ar');
                // Retrieve the group object using its name or ref. In this case, we'll need direct access to the scene
                // However, AR usually exports purely the model. For simplicity, we can dispatch a custom event
                // to ChaseModel.tsx to handle export and give us the URL, or we can use useThree hooks if inside canvas.
                // Wait, the prompt says exportToGLB needs `grp: THREE.Group`.
                // To bridge React and imperative Three, we'll fire a global event that ChaseModel listens to.
            } catch (e) {
                console.error(e);
            }
        }, 50);
    };

    return (
        <>
            <button onClick={launchAR} style={btnStyle}>View in your space (AR)</button>

            {showQR && (
                <QROverlay onClose={() => setShowQR(false)} config={config} />
            )}
        </>
    );
}

function QROverlay({ onClose, config }: { onClose: () => void, config: any }) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const baseUrl = window.location.origin + window.location.pathname;
    const url = `${baseUrl}#ar=${getConfigState(config)}`;

    useEffect(() => {
        if (canvasRef.current) {
            new QRious({
                element: canvasRef.current,
                value: url,
                size: 200,
                background: 'white',
                foreground: 'black',
                level: 'M'
            });
        }
    }, [url]);

    return (
        <div style={overlayStyle} onClick={onClose}>
            <div style={modalStyle} onClick={e => e.stopPropagation()}>
                <h3>Scan to view in AR</h3>
                <p>Point your mobile device's camera at this QR code to view the 3D model in your space.</p>
                <canvas ref={canvasRef} style={{ marginTop: 20, marginBottom: 20 }}></canvas>
                <div style={{ fontSize: 11, color: '#888', wordBreak: 'break-all' }}>{url}</div>
                <button onClick={onClose} style={{ marginTop: 20, padding: '8px 16px', cursor: 'pointer' }}>Close</button>
            </div>
        </div>
    );
}

const overlayStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
};
const modalStyle: React.CSSProperties = {
    background: '#fff', padding: 30, borderRadius: 8, textAlign: 'center', maxWidth: 400
};
const btnStyle: React.CSSProperties = {
    padding: '12px 20px',
    background: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20
};
