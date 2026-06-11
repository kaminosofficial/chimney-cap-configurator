import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// Renders an off-screen DOM element to a single A4-width PDF. The element is
// authored at A4 portrait proportions (see PdfReport), so the common case is one
// page; if a configuration makes the content taller than one A4 page, the image
// is sliced across additional A4 pages so nothing is clipped.
export async function generatePdf(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Cannot find element with id ${elementId}`);
    return;
  }

  // Position off-screen (it normally lives inside a scaled preview wrapper).
  const originalStyle = element.style.cssText;
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  element.style.top = '-9999px';
  element.style.transform = 'none';
  element.style.display = 'block';

  try {
    const canvas = await html2canvas(element, {
      scale: 2, // Higher resolution
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();   // 210
    const pageHeight = pdf.internal.pageSize.getHeight();  // 297

    // Scale the captured image to the full page width; height follows aspect.
    const imgHeight = (canvas.height * pageWidth) / canvas.width;

    if (imgHeight <= pageHeight + 0.5) {
      // Single page.
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, imgHeight);
    } else {
      // Slice across multiple A4 pages by shifting the same image upward.
      let remaining = imgHeight;
      let position = 0;
      while (remaining > 0.5) {
        pdf.addImage(imgData, 'JPEG', 0, position, pageWidth, imgHeight);
        remaining -= pageHeight;
        position -= pageHeight;
        if (remaining > 0.5) pdf.addPage();
      }
    }

    pdf.save(filename);
  } catch (error) {
    console.error('Error generating PDF:', error);
  } finally {
    element.style.cssText = originalStyle;
  }
}
