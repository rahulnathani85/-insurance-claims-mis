'use client';
import { useState, useEffect, useRef } from 'react';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';
import { LOB_LIST } from '@/lib/constants';

const PLACEHOLDERS = [
  { tag: '{{ref_number}}', label: 'Ref Number' },
  { tag: '{{claim_number}}', label: 'Claim Number' },
  { tag: '{{insured_name}}', label: 'Insured Name' },
  { tag: '{{insurer_name}}', label: 'Insurer Name' },
  { tag: '{{appointing_insurer}}', label: 'Appointing Insurer' },
  { tag: '{{lob}}', label: 'LOB' },
  { tag: '{{policy_number}}', label: 'Policy Number' },
  { tag: '{{policy_type}}', label: 'Policy Type' },
  { tag: '{{date_loss}}', label: 'Date of Loss' },
  { tag: '{{date_intimation}}', label: 'Date Intimation' },
  { tag: '{{date_survey}}', label: 'Date Survey' },
  { tag: '{{loss_location}}', label: 'Loss Location' },
  { tag: '{{place_survey}}', label: 'Place of Survey' },
  { tag: '{{gross_loss}}', label: 'Gross Loss' },
  { tag: '{{assessed_loss}}', label: 'Assessed Loss' },
  { tag: '{{date_today}}', label: 'Today\'s Date' },
  { tag: '{{surveyor_name}}', label: 'Surveyor Name' },
  { tag: '{{company}}', label: 'Company' },
];

export default function LORILAGeneratorPage() {
  return (
    <PageLayout>
      <LORILAContent />
    </PageLayout>
  );
}

function LORILAContent() {
  const { company } = useCompany();
  const [activeTab, setActiveTab] = useState('templates'); // templates, generate
  const [templates, setTemplates] = useState([]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);

  // Template form state
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateForm, setTemplateForm] = useState({ name: '', type: 'LOR', lob: '', content: '' });

  // Generate form state
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [editableContent, setEditableContent] = useState('');
  const [docType, setDocType] = useState('LOR');
  const [generatedDocs, setGeneratedDocs] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [claimSearch, setClaimSearch] = useState('');

  const editorRef = useRef(null);

  useEffect(() => {
    fetchTemplates();
    fetchClaims();
  }, [company]);

  const fetchTemplates = async () => {
    const res = await fetch(`/api/document-templates?company=${company}`);
    const data = await res.json();
    setTemplates(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const fetchClaims = async () => {
    const res = await fetch(`/api/claims?company=${company}`);
    const data = await res.json();
    setClaims(Array.isArray(data) ? data : []);
  };

  // Template CRUD
  const saveTemplate = async () => {
    if (!templateForm.name || !templateForm.content) {
      setAlert({ type: 'error', message: 'Name and content are required' });
      setTimeout(() => setAlert(null), 3000);
      return;
    }

    // Get content from editor
    const content = editorRef.current ? editorRef.current.innerHTML : templateForm.content;

    const payload = { ...templateForm, content, company };

    let res;
    if (editingTemplate) {
      res = await fetch(`/api/document-templates/${editingTemplate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch('/api/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (res.ok) {
      setAlert({ type: 'success', message: `Template ${editingTemplate ? 'updated' : 'created'} successfully` });
      setTimeout(() => setAlert(null), 3000);
      setShowTemplateForm(false);
      setEditingTemplate(null);
      setTemplateForm({ name: '', type: 'LOR', lob: '', content: '' });
      fetchTemplates();
    } else {
      const data = await res.json();
      setAlert({ type: 'error', message: data.error || 'Failed to save template' });
      setTimeout(() => setAlert(null), 3000);
    }
  };

  const editTemplate = (t) => {
    setEditingTemplate(t);
    setTemplateForm({ name: t.name, type: t.type, lob: t.lob || '', content: t.content });
    setShowTemplateForm(true);
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = t.content;
    }, 100);
  };

  const deleteTemplate = async (id) => {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/document-templates/${id}`, { method: 'DELETE' });
    fetchTemplates();
    setAlert({ type: 'success', message: 'Template deleted' });
    setTimeout(() => setAlert(null), 3000);
  };

  // Document Generation
  const selectClaimForGeneration = (claim) => {
    setSelectedClaim(claim);
    // If a template is selected, fill in the content
    if (selectedTemplate) {
      applyTemplateToEditor(selectedTemplate, claim);
    }
  };

  const selectTemplateForGeneration = (template) => {
    setSelectedTemplate(template);
    setDocType(template.type);
    if (selectedClaim) {
      applyTemplateToEditor(template, selectedClaim);
    } else {
      setEditableContent(template.content);
    }
  };

  const applyTemplateToEditor = (template, claim) => {
    let content = template.content;
    const today = new Date().toISOString().split('T')[0];
    const replacements = {
      '{{ref_number}}': claim.ref_number || '',
      '{{claim_number}}': claim.claim_number || '',
      '{{insured_name}}': claim.insured_name || '',
      '{{insurer_name}}': claim.insurer_name || '',
      '{{appointing_insurer}}': claim.appointing_insurer || '',
      '{{lob}}': claim.lob || '',
      '{{policy_number}}': claim.policy_number || '',
      '{{policy_type}}': claim.policy_type || '',
      '{{date_loss}}': claim.date_loss || '',
      '{{date_intimation}}': claim.date_intimation || '',
      '{{date_survey}}': claim.date_survey || '',
      '{{loss_location}}': claim.loss_location || '',
      '{{place_survey}}': claim.place_survey || '',
      '{{gross_loss}}': claim.gross_loss ? Number(claim.gross_loss).toLocaleString('en-IN') : '',
      '{{assessed_loss}}': claim.assessed_loss ? Number(claim.assessed_loss).toLocaleString('en-IN') : '',
      '{{status}}': claim.status || '',
      '{{remark}}': claim.remark || '',
      '{{company}}': claim.company || '',
      '{{date_today}}': today,
    };
    for (const [key, value] of Object.entries(replacements)) {
      content = content.split(key).join(value || `<span style="background:#fef3c7;padding:0 4px;border-radius:3px;">[${key}]</span>`);
    }
    setEditableContent(content);
  };

  const generateDocument = async () => {
    if (!selectedClaim) {
      setAlert({ type: 'error', message: 'Please select a claim first' });
      setTimeout(() => setAlert(null), 3000);
      return;
    }

    const content = editableContent;
    if (!content) {
      setAlert({ type: 'error', message: 'Document content is empty' });
      setTimeout(() => setAlert(null), 3000);
      return;
    }

    const res = await fetch('/api/generate-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claim_id: selectedClaim.id,
        template_id: selectedTemplate?.id || null,
        type: docType,
        content: content,
        title: `${docType} - ${selectedClaim.ref_number}`,
      }),
    });

    if (res.ok) {
      const doc = await res.json();
      setGeneratedDocs([doc, ...generatedDocs]);
      setAlert({ type: 'success', message: `${docType} generated successfully! You can now preview or print it.` });
      setTimeout(() => setAlert(null), 5000);
    }
  };

  const previewDoc = (doc) => {
    setPreviewContent(doc.content);
    setShowPreview(true);
  };

  const printDocument = () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Print Document</title>
          <style>
            body { font-family: 'Times New Roman', serif; padding: 40px; max-width: 800px; margin: 0 auto; font-size: 14px; line-height: 1.6; }
            table { border-collapse: collapse; width: 100%; }
            table td, table th { border: 1px solid #333; padding: 6px 10px; }
            h1, h2, h3 { margin: 10px 0; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>${previewContent || editableContent}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  // Rich text toolbar commands
  const execCommand = (command, value = null) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setEditableContent(editorRef.current.innerHTML);
    }
  };

  const insertPlaceholder = (tag) => {
    document.execCommand('insertHTML', false, `<span style="background:#dbeafe;padding:1px 6px;border-radius:4px;font-size:12px;color:#1e40af;">${tag}</span>&nbsp;`);
    if (editorRef.current) {
      setEditableContent(editorRef.current.innerHTML);
    }
  };

  const filteredClaims = claims.filter(c => {
    if (!claimSearch) return true;
    const s = claimSearch.toLowerCase();
    return (c.ref_number || '').toLowerCase().includes(s) ||
      (c.insured_name || '').toLowerCase().includes(s) ||
      (c.insurer_name || '').toLowerCase().includes(s);
  });

  return (
    <div>
      <h2 style={{ marginBottom: 5 }}>LOR / ILA Generator</h2>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>Create templates, generate documents from claim data, and print/export as PDF</p>

      {alert && (
        <div style={{ padding: '10px 15px', borderRadius: 8, marginBottom: 15, background: alert.type === 'success' ? '#dcfce7' : '#fef2f2', color: alert.type === 'success' ? '#16a34a' : '#dc2626', border: `1px solid ${alert.type === 'success' ? '#bbf7d0' : '#fecaca'}` }}>
          {alert.message}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e2e8f0' }}>
        {[{ key: 'templates', label: 'Templates' }, { key: 'generate', label: 'Generate Document' }, { key: 'history', label: 'Generated Documents' }].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none', borderBottom: activeTab === tab.key ? '2px solid #1e3a5f' : '2px solid transparent', background: 'none', color: activeTab === tab.key ? '#1e3a5f' : '#6b7280', cursor: 'pointer', marginBottom: -2 }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* TEMPLATES TAB */}
      {activeTab === 'templates' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
            <p style={{ fontSize: 13, color: '#666', margin: 0 }}>Manage your LOR and ILA templates. Use placeholders to auto-fill claim data.</p>
            <button onClick={() => { setShowTemplateForm(true); setEditingTemplate(null); setTemplateForm({ name: '', type: 'LOR', lob: '', content: '' }); setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = ''; }, 100); }} style={{ padding: '8px 16px', fontSize: 13, background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ New Template</button>
          </div>

          {/* Template List */}
          {!showTemplateForm && (
            <div style={{ display: 'grid', gap: 12 }}>
              {templates.length === 0 && <p style={{ color: '#999', fontSize: 13 }}>No templates yet. Create your first template to get started.</p>}
              {templates.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                      <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: t.type === 'LOR' ? '#dbeafe' : '#fce7f3', color: t.type === 'LOR' ? '#1e40af' : '#be185d', marginRight: 8 }}>{t.type}</span>
                      {t.lob ? t.lob : 'All LOBs'} | Created {new Date(t.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="secondary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => editTemplate(t)}>Edit</button>
                    <button className="secondary" style={{ fontSize: 11, padding: '4px 12px', color: '#dc2626' }} onClick={() => deleteTemplate(t.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Template Editor Form */}
          {showTemplateForm && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 25, border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>{editingTemplate ? 'Edit Template' : 'New Template'}</h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 15, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Template Name</label>
                  <input type="text" value={templateForm.name} onChange={e => setTemplateForm({ ...templateForm, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} placeholder="e.g. Fire LOR Standard" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Type</label>
                  <select value={templateForm.type} onChange={e => setTemplateForm({ ...templateForm, type: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
                    <option value="LOR">LOR</option>
                    <option value="ILA">ILA</option>
                    <option value="FSR">FSR</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>LOB (optional)</label>
                  <select value={templateForm.lob} onChange={e => setTemplateForm({ ...templateForm, lob: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
                    <option value="">All LOBs</option>
                    {LOB_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              {/* Placeholder chips */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Insert Placeholder (click to add to editor):</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PLACEHOLDERS.map(p => (
                    <button key={p.tag} onClick={() => insertPlaceholder(p.tag)} style={{ padding: '3px 10px', fontSize: 11, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 15, cursor: 'pointer' }} title={p.tag}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rich Text Toolbar */}
              <div style={{ display: 'flex', gap: 4, padding: '8px 10px', background: '#f8fafc', borderRadius: '8px 8px 0 0', border: '1px solid #d1d5db', borderBottom: 'none', flexWrap: 'wrap' }}>
                <button onClick={() => execCommand('bold')} style={{ padding: '4px 8px', fontSize: 12, fontWeight: 'bold', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Bold">B</button>
                <button onClick={() => execCommand('italic')} style={{ padding: '4px 8px', fontSize: 12, fontStyle: 'italic', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Italic">I</button>
                <button onClick={() => execCommand('underline')} style={{ padding: '4px 8px', fontSize: 12, textDecoration: 'underline', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Underline">U</button>
                <span style={{ width: 1, background: '#d1d5db', margin: '0 4px' }} />
                <button onClick={() => execCommand('formatBlock', 'h2')} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Heading">H</button>
                <button onClick={() => execCommand('formatBlock', 'p')} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Paragraph">P</button>
                <span style={{ width: 1, background: '#d1d5db', margin: '0 4px' }} />
                <button onClick={() => execCommand('justifyLeft')} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Align Left">Left</button>
                <button onClick={() => execCommand('justifyCenter')} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Align Center">Center</button>
                <button onClick={() => execCommand('justifyRight')} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Align Right">Right</button>
                <span style={{ width: 1, background: '#d1d5db', margin: '0 4px' }} />
                <button onClick={() => execCommand('insertUnorderedList')} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Bullet List">List</button>
                <button onClick={() => execCommand('insertOrderedList')} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Numbered List">1.2.3</button>
                <button onClick={() => { const url = prompt('Enter table HTML or leave blank for default'); execCommand('insertHTML', url || '<table style="border-collapse:collapse;width:100%"><tr><td style="border:1px solid #333;padding:6px">Cell 1</td><td style="border:1px solid #333;padding:6px">Cell 2</td></tr><tr><td style="border:1px solid #333;padding:6px">Cell 3</td><td style="border:1px solid #333;padding:6px">Cell 4</td></tr></table>'); }} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Insert Table">Table</button>
                <button onClick={() => execCommand('insertHorizontalRule')} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }} title="Horizontal Line">---</button>
              </div>

              {/* Editor */}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={() => {
                  if (editorRef.current) setTemplateForm({ ...templateForm, content: editorRef.current.innerHTML });
                }}
                style={{ minHeight: 300, padding: 20, border: '1px solid #d1d5db', borderRadius: '0 0 8px 8px', fontSize: 14, lineHeight: 1.6, fontFamily: "'Times New Roman', serif", outline: 'none', background: '#fff', overflow: 'auto', maxHeight: 500 }}
              />

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 15 }}>
                <button className="secondary" onClick={() => { setShowTemplateForm(false); setEditingTemplate(null); }} style={{ padding: '8px 20px', fontSize: 13 }}>Cancel</button>
                <button onClick={saveTemplate} style={{ padding: '8px 20px', fontSize: 13, background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                  {editingTemplate ? 'Update Template' : 'Save Template'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* GENERATE TAB */}
      {activeTab === 'generate' && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
          {/* Left: Claim + Template Selection */}
          <div>
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 14 }}>1. Select Document Type</h4>
              <select value={docType} onChange={e => setDocType(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
                <option value="LOR">LOR (Letter of Recommendation)</option>
                <option value="ILA">ILA (Interim Loss Assessment)</option>
                <option value="FSR">FSR (Final Survey Report)</option>
                <option value="Custom">Custom Document</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 14 }}>2. Select Template</h4>
              <div style={{ display: 'grid', gap: 6, maxHeight: 150, overflow: 'auto' }}>
                {templates.filter(t => t.type === docType).length === 0 && <p style={{ fontSize: 12, color: '#999' }}>No templates for {docType}. Create one in Templates tab.</p>}
                {templates.filter(t => t.type === docType).map(t => (
                  <div key={t.id} onClick={() => selectTemplateForGeneration(t)} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${selectedTemplate?.id === t.id ? '#1e3a5f' : '#e2e8f0'}`, background: selectedTemplate?.id === t.id ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div style={{ color: '#666', fontSize: 11 }}>{t.lob || 'All LOBs'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 10px', fontSize: 14 }}>3. Select Claim</h4>
              <input type="text" placeholder="Search claims..." value={claimSearch} onChange={e => setClaimSearch(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
              <div style={{ maxHeight: 250, overflow: 'auto', display: 'grid', gap: 4 }}>
                {filteredClaims.slice(0, 50).map(c => (
                  <div key={c.id} onClick={() => selectClaimForGeneration(c)} style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${selectedClaim?.id === c.id ? '#1e3a5f' : '#e2e8f0'}`, background: selectedClaim?.id === c.id ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 11 }}>
                    <div style={{ fontWeight: 600 }}>{c.ref_number}</div>
                    <div style={{ color: '#666' }}>{c.insured_name} | {c.lob}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Editor + Preview */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 14 }}>Document Editor {selectedClaim ? `- ${selectedClaim.ref_number}` : ''}</h4>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setPreviewContent(editableContent); setShowPreview(true); }} style={{ padding: '6px 14px', fontSize: 12, background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: 6, cursor: 'pointer' }}>Preview</button>
                <button onClick={generateDocument} style={{ padding: '6px 14px', fontSize: 12, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Generate & Save</button>
              </div>
            </div>

            {/* Inline toolbar for generate mode */}
            <div style={{ display: 'flex', gap: 4, padding: '6px 10px', background: '#f8fafc', borderRadius: '8px 8px 0 0', border: '1px solid #d1d5db', borderBottom: 'none', flexWrap: 'wrap' }}>
              <button onClick={() => { const el = document.getElementById('gen-editor'); if (el) { document.execCommand('bold'); setEditableContent(el.innerHTML); } }} style={{ padding: '3px 6px', fontSize: 11, fontWeight: 'bold', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>B</button>
              <button onClick={() => { const el = document.getElementById('gen-editor'); if (el) { document.execCommand('italic'); setEditableContent(el.innerHTML); } }} style={{ padding: '3px 6px', fontSize: 11, fontStyle: 'italic', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>I</button>
              <button onClick={() => { const el = document.getElementById('gen-editor'); if (el) { document.execCommand('underline'); setEditableContent(el.innerHTML); } }} style={{ padding: '3px 6px', fontSize: 11, textDecoration: 'underline', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>U</button>
            </div>

            <div
              id="gen-editor"
              contentEditable
              suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: editableContent }}
              onInput={(e) => setEditableContent(e.currentTarget.innerHTML)}
              style={{ minHeight: 400, padding: 25, border: '1px solid #d1d5db', borderRadius: '0 0 8px 8px', fontSize: 14, lineHeight: 1.6, fontFamily: "'Times New Roman', serif", outline: 'none', background: '#fff', overflow: 'auto', maxHeight: 600 }}
            />

            {!editableContent && !selectedTemplate && (
              <p style={{ fontSize: 12, color: '#999', marginTop: 10 }}>Select a template and a claim to auto-populate the editor, or type directly.</p>
            )}
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <div>
          <GeneratedDocsList company={company} onPreview={previewDoc} />
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, width: '80%', maxWidth: 800, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 25px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Document Preview</h3>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={printDocument} style={{ padding: '6px 16px', fontSize: 12, background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Print / Save as PDF</button>
                <button className="secondary" onClick={() => setShowPreview(false)} style={{ padding: '6px 16px', fontSize: 12 }}>Close</button>
              </div>
            </div>
            <div style={{ padding: 40, overflow: 'auto', flex: 1, fontFamily: "'Times New Roman', serif", fontSize: 14, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: previewContent }} />
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component: Generated Documents History
function GeneratedDocsList({ company, onPreview }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/generate-document`)
      .then(r => r.json())
      .then(d => { setDocs(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      {docs.length === 0 && <p style={{ color: '#999', fontSize: 13 }}>No documents generated yet.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {docs.map(d => (
          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{d.title}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: d.type === 'LOR' ? '#dbeafe' : d.type === 'ILA' ? '#fce7f3' : '#dcfce7', color: d.type === 'LOR' ? '#1e40af' : d.type === 'ILA' ? '#be185d' : '#15803d', marginRight: 8 }}>{d.type}</span>
                {d.lob} | {new Date(d.created_at).toLocaleDateString()} {new Date(d.created_at).toLocaleTimeString()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="secondary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => onPreview(d)}>Preview</button>
              <button className="secondary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => {
                const printWindow = window.open('', '_blank');
                printWindow.document.write(`<html><head><title>${d.title}</title><style>body{font-family:'Times New Roman',serif;padding:40px;max-width:800px;margin:0 auto;font-size:14px;line-height:1.6;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #333;padding:6px 10px;}</style></head><body>${d.content}</body></html>`);
                printWindow.document.close();
                printWindow.print();
              }}>Print</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
