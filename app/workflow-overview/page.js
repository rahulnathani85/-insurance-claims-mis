'use client';
// =============================================================================
// /workflow-overview — RETIRED
// =============================================================================
// Replaced by the Lifecycle Generator Engine (7-phase stepper + per-claim
// lifecycle view). The old 22-stage IRDAI workflow and 9-stage pipeline have
// been consolidated into templates under /lifecycle-templates.
//
// This page now renders a redirect notice. Historical claim_workflow data is
// preserved in the *_archive tables and can be read via SQL if needed.
// =============================================================================

import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';

export default function WorkflowOverviewRetired() {
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
          <h2 style={{ margin: 0, color: '#92400e' }}>Workflow Overview has been retired</h2>
          <p style={{ color: '#78350f', fontSize: 14, lineHeight: 1.6, marginTop: 14 }}>
            The 22-stage IRDAI workflow and 9-stage pipeline are no longer maintained. All claims now run on the <b>Lifecycle Generator Engine</b> — a template-driven system with 7 universal phases, per-template stage sets, Phase-4 pending items, and TAT tracking per firm / insurer.
          </p>
          <p style={{ color: '#78350f', fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>
            Existing data from <code>claim_workflow</code> is preserved in archived tables and is read-only. New progress is recorded exclusively in <code>claim_lifecycle</code>.
          </p>
          <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="success" style={{ padding: '10px 20px', fontSize: 14 }} onClick={() => router.push('/lifecycle-templates')}>
              Go to Lifecycle Templates
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
