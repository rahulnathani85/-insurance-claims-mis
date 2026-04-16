import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Helpers ------------------------------------------------------------

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Build a styled worksheet. SheetJS community build doesn't emit cell
// styles for .xlsx by default, but we set the array-of-arrays layout
// with merges so the output opens cleanly in Excel/LibreOffice.
function buildFeeSheet(lot, items) {
  const rows = [];

  // ===== Header block =====
  rows.push([`Fee Table — Lot No. ${lot.lot_number}`]);
  rows.push([`Company: ${lot.company}  |  Date: ${fmtDate(lot.lot_date)}  |  EW Program: ${lot.ew_program || '-'}  |  Insurer: ${lot.insurer_name || '-'}`]);
  rows.push([]); // blank row

  // ===== Column headers =====
  const headers = [
    'Sr.',
    'Ref Number',
    'Intimation Date',
    'Claim Number',
    'Policy Number',
    'Insured Name',
    'Date of Loss',
    'VIN / Chassis Number',
    'Vehicle Number',
    'Report Date',
    'Claimed Loss',
    'Assessed Loss',
    'Admissibility',
    'Professional Fee',
    'Reinspection Fee',
    'Conveyance',
    'Photographs',
    'Total Bill',
    'GST @ 18%',
    'Total Amount',
  ];
  rows.push(headers);

  // ===== Data rows =====
  items.forEach((it, idx) => {
    rows.push([
      idx + 1,
      it.ref_number || '',
      fmtDate(it.date_of_intimation),
      it.claim_file_no || '',
      it.policy_number || '',
      it.insured_name || it.customer_name || '',
      fmtDate(it.date_of_loss),
      it.chassis_number || '',
      it.vehicle_reg_no || '',
      fmtDate(it.report_date),
      num(it.estimated_loss_amount),
      num(it.gross_assessed_amount || it.net_adjusted_amount),
      it.admissibility || 'Admissible',
      num(it.professional_fee),
      num(it.reinspection_fee),
      num(it.conveyance),
      num(it.photographs),
      num(it.total_bill),
      num(it.gst),
      num(it.total_amount),
    ]);
  });

  // ===== Totals row =====
  rows.push([
    '', '', '', '', '', '', '', '', '', 'TOTAL',
    items.reduce((s, i) => s + num(i.estimated_loss_amount), 0),
    items.reduce((s, i) => s + num(i.gross_assessed_amount || i.net_adjusted_amount), 0),
    '',
    num(lot.total_professional_fee),
    num(lot.total_reinspection),
    num(lot.total_conveyance),
    num(lot.total_photographs),
    num(lot.total_bill),
    num(lot.total_gst),
    num(lot.total_amount),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Merges: title row spans all columns, subtitle row spans all columns
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];

  // Column widths
  ws['!cols'] = [
    { wch: 5 },   // Sr.
    { wch: 16 },  // Ref Number
    { wch: 13 },  // Intimation Date
    { wch: 16 },  // Claim Number
    { wch: 18 },  // Policy Number
    { wch: 24 },  // Insured Name
    { wch: 12 },  // Date of Loss
    { wch: 20 },  // VIN/Chassis
    { wch: 14 },  // Vehicle Number
    { wch: 12 },  // Report Date
    { wch: 13 },  // Claimed Loss
    { wch: 13 },  // Assessed Loss
    { wch: 13 },  // Admissibility
    { wch: 14 },  // Professional Fee
    { wch: 14 },  // Reinspection Fee
    { wch: 11 },  // Conveyance
    { wch: 11 },  // Photographs
    { wch: 13 },  // Total Bill
    { wch: 11 },  // GST
    { wch: 14 },  // Total Amount
  ];

  // Freeze first 4 rows (title/subtitle/blank/header)
  ws['!freeze'] = { xSplit: 0, ySplit: 4 };

  // Number format for currency columns (K .. T = cols 10..19, 0-indexed)
  const moneyCols = [10, 11, 13, 14, 15, 16, 17, 18, 19];
  const firstDataRow = 4; // after title(0), subtitle(1), blank(2), header(3)
  const lastDataRow = firstDataRow + items.length; // +1 for totals row is handled below
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    for (const c of moneyCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr] && typeof ws[addr].v === 'number') {
        ws[addr].t = 'n';
        ws[addr].z = '#,##0.00';
      }
    }
  }

  return ws;
}

function buildLotSheet(lot, items) {
  const rows = [];

  // ===== Header =====
  rows.push([`Lot No. ${lot.lot_number}`]);
  rows.push([`Surveyor: ${lot.surveyor_name || ''}`]);
  rows.push([]);

  // ===== Column headers =====
  const headers = [
    'Sr.',
    'Date of Intimation',
    'EW Program',
    'VIN / Chassis Number',
    'Vehicle Model',
    'Policy Number',
    'Location',
    'Workshop Name',
    'Surveyor Name',
    'Assessed Amount',
    'Breakdown Details',
    'Service Request Number',
  ];
  rows.push(headers);

  // ===== Data rows =====
  items.forEach((it, idx) => {
    rows.push([
      idx + 1,
      fmtDate(it.date_of_intimation),
      lot.ew_program || '',
      it.chassis_number || '',
      it.vehicle_model || it.vehicle_make || '',
      it.policy_number || '',
      it.location || '',
      it.workshop_name || '',
      lot.surveyor_name || '',
      num(it.gross_assessed_amount || it.net_adjusted_amount),
      it.breakdown_details || '',
      it.service_request_number || '',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];

  ws['!cols'] = [
    { wch: 5 },   // Sr.
    { wch: 14 },  // Intimation
    { wch: 22 },  // EW Program
    { wch: 20 },  // VIN
    { wch: 16 },  // Vehicle Model
    { wch: 18 },  // Policy Number
    { wch: 14 },  // Location
    { wch: 22 },  // Workshop Name
    { wch: 38 },  // Surveyor Name
    { wch: 14 },  // Assessed Amount
    { wch: 40 },  // Breakdown Details
    { wch: 18 },  // Service Request Number
  ];

  ws['!freeze'] = { xSplit: 0, ySplit: 4 };

  // Format assessed amount as money
  const firstDataRow = 4;
  for (let r = firstDataRow; r < firstDataRow + items.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 9 });
    if (ws[addr] && typeof ws[addr].v === 'number') {
      ws[addr].t = 'n';
      ws[addr].z = '#,##0.00';
    }
  }

  return ws;
}

// GET — return the Lot Excel as a binary download.
// Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
export async function GET(request, { params }) {
  try {
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { data: lot, error: e1 } = await supabaseAdmin
      .from('ew_lots')
      .select('*')
      .eq('id', id)
      .single();
    if (e1) throw e1;
    if (!lot) return NextResponse.json({ error: 'Lot not found' }, { status: 404 });

    const { data: items, error: e2 } = await supabaseAdmin
      .from('ew_lot_claims')
      .select('*')
      .eq('lot_id', id)
      .order('position', { ascending: true });
    if (e2) throw e2;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildFeeSheet(lot, items || []), 'Fee Table');
    XLSX.utils.book_append_sheet(wb, buildLotSheet(lot, items || []), `Lot No - ${lot.lot_number}`.substring(0, 31));

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `LOT-${lot.lot_number}-${lot.company}.xlsx`.replace(/\s+/g, '_');

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
