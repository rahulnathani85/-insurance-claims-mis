'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { LOB_COLORS, LOB_ICONS, MARINE_CLIENTS } from '@/lib/constants';

export default function ClaimRegistration() {
  const router = useRouter();
  const [showMarineModal, setShowMarineModal] = useState(false);
  const [lobs, setLobs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch LOBs from database instead of hardcoded constants
  useEffect(() => {
    fetch('/api/claim-categories?level=1')
      .then(r => r.json())
      .then(data => {
        setLobs(Array.isArray(data) ? data.filter(d => d.is_active) : []);
      })
      .catch(() => setLobs([]))
      .finally(() => setLoading(false));
  }, []);

  function handleLobClick(lobName) {
    if (lobName === 'Marine Cargo') {
      setShowMarineModal(true);
    } else {
      router.push(`/claims/${encodeURIComponent(lobName)}`);
    }
  }

  return (
    <PageLayout>
      <div className="main-content">
        <h2>Claim Registration</h2>
        <p style={{ color: '#666', marginBottom: 20 }}>Select a Line of Business to register a new claim</p>
        {loading ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>Loading LOBs...</p>
        ) : (
          <div className="lob-grid">
            {lobs.map(lob => (
              <div key={lob.id} className="lob-box"
                style={{ backgroundColor: lob.color || LOB_COLORS[lob.name] || '#7c3aed' }}
                onClick={() => handleLobClick(lob.name)}>
                <span className="icon">{lob.icon || LOB_ICONS[lob.name] || '📋'}</span>
                {lob.name}
              </div>
            ))}
          </div>
        )}
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
