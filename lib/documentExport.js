'use client';

/**
 * Download FSR HTML as PDF.
 * Tries Puppeteer server first (proper PDF), falls back to print dialog.
 */
export async function downloadAsPDF(htmlContent, filename = 'document.pdf') {
  // Try Puppeteer PDF generation via server proxy
  try {
    const res = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: htmlContent }),
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/pdf')) {
        // Server returned PDF binary directly
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
      }
      // Server saved PDF to folder, return success
      const data = await res.json();
      if (data.success) return true;
    }
  } catch (e) {
    console.warn('Puppeteer PDF failed, falling back to print dialog:', e.message);
  }

  // Fallback: open print dialog
  const win = window.open('', '_blank');
  if (!win) { alert('Please allow popups to download PDF.'); return false; }
  win.document.write(htmlContent);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 500);
  return true;
}

/**
 * Download FSR HTML as Word (.doc) file.
 * Transforms the HTML to be Word-compatible:
 * - Removes CSS flex (Word doesn't support it)
 * - Converts pixel widths to percentages
 * - Adds MSO page setup for proper A4 printing
 * - Ensures tables, page breaks, and fonts work in Word
 */
export function downloadAsWord(htmlContent, filename = 'document.doc') {
  // Step 1: Extract styles and body from the full HTML document
  const styleMatch = [...htmlContent.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : htmlContent;

  // Step 2: Clean CSS for Word compatibility
  let cleanCss = styleMatch
    // Remove flex — Word doesn't understand it
    .replace(/display:\s*flex[^;]*/gi, 'display: block')
    .replace(/flex-direction:[^;]*/gi, '')
    .replace(/flex:[^;]*/gi, '')
    .replace(/justify-content:[^;]*/gi, '')
    .replace(/align-items:[^;]*/gi, '')
    .replace(/align-self:[^;]*/gi, '')
    // Convert fixed pixel widths to 100% for Word
    .replace(/width:\s*794px/gi, 'width: 100%')
    // Remove min-height (causes blank space in Word)
    .replace(/min-height:\s*\d+px/gi, 'min-height: auto')
    // Remove position:relative/fixed (causes overlay issues in Word)
    .replace(/position:\s*(relative|fixed|absolute)/gi, 'position: static');

  // Step 3: Build Word-compatible HTML with MSO namespaces
  const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="NISLA MIS">
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<style>
  /* Word page setup */
  @page Section1 {
    size: 21cm 29.7cm;
    margin: 1.5cm 1.5cm 1.8cm 1.5cm;
    mso-header-margin: 0.8cm;
    mso-footer-margin: 0.8cm;
    mso-paper-source: 0;
  }
  div.Section1 { page: Section1; }

  /* Base typography */
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    line-height: 1.45;
    color: #000;
  }

  /* Page divs — block layout with page breaks */
  .page {
    width: 100%;
    display: block;
    padding: 0;
    page-break-after: always;
    mso-special-character: line-break;
  }
  .page:last-child { page-break-after: auto; }
  .page-content { display: block; }

  /* Footer at bottom of each page */
  .page-foot {
    display: block;
    border-top: 0.75pt solid #555;
    padding-top: 6px;
    margin-top: 30px;
    text-align: center;
    font-size: 8.5pt;
    line-height: 1.35;
    color: #333;
  }

  /* Ref row: use table for two-column layout (Word-safe) */
  .ref-row {
    display: block;
    overflow: hidden;
    margin-top: 14px;
    font-size: 10.5pt;
  }
  .ref-row span:first-child { float: left; }
  .ref-row span:last-child { float: right; }

  /* Tables */
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 0.5pt solid #444; padding: 5px 8px; vertical-align: top; }

  /* Cover page elements */
  .cover-brand { text-align: center; margin-top: 4px; }
  .cover-title { text-align: center; margin-top: 50px; font-size: 22pt; font-weight: bold; text-decoration: underline; }
  .cover-vehicle { text-align: center; margin-top: 30px; font-size: 14pt; font-weight: bold; }
  .cover-vin { text-align: center; font-size: 13pt; margin-top: 6px; }
  .cover-insured { text-align: center; margin-top: 20px; font-size: 13pt; font-weight: bold; }
  .cover-insurer-block { text-align: center; margin-top: 30px; }
  .cover-insurer { font-size: 15pt; font-weight: bold; }
  .cover-policy { margin-top: 6px; font-size: 12pt; }
  .cover-plan { margin-top: 10px; font-size: 11pt; font-style: italic; }
  .cover-foot { margin-top: 40px; }

  /* Inner page headers */
  .inner-head { text-align: center; padding-bottom: 6px; }
  .report-title { text-align: center; font-size: 14pt; font-weight: bold; text-decoration: underline; margin: 18px 0 6px 0; }
  .report-sub { text-align: center; font-size: 10.5pt; font-style: italic; margin-bottom: 14px; }
  .address-block { margin: 12px 0; line-height: 1.4; font-size: 11pt; }
  .subject-block { margin: 12px 0; font-size: 11pt; }
  .section-title { font-weight: bold; font-size: 11.5pt; margin: 16px 0 6px 0; text-decoration: underline; }

  /* Assessment table */
  table.amount-table { width: 80%; margin: 12px auto; font-size: 11pt; }
  table.amount-table th { background: #f0ecf6; text-align: left; font-weight: bold; }

  /* Note block */
  .note-block { margin-top: 14px; padding: 10px 14px; font-size: 10pt; }
  .sig-block { margin-top: 40px; text-align: right; font-size: 11pt; }

  p { margin: 6px 0; text-align: justify; }
  p.indent { text-indent: 30px; }
  ul.findings { margin: 6px 0 6px 18px; padding-left: 12px; }
  ul.findings li { margin-bottom: 7px; text-align: justify; }

  /* Override original template styles */
  ${cleanCss}
</style>
</head>
<body>
<div class="Section1">
${bodyContent}
</div>
</body>
</html>`;

  // Step 4: Download as .doc file
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
