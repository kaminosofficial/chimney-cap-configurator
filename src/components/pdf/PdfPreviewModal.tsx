import { useState, useRef, useEffect } from 'react';
import { generatePdf, deliverPdf } from '../../utils/pdfGenerator';
import { PdfReport } from './PdfReport';

// ─────────────────────────────────────────────────────────────────────────────
// PdfPreviewModal
//
// Shows a preview of the PDF spec sheet before downloading.
// Receives `captureSnapshot` from the parent (App.tsx) — the same function
// used by Add to Cart — so there is no duplicate canvas capture logic.
// ─────────────────────────────────────────────────────────────────────────────

// Natural pixel width the report is authored at (A4 portrait @ ~96dpi).
const REPORT_W = 794;

interface PdfPreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Called to grab the 3D canvas JPEG. Injected from App so no duplicate logic lives here. */
  captureSnapshot: () => Promise<string | undefined>;
}

export function PdfPreviewModal({ open, onClose, captureSnapshot }: PdfPreviewModalProps) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | undefined>(undefined);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const didCaptureRef = useRef(false);

  // References and states for responsive scaling in the viewport
  const containerRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.82);
  const [reportHeight, setReportHeight] = useState(1123);

  // Measure and update scale & height dynamically
  useEffect(() => {
    if (!open) return;

    const updateDimensions = () => {
      // Calculate responsive scale based on available container width
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        // Leave 32px padding (16px on each side)
        const availableWidth = containerWidth - 32;
        const calculatedScale = Math.min(0.95, Math.max(0.25, availableWidth / REPORT_W));
        setScale(calculatedScale);
      }

      // Measure actual report element height to adjust wrapper bounds
      if (reportRef.current) {
        setReportHeight(reportRef.current.clientHeight);
      }
    };

    // Delay briefly to allow DOM elements and fonts to layout
    const timer = setTimeout(updateDimensions, 100);

    window.addEventListener('resize', updateDimensions);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateDimensions);
    };
  }, [open, snapshotUrl]);

  // Capture on first open, reset on close
  if (open && !didCaptureRef.current && !isCapturing) {
    didCaptureRef.current = true;
    setIsCapturing(true);
    setSnapshotUrl(undefined);
    captureSnapshot().then((url) => {
      setSnapshotUrl(url);
      setIsCapturing(false);
    }).catch(() => {
      setIsCapturing(false);
    });
  }

  function handleClose() {
    didCaptureRef.current = false;
    setSnapshotUrl(undefined);
    setIsCapturing(false);
    onClose();
  }

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `KAMINOS-ChimneyCap-${dateStr}.pdf`;
      // Query within our own ref (not document.getElementById) so it resolves
      // even when the configurator runs inside a Shopify Shadow DOM.
      const el = (reportRef.current?.querySelector('#print-mount') ?? null) as HTMLElement | null;
      const blob = await generatePdf(el);
      if (blob) await deliverPdf(blob, filename);
    } finally {
      setIsDownloading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      id="pdf-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="PDF Specification Preview"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '880px',
        maxHeight: '92vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
        overflow: 'hidden',
      }}>

        {/* ── Modal header ── */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #ebebeb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          background: '#fafafa',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* PDF icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgb(194, 151, 74)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="9" y1="13" x2="15" y2="13"/>
              <line x1="9" y1="17" x2="15" y2="17"/>
              <polyline points="9 9 10 9"/>
            </svg>
            <span style={{ fontWeight: '600', fontSize: '15px', color: '#1a1a1a' }}>Specification Preview</span>
          </div>
          <button
            id="pdf-preview-close"
            onClick={handleClose}
            aria-label="Close preview"
            style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#999', lineHeight: 1, padding: '4px 8px', borderRadius: '6px', transition: 'color 0.15s, background 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f0f0f0'; (e.currentTarget as HTMLButtonElement).style.color = '#333'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = '#999'; }}
          >
            &times;
          </button>
        </div>

        {/* ── Preview body ── */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 16px',
            backgroundColor: '#e4e2de',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            minHeight: 0,
          }}
        >
          {isCapturing ? (
            /* Spinner while snapshot loads */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '16px', color: '#666' }}>
              <div className="pdf-capture-spinner" />
              <div style={{ fontSize: '14px' }}>Capturing 3D preview…</div>
            </div>
          ) : (
            /* Outer scaled container with mathematically perfect bounds */
            <div style={{
              width: `${REPORT_W * scale}px`,
              height: `${reportHeight * scale}px`,
              overflow: 'hidden',
              position: 'relative',
              boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
              flexShrink: 0,
            }}>
              <div
                ref={reportRef}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: `${REPORT_W}px`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <PdfReport snapshotUrl={snapshotUrl} />
              </div>
            </div>
          )}
        </div>

        {/* ── Modal footer ── */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid #ebebeb',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '10px',
          background: '#fff',
          flexShrink: 0,
        }}>
          <button
            id="pdf-preview-cancel"
            onClick={handleClose}
            style={{
              padding: '10px 20px', borderRadius: '6px', border: '1px solid #ddd',
              background: '#fff', cursor: 'pointer', fontWeight: '500', fontSize: '14px',
              color: '#555', transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f5f5f5'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; }}
          >
            Cancel
          </button>
          <button
            id="pdf-preview-download"
            onClick={handleDownload}
            disabled={isDownloading || isCapturing}
            style={{
              padding: '10px 22px', borderRadius: '6px', border: 'none',
              background: isDownloading || isCapturing ? '#d6c191' : 'rgb(194, 151, 74)',
              color: '#fff', cursor: isDownloading || isCapturing ? 'not-allowed' : 'pointer',
              fontWeight: '600', fontSize: '14px', minWidth: '150px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => { if (!isDownloading && !isCapturing) (e.currentTarget as HTMLButtonElement).style.background = '#b1873f'; }}
            onMouseLeave={e => { if (!isDownloading && !isCapturing) (e.currentTarget as HTMLButtonElement).style.background = 'rgb(194, 151, 74)'; }}
          >
            {/* Download icon */}
            {!isDownloading && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
            {isDownloading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
