// =============================================================================
// /lib/lifecycleEngine.js
// =============================================================================
// NISLA Lifecycle Engine — core runtime module.
//
// Responsibilities:
//   1. resolveTemplate(claimAttributes)       — find the most-specific matching template
//   2. instantiateLifecycle(claimId, userEmail) — create claim_lifecycle + child rows
//   3. advanceStage(stageRowId, outcome, userEmail) — complete a stage, evaluate branches, roll up phases
//   4. evaluateBranches(stage, outcome, claim) — run conditional branching rules
//   5. rollupPhases(lifecycleId)              — recompute phase states; apply auto-complete logic
//   6. openItem / closeItem                    — Phase 4 pending items; pause/resume clocks
//   7. reopenClaim(lifecycleId, targetPhase, reason, user) — after-delivery re-open
//   8. clockTick(lifecycleId)                  — periodic job to accumulate elapsed time
//
// This file is intentionally NOT thin — it is the single source of lifecycle
// behaviour. All API routes call into here. No business logic in the routes.
//
// Dependencies: @supabase/supabase-js (via /lib/supabaseAdmin.js)
// =============================================================================

const { supabaseAdmin } = require('./supabaseAdmin');

// -----------------------------------------------------------------------------
// Universal phase constants (the only hardcoded part of the engine)
// -----------------------------------------------------------------------------
const UNIVERSAL_PHASES = [
  { number: 1, name: 'Appointment',              statusPrefix: ''              },
  { number: 2, name: 'Survey & Inspection',      statusPrefix: 'Under Process' },
  { number: 3, name: 'ILA & LOR Issued',         statusPrefix: 'Under Process' },
  { number: 4, name: 'Pending Requirements',     statusPrefix: 'Under Process' },
  { number: 5, name: 'Assessment',               statusPrefix: ''              },
  { number: 6, name: 'Report',                   statusPrefix: 'Work Completed'},
  { number: 7, name: 'Delivery',                 statusPrefix: 'FSR Submitted' },
];

// =============================================================================
// 1. TEMPLATE RESOLUTION
// =============================================================================
// Walk candidates from most-specific to least-specific. A candidate is any
// active template whose match_* fields are ALL either NULL or equal to the
// corresponding claim attribute. Among candidates, winner has the highest
// specificity score (count of non-null matchers), then highest priority, then
// most recent created_at.
// =============================================================================

const MATCH_DIMENSIONS = [
  { field: 'match_lob',             attr: 'lob'                 },
  { field: 'match_policy_type',     attr: 'policy_type'         },
  { field: 'match_cause_of_loss',   attr: 'cause_of_loss'       },
  { field: 'match_subject_matter',  attr: 'subject_matter'      },
  { field: 'match_portfolio',       attr: 'portfolio'           },
  { field: 'match_client',          attr: 'client'              },
  { field: 'match_size_band',       attr: 'size_band'           },
  { field: 'match_nature',          attr: 'nature'              },
  { field: 'match_appointment_src', attr: 'appointment_source'  },
];

async function resolveTemplate(claimAttributes) {
  // 1) Pull all active templates
  const { data: templates, error } = await supabaseAdmin
    .from('lifecycle_templates')
    .select('*')
    .eq('is_active', true);

  if (error) throw new Error(`resolveTemplate: ${error.message}`);

  // 2) Filter to matching candidates
  const candidates = [];
  for (const tpl of templates || []) {
    let isMatch = true;
    let specificity = 0;

    for (const dim of MATCH_DIMENSIONS) {
      const tplValue = tpl[dim.field];
      if (tplValue === null || tplValue === undefined || tplValue === '') continue;

      const claimValue = claimAttributes[dim.attr];
      if (claimValue !== tplValue) { isMatch = false; break; }
      specificity++;
    }
    if (!isMatch) continue;

    // 3) If template has time rules enabled, check validity
    if (tpl.time_rules_enabled) {
      const okTime = await checkTimeRules(tpl.id, claimAttributes);
      if (!okTime) continue;
      specificity++; // time-match is one more dimension in the cascade
    }

    candidates.push({ tpl, specificity });
  }

  if (!candidates.length) {
    // Fall back to Universal Default
    const { data: fallback } = await supabaseAdmin
      .from('lifecycle_templates')
      .select('*')
      .eq('template_code', 'universal_default')
      .single();
    if (!fallback) throw new Error('resolveTemplate: no matching template and no Universal Default seeded');
    return fallback;
  }

  // 4) Pick winner
  candidates.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    if (b.tpl.priority !== a.tpl.priority) return b.tpl.priority - a.tpl.priority;
    return new Date(b.tpl.created_at) - new Date(a.tpl.created_at);
  });

  return candidates[0].tpl;
}

async function checkTimeRules(templateId, claimAttributes) {
  const { data: rules } = await supabaseAdmin
    .from('lifecycle_template_time_rules')
    .select('*')
    .eq('template_id', templateId)
    .eq('is_active', true);

  if (!rules || !rules.length) return true; // no rules = always valid

  for (const rule of rules) {
    const matchValue = claimAttributes[rule.match_field || 'date_of_intimation'];
    if (!matchValue) continue;
    const ts = new Date(matchValue).getTime();
    const from = rule.valid_from ? new Date(rule.valid_from).getTime() : -Infinity;
    const until = rule.valid_until ? new Date(rule.valid_until).getTime() : Infinity;
    if (ts >= from && ts <= until) return true;
  }
  return false;
}

// =============================================================================
// 2. APPLY DELTAS (for override templates)
// =============================================================================
// If the resolved template is an override, pull parent's stages recursively
// and apply the override's delta operations (add / replace / remove / modify).
// =============================================================================

async function materializeStages(template) {
  // Recursively climb to root full_list
  if (template.resolution_type === 'full_list') {
    const { data: stages } = await supabaseAdmin
      .from('lifecycle_template_stages')
      .select('*')
      .eq('template_id', template.id)
      .eq('is_active', true)
      .order('sequence_number');
    return stages || [];
  }

  // Override: get parent's materialized stages first
  if (!template.parent_template_id) {
    throw new Error(`Override template ${template.template_code} has no parent_template_id`);
  }
  const { data: parent } = await supabaseAdmin
    .from('lifecycle_templates')
    .select('*')
    .eq('id', template.parent_template_id)
    .single();
  if (!parent) throw new Error(`Parent template ${template.parent_template_id} not found`);

  const parentStages = await materializeStages(parent);

  // Get this template's delta stages
  const { data: deltas } = await supabaseAdmin
    .from('lifecycle_template_stages')
    .select('*')
    .eq('template_id', template.id)
    .eq('is_active', true)
    .order('sequence_number');

  // Apply deltas
  let stages = [...parentStages];
  for (const d of (deltas || [])) {
    if (d.delta_operation === 'add') {
      stages.push(d);
    } else if (d.delta_operation === 'replace') {
      stages = stages.filter(s => s.stage_code !== d.stage_code);
      stages.push(d);
    } else if (d.delta_operation === 'remove') {
      stages = stages.filter(s => s.stage_code !== d.stage_code);
    } else if (d.delta_operation === 'modify') {
      const idx = stages.findIndex(s => s.stage_code === d.stage_code);
      if (idx >= 0) stages[idx] = { ...stages[idx], ...d };
    }
  }

  // Re-sort by sequence_number
  stages.sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
  return stages;
}

// =============================================================================
// 3. INSTANTIATE LIFECYCLE
// =============================================================================
// Called on claim registration (from /api/claims and /api/ew-claims).
// Creates the claim_lifecycle row, all phase rows, all stage rows, all default
// Phase 4 item rows, and starts the clocks.
// =============================================================================

async function instantiateLifecycle({ claimId = null, ewClaimId = null, claimAttributes, userEmail }) {
  if (!claimId && !ewClaimId) throw new Error('instantiateLifecycle: claimId OR ewClaimId required');

  // 1) Resolve template
  const template = await resolveTemplate(claimAttributes);

  // 2) Materialize stages (handles override deltas)
  const stages = await materializeStages(template);

  // 3) Create claim_lifecycle row
  const intimationDate = claimAttributes.date_of_intimation
    ? new Date(claimAttributes.date_of_intimation)
    : new Date();

  const { data: lifecycle, error: lcError } = await supabaseAdmin
    .from('claim_lifecycle')
    .insert({
      claim_id: claimId,
      ew_claim_id: ewClaimId,
      template_id: template.id,
      template_version_at_resolve: template.version,
      resolved_from: claimAttributes,
      current_phase: 1,
      firm_clock_start: intimationDate.toISOString(),
      insurer_clock_start: intimationDate.toISOString(),
    })
    .select()
    .single();
  if (lcError) throw new Error(`instantiateLifecycle/claim_lifecycle: ${lcError.message}`);

  // 4) Create 7 phase rows
  const phaseRows = UNIVERSAL_PHASES.map(p => ({
    claim_lifecycle_id: lifecycle.id,
    universal_phase: p.number,
    status: p.number === 1 ? 'active' : 'not_started',
    activated_at: p.number === 1 ? new Date().toISOString() : null,
  }));
  await supabaseAdmin.from('claim_lifecycle_phases').insert(phaseRows);

  // 5) Create stage rows
  const stageRows = stages.map(s => {
    // Compute due dates. TAT anchor 'intimation' = from intimation; 'previous_stage_complete'
    // is calculated at stage activation time, not at instantiation.
    let dueFirm = null, dueInsurer = null;
    if (s.firm_tat_hours != null && s.firm_tat_anchor === 'intimation') {
      dueFirm = new Date(intimationDate.getTime() + s.firm_tat_hours * 3600 * 1000).toISOString();
    }
    if (s.insurer_tat_hours != null && (s.insurer_tat_anchor === 'intimation' || !s.insurer_tat_anchor)) {
      dueInsurer = new Date(intimationDate.getTime() + s.insurer_tat_hours * 3600 * 1000).toISOString();
    }
    return {
      claim_lifecycle_id: lifecycle.id,
      template_stage_id: s.id,
      stage_code: s.stage_code,
      stage_name: s.stage_name,
      universal_phase: s.universal_phase,
      sequence_number: s.sequence_number,
      status: 'not_started',
      due_by_firm: dueFirm,
      due_by_insurer: dueInsurer,
    };
  });
  const { data: insertedStages } = await supabaseAdmin
    .from('claim_lifecycle_stages')
    .insert(stageRows)
    .select();

  // 6) Activate the first stage (by sequence_number)
  if (insertedStages && insertedStages.length) {
    const first = insertedStages.sort((a, b) => a.sequence_number - b.sequence_number)[0];
    await supabaseAdmin
      .from('claim_lifecycle_stages')
      .update({ status: 'active', activated_at: new Date().toISOString() })
      .eq('id', first.id);
  }

  // 7) Seed default Phase 4 items from template
  const { data: defaultItems } = await supabaseAdmin
    .from('lifecycle_template_default_items')
    .select('*, lifecycle_item_catalog(*)')
    .eq('template_id', template.id);

  if (defaultItems && defaultItems.length) {
    const itemRows = defaultItems.map(di => {
      const cat = di.lifecycle_item_catalog;
      return {
        claim_lifecycle_id: lifecycle.id,
        item_catalog_id: cat.id,
        item_name: cat.item_name,
        item_category: cat.category,
        pending_with: di.override_pending_with || cat.default_pending_with,
        firm_clock_behaviour: di.override_firm_clock || cat.firm_clock_behaviour,
        insurer_clock_behaviour: di.override_insurer_clock || cat.insurer_clock_behaviour,
        status: 'open',
        expected_by: null,
        reminder_schedule: cat.reminder_schedule_days,
        notes: di.notes,
        added_by_user: 'system',
      };
    });
    await supabaseAdmin.from('claim_lifecycle_items').insert(itemRows);
  }

  // 8) Also instantiate sub-tasks for any stages that have subtasks_active + defaults
  for (const s of stages) {
    if (!s.subtasks_active) continue;
    const { data: sts } = await supabaseAdmin
      .from('lifecycle_template_stage_subtasks')
      .select('*')
      .eq('stage_id', s.id)
      .eq('is_default', true)
      .eq('is_active', true);

    if (!sts || !sts.length) continue;

    const clsRow = insertedStages.find(x => x.template_stage_id === s.id);
    if (!clsRow) continue;

    const stRows = sts.map(t => ({
      claim_stage_id: clsRow.id,
      template_subtask_id: t.id,
      subtask_code: t.subtask_code,
      subtask_name: t.subtask_name,
      description: t.description,
      status: 'not_started',
      is_mandatory: t.is_mandatory,
    }));
    await supabaseAdmin.from('claim_lifecycle_subtasks').insert(stRows);
  }

  // 9) Audit event
  await logEvent(lifecycle.id, 'lifecycle_created', {
    entity_type: 'lifecycle',
    entity_id: lifecycle.id,
    event_payload: { template_code: template.template_code, stage_count: stageRows.length },
    actor_user: userEmail,
  });

  // 10) Roll up phases (the first phase's first stage is active → phase 1 = active)
  await rollupPhases(lifecycle.id);

  return lifecycle;
}

// =============================================================================
// 4. ADVANCE STAGE
// =============================================================================
// Called when a user marks a stage complete (or when the engine auto-completes).
// Handles branching, next-stage activation, phase roll-up, clock management.
// =============================================================================

async function advanceStage({ claimStageId, outcome = null, notes = null, userEmail }) {
  // 1) Load the stage row
  const { data: stage, error: sErr } = await supabaseAdmin
    .from('claim_lifecycle_stages')
    .select('*')
    .eq('id', claimStageId)
    .single();
  if (sErr || !stage) throw new Error(`advanceStage: stage not found (${claimStageId})`);

  if (stage.status === 'completed') {
    return { ok: true, already: true };
  }

  // 2) Load the template stage to see if branching is active
  const { data: tStage } = await supabaseAdmin
    .from('lifecycle_template_stages')
    .select('*')
    .eq('id', stage.template_stage_id)
    .single();

  // 3) If sub-tasks are active, verify completion rule is satisfied
  if (tStage?.subtasks_active) {
    const complete = await checkSubtaskCompletion(stage.id, tStage);
    if (!complete.ok) {
      throw new Error(`advanceStage: sub-tasks not complete (${complete.reason})`);
    }
  }

  // 4) Mark stage completed
  await supabaseAdmin
    .from('claim_lifecycle_stages')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by_user: userEmail,
      completion_notes: notes,
      branch_outcome: outcome,
    })
    .eq('id', claimStageId);

  // 5) Evaluate branching (if active)
  let branchDecision = null;
  if (tStage?.branching_active) {
    branchDecision = await evaluateBranches(tStage.id, outcome, stage.claim_lifecycle_id);
  }

  // 6) Determine the next stage to activate
  let nextStageRow;
  if (branchDecision && branchDecision.action_type === 'go_to_stage') {
    // Find the claim-stage-row matching the target stage_code
    const { data: target } = await supabaseAdmin
      .from('claim_lifecycle_stages')
      .select('*')
      .eq('claim_lifecycle_id', stage.claim_lifecycle_id)
      .eq('stage_code', branchDecision.action_target)
      .single();
    nextStageRow = target;
  } else if (branchDecision && branchDecision.action_type === 'end_lifecycle') {
    await completeLifecycle(stage.claim_lifecycle_id, userEmail, 'branch_end');
    return { ok: true, ended: true };
  } else {
    // Default: next stage by sequence_number
    const { data: next } = await supabaseAdmin
      .from('claim_lifecycle_stages')
      .select('*')
      .eq('claim_lifecycle_id', stage.claim_lifecycle_id)
      .eq('status', 'not_started')
      .order('sequence_number')
      .limit(1)
      .maybeSingle();
    nextStageRow = next;
  }

  // 7) Activate the next stage
  if (nextStageRow) {
    // Compute TATs for previous_stage_complete anchors
    const dueFirm = await computeDueDate(nextStageRow, 'firm');
    const dueInsurer = await computeDueDate(nextStageRow, 'insurer');
    await supabaseAdmin
      .from('claim_lifecycle_stages')
      .update({
        status: 'active',
        activated_at: new Date().toISOString(),
        due_by_firm: dueFirm,
        due_by_insurer: dueInsurer,
      })
      .eq('id', nextStageRow.id);
  }

  // 8) Log events
  await logEvent(stage.claim_lifecycle_id, 'stage_completed', {
    entity_type: 'stage',
    entity_id: claimStageId,
    event_payload: { stage_code: stage.stage_code, branch: branchDecision },
    actor_user: userEmail,
  });

  // 9) Roll up phases + check for lifecycle completion
  await rollupPhases(stage.claim_lifecycle_id);

  return { ok: true, next_stage: nextStageRow?.stage_code, branched: !!branchDecision };
}

// =============================================================================
// 5. EVALUATE BRANCHES
// =============================================================================
// Conditional branch evaluation. Runs configured branch rules for a stage in
// order; returns the first matching branch's action.
// =============================================================================

async function evaluateBranches(templateStageId, outcome, lifecycleId) {
  const { data: branches } = await supabaseAdmin
    .from('lifecycle_template_stage_branches')
    .select('*')
    .eq('stage_id', templateStageId)
    .eq('is_active', true)
    .order('evaluation_order');

  if (!branches || !branches.length) return null;

  // Load claim + lifecycle context for condition evaluation
  const { data: lifecycle } = await supabaseAdmin
    .from('claim_lifecycle').select('*, claims(*), ew_vehicle_claims(*)')
    .eq('id', lifecycleId).single();

  const context = {
    outcome,
    claim: lifecycle.claims || lifecycle.ew_vehicle_claims || {},
    lifecycle,
  };

  for (const b of branches) {
    if (evaluateCondition(b.condition_json, context)) {
      return b;
    }
  }
  return null;
}

function evaluateCondition(cond, context) {
  if (!cond) return false;

  if (cond.all) return cond.all.every(c => evaluateCondition(c, context));
  if (cond.any) return cond.any.some(c => evaluateCondition(c, context));

  if (!cond.field || !cond.operator) return false;
  const actual = resolvePath(cond.field, context);
  const expected = cond.value;

  switch (cond.operator) {
    case 'eq':   return actual == expected;
    case 'neq':  return actual != expected;
    case 'gt':   return parseFloat(actual) >  parseFloat(expected);
    case 'gte':  return parseFloat(actual) >= parseFloat(expected);
    case 'lt':   return parseFloat(actual) <  parseFloat(expected);
    case 'lte':  return parseFloat(actual) <= parseFloat(expected);
    case 'in':        return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':    return Array.isArray(expected) && !expected.includes(actual);
    case 'exists':    return actual !== null && actual !== undefined;
    case 'not_exists':return actual === null || actual === undefined;
    default: return false;
  }
}

function resolvePath(path, ctx) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
}

// =============================================================================
// 6. PHASE ROLL-UP
// =============================================================================
// Recomputes the state of each universal phase based on its constituent stages.
// Handles the auto-complete rule for phases with no detail stages.
// =============================================================================

async function rollupPhases(lifecycleId) {
  const { data: stages } = await supabaseAdmin
    .from('claim_lifecycle_stages')
    .select('*')
    .eq('claim_lifecycle_id', lifecycleId);

  const { data: phases } = await supabaseAdmin
    .from('claim_lifecycle_phases')
    .select('*')
    .eq('claim_lifecycle_id', lifecycleId);

  const { data: openItems } = await supabaseAdmin
    .from('claim_lifecycle_items')
    .select('id')
    .eq('claim_lifecycle_id', lifecycleId)
    .eq('status', 'open');

  const updates = [];
  let currentPhase = 1;
  let allComplete = true;

  for (const p of phases) {
    const stagesInPhase = stages.filter(s => s.universal_phase === p.universal_phase);

    let newStatus = p.status;
    let activatedAt = p.activated_at;
    let completedAt = p.completed_at;
    let isBlocking = false;

    if (stagesInPhase.length === 0) {
      // Phase has no detail stages — auto-complete logic
      // Rule: auto-complete when the prior phase (with stages, or if none, itself)
      //       is fully complete.
      const priorComplete = p.universal_phase === 1 ||
        phases.find(x => x.universal_phase === p.universal_phase - 1)?.status === 'complete' ||
        phases.find(x => x.universal_phase === p.universal_phase - 1)?.status === 'auto_complete';
      if (priorComplete && newStatus !== 'complete') {
        newStatus = 'auto_complete';
        if (!activatedAt) activatedAt = new Date().toISOString();
        completedAt = new Date().toISOString();
      }
    } else {
      const allDone = stagesInPhase.every(s => s.status === 'completed' || s.status === 'skipped');
      const anyActive = stagesInPhase.some(s => s.status === 'active');
      const anyStarted = stagesInPhase.some(s => s.status !== 'not_started');

      if (allDone) {
        newStatus = 'complete';
        if (!completedAt) completedAt = new Date().toISOString();
      } else if (anyActive || anyStarted) {
        newStatus = 'active';
        if (!activatedAt) activatedAt = new Date().toISOString();
      } else {
        newStatus = 'not_started';
      }
    }

    // Phase 4 is "blocking" if any pending items are open
    if (p.universal_phase === 4 && openItems && openItems.length > 0) {
      isBlocking = true;
      if (newStatus === 'complete' || newStatus === 'auto_complete') newStatus = 'active';
    }

    if (newStatus !== 'complete' && newStatus !== 'auto_complete') allComplete = false;
    if (newStatus === 'active') currentPhase = p.universal_phase;

    updates.push({
      id: p.id,
      status: newStatus,
      activated_at: activatedAt,
      completed_at: completedAt,
      is_blocking: isBlocking,
      updated_at: new Date().toISOString(),
    });
  }

  // Batch update
  for (const u of updates) {
    await supabaseAdmin.from('claim_lifecycle_phases').update(u).eq('id', u.id);
  }

  // Update lifecycle's current_phase
  await supabaseAdmin
    .from('claim_lifecycle')
    .update({
      current_phase: currentPhase,
      is_complete: allComplete,
      completed_at: allComplete ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lifecycleId);

  return { currentPhase, isComplete: allComplete };
}

// =============================================================================
// 7. PHASE 4 ITEM MANAGEMENT
// =============================================================================

async function openItem({ lifecycleId, itemCatalogId = null, customItem = null, pendingWith, pendingWithLabel, expectedBy, notes, userEmail }) {
  let itemSpec;
  if (itemCatalogId) {
    const { data: cat } = await supabaseAdmin
      .from('lifecycle_item_catalog').select('*').eq('id', itemCatalogId).single();
    itemSpec = {
      item_catalog_id: cat.id,
      item_name: cat.item_name,
      item_category: cat.category,
      firm_clock_behaviour: cat.firm_clock_behaviour,
      insurer_clock_behaviour: cat.insurer_clock_behaviour,
      reminder_schedule: cat.reminder_schedule_days,
    };
  } else if (customItem) {
    itemSpec = {
      item_name: customItem.name,
      item_category: customItem.category || 'other',
      firm_clock_behaviour: customItem.firm_clock || 'pause',
      insurer_clock_behaviour: customItem.insurer_clock || 'run',
    };
  } else {
    throw new Error('openItem: itemCatalogId or customItem required');
  }

  const { data: item } = await supabaseAdmin
    .from('claim_lifecycle_items')
    .insert({
      claim_lifecycle_id: lifecycleId,
      ...itemSpec,
      pending_with: pendingWith,
      pending_with_label: pendingWithLabel,
      status: 'open',
      expected_by: expectedBy,
      notes,
      added_by_user: userEmail,
    })
    .select().single();

  // Update clocks
  await updateClockState(lifecycleId);
  await logEvent(lifecycleId, 'item_opened', {
    entity_type: 'item', entity_id: item.id,
    event_payload: { name: itemSpec.item_name, pending_with: pendingWith },
    actor_user: userEmail,
  });
  await rollupPhases(lifecycleId);
  return item;
}

async function closeItem({ itemId, evidenceUrl, notes, userEmail }) {
  const { data: item } = await supabaseAdmin
    .from('claim_lifecycle_items').select('*').eq('id', itemId).single();
  if (!item) throw new Error(`closeItem: item not found (${itemId})`);

  await supabaseAdmin
    .from('claim_lifecycle_items')
    .update({
      status: 'received',
      closed_at: new Date().toISOString(),
      closure_evidence_url: evidenceUrl,
      closure_notes: notes,
    })
    .eq('id', itemId);

  await updateClockState(item.claim_lifecycle_id);
  await logEvent(item.claim_lifecycle_id, 'item_received', {
    entity_type: 'item', entity_id: itemId, actor_user: userEmail,
  });
  await rollupPhases(item.claim_lifecycle_id);
  return { ok: true };
}

// =============================================================================
// 8. CLOCK MANAGEMENT
// =============================================================================
// Decision rule:
//   - firm clock pauses if ANY open item has firm_clock_behaviour = 'pause'
//   - insurer clock pauses if ALL open items have insurer_clock_behaviour = 'pause'
//     (because insurer clock pause is rarer: only when insurer themselves block)
//   - if no open items, both clocks run
//
// This function is called on item open/close. Also called by clockTick().
// =============================================================================

async function updateClockState(lifecycleId) {
  const { data: lc } = await supabaseAdmin
    .from('claim_lifecycle').select('*').eq('id', lifecycleId).single();
  if (!lc) return;

  const { data: openItems } = await supabaseAdmin
    .from('claim_lifecycle_items')
    .select('firm_clock_behaviour, insurer_clock_behaviour')
    .eq('claim_lifecycle_id', lifecycleId)
    .eq('status', 'open');

  const now = new Date();

  // Accumulate elapsed time up to "now" (respecting current paused state)
  let firmElapsed = lc.firm_clock_elapsed_sec || 0;
  let insurerElapsed = lc.insurer_clock_elapsed_sec || 0;

  if (lc.firm_clock_paused_at == null && lc.firm_clock_start) {
    const since = new Date(lc.firm_clock_start).getTime();
    // Elapsed equals now - start minus accumulated-paused-time. For simplicity
    // we track elapsed_sec incrementally at each state change; here we just
    // compute the delta since last state change.
    firmElapsed = lc.firm_clock_elapsed_sec +
      Math.max(0, Math.floor((now - since) / 1000) - lc.firm_clock_elapsed_sec);
  }
  if (lc.insurer_clock_paused_at == null && lc.insurer_clock_start) {
    const since = new Date(lc.insurer_clock_start).getTime();
    insurerElapsed = lc.insurer_clock_elapsed_sec +
      Math.max(0, Math.floor((now - since) / 1000) - lc.insurer_clock_elapsed_sec);
  }

  // Determine desired paused state
  const firmShouldPause =
    (openItems || []).some(i => i.firm_clock_behaviour === 'pause');
  const insurerShouldPause =
    openItems && openItems.length > 0 &&
    openItems.every(i => i.insurer_clock_behaviour === 'pause');

  const updates = {
    firm_clock_elapsed_sec: firmElapsed,
    insurer_clock_elapsed_sec: insurerElapsed,
    firm_clock_paused_at:
      firmShouldPause
        ? (lc.firm_clock_paused_at || now.toISOString())
        : null,
    insurer_clock_paused_at:
      insurerShouldPause
        ? (lc.insurer_clock_paused_at || now.toISOString())
        : null,
    updated_at: now.toISOString(),
  };

  await supabaseAdmin.from('claim_lifecycle').update(updates).eq('id', lifecycleId);
}

// =============================================================================
// 9. RE-OPEN
// =============================================================================

async function reopenClaim({ lifecycleId, targetPhase, reason, userEmail }) {
  if (targetPhase < 1 || targetPhase > 7) throw new Error('reopenClaim: invalid targetPhase');

  const { data: lc } = await supabaseAdmin
    .from('claim_lifecycle').select('*').eq('id', lifecycleId).single();
  if (!lc) throw new Error('reopenClaim: lifecycle not found');

  await supabaseAdmin
    .from('claim_lifecycle')
    .update({
      is_complete: false,
      completed_at: null,
      current_phase: targetPhase,
      fsr_version: lc.fsr_version + 1,
      last_reopened_at: new Date().toISOString(),
      last_reopened_to_phase: targetPhase,
      last_reopened_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lifecycleId);

  // Reactivate the target phase's first incomplete stage
  const { data: targetStages } = await supabaseAdmin
    .from('claim_lifecycle_stages')
    .select('*')
    .eq('claim_lifecycle_id', lifecycleId)
    .eq('universal_phase', targetPhase)
    .order('sequence_number');

  if (targetStages && targetStages.length) {
    const last = targetStages[targetStages.length - 1];
    await supabaseAdmin
      .from('claim_lifecycle_stages')
      .update({ status: 'active', activated_at: new Date().toISOString(), completed_at: null })
      .eq('id', last.id);
  }

  // Reactivate the phase
  await supabaseAdmin
    .from('claim_lifecycle_phases')
    .update({ status: 'active', completed_at: null, activated_at: new Date().toISOString() })
    .eq('claim_lifecycle_id', lifecycleId)
    .eq('universal_phase', targetPhase);

  await logEvent(lifecycleId, 'reopened', {
    entity_type: 'lifecycle', entity_id: lifecycleId,
    event_payload: { target_phase: targetPhase, reason, new_fsr_version: lc.fsr_version + 1 },
    actor_user: userEmail,
  });

  await rollupPhases(lifecycleId);
  return { ok: true, new_fsr_version: lc.fsr_version + 1 };
}

// =============================================================================
// 10. HELPERS
// =============================================================================

async function computeDueDate(claimStage, clockType) {
  const { data: t } = await supabaseAdmin
    .from('lifecycle_template_stages')
    .select('*')
    .eq('id', claimStage.template_stage_id)
    .single();
  if (!t) return null;

  const tatHours = clockType === 'firm' ? t.firm_tat_hours : t.insurer_tat_hours;
  const anchor = clockType === 'firm' ? t.firm_tat_anchor : t.insurer_tat_anchor;
  if (tatHours == null) return null;

  let anchorTime;
  if (!anchor || anchor === 'previous_stage_complete') {
    anchorTime = new Date(); // stage activation == now
  } else if (anchor === 'intimation') {
    const { data: lc } = await supabaseAdmin
      .from('claim_lifecycle').select('firm_clock_start').eq('id', claimStage.claim_lifecycle_id).single();
    anchorTime = new Date(lc.firm_clock_start);
  } else if (anchor.startsWith('specific_stage:')) {
    const code = anchor.split(':')[1];
    const { data: prior } = await supabaseAdmin
      .from('claim_lifecycle_stages').select('completed_at')
      .eq('claim_lifecycle_id', claimStage.claim_lifecycle_id).eq('stage_code', code).single();
    anchorTime = prior?.completed_at ? new Date(prior.completed_at) : new Date();
  } else {
    anchorTime = new Date();
  }

  return new Date(anchorTime.getTime() + tatHours * 3600 * 1000).toISOString();
}

async function checkSubtaskCompletion(claimStageId, templateStage) {
  const { data: sts } = await supabaseAdmin
    .from('claim_lifecycle_subtasks')
    .select('status, is_mandatory')
    .eq('claim_stage_id', claimStageId);

  if (!sts || !sts.length) return { ok: true };

  const rule = templateStage.subtask_completion_rule || 'all';
  const completed = sts.filter(s => s.status === 'completed');
  const mandatoryOpen = sts.filter(s => s.is_mandatory && s.status !== 'completed');

  if (rule === 'all') {
    if (mandatoryOpen.length > 0) {
      return { ok: false, reason: `${mandatoryOpen.length} mandatory sub-tasks still open` };
    }
    return { ok: true };
  }
  if (rule === 'any') {
    return completed.length > 0 ? { ok: true } : { ok: false, reason: 'no sub-tasks completed' };
  }
  if (rule === 'count') {
    const min = templateStage.subtask_min_count || 1;
    return completed.length >= min ? { ok: true } : { ok: false, reason: `only ${completed.length}/${min} sub-tasks completed` };
  }
  return { ok: true };
}

async function completeLifecycle(lifecycleId, userEmail, reason) {
  await supabaseAdmin
    .from('claim_lifecycle')
    .update({ is_complete: true, completed_at: new Date().toISOString() })
    .eq('id', lifecycleId);
  await logEvent(lifecycleId, 'lifecycle_completed', {
    entity_type: 'lifecycle', entity_id: lifecycleId,
    event_payload: { reason },
    actor_user: userEmail,
  });
}

async function logEvent(lifecycleId, eventType, opts = {}) {
  await supabaseAdmin
    .from('claim_lifecycle_history')
    .insert({
      claim_lifecycle_id: lifecycleId,
      event_type: eventType,
      entity_type: opts.entity_type,
      entity_id: opts.entity_id,
      prior_state: opts.prior_state,
      new_state: opts.new_state,
      event_payload: opts.event_payload,
      actor_user: opts.actor_user,
      actor_type: opts.actor_type || 'user',
    });
}

// =============================================================================
// EXPORTS
// =============================================================================
module.exports = {
  resolveTemplate,
  materializeStages,
  instantiateLifecycle,
  advanceStage,
  evaluateBranches,
  evaluateCondition,
  rollupPhases,
  openItem,
  closeItem,
  updateClockState,
  reopenClaim,
  UNIVERSAL_PHASES,
};
