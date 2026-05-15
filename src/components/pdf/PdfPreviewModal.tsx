import { useState } from 'react';
import { generatePdf } from '../../utils/pdfGenerator';
import { PdfReport } from './PdfReport';

export function PdfPreviewModal({ open, onClose }: { open: boolean, onClose: () => void }) {
  const [isGenerating, setIsGenerating] = useState(false);

  if (!open) return null;

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `KAMINOS-ChaseCover-${dateStr}.pdf`;
      await generatePdf('preview-print-mount', filename);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '8px',
        width: '100%',
        maxWidth: '850px',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '15px 20px',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f8f9fa'
        }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Specification Preview</h2>
          <button 
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#666', lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>

        {/* Modal Body: The Document Preview */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          backgroundColor: '#eaedf0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start'
        }}>
          {/* We create a wrapper that scales down the A4/Letter size layout to be realistic */}
          <div style={{
            transform: 'scale(0.85)',
            transformOrigin: 'top center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            position: 'relative',
            marginBottom: '-120px' // adjust for scaled height
          }}>
            {/* 
              We use this visible container for html2canvas generation by passing its ID!
            */}
            <div id="preview-print-mount">
              <PdfReport />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '15px 20px',
          borderTop: '1px solid #ddd',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '15px',
          background: '#fff'
        }}>
          <button 
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Cancel
          </button>
          <button 
            onClick={handleDownload}
            disabled={isGenerating}
            style={{
              padding: '10px 20px',
              borderRadius: '4px',
              border: 'none',
              background: '#0a0a0a',
              color: '#fff',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              minWidth: '150px'
            }}
          >
            {isGenerating ? 'Generating...' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
