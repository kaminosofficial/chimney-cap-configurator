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

    // Rasterize an element to a canvas using the platform's chosen engine.
    const renderToCanvas = (target: HTMLElement, w: number, h: number): Promise<HTMLCanvasElement> => {
      if (isMobileDevice()) {
        const html2canvas = (rasterizer as typeof import('html2canvas')).default;
        return withTimeout(
          html2canvas(target, { scale: 2, backgroundColor: '#ffffff', width: w, height: h, useCORS: true, allowTaint: true, logging: false }),
          15000,
          'PDF generation timed out (mobile)'
        );
      }
      // Desktop: html-to-image (SVG foreignObject) — pixel-perfect via the browser's
      // own renderer. cacheBust stays OFF (it corrupts the inline data: URIs); skipFonts
      // avoids slow/failing font fetches (the report uses the system fallback font).
      const { toCanvas } = rasterizer as typeof import('html-to-image');
      return withTimeout(
        toCanvas(target, { pixelRatio: 2, backgroundColor: '#ffffff', width: w, height: h, skipFonts: true }),
        8000,
        'PDF generation timed out (desktop)'
      );
    };

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();   // 210
    const pageHeight = pdf.internal.pageSize.getHeight();  // 297

    try {
      // Preferred path: the report is pre-paginated into explicit .pdf-page divs.
      // Rasterize EACH page separately → one A4 PDF page each. Because each page is
      // already a whole-A4 unit with whole sections, nothing is ever split across a
      // page boundary and the pricing card stays pinned to the bottom of its page.
      const pageEls = Array.from(clone.querySelectorAll('.pdf-page')) as HTMLElement[];
      if (pageEls.length > 0) {
        for (let i = 0; i < pageEls.length; i++) {
          const pw = pageEls[i].offsetWidth || 794;
          const ph = pageEls[i].offsetHeight || 1123;
          const pageCanvas = await renderToCanvas(pageEls[i], pw, ph);
          if (i > 0) pdf.addPage();
          pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidth, pageHeight);
        }
      } else {
        // Fallback (no explicit pages): single tall capture, sliced into A4 pages.
        const canvas = await renderToCanvas(clone, width, height);
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const imgHeight = (canvas.height * pageWidth) / canvas.width;
        const tolerance = 10;
        if (imgHeight <= pageHeight + tolerance) {
          pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
        } else {
          let remaining = imgHeight;
          let position = 0;
          while (remaining > tolerance) {
            pdf.addImage(imgData, 'JPEG', 0, position, pageWidth, imgHeight);
            remaining -= pageHeight;
            position -= pageHeight;
            if (remaining > tolerance) pdf.addPage();
          }
        }
      }
    } finally {
      // Clean up the temporary container only after all pages are rasterized.
      try {
        containerToAppend.removeChild(tempContainer);
      } catch { /* ignore */ }
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
