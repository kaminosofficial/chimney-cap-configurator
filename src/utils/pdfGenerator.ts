// jsPDF / html2canvas / html-to-image are imported dynamically inside
// generatePdf() — together they're ~550KB and only a tiny fraction of visitors
// ever export a PDF. In the SPA build they split into a lazy chunk; the Shopify
// IIFE still inlines them (inlineDynamicImports), so behavior there is unchanged.

function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
  ]);
}

const isMobileDevice = (): boolean =>
  /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Rasterizes an off-screen DOM element to an A4 PDF and returns it as a Blob.
//
// Two rendering engines are used depending on the platform:
//
// • Desktop — html-to-image (SVG <foreignObject>). Rasterizes through the
//   browser's own renderer so the output pixel-matches the on-screen preview.
//
// • Mobile / iOS — html2canvas. The SVG foreignObject path hangs indefinitely
//   on iOS WebKit when the DOM contains base64 data URIs (logo, 3D screenshot).
//   html2canvas uses manual DOM painting which reliably works on all platforms.
//   Letter-spacing rendering is slightly less precise but the output is clean.
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
    // Load the heavy libs on demand: jsPDF always, plus only the rasterizer the
    // current platform actually uses (html2canvas on mobile, html-to-image on desktop).
    const [{ jsPDF }, rasterizer] = await Promise.all([
      import('jspdf'),
      isMobileDevice() ? import('html2canvas') : import('html-to-image'),
    ]);

    // Ensure fonts are settled with a safety timeout so they don't block forever.
    if (document.fonts && document.fonts.ready) {
      try {
        await withTimeout(document.fonts.ready, 1500, 'Fonts load timeout');
      } catch { /* non-fatal */ }
    }

    // offsetWidth/Height are the element's true layout size and are unaffected
    // by the preview wrapper's CSS transform.
    const width = element.offsetWidth || 794;
    const height = element.offsetHeight || 1123;

    // Create a temporary, off-screen container that is completely un-transformed.
    // We append it to the element's root (which preserves Shadow DOM styles if applicable)
    // or fallback to document.body.
    const root = element.getRootNode();
    const containerToAppend = (root && 'appendChild' in root && root !== document)
      ? (root as any)
      : document.body;

    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'fixed';
    tempContainer.style.left = '-9999px';
    tempContainer.style.top = '0';
    tempContainer.style.width = `${width}px`;
    tempContainer.style.height = `${height}px`;
    tempContainer.style.background = '#ffffff';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.transform = 'none';

    // Clone the element so we don't mutate the live UI preview.
    const clone = element.cloneNode(true) as HTMLElement;
    clone.style.transform = 'none';
    clone.style.margin = '0';
    clone.style.padding = '0';
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;

    // Strip letter-spacing on mobile/iOS to prevent html2canvas text overlapping/garbling
    if (isMobileDevice()) {
      clone.querySelectorAll('*').forEach((node) => {
        const el = node as HTMLElement;
        if (el.style.letterSpacing) {
          el.style.letterSpacing = '0';
        }
      });
      if (clone.style.letterSpacing) {
        clone.style.letterSpacing = '0';
      }
    }

    tempContainer.appendChild(clone);
    containerToAppend.appendChild(tempContainer);

    let canvas: HTMLCanvasElement;

    try {
      if (isMobileDevice()) {
        // ── Mobile path: html2canvas ──
        const html2canvas = (rasterizer as typeof import('html2canvas')).default;
        canvas = await withTimeout(
          html2canvas(clone, {
            scale: 2,
            backgroundColor: '#ffffff',
            width,
            height,
            useCORS: true,
            allowTaint: true,
            logging: false,
          }),
          15000,
          'PDF generation timed out (mobile)'
        );
      } else {
        // ── Desktop path: html-to-image (SVG foreignObject) ──
        // Pixel-perfect output through the browser's own renderer.
        const { toCanvas } = rasterizer as typeof import('html-to-image');
        canvas = await withTimeout(
          toCanvas(clone, {
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
          }),
          8000,
          'PDF generation timed out (desktop)'
        );
      }
    } finally {
      // Clean up the temporary container
      try {
        containerToAppend.removeChild(tempContainer);
      } catch { /* ignore */ }
    }

    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();   // 210
    const pageHeight = pdf.internal.pageSize.getHeight();  // 297
    const imgHeight = (canvas.height * pageWidth) / canvas.width;

    const tolerance = 10; // 10mm height tolerance (~38px)
    if (imgHeight <= pageHeight + tolerance) {
      // Fit exactly on a single page
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
    } else {
      // Slice across multiple A4 pages so nothing is clipped.
      let remaining = imgHeight;
      let position = 0;
      while (remaining > tolerance) {
        pdf.addImage(imgData, 'JPEG', 0, position, pageWidth, imgHeight);
        remaining -= pageHeight;
        position -= pageHeight;
        if (remaining > tolerance) pdf.addPage();
      }
    }

    return pdf.output('blob');
  } catch (error) {
    console.error('Error generating PDF:', error);
    return null;
  }
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || '').split(',')[1] || '');
    fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
    fr.readAsDataURL(blob);
  });
}

// Delivers the generated PDF with a DIRECT download. iPhone/Safari previews any
// renderable file (PDFs included) inline and ignores Content-Disposition, so on
// iOS we POST the PDF to /api/download-pdf, which returns it as
// application/octet-stream + attachment — a type Safari can't render — and a
// top-level form submit forces iOS's download manager → Save to Files (no inline
// preview, no share sheet, no navigating away). Desktop/Android use the direct
// blob download below, which already works there.
export async function deliverPdf(blob: Blob, filename: string): Promise<void> {
  if (isIOS()) {
    try {
      const base64 = await blobToBase64(blob);
      const apiBase = (window as any).__chaseApiBase || '';
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = `${apiBase}/api/download-pdf`;
      form.style.display = 'none';
      const add = (name: string, value: string) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      };
      add('filename', filename);
      add('data', base64);
      document.body.appendChild(form);
      form.submit();
      setTimeout(() => { try { document.body.removeChild(form); } catch { /* already gone */ } }, 1500);
      return;
    } catch {
      // Fall through to the blob download.
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
  // No target="_blank" — on iOS that opens the PDF inline instead of downloading.
  document.body.appendChild(a);
  a.click();
  // Keep the anchor AND the object URL alive briefly — iOS aborts the download if
  // they're removed/revoked too soon after click().
  setTimeout(() => {
    try { document.body.removeChild(a); } catch { /* already detached */ }
    URL.revokeObjectURL(url);
  }, 4000);
}
