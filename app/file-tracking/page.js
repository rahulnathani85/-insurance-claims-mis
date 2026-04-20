'use client';
// =============================================================================
// /file-tracking — RETIRED
// =============================================================================
// Legacy file-tracking is replaced by Phase-4 pending items in the Lifecycle
// Engine. Document checklists are now typed items attached to a claim's
// lifecycle rather than a parallel tracking system.
// =============================================================================

import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';

export default function FileTrackingRetired() {
  const router = useRouter();
  return (
    <PageLayout>
      <div className="main-content">
        <div style={{
          maxWidth: 680, margin: '40px auto', padding: 30,
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
          <h2 style={{ margin: 0, color: '#92400e' }}>File Tracking has been retired</h2>
          <p style={{ color: '#78350f', fontSize: 14, lineHeight: 1.6, marginTop: 14 }}>
            Document tracking now lives inside each claim's <b>Phase 4 — Pending Requirements</b> on the Lifecycle Engine. Items like Job Card, Tax Invoice, FIR Copy, etc. are tracked as typed catalog items with per-item clock-pause rules and reminder cascades.
          </p>
          <p style={{ color: '#78350f', fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>
            To see or edit the item catalog, go to <b>Item Catalog</b>. To see a specific claim's open items, open that claim and look at the engine view.
          </p>
          <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="success" style={{ padding: '10px 20px', fontSize: 14 }} onClick={() => router.push('/lifecycle-templates/items-catalog')}>
              Open Item Catalog
            </button>
            <button className="secondary" style={{ padding: '10px 20px', fontSize: 14 }} onClick={() => router.push('/lifecycle-templates/features')}>
              Read the Features Index
            </button>
            <button className="secondary" style={{ padding: '10px 20px', fontSize: 14 }} onClick={() => router.push('/')}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
