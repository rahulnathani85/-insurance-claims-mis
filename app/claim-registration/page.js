'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { LOB_LIST, LOB_COLORS, LOB_ICONS, MARINE_CLIENTS } from '@/lib/constants';

export default function ClaimRegistration() {
  const router = useRouter();
  const [showMarineModal, setShowMarineModal] = useState(false);

  function handleLobClick(lob) {
    if (lob === 'Marine Cargo') {
      setShowMarineModal(true);
    } else {
      router.push(`/claims/${encodeURIComponent(lob)}`);
    }
  }

  return (
    <PageLayout>
      <div className="main-content">
        <h2>Claim Registration</h2>
        <p style={{ color: '#666', marginBottom: 20 }}>Select a Line of Business to register a new claim</p>
        <div className="lob-grid">
          {LOB_LIST.map(lob => (
            <div key={lob} className="lob-box" style={{ backgroundColor: LOB_COLORS[lob] }}
              onClick={() => handleLobClick(lob)}>
              <span className="icon">{LOB_ICONS[lob]}</span>
              {lob}
            </div>
          ))}
        </div>
      </div>

      {showMarineModal && (
        <div className="modal show" onClick={e => e.target.className.includes('modal show') && setShowMarineModal(false)}>
          <div className="modal-content">
            <span className="modal-close" onClick={() => setShowMarineModal(false)}>&times;</span>
            <h3>Select Client Category</h3>
            <div style={{ display: 'grid', gap: 10, marginTop: 15 }}>
              {MARINE_CLIENTS.map(client => (
                <button key={client}
                  onClick={() => {
                    setShowMarineModal(false);
                    router.push(`/claims/Marine%20Cargo?client_category=${encodeURIComponent(client)}`);
                  }}
                  style={{ padding: '12px 20px', textAlign: 'left', width: '100%' }}>
                  {client}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
