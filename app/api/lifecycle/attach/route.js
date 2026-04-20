// =============================================================================
// /api/lifecycle/attach
// =============================================================================
// POST — attach a lifecycle template to a specific claim (or EW claim), and
// optionally purge the legacy workflow/stage data for that claim file.
//
// Body:
//   {
//     claim_id?: number,            // classic claims.id (BIGINT)
//     ew_claim_id?: string,         // ew_vehicle_claims.id (UUID)
//     template_id: number,          // lifecycle_templates.id
//     clear_legacy?: boolean,       // remove old claim_workflow / claim_stages
//                                   // / ew_claim_stages_archive rows for this file
//     user_email?: string
//   }
//
// Exactly one of claim_id or ew_claim_id is required.
// Marks the target claim's `uses_lifecycle_engine = true`, creates the
// claim_lifecycle row with materialised phases + stages, and seeds Phase-4
// default items from the template's default-item list.
//
// SAFE — per-file opt-in. Nothing happens to other claims.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request) {
  try {
    const body = await request.json();
    const claimId = body.claim_id ? parseInt(body.claim_id, 10) : null;
    const ewClaimId = body.ew_claim_id || null;
    const templateId = body.template_id ? parseInt(body.template_id, 10) : null;
    const clearLegacy = Boolean(body.clear_legacy);
    const userEmail = body.user_email || null;

    if (!templateId) {
      return NextResponse.json({ error: 'template_id required' }, { status: 400 });
    }
    if (!claimId && !ewClaimId) {
      return NextResponse.json({ error: 'Either claim_id or ew_claim_id required' }, { status: 400 });
    }
    if (claimId && ewClaimId) {
      return NextResponse.json({ error: 'Provide only one of claim_id or ew_claim_id' }, { status: 400 });
    }

    // 1. Pull the template + its stages + its default items
    const { data: template, error: tErr } = await supabaseAdmin
      .from('lifecycle_templates')
      .select('*')
      .eq('id', templateId)
      .single();
    if (tErr || !template) {
      return NextResponse.json({ error: `Template ${templateId} not found` }, { status: 404 });
    }

    const { data: stages, error: sErr } = await supabaseAdmin
      .from('lifecycle_template_stages')
      .select('*')
      .eq('template_id', templateId)
      .eq('is_active', true)
      .order('sequence_number', { ascending: true });
    if (sErr) throw sErr;

    const { data: defaultItems, error: diErr } = await supabaseAdmin
      .from('lifecycle_template_default_items')
      .select('*, item_catalog:item_catalog_id (id, item_code, item_name, category, default_pending_with, firm_clock_behaviour, insurer_clock_behaviour)')
      .eq('template_id', templateId);
    if (diErr) throw diErr;

    // 2. Guard: if lifecycle already exists for this claim, return it
    let existing;
    if (claimId) {
      const { data } = await supabaseAdmin
        .from('claim_lifecycle')
        .select('*')
        .eq('claim_id', claimId)
        .maybeSingle();
      existing = data;
    } else {
      const { data } = await supabaseAdmin
        .from('claim_lifecycle')
        .select('*')
        .eq('ew_claim_id', ewClaimId)
        .maybeSingle();
      existing = data;
    }
    if (existing) {
      return NextResponse.json(
        { error: `A lifecycle is already attached to this ${claimId ? 'claim' : 'EW claim'} (lifecycle_id=${existing.id}). Detach or reresolve instead.` },
        { status: 409 }
      );
    }

    // 3. Build the resolved_from snapshot from the claim's attributes
    let claimAttrs = {};
    if (claimId) {
      const { data: claimRow } = await supabaseAdmin
        .from('claims')
        .select('id, ref_number, lob, company, policy_type, client_category')
        .eq('id', claimId)
        .single();
      if (claimRow) {
        claimAttrs = {
          lob: claimRow.lob,
          policy_type: claimRow.policy_type,
          client: claimRow.client_category,
          company: claimRow.company,
          ref_number: claimRow.ref_number,
        };
      }
    } else {
      const { data: ewRow } = await supabaseAdmin
        .from('ew_vehicle_claims')
        .select('id, ref_number, company, insurer_name')
        .eq('id', ewClaimId)
        .single();
      if (ewRow) {
        claimAttrs = {
          lob: 'Extended Warranty',
          client: ewRow.insurer_name,
          company: ewRow.company,
          ref_number: ewRow.ref_number,
        };
      }
    }

    // 4. Insert claim_lifecycle
    const lifecycleRow = {
      claim_id: claimId,
      ew_claim_id: ewClaimId,
      template_id: templateId,
      template_version_at_resolve: template.version,
      resolved_from: claimAttrs,
      current_phase: 1,
      is_complete: false,
      firm_clock_start: new Date().toISOString(),
      insurer_clock_start: new Date().toISOString(),
    };
    const { data: lifecycle, error: lErr } = await supabaseAdmin
      .from('claim_lifecycle')
      .insert([lifecycleRow])
      .select()
      .single();
    if (lErr) throw lErr;

    // 5. Materialise 7 phase rows
    const phaseRows = [];
    for (let p = 1; p <= 7; p++) {
      const phaseHasStages = (stages || []).some(s => s.universal_phase === p);
      phaseRows.push({
        claim_lifecycle_id: lifecycle.id,
        universal_phase: p,
        status: phaseHasStages ? (p === 1 ? 'active' : 'not_started') : 'auto_complete',
        activated_at: p === 1 ? new Date().toISOString() : null,
        completed_at: phaseHasStages ? null : new Date().toISOString(),
      });
    }
    const { error: pErr } = await supabaseAdmin.from('claim_lifecycle_phases').insert(phaseRows);
    if (pErr) throw pErr;

    // 6. Materialise stage rows (snapshot template stage fields so later edits to
    // the template don't affect this live claim)
    if (stages && stages.length > 0) {
      const firstStageCode = stages[0].stage_code;
      const stageRows = stages.map(s => ({
        claim_lifecycle_id: lifecycle.id,
        template_stage_id: s.id,
        stage_code: s.stage_code,
        stage_name: s.stage_name,
        universal_phase: s.universal_phase,
        sequence_number: s.sequence_number,
        status: s.stage_code === firstStageCode ? 'active' : 'not_started',
        activated_at: s.stage_code === firstStageCode ? new Date().toISOString() : null,
        due_by_firm: s.firm_tat_hours != null
          ? new Date(Date.now() + s.firm_tat_hours * 3600 * 1000).toISOString()
          : null,
        due_by_insurer: s.insurer_tat_hours != null
          ? new Date(Date.now() + s.insurer_tat_hours * 3600 * 1000).toISOString()
          : null,
      }));
      const { error: csErr } = await supabaseAdmin.from('claim_lifecycle_stages').insert(stageRows);
      if (csErr) throw csErr;
    }

    // 7. Seed Phase-4 default items from the template
    if (defaultItems && defaultItems.length > 0) {
      const itemRows = defaultItems
        .filter(di => di.item_catalog)
        .map(di => {
          const cat = di.item_catalog;
          return {
            claim_lifecycle_id: lifecycle.id,
            item_catalog_id: cat.id,
            item_name: cat.item_name,
            item_category: cat.category,
            pending_with: di.override_pending_with || cat.default_pending_with,
            firm_clock_behaviour: di.override_firm_clock || cat.firm_clock_behaviour,
            insurer_clock_behaviour: di.override_insurer_clock || cat.insurer_clock_behaviour,
            status: 'open',
            notes: di.notes || null,
            added_by_user: userEmail,
          };
        });
      if (itemRows.length > 0) {
        const { error: iErr } = await supabaseAdmin.from('claim_lifecycle_items').insert(itemRows);
        if (iErr) throw iErr;
      }
    }

    // 8. Flip uses_lifecycle_engine = true on the target claim row
    if (claimId) {
      await supabaseAdmin
        .from('claims')
        .update({ uses_lifecycle_engine: true })
        .eq('id', claimId);
    } else if (ewClaimId) {
      await supabaseAdmin
        .from('ew_vehicle_claims')
        .update({ uses_lifecycle_engine: true })
        .eq('id', ewClaimId);
    }

    // 9. OPTIONAL legacy clear — per-file opt-in. Admin's decision.
    // The legacy tables are now VIEWs backed by _archive tables (after 001 ran),
    // but there may also still be ew_claim_stages rows on the working table for
    // claims that pre-dated the cutover. Clear defensively from both.
    let legacyCleared = { claim_workflow: 0, claim_stages: 0, ew_claim_stages_archive: 0, ew_claim_stages: 0 };
    if (clearLegacy) {
      if (claimId) {
        const { count: wfCount } = await supabaseAdmin
          .from('claim_workflow_archive')
          .delete({ count: 'exact' })
          .eq('claim_id', claimId);
        legacyCleared.claim_workflow = wfCount || 0;

        const { count: csCount } = await supabaseAdmin
          .from('claim_stages_archive')
          .delete({ count: 'exact' })
          .eq('claim_id', claimId);
        legacyCleared.claim_stages = csCount || 0;

        // Also clear workflow history tied to this claim
        await supabaseAdmin
          .from('claim_workflow_history_archive')
          .delete()
          .eq('claim_id', claimId);
      }
      if (ewClaimId) {
        const { count: ewArchCount } = await supabaseAdmin
          .from('ew_claim_stages_archive')
          .delete({ count: 'exact' })
          .eq('ew_claim_id', ewClaimId);
        legacyCleared.ew_claim_stages_archive = ewArchCount || 0;
      }
    }

    // 10. Activity log
    await supabaseAdmin.from('activity_log').insert([{
      user_email: userEmail,
      action: 'attach_lifecycle',
      entity_type: 'claim_lifecycle',
      entity_id: lifecycle.id,
      details: {
        template_id: templateId,
        template_code: template.template_code,
        template_name: template.template_name,
        claim_id: claimId,
        ew_claim_id: ewClaimId,
        clear_legacy: clearLegacy,
        legacy_cleared: legacyCleared,
      },
      company: claimAttrs.company || null,
    }]);

    return NextResponse.json({
      lifecycle,
      stages_materialised: stages?.length || 0,
      items_seeded: (defaultItems || []).filter(di => di.item_catalog).length,
      legacy_cleared: legacyCleared,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — detach a lifecycle from a claim (deletes lifecycle row; cascade
// removes phases/stages/items/history). Resets uses_lifecycle_engine = false.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const lifecycleId = searchParams.get('lifecycle_id');
    const userEmail = searchParams.get('user_email');
    if (!lifecycleId) {
      return NextResponse.json({ error: 'lifecycle_id required' }, { status: 400 });
    }

    const { data: lifecycle } = await supabaseAdmin
      .from('claim_lifecycle')
      .select('claim_id, ew_claim_id, template_id')
      .eq('id', lifecycleId)
      .single();
    if (!lifecycle) {
      return NextResponse.json({ error: 'Lifecycle not found' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('claim_lifecycle')
      .delete()
      .eq('id', lifecycleId);
    if (error) throw error;

    if (lifecycle.claim_id) {
      await supabaseAdmin
        .from('claims')
        .update({ uses_lifecycle_engine: false })
        .eq('id', lifecycle.claim_id);
    }
    if (lifecycle.ew_claim_id) {
      await supabaseAdmin
        .from('ew_vehicle_claims')
        .update({ uses_lifecycle_engine: false })
        .eq('id', lifecycle.ew_claim_id);
    }

    await supabaseAdmin.from('activity_log').insert([{
      user_email: userEmail,
      action: 'detach_lifecycle',
      entity_type: 'claim_lifecycle',
      entity_id: parseInt(lifecycleId, 10),
      details: { claim_id: lifecycle.claim_id, ew_claim_id: lifecycle.ew_claim_id, template_id: lifecycle.template_id },
    }]);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
