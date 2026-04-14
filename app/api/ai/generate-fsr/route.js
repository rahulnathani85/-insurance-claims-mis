import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSystemPrompt, FSR_GENERATION_PROMPT } from '@/config/ai-prompts';
import { callAI } from '@/lib/aiClient';

export async function POST(request) {
  try {

    const { claim_id, user_email } = await request.json();
    if (!claim_id) return NextResponse.json({ error: 'claim_id required' }, { status: 400 });

    // Load claim data
    const { data: claim } = await supabaseAdmin.from('claims').select('*').eq('id', claim_id).single();
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    // If Extended Warranty, also load EW-specific data
    let ewData = null;
    if (claim.lob === 'Extended Warranty') {
      const { data } = await supabaseAdmin.from('ew_vehicle_claims').select('*').eq('claim_id', claim_id).single();
      ewData = data;
    }

    // Load AI conversation (analysis + Q&A)
    const { data: conversations } = await supabaseAdmin
      .from('claim_ai_conversations')
      .select('role, message')
      .eq('claim_id', claim_id)
      .order('created_at', { ascending: true });

    // Load documents list
    const { data: docs } = await supabaseAdmin.from('claim_documents').select('file_name, file_type').eq('claim_id', claim_id);

    // Build comprehensive claim context
    const claimFields = Object.entries(claim)
      .filter(([k, v]) => v && !['id', 'created_at', 'updated_at', 'folder_path', 'company', 'pipeline_stage', 'pipeline_stage_number'].includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    let ewFields = '';
    if (ewData) {
      ewFields = '\n\nEXTENDED WARRANTY CLAIM DETAILS:\n' + Object.entries(ewData)
        .filter(([k, v]) => v && !['id', 'claim_id', 'created_at', 'updated_at', 'created_by', 'company', 'current_stage', 'current_stage_name', 'status'].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    }

    // Determine surveyor firm
    const company = claim.company || 'NISLA';
    const firmName = company === 'Acuere'
      ? 'ACUERE SURVEYORS (S.L.A. 85225)'
      : 'NATHANI INSURANCE SURVEYORS & LOSS ASSESSORS PVT. LTD. (S.L.A. 200025)';

    const conversationSummary = (conversations || [])
      .map(c => `${c.role.toUpperCase()}: ${c.message}`)
      .join('\n\n');

    const prompt = `${FSR_GENERATION_PROMPT}

SURVEYOR FIRM: ${firmName}
COMPANY: ${company}

CLAIM DATA FROM MIS:
${claimFields}
${ewFields}

DOCUMENTS ON FILE:
${(docs || []).map(d => `- ${d.file_name} (${d.file_type})`).join('\n') || 'No documents listed'}

PREVIOUS ANALYSIS & SURVEYOR ANSWERS:
${conversationSummary || 'No prior analysis available. Generate FSR based on available claim data.'}

Generate the complete FSR now in HTML format. Use the EXACT section structure from the template (Cover Page table, Claim Details table, Vehicle Particulars table, Survey Findings narrative, Assessment table, Conclusion). Fill in all data from the claim fields above. Mark any missing/estimated data with [AI] tags.`;

    const { text: fsrHtml, provider } = await callAI({
      systemPrompt: getSystemPrompt(claim.lob),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 8192,
    });

    // Get next version number
    const { data: existing } = await supabaseAdmin
      .from('claim_fsr_drafts')
      .select('version_number')
      .eq('claim_id', claim_id)
      .order('version_number', { ascending: false })
      .limit(1);

    const nextVersion = (existing && existing.length > 0) ? existing[0].version_number + 1 : 1;

    // Save draft
    const { data: draft, error } = await supabaseAdmin
      .from('claim_fsr_drafts')
      .insert([{
        claim_id,
        lob: claim.lob,
        draft_content: fsrHtml,
        status: 'draft',
        version_number: nextVersion,
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ draft, html: fsrHtml });
  } catch (err) {
    console.error('FSR generation error:', err);
    return NextResponse.json({ error: err.message || 'FSR generation failed' }, { status: 500 });
  }
}
