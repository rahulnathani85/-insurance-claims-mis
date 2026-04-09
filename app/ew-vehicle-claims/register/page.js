'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';

const SECTIONS = [
  { key: 'claim', label: 'Claim Details', icon: '&#x1F4C4;' },
  { key: 'vehicle', label: 'Vehicle / Certificate', icon: '&#x1F697;' },
  { key: 'dealer', label: 'Dealer / Service Centre', icon: '&#x1F3ED;' },
  { key: 'complaint', label: 'Customer Complaint', icon: '&#x1F4E2;' },
];

const FIELD_STYLE = {
  width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8,
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
const LABEL_STYLE = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 };

// Field component OUTSIDE the page component to avoid re-mounting on every render
function Field({ label, field, type, span, textarea, form, updateField }) {
  const wrapStyle = span ? { gridColumn: `span ${span}` } : {};
  return (
    <div style={wrapStyle}>
      <label style={LABEL_STYLE}>{label}</label>
      {textarea ? (
        <textarea
          value={form[field] || ''}
          onChange={e => updateField(field, e.target.value)}
          style={{ ...FIELD_STYLE, minHeight: 80, resize: 'vertical' }}
        />
      ) : (
        <input
          type={type || 'text'}
          value={form[field] || ''}
          onChange={e => updateField(field, e.target.value)}
          style={FIELD_STYLE}
        />
      )}
    </div>
  );
}

export default function EWRegisterPage() {
  const router = useRouter();
  const { company } = useCompany();
  const { user } = useAuth();

  const [activeSection, setActiveSection] = useState('claim');
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);

  // Master data for auto-fetch
  const [policies, setPolicies] = useState([]);
  const [insurers, setInsurers] = useState([]);

  const [form, setForm] = useState({
    // Claim Details
    insured_name: '', insured_address: '', insurer_name: '', insurer_address: '',
    policy_number: '', claim_file_no: '', person_contacted: '',
    estimated_loss_amount: '', date_of_intimation: '', report_date: '',
    // Vehicle / Certificate
    customer_name: '', vehicle_reg_no: '', date_of_registration: '',
    vehicle_make: '', model_fuel_type: '', chassis_number: '', engine_number: '',
    odometer_reading: '', warranty_plan: '', certificate_no: '',
    certificate_from: '', certificate_to: '', certificate_kms: '',
    certificate_validity_text: '', product_description: '', terms_conditions: '',
    // Dealer
    dealer_name: '', dealer_address: '', dealer_contact: '',
    // Complaint
    customer_complaint: '', complaint_date: '',
  });

  // Load master data for auto-fill
  useEffect(() => {
    if (company) {
      fetch(`/api/policies?company=${encodeURIComponent(company)}`)
        .then(r => r.json()).then(d => setPolicies(Array.isArray(d) ? d : [])).catch(() => {});
      fetch('/api/insurers')
        .then(r => r.json()).then(d => setInsurers(Array.isArray(d) ? d : [])).catch(() => {});
    }
  }, [company]);

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function showAlertMsg(msg, type = 'error') {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  }

  // Auto-fetch insured address from Policy Master
  function fetchFromPolicyMaster() {
    const policyNum = (form.policy_number || '').trim();
    if (!policyNum) { showAlertMsg('Enter a policy number first'); return; }
    const match = policies.find(p =>
      (p.policy_number || '').trim().toLowerCase() === policyNum.toLowerCase()
    );
    if (match) {
      const updates = {};
      if (match.insured_address) updates.insured_address = match.insured_address;
      if (match.insured_name && !form.insured_name) updates.insured_name = match.insured_name;
      if (Object.keys(updates).length > 0) {
        setForm(prev => ({ ...prev, ...updates }));
        showAlertMsg('Insured address fetched from Policy Master', 'success');
      } else {
        showAlertMsg('Policy found but no address on record');
      }
    } else {
      showAlertMsg('Policy number not found in Policy Master');
    }
  }

  // Auto-fetch insurer address from Insurer Master
  function fetchFromInsurerMaster() {
    const insurerName = (form.insurer_name || '').trim();
    if (!insurerName) { showAlertMsg('Enter an insurer name first'); return; }
    const match = insurers.find(ins =>
      (ins.company_name || '').trim().toLowerCase().includes(insurerName.toLowerCase()) ||
      insurerName.toLowerCase().includes((ins.company_name || '').trim().toLowerCase())
    );
    if (match) {
      const parts = [match.registered_address, match.city, match.state, match.pin].filter(Boolean);
      const fullAddress = parts.join(', ');
      if (fullAddress) {
        setForm(prev => ({ ...prev, insurer_address: fullAddress }));
        showAlertMsg(`Insurer address fetched (${match.company_name})`, 'success');
      } else {
        showAlertMsg('Insurer found but no address on record');
      }
    } else {
      showAlertMsg('Insurer name not found in Insurer Master');
    }
  }

  async function handleSubmit() {
    if (!form.customer_name && !form.insured_name) {
      setAlert({ msg: 'Please fill at least customer name or insured name', type: 'error' });
      return;
    }
    try {
      setSaving(true);
      const payload = { ...form, company, created_by: user?.email || '' };
      // Convert numeric fields
      if (payload.estimated_loss_amount) payload.estimated_loss_amount = parseFloat(payload.estimated_loss_amount);
      // Remove empty strings for date fields
      ['date_of_intimation', 'report_date', 'date_of_registration', 'certificate_from', 'certificate_to', 'complaint_date'].forEach(f => {
        if (!payload[f]) delete payload[f];
      });

      const res = await fetch('/api/ew-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create claim');
      }

      const claim = await res.json();
      router.push(`/ew-vehicle-claims/${claim.id}`);
    } catch (e) {
      setAlert({ msg: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' };
  const grid3Style = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px 20px' };

  // Common props for Field component
  const fp = { form, updateField };

  const fetchBtnStyle = {
    padding: '4px 10px', fontSize: 10, fontWeight: 600, border: 'none', borderRadius: 5,
    cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4,
  };

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1000, margin: '0 auto' }}>
        {/* Alert */}
        {alert && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 8,
            background: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: alert.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${alert.type === 'success' ? '#86efac' : '#fca5a5'}`,
            fontSize: 13,
          }}>
            {alert.msg}
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 24 }}>&#x1F4DD;</span> Register New EW Vehicle Claim
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              Company: <strong>{company}</strong> &#x2022; Fill details and save to start the 12-stage lifecycle
            </p>
          </div>
          <button
            onClick={() => router.push('/ew-vehicle-claims')}
            style={{
              padding: '8px 16px', background: '#f1f5f9', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#475569',
            }}
          >
            &#x2190; Back
          </button>
        </div>

        {/* Section Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {SECTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              style={{
                padding: '8px 16px', borderRadius: 8, border: '2px solid',
                borderColor: activeSection === s.key ? '#7c3aed' : '#e2e8f0',
                background: activeSection === s.key ? '#7c3aed' : '#fff',
                color: activeSection === s.key ? '#fff' : '#475569',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s',
              }}
            >
              <span dangerouslySetInnerHTML={{ __html: s.icon }} />
              {s.label}
            </button>
          ))}
        </div>

        {/* Form Sections */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
          {/* Claim Details */}
          {activeSection === 'claim' && (
            <div>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1e293b', borderBottom: '2px solid #7c3aed', paddingBottom: 8 }}>
                Claim Details
              </h3>
              <div style={gridStyle}>
                <Field label="Insured Name" field="insured_name" {...fp} />
                <Field label="Insurer Name" field="insurer_name" {...fp} />

                {/* Insured Address with Fetch from Policy Master */}
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={LABEL_STYLE}>Insured Address</label>
                    <button onClick={fetchFromPolicyMaster} style={{ ...fetchBtnStyle, background: '#fef3c7', color: '#92400e' }} title="Fetch from Policy Master using policy number">
                      Fetch from Policy Master
                    </button>
                  </div>
                  <textarea
                    value={form.insured_address || ''}
                    onChange={e => updateField('insured_address', e.target.value)}
                    style={{ ...FIELD_STYLE, minHeight: 80, resize: 'vertical' }}
                  />
                </div>

                {/* Insurer Address with Fetch from Insurer Master */}
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={LABEL_STYLE}>Insurer Address</label>
                    <button onClick={fetchFromInsurerMaster} style={{ ...fetchBtnStyle, background: '#dbeafe', color: '#1e40af' }} title="Fetch from Insurer Master using insurer name">
                      Fetch from Insurer Master
                    </button>
                  </div>
                  <textarea
                    value={form.insurer_address || ''}
                    onChange={e => updateField('insurer_address', e.target.value)}
                    style={{ ...FIELD_STYLE, minHeight: 80, resize: 'vertical' }}
                  />
                </div>

                <Field label="Policy Number" field="policy_number" {...fp} />
                <Field label="Claim File No." field="claim_file_no" {...fp} />
                <Field label="Person Contacted" field="person_contacted" {...fp} />
                <Field label="Estimated Loss Amount" field="estimated_loss_amount" type="number" {...fp} />
                <Field label="Date of Intimation" field="date_of_intimation" type="date" {...fp} />
                <Field label="Report Date" field="report_date" type="date" {...fp} />
              </div>
            </div>
          )}

          {/* Vehicle / Certificate */}
          {activeSection === 'vehicle' && (
            <div>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1e293b', borderBottom: '2px solid #7c3aed', paddingBottom: 8 }}>
                Vehicle &amp; Certificate Particulars
              </h3>
              <div style={grid3Style}>
                <Field label="Customer Name" field="customer_name" {...fp} />
                <Field label="Vehicle Reg. No." field="vehicle_reg_no" {...fp} />
                <Field label="Date of Registration" field="date_of_registration" type="date" {...fp} />
                <Field label="Vehicle Make" field="vehicle_make" {...fp} />
                <Field label="Model / Fuel Type" field="model_fuel_type" {...fp} />
                <Field label="Chassis Number" field="chassis_number" {...fp} />
                <Field label="Engine Number" field="engine_number" {...fp} />
                <Field label="Odometer Reading" field="odometer_reading" {...fp} />
                <Field label="Warranty Plan" field="warranty_plan" {...fp} />
                <Field label="Certificate No." field="certificate_no" {...fp} />
                <Field label="Certificate From" field="certificate_from" type="date" {...fp} />
                <Field label="Certificate To" field="certificate_to" type="date" {...fp} />
                <Field label="Certificate KMs" field="certificate_kms" {...fp} />
              </div>
              <div style={{ ...gridStyle, marginTop: 14 }}>
                <Field label="Certificate Validity Text" field="certificate_validity_text" span={2} textarea {...fp} />
                <Field label="Product Description" field="product_description" span={2} textarea {...fp} />
                <Field label="Terms &amp; Conditions" field="terms_conditions" span={2} textarea {...fp} />
              </div>
            </div>
          )}

          {/* Dealer */}
          {activeSection === 'dealer' && (
            <div>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1e293b', borderBottom: '2px solid #7c3aed', paddingBottom: 8 }}>
                Dealer / Service Centre Information
              </h3>
              <div style={gridStyle}>
                <Field label="Dealer / Service Centre Name" field="dealer_name" {...fp} />
                <Field label="Contact Person / Number" field="dealer_contact" {...fp} />
                <Field label="Dealer Address" field="dealer_address" span={2} textarea {...fp} />
              </div>
            </div>
          )}

          {/* Complaint */}
          {activeSection === 'complaint' && (
            <div>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1e293b', borderBottom: '2px solid #7c3aed', paddingBottom: 8 }}>
                Customer Complaint
              </h3>
              <div style={gridStyle}>
                <Field label="Complaint Date" field="complaint_date" type="date" {...fp} />
                <div></div>
                <Field label="Customer Complaint Description" field="customer_complaint" span={2} textarea {...fp} />
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
          <button
            onClick={() => router.push('/ew-vehicle-claims')}
            style={{
              padding: '10px 24px', background: '#f1f5f9', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 14, cursor: 'pointer', color: '#475569',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '10px 24px', background: saving ? '#a78bfa' : '#7c3aed', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
              boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
            }}
          >
            {saving ? 'Creating...' : 'Create EW Claim & Start Lifecycle'}
          </button>
        </div>
      </div>
    </PageLayout>
  );
}
