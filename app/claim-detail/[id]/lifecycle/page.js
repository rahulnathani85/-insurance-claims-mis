'use client';
// =============================================================================
// /claim-detail/[id]/lifecycle — Live Claim View
// =============================================================================
// The operational, surveyor-facing live view of a single claim's lifecycle.
// Merges v1's "Live Claim" mockup with v2's mockup. Everything that appeared
// in the mockups is present:
//
//   • 7-phase stepper across the top with state per phase
//   • Phase blocks (one card per phase) showing:
//       - Stages within the phase (complete / active / pending / autocomplete / breach / skipped)
//       - Firm & insurer clock state per stage
//       - Stage TAT deadlines
//       - Subtask checklist per stage
//   • Phase-4 pending-items panel (open / closed lists, per-party clock state)
//   • Action buttons: Advance stage · Reopen phase · Reopen claim · Add ad-hoc item
//     · Re-resolve template · Add subtask
//   • Modals: Add item, Close item, Send reminder, Advance stage, Reopen stage
//   • Sidebar: claim metadata, template info, audit tail
//
// Non-admins can also reach this page — the gate is applied by the API, and
// the shell is invoked with noAdminGuard so Surveyors + Lead Surveyors see
// their own claims (internal-pending items are still server-gated).
// =============================================================================

import { useEffect, useMemo, useState, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import LifecycleAdminShell, {
  Card, Note, Badge, Tag, Btn, Modal, FormGrid, FG,
  PhaseStep, PhaseStepper,
} from '@/components/LifecycleAdminShell';

const PHASES = [
  { n: 1, name: 'Appointment & Intake' },
  { n: 2, name: 'Survey & Investigation' },
  { n: 3, name: 'ILA / LOR' },
  { n: 4, name: 'Pending Requirements' },
  { n: 5, name: 'Assessment' },
  { n: 6, name: 'Report' },
  { n: 7, name: 'Delivery & Closure' },
];

export default function LiveClaimPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role || 'Surveyor';
  const isAdmin = role === 'Admin';
  const isLead = role === 'Lead Surveyor' || isAdmin;
  const canSeeInternal = isLead;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // modals
  const [addItemFor, setAddItemFor] = useState(null);       // stage_code or true = ad-hoc
  const [closeItem, setCloseItem] = useState(null);         // item object
  const [remindItem, setRemindItem] = useState(null);       // item object
  const [advanceStage, setAdvanceStage] = useState(null);   // stage object
  const [reopenStage, setReopenStage] = useState(null);     // stage object
  const [addSubtaskFor, setAddSubtaskFor] = useState(null); // stage object

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/lifecycle/claims/${id}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
      setData(r);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  const lifecycle       = data?.lifecycle  || {};
  const template        = data?.template   || {};
  const phases          = data?.phases     || [];
  const stages          = data?.stages     || [];
  const items           = data?.items      || [];
  const subtasks        = data?.subtasks   || [];
  const audit           = data?.audit      || [];

  // Group stages by phase
  const stagesByPhase = useMemo(() => {
    const m = {};
    for (const s of stages) (m[s.phase] = m[s.phase] || []).push(s);
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    return m;
  }, [stages]);

  // Group items by stage + phase + state
  const itemsByStage = useMemo(() => {
    const m = {};
    for (const it of items) {
      const key = it.stage_code || '__adhoc__';
      (m[key] = m[key] || []).push(it);
    }
    return m;
  }, [items]);
  const openItems = items.filter(i => i.state === 'open' && (canSeeInternal || !i.is_internal));
  const closedItems = items.filter(i => i.state !== 'open' && (canSeeInternal || !i.is_internal));

  const subtasksByStage = useMemo(() => {
    const m = {};
    for (const st of subtasks) (m[st.stage_code] = m[st.stage_code] || []).push(st);
    return m;
  }, [subtasks]);

  // Phase states for the stepper
  const phaseTones = useMemo(() => {
    const m = {};
    for (const p of PHASES) {
      const ph = phases.find(x => x.phase === p.n);
      if (!ph) { m[p.n] = 'pending'; continue; }
      const s = ph.state;
      if (s === 'complete')     m[p.n] = 'complete';
      else if (s === 'autocomplete') m[p.n] = 'autocomplete';
      else if (s === 'active')  m[p.n] = 'active';
      else if (s === 'breach')  m[p.n] = 'breach';
      else if (s === 'skipped') m[p.n] = 'skipped';
      else                      m[p.n] = 'pending';
    }
    return m;
  }, [phases]);

  // API actions
  const post = useCallback(async (url, body, okMsg) => {
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`);
      setMessage({ tone: 'success', text: okMsg || 'Done' });
      await reload();
      return true;
    } catch (e) {
      setMessage({ tone: 'danger', text: String(e.message || e) });
      return false;
    }
  }, [reload]);

  const advance = async (stage, outcome) => {
    await post(`/api/lifecycle/claims/${id}/advance`, {
      stage_code: stage.stage_code, outcome_code: outcome || null,
    }, `Stage ${stage.stage_code} marked complete`);
    setAdvanceStage(null);
  };

  const reopen = async (stage) => {
    await post(`/api/lifecycle/claims/${id}/reopen`, {
      stage_code: stage.stage_code,
    }, `Stage ${stage.stage_code} re-opened`);
    setReopenStage(null);
  };

  const reopenClaim = async () => {
    if (!confirm('Reopen the claim? It will transition to status=reopened and resume clocks.')) return;
    await post(`/api/lifecycle/claims/${id}/reopen`, { scope: 'claim' },
               'Claim re-opened');
  };

  const reResolve = async () => {
    if (!confirm('Re-resolve the template? The engine will re-evaluate the 9-dimension match and may swap the template.')) return;
    await post(`/api/lifecycle/claims/${id}/re-resolve`, {},
               'Template re-resolution complete');
  };

  const stageTone = (state) => ({
    complete:     'complete',
    autocomplete: 'autocomplete',
    active:       'active',
    pending:      'pending',
    skipped:      'skipped',
    breach:       'breached',
  }[state] || 'pending');

  return (
    <LifecycleAdminShell
      view="live"
      title={`Live — ${lifecycle.claim_ref || id}`}
      subtitle={template.template_name
        ? `Template: ${template.template_code} · ${template.template_name}`
        : 'Live lifecycle view'}
      noAdminGuard
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn onClick={() => router.push('/admin/lifecycle/live')}>← All live claims</Btn>
          {isAdmin && <Btn onClick={reResolve}>Re-resolve template</Btn>}
          {isAdmin && <Btn onClick={reopenClaim}>Re-open claim</Btn>}
        </div>
      }
    >
      {loading && <Note tone="info">Loading lifecycle…</Note>}
      {error && <Note tone="danger">{error}</Note>}
      {message && <Note tone={message.tone}>{message.text}</Note>}
      {!loading && !data && <Note tone="warn">
        No lifecycle record for claim <code>{id}</code>. It may not yet be attached to a template,
        or the endpoint <code>/api/lifecycle/claims/{id}</code> is not yet wired up.
      </Note>}

      {/* Main 2-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>

        {/* ─── LEFT: stepper + per-phase blocks + pending items ─── */}
        <div>
          {/* Phase stepper */}
          <PhaseStepper>
            {PHASES.map(p => (
              <PhaseStep
                key={p.n}
                num={p.n}
                name={p.name}
                state={phaseTones[p.n]}
                tone={phaseTones[p.n]}
              />
            ))}
          </PhaseStepper>

          {/* Per-phase blocks with stages */}
          {PHASES.map(p => {
            const ph = phases.find(x => x.phase === p.n);
            const phaseStages = stagesByPhase[p.n] || [];
            const phaseState = phaseTones[p.n];
            return (
              <Card key={p.n}
                title={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Badge tone="lob">P{p.n}</Badge>
                    <span>{p.name}</span>
                    {phaseState === 'complete'     && <Badge tone="complete">Complete</Badge>}
                    {phaseState === 'autocomplete' && <Badge tone="autocomplete">Auto-complete</Badge>}
                    {phaseState === 'active'       && <Badge tone="active">In progress</Badge>}
                    {phaseState === 'breach'       && <Badge tone="breached">Breach</Badge>}
                    {phaseState === 'skipped'      && <Badge tone="skipped">Skipped</Badge>}
                    {phaseState === 'pending'      && <Badge tone="pending">Pending</Badge>}
                  </span>
                }
                subtitle={ph
                  ? `${ph.started_at ? `Started ${new Date(ph.started_at).toLocaleString()}` : 'Not started'}${
                       ph.ended_at ? ` · Ended ${new Date(ph.ended_at).toLocaleString()}` : ''}`
                  : undefined}
                actions={
                  phaseState === 'complete' && isAdmin
                    ? <Btn size="sm" onClick={() => post(`/api/lifecycle/claims/${id}/reopen`,
                                                          { phase: p.n }, `Phase ${p.n} re-opened`)}>
                        Re-open phase
                      </Btn>
                    : null
                }
              >
                {phaseStages.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>
                    No stages configured for this phase in the current template.
                  </div>
                ) : (
                  <table style={tbl}>
                    <thead>
                      <tr style={tHeadRow}>
                        <th style={{ ...th, width: 56 }}>Stage</th>
                        <th style={th}>Name</th>
                        <th style={{ ...th, width: 130 }}>State</th>
                        <th style={{ ...th, width: 180 }}>Clocks & TAT</th>
                        <th style={{ ...th, width: 140 }}>Assigned</th>
                        <th style={{ ...th, width: 160 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phaseStages.map(s => (
                        <Fragment key={s.id || s.stage_code}>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={td}>
                              <code style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                                {s.stage_code}
                              </code>
                            </td>
                            <td style={td}>
                              <div style={{ fontWeight: 600 }}>{s.stage_name || '—'}</div>
                              {s.notes && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                {s.notes}
                              </div>}
                            </td>
                            <td style={td}>
                              <Badge tone={stageTone(s.state)}>{s.state || 'pending'}</Badge>
                              {s.started_at && s.state !== 'complete' && s.state !== 'skipped' && (
                                <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 3 }}>
                                  Started {new Date(s.started_at).toLocaleDateString()}
                                </div>
                              )}
                              {s.completed_at && (
                                <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 3 }}>
                                  Done {new Date(s.completed_at).toLocaleDateString()}
                                </div>
                              )}
                            </td>
                            <td style={td}>
                              <div>
                                {s.firm_clock === 'paused'
                                  ? <Tag tone="firm-pause">firm ⏸</Tag>
                                  : <Tag tone="firm-run">firm ▶</Tag>}
                                {s.insurer_clock === 'paused'
                                  ? <Tag tone="insurer-pause">ins ⏸</Tag>
                                  : <Tag tone="insurer-run">ins ▶</Tag>}
                              </div>
                              {s.firm_deadline_at && (
                                <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 3 }}>
                                  Firm due {new Date(s.firm_deadline_at).toLocaleDateString()}
                                </div>
                              )}
                              {s.insurer_deadline_at && (
                                <div style={{ fontSize: 10.5, color: '#6b7280' }}>
                                  Ins. due {new Date(s.insurer_deadline_at).toLocaleDateString()}
                                </div>
                              )}
                              {s.tat_firm_hours != null && (
                                <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
                                  TAT: {s.tat_firm_hours}h firm
                                  {s.tat_insurer_hours != null ? ` / ${s.tat_insurer_hours}h ins.` : ''}
                                </div>
                              )}
                            </td>
                            <td style={{ ...td, fontSize: 11.5 }}>
                              {s.assigned_to_email || '—'}
                            </td>
                            <td style={td}>
                              {s.state === 'active' && (
                                <Btn size="xs" variant="primary"
                                  onClick={() => setAdvanceStage(s)}>
                                  Complete →
                                </Btn>
                              )}
                              {s.state === 'pending' && isAdmin && (
                                <Btn size="xs"
                                  onClick={() => post(`/api/lifecycle/claims/${id}/start-stage`,
                                                       { stage_code: s.stage_code },
                                                       `Stage ${s.stage_code} started`)}>
                                  Start
                                </Btn>
                              )}
                              {s.state === 'complete' && isAdmin && (
                                <Btn size="xs" onClick={() => setReopenStage(s)}>
                                  Re-open
                                </Btn>
                              )}
                              {p.n === 4 && s.state !== 'skipped' && (
                                <Btn size="xs" onClick={() => setAddItemFor(s)}>
                                  + Item
                                </Btn>
                              )}
                              <Btn size="xs" onClick={() => setAddSubtaskFor(s)}>
                                + Sub
                              </Btn>
                            </td>
                          </tr>

                          {/* Subtasks for this stage */}
                          {(subtasksByStage[s.stage_code] || []).length > 0 && (
                            <tr>
                              <td colSpan={6} style={{ padding: '8px 12px 12px 60px', background: '#fafbfc' }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
                                              color: '#6b7280', letterSpacing: 0.5, marginBottom: 4 }}>
                                  Sub-tasks
                                </div>
                                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
                                  {subtasksByStage[s.stage_code].map(st => (
                                    <li key={st.id || st.subtask_code}>
                                      <strong>{st.subtask_name}</strong>
                                      {' '}
                                      {st.is_required && <Badge tone="breached">Required</Badge>}
                                      {st.state === 'complete'
                                        ? <Badge tone="complete">Done</Badge>
                                        : st.state === 'waived'
                                        ? <Badge tone="skipped">Waived</Badge>
                                        : <Badge tone="pending">Pending</Badge>}
                                      {st.owner_role && <span style={{ fontSize: 11, color: '#6b7280' }}>
                                        · {st.owner_role}
                                      </span>}
                                      {st.completed_at && <span style={{ fontSize: 10.5, color: '#9ca3af' }}>
                                        · {new Date(st.completed_at).toLocaleString()}
                                      </span>}
                                      {st.state !== 'complete' && (
                                        <Btn size="xs"
                                          style={{ marginLeft: 6 }}
                                          onClick={() => post(`/api/lifecycle/claims/${id}/subtask`, {
                                            stage_code: s.stage_code,
                                            subtask_code: st.subtask_code,
                                            state: 'complete',
                                          }, 'Sub-task marked complete')}>
                                          Mark done
                                        </Btn>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          )}

                          {/* Pending items anchored on this stage (phase 4) */}
                          {(itemsByStage[s.stage_code] || [])
                            .filter(i => canSeeInternal || !i.is_internal)
                            .length > 0 && (
                            <tr>
                              <td colSpan={6} style={{ padding: '8px 12px 12px 60px', background: '#fffbeb' }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
                                              color: '#92400e', letterSpacing: 0.5, marginBottom: 6 }}>
                                  Pending items
                                </div>
                                {itemsByStage[s.stage_code]
                                  .filter(i => canSeeInternal || !i.is_internal)
                                  .map(it => (
                                  <PendingItemRow
                                    key={it.id}
                                    item={it}
                                    onClose={() => setCloseItem(it)}
                                    onRemind={() => setRemindItem(it)}
                                  />
                                ))}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            );
          })}

          {/* Consolidated pending items panel */}
          <Card
            title={`Pending items — all open (${openItems.length})`}
            subtitle="Open pending items across all phases. Driver of Phase-4 clock-pause logic."
            actions={<Btn size="sm" variant="primary" onClick={() => setAddItemFor(true)}>
              + Ad-hoc item
            </Btn>}
          >
            {openItems.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#059669' }}>
                No open pending items — all requirements closed.
              </div>
            ) : (
              <table style={tbl}>
                <thead>
                  <tr style={tHeadRow}>
                    <th style={th}>Item</th>
                    <th style={th}>Party</th>
                    <th style={th}>Opened</th>
                    <th style={th}>Age</th>
                    <th style={th}>Reminders</th>
                    <th style={th}>Clock state</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {openItems.map(it => {
                    const opened = it.opened_at ? new Date(it.opened_at) : null;
                    const ageDays = opened ? Math.floor((Date.now() - opened) / 86400000) : null;
                    return (
                      <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6',
                                              background: it.is_internal ? '#fef3c7' : undefined }}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{it.label || it.item_name || it.item_code}</div>
                          <code style={{ fontFamily: 'monospace', fontSize: 10.5, color: '#6b7280' }}>
                            {it.item_code}
                          </code>
                          {it.is_internal && <Badge tone="active">Internal</Badge>}
                          {it.is_blocking === false && <Badge tone="skipped">Non-blocking</Badge>}
                        </td>
                        <td style={td}><Badge tone="portfolio">{it.party || '—'}</Badge></td>
                        <td style={{ ...td, fontSize: 11.5 }}>
                          {opened ? opened.toLocaleDateString() : '—'}
                        </td>
                        <td style={{ ...td, fontSize: 11.5, color: ageDays > 14 ? '#b91c1c' : '#374151' }}>
                          {ageDays != null ? `${ageDays}d` : '—'}
                        </td>
                        <td style={{ ...td, fontSize: 11.5 }}>
                          {it.reminder_count || 0}
                          {it.last_reminder_at && <div style={{ fontSize: 10.5, color: '#6b7280' }}>
                            last {new Date(it.last_reminder_at).toLocaleDateString()}
                          </div>}
                        </td>
                        <td style={td}>
                          {it.firm_clock === 'paused'
                            ? <Tag tone="firm-pause">firm ⏸</Tag>
                            : <Tag tone="firm-run">firm ▶</Tag>}
                          {it.insurer_clock === 'paused'
                            ? <Tag tone="insurer-pause">ins ⏸</Tag>
                            : <Tag tone="insurer-run">ins ▶</Tag>}
                        </td>
                        <td style={td}>
                          <Btn size="xs" onClick={() => setRemindItem(it)}>Remind</Btn>
                          <Btn size="xs" variant="primary" onClick={() => setCloseItem(it)}>Close</Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {closedItems.length > 0 && (
            <Card title={`Pending items — closed (${closedItems.length})`}
                  subtitle="Completed requirements kept as audit trail.">
              <table style={tbl}>
                <thead>
                  <tr style={tHeadRow}>
                    <th style={th}>Item</th>
                    <th style={th}>Party</th>
                    <th style={th}>Opened</th>
                    <th style={th}>Closed</th>
                    <th style={th}>By</th>
                    <th style={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {closedItems.map(it => (
                    <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td}>
                        {it.label || it.item_name || it.item_code}
                        <code style={{ fontFamily: 'monospace', fontSize: 10.5, color: '#6b7280', marginLeft: 6 }}>
                          {it.item_code}
                        </code>
                        {it.state === 'skipped' && <Badge tone="skipped">Skipped</Badge>}
                      </td>
                      <td style={td}><Badge tone="portfolio">{it.party || '—'}</Badge></td>
                      <td style={{ ...td, fontSize: 11.5 }}>
                        {it.opened_at ? new Date(it.opened_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...td, fontSize: 11.5 }}>
                        {it.closed_at ? new Date(it.closed_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...td, fontSize: 11.5 }}>{it.closed_by || it.created_by || '—'}</td>
                      <td style={{ ...td, fontSize: 11.5, color: '#374151' }}>{it.closure_note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        {/* ─── RIGHT: side column (claim meta + audit tail) ─── */}
        <div>
          <Card title="Claim">
            <Meta label="Ref"       value={lifecycle.claim_ref || id} mono />
            <Meta label="LOB"       value={lifecycle.lob} />
            <Meta label="Insured"   value={lifecycle.insured_name} />
            <Meta label="Insurer"   value={lifecycle.insurer_name} />
            <Meta label="Policy"    value={lifecycle.policy_no} mono />
            <Meta label="Status"    value={lifecycle.status} />
            <Meta label="Opened"    value={lifecycle.opened_at ? new Date(lifecycle.opened_at).toLocaleString() : '—'} />
            {lifecycle.closed_at && <Meta label="Closed" value={new Date(lifecycle.closed_at).toLocaleString()} />}
          </Card>

          <Card title="Template">
            <Meta label="Code"       value={template.template_code} mono />
            <Meta label="Name"       value={template.template_name} />
            <Meta label="LOB"        value={template.lob} />
            <Meta label="Portfolio"  value={template.portfolio} />
            <Meta label="Client"     value={template.client_code} />
            <Meta label="Delta op"   value={template.delta_operation} />
            {isAdmin && <Btn size="xs" style={{ marginTop: 8 }}
              onClick={() => router.push(`/admin/lifecycle/templates?id=${template.id}`)}>
              Open in Template Library →
            </Btn>}
          </Card>

          <Card title="Clocks">
            <Meta label="Firm clock"
              value={lifecycle.firm_clock_running ? 'running' : 'paused'}
              tone={lifecycle.firm_clock_running ? 'run' : 'pause'} />
            <Meta label="Firm total"
              value={formatMinutes(lifecycle.firm_total_minutes)} />
            <Meta label="Insurer clock"
              value={lifecycle.insurer_clock_running ? 'running' : 'paused'}
              tone={lifecycle.insurer_clock_running ? 'run' : 'pause'} />
            <Meta label="Insurer total"
              value={formatMinutes(lifecycle.insurer_total_minutes)} />
          </Card>

          <Card title="Audit tail"
                subtitle={audit.length > 20 ? `Showing 20 of ${audit.length}` : `${audit.length} events`}
                actions={<Btn size="xs" onClick={() => router.push(`/admin/lifecycle/audit?claim=${encodeURIComponent(lifecycle.claim_ref || id)}`)}>
                  Full log →
                </Btn>}>
            {audit.length === 0 ? (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>No events yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {audit.slice(0, 20).map(e => (
                  <div key={e.id} style={{
                    padding: '6px 8px', fontSize: 11.5,
                    borderLeft: '2px solid #e5e7eb', paddingLeft: 10,
                  }}>
                    <div style={{ fontWeight: 600, color: '#111827' }}>{e.event_type}</div>
                    <div style={{ color: '#6b7280', fontSize: 11 }}>
                      {e.created_at ? new Date(e.created_at).toLocaleString() : ''}
                    </div>
                    {e.detail && <div style={{ color: '#374151', marginTop: 2 }}>{e.detail}</div>}
                    {e.actor_email && <div style={{ color: '#9ca3af', fontSize: 10.5, marginTop: 1 }}>
                      by {e.actor_email}
                    </div>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ─── Modals ─── */}

      <AddItemModal
        open={!!addItemFor}
        stage={typeof addItemFor === 'object' ? addItemFor : null}
        onClose={() => setAddItemFor(null)}
        onSave={async (body) => {
          await post(`/api/lifecycle/claims/${id}/items`, body, 'Item added');
          setAddItemFor(null);
        }}
      />

      <CloseItemModal
        open={!!closeItem}
        item={closeItem}
        onClose={() => setCloseItem(null)}
        onSave={async (body) => {
          await post(`/api/lifecycle/claims/${id}/items/${closeItem.id}/close`, body, 'Item closed');
          setCloseItem(null);
        }}
      />

      <RemindModal
        open={!!remindItem}
        item={remindItem}
        onClose={() => setRemindItem(null)}
        onSave={async (body) => {
          await post(`/api/lifecycle/claims/${id}/items/${remindItem.id}/remind`, body, 'Reminder logged');
          setRemindItem(null);
        }}
      />

      <AdvanceModal
        open={!!advanceStage}
        stage={advanceStage}
        template={template}
        onClose={() => setAdvanceStage(null)}
        onSave={(outcome) => advance(advanceStage, outcome)}
      />

      <ReopenModal
        open={!!reopenStage}
        stage={reopenStage}
        onClose={() => setReopenStage(null)}
        onSave={() => reopen(reopenStage)}
      />

      <AddSubtaskModal
        open={!!addSubtaskFor}
        stage={addSubtaskFor}
        onClose={() => setAddSubtaskFor(null)}
        onSave={async (body) => {
          await post(`/api/lifecycle/claims/${id}/subtask`, {
            stage_code: addSubtaskFor.stage_code, ...body,
          }, 'Sub-task added');
          setAddSubtaskFor(null);
        }}
      />
    </LifecycleAdminShell>
  );
}

// --- Small helpers --------------------------------------------------------

function Meta({ label, value, mono, tone }) {
  const color = tone === 'run' ? '#b91c1c' : tone === 'pause' ? '#6b21a8' : '#111827';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6,
                  fontSize: 12, padding: '4px 0', borderBottom: '1px dotted #f3f4f6' }}>
      <div style={{ color: '#6b7280', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: mono ? 'monospace' : undefined, color }}>{value ?? '—'}</div>
    </div>
  );
}

function formatMinutes(mins) {
  if (mins == null) return '—';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return `${d}d ${h}h`;
}

function PendingItemRow({ item, onClose, onRemind }) {
  const opened = item.opened_at ? new Date(item.opened_at) : null;
  const age = opened ? Math.floor((Date.now() - opened) / 86400000) : null;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8,
      alignItems: 'center', padding: '6px 0',
      borderBottom: '1px dashed #fde68a', fontSize: 11.5,
    }}>
      <div>
        <strong>{item.label || item.item_name || item.item_code}</strong>
        {item.is_internal && <Badge tone="active">Internal</Badge>}
        {item.is_blocking === false && <Badge tone="skipped">Non-blocking</Badge>}
      </div>
      <div><Badge tone="portfolio">{item.party || '—'}</Badge></div>
      <div>Age {age != null ? `${age}d` : '—'}{' '}
        {item.reminder_count ? <span style={{ color: '#6b7280' }}>· {item.reminder_count} reminders</span> : ''}
      </div>
      <div>
        {item.firm_clock === 'paused'
          ? <Tag tone="firm-pause">firm ⏸</Tag>
          : <Tag tone="firm-run">firm ▶</Tag>}
        {item.insurer_clock === 'paused'
          ? <Tag tone="insurer-pause">ins ⏸</Tag>
          : <Tag tone="insurer-run">ins ▶</Tag>}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Btn size="xs" onClick={onRemind}>Remind</Btn>
        <Btn size="xs" variant="primary" onClick={onClose}>Close</Btn>
      </div>
    </div>
  );
}

// --- Modals ---------------------------------------------------------------

function AddItemModal({ open, stage, onClose, onSave }) {
  const [form, setForm] = useState({
    stage_code: stage?.stage_code || '',
    item_code: '', label: '', party: 'insured',
    is_blocking: true, is_internal: false,
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(f => ({
      ...f,
      stage_code: stage?.stage_code || '',
    }));
    setErr(null);
  }, [stage, open]);

  const submit = async () => {
    if (!form.item_code.trim()) { setErr('Item code is required'); return; }
    setBusy(true);
    try {
      await onSave(form);
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open={open} onClose={onClose}
      title={stage?.stage_code
        ? `Add item to stage ${stage.stage_code}`
        : 'Add ad-hoc pending item'}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Add item'}
        </Btn>
      </>}
    >
      {err && <Note tone="danger">{err}</Note>}
      <FormGrid>
        <FG label="Item code" hint="Must exist in the Item Catalog.">
          <input style={inp} value={form.item_code}
            onChange={e => setForm({ ...form, item_code: e.target.value })} />
        </FG>
        <FG label="Label" hint="Optional display name; defaults to the catalog entry.">
          <input style={inp} value={form.label}
            onChange={e => setForm({ ...form, label: e.target.value })} />
        </FG>
        <FG label="Stage">
          <input style={inp} value={form.stage_code}
            placeholder="Leave blank for ad-hoc (no stage)"
            onChange={e => setForm({ ...form, stage_code: e.target.value })} />
        </FG>
        <FG label="Party">
          <select style={inp} value={form.party}
            onChange={e => setForm({ ...form, party: e.target.value })}>
            <option value="insured">Insured</option>
            <option value="insurer">Insurer</option>
            <option value="partner">Partner</option>
            <option value="internal">Internal</option>
          </select>
        </FG>
        <FG label="Flags">
          <label style={chk}>
            <input type="checkbox" checked={form.is_blocking}
              onChange={e => setForm({ ...form, is_blocking: e.target.checked })} />
            Blocking (pauses the phase)
          </label>
          <label style={chk}>
            <input type="checkbox" checked={form.is_internal}
              onChange={e => setForm({ ...form, is_internal: e.target.checked })} />
            Internal (visible to Lead Surveyor + Admin only)
          </label>
        </FG>
      </FormGrid>
    </Modal>
  );
}

function CloseItemModal({ open, item, onClose, onSave }) {
  const [note, setNote] = useState('');
  const [evidenceUrl, setEvidence] = useState('');
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setNote(''); setEvidence(''); setSkipped(false); }, [item, open]);

  const submit = async () => {
    setBusy(true);
    await onSave({ closure_note: note, evidence_url: evidenceUrl,
                   state: skipped ? 'skipped' : 'closed' });
    setBusy(false);
  };

  if (!item) return null;
  return (
    <Modal
      open={open} onClose={onClose}
      title={`Close: ${item.label || item.item_name || item.item_code}`}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Closing…' : skipped ? 'Skip item' : 'Close item'}
        </Btn>
      </>}
    >
      <FormGrid>
        <FG label="Closure note"><textarea style={{ ...inp, fontFamily: 'inherit' }} rows={3}
          value={note} onChange={e => setNote(e.target.value)} /></FG>
        <FG label="Evidence URL" hint="Link to document / photo / scan in your file store.">
          <input style={inp} value={evidenceUrl} onChange={e => setEvidence(e.target.value)} />
        </FG>
        <FG label="Skip instead">
          <label style={chk}>
            <input type="checkbox" checked={skipped}
              onChange={e => setSkipped(e.target.checked)} />
            Skip (mark not-applicable instead of closed)
          </label>
        </FG>
      </FormGrid>
    </Modal>
  );
}

function RemindModal({ open, item, onClose, onSave }) {
  const [channel, setChannel] = useState('email');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChannel('email');
    setTo(item?.contact_email || '');
    setMessage('');
  }, [item, open]);

  const submit = async () => {
    setBusy(true);
    await onSave({ channel, to, message });
    setBusy(false);
  };

  if (!item) return null;
  return (
    <Modal
      open={open} onClose={onClose}
      title={`Send reminder: ${item.label || item.item_name || item.item_code}`}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Sending…' : 'Send reminder'}
        </Btn>
      </>}
    >
      <FormGrid>
        <FG label="Channel">
          <select style={inp} value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="manual">Manual (log only)</option>
          </select>
        </FG>
        <FG label="Recipient">
          <input style={inp} value={to} onChange={e => setTo(e.target.value)} />
        </FG>
        <FG label="Message" hint="Leave blank for the template default.">
          <textarea style={{ ...inp, fontFamily: 'inherit' }} rows={4}
            value={message} onChange={e => setMessage(e.target.value)} />
        </FG>
      </FormGrid>
    </Modal>
  );
}

function AdvanceModal({ open, stage, template, onClose, onSave }) {
  const [outcome, setOutcome] = useState('');
  useEffect(() => { setOutcome(''); }, [stage, open]);
  if (!stage) return null;
  return (
    <Modal
      open={open} onClose={onClose}
      title={`Complete stage ${stage.stage_code} — ${stage.stage_name || ''}`}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={() => onSave(outcome || null)}>
          Mark complete →
        </Btn>
      </>}
    >
      <FormGrid>
        <FG label="Outcome code" hint={template?.branching_enabled
          ? 'Feeds any branching rules configured on this template.'
          : 'Optional — used for branching if enabled.'}>
          <input style={inp} value={outcome}
            placeholder="e.g. approved / rejected / needs-reinspection"
            onChange={e => setOutcome(e.target.value)} />
        </FG>
      </FormGrid>
      <Note tone="info">
        Completing this stage will run any branching rules, start the next stage in
        sequence (or the branched-to stage), and emit a <code>stage_complete</code>
        event to the audit log.
      </Note>
    </Modal>
  );
}

function ReopenModal({ open, stage, onClose, onSave }) {
  if (!stage) return null;
  return (
    <Modal
      open={open} onClose={onClose}
      title={`Re-open stage ${stage.stage_code}`}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={onSave}>Re-open</Btn>
      </>}
    >
      <Note tone="warn">
        Re-opening a completed stage resets its state to <code>active</code>, restarts
        its clocks, and emits a <code>stage_reopened</code> event. Subsequent stages
        may need to be re-run depending on branching.
      </Note>
    </Modal>
  );
}

function AddSubtaskModal({ open, stage, onClose, onSave }) {
  const [form, setForm] = useState({
    subtask_code: '', subtask_name: '', is_required: false,
    owner_role: 'Surveyor', evidence_required: false, notes: '',
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setForm({
      subtask_code: '', subtask_name: '', is_required: false,
      owner_role: 'Surveyor', evidence_required: false, notes: '',
    });
  }, [stage, open]);
  if (!stage) return null;
  return (
    <Modal
      open={open} onClose={onClose}
      title={`Add sub-task to ${stage.stage_code}`}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={async () => { setBusy(true); await onSave(form); setBusy(false); }}
          disabled={busy}>
          {busy ? 'Saving…' : 'Add'}
        </Btn>
      </>}
    >
      <FormGrid>
        <FG label="Code"><input style={inp} value={form.subtask_code}
          onChange={e => setForm({ ...form, subtask_code: e.target.value })} /></FG>
        <FG label="Name"><input style={inp} value={form.subtask_name}
          onChange={e => setForm({ ...form, subtask_name: e.target.value })} /></FG>
        <FG label="Owner role">
          <select style={inp} value={form.owner_role}
            onChange={e => setForm({ ...form, owner_role: e.target.value })}>
            <option>Surveyor</option>
            <option>Lead Surveyor</option>
            <option>Reviewer</option>
            <option>Admin</option>
          </select>
        </FG>
        <FG label="Flags">
          <label style={chk}>
            <input type="checkbox" checked={form.is_required}
              onChange={e => setForm({ ...form, is_required: e.target.checked })} />
            Required for stage completion
          </label>
          <label style={chk}>
            <input type="checkbox" checked={form.evidence_required}
              onChange={e => setForm({ ...form, evidence_required: e.target.checked })} />
            Evidence required (attach file)
          </label>
        </FG>
        <FG label="Notes"><textarea style={{ ...inp, fontFamily: 'inherit' }} rows={2}
          value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></FG>
      </FormGrid>
    </Modal>
  );
}

const inp = {
  width: '100%', padding: '7px 10px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
};
const chk = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0' };
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
