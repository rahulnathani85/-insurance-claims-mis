'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const TABS = [
  { key: 'company', label: 'Company Info & Logo' },
  { key: 'cover', label: 'Cover Page' },
  { key: 'sections', label: 'Section Titles' },
  { key: 'boilerplate', label: 'Boilerplate Text' },
  { key: 'assessment', label: 'Assessment Labels' },
  { key: 'style', label: 'Font & Style' },
];

const F = ({ label, field, form, update, textarea, rows, type, hint }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 3 }}>{label}</label>
    {textarea ? (
      <textarea value={form[field] || ''} onChange={e => update({ [field]: e.target.value })}
        rows={rows || 3} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
    ) : (
      <input type={type || 'text'} value={form[field] || ''} onChange={e => update({ [field]: e.target.value })}
        style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
    )}
    {hint && <p style={{ fontSize: 10, color: '#94a3b8', margin: '2px 0 0' }}>{hint}</p>}
  </div>
);

export default function EWVehicleTemplateEditor() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('company');
  const [company, setCompany] = useState('NISLA');
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const logoInputRef = useRef(null);

  useEffect(() => { loadTemplate(); }, [company]);

  async function loadTemplate() {
    setLoading(true);
    try {
      const res = await fetch(`/api/fsr-templates?company=${encodeURIComponent(company)}`);
      const data = await res.json();
      setForm(data && !data.error ? data : {});
    } catch (e) { setForm({}); }
    finally { setLoading(false); }
  }

  function update(updates) { setForm(prev => ({ ...prev, ...updates })); }

  // Convert logo file to base64 data URL
  function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) { setAlert({ msg: 'Logo must be under 500KB', type: 'error' }); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { update({ logo_base64: ev.target.result }); };
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    try {
      const method = form.id ? 'PUT' : 'POST';
      const payload = { ...form, company };
      const res = await fetch('/api/fsr-templates', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setForm(data);
      setAlert({ msg: 'Template saved!', type: 'success' });
    } catch (e) { setAlert({ msg: e.message, type: 'error' }); }
    finally { setSaving(false); setTimeout(() => setAlert(null), 4000); }
  }

  const isAdmin = user?.role === 'Admin';
  const brandColor = form.brand_color || '#4B0082';

  return (
    <PageLayout>
      <div style={{ padding: '16px 20px', maxWidth: 1500, margin: '0 auto' }}>
        {alert && <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 8, background: alert.type === 'success' ? '#dcfce7' : '#fee2e2', color: alert.type === 'success' ? '#166534' : '#991b1b', fontSize: 13 }}>{alert.msg}</div>}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => router.push('/fsr-template-editor')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 18, padding: 0 }}>←</button>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: '#1e293b' }}>🚗 EW Vehicle — FSR Template</h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>Edit the Extended Warranty Vehicle FSR report layout and text</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['NISLA', 'Acuere'].map(c => (
              <button key={c} onClick={() => setCompany(c)}
                style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: company === c ? brandColor : '#f1f5f9', color: company === c ? '#fff' : '#475569',
                  border: company === c ? 'none' : '1px solid #d1d5db' }}>{c}</button>
            ))}
            <button onClick={() => setShowPreview(!showPreview)}
              style={{ padding: '7px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer', background: showPreview ? '#1e40af' : '#f1f5f9', color: showPreview ? '#fff' : '#475569', border: showPreview ? 'none' : '1px solid #d1d5db' }}>
              {showPreview ? '✕ Preview' : '👁 Preview'}
            </button>
            {isAdmin && <button onClick={save} disabled={saving}
              style={{ padding: '7px 18px', background: saving ? '#94a3b8' : '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>}
          </div>
        </div>

        {loading ? <p style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading template...</p> : (
          <div style={{ display: 'flex', gap: 16 }}>
            {/* Left: Editor */}
            <div style={{ flex: showPreview ? '0 0 50%' : '1 1 100%', minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
                {TABS.map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: activeTab === t.key ? 700 : 500, cursor: 'pointer',
                      background: activeTab === t.key ? brandColor : '#f8fafc', color: activeTab === t.key ? '#fff' : '#475569',
                      border: activeTab === t.key ? 'none' : '1px solid #e2e8f0' }}>{t.label}</button>
                ))}
              </div>

              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 16, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
                {activeTab === 'company' && (
                  <div>
                    <F label="Company Full Name" field="company_full_name" form={form} update={update} />
                    <F label="Company Short Name" field="company_short_name" form={form} update={update} />
                    <F label="SLA Number" field="sla_number" form={form} update={update} />
                    <F label="SLA Expiry Date" field="sla_expiry" form={form} update={update} />
                    <F label="Tagline (LOPs)" field="tagline" form={form} update={update} />
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 3 }}>Brand Color</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="color" value={form.brand_color || '#4B0082'} onChange={e => update({ brand_color: e.target.value })} style={{ width: 40, height: 32, border: 'none', cursor: 'pointer' }} />
                        <input type="text" value={form.brand_color || '#4B0082'} onChange={e => update({ brand_color: e.target.value })} style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
                      </div>
                    </div>
                    <F label="Address Line" field="address_line" form={form} update={update} textarea />
                    <F label="Contact Line" field="contact_line" form={form} update={update} />

                    {/* Logo Upload */}
                    <div style={{ marginTop: 16, padding: 14, border: '1px dashed #d1d5db', borderRadius: 8, background: '#fafafa' }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 8 }}>Company Logo</label>
                      {form.logo_base64 && (
                        <div style={{ marginBottom: 10 }}>
                          <img src={form.logo_base64} alt="Logo" style={{ maxHeight: 60, maxWidth: 200, objectFit: 'contain' }} />
                          <button onClick={() => update({ logo_base64: '' })} style={{ marginLeft: 10, fontSize: 10, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                        </div>
                      )}
                      <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/gif" onChange={handleLogoUpload} style={{ display: 'none' }} />
                      <button onClick={() => logoInputRef.current?.click()} style={{ padding: '6px 14px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
                        📁 Upload Logo (PNG/JPG, max 500KB)
                      </button>
                      <p style={{ fontSize: 10, color: '#94a3b8', margin: '4px 0 0' }}>Logo will appear on the cover page and header of the FSR</p>
                    </div>
                  </div>
                )}

                {activeTab === 'cover' && (
                  <div>
                    <F label="Cover Page Title" field="cover_title" form={form} update={update} />
                    <p style={{ fontSize: 11, color: '#94a3b8' }}>The cover page also shows: Vehicle No, VIN, Insured Name, Insurer, Policy Number, Warranty Plan — these come from claim data.</p>
                  </div>
                )}

                {activeTab === 'sections' && (
                  <div>
                    <F label="Section 1 Title" field="section1_title" form={form} update={update} />
                    <F label="Section 2 Title" field="section2_title" form={form} update={update} />
                    <F label="Section 3 Title" field="section3_title" form={form} update={update} />
                    <F label="Section 4 Title" field="section4_title" form={form} update={update} />
                    <F label="Section 5 Title" field="section5_title" form={form} update={update} />
                  </div>
                )}

                {activeTab === 'boilerplate' && (
                  <div>
                    <F label="Cover Letter Opening Paragraph" field="cover_letter_opening" form={form} update={update} textarea rows={4} hint="Use {{appointing_office}} and {{date_of_intimation}} as placeholders" />
                    <F label="Cover Letter Closing Paragraph" field="cover_letter_closing" form={form} update={update} textarea rows={2} />
                    <F label="Conclusion Text" field="conclusion_text" form={form} update={update} textarea rows={4} />
                    <F label="Note 1 (Annexure)" field="note1_text" form={form} update={update} textarea rows={2} />
                    <F label="Note 2 (Without Prejudice)" field="note2_text" form={form} update={update} textarea rows={2} />
                    <F label="Note 3 (Disclaimer)" field="note3_text" form={form} update={update} textarea rows={2} />
                    <F label="Signature Text" field="signature_text" form={form} update={update} />
                  </div>
                )}

                {activeTab === 'assessment' && (
                  <div>
                    <F label="Gross Amount Label" field="assessment_label_gross" form={form} update={update} />
                    <F label="GST Deduction Label" field="assessment_label_gst" form={form} update={update} />
                    <F label="Total Label" field="assessment_label_total" form={form} update={update} />
                    <F label="Not Covered Label" field="assessment_label_not_covered" form={form} update={update} />
                    <F label="Net Amount Label" field="assessment_label_net" form={form} update={update} />
                  </div>
                )}

                {activeTab === 'style' && (
                  <div>
                    <F label="Font Family" field="font_family" form={form} update={update} hint="Examples: Times New Roman, Arial, Calibri" />
                    <F label="Font Size" field="font_size" form={form} update={update} hint="Examples: 11pt, 12pt" />
                  </div>
                )}
              </div>
            </div>

            {/* Right: Preview */}
            {showPreview && (
              <div style={{ flex: '0 0 48%', minWidth: 0, position: 'sticky', top: 16, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
                <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                  <div style={{ padding: '8px 14px', background: '#f0fdf4', borderBottom: '1px solid #e2e8f0', fontSize: 12, fontWeight: 600, color: '#166534' }}>
                    FSR Preview — {company}
                  </div>
                  <div style={{ padding: 16, transform: 'scale(0.55)', transformOrigin: 'top left', width: '182%' }}>
                    <div style={{ fontFamily: form.font_family || 'Times New Roman, serif', fontSize: form.font_size || '11pt', lineHeight: 1.45, color: '#000', border: '1px solid #ddd', padding: 40 }}>
                      {/* Cover Page Header with Logo */}
                      <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ color: brandColor, fontSize: '19pt', fontWeight: 'bold' }}>{form.company_full_name || 'Company Name'}</div>
                            <div style={{ color: brandColor, fontSize: '11pt', fontStyle: 'italic', marginTop: 4 }}>{form.sla_number || 'SLA Number'} Exp. {form.sla_expiry || 'Expiry'}</div>
                            <div style={{ color: brandColor, fontSize: '9.5pt', marginTop: 2 }}>{form.tagline || 'Tagline'}</div>
                          </div>
                          {form.logo_base64 && (
                            <img src={form.logo_base64} alt="Logo" style={{ maxHeight: 50, maxWidth: 120, objectFit: 'contain' }} />
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', margin: '40px 0' }}>
                        <div style={{ fontSize: '22pt', fontWeight: 'bold', textDecoration: 'underline' }}>{form.cover_title || 'EXTENDED WARRANTY REPORT'}</div>
                        <div style={{ marginTop: 20, fontSize: '14pt', fontWeight: 'bold' }}>REPORTED LOSS TO VEHICLE NO. XX-00-XX-0000</div>
                        <div style={{ fontSize: '13pt', marginTop: 6 }}>VIN NUMBER – SAMPLE123456789</div>
                        <div style={{ marginTop: 20, fontSize: '13pt', fontWeight: 'bold' }}>INSURED: M/S SAMPLE INSURED NAME</div>
                      </div>
                      {/* Sections Preview */}
                      <div style={{ borderTop: '2px solid #ddd', marginTop: 30, paddingTop: 20 }}>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 8 }}>{form.section1_title || '1. CLAIM DETAILS:'}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt', marginBottom: 14 }}>
                          <tbody>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 5, fontWeight: 'bold', width: '35%' }}>Insured</td><td style={{ border: '0.5pt solid #444', padding: 5 }}>Sample Name</td></tr>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 5, fontWeight: 'bold' }}>Insurer</td><td style={{ border: '0.5pt solid #444', padding: 5 }}>Sample Insurer</td></tr>
                          </tbody>
                        </table>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 8 }}>{form.section2_title || '2. VEHICLE PARTICULARS:'}</div>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 8, marginTop: 14 }}>{form.section3_title || '3. SURVEY FINDINGS:'}</div>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 8, marginTop: 14 }}>{form.section4_title || '4. ASSESSMENT:'}</div>
                        <table style={{ width: '70%', margin: '8px auto', borderCollapse: 'collapse', fontSize: '10pt' }}>
                          <tbody>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 4 }}>{form.assessment_label_gross || 'Gross'}</td><td style={{ border: '0.5pt solid #444', padding: 4, textAlign: 'right' }}>Rs. 1,00,000</td></tr>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 4, fontWeight: 'bold' }}>{form.assessment_label_net || 'Net'}</td><td style={{ border: '0.5pt solid #444', padding: 4, textAlign: 'right', fontWeight: 'bold' }}>Rs. 84,746</td></tr>
                          </tbody>
                        </table>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 8, marginTop: 14 }}>{form.section5_title || '5. CONCLUSION:'}</div>
                        <p style={{ fontSize: '10pt' }}>{(form.conclusion_text || 'Conclusion...').substring(0, 120)}...</p>
                        <div style={{ textAlign: 'right', marginTop: 30 }}>
                          <div>For {form.company_short_name || 'Company'}</div>
                          <div style={{ marginTop: 20 }}>{form.signature_text || 'Authorised Signatory'}</div>
                        </div>
                      </div>
                      {/* Footer */}
                      <div style={{ borderTop: '0.75pt solid #555', paddingTop: 6, textAlign: 'center', fontSize: '8.5pt', color: '#333', marginTop: 30 }}>
                        <div style={{ fontWeight: 'bold', color: brandColor }}>{form.company_short_name || 'Company'}</div>
                        <div>{form.address_line || 'Address'}</div>
                        <div>{form.contact_line || 'Contact'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
