'use client';
import { useState, useEffect, useCallback } from 'react';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const LEVEL_LABELS = { 1: 'LOB', 2: 'Policy Type', 3: 'Cause of Loss', 4: 'Subject Matter' };
const LEVEL_COLORS = {
  1: { bg: '#7c3aed', text: '#fff' },
  2: { bg: '#2563eb', text: '#fff' },
  3: { bg: '#059669', text: '#fff' },
  4: { bg: '#d97706', text: '#fff' },
};

export default function ClaimCategoriesPage() {
  const { user } = useAuth();
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [addingUnder, setAddingUnder] = useState(null); // parent node for "add child"

  const loadTree = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/claim-categories?active_only=false');
      const data = await res.json();
      setTree(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load categories:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  function showAlert(msg, type = 'success') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function expandAll() {
    const all = {};
    function walk(nodes) { nodes.forEach(n => { all[n.id] = true; if (n.children) walk(n.children); }); }
    walk(tree);
    setExpanded(all);
  }

  function selectNode(node) {
    setSelected(node);
    setEditForm({ ...node });
    setAddingUnder(null);
  }

  function startAddChild(parentNode) {
    const childLevel = parentNode ? parentNode.level + 1 : 1;
    if (childLevel > 4) { showAlert('Maximum 4 levels allowed', 'error'); return; }
    setAddingUnder(parentNode);
    setSelected(null);
    setEditForm({
      parent_id: parentNode?.id || null,
      name: '',
      level: childLevel,
      level_label: LEVEL_LABELS[childLevel] || '',
      code: '',
      icon: childLevel === 1 ? '' : undefined,
      color: childLevel === 1 ? '#7c3aed' : undefined,
      sort_order: 0,
      is_active: true,
    });
  }

  async function handleSave() {
    if (!editForm.name?.trim()) { showAlert('Name is required', 'error'); return; }
    try {
      setSaving(true);
      const isNew = !editForm.id;
      const method = isNew ? 'POST' : 'PUT';
      const payload = { ...editForm };
      if (isNew) delete payload.id;

      const res = await fetch('/api/claim-categories', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }
      const saved = await res.json();
      showAlert(isNew ? `"${saved.name}" created` : `"${saved.name}" updated`);
      setSelected(null);
      setAddingUnder(null);
      setEditForm({});
      await loadTree();
      // Auto-expand parent to show new node
      if (saved.parent_id) setExpanded(prev => ({ ...prev, [saved.parent_id]: true }));
    } catch (e) {
      showAlert(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(node) {
    try {
      await fetch('/api/claim-categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: node.id, is_active: !node.is_active }),
      });
      showAlert(`"${node.name}" ${node.is_active ? 'deactivated' : 'activated'}`);
      loadTree();
    } catch (e) {
      showAlert(e.message, 'error');
    }
  }

  // Render tree node recursively
  function renderNode(node, depth = 0) {
    const isExpanded = expanded[node.id];
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selected?.id === node.id;
    const levelColor = LEVEL_COLORS[node.level] || LEVEL_COLORS[4];

    return (
      <div key={node.id} style={{ marginLeft: depth * 20 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
            borderRadius: 6, cursor: 'pointer', fontSize: 13,
            background: isSelected ? '#ede9fe' : 'transparent',
            border: isSelected ? '1px solid #7c3aed' : '1px solid transparent',
            opacity: node.is_active ? 1 : 0.4,
            transition: 'all 0.15s',
          }}
          onClick={() => selectNode(node)}
          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
        >
          {/* Expand/collapse */}
          <span
            onClick={e => { e.stopPropagation(); toggleExpand(node.id); }}
            style={{ width: 18, textAlign: 'center', fontSize: 10, color: '#94a3b8', cursor: 'pointer', userSelect: 'none' }}
          >
            {hasChildren ? (isExpanded ? '▼' : '▶') : '•'}
          </span>

          {/* Icon for LOBs */}
          {node.icon && <span style={{ fontSize: 15 }}>{node.icon}</span>}

          {/* Name */}
          <span style={{ fontWeight: node.level === 1 ? 700 : 500, color: node.level === 1 ? '#1e293b' : '#374151', flex: 1 }}>
            {node.name}
          </span>

          {/* Level badge */}
          <span style={{
            padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600,
            background: levelColor.bg, color: levelColor.text,
          }}>
            {LEVEL_LABELS[node.level] || `L${node.level}`}
          </span>

          {/* Add child button */}
          {node.level < 4 && (
            <button
              onClick={e => { e.stopPropagation(); startAddChild(node); setExpanded(prev => ({ ...prev, [node.id]: true })); }}
              style={{
                background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '1px 6px',
                fontSize: 11, cursor: 'pointer', color: '#64748b',
              }}
              title={`Add ${LEVEL_LABELS[node.level + 1] || 'child'}`}
            >+</button>
          )}
        </div>

        {/* Children */}
        {isExpanded && hasChildren && (
          <div>{node.children.map(child => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  }

  const isEditing = selected || addingUnder;

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
        {/* Alert */}
        {alert && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 8,
            background: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: alert.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${alert.type === 'success' ? '#86efac' : '#fca5a5'}`,
            fontSize: 13,
          }}>{alert.msg}</div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>Claim Categories</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Manage LOB hierarchy: LOB &rarr; Policy Type &rarr; Cause of Loss &rarr; Subject Matter
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={expandAll} style={{
              padding: '8px 14px', background: '#f1f5f9', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#475569',
            }}>Expand All</button>
            <button onClick={() => startAddChild(null)} style={{
              padding: '8px 16px', background: '#7c3aed', color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>+ Add LOB</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isEditing ? '1fr 380px' : '1fr', gap: 20 }}>
          {/* Left: Tree */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16, minHeight: 400 }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading categories...</div>
            ) : tree.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                No categories yet. Click "Add LOB" to start.
              </div>
            ) : (
              tree.map(node => renderNode(node, 0))
            )}
          </div>

          {/* Right: Edit Form */}
          {isEditing && (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1e293b' }}>
                {selected ? `Edit: ${selected.name}` : `Add ${LEVEL_LABELS[editForm.level] || 'Category'}${addingUnder ? ` under ${addingUnder.name}` : ''}`}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Name *</label>
                  <input
                    type="text" value={editForm.name || ''}
                    onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                    autoFocus
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Code (short)</label>
                  <input
                    type="text" value={editForm.code || ''}
                    onChange={e => setEditForm(p => ({ ...p, code: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                    placeholder="e.g. SFSP, EW"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Level</label>
                  <span style={{
                    display: 'inline-block', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    background: (LEVEL_COLORS[editForm.level] || LEVEL_COLORS[4]).bg,
                    color: (LEVEL_COLORS[editForm.level] || LEVEL_COLORS[4]).text,
                  }}>
                    {LEVEL_LABELS[editForm.level] || `Level ${editForm.level}`}
                  </span>
                </div>

                {editForm.level === 1 && (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Icon (emoji)</label>
                      <input
                        type="text" value={editForm.icon || ''}
                        onChange={e => setEditForm(p => ({ ...p, icon: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                        placeholder="e.g. 🔥 ⚓ 🛡️"
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Color</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="color" value={editForm.color || '#7c3aed'}
                          onChange={e => setEditForm(p => ({ ...p, color: e.target.value }))}
                          style={{ width: 40, height: 32, border: 'none', cursor: 'pointer' }}
                        />
                        <input
                          type="text" value={editForm.color || ''}
                          onChange={e => setEditForm(p => ({ ...p, color: e.target.value }))}
                          style={{ flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                          placeholder="#hex"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Sort Order</label>
                  <input
                    type="number" value={editForm.sort_order || 0}
                    onChange={e => setEditForm(p => ({ ...p, sort_order: parseInt(e.target.value) || 0 }))}
                    style={{ width: 100, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>

                {selected && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Active</label>
                    <button
                      onClick={() => handleToggleActive(selected)}
                      style={{
                        padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                        background: selected.is_active ? '#dcfce7' : '#fee2e2',
                        color: selected.is_active ? '#166534' : '#991b1b',
                      }}
                    >{selected.is_active ? 'Active' : 'Inactive'} (click to toggle)</button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      flex: 1, padding: '10px', background: saving ? '#a78bfa' : '#7c3aed', color: '#fff',
                      border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
                    }}
                  >{saving ? 'Saving...' : (selected ? 'Save Changes' : 'Create')}</button>
                  <button
                    onClick={() => { setSelected(null); setAddingUnder(null); setEditForm({}); }}
                    style={{
                      padding: '10px 16px', background: '#f1f5f9', border: '1px solid #d1d5db',
                      borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#475569',
                    }}
                  >Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
