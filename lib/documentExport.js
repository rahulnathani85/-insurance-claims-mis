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

// Return true if htmlContent is a full HTML document (has <html> / <!DOCTYPE)
function isFullHtmlDocument(htmlContent) {
  if (!htmlContent) return false;
  const sample = htmlContent.slice(0, 400).toLowerCase();
  return sample.includes('<!doctype') || sample.includes('<html');
}

// Extract the inner <style>...</style> blocks + <body>...</body> contents
// from a full HTML document so we can inject them into an in-page container
// without the <html>/<head>/<body> wrappers (which don't survive innerHTML).
function extractDocParts(htmlContent) {
  const styleMatches = [...htmlContent.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : htmlContent;
  return { styles: styleMatches.join('\n'), body };
}

/**
 * Download HTML content as a PDF file. If `htmlContent` is a full HTML
 * document (with its own <style>) it is rendered as-is so the template's
 * typography and page breaks are preserved. Otherwise a minimal default
 * wrapper is applied.
 *
 * @param {string} htmlContent - The HTML content to convert
 * @param {string} filename - The filename (with or without .pdf extension)
 */
export async function downloadAsPDF(htmlContent, filename = 'document.pdf') {
  try {
    const html2pdf = await loadHtml2Pdf();
    const container = document.createElement('div');

    if (isFullHtmlDocument(htmlContent)) {
      // Preserve the template's own CSS + body. We DO NOT inject any
      // defaults here so typography, page breaks and brand colors survive.
      const { styles, body } = extractDocParts(htmlContent);
      container.innerHTML = `<style>${styles}</style>${body}`;
      // A4 at 96 DPI â 794px. Forcing width keeps html2canvas from
      // squishing/stretching layout and matches the @page size above.
      container.style.width = '794px';
      container.style.background = '#fff';
      container.style.color = '#000';
    } else {
      // Partial fragment â apply a readable default so it doesn't look raw.
      container.innerHTML = `
        <style>
          body, div { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.55; color: #000; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #333; padding: 6px 10px; vertical-align: top; }
          h1, h2, h3 { margin: 10px 0; }
        </style>
        ${htmlContent}
      `;
      container.style.fontFamily = "'Times New Roman', serif";
      container.style.fontSize = '12pt';
      container.style.lineHeight = '1.55';
      container.style.padding = '20px';
      container.style.maxWidth = '794px';
      container.style.color = '#000';
      container.style.background = '#fff';
    }

    // Render off-screen to avoid flicker but keep it in the DOM so
    // html2canvas can measure it correctly.
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    document.body.appendChild(container);

    const fname = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    await html2pdf().from(container).set({
      margin: [10, 10, 12, 10],
      filename: fname,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        letterRendering: true,
        windowWidth: 794,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
      // Honour CSS `page-break-*` so each .page div lands on its own PDF page
      // instead of one tall blob sliced arbitrarily.
      pagebreak: { mode: ['css', 'legacy'], before: '.page', avoid: ['tr', 'table.amount-table'] },
    }).save();

    document.body.removeChild(container);
    return true;
  } catch (err) {
    console.error('PDF download error:', err);
    // Fallback: open in a print window so the user can still get the document
    const printWindow = window.open('', '_blank');
    printWindow.document.write(
      isFullHtmlDocument(htmlContent)
        ? htmlContent
        : `<html><head><title>${filename}</title><style>body{font-family:'Times New Roman',serif;padding:40px;max-width:800px;margin:0 auto;font-size:12pt;line-height:1.55;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #333;padding:6px 10px;}</style></head><body>${htmlContent}</body></html>`
    );
    printWindow.document.close();
    printWindow.print();
    return false;
  }
}

/**
 * Download HTML content as a Word (.doc) file. Full HTML documents are
 * passed through so Word can pick up their embedded <style> and @page rules.
 * Partial fragments get a minimal wrapper.
 *
 * @param {string} htmlContent - The HTML content to convert
 * @param {string} filename - The filename (with or without .doc extension)
 */
export function downloadAsWord(htmlContent, filename = 'document.doc') {
  let wordHtml;

  if (isFullHtmlDocument(htmlContent)) {
    // Inject MS-Office namespaces + a Word-specific page setup section.
    // Keeping the original <html>/<head>/<body> intact lets the template's
    // own CSS (including `mso-page-break-after`) survive into Word.
    const msoSection = `
      <xml>
        <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
      </xml>
      <style>
        @page WordSection1 { size: 21cm 29.7cm; margin: 1.5cm 1.5cm 1.8cm 1.5cm; mso-header-margin: 1cm; mso-footer-margin: 1cm; mso-paper-source: 0; }
        div.WordSection1 { page: WordSection1; }
      </style>`;
    // Insert our <xml>+<style> block into <head> so Word consumes it.
    wordHtml = htmlContent.replace(/<head[^>]*>/i, match => `${match}${msoSection}`);
    // Add Office XML namespaces if the root <html> doesn't already have them.
    wordHtml = wordHtml.replace(/<html(\s|>)/i, `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'$1`);
    // Wrap body contents in a WordSection1 div so the @page rule applies.
    wordHtml = wordHtml.replace(/<body([^>]*)>([\s\S]*?)<\/body>/i, (_m, attrs, inner) => `<body${attrs}><div class="WordSection1">${inner}</div></body>`);
  } else {
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
            h1 { font-size: 20pt; }
            h2 { font-size: 16pt; }
            h3 { font-size: 14pt; }
            h1, h2, h3 { margin: 10px 0; }
            @page WordSection1 { size: 21cm 29.7cm; margin: 1.5cm 1.5cm 1.8cm 1.5cm; }
            div.WordSection1 { page: WordSection1; }
          </style>
        </head>
        <body><div class="WordSection1">${htmlContent}</div></body>
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
