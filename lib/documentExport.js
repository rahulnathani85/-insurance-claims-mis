'use client';

// Load html2pdf.js dynamically from CDN (no npm install needed)
let html2pdfLoaded = null;
async function loadHtml2Pdf() {
  if (html2pdfLoaded) return html2pdfLoaded;
  if (typeof window !== 'undefined' && window.html2pdf) {
    html2pdfLoaded = window.html2pdf;
    return html2pdfLoaded;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js';
    script.onload = () => {
      html2pdfLoaded = window.html2pdf;
      resolve(html2pdfLoaded);
    };
    script.onerror = () => reject(new Error('Failed to load html2pdf library'));
    document.head.appendChild(script);
  });
}

/**
 * Download HTML content as a PDF file
 * @param {string} htmlContent - The HTML content to convert
 * @param {string} filename - The filename (with or without .pdf extension)
 */
export async function downloadAsPDF(htmlContent, filename = 'document.pdf') {
  try {
    const html2pdf = await loadHtml2Pdf();
    const container = document.createElement('div');
    container.innerHTML = `
      <style>
        body, div { font-family: 'Times New Roman', serif; font-size: 14px; line-height: 1.6; }
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 1px solid #333; padding: 6px 10px; }
        h1, h2, h3 { margin: 10px 0; }
      </style>
      ${htmlContent}
    `;
    container.style.fontFamily = "'Times New Roman', serif";
    container.style.fontSize = '14px';
    container.style.lineHeight = '1.6';
    container.style.padding = '20px';
    container.style.maxWidth = '750px';
    container.style.color = '#000';

    document.body.appendChild(container);

    const fname = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    await html2pdf().from(container).set({
      margin: [15, 15, 15, 15],
      filename: fname,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).save();

    document.body.removeChild(container);
    return true;
  } catch (err) {
    console.error('PDF download error:', err);
    // Fallback to print method
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><title>${filename}</title><style>body{font-family:'Times New Roman',serif;padding:40px;max-width:800px;margin:0 auto;font-size:14px;line-height:1.6;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #333;padding:6px 10px;}</style></head><body>${htmlContent}</body></html>`);
    printWindow.document.close();
    printWindow.print();
    return false;
  }
}

/**
 * Download HTML content as a Word (.doc) file
 * @param {string} htmlContent - The HTML content to convert
 * @param {string} filename - The filename (with or without .doc extension)
 */
export function downloadAsWord(htmlContent, filename = 'document.doc') {
  const html = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office'
          xmlns:w='urn:schemas-microsoft-com:office:word'
          xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
          </w:WordDocument>
        </xml>
        <style>
          body { font-family: 'Times New Roman', serif; font-size: 14px; line-height: 1.6; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #333; padding: 6px 10px; }
          h1 { font-size: 20px; }
          h2 { font-size: 18px; }
          h3 { font-size: 16px; }
          h1, h2, h3 { margin: 10px 0; }
          @page { margin: 2cm; }
        </style>
      </head>
      <body>${htmlContent}</body>
    </html>
  `;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.doc') || filename.endsWith('.docx') ? filename : `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
