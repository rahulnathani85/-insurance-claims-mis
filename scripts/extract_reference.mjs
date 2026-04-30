// One-off script: extracts text from .docx / .xlsx reference reports
// shared by the user, so I can mine their structure to inform new
// LOB templates. Reads paths from argv. Not committed (script-only).

import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const files = process.argv.slice(2);

for (const file of files) {
  console.log('\n========================================================');
  console.log('FILE:', file);
  console.log('========================================================');
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer: buf });
      console.log(result.value.slice(0, 12_000));
      if (result.value.length > 12_000) console.log('...[truncated]');
    } else if (ext === '.xlsx') {
      const wb = XLSX.read(buf, { type: 'buffer' });
      for (const sheetName of wb.SheetNames) {
        console.log(`\n--- SHEET: ${sheetName} ---`);
        const sheet = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        console.log(csv.slice(0, 6_000));
        if (csv.length > 6_000) console.log('...[truncated]');
      }
    } else {
      console.log('(unsupported extension', ext, ')');
    }
  } catch (e) {
    console.log('  ! extract failed:', e.message);
  }
}
