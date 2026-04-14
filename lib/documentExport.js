'use client';

// Load html2pdf.js dynamically from CDN
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
    script.onload = () => { html2pdfLoaded = window.html2pdf; resolve(html2pdfLoaded); };
    script.onerror = () => reject(new Error('Failed to load html2pdf library'));
    document.head.appendChild(script);
  });
}

function isFullHtmlDocument(htmlContent) {
  if (!htmlContent) return false;
  const sample = htmlContent.slice(0, 400).toLowerCase();
  return sample.includes('<!doctype') || sample.includes('<html');
}

function extractDocParts(htmlContent) {
  const styleMatches = [...htmlContent.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : htmlContent;
  return { styles: styleMatches.join('\n'), body };
}

/**
 * Fix CSS for Word/PDF compatibility:
 * - Replace display:flex with display:block (Word doesn't support flex)
 * - Ensure page breaks work
 */
function makeWordCompatible(html) {
  return html
    // Replace flex with block for Word compatibility
    .replace(/display:\s*flex/gi, 'display: block')
    .replace(/flex-direction:\s*column/gi, '')
    .replace(/flex:\s*[\d\s\w]+;?/gi, '')
    .replace(/align-self:\s*[\w-]+;?/gi, '')
    .replace(/justify-content:\s*[\w-]+;?/gi, '')
    .replace(/align-items:\s*[\w-]+;?/gi, '');
}

/**
 * Download HTML content as a PDF file using print-to-PDF (more reliable than html2canvas)
 */
export async function downloadAsPDF(htmlContent, filename = 'document.pdf') {
  try {
    // Method 1: Use browser print dialog (most reliable for complex layouts)
    const printWindow = window.open('', '_blank', 'width=800,height=1100');

    let printHtml;
    if (isFullHtmlDocument(htmlContent)) {
      printHtml = htmlContent;
    } else {
      printHtml = `<html><head><meta charset="utf-8"><title>${filename}</title>
        <style>
          body { font-family: 'Times New Roman', serif; padding: 40px; max-width: 800px; margin: 0 auto; font-size: 12pt; line-height: 1.55; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #333; padding: 6px 10px; }
          @media print { body { padding: 0; } }
        </style></head><body>${htmlContent}</body></html>`;
    }

    printWindow.document.write(printHtml);
    printWindow.document.close();

    // Wait for content to render, then trigger print (user can save as PDF)
    printWindow.onload = () => { printWindow.focus(); printWindow.print(); };
    // Fallback if onload doesn't fire
    setTimeout(() => { printWindow.focus(); printWindow.print(); }, 1000);

    return true;
  } catch (err) {
    console.error('PDF download error:', err);
    alert('PDF generation failed. Please use Print and save as PDF.');
    return false;
  }
}

/**
 * Download HTML content as a Word (.doc) file.
 * Converts flex layouts to block for Word compatibility.
 */
export function downloadAsWord(htmlContent, filename = 'document.doc') {
  // Make the HTML Word-compatible (remove flex, etc.)
  let compatibleHtml = makeWordCompatible(htmlContent);

  let wordHtml;

  if (isFullHtmlDocument(compatibleHtml)) {
    const msoSection = `
      <xml>
        <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
      </xml>
      <style>
        @page WordSection1 { size: 21cm 29.7cm; margin: 1.5cm 1.5cm 1.8cm 1.5cm; mso-header-margin: 1cm; mso-footer-margin: 1cm; }
        div.WordSection1 { page: WordSection1; }
        /* Fix for Word: ensure page divs have proper height */
        .page { display: block !important; min-height: auto !important; page-break-after: always; mso-page-break-after: always; }
        .page:last-child { page-break-after: auto; mso-page-break-after: auto; }
        .page-content { display: block !important; }
        .page-foot { display: block !important; margin-top: 20px; }
        /* Fix ref-row for Word (was flex) */
        .ref-row { display: block !important; overflow: hidden; }
        .ref-row span:first-child { float: left; }
        .ref-row span:last-child { float: right; }
        /* Ensure tables render properly */
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 0.5pt solid #444; padding: 5px 8px; vertical-align: top; }
      </style>`;
    wordHtml = compatibleHtml.replace(/<head[^>]*>/i, match => `${match}${msoSection}`);
    wordHtml = wordHtml.replace(/<html(\s|>)/i, `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'$1`);
    wordHtml = wordHtml.replace(/<body([^>]*)>([\s\S]*?)<\/body>/i, (_m, attrs, inner) => `<body${attrs}><div class="WordSection1">${inner}</div></body>`);
  } else {
    compatibleHtml = makeWordCompatible(htmlContent);
    wordHtml = `
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
            body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.55; }
            table { border-collapse: collapse; width: 100%; }
            td, th { border: 1px solid #333; padding: 6px 10px; vertical-align: top; }
            .page { page-break-after: always; mso-page-break-after: always; }
            .page:last-child { page-break-after: auto; }
            @page WordSection1 { size: 21cm 29.7cm; margin: 1.5cm 1.5cm 1.8cm 1.5cm; }
            div.WordSection1 { page: WordSection1; }
          </style>
        </head>
        <body><div class="WordSection1">${compatibleHtml}</div></body>
      </html>
    `;
  }

  const blob = new Blob(['\ufeff', wordHtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.doc') || filename.endsWith('.docx') ? filename : `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
