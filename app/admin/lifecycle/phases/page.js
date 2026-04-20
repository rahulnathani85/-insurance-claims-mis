'use client';
// =============================================================================
// /admin/lifecycle/phases — 7 Universal Phases Reference
// =============================================================================
// Read-only reference card that shows the seven universal phases every claim
// passes through regardless of LOB / product. Pulled from v1 mockup (NISLA
// Lifecycle_Engine_Mockup.html, "Phases Reference" section). Each phase has:
//   • phase number + name
//   • purpose / one-line description
//   • firm-clock behaviour (runs / pauses)
//   • insurer-clock behaviour (runs / pauses)
//   • default owner
//   • typical entry & exit events
//   • whether the phase is auto-complete
// =============================================================================

import LifecycleAdminShell, {
  Card, Note, Badge, Tag, PhaseStep, PhaseStepper,
} from '@/components/LifecycleAdminShell';

const PHASES = [
  {
    n: 1, name: 'Appointment & Intake',
    purpose: 'Claim is registered, appointment letter issued, surveyor assigned.',
    firm: 'running',
    insurer: 'running',
    owner: 'Back-office / Intake',
    entry: 'Claim registered in the system',
    exit:  'Surveyor accepts the appointment',
    auto:  false,
    notes: 'The firm clock starts ticking the moment the intimation is received. Insurer clock runs in parallel until a deficiency memo is issued.',
  },
  {
    n: 2, name: 'Survey & Investigation',
    purpose: 'Physical inspection, evidence collection, site visits.',
    firm: 'running',
    insurer: 'running',
    owner: 'Surveyor',
    entry: 'Surveyor accepts the appointment',
    exit:  'Initial observation / survey report is drafted',
    auto:  false,
    notes: 'Sub-tasks (inspection, photos, statements) typically live here. Re-inspection is modelled as a second stage within this phase.',
  },
  {
    n: 3, name: 'ILA / LOR',
    purpose: 'Issue Interim Loss Advice or Letter of Requirements to insurer / insured.',
    firm: 'running',
    insurer: 'paused',
    owner: 'Surveyor → Back-office',
    entry: 'Survey observations finalised',
    exit:  'ILA / LOR sent to insured and insurer',
    auto:  false,
    notes: 'Insurer clock pauses until the ILA/LOR goes out — the ball is in our court. Firm clock keeps running.',
  },
  {
    n: 4, name: 'Pending Requirements',
    purpose: 'Waiting on documents / answers from insured, insurer, partners.',
    firm: 'paused (per party)',
    insurer: 'paused (per party)',
    owner: 'Shared — driven by per-item state',
    entry: 'One or more pending items opened',
    exit:  'All blocking items closed (or skipped)',
    auto:  true,
    notes: 'This phase auto-completes the moment its last blocking pending-item closes. Clocks are per-item: whichever party is holding the ball has their clock running.',
  },
  {
    n: 5, name: 'Assessment',
    purpose: 'Quantum assessment, liability analysis, calculation of payable amount.',
    firm: 'running',
    insurer: 'running',
    owner: 'Surveyor / Reviewer',
    entry: 'Phase-4 auto-completed — all blocking items closed',
    exit:  'Assessment sheet finalised and signed off',
    auto:  false,
    notes: 'Re-assessment loops on reviewer feedback. Average clause, salvage, excess all applied here.',
  },
  {
    n: 6, name: 'Report',
    purpose: 'Final Survey Report (FSR) generated, QC reviewed, signed.',
    firm: 'running',
    insurer: 'running',
    owner: 'Surveyor → Reviewer',
    entry: 'Assessment signed off',
    exit:  'FSR generated and signed by Lead Surveyor',
    auto:  false,
    notes: 'Any QC comments re-open this phase. The FSR template is driven by lifecycle_template → report_template linkage.',
  },
  {
    n: 7, name: 'Delivery & Closure',
    purpose: 'Report dispatched to insurer, bill raised, file closed.',
    firm: 'running',
    insurer: 'paused (after dispatch)',
    owner: 'Back-office',
    entry: 'FSR signed',
    exit:  'Report dispatched, bill settled — file closed',
    auto:  false,
    notes: 'Insurer clock pauses the moment the FSR leaves the office. The file closes on bill settlement, not on FSR dispatch.',
  },
];

export default function PhasesReferencePage() {
  return (
    <LifecycleAdminShell
      view="phases"
      title="7 Universal Phases"
      subtitle="Every claim — regardless of LOB or product — passes through these seven phases."
    >
      <Note tone="info">
        <strong>Why universal?</strong> The phase layer is LOB-agnostic. Dashboards,
        reporting, and SLA calculations all bucket work by <em>phase</em> so that a Fire
        claim, an EW claim, and a Marine claim can be compared on the same axis.
        Each LOB's template then provides its own specific <em>stages</em> within the
        phases (e.g., Phase 2 might contain "Initial Inspection" + "Dismantling" for EW,
        but just "Survey Visit" for Motor).
      </Note>

      {/* Visual stepper showing all seven phases in order */}
      <Card title="Phase stepper" subtitle="The seven phases in their canonical order.">
        <PhaseStepper>
          {PHASES.map(p => (
            <PhaseStep
              key={p.n}
              num={p.n}
              name={p.name}
              state={p.auto ? 'auto' : ''}
              tone={p.auto ? 'autocomplete' : 'pending'}
            />
          ))}
        </PhaseStepper>
        <div style={{
          display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5,
          color: '#374151', marginTop: 10, padding: '8px 12px',
          background: '#f9fafb', borderRadius: 6,
        }}>
          <span><Badge tone="complete">Green</Badge> regular phase</span>
          <span><Badge tone="autocomplete">Light green</Badge> auto-completes when its condition is met</span>
          <span><Badge tone="active">Amber</Badge> in progress</span>
          <span><Badge tone="breached">Red</Badge> TAT breach</span>
          <span><Badge tone="skipped">Grey</Badge> skipped (template branching)</span>
        </div>
      </Card>

      {/* Full reference table */}
      <Card title="Phase reference" subtitle="Owner, clock behaviour, entry / exit events and auto-complete rules.">
        <table style={tbl}>
          <thead>
            <tr style={tHeadRow}>
              <th style={{ ...th, width: 36 }}>#</th>
              <th style={th}>Name</th>
              <th style={th}>Purpose</th>
              <th style={{ ...th, width: 110 }}>Firm clock</th>
              <th style={{ ...th, width: 120 }}>Insurer clock</th>
              <th style={{ ...th, width: 160 }}>Default owner</th>
              <th style={{ ...th, width: 70 }}>Auto?</th>
            </tr>
          </thead>
          <tbody>
            {PHASES.map(p => (
              <tr key={p.n} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ ...td, fontWeight: 800, color: '#4B0082' }}>{p.n}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                </td>
                <td style={{ ...td, fontSize: 11.5, color: '#374151' }}>{p.purpose}</td>
                <td style={td}>
                  {p.firm.startsWith('paused')
                    ? <Tag tone="firm-pause">⏸ {p.firm.replace('paused', '').trim() || 'paused'}</Tag>
                    : <Tag tone="firm-run">▶ {p.firm}</Tag>}
                </td>
                <td style={td}>
                  {p.insurer.startsWith('paused')
                    ? <Tag tone="insurer-pause">⏸ {p.insurer.replace('paused', '').trim() || 'paused'}</Tag>
                    : <Tag tone="insurer-run">▶ {p.insurer}</Tag>}
                </td>
                <td style={{ ...td, fontSize: 11.5 }}>{p.owner}</td>
                <td style={td}>
                  {p.auto
                    ? <Badge tone="autocomplete">Auto</Badge>
                    : <Badge tone="pending">Manual</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Entry / exit events — a second ref table so the main one stays readable */}
      <Card title="Entry & exit events" subtitle="Which engine events start and end each phase.">
        <table style={tbl}>
          <thead>
            <tr style={tHeadRow}>
              <th style={{ ...th, width: 36 }}>#</th>
              <th style={th}>Phase</th>
              <th style={th}>Enters on</th>
              <th style={th}>Exits on</th>
            </tr>
          </thead>
          <tbody>
            {PHASES.map(p => (
              <tr key={p.n} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ ...td, fontWeight: 800, color: '#4B0082' }}>{p.n}</td>
                <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                <td style={{ ...td, fontSize: 11.5, color: '#374151' }}>{p.entry}</td>
                <td style={{ ...td, fontSize: 11.5, color: '#374151' }}>{p.exit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Notes — one per phase */}
      <Card title="Per-phase notes" subtitle="Gotchas and implementation detail.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PHASES.map(p => (
            <div key={p.n} style={{
              padding: '10px 14px', background: '#f9fafb',
              border: '1px solid #e5e7eb', borderRadius: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Badge tone="lob">Phase {p.n}</Badge>
                <strong style={{ fontSize: 13 }}>{p.name}</strong>
                {p.auto && <Badge tone="autocomplete">Auto-complete</Badge>}
              </div>
              <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{p.notes}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Clock-pause semantics — the firm vs insurer clock explanation */}
      <Card title="Clock-pause semantics" subtitle="Firm clock vs insurer clock — how the two-clock model works.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{
            padding: 14, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Tag tone="firm-run">▶ Firm clock</Tag>
              <strong style={{ fontSize: 13, color: '#991b1b' }}>Firm-side TAT</strong>
            </div>
            <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.55 }}>
              The firm clock measures <strong>how long the claim has been with us</strong> —
              regardless of which party currently holds the ball. It pauses only when
              the claim is waiting on the insurer for a decision (e.g., during a LOR
              reply). This is the clock that drives firm-side SLAs and reviewer TAT.
            </div>
          </div>
          <div style={{
            padding: 14, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Tag tone="insurer-run">▶ Insurer clock</Tag>
              <strong style={{ fontSize: 13, color: '#1e40af' }}>Insurer-side TAT</strong>
            </div>
            <div style={{ fontSize: 12, color: '#1e3a8a', lineHeight: 1.55 }}>
              The insurer clock measures <strong>how long the insurer has been waiting</strong>
              on us. It pauses when we are waiting on the insured (during Phase-4 pending
              items, for example) and resumes when the ball returns to us. Insurer SLA
              reports are built off this clock.
            </div>
          </div>
        </div>
      </Card>

      <Note tone="warn">
        <strong>Auto-completion principle</strong> — only Phase 4 is auto-complete in the
        current model. It auto-completes the moment its last <em>blocking</em> pending-item
        closes (or is marked skipped). Non-blocking items can remain open without gating
        the phase. All other phases require an explicit <code>stage_complete</code> event
        from the surveyor or reviewer.
      </Note>

      <Note tone="info">
        <strong>Skipping phases</strong> — a template can mark any phase <code>skip=true</code>
        via a stage with zero stages or a branching rule. Skipped phases render in grey on
        the stepper and do <em>not</em> contribute to TAT. The universal phase numbering is
        preserved so cross-template dashboards still line up.
      </Note>
    </LifecycleAdminShell>
  );
}

const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
const tHeadRow = { background: '#f9fafb', borderBottom: '2px solid #e5e7eb' };
const th = { padding: '9px 10px', textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' };
const td = { padding: '9px 10px', verticalAlign: 'top' };
