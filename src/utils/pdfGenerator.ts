import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export async function generatePdf(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Cannot find element with id ${elementId}`);
    return;
  }

  // We temporarily make it visible if it's display: none, 
  // though for off-screen rendering it's better to just position it off screen
  const originalStyle = element.style.cssText;
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  element.style.top = '-9999px';
  element.style.display = 'block';

  try {
    const canvas = await html2canvas(element, {
      scale: 2, // Higher resolution
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    
    // Calculate PDF dimensions (assuming 8.5 x 11 inches, portrait)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'in',
      format: 'letter'
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

    pdf.save(filename);
  } catch (error) {
    console.error('Error generating PDF:', error);
  } finally {
    element.style.cssText = originalStyle;
  }
}
