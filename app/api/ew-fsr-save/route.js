import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const FILE_SERVER_URL = process.env.NEXT_PUBLIC_FILE_SERVER_URL || 'http://localhost:4000';
const PUPPETEER_URL = FILE_SERVER_URL.replace(':4000', ':4001');
const FILE_SERVER_KEY = process.env.NEXT_PUBLIC_FILE_SERVER_KEY || 'nisla-file-server-2026';

// POST - Save FSR to claim folder in all formats (HTML, Word, PDF)
// Called once after FSR is generated. Saves all 3 files server-side.
export async function POST(request) {
  try {
    const { ew_claim_id, html } = await request.json();
    if (!ew_claim_id || !html) return NextResponse.json({ error: 'ew_claim_id and html required' }, { status: 400 });

    // Get claim data
    const { data: claim } = await supabaseAdmin.from('ew_vehicle_claims').select('*').eq('id', ew_claim_id).single();
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    // Get folder path
    let folderPath = '';
    if (claim.claim_id) {
      const { data: parent } = await supabaseAdmin.from('claims').select('folder_path').eq('id', claim.claim_id).single();
      folderPath = parent?.folder_path || '';
    }
    if (!folderPath && claim.ref_number) {
      const safeName = (claim.customer_name || claim.insured_name || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
      const safeRef = (claim.ref_number || '').replace(/[<>:"/\\|?*]/g, '_');
      folderPath = `D:\\2026-27\\${claim.company || 'NISLA'}\\Extended Warranty\\${safeRef} - ${safeName}`;
    }
    if (!folderPath) return NextResponse.json({ error: 'No folder path for this claim' }, { status: 400 });

    const relativePath = folderPath.replace(/^D:\\\\2026-27\\\\?/, '').replace(/^D:\\2026-27\\?/, '');
    const fsrFolder = `${relativePath}\\FSR`;
    const baseName = `FSR-${(claim.ref_number || 'report').replace(/[\/\\]/g, '-')}`;

    const results = { html: false, word: false, pdf: false };

    // Helper: upload a file to the file server
    async function uploadFile(content, filename, contentType) {
      try {
        const boundary = '----Bnd' + Date.now() + Math.random().toString(36).slice(2);
        const buf = Buffer.from(content, 'utf-8');
        const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const body = Buffer.concat([header, buf, footer]);

        const res = await fetch(`${FILE_SERVER_URL}/api/upload?folder_path=${encodeURIComponent(fsrFolder)}&overwrite=true`, {
          method: 'POST',
          headers: { 'X-API-Key': FILE_SERVER_KEY, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body,
        });
        const data = await res.json();
        return data?.success || false;
      } catch (e) {
        console.warn(`Upload ${filename} failed:`, e.message);
        return false;
      }
    }

    // 1. Save HTML
    results.html = await uploadFile(html, `${baseName}.html`, 'text/html');

    // 2. Save Word DOCX via Puppeteer server (html-to-docx, real Word format)
    try {
      const docxRes = await fetch(`${PUPPETEER_URL}/api/html-to-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': FILE_SERVER_KEY },
        body: JSON.stringify({ html, folder_path: fsrFolder, filename: `${baseName}.docx` }),
      });
      const docxText = await docxRes.text();
      try {
        const docxData = JSON.parse(docxText);
        results.word = docxData?.success || false;
        results.wordError = docxData?.error || null;
      } catch {
        results.word = false;
        results.wordError = `Non-JSON response: ${docxText.substring(0, 100)}`;
      }
    } catch (docxErr) {
      console.warn('DOCX generation failed:', docxErr.message);
      results.wordError = docxErr.message;
    }

    // 2b. Fallback — if DOCX failed, save legacy HTML-as-.doc so user has something
    if (!results.word) {
      const wordHtml = buildWordHtml(html);
      results.word = await uploadFile('\ufeff' + wordHtml, `${baseName}.doc`, 'application/msword');
      if (results.word) results.wordFallback = true;
    }

    // 3. Save PDF via Puppeteer server
    try {
      const pdfRes = await fetch(`${PUPPETEER_URL}/api/html-to-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': FILE_SERVER_KEY },
        body: JSON.stringify({ html, folder_path: fsrFolder, filename: `${baseName}.pdf` }),
      });
      const pdfText = await pdfRes.text();
      try {
        const pdfData = JSON.parse(pdfText);
        results.pdf = pdfData?.success || false;
        results.pdfError = pdfData?.error || null;
      } catch {
        results.pdf = false;
        results.pdfError = `Non-JSON response: ${pdfText.substring(0, 100)}`;
      }
    } catch (pdfErr) {
      console.warn('Puppeteer PDF failed:', pdfErr.message);
      results.pdfError = pdfErr.message;
    }

    return NextResponse.json({
      success: results.html || results.word || results.pdf,
      results,
      folder: fsrFolder,
      puppeteerUrl: PUPPETEER_URL,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Transform the FSR HTML into a Word-friendly .doc document.
// Keeps all original styles/content but overrides known-broken CSS and adds
// MSO namespaces + Word @page Section so it renders as A4 pages in MS Word.
function buildWordHtml(fullHtml) {
  const msoHead = `
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
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
/* ========= Word-specific overrides (loaded AFTER original styles) ========= */
@page Section1 {
  size: 21cm 29.7cm;
  margin: 1.2cm 1.2cm 1.2cm 1.2cm;
  mso-header-margin: 0.6cm;
  mso-footer-margin: 0.6cm;
  mso-paper-source: 0;
}
div.Section1 { page: Section1; }

/* Ensure body/page don't have fixed width that overflows A4 in Word */
body { font-family: 'Times New Roman', Times, serif !important; font-size: 11pt !important; }
.page {
  width: 100% !important;
  min-height: auto !important;
  padding: 0 !important;
  margin: 0 !important;
  page-break-after: always;
  mso-page-break-after: always;
  position: static !important;
  box-sizing: border-box !important;
}
.page:last-child { page-break-after: auto; mso-page-break-after: auto; }
.page-content { display: block !important; }

/* Convert float-based ref-row to table-like structure (Word has poor float support) */
.ref-row {
  width: 100% !important;
  display: block !important;
  overflow: hidden;
  margin-top: 14px;
  font-size: 10.5pt;
}
.ref-row span { display: inline-block; }
.ref-row span:first-child { float: left; }
.ref-row span:last-child { float: right; }

/* Tables — make sure they render with borders */
table { border-collapse: collapse; mso-table-lspace: 0; mso-table-rspace: 0; }
table.data-table td, table.amount-table td, table.amount-table th {
  mso-border-alt: solid #444 0.5pt;
}

/* Remove any remaining flex — Word 2007+ doesn't support flex */
.page-foot, .cover-foot, .inner-head { display: block !important; }

/* Word ignores background on <body>, but keep foot colors minimal */
.foot-line, .foot-brand, .foot-pgnum, .hd-name, .hd-sla, .hd-tagline { display: block; margin: 2px 0; }
</style>`;

  let out = fullHtml
    // Add MSO namespaces to <html>
    .replace(/<html(\s|>)/i, '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"$1')
    // Inject MSO head block after <head>
    .replace(/<head[^>]*>/i, m => m + msoHead)
    // Wrap body content in Section1 div for @page rule
    .replace(/<body([^>]*)>([\s\S]*?)<\/body>/i, (_m, attrs, inner) => `<body${attrs}><div class="Section1">${inner}</div></body>`);

  // Remove flex declarations from original <style> blocks (inline replacement within existing styles)
  out = out
    .replace(/display:\s*flex[^;}]*/gi, 'display: block')
    .replace(/flex-direction:[^;}]*/gi, '')
    .replace(/justify-content:[^;}]*/gi, '')
    .replace(/align-items:[^;}]*/gi, '')
    .replace(/align-self:[^;}]*/gi, '')
    .replace(/flex:\s*[^;}]*/gi, '')
    // Convert fixed 794px page width (which overflows A4 in Word)
    .replace(/width:\s*794px/gi, 'width: 100%');

  return out;
}
