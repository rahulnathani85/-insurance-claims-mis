'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';
import { LOB_ICONS } from '@/lib/constants';

const STATUS_STYLES = {
  'Completed': { bg: '#dcfce7', color: '#166534', icon: '✅' },
  'In Progress': { bg: '#fef3c7', color: '#92400e', icon: '🔄' },
  'Pending': { bg: '#f3f4f6', color: '#6b7280', icon: '⏳' },
  'Skipped': { bg: '#f1f5f9', color: '#94a3b8', icon: '⏭️' },
};

export default function ClaimDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [claim, setClaim] = useState(null);
  const [workflow, setWorkflow] = useState([]);
  const [history, setHistory] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [generatedDocs, setGeneratedDocs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    try {
      setLoading(true);
      const [c, w, h, d, gd, a, al, r] = await Promise.all([
        fetch(`/api/claims/${id}`).then(r => r.json()),
        fetch(`/api/claim-workflow?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-workflow-history?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-documents?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/generate-document?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-assignments?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/activity-log?claim_id=${id}`).then(r => r.json()).catch(() => []),
        fetch(`/api/claim-reminders?claim_id=${id}`).then(r => r.json()).catch(() => []),
      ]);
      setClaim(c);
      setWorkflow(Array.isArray(w) ? w : []);
      setHistory(Array.isArray(h) ? h : []);
      setDocuments(Array.isArray(d) ? d : []);
      setGeneratedDocs(Array.isArray(gd) ? gd : []);
      setAssignments(Array.isArray(a) ? a : []);
      setActivityLogs(Array.isArray(al) ? al : []);
      setReminders(Array.isArray(r) ? r : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function isOverdue(stage) {
    if (stage.status === 'Completed' || stage.status === 'Skipped') return false;
    if (!stage.due_date) return false;
    return new Date() > new Date(stage.due_date);
  }

  if (loading) return <PageLayout><div className="main-content"><div className="loading">Loading claim details...</div></div></PageLayout>;
  if (!claim || claim.error) return <PageLayout><div className="main-content"><div className="alert error">Claim not found</div></div></PageLayout>;

  const completedStages = workflow.filter(s => s.status === 'Completed').length;
  const breachedStages = workflow.filter(s => isOverdue(s)).length;
  const currentStage = workflow.find(s => s.status === 'In Progress') || workflow.find(s => s.status === 'Pending');

  const tabs = [
    { key: 'overview', label: 'Overview', icon: '📋' },
    { key: 'lifecycle', label: 'Lifecycle', icon: '🔄' },
    { key: 'documents', label: 'Documents', icon: '📄' },
    { key: 'assignments', label: 'Assignments', icon: '👥' },
    { key: 'activity', label: 'Activity Log', icon: '📝' },
  ];

  return (
    <PageLayout>
      <div className="main-content">
        {/* Claim Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>{LOB_ICONS[claim.lob] || '📋'}</span>
              {claim.ref_number || `Claim #${id}`}
            </h2>
            <p style={{ color: '#6b7280', margin: '5px 0 0', fontSize: 14 }}>
              {claim.insured_name || ''} | {claim.insurer_name || ''} | {claim.lob || ''}
              {claim.broker_name ? ` | Broker: ${claim.broker_name}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: claim.status === 'Open' ? '#fef3c7' : claim.status === 'In Process' ? '#dbeafe' : '#dcfce7',
              color: claim.status === 'Open' ? '#92400e' : claim.status === 'In Process' ? '#1e40af' : '#166534' }}>
              {claim.status}
            </span>
            <button className="secondary" onClick={() => router.back()} style={{ fontSize: 12 }}>Back</button>
            <button className="primary" style={{ fontSize: 12 }} onClick={() => router.push(`/claim-lifecycle/${id}`)}>Open Full Lifecycle</button>
          </div>
        </div>

        {/* Quick Stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ padding: '10px 18px', background: '#eff6ff', borderRadius: 8, textAlign: 'center', minWidth: 100 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1e40af' }}>{completedStages}/{workflow.length || '?'}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Stages Done</div>
          </div>
          {breachedStages > 0 && (
            <div style={{ padding: '10px 18px', background: '#fef2f2', borderRadius: 8, textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>{breachedStages}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>TAT Breached</div>
            </div>
          )}
          <div style={{ padding: '10px 18px', background: '#fefce8', borderRadius: 8, minWidth: 150 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>{currentStage?.stage_name || 'Workflow not started'}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Current Stage</div>
          </div>
          <div style={{ padding: '10px 18px', background: '#f0fdf4', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#166534' }}>{claim.assigned_to || 'Unassigned'}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Assigned To</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: activeTab === t.key ? 700 : 400,
                background: 'none', border: 'none', borderBottom: activeTab === t.key ? '3px solid #1e40af' : '3px solid transparent',
                color: activeTab === t.key ? '#1e40af' : '#6b7280', cursor: 'pointer',
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* TAB: Overview */}
        {activeTab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Claim Registration Details */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
                <h4 style={{ margin: '0 0 15px', color: '#1e40af', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>Claim Registration</h4>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['Ref Number', claim.ref_number],
                      ['Claim Number', claim.claim_number],
                      ['Policy Number', claim.policy_number],
                      ['Insured Name', claim.insured_name],
                      ['Insurer', claim.insurer_name],
                      ['Broker', claim.broker_name],
                      ['LOB', claim.lob],
                      ['Policy Type', claim.policy_type],
                      ['Appointed By', claim.appointing_type],
                      ['Surveyor', claim.surveyor_name],
                      ['Assigned To', claim.assigned_to],
                      ['Status', claim.status],
                    ].map(([label, val]) => val ? (
                      <tr key={label}>
                        <td style={{ padding: '5px 0', color: '#6b7280', width: '40%' }}>{label}</td>
                        <td style={{ padding: '5px 0', fontWeight: 500 }}>{val}</td>
                      </tr>
                    ) : null)}
                  </tbody>
                </table>
              </div>

              {/* Important Dates */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
                <h4 style={{ margin: '0 0 15px', color: '#1e40af', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>Important Dates</h4>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['Date of Intimation', claim.date_intimation],
                      ['Date of Loss', claim.date_loss],
                      ['Date of Survey', claim.date_survey],
                      ['Date of LOR', claim.date_lor],
                      ['Date of FSR', claim.date_fsr],
                      ['Date of Submission', claim.date_submission],
                    ].map(([label, val]) => (
                      <tr key={label}>
                        <td style={{ padding: '5px 0', color: '#6b7280', width: '50%' }}>{label}</td>
                        <td style={{ padding: '5px 0', fontWeight: 500 }}>{val || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Loss Information */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
                <h4 style={{ margin: '0 0 15px', color: '#1e40af', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>Loss Information</h4>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['Loss Location', claim.loss_location],
                      ['Place of Survey', claim.place_survey],
                      ['Gross Loss', claim.gross_loss ? `₹ ${parseFloat(claim.gross_loss).toLocaleString('en-IN')}` : null],
                      ['Assessed Loss', claim.assessed_loss ? `₹ ${parseFloat(claim.assessed_loss).toLocaleString('en-IN')}` : null],
                    ].map(([label, val]) => (
                      <tr key={label}>
                        <td style={{ padding: '5px 0', color: '#6b7280', width: '50%' }}>{label}</td>
                        <td style={{ padding: '5px 0', fontWeight: 500 }}>{val || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {claim.remark && <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', borderRadius: 6, fontSize: 12 }}><strong>Remark:</strong> {claim.remark}</div>}
              </div>

              {/* Survey Fee */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
                <h4 style={{ margin: '0 0 15px', color: '#1e40af', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>Survey Fee Details</h4>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['Bill Number', claim.survey_fee_bill_number],
                      ['Bill Date', claim.survey_fee_bill_date],
                      ['Bill Amount', claim.survey_fee_bill_amount ? `₹ ${parseFloat(claim.survey_fee_bill_amount).toLocaleString('en-IN')}` : null],
                      ['Payment Date', claim.survey_fee_payment_date],
                    ].map(([label, val]) => (
                      <tr key={label}>
                        <td style={{ padding: '5px 0', color: '#6b7280', width: '50%' }}>{label}</td>
                        <td style={{ padding: '5px 0', fontWeight: 500 }}>{val || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: Lifecycle Timeline */}
        {activeTab === 'lifecycle' && (
          <div>
            {workflow.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ color: '#6b7280' }}>No workflow initialized.</p>
                <button className="primary" onClick={() => router.push(`/claim-lifecycle/${id}`)}>Start Workflow</button>
              </div>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 35 }}>
                <div style={{ position: 'absolute', left: 15, top: 0, bottom: 0, width: 3, background: '#e5e7eb' }} />
                {workflow.map(stage => {
                  const ss = STATUS_STYLES[stage.status] || STATUS_STYLES['Pending'];
                  const overdue = isOverdue(stage);
                  return (
                    <div key={stage.id} style={{ position: 'relative', marginBottom: 6 }}>
                      <div style={{
                        position: 'absolute', left: -27, top: 8, width: 20, height: 20, borderRadius: '50%',
                        background: overdue ? '#fef2f2' : ss.bg, border: `2px solid ${overdue ? '#dc2626' : ss.color}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, zIndex: 1
                      }}>{overdue ? '⚠️' : ss.icon}</div>
                      <div style={{
                        padding: '8px 14px', background: overdue ? '#fff5f5' : '#fff',
                        border: `1px solid ${overdue ? '#fecaca' : '#e5e7eb'}`, borderLeft: `3px solid ${overdue ? '#dc2626' : ss.color}`,
                        borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700 }}>#{stage.stage_number}</span>
                          <span style={{ fontWeight: 500, fontSize: 13 }}>{stage.stage_name}</span>
                          {overdue && <span style={{ fontSize: 9, padding: '1px 6px', background: '#dc2626', color: '#fff', borderRadius: 8, fontWeight: 700 }}>OVERDUE</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {stage.due_date && <span style={{ fontSize: 10, color: overdue ? '#dc2626' : '#9ca3af' }}>Due: {stage.due_date}</span>}
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: ss.bg, color: ss.color }}>{stage.status}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 15 }}>
                  <button className="primary" style={{ fontSize: 12 }} onClick={() => router.push(`/claim-lifecycle/${id}`)}>
                    Open Full Lifecycle Manager
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: Documents (LOR, ILA, etc.) */}
        {activeTab === 'documents' && (
          <div>
            {/* Generated Documents (LOR/ILA) */}
            <h4 style={{ margin: '0 0 15px' }}>Generated Documents (LOR / ILA)</h4>
            {generatedDocs.length === 0 ? (
              <p style={{ color: '#999', fontSize: 13, marginBottom: 20 }}>No LOR/ILA documents generated yet</p>
            ) : (
              <div style={{ marginBottom: 25 }}>
                {generatedDocs.map(d => (
                  <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{d.document_type || 'Document'}</span>
                      <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 10 }}>{d.template_name || ''}</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{new Date(d.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Document Checklist */}
            <h4 style={{ margin: '0 0 15px' }}>Document Checklist</h4>
            {documents.length === 0 ? (
              <p style={{ color: '#999', fontSize: 13 }}>No document tracking entries</p>
            ) : (
              <div className="mis-table-container">
                <table className="mis-table">
                  <thead>
                    <tr><th>Document</th><th>Status</th><th>Date</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {documents.map(d => (
                      <tr key={d.id}>
                        <td style={{ fontWeight: 500 }}>{d.document_name}</td>
                        <td>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: d.status === 'Received' ? '#dcfce7' : d.status === 'Pending' ? '#fef3c7' : '#fee2e2',
                            color: d.status === 'Received' ? '#166534' : d.status === 'Pending' ? '#92400e' : '#991b1b' }}>
                            {d.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{d.received_date || '-'}</td>
                        <td style={{ fontSize: 12 }}>{d.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 15 }}>
              <button className="primary" style={{ fontSize: 12 }} onClick={() => router.push('/lor-ila-generator')}>Go to LOR/ILA Generator</button>
            </div>
          </div>
        )}

        {/* TAB: Assignments */}
        {activeTab === 'assignments' && (
          <div>
            {assignments.length === 0 ? (
              <p style={{ color: '#999', fontSize: 13 }}>No assignments for this claim</p>
            ) : (
              <div className="mis-table-container">
                <table className="mis-table">
                  <thead>
                    <tr><th>Assigned To</th><th>Role</th><th>Status</th><th>Date</th><th>Due</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {assignments.map(a => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{a.assigned_to}</td>
                        <td>{a.role}</td>
                        <td>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: a.status === 'Completed' ? '#dcfce7' : a.status === 'In Progress' ? '#fef3c7' : '#dbeafe',
                            color: a.status === 'Completed' ? '#166534' : a.status === 'In Progress' ? '#92400e' : '#1e40af' }}>
                            {a.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{a.assigned_date || '-'}</td>
                        <td style={{ fontSize: 12 }}>{a.due_date || '-'}</td>
                        <td style={{ fontSize: 12 }}>{a.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB: Activity Log */}
        {activeTab === 'activity' && (
          <div>
            {/* Combine workflow history + activity logs */}
            {(() => {
              const allActivity = [
                ...history.map(h => ({ ...h, source: 'workflow', time: h.created_at })),
                ...activityLogs.map(a => ({ ...a, source: 'activity', time: a.created_at, details: a.details || `${a.action} - ${a.entity_type}` })),
              ].sort((a, b) => new Date(b.time) - new Date(a.time));

              return allActivity.length === 0 ? (
                <p style={{ color: '#999', fontSize: 13 }}>No activity recorded for this claim</p>
              ) : (
                <div>
                  {allActivity.map((item, idx) => (
                    <div key={`${item.source}-${item.id}-${idx}`} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ minWidth: 130, fontSize: 11, color: '#9ca3af' }}>
                        {new Date(item.time).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{item.user_name || item.user_email || '-'}</span>
                        <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                          background: item.action === 'comment' ? '#dbeafe' : item.action === 'assign' ? '#fae8ff' : '#fef3c7',
                          color: item.action === 'comment' ? '#1e40af' : item.action === 'assign' ? '#86198f' : '#92400e' }}>
                          {item.action}
                        </span>
                        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#4b5563' }}>{item.details || '-'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
