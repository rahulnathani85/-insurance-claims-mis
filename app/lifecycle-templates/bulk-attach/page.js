'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { LOB_LIST } from '@/lib/constants';

// Bulk-attach lifecycle template to multiple claim files in one go.
// Admin-only. Works for both classic claims (claims.id) and EW claims (ew_vehicle_claims.id).
// Calls /api/lifecycle/attach once per selected claim, sequentially, with the
// same template and the same clear_legacy flag.

export default function LifecycleBulkAttach() {
  const router = useRouter();
  const { user } = useAuth();
  const { company } = useCompany();
  const isAdmin = user?.role === 'Admin';

  const [source, setSource] = useState('claims'); // 'claims' | 'ew'
  const [lob, setLob] = useState('');
  const [search, setSearch] = useState('');
  const [onlyWithoutLifecycle, setOnlyWithoutLifecycle] = useState(true);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [clearLegacy, setClearLegacy] = useState(false);
  const [selected, setSelected] = useState({}); // { id: true }
  const [progress, setProgress] = useState(null); // { total, done, errors, stopped? }
  const [log, setLog] = useState([]);
  const [alert, setAlert] = useState(null);

  // Stop flag — useRef so the change is visible mid-loop without waiting for React re-render.
  const stopRef = useRef(false);

  // Which log row is currently executing an inline action (detach / force attach / reresolve).
  // -1 = none. Only one row may act at a time to keep the UI coherent.
  const [rowBusyIdx, setRowBusyIdx] = useState(-1);

  useEffect(() => {
    fetch('/api/lifecycle/templates?is_active=true')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setTemplates([]); return; }
        const list = Array.isArray(data?.templates) ? data.templates : Array.isArray(data) ? data : [];
        setTemplates(list.filter(t => t.is_active));
      })
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => { loadClaims(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [source, company]);

  async function loadClaims() {
    try {
      setLoading(true);
      setSelected({});
      const url = source === 'ew'
        ? `/api/ew-claims?company=${encodeURIComponent(company || 'NISLA')}&t=${Date.now()}`
        : `/api/claims?company=${encodeURIComponent(company || 'NISLA')}&t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); setClaims([]); }
    finally { setLoading(false); }
  }

  const filteredTemplates = useMemo(() => {
    if (source === 'ew') return templates.filter(t => !t.match_lob || t.match_lob === 'Extended Warranty');
    if (lob) return templates.filter(t => !t.match_lob || t.match_lob === lob);
    return templates;
  }, [templates, source, lob]);

  const filteredClaims = useMemo(() => {
    return claims.filter(c => {
      if (onlyWithoutLifecycle && c.uses_lifecycle_engine) return false;
      if (source === 'claims' && lob && c.lob !== lob) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [c.ref_number, c.insured_name, c.customer_name, c.vehicle_reg_no, c.chassis_number, c.claim_file_no].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [claims, onlyWithoutLifecycle, lob, search, source]);

  const selectedIds = Object.keys(selected).filter(k => selected[k]);
  const selectedCount = selectedIds.length;

  function toggleAll(on) {
    const map = {};
    if (on) filteredClaims.forEach(c => { map[c.id] = true; });
    setSelected(map);
  }

  function showAlertMsg(msg, type = 'success') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  function stopBulk() {
    stopRef.current = true;
  }

  async function runBulk() {
    if (!templateId) { showAlertMsg('Pick a lifecycle template first', 'error'); return; }
    if (selectedCount === 0) { showAlertMsg('Select at least one claim', 'error'); return; }

    const confirmText = `Attach template to ${selectedCount} ${source === 'ew' ? 'EW ' : ''}claim(s)?${clearLegacy ? '\n\nThis WILL remove legacy stage data for each of those files.' : ''}`;
    if (!confirm(confirmText)) return;

    stopRef.current = false;
    setProgress({ total: selectedCount, done: 0, errors: 0, stopped: false });
    setLog([]);

    // Body builder.
    // /api/ew-claims returns two shapes intermixed:
    //   (a) real ew_vehicle_claims rows  →  c.id is a UUID, no _source flag
    //   (b) unlinked classic claims with LOB=Extended Warranty wrapped as
    //       { id: `claim-${c.id}`, claim_id: c.id, _source: 'claims' }
    // Shape (b) cannot go down the ew_claim_id path because that column is UUID.
    // Route shape (b) through the classic claim_id path using the real integer.
    const body = (claimId) => {
      const claim = claims.find(c => String(c.id) === String(claimId));

      if (source === 'ew' && claim && claim._source === 'claims' && claim.claim_id != null) {
        return {
          claim_id: parseInt(claim.claim_id, 10),
          template_id: parseInt(templateId, 10),
          clear_legacy: clearLegacy,
          user_email: user?.email,
        };
      }

      return source === 'ew'
        ? { ew_claim_id: claimId, template_id: parseInt(templateId, 10), clear_legacy: clearLegacy, user_email: user?.email }
        : { claim_id: parseInt(claimId, 10), template_id: parseInt(templateId, 10), clear_legacy: clearLegacy, user_email: user?.email };
    };

    let done = 0, errors = 0, stoppedEarly = false;
    const logRows = [];
    for (const id of selectedIds) {
      // Check stop flag at the START of each iteration so a click during a
      // network wait aborts BEFORE firing the next attach.
      if (stopRef.current) {
        stoppedEarly = true;
        break;
      }
      try {
        const res = await fetch('/api/lifecycle/attach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body(id)),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'attach failed');
        done += 1;
        const claim = claims.find(c => String(c.id) === String(id));
        logRows.push({ id, ref: claim?.ref_number || id, ok: true, detail: `${data.stages_materialised || 0} stages, ${data.items_seeded || 0} items` });
      } catch (e) {
        errors += 1;
        const claim = claims.find(c => String(c.id) === String(id));
        logRows.push({ id, ref: claim?.ref_number || id, ok: false, detail: e.message });
      }
      setProgress({ total: selectedCount, done: done + errors, errors, stopped: false });
      setLog([...logRows]);
    }
    setProgress({ total: selectedCount, done: done + errors, errors, stopped: stoppedEarly });
    if (stoppedEarly) {
      const remaining = selectedCount - (done + errors);
      showAlertMsg(`Bulk attach stopped at ${done + errors}/${selectedCount}. ${done} ok, ${errors} failed, ${remaining} skipped.`, 'warning');
    } else {
      showAlertMsg(`Bulk attach complete: ${done} ok, ${errors} failed`, errors > 0 ? 'error' : 'success');
    }
    // Refresh claims so uses_lifecycle_engine reflects
    loadClaims();
  }

  // ---------------------------------------------------------------------------
  // Inline row actions on the Results log — lets admins resolve "already
  // attached" failures without leaving the bulk-attach page.
  // ---------------------------------------------------------------------------

  function updateLogRow(idx, patch) {
    setLog(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function rowDetach(idx, lifecycleId) {
    setRowBusyIdx(idx);
    try {
      const res = await fetch(`/api/lifecycle/${lifecycleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user?.email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'detach failed');
      updateLogRow(idx, {
        ok: true, status: 'detached',
        detail: `Detached lifecycle #${lifecycleId}. Claim is back in legacy mode — tick it in the list and run Attach again to re-apply a template.`,
      });
      // Refresh the top list so the checkbox goes from "on engine" → "legacy"
      loadClaims();
    } catch (e) {
      updateLogRow(idx, { detail: `Detach failed: ${e.message}` });
    } finally {
      setRowBusyIdx(-1);
    }
  }

  async function rowForceAttach(idx, lifecycleId, originalId) {
    if (!templateId) {
      showAlertMsg('Pick a lifecycle template in the dropdown above first', 'error');
      return;
    }
    setRowBusyIdx(idx);
    try {
      // 1. Detach the existing lifecycle
      const delRes = await fetch(`/api/lifecycle/${lifecycleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user?.email }),
      });
      const delData = await delRes.json().catch(() => ({}));
      if (!delRes.ok) throw new Error(delData.error || 'detach step failed');

      // 2. Re-attach with the currently selected template, reusing the same
      //    body-builder the bulk loop uses (handles synthetic classic EW rows).
      const attachBody = (() => {
        const claim = claims.find(c => String(c.id) === String(originalId));
        if (source === 'ew' && claim && claim._source === 'claims' && claim.claim_id != null) {
          return {
            claim_id: parseInt(claim.claim_id, 10),
            template_id: parseInt(templateId, 10),
            clear_legacy: clearLegacy,
            user_email: user?.email,
          };
        }
        return source === 'ew'
          ? { ew_claim_id: originalId, template_id: parseInt(templateId, 10), clear_legacy: clearLegacy, user_email: user?.email }
          : { claim_id: parseInt(originalId, 10), template_id: parseInt(templateId, 10), clear_legacy: clearLegacy, user_email: user?.email };
      })();

      const attachRes = await fetch('/api/lifecycle/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attachBody),
      });
      const attachData = await attachRes.json().catch(() => ({}));
      if (!attachRes.ok) {
        throw new Error(
          `Detach ok but re-attach failed: ${attachData.error || 'attach failed'}. Claim is in legacy mode — click Detach ✓, then retry Force attach.`
        );
      }

      const newTpl = templates.find(t => String(t.id) === String(templateId));
      updateLogRow(idx, {
        ok: true, status: 'fixed',
        detail: `Force-attached ${newTpl?.template_code || `template ${templateId}`}: ${attachData.stages_materialised || 0} stages, ${attachData.items_seeded || 0} items.`,
      });
      loadClaims();
    } catch (e) {
      updateLogRow(idx, { detail: e.message });
    } finally {
      setRowBusyIdx(-1);
    }
  }

  async function rowReresolve(idx, lifecycleId) {
    setRowBusyIdx(idx);
    try {
      const res = await fetch(`/api/lifecycle/reresolve/${lifecycleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user?.email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'reresolve failed');
      updateLogRow(idx, {
        ok: true, status: 'fixed',
        detail: data.unchanged
          ? `Reresolve: template unchanged (still the best match for this claim's attributes).`
          : `Reresolve: swapped to ${data.new_template || 'new template'}. Completed stages preserved.`,
      });
      loadClaims();
    } catch (e) {
      updateLogRow(idx, { detail: `Reresolve failed: ${e.message}` });
    } finally {
      setRowBusyIdx(-1);
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk row actions — apply Detach or Force-Attach to every fixable row at
  // once. `fixable` is the list computed in the Results <h4> header:
  //   [{ l: logRow, i: logIndex, lid: lifecycle_id parsed from the error }, ...]
  //
  // These run sequentially (not Promise.all) so:
  //   (a) the DB sees one mutation at a time — no race on claim_lifecycle rows
  //   (b) the Stop button can abort between iterations
  //   (c) the progress banner can tick up row-by-row.
  // They reuse the top-level `progress` state so the existing progress banner
  // and Stop button light up automatically.
  // ---------------------------------------------------------------------------

  async function bulkForceAttachAll(fixable) {
    if (!templateId) {
      showAlertMsg('Pick a lifecycle template in the dropdown above first', 'error');
      return;
    }
    if (!fixable || fixable.length === 0) return;

    const newTpl = templates.find(t => String(t.id) === String(templateId));
    const ok = confirm(
      `Force attach ${fixable.length} claim(s) to "${newTpl?.template_code || 'selected template'}"?\n\n` +
      `For each failed row we will:\n` +
      `  1. Detach the existing lifecycle (wipes phase/stage/item/subtask rows)\n` +
      `  2. Re-attach with the template selected in the dropdown above\n\n` +
      `Use the Stop button to abort between rows. Continue?`
    );
    if (!ok) return;

    stopRef.current = false;
    setRowBusyIdx(-2); // -2 = bulk row action running (disables all per-row buttons)
    setProgress({ total: fixable.length, done: 0, errors: 0, stopped: false });

    let done = 0, errors = 0, stoppedEarly = false;
    for (let k = 0; k < fixable.length; k++) {
      if (stopRef.current) { stoppedEarly = true; break; }
      const { i, lid, l } = fixable[k];
      try {
        // 1. Detach
        const delRes = await fetch(`/api/lifecycle/${lid}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_email: user?.email }),
        });
        const delData = await delRes.json().catch(() => ({}));
        if (!delRes.ok) throw new Error(delData.error || 'detach step failed');

        // 2. Re-attach (same body-builder logic used by runBulk + rowForceAttach)
        const attachBody = (() => {
          const claim = claims.find(c => String(c.id) === String(l.id));
          if (source === 'ew' && claim && claim._source === 'claims' && claim.claim_id != null) {
            return {
              claim_id: parseInt(claim.claim_id, 10),
              template_id: parseInt(templateId, 10),
              clear_legacy: clearLegacy,
              user_email: user?.email,
            };
          }
          return source === 'ew'
            ? { ew_claim_id: l.id, template_id: parseInt(templateId, 10), clear_legacy: clearLegacy, user_email: user?.email }
            : { claim_id: parseInt(l.id, 10), template_id: parseInt(templateId, 10), clear_legacy: clearLegacy, user_email: user?.email };
        })();

        const attachRes = await fetch('/api/lifecycle/attach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attachBody),
        });
        const attachData = await attachRes.json().catch(() => ({}));
        if (!attachRes.ok) {
          throw new Error(`Detach ok but re-attach failed: ${attachData.error || 'attach failed'} — row is now in legacy mode, try Force attach again.`);
        }

        updateLogRow(i, {
          ok: true, status: 'fixed',
          detail: `Force-attached ${newTpl?.template_code || `template ${templateId}`}: ${attachData.stages_materialised || 0} stages, ${attachData.items_seeded || 0} items.`,
        });
        done += 1;
      } catch (e) {
        updateLogRow(i, { detail: e.message });
        errors += 1;
      }
      setProgress({ total: fixable.length, done: done + errors, errors, stopped: false });
    }

    setProgress({ total: fixable.length, done: done + errors, errors, stopped: stoppedEarly });
    setRowBusyIdx(-1);
    if (stoppedEarly) {
      showAlertMsg(`Bulk force-attach stopped at ${done + errors}/${fixable.length}. ${done} fixed, ${errors} still failed, ${fixable.length - (done + errors)} skipped.`, 'warning');
    } else {
      showAlertMsg(`Bulk force-attach complete: ${done} fixed, ${errors} still failed`, errors > 0 ? 'error' : 'success');
    }
    loadClaims();
  }

  async function bulkDetachAll(fixable) {
    if (!fixable || fixable.length === 0) return;

    const ok = confirm(
      `Detach ${fixable.length} claim(s)?\n\n` +
      `This wipes the existing lifecycle for each failed row and returns those claims to legacy mode.\n\n` +
      `No re-attach will happen — pick them up in the list above and run Attach again when ready.\n\n` +
      `Use the Stop button to abort between rows. Continue?`
    );
    if (!ok) return;

    stopRef.current = false;
    setRowBusyIdx(-2);
    setProgress({ total: fixable.length, done: 0, errors: 0, stopped: false });

    let done = 0, errors = 0, stoppedEarly = false;
    for (let k = 0; k < fixable.length; k++) {
      if (stopRef.current) { stoppedEarly = true; break; }
      const { i, lid } = fixable[k];
      try {
        const res = await fetch(`/api/lifecycle/${lid}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_email: user?.email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'detach failed');
        updateLogRow(i, {
          ok: true, status: 'detached',
          detail: `Detached lifecycle #${lid}. Claim is back in legacy mode — tick it in the list above and run Attach again to re-apply a template.`,
        });
        done += 1;
      } catch (e) {
        updateLogRow(i, { detail: `Detach failed: ${e.message}` });
        errors += 1;
      }
      setProgress({ total: fixable.length, done: done + errors, errors, stopped: false });
    }

    setProgress({ total: fixable.length, done: done + errors, errors, stopped: stoppedEarly });
    setRowBusyIdx(-1);
    if (stoppedEarly) {
      showAlertMsg(`Bulk detach stopped at ${done + errors}/${fixable.length}. ${done} detached, ${errors} failed, ${fixable.length - (done + errors)} skipped.`, 'warning');
    } else {
      showAlertMsg(`Bulk detach complete: ${done} detached, ${errors} failed`, errors > 0 ? 'error' : 'success');
    }
    loadClaims();
  }

  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <h2>Bulk Attach Lifecycle</h2>
          <p style={{ padding: 40, textAlign: 'center', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>Admin access required.</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="secondary" style={{ fontSize: 12 }} onClick={() => router.push('/lifecycle-templates')}>&larr; Templates</button>
          <h2 style={{ margin: 0 }}>Bulk Attach Lifecycle <span style={{ fontSize: 11, background: '#7c3aed', color: '#fff', padding: '2px 8px', borderRadius: 10, marginLeft: 8, verticalAlign: 'middle' }}>ADMIN</span></h2>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
          Apply the same lifecycle template to multiple existing claim files in one go. Each file is attached individually — if one fails, the rest continue.
        </p>

        {/* Source picker + template picker */}
        <div style={{ marginTop: 14, padding: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <Field label="Claim source">
              <select value={source} onChange={e => { setSource(e.target.value); setTemplateId(''); }}>
                <option value="claims">Main Claims (all LOBs)</option>
                <option value="ew">Extended Warranty</option>
              </select>
            </Field>
            {source === 'claims' && (
              <Field label="Filter by LOB">
                <select value={lob} onChange={e => setLob(e.target.value)}>
                  <option value="">All LOBs</option>
                  {(LOB_LIST || []).map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
            )}
            <Field label="Lifecycle template to attach *">
              <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">-- pick a template --</option>
                {filteredTemplates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.template_code} — {t.template_name}
                    {t.match_portfolio ? ` (${t.match_portfolio})` : ''}
                    {t.match_client ? ` [${t.match_client}]` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Search (ref / name / reg / chassis)">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="type to filter..." />
            </Field>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={onlyWithoutLifecycle} onChange={e => setOnlyWithoutLifecycle(e.target.checked)} /> Only show claims without a lifecycle attached
            </label>
            <label style={{ fontSize: 13, background: '#fee2e2', padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5' }}>
              <input type="checkbox" checked={clearLegacy} onChange={e => setClearLegacy(e.target.checked)} /> Remove legacy stage data for each selected file
            </label>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>
              {filteredClaims.length} candidate file(s) · {selectedCount} selected
            </span>
          </div>
        </div>

        {/* Action bar */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="secondary" onClick={() => toggleAll(true)}>Select all visible</button>
          <button className="secondary" onClick={() => toggleAll(false)}>Clear selection</button>
          <span style={{ flex: 1 }} />
          {progress && !progress.stopped && progress.done < progress.total && (
            <button
              onClick={stopBulk}
              style={{ background: '#dc2626', color: '#fff', padding: '8px 14px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              ■ Stop after current
            </button>
          )}
          <button className="success" onClick={runBulk} disabled={!templateId || selectedCount === 0 || (!!progress && !progress.stopped && progress.done < progress.total)}>
            {progress && !progress.stopped && progress.done < progress.total
              ? `Working ${progress.done}/${progress.total}...`
              : `Attach to ${selectedCount} file(s)`}
          </button>
        </div>

        {/* Progress */}
        {progress && (
          <div style={{
            marginTop: 10, padding: 10, borderRadius: 8, fontSize: 12,
            background: progress.stopped ? '#fefce8' : '#eff6ff',
            border: `1px solid ${progress.stopped ? '#fde047' : '#bfdbfe'}`,
          }}>
            <div style={{ fontWeight: 600 }}>
              {progress.stopped ? 'Stopped' : 'Progress'}: {progress.done}/{progress.total}
              {progress.errors > 0 && <span style={{ color: '#dc2626' }}> · {progress.errors} error(s)</span>}
              {progress.stopped && (progress.total - progress.done) > 0 &&
                <span style={{ color: '#92400e' }}> · {progress.total - progress.done} skipped</span>}
            </div>
            <div style={{ height: 6, background: '#dbeafe', borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${(progress.done / progress.total) * 100}%`,
                background: progress.stopped ? '#ca8a04' : progress.errors > 0 ? '#dc2626' : '#2563eb',
                transition: 'width 0.2s',
              }} />
            </div>
          </div>
        )}

        {/* Claims list */}
        <div style={{ marginTop: 14 }}>
          {loading ? (
            <p style={{ padding: 40, textAlign: 'center' }}>Loading claims...</p>
          ) : filteredClaims.length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center', color: '#999' }}>No claims match the current filter.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="mis-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>
                      <input type="checkbox"
                        checked={selectedCount > 0 && selectedCount === filteredClaims.length}
                        onChange={e => toggleAll(e.target.checked)}
                      />
                    </th>
                    <th>Ref No</th>
                    {source === 'claims' && <th>LOB</th>}
                    <th>{source === 'ew' ? 'Customer / Insured' : 'Insured Name'}</th>
                    <th>Insurer</th>
                    {source === 'ew' && <th>Reg No</th>}
                    {source === 'ew' && <th>Chassis</th>}
                    <th>Current</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.map(c => {
                    const checked = Boolean(selected[c.id]);
                    const alreadyOnEngine = c.uses_lifecycle_engine;
                    return (
                      <tr key={c.id} style={{ background: alreadyOnEngine ? '#f1f5f9' : checked ? '#ede9fe' : undefined, color: alreadyOnEngine ? '#94a3b8' : undefined }}>
                        <td>
                          <input type="checkbox"
                            disabled={alreadyOnEngine}
                            checked={checked}
                            onChange={e => setSelected({ ...selected, [c.id]: e.target.checked })}
                          />
                        </td>
                        <td style={{ fontWeight: 600, color: alreadyOnEngine ? '#94a3b8' : '#7c3aed' }}>
                          {c.ref_number || `#${c.id}`}
                          {source === 'ew' && c._source === 'claims' && (
                            <span title="This claim has LOB=Extended Warranty but no ew_vehicle_claims row yet. It will be attached via the classic claim_id path."
                              style={{ marginLeft: 6, padding: '1px 5px', fontSize: 9, background: '#e0e7ff', color: '#3730a3', borderRadius: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                              classic
                            </span>
                          )}
                        </td>
                        {source === 'claims' && <td>{c.lob || '-'}</td>}
                        <td>{c.insured_name || c.customer_name || '-'}</td>
                        <td>{c.insurer_name || '-'}</td>
                        {source === 'ew' && <td style={{ fontFamily: 'monospace' }}>{c.vehicle_reg_no || '-'}</td>}
                        {source === 'ew' && <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{c.chassis_number || '-'}</td>}
                        <td>
                          {alreadyOnEngine
                            ? <span style={{ padding: '1px 6px', fontSize: 10, background: '#dcfce7', color: '#166534', borderRadius: 6 }}>on engine</span>
                            : <span style={{ padding: '1px 6px', fontSize: 10, background: '#fef3c7', color: '#92400e', borderRadius: 6 }}>legacy</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Log */}
        {log.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px' }}>
              Results
              {(() => {
                const fixable = log
                  .map((l, i) => ({ l, i, lid: !l.ok ? extractLifecycleId(l.detail) : null }))
                  .filter(x => x.lid);
                if (fixable.length === 0) return null;
                return (
                  <span style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#6b7280', alignSelf: 'center' }}>
                      {fixable.length} resolvable
                    </span>
                    <button
                      style={btnSm('#7c3aed', '#fff')}
                      disabled={rowBusyIdx !== -1 || !templateId}
                      onClick={() => bulkForceAttachAll(fixable)}
                      title={
                        templateId
                          ? 'Run Force attach on every failed row (detach existing lifecycle + re-attach with the template picked above). Stops on first error.'
                          : 'Pick a template in the dropdown above first.'
                      }
                    >
                      ⚡ Force attach all ({fixable.length})
                    </button>
                    <button
                      style={btnSm('#dc2626', '#fff')}
                      disabled={rowBusyIdx !== -1}
                      onClick={() => bulkDetachAll(fixable)}
                      title="Run Detach on every failed row. Returns all those claims to legacy mode. Does not re-attach — do that from the list above."
                    >
                      ■ Detach all ({fixable.length})
                    </button>
                  </span>
                );
              })()}
            </h4>
            {log.some(l => !l.ok && extractLifecycleId(l.detail)) && (
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>
                Rows that failed with <em>&quot;already attached&quot;</em> can be
                resolved inline — <strong>Detach</strong> wipes the existing lifecycle,{' '}
                <strong>Force attach</strong> detaches then re-attaches with the template
                picked above, <strong>Reresolve</strong> re-picks a template from the
                claim&apos;s current attributes without detaching.
              </div>
            )}
            <table className="mis-table" style={{ fontSize: 11 }}>
              <thead><tr><th>Ref</th><th>Status</th><th>Detail</th><th style={{ minWidth: 220 }}>Actions</th></tr></thead>
              <tbody>
                {log.map((l, idx) => {
                  const lifecycleId = !l.ok ? extractLifecycleId(l.detail) : null;
                  // Disable row buttons when this row is acting (rowBusyIdx === idx)
                  // OR when a bulk row action is in flight (rowBusyIdx === -2).
                  const isBusy = rowBusyIdx === idx;
                  const bulkBusy = rowBusyIdx === -2;
                  const disabled = isBusy || bulkBusy;
                  const rowBg =
                    l.status === 'fixed'     ? '#ecfdf5'
                  : l.status === 'detached'  ? '#f0fdf4'
                  : !l.ok                    ? '#fef2f2'
                  :                            undefined;
                  return (
                    <tr key={`${l.id}-${idx}`} style={{ background: rowBg }}>
                      <td style={{ fontWeight: 600 }}>{l.ref}</td>
                      <td>
                        <span style={{
                          padding: '1px 6px', fontSize: 10, borderRadius: 6,
                          background:
                            l.status === 'fixed'    ? '#bbf7d0'
                          : l.status === 'detached' ? '#dbeafe'
                          : l.ok                    ? '#dcfce7'
                          :                           '#fee2e2',
                          color:
                            l.status === 'fixed'    ? '#14532d'
                          : l.status === 'detached' ? '#1e3a8a'
                          : l.ok                    ? '#166534'
                          :                           '#991b1b',
                        }}>
                          {l.status === 'fixed'    ? 'FIXED'
                          : l.status === 'detached' ? 'DETACHED'
                          : l.ok                    ? 'OK'
                          :                           'FAIL'}
                        </span>
                      </td>
                      <td style={{
                        color:
                          l.status === 'fixed'    ? '#14532d'
                        : l.status === 'detached' ? '#1e3a8a'
                        : l.ok                    ? '#475569'
                        :                           '#991b1b',
                      }}>{l.detail}</td>
                      <td>
                        {lifecycleId ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button
                              style={btnSm('#dc2626', '#fff')}
                              disabled={disabled}
                              onClick={() => rowDetach(idx, lifecycleId)}
                              title="Delete the existing lifecycle (wipes phase/stage/item/subtask rows, returns claim to legacy mode)."
                            >
                              {isBusy ? '…' : 'Detach'}
                            </button>
                            <button
                              style={btnSm('#7c3aed', '#fff')}
                              disabled={disabled || !templateId}
                              onClick={() => rowForceAttach(idx, lifecycleId, l.id)}
                              title={
                                templateId
                                  ? 'Detach the existing lifecycle and immediately re-attach the template currently selected in the dropdown above.'
                                  : 'Pick a template in the dropdown above first.'
                              }
                            >
                              {isBusy ? '…' : 'Force attach'}
                            </button>
                            <button
                              style={btnSm('#0891b2', '#fff')}
                              disabled={disabled}
                              onClick={() => rowReresolve(idx, lifecycleId)}
                              title="Keep the existing lifecycle but re-pick its template from the claim's current attributes. Preserves completed stages."
                            >
                              {isBusy ? '…' : 'Reresolve'}
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: '#9ca3af', fontSize: 10 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

// Pulls the `lifecycle_id=N` token out of the attach API's 409 error message:
//   "A lifecycle is already attached to this EW claim (lifecycle_id=31). Detach or reresolve instead."
// Returns the integer, or null if the error is a different shape.
function extractLifecycleId(detail) {
  if (!detail) return null;
  const m = String(detail).match(/lifecycle_id\s*=\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Compact button style for the inline row actions. Inline so the results
// table keeps its tight layout and doesn't inherit .mis-table button spacing.
function btnSm(bg, fg) {
  return {
    padding: '3px 8px',
    fontSize: 10.5,
    fontWeight: 600,
    background: bg,
    color: fg,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    lineHeight: 1.3,
  };
}
