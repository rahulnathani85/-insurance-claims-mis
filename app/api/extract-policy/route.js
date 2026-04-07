import { NextResponse } from 'next/server';

// Extract text from PDF
async function extractFromPDF(buffer) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (e) {
    console.error('PDF extraction error:', e);
    return '';
  }
}

// Extract text from Word doc
async function extractFromWord(buffer) {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (e) {
    console.error('Word extraction error:', e);
    return '';
  }
}

// Parse extracted text to find policy details
function parseFields(text) {
  const fields = {};
  const normalized = text.replace(/\s+/g, ' ');

  // Policy Number patterns
  const policyPatterns = [
    /policy\s*(?:no|number|#)[.:;\s]*([A-Z0-9\-\/]+)/i,
    /(?:certificate|cover)\s*(?:no|number)[.:;\s]*([A-Z0-9\-\/]+)/i,
    /pol(?:icy)?\s*(?:no)?[.:;\s]*(\d{2,}[\-\/]\d+[\-\/]?\d*)/i,
  ];
  for (const pat of policyPatterns) {
    const m = normalized.match(pat);
    if (m) { fields.policy_number = m[1].trim(); break; }
  }

  // Insured Name
  const insuredPatterns = [
    /insured\s*(?:name)?[.:;\s]*([A-Za-z\s&.,]+?)(?:\n|address|policy|sum|period|premium)/i,
    /name\s*of\s*(?:the\s*)?insured[.:;\s]*([A-Za-z\s&.,]+?)(?:\n|address|policy|sum)/i,
  ];
  for (const pat of insuredPatterns) {
    const m = normalized.match(pat);
    if (m) { fields.insured_name = m[1].trim().substring(0, 100); break; }
  }

  // Sum Insured / Sum Assured
  const sumPatterns = [
    /sum\s*(?:insured|assured)[.:;\s]*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
    /(?:total|aggregate)\s*sum\s*(?:insured|assured)[.:;\s]*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
    /(?:cover|coverage)\s*(?:amount)?[.:;\s]*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
  ];
  for (const pat of sumPatterns) {
    const m = normalized.match(pat);
    if (m) { fields.sum_insured = m[1].replace(/,/g, ''); break; }
  }

  // Premium
  const premiumPatterns = [
    /(?:total\s*)?premium[.:;\s]*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
    /premium\s*(?:amount|payable)?[.:;\s]*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
  ];
  for (const pat of premiumPatterns) {
    const m = normalized.match(pat);
    if (m) { fields.premium = m[1].replace(/,/g, ''); break; }
  }

  // Dates (dd/mm/yyyy or dd-mm-yyyy)
  const dateFromPatterns = [
    /(?:from|start|inception|commencement)\s*(?:date)?[.:;\s]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    /period[.:;\s]*(?:from)?[.:;\s]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  ];
  for (const pat of dateFromPatterns) {
    const m = normalized.match(pat);
    if (m) { fields.start_date = convertDate(m[1]); break; }
  }

  const dateToPatterns = [
    /(?:to|end|expiry|upto)\s*(?:date)?[.:;\s]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  ];
  for (const pat of dateToPatterns) {
    const m = normalized.match(pat);
    if (m) { fields.end_date = convertDate(m[1]); break; }
  }

  // Insurer
  const insurerPatterns = [
    /(?:insurer|insurance\s*company|underwriter)[.:;\s]*([A-Za-z\s&.,]+(?:Ltd\.?|Limited|Co\.?))/i,
    /issued\s*by[.:;\s]*([A-Za-z\s&.,]+(?:Ltd\.?|Limited|Co\.?))/i,
  ];
  for (const pat of insurerPatterns) {
    const m = normalized.match(pat);
    if (m) { fields.insurer = m[1].trim().substring(0, 100); break; }
  }

  // Risk Location / Address
  const locationPatterns = [
    /(?:risk|property)\s*(?:location|address|situated\s*at)[.:;\s]*([A-Za-z0-9\s,.\-]+?)(?:\n|pin|state|policy|sum|period)/i,
    /(?:location|address)\s*of\s*risk[.:;\s]*([A-Za-z0-9\s,.\-]+?)(?:\n|pin|state|policy|sum)/i,
  ];
  for (const pat of locationPatterns) {
    const m = normalized.match(pat);
    if (m) { fields.risk_location = m[1].trim().substring(0, 200); break; }
  }

  return fields;
}

function convertDate(dateStr) {
  // Convert dd/mm/yyyy or dd-mm-yyyy to yyyy-mm-dd
  const parts = dateStr.split(/[\/-]/);
  if (parts.length === 3) {
    let [d, m, y] = parts;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return dateStr;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();
    let text = '';

    if (fileName.endsWith('.pdf')) {
      text = await extractFromPDF(buffer);
    } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
      text = await extractFromWord(buffer);
    } else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.png')) {
      // For images, we can't extract text without OCR
      return NextResponse.json({
        fields: {},
        text: '',
        message: 'Image files require OCR which is not currently supported. Please upload a PDF or Word document for auto-extraction.'
      });
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Please upload PDF, Word, or image files.' }, { status: 400 });
    }

    const fields = parseFields(text);

    return NextResponse.json({
      fields,
      text: text.substring(0, 2000), // Send first 2000 chars for reference
      message: Object.keys(fields).length > 0
        ? `Extracted ${Object.keys(fields).length} field(s) from the document.`
        : 'Could not auto-detect fields. Please fill in the details manually.'
    });
  } catch (error) {
    console.error('Extraction error:', error);
    return NextResponse.json({ error: 'Failed to process document: ' + error.message }, { status: 500 });
  }
}
