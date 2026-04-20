'use client';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

// =============================================================================
// Lifecycle Generator Engine — Feature Index / ReadMe
// =============================================================================
// Admin-only single page that catalogues every feature the engine exposes.
// Each feature card has a "Open" button that navigates to the feature's UI,
// and a "Preview / How it works" block that explains the feature.
//
// UPDATE PROTOCOL: When a new feature is added to the engine, append a new
// entry to the FEATURES array below. When a feature is renamed or moved,
// update the corresponding entry. The page reads from this single source of
// truth so there is nothing else to edit for documentation upkeep.
// =============================================================================

const LAST_UPDATED = '2026-04-20';

const FEATURES = [
  // ---------- Templates ----------
  {
    group: 'Templates',
    title: 'List all lifecycle templates',
    path: '/lifecycle-templates',
    summary: 'Browse every template in the system, filter by LOB or active status, activate/deactivate, create new, and open a template to edit its stages.',
    howToUse: [
      'Click "New Template" to create a template from scratch.',
      'Use the LOB filter to narrow down templates for a specific line of business.',
      'Click a template row\'s "Edit" button to manage its stages and metadata.',
      'Toggle "Active / Inactive" to control which templates are published to non-admin users.',
    ],
  },
  {
    group: 'Templates',
    title: 'Edit a template — metadata, stages, default items',
    path: '/lifecycle-templates', // navigates to list; user clicks into one
    note: '(open via the list)',
    summary: 'Inside a template you can edit match dimensions (LOB / portfolio / client / cause of loss / subject matter), feature toggles (branching, subtasks, time rules), add/remove stages per phase, and review default Phase-4 items.',
    howToUse: [
      'Match dimensions decide which claims are candidates for this template. Leave a field blank to mean "any value".',
      'Feature toggles are what gets PASSED ON to claim users — admin decides here.',
      'Stages are grouped by the 7 universal phases. Use the "+ Add stage" form at the bottom to add more.',
      'Click the red "Remove" button next to a stage to delete it from this template (live claims keep their snapshot).',
    ],
  },
  // ---------- Item Catalog ----------
  {
    group: 'Item Catalog',
    title: 'Phase-4 item master catalog',
    path: '/lifecycle-templates/items-catalog',
    summary: 'Master list of pending-requirement item types (job card, tax invoice, FIR, bank statement, etc.). Each item has clock-pause rules, the default party holding it, and reminder cadence.',
    howToUse: [
      '17 items are seeded at install: EW-specific (job card, warranty cert), Marine (commercial invoice, LR/BL, weighbridge slip), Fire (reinstatement evidence), fraud (FIR, bank statement), internal (FSR review).',
      'Create new items via "+ New Item" and pick their clock-pause behaviour (pause or run) per firm/insurer.',
      'Edit existing items to change defaults — existing claims keep the snapshot value at attach time.',
    ],
  },
  // ---------- Per-claim attach ----------
  {
    group: 'Per-claim Attach',
    title: 'Attach a lifecycle to an EXISTING claim',
    path: '/claim-lifecycle',
    note: '(open from any claim detail page)',
    summary: 'On any claim-lifecycle page, the yellow admin banner lets you attach a template. Optionally wipe the legacy stage data for that claim only.',
    howToUse: [
      'Open a claim: /claim-lifecycle/[id].',
      'If no lifecycle attached yet AND you are admin, a yellow banner appears with a template dropdown.',
      'Pick a template, optionally tick "Remove legacy stage data for THIS file only".',
      'Click "Attach lifecycle to this file" — engine creates phases, stages and Phase-4 items.',
      'Once attached, the banner turns green and the old workflow UI is hidden. Detach button on the right reverts it.',
    ],
  },
  {
    group: 'Per-claim Attach',
    title: 'Attach at registration time (new claims)',
    path: '/claim-registration',
    note: '(pick LOB, then use the form)',
    summary: 'Both the main claim registration form and the EW vehicle claim registration have a "Lifecycle Template" dropdown. The engine attaches the chosen template automatically after the claim is saved.',
    howToUse: [
      'Go to Claim Registration and pick the relevant LOB.',
      'Fill the claim form as usual.',
      'At the bottom, before "Upload Intimation Sheet", select a Lifecycle Template from the purple box (only shows active templates matching that LOB).',
      'Save the claim — the engine attaches automatically. Navigate to /claim-lifecycle/[id] to see the engine view.',
      'Leave the dropdown blank to register without a lifecycle (admin can attach later).',
    ],
  },
  // ---------- Bulk ----------
  {
    group: 'Bulk Operations',
    title: 'Bulk-attach a lifecycle to many claims',
    path: '/lifecycle-templates/bulk-attach',
    summary: 'Pick a template, filter/select multiple claims, optionally wipe legacy data for each, and apply in one go. Each claim is attached individually; failures don\'t block the rest.',
    howToUse: [
      'Source: choose "Main Claims" or "Extended Warranty".',
      'Filter by LOB / search box to narrow down candidates. Toggle "Only show claims without lifecycle" to hide already-attached ones.',
      'Tick individual rows or use "Select all visible".',
      'Pick the lifecycle template from the dropdown.',
      'Check "Remove legacy stage data for each selected file" if you want a clean cut.',
      'Click "Attach to N file(s)". Progress and per-file result log are shown at the bottom.',
    ],
  },
  // ---------- Advance & Reopen (backend only right now) ----------
  {
    group: 'Runtime (via APIs)',
    title: 'Advance a claim to the next stage',
    apiPath: 'POST /api/lifecycle/stage/[id]/advance',
    summary: 'Marks a stage completed and activates the next one. Automatically advances phases when the last stage in a phase completes. Evaluates branching rules if the stage has them enabled.',
    howToUse: [
      'This is currently backend-only (no UI button yet).',
      'Called from code / cURL / Postman with: POST /api/lifecycle/stage/<stage_id>/advance with body { completed_by_user, completion_notes? }.',
      'To add a UI button, we would extend the engine banner on /claim-lifecycle/[id].',
    ],
  },
  {
    group: 'Runtime (via APIs)',
    title: 'Re-open a completed claim',
    apiPath: 'POST /api/lifecycle/[lifecycle_id]/reopen',
    summary: 'Bumps the FSR version and sets the lifecycle back to a chosen phase. Use when a claim needs supplemental work after the FSR was finalised.',
    howToUse: [
      'POST /api/lifecycle/<id>/reopen with body { to_phase: 4, reason: "<text>", actor_user: "..." }.',
      'An entry is added to claim_lifecycle_history with event_type = "reopened".',
    ],
  },
  {
    group: 'Runtime (via APIs)',
    title: 'Open / close Phase-4 pending items',
    apiPath: 'POST/PUT /api/lifecycle/[lifecycle_id]/items',
    summary: 'Admin or surveyor can add ad-hoc items (outside the default checklist) and close them with evidence. Clock behaviour (pause/run) per item is inherited from the item catalog.',
    howToUse: [
      'Add item: POST /api/lifecycle/<id>/items with { item_catalog_id, pending_with, ... }.',
      'Close item: POST /api/lifecycle/items/<item_id>/close with { closure_notes, closure_evidence_url }.',
    ],
  },
  // ---------- Re-resolution ----------
  {
    group: 'Advanced',
    title: 'Re-resolve template when claim attributes change',
    apiPath: 'POST /api/lifecycle/reresolve/[id]',
    summary: 'If the claim\'s LOB / portfolio / client changes after the lifecycle is attached, re-run the resolver to see if a more specific template now matches. Doesn\'t destroy prior history.',
    howToUse: [
      'POST /api/lifecycle/reresolve/<lifecycle_id>.',
      'Engine picks the highest-priority template matching current claim attributes.',
      'New stages are added, removed stages are marked as "branched_away" rather than deleted.',
    ],
  },
  {
    group: 'Advanced',
    title: 'Dashboard roll-ups',
    apiPath: 'GET /api/lifecycle/dashboard',
    summary: 'Aggregate stats: how many claims per phase, how many with open items, TAT breaches, FSR versions in flight.',
    howToUse: [
      'GET /api/lifecycle/dashboard?company=NISLA',
      'Returns counts grouped by phase, LOB, and breach state. Used by dashboards we can build on top of it.',
    ],
  },
  // ---------- Schema views ----------
  {
    group: 'Schema & Data',
    title: 'Lifecycle overview view',
    viewName: 'v_claim_lifecycle_overview',
    summary: 'Pre-joined view combining claim_lifecycle + lifecycle_templates + open items/stages counts. Use for reporting.',
    howToUse: [
      'SELECT * FROM v_claim_lifecycle_overview WHERE current_phase = 4;',
      'Columns: lifecycle_id, claim_id, template_name, current_phase, open_items_count, pending_stages_count, firm_clock_elapsed_sec, ...',
    ],
  },
  {
    group: 'Schema & Data',
    title: 'TAT breaches view',
    viewName: 'v_claim_lifecycle_tat_breaches',
    summary: 'Rows for every claim × stage where firm_tat or insurer_tat has passed without completion.',
    howToUse: [
      'SELECT * FROM v_claim_lifecycle_tat_breaches WHERE firm_breached = TRUE ORDER BY due_by_firm;',
      'Feeds TAT-breach alerts and escalation dashboards.',
    ],
  },
];

// Group features by their "group" field for rendering
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'Other';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

export default function LifecycleEngineReadMe() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';

  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <h2>Lifecycle Engine — Features</h2>
          <p style={{ padding: 40, textAlign: 'center', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>
            Admin access required. The feature index is only visible to administrators.
          </p>
        </div>
      </PageLayout>
    );
  }

  const grouped = groupBy(FEATURES, 'group');

  return (
    <PageLayout>
      <div className="main-content">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <button className="secondary" style={{ fontSize: 12 }} onClick={() => router.push('/lifecycle-templates')}>&larr; Templates</button>
          <h2 style={{ margin: 0 }}>
            Lifecycle Engine — Features &amp; How-To
            <span style={{ fontSize: 11, background: '#7c3aed', color: '#fff', padding: '2px 8px', borderRadius: 10, marginLeft: 8, verticalAlign: 'middle' }}>ADMIN</span>
          </h2>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
          Single source of truth for what the Lifecycle Generator can do. Each card links to its feature in the portal or documents an API endpoint.
          &nbsp;·&nbsp;<b>Last updated:</b> {LAST_UPDATED}
        </p>

        <div style={{ marginTop: 20, padding: 12, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, fontSize: 12, color: '#3730a3' }}>
          <b>Update protocol:</b> When a new feature ships on the engine, edit <code>app/lifecycle-templates/features/page.js</code> and append an entry to the <code>FEATURES</code> array. Update <code>LAST_UPDATED</code>. Commit and push — this page will reflect the change immediately on next deploy.
        </div>

        {/* Quick navigation */}
        <div style={{ marginTop: 20, padding: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>Jump to:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.keys(grouped).map(g => (
              <a key={g} href={`#group-${g.replace(/\s+/g, '-')}`} style={{
                fontSize: 11, padding: '4px 10px', background: '#ede9fe',
                color: '#5b21b6', borderRadius: 10, textDecoration: 'none',
              }}>
                {g} ({grouped[g].length})
              </a>
            ))}
          </div>
        </div>

        {/* Feature groups */}
        {Object.entries(grouped).map(([groupName, items]) => (
          <div key={groupName} id={`group-${groupName.replace(/\s+/g, '-')}`} style={{ marginTop: 28 }}>
            <h3 style={{ marginBottom: 12, color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: 6 }}>
              {groupName}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
              {items.map((f, i) => (
                <div key={i} style={{
                  padding: 14,
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>{f.title}</div>
                    {f.path && (
                      <button
                        className="success"
                        style={{ fontSize: 10, padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
                        onClick={() => router.push(f.path)}
                      >
                        Open &rarr;
                      </button>
                    )}
                  </div>

                  {f.path && (
                    <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#7c3aed' }}>
                      {f.path} {f.note && <span style={{ color: '#94a3b8' }}>{f.note}</span>}
                    </div>
                  )}
                  {f.apiPath && (
                    <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#dc2626' }}>
                      API: {f.apiPath}
                    </div>
                  )}
                  {f.viewName && (
                    <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#059669' }}>
                      View: {f.viewName}
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
                    {f.summary}
                  </div>

                  {f.howToUse && f.howToUse.length > 0 && (
                    <details style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#475569' }}>How to use</summary>
                      <ul style={{ margin: '6px 0 0 16px', padding: 0, lineHeight: 1.6 }}>
                        {f.howToUse.map((h, hi) => (
                          <li key={hi}>{h}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Glossary */}
        <div style={{ marginTop: 40 }}>
          <h3 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: 6, color: '#334155' }}>Glossary</h3>
          <dl style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '8px 16px', fontSize: 12, marginTop: 12 }}>
            <dt style={{ fontWeight: 600, color: '#475569' }}>Template</dt>
            <dd style={{ margin: 0 }}>Reusable definition of a claim lifecycle — picks phases, stages, TATs, default Phase-4 items.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Active (Published)</dt>
            <dd style={{ margin: 0 }}>Whether this template is available for the engine to assign. Inactive templates cannot be picked at registration or via bulk-attach. Existing claims using an inactive template are unaffected.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Resolution type</dt>
            <dd style={{ margin: 0 }}><b>full_list</b> = template supplies all stages by itself; <b>override</b> = applies add/replace/remove deltas on top of a parent template.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Match dimensions</dt>
            <dd style={{ margin: 0 }}>LOB / policy type / portfolio / client / etc. — the engine picks the template whose match fields best fit a claim. Empty = any value matches.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Priority</dt>
            <dd style={{ margin: 0 }}>Tie-breaker when multiple templates match equally specifically. Higher wins.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Feature toggles</dt>
            <dd style={{ margin: 0 }}>Per-template opt-ins: <b>branching rules</b>, <b>sub-tasks per stage</b>, <b>time-based validity</b>. Admin decides which of these non-admin claim users can see.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Universal phases</dt>
            <dd style={{ margin: 0 }}>The 7 anchor phases every lifecycle has: 1) Appointment, 2) Survey &amp; Inspection, 3) ILA &amp; LOR, 4) Pending Requirements, 5) Assessment, 6) Report, 7) Delivery.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Detail stage</dt>
            <dd style={{ margin: 0 }}>A concrete step within a phase (e.g. "Initial inspection", "Dismantling approval gate"). Phases with no detail stages auto-complete.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Sub-task</dt>
            <dd style={{ margin: 0 }}>Optional parallel items within a stage. Enabled only if the template has <code>subtasks_enabled</code>.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Phase-4 item</dt>
            <dd style={{ margin: 0 }}>A pending requirement (e.g. "Job card", "FIR copy"). Each has a clock-pause rule per firm/insurer SLA.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Clock pause / run</dt>
            <dd style={{ margin: 0 }}><b>pause</b> = SLA clock stops while item is open; <b>run</b> = clock keeps ticking. Pause is typically used when we're waiting on the insured.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>TAT</dt>
            <dd style={{ margin: 0 }}>Turn-around time for a stage, separately tracked for the firm (NISLA) and the insurer.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Legacy workflow</dt>
            <dd style={{ margin: 0 }}>The pre-engine system — 22-stage claim_workflow table. Still readable but all writes are now blocked; claims must migrate to the engine to be edited.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Attach</dt>
            <dd style={{ margin: 0 }}>Binding a template to a specific claim file, which creates the <code>claim_lifecycle</code> row and materialises all phases, stages, and default items.</dd>

            <dt style={{ fontWeight: 600, color: '#475569' }}>Re-resolve</dt>
            <dd style={{ margin: 0 }}>Re-run the template chooser against the claim\'s current attributes. Useful when the claim\'s portfolio or client is updated after attach.</dd>
          </dl>
        </div>
      </div>
    </PageLayout>
  );
}
