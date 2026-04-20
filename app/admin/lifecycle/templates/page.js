'use client';
// =============================================================================
// /admin/lifecycle/templates — Template Library
// =============================================================================
// Master-detail layout merged from both mockups:
//   LEFT  : Template tree (parent → children) with dim-chips, status & type badges
//   RIGHT : 5-tab editor
//     1. Metadata      — identity, parent, priority, status (v1+v2)
//     2. Matching      — 9-dimension matcher (v1+v2)
//     3. Stages        — table of stages with phase, owner, TATs, auto-skip (v1+v2)
//     4. Default items — Phase-4 checklist (v1+v2)
//     5. TATs & Artifacts — TAT config + completion artifacts (v1)
//     6. Advanced      — branching/subtasks/time-rules feature toggles (v2)
//   plus modals for new template, new stage
// No simplification — every button/column from the mockups is present.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LifecycleAdminShell, {
  Card, Note, Badge, Modal, FormGrid, FG, Btn,
} from '@/components/LifecycleAdminShell';
import { LOB_LIST } from '@/lib/constants';

const PHASE_NAMES = {
  1: 'Appointment', 2: 'Survey & Inspection', 3: 'ILA & LOR',
  4: 'Pending Requirements', 5: 'Assessment', 6: 'Report', 7: 'Delivery',
};

export default function TemplateLibraryPage() {
  const router = useRouter();
  const search = useSearchParams();
  const initialId = search.get('id');

  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState(initialId ? parseInt(initialId, 10) : null);
  const [selected, setSelected] = useState(null);
  const [stages, setStages] = useState([]);
  const [items, setItems] = useState([]);       // Catalog items (for default-item picker)
  const [defaultItems, setDefaultItems] = useState([]);
  const [tab, setTab] = useState('meta');
  const [loading, setLoading] = useState(true);
  const [savingMeta, setSavingMeta] = useState(false);
  const [showNewTpl, setShowNewTpl] = useState(false);
  const [showNewStage, setShowNewStage] = useState(false);
  const [message, setMessage] = useState(null);

  // Meta edit buffer
  const [meta, setMeta] = useState({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tR, iR] = await Promise.all([
        fetch('/api/lifecycle/templates').then(r => r.json()),
        fetch('/api/lifecycle/items/catalog').then(r => r.json()),
      ]);
      setTemplates(tR.templates || []);
      setItems(iR.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!selectedId) { setSelected(null); setStages([]); setDefaultItems([]); return; }
    (async () => {
      const tpl = templates.find(t => t.id === selectedId);
      setSelected(tpl || null);
      setMeta(tpl || {});
      const [sR, dR] = await Promise.all([
        fetch(`/api/lifecycle/templates/${selectedId}/stages`).then(r => r.json()).catch(() => ({ stages: [] })),
        // Default items endpoint may not exist; fall back to []
        fetch(`/api/lifecycle/templates/${selectedId}/default-items`)
          .then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
      ]);
      setStages(sR.stages || []);
      setDefaultItems(dR.items || []);
    })();
  }, [selectedId, templates]);

  const saveMeta = async () => {
    setSavingMeta(true);
    setMessage(null);
    try {
      const res = await fetch('/api/lifecycle/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedId,
          ...meta,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setMessage({ tone: 'success', text: 'Template saved' });
      await reload();
    } catch (e) {
      setMessage({ tone: 'danger', text: String(e.message || e) });
    } finally {
      setSavingMeta(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selected) return;
    if (!confirm(`Delete template "${selected.template_name}"?\n\nThis will fail if any claims still use it — use Deactivate instead.`)) return;
    try {
      const res = await fetch(`/api/lifecycle/templates?id=${selectedId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      setMessage({ tone: 'success', text: 'Template deleted' });
      setSelectedId(null);
      await reload();
    } catch (e) {
      setMessage({ tone: 'danger', text: String(e.message || e) });
    }
  };

  const toggleActive = async () => {
    if (!selected) return;
    await fetch('/api/lifecycle/templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedId, is_active: !selected.is_active }),
    });
    await reload();
  };

  const buildTree = () => {
    const byId = Object.fromEntries(templates.map(t => [t.id, t]));
    const roots = templates.filter(t => !t.parent_template_id);
    const children = (pid) => templates.filter(t => t.parent_template_id === pid);
    return { roots, children, byId };
  };
  const tree = buildTree();

  return (
    <LifecycleAdminShell
      view="templates"
      title="Template Library"
      subtitle="Every lifecycle variant is a template row. Add, edit, clone, deactivate without code."
      stats={{ templates: templates.length }}
      actions={
        <>
          <Btn onClick={() => router.push('/admin/lifecycle/resolver')}>Resolution Debugger</Btn>
          <Btn variant="primary" onClick={() => setShowNewTpl(true)}>+ New Template</Btn>
        </>
      }
    >
      {loading && <Note tone="info">Loading templates…</Note>}
      {message && <Note tone={message.tone}>{message.text}</Note>}

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 14 }}>
        {/* LEFT — tree */}
        <Card title={`Templates (${templates.length})`} subtitle="Click to open editor">
          {tree.roots.length === 0 && !loading && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              No templates yet. Create one with the <strong>+ New Template</strong> button above.
            </div>
          )}
          {tree.roots.map(t => (
            <TemplateNode
              key={t.id}
              tpl={t}
              depth={0}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              childrenOf={tree.children}
            />
          ))}
        </Card>

        {/* RIGHT — editor (or empty state) */}
        {!selected ? (
          <Card>
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>
                Select a template from the left to edit
              </div>
              <div style={{ fontSize: 12, marginTop: 6 }}>
                Or click <strong>+ New Template</strong> to create one.
              </div>
            </div>
          </Card>
        ) : (
          <div>
            {/* Template header + action bar */}
            <Card
              title={selected.template_name}
              subtitle={
                <>
                  <Badge tone={selected.resolution_type === 'override' ? 'override' : 'full'}>
                    {selected.resolution_type === 'override' ? 'Override' : 'Full list'}
                  </Badge>
                  <Badge tone={selected.is_active ? 'complete' : 'skipped'}>
                    {selected.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <span style={{ marginLeft: 6, fontSize: 11.5, color: '#6b7280' }}>
                    Code: <code style={{ fontFamily: 'monospace' }}>{selected.template_code}</code> ·
                    Priority {selected.priority} ·
                    v{selected.version || 1} ·
                    {' '}{stages.length} stage{stages.length !== 1 ? 's' : ''}
                  </span>
                </>
              }
              actions={
                <>
                  <Btn size="sm" onClick={toggleActive}>
                    {selected.is_active ? 'Deactivate' : 'Reactivate'}
                  </Btn>
                  <Btn size="sm">Clone</Btn>
                  <Btn size="sm" variant="danger" onClick={deleteTemplate}>Delete</Btn>
                </>
              }
            >
              {/* Tab strip */}
              <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid #e5e7eb', marginBottom: 16, flexWrap: 'wrap' }}>
                {[
                  ['meta',      '1. Metadata'],
                  ['match',     '2. Matching'],
                  ['stages',    `3. Stages (${stages.length})`],
                  ['items',     `4. Default items (${defaultItems.length})`],
                  ['tats',      '5. TATs & Artifacts'],
                  ['advanced',  '6. Advanced'],
                ].map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    style={{
                      padding: '8px 13px', background: 'transparent', border: 'none',
                      borderBottom: '2px solid ' + (tab === k ? '#4B0082' : 'transparent'),
                      color: tab === k ? '#4B0082' : '#6b7280',
                      fontWeight: tab === k ? 700 : 500, fontSize: 12.5, cursor: 'pointer',
                      marginBottom: -2,
                    }}
                  >{l}</button>
                ))}
              </div>

              {/* Tab 1 — Metadata */}
              {tab === 'meta' && (
                <FormGrid>
                  <FG label="Template name">
                    <input value={meta.template_name || ''}
                      onChange={e => setMeta({ ...meta, template_name: e.target.value })}
                      style={inp} />
                  </FG>
                  <FG label="Template code" hint="UPPER_SNAKE. Immutable after creation is safest.">
                    <input value={meta.template_code || ''} disabled
                      style={{ ...inp, background: '#f3f4f6', color: '#6b7280' }} />
                  </FG>
                  <FG label="Description">
                    <textarea rows={3} value={meta.description || ''}
                      onChange={e => setMeta({ ...meta, description: e.target.value })}
                      style={{ ...inp, fontFamily: 'inherit' }} />
                  </FG>
                  <FG label="Resolution type">
                    <select value={meta.resolution_type || 'full_list'}
                      onChange={e => setMeta({ ...meta, resolution_type: e.target.value })}
                      style={inp}>
                      <option value="full_list">Full list (replaces parent)</option>
                      <option value="override">Override (deltas applied to parent)</option>
                    </select>
                  </FG>
                  <FG label="Parent template" hint="Only used when type is Override.">
                    <select value={meta.parent_template_id || ''}
                      onChange={e => setMeta({ ...meta, parent_template_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                      style={inp}>
                      <option value="">(none — this is a base template)</option>
                      {templates.filter(t => t.id !== selectedId && t.resolution_type === 'full_list').map(t => (
                        <option key={t.id} value={t.id}>{t.template_name} ({t.template_code})</option>
                      ))}
                    </select>
                  </FG>
                  <FG label="Priority" hint="Higher = preferred when several templates match. Default 100.">
                    <input type="number" value={meta.priority ?? 100}
                      onChange={e => setMeta({ ...meta, priority: parseInt(e.target.value, 10) })}
                      style={inp} />
                  </FG>
                  <FG label="Status">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={!!meta.is_active}
                        onChange={e => setMeta({ ...meta, is_active: e.target.checked })} />
                      Active (applied to new claims when matching)
                    </label>
                  </FG>
                </FormGrid>
              )}

              {/* Tab 2 — Matching */}
              {tab === 'match' && (
                <>
                  <Note tone="info">
                    A template applies to a claim when <strong>all</strong> filled-in dimensions match.
                    Leave a field blank to mean "(any)". More-specific templates (more dimensions filled)
                    win over less-specific ones.
                  </Note>
                  <FormGrid>
                    <FG label="LOB">
                      <select value={meta.match_lob || ''}
                        onChange={e => setMeta({ ...meta, match_lob: e.target.value || null })} style={inp}>
                        <option value="">(any)</option>
                        {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </FG>
                    <FG label="Policy type">
                      <input value={meta.match_policy_type || ''}
                        onChange={e => setMeta({ ...meta, match_policy_type: e.target.value || null })} style={inp} placeholder="(any)" />
                    </FG>
                    <FG label="Cause of loss">
                      <input value={meta.match_cause_of_loss || ''}
                        onChange={e => setMeta({ ...meta, match_cause_of_loss: e.target.value || null })} style={inp} placeholder="(any)" />
                    </FG>
                    <FG label="Subject matter">
                      <input value={meta.match_subject_matter || ''}
                        onChange={e => setMeta({ ...meta, match_subject_matter: e.target.value || null })} style={inp} placeholder="(any — Building/Stock/Plant...)" />
                    </FG>
                    <FG label="Portfolio / OEM">
                      <input value={meta.match_portfolio || ''}
                        onChange={e => setMeta({ ...meta, match_portfolio: e.target.value || null })} style={inp} placeholder="(any — e.g., Toyota TW)" />
                    </FG>
                    <FG label="Client / Insured">
                      <input value={meta.match_client || ''}
                        onChange={e => setMeta({ ...meta, match_client: e.target.value || null })} style={inp} placeholder="(any — e.g., UltraTech)" />
                    </FG>
                    <FG label="Size band">
                      <select value={meta.match_size_band || ''}
                        onChange={e => setMeta({ ...meta, match_size_band: e.target.value || null })} style={inp}>
                        <option value="">(any)</option>
                        <option>Small</option><option>Medium</option><option>Large</option><option>Jumbo</option>
                      </select>
                    </FG>
                    <FG label="Nature">
                      <select value={meta.match_nature || ''}
                        onChange={e => setMeta({ ...meta, match_nature: e.target.value || null })} style={inp}>
                        <option value="">(any)</option>
                        <option>Routine</option><option>Complex</option><option>CAT-event</option>
                      </select>
                    </FG>
                    <FG label="Appointment source">
                      <select value={meta.match_appointment_src || ''}
                        onChange={e => setMeta({ ...meta, match_appointment_src: e.target.value || null })} style={inp}>
                        <option value="">(any)</option>
                        <option>Insurer-direct</option><option>Broker</option><option>Insured</option>
                      </select>
                    </FG>
                  </FormGrid>
                  <DimPreview meta={meta} />
                </>
              )}

              {/* Tab 3 — Stages */}
              {tab === 'stages' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {stages.length} stage{stages.length !== 1 ? 's' : ''} spanning{' '}
                      {new Set(stages.map(s => s.universal_phase)).size} of 7 universal phases.
                      Phases with no stage auto-complete silently.
                    </div>
                    <Btn size="sm" variant="primary" onClick={() => setShowNewStage(true)}>+ Add stage</Btn>
                  </div>
                  {stages.length === 0 ? (
                    <Note tone="warn">This template has no stages yet. Add at least one so the engine has something to run.</Note>
                  ) : (
                    <table style={tbl}>
                      <thead>
                        <tr style={tHeadRow}>
                          <th style={th}>⋮⋮</th>
                          <th style={th}>#</th>
                          <th style={th}>Stage name</th>
                          <th style={th}>Universal phase</th>
                          <th style={th}>Owner role</th>
                          <th style={th}>Firm TAT</th>
                          <th style={th}>Insurer TAT</th>
                          <th style={th}>Anchor</th>
                          <th style={th}>Auto-skip if</th>
                          <th style={th}>Branch</th>
                          <th style={th}>Subtasks</th>
                          <th style={th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stages.map(s => (
                          <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={td}>⋮⋮</td>
                            <td style={td}>{s.sequence_number}.{s.sequence_within_phase || 1}</td>
                            <td style={td}>
                              <div style={{ fontWeight: 600 }}>{s.stage_name}</div>
                              {s.delta_operation && s.delta_operation !== 'add' && (
                                <Badge tone="override">{s.delta_operation}</Badge>
                              )}
                              {s.description && (
                                <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 2 }}>{s.description}</div>
                              )}
                            </td>
                            <td style={td}>
                              <Badge tone="lob">{s.universal_phase}. {PHASE_NAMES[s.universal_phase]}</Badge>
                            </td>
                            <td style={td}>{s.owner_role || '—'}</td>
                            <td style={td}>{s.firm_tat_hours ? `${s.firm_tat_hours}h` : '—'}</td>
                            <td style={td}>{s.insurer_tat_hours ? `${s.insurer_tat_hours}h` : '—'}</td>
                            <td style={td}>{s.firm_tat_anchor || '—'}</td>
                            <td style={td}>{s.is_skippable ? (s.skip_condition || 'yes') : '—'}</td>
                            <td style={td}>{s.branching_active ? <Badge tone="override">Yes</Badge> : '—'}</td>
                            <td style={td}>{s.subtasks_active ? <Badge tone="lob">Yes</Badge> : '—'}</td>
                            <td style={td}>
                              <Btn size="xs">Edit</Btn>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* Tab 4 — Default items */}
              {tab === 'items' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      These items auto-add to Phase-4 pending checklist for claims matching this template. Surveyors can still add extras or remove ones not applicable.
                    </div>
                    <Btn size="sm" variant="primary">+ Add default item</Btn>
                  </div>
                  {defaultItems.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: '#6b7280', padding: 12, background: '#f9fafb', borderRadius: 6 }}>
                      No default items configured for this template. Items in the{' '}
                      <a href="/admin/lifecycle/items" style={{ color: '#4B0082' }}>Item Catalog</a>
                      {' '}can be attached here.
                    </div>
                  ) : (
                    <table style={tbl}>
                      <thead>
                        <tr style={tHeadRow}>
                          <th style={th}>Item</th>
                          <th style={th}>Category</th>
                          <th style={th}>Pending with</th>
                          <th style={th}>Auto-add when</th>
                          <th style={th}>Firm clock</th>
                          <th style={th}>Insurer clock</th>
                          <th style={th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {defaultItems.map(di => {
                          const cat = items.find(i => i.id === di.item_catalog_id) || {};
                          return (
                            <tr key={di.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={td}><strong>{cat.item_name || di.item_catalog_id}</strong></td>
                              <td style={td}>{cat.category || '—'}</td>
                              <td style={td}>{di.pending_with || cat.default_pending_with || '—'}</td>
                              <td style={td}>{di.auto_add_trigger || '—'}</td>
                              <td style={td}>{cat.firm_clock_behaviour === 'pause' ? 'Paused' : 'Running'}</td>
                              <td style={td}>{cat.insurer_clock_behaviour === 'pause' ? 'Paused' : 'Running'}</td>
                              <td style={td}><Btn size="xs">Edit</Btn> <Btn size="xs" variant="danger">Remove</Btn></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* Tab 5 — TATs & Artifacts */}
              {tab === 'tats' && (
                <>
                  <Card title="Turnaround times (per stage)" subtitle="Firm-side and insurer-facing TATs. Anchor controls when the clock starts.">
                    <table style={tbl}>
                      <thead>
                        <tr style={tHeadRow}>
                          <th style={th}>Stage</th>
                          <th style={th}>Firm TAT</th>
                          <th style={th}>Insurer TAT</th>
                          <th style={th}>Firm anchor</th>
                          <th style={th}>Insurer anchor</th>
                          <th style={th}>IRDAI?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stages.map(s => (
                          <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={td}>
                              <strong>{s.sequence_number}.{s.sequence_within_phase || 1}</strong> {s.stage_name}
                            </td>
                            <td style={td}>{s.firm_tat_hours ? `${s.firm_tat_hours}h` : 'Immediate'}</td>
                            <td style={td}>{s.insurer_tat_hours ? `${s.insurer_tat_hours}h` : 'Immediate'}</td>
                            <td style={td}>{s.firm_tat_anchor || '—'}</td>
                            <td style={td}>{s.insurer_tat_anchor || '—'}</td>
                            <td style={td}>{s.is_irdai_mandated ? <Badge tone="override">IRDAI</Badge> : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                  <Card title="Required completion artifacts" subtitle="Evidence that must be present on the claim before a stage can be marked Complete.">
                    <table style={tbl}>
                      <thead>
                        <tr style={tHeadRow}>
                          <th style={th}>Stage</th>
                          <th style={th}>Required artifacts</th>
                          <th style={th}>Block completion?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stages.map(s => {
                          const arts = s.required_artifacts || [];
                          return (
                            <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={td}><strong>{s.sequence_number}.{s.sequence_within_phase || 1}</strong> {s.stage_name}</td>
                              <td style={td}>
                                {Array.isArray(arts) && arts.length ? (
                                  <ul style={{ margin: 0, paddingLeft: 14 }}>
                                    {arts.map((a, idx) => <li key={idx} style={{ fontSize: 12 }}>{a}</li>)}
                                  </ul>
                                ) : '—'}
                              </td>
                              <td style={td}>{s.blocks_completion !== false ? <Badge tone="breached">Hard block</Badge> : <Badge tone="neutral">Soft</Badge>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Card>
                </>
              )}

              {/* Tab 6 — Advanced feature toggles (v2) */}
              {tab === 'advanced' && (
                <>
                  <Note tone="info">
                    Advanced engine features — turn on only if this lifecycle genuinely needs them.
                    Leaving them off keeps the template simple and fast.
                  </Note>
                  <FormGrid>
                    <FG label="Branching enabled" hint="Stages in this template can have outcome-based branches (e.g., 'if approved → 4.1 else → 4.1b').">
                      <label style={chkWrap}>
                        <input type="checkbox" checked={!!meta.branching_enabled}
                          onChange={e => setMeta({ ...meta, branching_enabled: e.target.checked })} />
                        Use Branching Rules editor
                      </label>
                    </FG>
                    <FG label="Subtasks enabled" hint="Stages can require completion of individual sub-tasks before being marked complete.">
                      <label style={chkWrap}>
                        <input type="checkbox" checked={!!meta.subtasks_enabled}
                          onChange={e => setMeta({ ...meta, subtasks_enabled: e.target.checked })} />
                        Use Sub-task Editor
                      </label>
                    </FG>
                    <FG label="Time rules enabled" hint="Stages can have time-based re-resolution rules (e.g., promote to CAT-event template if open >14 days).">
                      <label style={chkWrap}>
                        <input type="checkbox" checked={!!meta.time_rules_enabled}
                          onChange={e => setMeta({ ...meta, time_rules_enabled: e.target.checked })} />
                        Use Time-Based Rules
                      </label>
                    </FG>
                  </FormGrid>
                </>
              )}

              {/* Save bar */}
              <div style={{
                position: 'sticky', bottom: 0, background: '#fff',
                padding: '12px 0', borderTop: '1px solid #e5e7eb',
                marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8,
              }}>
                <Btn onClick={() => setMeta(selected)}>Reset</Btn>
                <Btn variant="primary" onClick={saveMeta} disabled={savingMeta}>
                  {savingMeta ? 'Saving…' : 'Save Template'}
                </Btn>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* New template modal */}
      <NewTemplateModal
        open={showNewTpl}
        onClose={() => setShowNewTpl(false)}
        templates={templates}
        onCreated={(id) => { setShowNewTpl(false); reload(); setSelectedId(id); }}
      />

      {/* New stage modal */}
      <NewStageModal
        open={showNewStage}
        onClose={() => setShowNewStage(false)}
        templateId={selectedId}
        existingStages={stages}
        onCreated={async () => {
          setShowNewStage(false);
          if (selectedId) {
            const sR = await fetch(`/api/lifecycle/templates/${selectedId}/stages`).then(r => r.json());
            setStages(sR.stages || []);
          }
        }}
      />
    </LifecycleAdminShell>
  );
}

// --- tree node ------------------------------------------------------------
function TemplateNode({ tpl, depth, selectedId, setSelectedId, childrenOf }) {
  const children = childrenOf(tpl.id);
  const active = tpl.id === selectedId;
  return (
    <>
      <div
        onClick={() => setSelectedId(tpl.id)}
        style={{
          paddingLeft: 8 + depth * 16,
          paddingRight: 8, paddingTop: 7, paddingBottom: 7,
          borderRadius: 6, cursor: 'pointer',
          background: active ? '#ede9fe' : 'transparent',
          borderLeft: active ? '3px solid #4B0082' : '3px solid transparent',
          marginBottom: 2,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: active ? 700 : 600,
                      color: active ? '#4B0082' : '#111827' }}>
          {depth > 0 && '↳ '}{tpl.template_name}
        </div>
        <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          <Badge tone={tpl.resolution_type === 'override' ? 'override' : 'full'}>
            {tpl.resolution_type === 'override' ? 'Override' : 'Full'}
          </Badge>
          {tpl.match_lob && <Badge tone="lob">{tpl.match_lob}</Badge>}
          {tpl.match_portfolio && <Badge tone="portfolio">{tpl.match_portfolio}</Badge>}
          {tpl.match_client && <Badge tone="client">{tpl.match_client}</Badge>}
          {!tpl.is_active && <Badge tone="skipped">Inactive</Badge>}
        </div>
      </div>
      {children.map(c => (
        <TemplateNode key={c.id} tpl={c} depth={depth + 1}
          selectedId={selectedId} setSelectedId={setSelectedId} childrenOf={childrenOf} />
      ))}
    </>
  );
}

function DimPreview({ meta }) {
  const dims = [
    ['LOB', meta.match_lob], ['Policy type', meta.match_policy_type],
    ['Cause', meta.match_cause_of_loss], ['Subject', meta.match_subject_matter],
    ['Portfolio', meta.match_portfolio], ['Client', meta.match_client],
    ['Size', meta.match_size_band], ['Nature', meta.match_nature],
    ['Appointment src', meta.match_appointment_src],
  ];
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6,
                  padding: 12, fontSize: 12, marginTop: 10 }}>
      <strong style={{ color: '#374151' }}>Will match claims where:</strong>
      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {dims.filter(([, v]) => !!v).length === 0
          ? <em style={{ color: '#9ca3af' }}>every claim (no dimensions specified)</em>
          : dims.filter(([, v]) => !!v).map(([k, v]) => (
              <Badge key={k} tone="lob">{k} = {v}</Badge>
            ))}
      </div>
    </div>
  );
}

// --- new-template modal ----------------------------------------------------
function NewTemplateModal({ open, onClose, templates, onCreated }) {
  const [form, setForm] = useState({
    template_code: '', template_name: '', description: '',
    resolution_type: 'full_list', parent_template_id: null,
    match_lob: '', priority: 100, is_active: true,
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/lifecycle/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Create failed');
      onCreated(json.template.id);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="New Template"
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create'}</Btn>
      </>}
    >
      {err && <Note tone="danger">{err}</Note>}
      <FormGrid>
        <FG label="Code" hint="UPPER_SNAKE unique code, e.g., EW_BASE, TOYOTA_TW.">
          <input style={inp} value={form.template_code}
            onChange={e => setForm({ ...form, template_code: e.target.value.toUpperCase() })} />
        </FG>
        <FG label="Name">
          <input style={inp} value={form.template_name}
            onChange={e => setForm({ ...form, template_name: e.target.value })} />
        </FG>
        <FG label="Description">
          <textarea style={{ ...inp, fontFamily: 'inherit' }} rows={2} value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </FG>
        <FG label="Type">
          <select style={inp} value={form.resolution_type}
            onChange={e => setForm({ ...form, resolution_type: e.target.value })}>
            <option value="full_list">Full list (replaces parent)</option>
            <option value="override">Override (deltas applied to parent)</option>
          </select>
        </FG>
        <FG label="Parent" hint="Required for Override type.">
          <select style={inp} value={form.parent_template_id || ''}
            onChange={e => setForm({ ...form, parent_template_id: e.target.value ? parseInt(e.target.value, 10) : null })}>
            <option value="">(none)</option>
            {templates.filter(t => t.resolution_type === 'full_list').map(t => (
              <option key={t.id} value={t.id}>{t.template_name}</option>
            ))}
          </select>
        </FG>
        <FG label="LOB">
          <select style={inp} value={form.match_lob}
            onChange={e => setForm({ ...form, match_lob: e.target.value })}>
            <option value="">(any)</option>
            {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </FG>
        <FG label="Priority">
          <input style={inp} type="number" value={form.priority}
            onChange={e => setForm({ ...form, priority: parseInt(e.target.value, 10) })} />
        </FG>
      </FormGrid>
    </Modal>
  );
}

// --- new-stage modal -------------------------------------------------------
function NewStageModal({ open, onClose, templateId, existingStages, onCreated }) {
  const [form, setForm] = useState({
    stage_code: '', stage_name: '', description: '',
    universal_phase: 2, sequence_number: 2, sequence_within_phase: 1,
    owner_role: 'Surveyor', firm_tat_hours: 0, insurer_tat_hours: 0,
    firm_tat_anchor: 'previous_stage_complete', insurer_tat_anchor: 'intimation',
    completion_trigger: 'manual',
    branching_active: false, subtasks_active: false,
    delta_operation: 'add', is_skippable: false, skip_condition: '',
    required_artifacts: '',
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const payload = {
        ...form,
        required_artifacts: form.required_artifacts
          ? form.required_artifacts.split('\n').map(s => s.trim()).filter(Boolean) : [],
      };
      const res = await fetch(`/api/lifecycle/templates/${templateId}/stages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Create failed');
      onCreated();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="New Stage" large
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add stage'}</Btn>
      </>}
    >
      {err && <Note tone="danger">{err}</Note>}
      <FormGrid>
        <FG label="Stage code" hint="E.g., 2.1 or 4.2. Prefix must match the phase.">
          <input style={inp} value={form.stage_code}
            onChange={e => setForm({ ...form, stage_code: e.target.value })} />
        </FG>
        <FG label="Stage name">
          <input style={inp} value={form.stage_name}
            onChange={e => setForm({ ...form, stage_name: e.target.value })} />
        </FG>
        <FG label="Description">
          <textarea style={{ ...inp, fontFamily: 'inherit' }} rows={2} value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </FG>
        <FG label="Universal phase">
          <select style={inp} value={form.universal_phase}
            onChange={e => setForm({ ...form, universal_phase: parseInt(e.target.value, 10) })}>
            {[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}. {PHASE_NAMES[p]}</option>)}
          </select>
        </FG>
        <FG label="Sequence number" hint="Global ordering across the template.">
          <input style={inp} type="number" value={form.sequence_number}
            onChange={e => setForm({ ...form, sequence_number: parseInt(e.target.value, 10) })} />
        </FG>
        <FG label="Sequence within phase">
          <input style={inp} type="number" value={form.sequence_within_phase}
            onChange={e => setForm({ ...form, sequence_within_phase: parseInt(e.target.value, 10) })} />
        </FG>
        <FG label="Owner role">
          <select style={inp} value={form.owner_role}
            onChange={e => setForm({ ...form, owner_role: e.target.value })}>
            <option>Admin</option><option>Surveyor</option>
            <option>Lead Surveyor</option><option>Reviewer</option>
          </select>
        </FG>
        <FG label="Firm TAT (hours)">
          <input style={inp} type="number" value={form.firm_tat_hours}
            onChange={e => setForm({ ...form, firm_tat_hours: parseInt(e.target.value, 10) })} />
        </FG>
        <FG label="Insurer TAT (hours)">
          <input style={inp} type="number" value={form.insurer_tat_hours}
            onChange={e => setForm({ ...form, insurer_tat_hours: parseInt(e.target.value, 10) })} />
        </FG>
        <FG label="Firm anchor">
          <select style={inp} value={form.firm_tat_anchor}
            onChange={e => setForm({ ...form, firm_tat_anchor: e.target.value })}>
            <option value="intimation">Intimation</option>
            <option value="previous_stage_complete">Previous stage complete</option>
            <option value="phase_start">Phase start</option>
          </select>
        </FG>
        <FG label="Insurer anchor">
          <select style={inp} value={form.insurer_tat_anchor}
            onChange={e => setForm({ ...form, insurer_tat_anchor: e.target.value })}>
            <option value="intimation">Intimation</option>
            <option value="previous_stage_complete">Previous stage complete</option>
            <option value="phase_start">Phase start</option>
          </select>
        </FG>
        <FG label="Required artifacts" hint="One per line. Leave empty if none.">
          <textarea style={{ ...inp, fontFamily: 'inherit' }} rows={3}
            value={form.required_artifacts}
            onChange={e => setForm({ ...form, required_artifacts: e.target.value })}
            placeholder="Initial inspection photos (min 3)&#10;Observation note&#10;Policy T&C verification" />
        </FG>
        <FG label="Features">
          <label style={chkWrap}>
            <input type="checkbox" checked={form.branching_active}
              onChange={e => setForm({ ...form, branching_active: e.target.checked })} />
            Branching active on this stage
          </label>
          <label style={chkWrap}>
            <input type="checkbox" checked={form.subtasks_active}
              onChange={e => setForm({ ...form, subtasks_active: e.target.checked })} />
            Subtasks active on this stage
          </label>
          <label style={chkWrap}>
            <input type="checkbox" checked={form.is_skippable}
              onChange={e => setForm({ ...form, is_skippable: e.target.checked })} />
            Skippable (auto-skip if condition matches)
          </label>
        </FG>
        {form.is_skippable && (
          <FG label="Skip condition" hint='e.g., {"subject_matter": "Building only"}'>
            <input style={inp} value={form.skip_condition}
              onChange={e => setForm({ ...form, skip_condition: e.target.value })} />
          </FG>
        )}
      </FormGrid>
    </Modal>
  );
}

// --- shared styles --------------------------------------------------------
const inp = {
  width: '100%', padding: '7px 10px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
};
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
const chkWrap = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' };
