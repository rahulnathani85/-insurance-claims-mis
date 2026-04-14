'use client';
import { useState, useEffect } from 'react';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const TABS = [
  { key: 'company', label: 'Company Info' },
  { key: 'cover', label: 'Cover Page' },
  { key: 'sections', label: 'Section Titles' },
  { key: 'boilerplate', label: 'Boilerplate Text' },
  { key: 'assessment', label: 'Assessment Labels' },
  { key: 'style', label: 'Font & Style' },
];

const F = ({ label, field, form, update, textarea, rows, type }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 3 }}>{label}</label>
    {textarea ? (
      <textarea value={form[field] || ''} onChange={e => update({ [field]: e.target.value })}
        rows={rows || 3} style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
    ) : (
      <input type={type || 'text'} value={form[field] || ''} onChange={e => update({ [field]: e.target.value })}
        style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
    )}
  </div>
);

export default function FSRTemplateEditor() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('company');
  const [company, setCompany] = useState('NISLA');
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [showPreview, setShowPreview] = useState(true);

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
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#1e293b' }}>📝 FSR Template Editor</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Edit the Final Survey Report template layout, text, and branding</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Company Toggle */}
            {['NISLA', 'Acuere'].map(c => (
              <button key={c} onClick={() => setCompany(c)}
                style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: company === c ? brandColor : '#f1f5f9', color: company === c ? '#fff' : '#475569',
                  border: company === c ? 'none' : '1px solid #d1d5db' }}>{c}</button>
            ))}
            <button onClick={() => setShowPreview(!showPreview)}
              style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: showPreview ? '#1e40af' : '#f1f5f9', color: showPreview ? '#fff' : '#475569', border: showPreview ? 'none' : '1px solid #d1d5db' }}>
              {showPreview ? '✕ Hide Preview' : '👁 Show Preview'}
            </button>
            {isAdmin && <button onClick={save} disabled={saving}
              style={{ padding: '8px 20px', background: saving ? '#94a3b8' : '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save Template'}
            </button>}
          </div>
        </div>

        {loading ? <p style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading template...</p> : (
          <div style={{ display: 'flex', gap: 16 }}>
            {/* Left: Editor */}
            <div style={{ flex: showPreview ? '0 0 50%' : '1 1 100%', minWidth: 0 }}>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
                {TABS.map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: activeTab === t.key ? 700 : 500, cursor: 'pointer',
                      background: activeTab === t.key ? brandColor : '#f8fafc', color: activeTab === t.key ? '#fff' : '#475569',
                      border: activeTab === t.key ? 'none' : '1px solid #e2e8f0' }}>{t.label}</button>
                ))}
              </div>

              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 16 }}>
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
                    <F label="Cover Letter Opening Paragraph" field="cover_letter_opening" form={form} update={update} textarea rows={4} />
                    <p style={{ fontSize: 10, color: '#94a3b8', margin: '-8px 0 12px' }}>Use {'{{appointing_office}}'} and {'{{date_of_intimation}}'} as placeholders</p>
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
                    <F label="Font Family" field="font_family" form={form} update={update} />
                    <F label="Font Size" field="font_size" form={form} update={update} />
                    <p style={{ fontSize: 11, color: '#94a3b8' }}>Examples: 11pt, 12pt. Font family examples: Times New Roman, Arial, Calibri</p>
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
                    {/* Mini FSR Preview */}
                    <div style={{ fontFamily: form.font_family || 'Times New Roman, serif', fontSize: form.font_size || '11pt', lineHeight: 1.45, color: '#000', border: '1px solid #ddd', padding: 40 }}>
                      {/* Cover Page */}
                      <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <div style={{ color: brandColor, fontSize: '19pt', fontWeight: 'bold' }}>{form.company_full_name || 'Company Name'}</div>
                        <div style={{ color: brandColor, fontSize: '11pt', fontStyle: 'italic', marginTop: 4 }}>{form.sla_number || 'SLA Number'} Exp. {form.sla_expiry || 'Expiry'}</div>
                        <div style={{ color: brandColor, fontSize: '9.5pt', marginTop: 2 }}>{form.tagline || 'Tagline'}</div>
                      </div>
                      <div style={{ textAlign: 'center', margin: '40px 0' }}>
                        <div style={{ fontSize: '22pt', fontWeight: 'bold', textDecoration: 'underline' }}>{form.cover_title || 'EXTENDED WARRANTY REPORT'}</div>
                        <div style={{ marginTop: 20, fontSize: '14pt', fontWeight: 'bold' }}>REPORTED LOSS TO VEHICLE NO. XX-00-XX-0000</div>
                        <div style={{ fontSize: '13pt', marginTop: 6 }}>VIN NUMBER – SAMPLE123456789</div>
                        <div style={{ marginTop: 20, fontSize: '13pt', fontWeight: 'bold' }}>INSURED: M/S SAMPLE INSURED NAME</div>
                        <div style={{ marginTop: 30 }}>
                          <div style={{ color: brandColor, fontSize: '15pt', fontWeight: 'bold' }}>The Oriental Insurance Co. Ltd.</div>
                          <div style={{ marginTop: 6, fontSize: '12pt' }}>POLICY NO – 12345/67/2025/0000</div>
                        </div>
                      </div>
                      <div style={{ borderTop: '0.75pt solid #555', paddingTop: 6, textAlign: 'center', fontSize: '8.5pt', color: '#333', marginTop: 40 }}>
                        <div style={{ fontWeight: 'bold', color: brandColor }}>{form.company_short_name || 'Company'}</div>
                        <div>{form.address_line || 'Address'}</div>
                        <div>{form.contact_line || 'Contact'}</div>
                      </div>

                      {/* Section titles preview */}
                      <div style={{ borderTop: '2px solid #ddd', marginTop: 30, paddingTop: 20 }}>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 10 }}>{form.section1_title || '1. CLAIM DETAILS:'}</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt', marginBottom: 16 }}>
                          <tbody>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 5, fontWeight: 'bold', width: '35%' }}>Insured</td><td style={{ border: '0.5pt solid #444', padding: 5 }}>Sample Insured Name</td></tr>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 5, fontWeight: 'bold' }}>Insurer</td><td style={{ border: '0.5pt solid #444', padding: 5 }}>Sample Insurer</td></tr>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 5, fontWeight: 'bold' }}>Policy No</td><td style={{ border: '0.5pt solid #444', padding: 5 }}>12345/67/2025/0000</td></tr>
                          </tbody>
                        </table>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 10 }}>{form.section2_title || '2. CERTIFICATE / VEHICLE PARTICULARS:'}</div>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 10, marginTop: 16 }}>{form.section3_title || '3. OUR SURVEY / INSPECTION / FINDINGS:'}</div>
                        <p style={{ textAlign: 'justify', fontSize: '10pt', color: '#666' }}>[Survey findings narrative will be auto-filled from claim data]</p>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 10, marginTop: 16 }}>{form.section4_title || '4. ASSESSMENT OF LOSS:'}</div>
                        <table style={{ width: '70%', margin: '10px auto', borderCollapse: 'collapse', fontSize: '10pt' }}>
                          <tbody>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 5 }}>{form.assessment_label_gross || 'Gross Assessed Loss'}</td><td style={{ border: '0.5pt solid #444', padding: 5, textAlign: 'right' }}>Rs. 1,00,000.00</td></tr>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 5 }}>{form.assessment_label_gst || 'Less: GST @ 18%'}</td><td style={{ border: '0.5pt solid #444', padding: 5, textAlign: 'right' }}>Rs. 15,254.00</td></tr>
                            <tr><td style={{ border: '0.5pt solid #444', padding: 5, fontWeight: 'bold' }}>{form.assessment_label_net || 'Net Adjusted Loss Amount'}</td><td style={{ border: '0.5pt solid #444', padding: 5, textAlign: 'right', fontWeight: 'bold' }}>Rs. 84,746.00</td></tr>
                          </tbody>
                        </table>
                        <div style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 10, marginTop: 16 }}>{form.section5_title || '5. CONCLUSION:'}</div>
                        <p style={{ textAlign: 'justify', fontSize: '10pt' }}>{(form.conclusion_text || 'Conclusion text...').substring(0, 150)}...</p>

                        {/* Signature */}
                        <div style={{ textAlign: 'right', marginTop: 30, fontSize: '11pt' }}>
                          <div>For {form.company_short_name || 'Company Name'}</div>
                          <div style={{ marginTop: 30 }}>{form.signature_text || 'Authorised Signatory'}</div>
                        </div>
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
