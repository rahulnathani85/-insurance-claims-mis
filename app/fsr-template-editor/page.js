'use client';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

const FSR_TEMPLATES = [
  {
    lob: 'Extended Warranty',
    subTemplates: [
      { key: 'ew-vehicle', name: 'Extended Warranty — Vehicles', icon: '🚗', description: 'FSR template for vehicle EW claims (Toyota, Jeep, Eicher, etc.)', color: '#7c3aed', ready: true },
      { key: 'ew-equipment', name: 'Extended Warranty — Equipment', icon: '⚙️', description: 'FSR template for equipment/appliance EW claims', color: '#6366f1', ready: false },
    ],
  },
  {
    lob: 'Marine Cargo',
    subTemplates: [
      { key: 'marine-tiles', name: 'Marine Cargo — Tiles', icon: '🏗️', description: 'FSR for tile transit damage / shortage claims', color: '#0891b2', ready: false },
      { key: 'marine-tata', name: 'Marine Cargo — Tata Motors', icon: '🚛', description: 'FSR for Tata Motors transit claims', color: '#0d9488', ready: false },
      { key: 'marine-ultratech', name: 'Marine Cargo — UltraTech', icon: '🏭', description: 'FSR for UltraTech cement/material transit claims', color: '#059669', ready: false },
      { key: 'marine-general', name: 'Marine Cargo — General', icon: '⚓', description: 'General marine cargo FSR template', color: '#0284c7', ready: false },
    ],
  },
  {
    lob: 'Fire',
    subTemplates: [
      { key: 'fire-general', name: 'Fire / Property — General', icon: '🔥', description: 'FSR for fire and property damage claims', color: '#dc2626', ready: false },
    ],
  },
  {
    lob: 'Engineering',
    subTemplates: [
      { key: 'engg-general', name: 'Engineering — General', icon: '🏗️', description: 'FSR for CAR, EAR, MB, CPM claims', color: '#ca8a04', ready: false },
    ],
  },
  {
    lob: 'Miscellaneous',
    subTemplates: [
      { key: 'misc-general', name: 'Miscellaneous — General', icon: '📦', description: 'FSR for burglary, money, fidelity, all risk claims', color: '#6366f1', ready: false },
    ],
  },
  {
    lob: 'Banking',
    subTemplates: [
      { key: 'banking-general', name: 'Banking / Cyber — General', icon: '🏦', description: 'FSR for credit card, UPI, cyber fraud claims', color: '#0d9488', ready: false },
    ],
  },
];

export default function FSRTemplateEditorLanding() {
  const router = useRouter();
  const { user } = useAuth();

  return (
    <PageLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 22, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
            📝 FSR Template Editor
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
            Select a Line of Business to edit its Final Survey Report template. Each LOB has specific report formats for different client types.
          </p>
        </div>

        {FSR_TEMPLATES.map(group => (
          <div key={group.lob} style={{ marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#1e293b', borderBottom: '2px solid #e2e8f0', paddingBottom: 8 }}>
              {group.lob}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {group.subTemplates.map(tmpl => (
                <div
                  key={tmpl.key}
                  onClick={() => tmpl.ready ? router.push(`/fsr-template-editor/${tmpl.key}`) : null}
                  style={{
                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 18px',
                    cursor: tmpl.ready ? 'pointer' : 'default', transition: 'all 0.2s',
                    opacity: tmpl.ready ? 1 : 0.6,
                    borderLeft: `4px solid ${tmpl.color}`,
                  }}
                  onMouseEnter={e => { if (tmpl.ready) e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 24 }}>{tmpl.icon}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{tmpl.name}</div>
                      {!tmpl.ready && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>Coming Soon</span>}
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>{tmpl.description}</p>
                  {tmpl.ready && (
                    <div style={{ marginTop: 10, fontSize: 11, color: tmpl.color, fontWeight: 600 }}>
                      Click to edit template →
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
