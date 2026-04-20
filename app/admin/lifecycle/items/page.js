'use client';
// =============================================================================
// /admin/lifecycle/items — Item-Type Catalog
// =============================================================================
// Columns per v2 mockup:
//   Item type · Category (Doc/Apr/Qry/Int) · Default party · Firm clock (Pauses/Runs)
//   Insurer clock · Used by templates · Actions
//
// Plus the v1 "default pending items" feel — this is the master catalog that
// templates' default-item tables point into.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import LifecycleAdminShell, {
  Card, Note, Badge, Modal, FormGrid, FG, Btn, Tag,
} from '@/components/LifecycleAdminShell';

const CATEGORIES = [
  { key: 'document',  label: 'Document',   short: 'Doc' },
  { key: 'approval',  label: 'Approval',   short: 'Apr' },
  { key: 'query',     label: 'Query',      short: 'Qry' },
  { key: 'internal',  label: 'Internal',   short: 'Int' },
];

const PENDING_WITH = [
  { key: 'insured',  label: 'Insured' },
  { key: 'insurer',  label: 'Insurer' },
  { key: 'broker',   label: 'Broker' },
  { key: 'internal', label: 'Surveyor (internal)' },
  { key: 'other',    label: 'Other (dealer/OEM/fire-dept/...)' },
];

export default function ItemCatalogPage() {
  const [items, setItems]       = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showNew, setShowNew]   = useState(false);
  const [editing, setEditing]   = useState(null);
  const [filter, setFilter]     = useState({ q: '', category: '', pending: '' });

  const reload = useCallback(async () => {
    setLoading(true);
    const [iR, tR] = await Promise.all([
      fetch('/api/lifecycle/items/catalog').then(r => r.json()).catch(() => ({ items: [] })),
      fetch('/api/lifecycle/templates').then(r => r.json()).catch(() => ({ templates: [] })),
    ]);
    setItems(iR.items || []);
    setTemplates(tR.templates || []);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = items.filter(i => {
    if (filter.q && !(`${i.item_name} ${i.item_code} ${i.description || ''}`.toLowerCase().includes(filter.q.toLowerCase()))) return false;
    if (filter.category && i.category !== filter.category) return false;
    if (filter.pending && i.default_pending_with !== filter.pending) return false;
    return true;
  });

  const byCat = {};
  for (const i of items) byCat[i.category] = (byCat[i.category] || 0) + 1;

  return (
    <LifecycleAdminShell
      view="items"
      title="Item-Type Catalog"
      subtitle="Master list of every pending-requirement item type. Templates use this as their vocabulary for Phase-4 checklists."
      stats={{ items: items.length }}
      actions={<Btn variant="primary" onClick={() => setShowNew(true)}>+ New item type</Btn>}
    >
      {loading && <Note tone="info">Loading catalog…</Note>}

      {/* Category summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        {CATEGORIES.map(c => (
          <div key={c.key} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 10.5, color: '#6b7280', fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#1e3a5f', marginTop: 3 }}>
              {byCat[c.key] || 0}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <Card>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Search item name / code / description…"
            value={filter.q}
            onChange={e => setFilter({ ...filter, q: e.target.value })}
            style={{ ...inp, flex: '1 1 260px' }}
          />
          <select value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}
                  style={{ ...inp, width: 180 }}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select value={filter.pending} onChange={e => setFilter({ ...filter, pending: e.target.value })}
                  style={{ ...inp, width: 220 }}>
            <option value="">All pending parties</option>
            {PENDING_WITH.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <div style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
            Showing {filtered.length} of {items.length}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b7280' }}>
            {items.length === 0 ? 'No catalog items yet. Create one to get started.' : 'No items match the filter.'}
          </div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr style={tHeadRow}>
                <th style={th}>Item type</th>
                <th style={th}>Category</th>
                <th style={th}>Default party</th>
                <th style={th}>Firm clock</th>
                <th style={th}>Insurer clock</th>
                <th style={th}>Reminders</th>
                <th style={th}>Used by templates</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => {
                const usedByTemplates = templates.filter(t =>
                  (t.default_item_codes || []).includes(it.item_code)
                );
                return (
                  <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{it.item_name}</div>
                      <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 2 }}>
                        <code style={{ fontFamily: 'monospace' }}>{it.item_code}</code>
                        {it.description && <> · {it.description}</>}
                      </div>
                    </td>
                    <td style={td}>
                      <Badge tone="lob">
                        {CATEGORIES.find(c => c.key === it.category)?.short || it.category}
                      </Badge>
                    </td>
                    <td style={td}>
                      {(PENDING_WITH.find(p => p.key === it.default_pending_with) || { label: it.default_pending_with }).label}
                    </td>
                    <td style={td}>
                      <Tag tone={it.firm_clock_behaviour === 'pause' ? 'firm-pause' : 'firm-run'}>
                        {it.firm_clock_behaviour === 'pause' ? 'Pauses' : 'Runs'}
                      </Tag>
                    </td>
                    <td style={td}>
                      <Tag tone={it.insurer_clock_behaviour === 'pause' ? 'insurer-pause' : 'insurer-run'}>
                        {it.insurer_clock_behaviour === 'pause' ? 'Pauses' : 'Runs'}
                      </Tag>
                    </td>
                    <td style={td}>
                      {Array.isArray(it.reminder_schedule_days) && it.reminder_schedule_days.length
                        ? <span style={{ fontSize: 11.5 }}>day {it.reminder_schedule_days.join(', ')}</span>
                        : '—'}
                    </td>
                    <td style={td}>
                      {usedByTemplates.length
                        ? usedByTemplates.map(t => (
                            <Badge key={t.id} tone="portfolio">{t.template_code}</Badge>
                          ))
                        : <span style={{ fontSize: 11, color: '#9ca3af' }}>(none)</span>}
                    </td>
                    <td style={td}>
                      {it.is_active
                        ? <Badge tone="complete">Active</Badge>
                        : <Badge tone="skipped">Inactive</Badge>}
                    </td>
                    <td style={td}>
                      <Btn size="xs" onClick={() => setEditing(it)}>Edit</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Note tone="info">
        <strong>How this ties in —</strong>{' '}
        Templates attach a subset of these items as <em>default pending items</em>.
        When a claim lands on a template, the engine auto-creates Phase-4 pending-item
        rows from that subset. Surveyors can still <em>add custom items</em> outside the catalog on
        individual claims (open to Admin + Lead Surveyor only).
      </Note>

      <ItemModal
        open={showNew || !!editing}
        onClose={() => { setShowNew(false); setEditing(null); }}
        editing={editing}
        onSaved={() => { setShowNew(false); setEditing(null); reload(); }}
      />
    </LifecycleAdminShell>
  );
}

function ItemModal({ open, onClose, editing, onSaved }) {
  const [form, setForm] = useState(() => editing || {
    item_code: '', item_name: '', description: '',
    category: 'document', default_pending_with: 'insured',
    firm_clock_behaviour: 'pause', insurer_clock_behaviour: 'run',
    evidence_description: '', reminder_schedule_days: [7, 14, 21, 28],
    is_active: true,
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Re-seed form whenever `editing` changes
  useEffect(() => {
    setForm(editing || {
      item_code: '', item_name: '', description: '',
      category: 'document', default_pending_with: 'insured',
      firm_clock_behaviour: 'pause', insurer_clock_behaviour: 'run',
      evidence_description: '', reminder_schedule_days: [7, 14, 21, 28],
      is_active: true,
    });
    setErr(null);
  }, [editing, open]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url    = editing ? `/api/lifecycle/items/catalog/${editing.id}` : '/api/lifecycle/items/catalog';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      onSaved();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose}
      title={editing ? `Edit: ${editing.item_name}` : 'New item type'} large
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : (editing ? 'Save changes' : 'Create item')}
        </Btn>
      </>}
    >
      {err && <Note tone="danger">{err}</Note>}
      <FormGrid>
        <FG label="Code" hint="UPPER_SNAKE unique.">
          <input style={inp} value={form.item_code}
            onChange={e => setForm({ ...form, item_code: e.target.value.toUpperCase() })}
            disabled={!!editing} />
        </FG>
        <FG label="Name">
          <input style={inp} value={form.item_name}
            onChange={e => setForm({ ...form, item_name: e.target.value })} />
        </FG>
        <FG label="Description">
          <textarea style={{ ...inp, fontFamily: 'inherit' }} rows={2} value={form.description || ''}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </FG>
        <FG label="Category">
          <select style={inp} value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </FG>
        <FG label="Default pending party">
          <select style={inp} value={form.default_pending_with}
            onChange={e => setForm({ ...form, default_pending_with: e.target.value })}>
            {PENDING_WITH.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </FG>
        <FG label="Firm clock" hint="Whether the firm-side TAT clock pauses while this item is open.">
          <select style={inp} value={form.firm_clock_behaviour}
            onChange={e => setForm({ ...form, firm_clock_behaviour: e.target.value })}>
            <option value="pause">Pauses while open</option>
            <option value="run">Keeps running</option>
          </select>
        </FG>
        <FG label="Insurer clock" hint="Insurer-facing TAT behaviour. Usually pauses only for insurer-side items.">
          <select style={inp} value={form.insurer_clock_behaviour}
            onChange={e => setForm({ ...form, insurer_clock_behaviour: e.target.value })}>
            <option value="pause">Pauses while open</option>
            <option value="run">Keeps running</option>
          </select>
        </FG>
        <FG label="Evidence description" hint="What file/proof closes this item. Shown on the close-item modal.">
          <input style={inp} value={form.evidence_description || ''}
            onChange={e => setForm({ ...form, evidence_description: e.target.value })}
            placeholder="e.g., Signed tax invoice PDF, or confirmation email screenshot" />
        </FG>
        <FG label="Reminder schedule" hint="Days after opening when automatic reminders fire. Comma-separated.">
          <input style={inp}
            value={(form.reminder_schedule_days || []).join(', ')}
            onChange={e => setForm({
              ...form,
              reminder_schedule_days: e.target.value.split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n)),
            })} />
        </FG>
        <FG label="Status">
          <label style={chkWrap}>
            <input type="checkbox" checked={!!form.is_active}
              onChange={e => setForm({ ...form, is_active: e.target.checked })} />
            Active (selectable in template editor)
          </label>
        </FG>
      </FormGrid>
    </Modal>
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
const chkWrap = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' };
