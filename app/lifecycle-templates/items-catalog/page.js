'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const CATEGORIES = ['document', 'approval', 'query', 'internal', 'other'];
const PARTIES = ['insured', 'insurer', 'broker', 'surveyor_internal', 'other'];
const CLOCK_BEHAVIOURS = ['pause', 'run'];

export default function ItemCatalogPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [filterCat, setFilterCat] = useState('');
  const [editingId, setEditingId] = useState(null);

  const emptyItem = {
    item_code: '', item_name: '', description: '',
    category: 'document',
    default_pending_with: 'insured',
    firm_clock_behaviour: 'pause',
    insurer_clock_behaviour: 'run',
    evidence_description: '',
    reminder_schedule_days: [7, 14, 21, 28],
    is_active: true,
  };
  const [ni, setNi] = useState(emptyItem);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch('/api/lifecycle/items/catalog', { cache: 'no-store' });
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); setItems([]); }
    finally { setLoading(false); }
  }

  function showAlertMsg(msg, type = 'success') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  }

  async function saveNew() {
    if (!ni.item_code.trim() || !ni.item_name.trim()) {
      showAlertMsg('item_code and item_name are required', 'error');
      return;
    }
    try {
      const res = await fetch('/api/lifecycle/items/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ni),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Create failed');
      }
      showAlertMsg(`Item ${ni.item_code} created`);
      setShowNew(false); setNi(emptyItem);
      load();
    } catch (e) { showAlertMsg(e.message, 'error'); }
  }

  async function saveEdit(item) {
    try {
      const res = await fetch('/api/lifecycle/items/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, ...item }),
      });
      if (!res.ok) throw new Error('Update failed');
      showAlertMsg(`Item ${item.item_code} updated`);
      setEditingId(null);
      load();
    } catch (e) { showAlertMsg(e.message, 'error'); }
  }

  async function toggleActive(it) {
    await saveEdit({ ...it, is_active: !it.is_active });
  }

  const filtered = items.filter(i => (filterCat ? i.category === filterCat : true));

  if (!isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <h2>Item Catalog</h2>
          <p style={{ padding: 40, textAlign: 'center', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>
            Admin access required. The pending-item catalog is only editable by administrators.
          </p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Phase-4 Item Catalog <span style={{ fontSize: 11, background: '#9d174d', color: '#fff', padding: '2px 8px', borderRadius: 10, marginLeft: 8, verticalAlign: 'middle' }}>ADMIN</span></h2>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Master list of pending-requirement item types. Clock-pause behaviour and default-pending-party live here.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary" onClick={() => router.push('/lifecycle-templates')}>&larr; Templates</button>
            <button className="success" onClick={() => setShowNew(s => !s)}>{showNew ? '- Cancel' : '+ New Item'}</button>
          </div>
        </div>

        {/* New item form */}
        {showNew && (
          <div style={{ marginTop: 16, padding: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <h4 style={{ marginBottom: 10 }}>Create new catalog item</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
              <Field label="Item code *"><input value={ni.item_code} onChange={e => setNi({ ...ni, item_code: e.target.value.trim() })} /></Field>
              <Field label="Item name *"><input value={ni.item_name} onChange={e => setNi({ ...ni, item_name: e.target.value })} /></Field>
              <Field label="Category">
                <select value={ni.category} onChange={e => setNi({ ...ni, category: e.target.value })}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Default pending with">
                <select value={ni.default_pending_with} onChange={e => setNi({ ...ni, default_pending_with: e.target.value })}>
                  {PARTIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Firm clock when open">
                <select value={ni.firm_clock_behaviour} onChange={e => setNi({ ...ni, firm_clock_behaviour: e.target.value })}>
                  {CLOCK_BEHAVIOURS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Insurer clock when open">
                <select value={ni.insurer_clock_behaviour} onChange={e => setNi({ ...ni, insurer_clock_behaviour: e.target.value })}>
                  {CLOCK_BEHAVIOURS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Description"><input value={ni.description} onChange={e => setNi({ ...ni, description: e.target.value })} /></Field>
            <Field label="Evidence description (what proves closure)"><input value={ni.evidence_description} onChange={e => setNi({ ...ni, evidence_description: e.target.value })} /></Field>
            <div style={{ marginTop: 10 }}>
              <button className="success" onClick={saveNew}>Create</button>
              <button className="secondary" style={{ marginLeft: 6 }} onClick={() => { setShowNew(false); setNi(emptyItem); }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Filter */}
        <div style={{ marginTop: 16, padding: 10, background: '#f1f5f9', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 12 }}>
            Category:&nbsp;
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option value="">All</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>{filtered.length} of {items.length} items</span>
        </div>

        {/* Table */}
        <div style={{ marginTop: 14 }}>
          {loading ? (
            <p style={{ padding: 40, textAlign: 'center' }}>Loading catalog...</p>
          ) : filtered.length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center', color: '#999' }}>No items.</p>
          ) : (
            <table className="mis-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Category</th>
                  <th>Default party</th><th>Firm clock</th><th>Insurer clock</th>
                  <th>Evidence</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => {
                  const isEditing = editingId === it.id;
                  return (
                    <tr key={it.id} style={{ background: it.is_active ? undefined : '#fafafa', color: it.is_active ? undefined : '#94a3b8' }}>
                      <td style={{ fontFamily: 'monospace', color: '#9d174d', fontWeight: 600 }}>{it.item_code}</td>
                      <td>
                        {isEditing
                          ? <input value={it.item_name} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, item_name: e.target.value } : x))} />
                          : it.item_name}
                      </td>
                      <td>
                        {isEditing
                          ? <select value={it.category} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, category: e.target.value } : x))}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                          : it.category}
                      </td>
                      <td>
                        {isEditing
                          ? <select value={it.default_pending_with} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, default_pending_with: e.target.value } : x))}>{PARTIES.map(p => <option key={p} value={p}>{p}</option>)}</select>
                          : it.default_pending_with}
                      </td>
                      <td>
                        {isEditing
                          ? <select value={it.firm_clock_behaviour} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, firm_clock_behaviour: e.target.value } : x))}>{CLOCK_BEHAVIOURS.map(b => <option key={b} value={b}>{b}</option>)}</select>
                          : <span style={{ padding: '1px 6px', borderRadius: 6, fontSize: 10, background: it.firm_clock_behaviour === 'pause' ? '#fee2e2' : '#dcfce7', color: it.firm_clock_behaviour === 'pause' ? '#991b1b' : '#166534' }}>{it.firm_clock_behaviour}</span>}
                      </td>
                      <td>
                        {isEditing
                          ? <select value={it.insurer_clock_behaviour} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, insurer_clock_behaviour: e.target.value } : x))}>{CLOCK_BEHAVIOURS.map(b => <option key={b} value={b}>{b}</option>)}</select>
                          : <span style={{ padding: '1px 6px', borderRadius: 6, fontSize: 10, background: it.insurer_clock_behaviour === 'pause' ? '#fee2e2' : '#dcfce7', color: it.insurer_clock_behaviour === 'pause' ? '#991b1b' : '#166534' }}>{it.insurer_clock_behaviour}</span>}
                      </td>
                      <td style={{ fontSize: 11, color: '#475569' }}>
                        {isEditing
                          ? <input value={it.evidence_description || ''} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, evidence_description: e.target.value } : x))} />
                          : (it.evidence_description || '-')}
                      </td>
                      <td>
                        <span style={{ padding: '1px 6px', borderRadius: 6, fontSize: 10, background: it.is_active ? '#dcfce7' : '#f1f5f9', color: it.is_active ? '#166534' : '#475569' }}>
                          {it.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isEditing
                          ? <>
                              <button className="success" style={{ fontSize: 10, padding: '2px 6px', marginRight: 4 }} onClick={() => saveEdit(it)}>Save</button>
                              <button className="secondary" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => { setEditingId(null); load(); }}>Cancel</button>
                            </>
                          : <>
                              <button className="secondary" style={{ fontSize: 10, padding: '2px 6px', marginRight: 4 }} onClick={() => setEditingId(it.id)}>Edit</button>
                              <button className="secondary" style={{ fontSize: 10, padding: '2px 6px', color: it.is_active ? '#dc2626' : '#15803d' }} onClick={() => toggleActive(it)}>{it.is_active ? 'Deactivate' : 'Activate'}</button>
                            </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: 20, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12 }}>
          <b>Clock behaviour reminder:</b> "pause" means the firm/insurer SLA clock stops while this item is open; "run" means the clock keeps ticking. These defaults apply to every claim that inherits this item — change them here to affect ALL new claims (existing claims keep the snapshot value assigned at attach-time).
        </div>
      </div>
    </PageLayout>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginTop: 6 }}>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}
