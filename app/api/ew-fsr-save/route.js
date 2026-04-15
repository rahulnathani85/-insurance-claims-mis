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

        const res = await fetch(`${FILE_SERVER_URL}/api/upload?folder_path=${encodeURIComponent(fsrFolder)}`, {
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

    // 2. Save Word (inject MSO namespaces into the full HTML)
    const wordHtml = html
      .replace(/<html(\s|>)/i, '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"$1')
      .replace(/<head[^>]*>/i, m => m + '<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><style>@page S1{size:21cm 29.7cm;margin:1.5cm}div.S1{page:S1}</style>')
      .replace(/<body([^>]*)>([\s\S]*?)<\/body>/i, (_m, a, inner) => `<body${a}><div class="S1">${inner}</div></body>`)
      .replace(/display:\s*flex/gi, 'display: block')
      .replace(/width:\s*794px/gi, 'width: 100%')
      .replace(/min-height:\s*\d+px/gi, 'min-height: auto');
    results.word = await uploadFile('\ufeff' + wordHtml, `${baseName}.doc`, 'application/msword');

    // 3. Save PDF via Puppeteer server
    try {
      console.log(`[FSR-SAVE] Calling Puppeteer at: ${PUPPETEER_URL}/api/html-to-pdf`);
      console.log(`[FSR-SAVE] folder_path: ${fsrFolder}, filename: ${baseName}.pdf`);
      const pdfRes = await fetch(`${PUPPETEER_URL}/api/html-to-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': FILE_SERVER_KEY },
        body: JSON.stringify({ html, folder_path: fsrFolder, filename: `${baseName}.pdf` }),
      });
      const pdfText = await pdfRes.text();
      console.log(`[FSR-SAVE] Puppeteer response status: ${pdfRes.status}, body: ${pdfText.substring(0, 200)}`);
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
