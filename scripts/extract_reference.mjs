// One-off script: extracts text from .docx / .doc / .pdf / .xlsx reference reports
// shared by the user, so I can mine their structure to inform new
// LOB templates. Reads paths from argv. Not committed (script-only).
//
// Usage: node scripts/extract_reference.mjs path1 path2 ...

import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
// pdf-parse exposes a CommonJS default; the lib/index.js entry point runs a
// debug routine that throws when imported in scripts. Pull from lib/pdf-parse.js
// directly to avoid that.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const files = process.argv.slice(2);

// Crude .doc extractor: legacy binary Word format. Pulls out runs of
// printable text. Not perfect, but good enough to identify section
// headings, table-like rows, and stock phrases. For structured tables
// we'd need antiword/textract — outside scope.
function extractLegacyDoc(buf) {
  const lines = [];
  let cur = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    // Printable ASCII or common punctuation
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09) {
      cur += String.fromCharCode(b);
    } else if (b === 0x0d || b === 0x0a || b === 0x07 || b === 0x0b || b === 0x0c) {
      if (cur.length >= 3) lines.push(cur);
      cur = '';
    } else {
      // Non-printable: only break run if we have a meaningful chunk
      if (cur.length >= 3) {
        lines.push(cur);
      }
      cur = '';
    }
  }
  if (cur.length >= 3) lines.push(cur);
  // De-noise: drop lines that look like XML/binary chaff
  return lines
    .filter((l) => !/^[A-Z0-9_\-\/]{40,}$/.test(l))
    .filter((l) => !/^[\x00-\x1f]+$/.test(l))
    .filter((l) => l.replace(/\s+/g, '').length >= 3)
    .join('\n');
}

for (const file of files) {
  console.log('\n========================================================');
  console.log('FILE:', file);
  console.log('========================================================');
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer: buf });
      console.log(result.value.slice(0, 18_000));
      if (result.value.length > 18_000) console.log('...[truncated]');
    } else if (ext === '.doc') {
      const text = extractLegacyDoc(buf);
      console.log(text.slice(0, 18_000));
      if (text.length > 18_000) console.log('...[truncated]');
    } else if (ext === '.pdf') {
      const result = await pdfParse(buf);
      console.log(`(PDF: ${result.numpages} pages, ${result.text.length} chars)`);
      console.log(result.text.slice(0, 18_000));
      if (result.text.length > 18_000) console.log('...[truncated]');
    } else if (ext === '.xlsx') {
      const wb = XLSX.read(buf, { type: 'buffer' });
      for (const sheetName of wb.SheetNames) {
        console.log(`\n--- SHEET: ${sheetName} ---`);
        const sheet = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        console.log(csv.slice(0, 8_000));
        if (csv.length > 8_000) console.log('...[truncated]');
      }
    } else {
      console.log('(unsupported extension', ext, ')');
    }
  } catch (e) {
    console.log('  ! extract failed:', e.message);
  }
}
