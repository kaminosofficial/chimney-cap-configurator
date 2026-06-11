import { jsPDF } from 'jspdf';
import { toCanvas } from 'html-to-image';

// Rasterizes an off-screen DOM element to an A4 PDF and returns it as a Blob.
//
// We use html-to-image (SVG <foreignObject>) rather than html2canvas because
// html2canvas does its own manual text layout and mangles letter-spacing and
// word spaces on iOS Safari — the exported text came out as overlapping
// gibberish. foreignObject rasterizes through the browser's own renderer, so
// the output pixel-matches the on-screen preview on every device.
//
// Accepts the element directly (not an id) so it resolves inside a Shadow DOM.
// Returns the PDF Blob so the caller can decide how to deliver it (download on
// desktop, Web Share / Save-to-Files on mobile).
export async function generatePdf(element: HTMLElement | null): Promise<Blob | null> {
  if (!element) {
    console.error('generatePdf: target element not found');
    return null;
  }

  try {
    // Ensure fonts are settled so glyph metrics match the preview.
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch { /* non-fatal */ }
    }

    // offsetWidth/Height are the element's true layout size and are unaffected
    // by the preview wrapper's CSS transform, so the capture is full-size.
    const width = element.offsetWidth || 794;
    const height = element.offsetHeight || 1123;

    const canvas = await toCanvas(element, {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width,
      height,
      // NOTE: do NOT enable cacheBust — it appends a query string to every
      // resource URL, which corrupts the inline data: URIs (logo + hero image)
      // and produces a blank capture / hang.
      //
      // The report renders in the system fallback font (Jost is not loaded), so
      // there is nothing to embed — skipping avoids slow/failing font fetches
      // and keeps the output identical to the preview.
      skipFonts: true,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();   // 210
    const pageHeight = pdf.internal.pageSize.getHeight();  // 297
    const imgHeight = (canvas.height * pageWidth) / canvas.width;

    if (imgHeight <= pageHeight + 0.5) {
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, imgHeight);
    } else {
      // Slice across multiple A4 pages so nothing is clipped.
      let remaining = imgHeight;
      let position = 0;
      while (remaining > 0.5) {
        pdf.addImage(imgData, 'JPEG', 0, position, pageWidth, imgHeight);
        remaining -= pageHeight;
        position -= pageHeight;
        if (remaining > 0.5) pdf.addPage();
      }
    }

    return pdf.output('blob');
  } catch (error) {
    console.error('Error generating PDF:', error);
    return null;
  }
}

// Delivers the generated PDF: on devices that support sharing files (iOS/Android)
// this opens the native share sheet so the user can "Save to Files"; otherwise it
// triggers a normal browser download.
export async function deliverPdf(blob: Blob, filename: string): Promise<void> {
  const file =
    typeof File !== 'undefined'
      ? new File([blob], filename, { type: 'application/pdf' })
      : null;

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };

  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile && file && nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: filename });
      return;
    } catch (e) {
      // User cancelled, or share was blocked — fall through to download/open.
      if ((e as DOMException)?.name === 'AbortError') return;
    }
  }

  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
