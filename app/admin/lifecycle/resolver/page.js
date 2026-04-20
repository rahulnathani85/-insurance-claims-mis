'use client';
// =============================================================================
// /admin/lifecycle/resolver — Resolution Debugger
// =============================================================================
// Merges both mockups:
//   v1: form inputs → walking-cascade preview with ASCII block
//   v2: side-by-side "why this template / why not others" explanation
//
// Uses client-side resolution logic when no /api/lifecycle/resolve endpoint
// is wired; falls back to server when available.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, FormGrid, FG, Btn,
} from '@/components/LifecycleAdminShell';
import { LOB_LIST } from '@/lib/constants';

const DIMS = [
  ['match_lob',              'LOB'],
  ['match_policy_type',      'Policy type'],
  ['match_cause_of_loss',    'Cause of loss'],
  ['match_subject_matter',   'Subject matter'],
  ['match_portfolio',        'Portfolio / OEM'],
  ['match_client',           'Client / Insured'],
  ['match_size_band',        'Size band'],
  ['match_nature',           'Nature'],
  ['match_appointment_src',  'Appointment source'],
];

const PHASE_NAMES = {
  1: 'Appointment', 2: 'Survey & Inspection', 3: 'ILA & LOR',
  4: 'Pending Requirements', 5: 'Assessment', 6: 'Report', 7: 'Delivery',
};

export default function ResolverPage() {
  const [templates, setTemplates] = useState([]);
  const [stagesMap, setStagesMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [claim, setClaim] = useState({
    match_lob: 'Extended Warranty',
    match_policy_type: '',
    match_cause_of_loss: '',
    match_subject_matter: '',
    match_portfolio: 'Toyota True Warranty',
    match_client: '',
    match_size_band: 'Medium',
    match_nature: 'Routine',
    match_appointment_src: 'Insurer-direct',
  });

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/lifecycle/templates').then(r => r.json());
      const active = (r.templates || []).filter(t => t.is_active);
      setTemplates(active);
      // Pre-fetch stages for each to enable merged preview
      const map = {};
      await Promise.all(active.map(async t => {
        const s = await fetch(`/api/lifecycle/templates/${t.id}/stages`).then(r => r.json()).catch(() => ({ stages: [] }));
        map[t.id] = s.stages || [];
      }));
      setStagesMap(map);
      setLoading(false);
    })();
  }, []);

  // Resolution logic: score each template by how many dims match.
  // Null/blank dim on template is considered "match everything".
  // Higher match count + higher priority wins.
  const { matches, nonMatches, chosen, merged } = useMemo(() => {
    const matches = [];
    const nonMatches = [];
    for (const t of templates) {
      const reasons = [];
      const mismatches = [];
      let strictMatch = true;
      let specificityScore = 0;
      for (const [k] of DIMS) {
        const tplVal = t[k];
        const claimVal = claim[k];
        if (!tplVal) continue; // (any) — passes
        if ((claimVal || '').toLowerCase() === (tplVal || '').toLowerCase()) {
          reasons.push(`${k.replace('match_', '')} = ${tplVal}`);
          specificityScore++;
        } else {
          mismatches.push(`${k.replace('match_', '')}: claim="${claimVal || '(blank)'}" vs tpl="${tplVal}"`);
          strictMatch = false;
        }
      }
      if (strictMatch) matches.push({ tpl: t, specificityScore, reasons });
      else nonMatches.push({ tpl: t, mismatches });
    }
    // sort by specificity desc, priority desc
    matches.sort((a, b) => (b.specificityScore - a.specificityScore) || ((b.tpl.priority || 0) - (a.tpl.priority || 0)));

    // Find first full-list (base) template up the chain
    let base = matches.find(m => m.tpl.resolution_type === 'full_list');
    let override = matches.find(m => m.tpl.resolution_type === 'override');
    let chosen = override || base;

    // Build merged stage list (base + overrides' deltas)
    let merged = [];
    if (base) {
      merged = (stagesMap[base.tpl.id] || []).map(s => ({ ...s, _from: base.tpl.template_code }));
    }
    if (override && override.tpl.parent_template_id === base?.tpl?.id) {
      const deltas = (stagesMap[override.tpl.id] || []).map(s => ({ ...s, _from: override.tpl.template_code, _delta: true }));
      // For each delta, apply operation
      for (const d of deltas) {
        if (d.delta_operation === 'replace') {
          merged = merged.filter(s => s.stage_code !== d.stage_code);
          merged.push(d);
        } else if (d.delta_operation === 'remove') {
          merged = merged.filter(s => s.stage_code !== d.stage_code);
        } else {
          merged.push(d);
        }
      }
      merged.sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0)
                         || (a.sequence_within_phase || 0) - (b.sequence_within_phase || 0));
    }

    return { matches, nonMatches, chosen, merged };
  }, [templates, claim, stagesMap]);

  return (
    <LifecycleAdminShell
      view="resolver"
      title="Resolution Debugger"
      subtitle="Enter hypothetical claim attributes. The engine walks the cascade and shows which template would apply and why."
    >
      {loading && <Note tone="info">Loading templates…</Note>}

      <Card title="Claim attributes" subtitle="Fill any subset. Blank fields are treated as not-specified.">
        <FormGrid>
          <FG label="LOB">
            <select style={inp} value={claim.match_lob}
              onChange={e => setClaim({ ...claim, match_lob: e.target.value })}>
              <option value="">(blank)</option>
              {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </FG>
          <FG label="Policy type">
            <input style={inp} value={claim.match_policy_type}
              onChange={e => setClaim({ ...claim, match_policy_type: e.target.value })} />
          </FG>
          <FG label="Cause of loss">
            <input style={inp} value={claim.match_cause_of_loss}
              onChange={e => setClaim({ ...claim, match_cause_of_loss: e.target.value })} />
          </FG>
          <FG label="Subject matter">
            <input style={inp} value={claim.match_subject_matter}
              onChange={e => setClaim({ ...claim, match_subject_matter: e.target.value })} />
          </FG>
          <FG label="Portfolio / OEM">
            <input style={inp} value={claim.match_portfolio}
              onChange={e => setClaim({ ...claim, match_portfolio: e.target.value })} />
          </FG>
          <FG label="Client / Insured">
            <input style={inp} value={claim.match_client}
              onChange={e => setClaim({ ...claim, match_client: e.target.value })} />
          </FG>
          <FG label="Size band">
            <select style={inp} value={claim.match_size_band}
              onChange={e => setClaim({ ...claim, match_size_band: e.target.value })}>
              <option value="">(blank)</option>
              <option>Small</option><option>Medium</option><option>Large</option><option>Jumbo</option>
            </select>
          </FG>
          <FG label="Nature">
            <select style={inp} value={claim.match_nature}
              onChange={e => setClaim({ ...claim, match_nature: e.target.value })}>
              <option value="">(blank)</option>
              <option>Routine</option><option>Complex</option><option>CAT-event</option>
            </select>
          </FG>
          <FG label="Appointment source">
            <select style={inp} value={claim.match_appointment_src}
              onChange={e => setClaim({ ...claim, match_appointment_src: e.target.value })}>
              <option value="">(blank)</option>
              <option>Insurer-direct</option><option>Broker</option><option>Insured</option>
            </select>
          </FG>
        </FormGrid>
      </Card>

      {chosen ? (
        <Card
          title={
            <>Chosen template: <span style={{ color: '#4B0082' }}>{chosen.tpl.template_name}</span></>
          }
          subtitle={
            <>
              <Badge tone={chosen.tpl.resolution_type === 'override' ? 'override' : 'full'}>
                {chosen.tpl.resolution_type === 'override' ? 'Override' : 'Full list'}
              </Badge>
              <span style={{ color: '#6b7280' }}>
                {chosen.specificityScore} matching dimension{chosen.specificityScore !== 1 ? 's' : ''}
                {' · '}priority {chosen.tpl.priority}
                {' · '}code <code style={{ fontFamily: 'monospace' }}>{chosen.tpl.template_code}</code>
              </span>
            </>
          }
        >
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            <strong>Because:</strong>{' '}
            {chosen.reasons.length
              ? chosen.reasons.map(r => <Badge key={r} tone="lob">{r}</Badge>)
              : <em style={{ color: '#6b7280' }}>No dimensions specified — matched as catch-all.</em>}
          </div>
        </Card>
      ) : (
        !loading && <Note tone="warn">No active template matches this claim. The engine would fall through to whichever default template exists — or throw if none.</Note>
      )}

      {/* Cascade trace */}
      <Card
        title="Cascade trace"
        subtitle="Templates walked in order of specificity. The first match that can stand on its own wins."
      >
        <div style={{
          background: '#111827', color: '#E5E7EB', padding: 16, borderRadius: 8,
          fontFamily: 'monospace', fontSize: 11.5, lineHeight: 1.6, whiteSpace: 'pre-wrap',
        }}>
          <div style={{ color: '#9ca3af' }}>// Walking templates from most specific to most general</div>
          {matches.length === 0 && <div style={{ color: '#F472B6' }}>NO MATCHES</div>}
          {matches.map((m, idx) => (
            <div key={m.tpl.id}>
              [{idx + 1}] <span style={{ color: '#A7F3D0' }}>{m.tpl.template_code}</span>
              {' → '}
              {m.tpl.resolution_type === 'full_list' ? (
                <span style={{ color: '#60A5FA' }}>Full list · {stagesMap[m.tpl.id]?.length || 0} stages · STOP</span>
              ) : (
                <span style={{ color: '#FBBF24' }}>Override · {stagesMap[m.tpl.id]?.length || 0} deltas</span>
              )}
              {' — '}<span style={{ color: '#6B7280' }}>(dims matched: {m.specificityScore}, priority {m.tpl.priority})</span>
            </div>
          ))}
          {'\n'}
          <div style={{ color: '#9ca3af' }}>// Non-matches (shown for debugging):</div>
          {nonMatches.slice(0, 5).map(nm => (
            <div key={nm.tpl.id} style={{ opacity: 0.7 }}>
              ✗ <span style={{ color: '#F87171' }}>{nm.tpl.template_code}</span>
              {' — '}{nm.mismatches[0] || 'no mismatch shown'}
              {nm.mismatches.length > 1 && <span> (+{nm.mismatches.length - 1} more)</span>}
            </div>
          ))}
        </div>
      </Card>

      {/* Resolved stage list (merged) */}
      {chosen && merged.length > 0 && (
        <Card
          title="Resolved stages"
          subtitle={`Merged stage list that would be seeded on a claim matching this attribute set (${merged.length} stages)`}
        >
          <table style={tbl}>
            <thead>
              <tr style={tHeadRow}>
                <th style={th}>#</th>
                <th style={th}>Stage</th>
                <th style={th}>Phase</th>
                <th style={th}>From template</th>
                <th style={th}>Owner</th>
                <th style={th}>Firm TAT</th>
              </tr>
            </thead>
            <tbody>
              {merged.map((s, idx) => (
                <tr key={s.id || idx} style={{
                  borderBottom: '1px solid #f3f4f6',
                  background: s._delta ? '#fef3c7' : 'transparent',
                }}>
                  <td style={td}>{s.sequence_number}.{s.sequence_within_phase || 1}</td>
                  <td style={td}><strong>{s.stage_name}</strong></td>
                  <td style={td}>
                    <Badge tone="lob">{s.universal_phase}. {PHASE_NAMES[s.universal_phase]}</Badge>
                  </td>
                  <td style={td}>
                    {s._delta
                      ? <Badge tone="override">{s._from}</Badge>
                      : <Badge tone="full">{s._from}</Badge>}
                  </td>
                  <td style={td}>{s.owner_role || '—'}</td>
                  <td style={td}>{s.firm_tat_hours ? `${s.firm_tat_hours}h` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </LifecycleAdminShell>
  );
}

const inp = {
  width: '100%', padding: '7px 10px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
};
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
