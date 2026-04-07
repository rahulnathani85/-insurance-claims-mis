import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

const BACKUP_TABLES = [
  { table: 'claims', label: 'Claims' },
  { table: 'policies', label: 'Policies' },
  { table: 'insurers', label: 'Insurers' },
  { table: 'offices', label: 'Offices' },
  { table: 'survey_fee_bills', label: 'Survey Fee Bills' },
  { table: 'gipsa_rates', label: 'GIPSA Rates' },
  { table: 'counters', label: 'Counters' },
  { table: 'brokers', label: 'Brokers' },
  { table: 'claim_workflow', label: 'Claim Workflow' },
  { table: 'claim_assignments', label: 'Claim Assignments' },
  { table: 'claim_documents', label: 'Claim Documents' },
  { table: 'claim_emails', label: 'Claim Emails' },
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'json';
  const tableFilter = searchParams.get('table');
  const company = searchParams.get('company') || '';

  try {
    const tablesToExport = tableFilter && tableFilter !== 'all'
      ? BACKUP_TABLES.filter(t => t.table === tableFilter)
      : BACKUP_TABLES;

    const results = {};
    let totalRecords = 0;

    for (const { table, label } of tablesToExport) {
      try {
        let query = supabase.from(table).select('*');
        if (company && company !== 'All') {
          const companyTables = ['claims', 'policies', 'survey_fee_bills', 'claim_workflow', 'claim_assignments', 'claim_documents', 'claim_emails'];
          if (companyTables.includes(table)) {
            query = query.eq('company', company);
          }
        }
        const { data, error } = await query;
        if (error) {
          results[table] = { label, error: error.message, data: [], count: 0 };
        } else {
          results[table] = { label, data: data || [], count: (data || []).length };
          totalRecords += (data || []).length;
        }
      } catch (e) {
        results[table] = { label, error: e.message, data: [], count: 0 };
      }
    }

    if (format === 'csv' && tableFilter && tableFilter !== 'all') {
      const tableData = results[tableFilter];
      if (tableData && tableData.data.length > 0) {
        const csv = convertToCSV(tableData.data);
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${tableFilter}_backup_${getDateStr()}.csv"`,
          },
        });
      }
    }

    const backup = {
      backup_date: new Date().toISOString(),
      backup_date_formatted: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      company: company || 'All',
      total_records: totalRecords,
      total_tables: Object.keys(results).length,
      tables: results,
    };

    if (searchParams.get('download') === 'true') {
      return new Response(JSON.stringify(backup, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="MIS_Backup_${getDateStr()}.json"`,
        },
      });
    }

    return NextResponse.json(backup);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function getDateStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
}

function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      let val = row[h];
      if (val === null || val === undefined) return '';
      val = String(val).replace(/"/g, '""');
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val}"`;
      }
      return val;
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}
