import React, { useState, useEffect, useRef } from 'react';
import {
  Shield, Mail, MessageCircle, Inbox, CheckCircle2, AlertCircle,
  Clock, Filter, Search, Send, Paperclip, FileText, Image as ImageIcon,
  ChevronRight, Sparkles, Zap, X, ArrowRight, Loader2, Edit3, Check,
  RotateCcw, Eye, AlertTriangle, Tag as TagIcon, Settings, Activity,
  TrendingUp, Users, Building2, FileImage, MessageSquare, FileCheck,
  HelpCircle, IndianRupee, FileSearch, ClipboardList
} from 'lucide-react';

// ============================================================================
// Tag library — 8 NISLA workflow tags
// ============================================================================

const TAGS = {
  intimation: {
    id: 'intimation',
    label: 'New Intimation',
    short: 'INT',
    icon: Building2,
    color: 'blue',
    description: 'New claim notification from insurer',
    schema: ['policy_no', 'insured_name', 'vehicle_or_property', 'date_of_loss', 'location', 'contact', 'sum_insured', 'lob'],
    actions: ['Create claim record', 'Assign next available surveyor', 'Send acknowledgement to insurer', 'Notify surveyor on WhatsApp']
  },
  'surveyor-photos': {
    id: 'surveyor-photos',
    label: 'Surveyor Photos',
    short: 'PHO',
    icon: FileImage,
    color: 'violet',
    description: 'Inspection photos from field team',
    schema: ['claim_ref', 'photo_count', 'location_metadata', 'capture_date'],
    actions: ['Attach photos to claim', 'Run vision captioning', 'Update gallery', 'Flag if illegible']
  },
  'site-visit-report': {
    id: 'site-visit-report',
    label: 'Site Visit Report',
    short: 'SVR',
    icon: ClipboardList,
    color: 'indigo',
    description: 'Preliminary observations from field team',
    schema: ['claim_ref', 'visit_date', 'cause_of_loss', 'observations', 'further_docs_needed'],
    actions: ['Update claim status to Site Done', 'File observations to claim folder', 'Generate summary for review']
  },
  'insurer-query': {
    id: 'insurer-query',
    label: 'Insurer Query',
    short: 'QRY',
    icon: HelpCircle,
    color: 'amber',
    description: 'Clarification request from insurer',
    schema: ['claim_ref', 'query_type', 'requested_info', 'response_deadline'],
    actions: ['Link to claim record', 'Queue draft reply pulling from claim file', 'Set claim flag: Awaiting Response']
  },
  'settlement-advice': {
    id: 'settlement-advice',
    label: 'Settlement Advice',
    short: 'SET',
    icon: IndianRupee,
    color: 'emerald',
    description: 'Insurer confirms settlement amount',
    schema: ['claim_ref', 'settled_amount', 'settlement_date', 'deductions', 'mode_of_payment'],
    actions: ['Update claim record', 'Mark claim Closed', 'Trigger NISLA fee invoice generation', 'Archive original email']
  },
  'client-followup': {
    id: 'client-followup',
    label: 'Client Follow-up',
    short: 'CLI',
    icon: Users,
    color: 'teal',
    description: 'Client or insured chasing for status',
    schema: ['claim_ref_or_name', 'query_summary', 'urgency'],
    actions: ['Route to assigned surveyor', 'Log in CRM', 'Draft polite status reply for review']
  },
  'policy-doc': {
    id: 'policy-doc',
    label: 'Policy Document',
    short: 'POL',
    icon: FileCheck,
    color: 'sky',
    description: 'Policy document received as attachment',
    schema: ['policy_no', 'insurer', 'insured', 'sum_insured', 'policy_period', 'lob'],
    actions: ['Archive PDF to claim folder', 'Extract policy fields to database', 'Cross-link to existing intimation if any']
  },
  'internal-admin': {
    id: 'internal-admin',
    label: 'Internal / Admin',
    short: 'ADM',
    icon: MessageSquare,
    color: 'slate',
    description: 'Internal team or admin matters — no extraction',
    schema: [],
    actions: ['File under /internal', 'No further processing required']
  }
};

const TAG_COLORS = {
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-800',    border: 'border-blue-200',    dot: 'bg-blue-500' },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-800',  border: 'border-violet-200',  dot: 'bg-violet-500' },
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-800',  border: 'border-indigo-200',  dot: 'bg-indigo-500' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-900',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  teal:    { bg: 'bg-teal-50',    text: 'text-teal-800',    border: 'border-teal-200',    dot: 'bg-teal-500' },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-800',     border: 'border-sky-200',     dot: 'bg-sky-500' },
  slate:   { bg: 'bg-slate-100',  text: 'text-slate-700',   border: 'border-slate-200',   dot: 'bg-slate-500' }
};

// ============================================================================
// Mock inbox messages — varied scenarios across tags and sources
// ============================================================================

const MOCK_MESSAGES = [
  {
    id: 'msg_001',
    source: 'email',
    from: 'claims.motor@hdfcergo.com',
    fromName: 'HDFC ERGO Claims',
    subject: 'New Motor OD Claim — Honda City — VIP Customer',
    timestamp: '10:42 AM',
    preview: 'Dear Sir, Please find below new claim intimation for survey. Policy No: 2311/HDFCERGO/MTR/4471, Insured: Mr. R. Mehta, Vehicle: Honda City 2022 (MH-04-XX-1247)...',
    body: `Dear Sir,

Please find below new claim intimation for survey.

Policy No: 2311/HDFCERGO/MTR/4471
Insured: Mr. R. Mehta
Vehicle: Honda City 2022, Reg. MH-04-XX-1247
Sum Insured: ₹11,00,000
Date of Loss: 14-Apr-2026
Location: Eastern Express Highway, Thane (E)
Nature of Loss: Rear-end collision with stationary vehicle
Insured Mobile: +91-98XXXXXXXX

Vehicle is at: ABC Honda Service Centre, Thane (W)
Kindly arrange survey at your earliest. Confirm assignment via email.

Regards,
Anjali Sharma
Claims Officer, HDFC ERGO`,
    autoTag: 'intimation',
    confidence: 0.97,
    status: 'pending-review',
    extracted: {
      policy_no: '2311/HDFCERGO/MTR/4471',
      insured_name: 'Mr. R. Mehta',
      vehicle_or_property: 'Honda City 2022, MH-04-XX-1247',
      date_of_loss: '2026-04-14',
      location: 'Eastern Express Highway, Thane (E)',
      contact: '+91-98XXXXXXXX',
      sum_insured: '₹11,00,000',
      lob: 'Motor OD'
    },
    attachments: 0
  },
  {
    id: 'msg_002',
    source: 'whatsapp',
    from: '+919812345678',
    fromName: 'Surveyor — Vikram',
    subject: '[WhatsApp] Photos from site',
    timestamp: '11:18 AM',
    preview: 'Sir, photos from Kapoor Textiles fire site. Total 12 images covering the affected stock area and damaged building portion. Will share preliminary observations shortly.',
    body: `Sir, photos from Kapoor Textiles fire site.

Total 12 images covering:
- Affected stock area (6 photos)
- Damaged building portion (4 photos)
- Adjacent unaffected sections (2 photos)

Will share preliminary observations shortly.

Claim ref: CLM/2024/FIRE/0023`,
    autoTag: 'surveyor-photos',
    confidence: 0.94,
    status: 'auto-routed',
    extracted: {
      claim_ref: 'CLM/2024/FIRE/0023',
      photo_count: 12,
      location_metadata: 'Bhiwandi (from EXIF)',
      capture_date: '2026-04-22'
    },
    attachments: 12
  },
  {
    id: 'msg_003',
    source: 'email',
    from: 'subrogation@iciclombard.com',
    fromName: 'ICICI Lombard Subrogation',
    subject: 'Re: CLM/2024/MTR/0319 — Need clarification on paint blending scope',
    timestamp: '12:05 PM',
    preview: 'With reference to your survey report dated 21-Mar, we need clarification on the basis of paint blending estimate. Specifically, we note that...',
    body: `Dear NISLA Team,

With reference to your survey report dated 21-Mar for the subject claim, we need clarification on the basis of paint blending estimate.

Specifically, we note that:
1. Front bumper has been quoted for full paint with blending of adjacent panels
2. Right fender includes blending of door

Please clarify the technical justification for the blending scope and whether tariff allowance applies. Kindly respond within 3 working days.

Regards,
Subrogation Cell
ICICI Lombard`,
    autoTag: 'insurer-query',
    confidence: 0.92,
    status: 'pending-review',
    extracted: {
      claim_ref: 'CLM/2024/MTR/0319',
      query_type: 'Technical justification for paint blending scope',
      requested_info: 'Basis of blending; tariff allowance applicability',
      response_deadline: '3 working days'
    },
    attachments: 1
  },
  {
    id: 'msg_004',
    source: 'email',
    from: 'settlements@bajajallianz.com',
    fromName: 'Bajaj Allianz Settlements',
    subject: 'Settlement Advice — CLM/2024/MTR/1247',
    timestamp: '01:28 PM',
    preview: 'This is to inform you that settlement of the above-referenced claim has been processed. Settled Amount: ₹2,85,000. Mode: NEFT to insured account...',
    body: `Subject: Settlement Advice — Claim Ref CLM/2024/MTR/1247

This is to inform you that settlement of the above-referenced claim has been processed as per your survey report dated 22-Nov-2024.

Settled Amount: ₹2,85,000
Settlement Date: 22-Apr-2026
Mode of Payment: NEFT to insured account
Deductions: Nil (assessment as per report accepted)

Kindly raise your professional fee invoice as per agreed terms.

Regards,
Settlement Cell
Bajaj Allianz General Insurance`,
    autoTag: 'settlement-advice',
    confidence: 0.98,
    status: 'auto-routed',
    extracted: {
      claim_ref: 'CLM/2024/MTR/1247',
      settled_amount: '₹2,85,000',
      settlement_date: '2026-04-22',
      deductions: 'Nil',
      mode_of_payment: 'NEFT'
    },
    attachments: 0
  },
  {
    id: 'msg_005',
    source: 'whatsapp',
    from: '+919900112233',
    fromName: 'Mr. Mehta (Insured)',
    subject: '[WhatsApp] Status of my claim',
    timestamp: '02:14 PM',
    preview: 'Hello sir, any update on my Honda City claim? It has been 8 days since the survey. The garage is asking when they can start the work.',
    body: `Hello sir, any update on my Honda City claim?

It has been 8 days since the survey. The garage is asking when they can start the work. Kindly update.

Regards,
R. Mehta
Reg: MH-04-XX-1247`,
    autoTag: 'client-followup',
    confidence: 0.96,
    status: 'pending-review',
    extracted: {
      claim_ref_or_name: 'R. Mehta — MH-04-XX-1247',
      query_summary: 'Status update; garage waiting to start work; 8 days post-survey',
      urgency: 'medium'
    },
    attachments: 0
  },
  {
    id: 'msg_006',
    source: 'email',
    from: 'vikram.surveyor@nisla.in',
    fromName: 'Vikram (NISLA Surveyor)',
    subject: 'Site visit complete — Kapoor Textiles fire — preliminary observations',
    timestamp: '03:22 PM',
    preview: 'Sir, completed site visit at Kapoor Textiles, Bhiwandi. Cause appears to be electrical short-circuit in stock storage area. Pre-loss documentation available...',
    body: `Sir,

Completed site visit at Kapoor Textiles, Bhiwandi.

Visit Date: 22-Apr-2026
Cause: Appears to be electrical short-circuit in stock storage area
Observations:
- Fire originated in north-west corner of stock godown
- Damage limited to ~40% of stock; building portion has structural damage on east wall
- Pre-loss documentation available with insured (stock register, GST returns)
- No third-party involvement

Further docs needed:
- Last 6 months stock register
- Electrical inspection report from licensed electrician
- Fire brigade report
- GST returns FY24 and FY25

Will await documents before completing assessment.

Regards,
Vikram`,
    autoTag: 'site-visit-report',
    confidence: 0.95,
    status: 'auto-routed',
    extracted: {
      claim_ref: 'CLM/2024/FIRE/0023',
      visit_date: '2026-04-22',
      cause_of_loss: 'Electrical short-circuit in stock storage area',
      observations: 'Fire origin NW corner of stock godown; ~40% stock damage; structural damage east wall; no third-party involvement',
      further_docs_needed: 'Stock register (6 months), electrical inspection report, fire brigade report, GST returns FY24-25'
    },
    attachments: 0
  },
  {
    id: 'msg_007',
    source: 'email',
    from: 'underwriting@nationalinsurance.in',
    fromName: 'National Insurance UW',
    subject: 'Policy copy — Shree Plastics — Standard Fire Policy',
    timestamp: '04:01 PM',
    preview: 'Please find attached the policy copy for Shree Plastics, Vasai. Policy No. NICL/2024/FIRE/8821. Period 01-Apr-2025 to 31-Mar-2026. SI ₹1,25,00,000.',
    body: `Please find attached the policy copy for Shree Plastics, Vasai.

Policy No: NICL/2024/FIRE/8821
Insured: Shree Plastics
Sum Insured: ₹1,25,00,000
Policy Period: 01-Apr-2025 to 31-Mar-2026
Risk: Standard Fire and Special Perils Policy

This is in connection with the recent claim intimation. Kindly archive for reference.

National Insurance Co. Ltd.`,
    autoTag: 'policy-doc',
    confidence: 0.93,
    status: 'auto-routed',
    extracted: {
      policy_no: 'NICL/2024/FIRE/8821',
      insurer: 'National Insurance Co. Ltd.',
      insured: 'Shree Plastics',
      sum_insured: '₹1,25,00,000',
      policy_period: '01-Apr-2025 to 31-Mar-2026',
      lob: 'Fire'
    },
    attachments: 1
  },
  {
    id: 'msg_008',
    source: 'email',
    from: 'rahul@nisla.in',
    fromName: 'Rahul (Internal)',
    subject: 'Office closed Friday — Election day',
    timestamp: '04:35 PM',
    preview: 'Team, Friday 26-Apr is declared as polling holiday. Office will remain closed. Surveyors with urgent assignments to coordinate directly with respective insurers.',
    body: `Team,

Friday 26-Apr is declared as polling holiday. Office will remain closed.

Surveyors with urgent assignments to coordinate directly with respective insurers and inform reporting manager.

Please cast your vote.

Regards,
Rahul`,
    autoTag: 'internal-admin',
    confidence: 0.91,
    status: 'auto-routed',
    extracted: {},
    attachments: 0
  },
  {
    id: 'msg_009',
    source: 'email',
    from: 'claims@reliance.com',
    fromName: 'Reliance General Claims',
    subject: 'New Marine Cargo Claim — Shakti Electronics',
    timestamp: '05:12 PM',
    preview: 'New marine cargo claim intimation. Policy: RGI/MRN/2024/22871. Insured: Shakti Electronics Ltd. Cargo: Industrial sensors, water damage in transit...',
    body: `New marine cargo claim intimation.

Policy: RGI/MRN/2024/22871
Insured: Shakti Electronics Ltd.
Cargo: Industrial sensors
Nature: Water damage in transit
DOL: 18-Apr-2026
Location: JNPT, Mumbai
Sum Insured (this consignment): ₹47,00,000
Insured Contact: Mr. Bhatia, +91-99XXXXXXXX

Survey at JNPT warehouse C-4 required urgently.

Reliance General Insurance`,
    autoTag: 'intimation',
    confidence: 0.96,
    status: 'pending-review',
    extracted: {
      policy_no: 'RGI/MRN/2024/22871',
      insured_name: 'Shakti Electronics Ltd.',
      vehicle_or_property: 'Industrial sensors consignment',
      date_of_loss: '2026-04-18',
      location: 'JNPT, Mumbai',
      contact: 'Mr. Bhatia, +91-99XXXXXXXX',
      sum_insured: '₹47,00,000',
      lob: 'Marine Cargo'
    },
    attachments: 0
  },
  {
    id: 'msg_010',
    source: 'whatsapp',
    from: '+919876543210',
    fromName: 'Surveyor — Anand',
    subject: '[WhatsApp] Need IRDAI guidance link',
    timestamp: '06:08 PM',
    preview: 'Sir, can you share the IRDAI circular reference for current paint blending tariff? Need to cite in tomorrow report.',
    body: `Sir, can you share the IRDAI circular reference for current paint blending tariff?

Need to cite in tomorrow report.

Thanks,
Anand`,
    autoTag: 'internal-admin',
    confidence: 0.78,
    status: 'pending-review',
    extracted: {},
    attachments: 0,
    flag: 'Low confidence — review tag'
  }
];

// ============================================================================
// Live classifier — calls Claude API
// ============================================================================

async function classifyMessage(text) {
  const tagDescriptions = Object.values(TAGS).map(t => `- ${t.id}: ${t.description}`).join('\n');
  const tagIds = Object.keys(TAGS);
  const systemPrompt = `You are a classification engine for NISLA (Nathani Insurance Surveyors and Loss Assessors). Classify incoming emails and WhatsApp messages into one of these workflow tags:

${tagDescriptions}

Respond in this exact JSON format with no preamble or markdown:
{
  "tag": "<one of: ${tagIds.join(', ')}>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one short sentence>",
  "extracted": { <relevant fields per the tag schema, or {} if internal-admin> }
}

For intimation: extract policy_no, insured_name, vehicle_or_property, date_of_loss, location, contact, sum_insured, lob.
For surveyor-photos: extract claim_ref, photo_count, location_metadata, capture_date.
For site-visit-report: extract claim_ref, visit_date, cause_of_loss, observations, further_docs_needed.
For insurer-query: extract claim_ref, query_type, requested_info, response_deadline.
For settlement-advice: extract claim_ref, settled_amount, settlement_date, deductions, mode_of_payment.
For client-followup: extract claim_ref_or_name, query_summary, urgency.
For policy-doc: extract policy_no, insurer, insured, sum_insured, policy_period, lob.
Return null for any field not present in the message. Use ISO format for dates.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: text }]
    })
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

// ============================================================================
// Main component
// ============================================================================

export default function NISLACommsIntelligence() {
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [selectedId, setSelectedId] = useState('msg_001');
  const [tagFilter, setTagFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showLiveDemo, setShowLiveDemo] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [liveResult, setLiveResult] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(null);
  const [editingTag, setEditingTag] = useState(false);

  const selected = messages.find(m => m.id === selectedId);

  const filtered = messages.filter(m => {
    if (tagFilter !== 'all' && m.autoTag !== tagFilter) return false;
    if (sourceFilter !== 'all' && m.source !== sourceFilter) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (searchQuery && !(m.subject + m.fromName + m.preview).toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: messages.length,
    pendingReview: messages.filter(m => m.status === 'pending-review').length,
    autoRouted: messages.filter(m => m.status === 'auto-routed').length,
    needsAttention: messages.filter(m => m.confidence < 0.85).length
  };

  const tagCounts = Object.keys(TAGS).reduce((acc, t) => {
    acc[t] = messages.filter(m => m.autoTag === t).length;
    return acc;
  }, {});

  function approveMessage(id) {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, status: 'auto-routed' } : m));
  }

  function changeMessageTag(id, newTag) {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, autoTag: newTag, status: 'pending-review' } : m));
    setEditingTag(false);
  }

  async function runLiveClassifier() {
    if (!liveText.trim()) return;
    setLiveLoading(true);
    setLiveError(null);
    setLiveResult(null);
    try {
      const result = await classifyMessage(liveText);
      setLiveResult(result);
    } catch (err) {
      setLiveError(err.message);
    } finally {
      setLiveLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900">
      {/* ============================== HEADER ============================== */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-slate-700 to-blue-800 rounded-md flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 leading-tight">Communications Intelligence</div>
              <div className="text-xs text-slate-500 leading-tight">NISLA · Inbox triage and auto-routing</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatPill icon={Inbox} label="Total" value={stats.total} color="slate" />
          <StatPill icon={Clock} label="Pending" value={stats.pendingReview} color="amber" />
          <StatPill icon={CheckCircle2} label="Routed" value={stats.autoRouted} color="emerald" />
          {stats.needsAttention > 0 && (
            <StatPill icon={AlertTriangle} label="Low conf." value={stats.needsAttention} color="rose" />
          )}
          <div className="w-px h-7 bg-slate-200 mx-2" />
          <button
            onClick={() => setShowLiveDemo(true)}
            className="px-3 py-1.5 text-sm font-medium bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-md flex items-center gap-1.5 hover:from-emerald-700 hover:to-emerald-800 shadow-sm transition-all"
          >
            <Zap className="w-3.5 h-3.5" />
            Test Classifier
            <span className="text-[9px] uppercase tracking-wider bg-white/20 px-1 py-0.5 rounded">Live</span>
          </button>
        </div>
      </header>

      {/* ============================== BODY ============================== */}
      <div className="flex flex-1 overflow-hidden">

        {/* ----------------- TAG SIDEBAR ----------------- */}
        <aside className="w-60 bg-white border-r border-slate-200 overflow-y-auto shrink-0">
          <div className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 px-2">Source</div>
            <div className="space-y-0.5 mb-4">
              <SourceButton active={sourceFilter === 'all'} onClick={() => setSourceFilter('all')} icon={Inbox} label="All sources" count={messages.length} />
              <SourceButton active={sourceFilter === 'email'} onClick={() => setSourceFilter('email')} icon={Mail} label="Email" count={messages.filter(m => m.source === 'email').length} />
              <SourceButton active={sourceFilter === 'whatsapp'} onClick={() => setSourceFilter('whatsapp')} icon={MessageCircle} label="WhatsApp" count={messages.filter(m => m.source === 'whatsapp').length} />
            </div>

            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 px-2 mt-4">Status</div>
            <div className="space-y-0.5 mb-4">
              <SourceButton active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} icon={Activity} label="All" count={messages.length} />
              <SourceButton active={statusFilter === 'pending-review'} onClick={() => setStatusFilter('pending-review')} icon={Clock} label="Pending review" count={stats.pendingReview} />
              <SourceButton active={statusFilter === 'auto-routed'} onClick={() => setStatusFilter('auto-routed')} icon={CheckCircle2} label="Auto-routed" count={stats.autoRouted} />
            </div>

            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 px-2 mt-4">Tag</div>
            <div className="space-y-0.5">
              <button
                onClick={() => setTagFilter('all')}
                className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center justify-between transition-colors ${
                  tagFilter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-2">
                  <TagIcon className="w-3 h-3" />
                  All tags
                </span>
                <span className="text-[10px] opacity-70">{messages.length}</span>
              </button>
              {Object.values(TAGS).map(t => {
                const Icon = t.icon;
                const c = TAG_COLORS[t.color];
                const active = tagFilter === t.id;
                const count = tagCounts[t.id] || 0;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTagFilter(t.id)}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center justify-between transition-colors ${
                      active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                      <Icon className="w-3 h-3 shrink-0" />
                      <span className="truncate">{t.label}</span>
                    </span>
                    <span className={`text-[10px] shrink-0 ml-1 ${active ? 'opacity-70' : 'text-slate-400'}`}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 px-2">Today's volume</div>
              <div className="px-2 space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Auto-routed</span>
                  <span className="font-semibold text-emerald-700">47</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Drafts created</span>
                  <span className="font-semibold text-blue-700">12</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Time saved</span>
                  <span className="font-semibold text-violet-700">~2.4 hrs</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ----------------- MESSAGE LIST ----------------- */}
        <main className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
          <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search subject, sender, content..."
              className="flex-1 text-sm focus:outline-none placeholder:text-slate-400"
            />
            {(tagFilter !== 'all' || sourceFilter !== 'all' || statusFilter !== 'all') && (
              <button
                onClick={() => { setTagFilter('all'); setSourceFilter('all'); setStatusFilter('all'); }}
                className="text-xs text-blue-700 hover:text-blue-900 underline"
              >
                Clear filters
              </button>
            )}
            <span className="text-xs text-slate-500 ml-2">{filtered.length} of {messages.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-sm text-slate-400">
                <Inbox className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                No messages match the current filters.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filtered.map(m => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    selected={selectedId === m.id}
                    onClick={() => setSelectedId(m.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* ----------------- DETAIL PANE ----------------- */}
        {selected && (
          <aside className="w-[480px] bg-white border-l border-slate-200 overflow-y-auto shrink-0">
            <DetailPane
              message={selected}
              onApprove={() => approveMessage(selected.id)}
              onChangeTag={(t) => changeMessageTag(selected.id, t)}
              editingTag={editingTag}
              setEditingTag={setEditingTag}
            />
          </aside>
        )}
      </div>

      {/* ============================== LIVE DEMO MODAL ============================== */}
      {showLiveDemo && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4" onClick={() => setShowLiveDemo(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-emerald-100/40">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900 flex items-center gap-2">
                    Live Classifier Demo
                    <span className="text-[10px] uppercase tracking-wider bg-emerald-600 text-white px-1.5 py-0.5 rounded">Live API</span>
                  </div>
                  <div className="text-xs text-slate-600">Paste any email or WhatsApp message — Claude classifies and extracts in real time</div>
                </div>
              </div>
              <button onClick={() => setShowLiveDemo(false)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              <div className="mb-3">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 block">Message text</label>
                <textarea
                  value={liveText}
                  onChange={e => setLiveText(e.target.value)}
                  rows={8}
                  placeholder="Paste an email or WhatsApp message here. Try a settlement advice, an insurer query, or a new claim intimation..."
                  className="w-full border border-slate-300 rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={runLiveClassifier}
                  disabled={!liveText.trim() || liveLoading}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 text-sm font-medium transition-colors"
                >
                  {liveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {liveLoading ? 'Classifying…' : 'Classify'}
                </button>
                <div className="flex flex-wrap gap-1.5 ml-1">
                  <button
                    onClick={() => setLiveText(`Subject: New Motor OD Claim\n\nPolicy No: TATA/2024/MTR/9921. Insured: Mr. P. Kumar. Vehicle: Tata Nexon 2023, MH-12-AB-3344. SI: ₹14,50,000. Date of loss: 19-Apr-2026. Location: Sinhagad Road, Pune. Front-end collision. Contact: +91-99XX112233.`)}
                    className="text-[11px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >Sample 1: Intimation</button>
                  <button
                    onClick={() => setLiveText(`Settlement processed for claim CLM/2024/FIRE/0091. Settled amount Rs 14,20,000. Date 22-Apr-2026. Mode RTGS to insured. Deductions Nil. Please raise fee invoice.`)}
                    className="text-[11px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >Sample 2: Settlement</button>
                  <button
                    onClick={() => setLiveText(`Sir please check status of my claim, garage waiting since one week. Honda City MH04AA1247. Mehta`)}
                    className="text-[11px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >Sample 3: Client follow-up</button>
                </div>
              </div>

              {liveError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded text-sm mb-3">
                  Error: {liveError}
                </div>
              )}

              {liveResult && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Classification</div>
                    <div className="flex items-center gap-3">
                      {(() => {
                        const t = TAGS[liveResult.tag];
                        if (!t) return <span className="text-sm text-rose-700">Unknown tag: {liveResult.tag}</span>;
                        const Icon = t.icon;
                        const c = TAG_COLORS[t.color];
                        return (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-semibold border ${c.bg} ${c.text} ${c.border}`}>
                            <Icon className="w-3.5 h-3.5" />
                            {t.label}
                          </span>
                        );
                      })()}
                      <ConfidenceBadge confidence={liveResult.confidence} />
                    </div>
                    {liveResult.reasoning && (
                      <div className="text-xs text-slate-600 mt-2 italic">{liveResult.reasoning}</div>
                    )}
                  </div>
                  {liveResult.extracted && Object.keys(liveResult.extracted).length > 0 && (
                    <div className="p-4">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Extracted fields</div>
                      <ExtractionGrid data={liveResult.extracted} />
                    </div>
                  )}
                  {liveResult.tag && TAGS[liveResult.tag] && (
                    <div className="bg-slate-50 px-4 py-3 border-t border-slate-200">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Would trigger actions</div>
                      <ul className="space-y-1">
                        {TAGS[liveResult.tag].actions.map((a, i) => (
                          <li key={i} className="text-xs text-slate-700 flex items-start gap-1.5">
                            <ArrowRight className="w-3 h-3 mt-0.5 text-blue-600 shrink-0" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================

function StatPill({ icon: Icon, label, value, color }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-100 text-amber-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    rose: 'bg-rose-100 text-rose-800',
  };
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${colors[color]}`}>
      <Icon className="w-3.5 h-3.5" />
      <span className="font-semibold">{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

function SourceButton({ active, onClick, icon: Icon, label, count }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center justify-between transition-colors ${
        active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      <span className="flex items-center gap-2">
        <Icon className="w-3 h-3" />
        {label}
      </span>
      <span className={`text-[10px] ${active ? 'opacity-70' : 'text-slate-400'}`}>{count}</span>
    </button>
  );
}

function ConfidenceBadge({ confidence }) {
  const pct = Math.round(confidence * 100);
  let cls;
  if (pct >= 90) cls = 'bg-emerald-100 text-emerald-800';
  else if (pct >= 75) cls = 'bg-amber-100 text-amber-800';
  else cls = 'bg-rose-100 text-rose-800';
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${cls}`}>
      {pct}% conf.
    </span>
  );
}

function MessageRow({ message, selected, onClick }) {
  const tag = TAGS[message.autoTag];
  const TagIconComp = tag?.icon || TagIcon;
  const c = TAG_COLORS[tag?.color || 'slate'];
  const SourceIcon = message.source === 'whatsapp' ? MessageCircle : Mail;

  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 cursor-pointer transition-colors border-l-2 ${
        selected
          ? `bg-blue-50/50 border-l-blue-600`
          : `border-l-transparent hover:bg-slate-100/60 ${message.status === 'pending-review' ? 'bg-amber-50/30' : 'bg-white'}`
      }`}
    >
      <div className="flex items-start gap-3">
        <SourceIcon className={`w-4 h-4 mt-0.5 shrink-0 ${message.source === 'whatsapp' ? 'text-emerald-600' : 'text-blue-700'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="font-semibold text-sm text-slate-900 truncate">{message.fromName}</span>
            <span className="text-[11px] text-slate-500 shrink-0">{message.timestamp}</span>
          </div>
          <div className="text-sm text-slate-800 truncate mb-1">{message.subject}</div>
          <div className="text-xs text-slate-500 line-clamp-1 mb-2">{message.preview}</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${c.bg} ${c.text} ${c.border}`}>
              <TagIconComp className="w-2.5 h-2.5" />
              {tag?.short || message.autoTag}
            </span>
            <ConfidenceBadge confidence={message.confidence} />
            {message.attachments > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-600">
                <Paperclip className="w-2.5 h-2.5" /> {message.attachments}
              </span>
            )}
            {message.status === 'auto-routed' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-medium ml-auto">
                <CheckCircle2 className="w-2.5 h-2.5" /> Routed
              </span>
            )}
            {message.status === 'pending-review' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-800 font-medium ml-auto">
                <Clock className="w-2.5 h-2.5" /> Review
              </span>
            )}
          </div>
          {message.flag && (
            <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
              <AlertTriangle className="w-2.5 h-2.5" /> {message.flag}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExtractionGrid({ data }) {
  const entries = Object.entries(data).filter(([_, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return <div className="text-xs text-slate-400 italic">No fields extracted.</div>;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="border-l-2 border-slate-200 pl-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{k.replace(/_/g, ' ')}</div>
          <div className="text-sm text-slate-900 font-medium break-words">{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

function DetailPane({ message, onApprove, onChangeTag, editingTag, setEditingTag }) {
  const tag = TAGS[message.autoTag];
  const TagIconComp = tag?.icon || TagIcon;
  const c = TAG_COLORS[tag?.color || 'slate'];
  const SourceIcon = message.source === 'whatsapp' ? MessageCircle : Mail;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2 mb-2">
          <SourceIcon className={`w-4 h-4 ${message.source === 'whatsapp' ? 'text-emerald-600' : 'text-blue-700'}`} />
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            {message.source === 'whatsapp' ? 'WhatsApp' : 'Email'} · {message.timestamp}
          </span>
        </div>
        <div className="text-base font-semibold text-slate-900 mb-1.5">{message.subject}</div>
        <div className="text-xs text-slate-600">From: <span className="font-medium text-slate-800">{message.fromName}</span> · {message.from}</div>
      </div>

      {/* Tag and confidence */}
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Auto-applied tag</span>
          <button
            onClick={() => setEditingTag(!editingTag)}
            className="text-[11px] text-blue-700 hover:text-blue-900 flex items-center gap-1"
          >
            <Edit3 className="w-3 h-3" /> {editingTag ? 'Cancel' : 'Override'}
          </button>
        </div>
        {!editingTag ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-semibold border ${c.bg} ${c.text} ${c.border}`}>
              <TagIconComp className="w-3.5 h-3.5" />
              {tag?.label}
            </span>
            <ConfidenceBadge confidence={message.confidence} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {Object.values(TAGS).map(t => {
              const Icon = t.icon;
              const tc = TAG_COLORS[t.color];
              return (
                <button
                  key={t.id}
                  onClick={() => onChangeTag(t.id)}
                  className={`text-left px-2 py-1.5 rounded text-xs border flex items-center gap-1.5 transition-all ${
                    message.autoTag === t.id ? `${tc.bg} ${tc.text} ${tc.border} font-semibold` : 'bg-white border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="text-xs text-slate-600 mt-2">{tag?.description}</div>
      </div>

      {/* Extracted fields */}
      {Object.keys(message.extracted).length > 0 && (
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3 flex items-center justify-between">
            <span>Extracted fields</span>
            <button className="text-[11px] text-blue-700 hover:text-blue-900 flex items-center gap-1 normal-case tracking-normal">
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          </div>
          <ExtractionGrid data={message.extracted} />
        </div>
      )}

      {/* Proposed actions */}
      {tag && tag.actions.length > 0 && (
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Proposed actions</div>
          <ul className="space-y-1.5">
            {tag.actions.map((a, i) => (
              <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-blue-600 shrink-0" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Message body */}
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Message body</div>
        <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed bg-slate-50 border border-slate-200 rounded-md p-3 max-h-64 overflow-y-auto">
          {message.body}
        </div>
        {message.attachments > 0 && (
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <Paperclip className="w-3.5 h-3.5" />
            {message.attachments} attachment{message.attachments > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-5 py-4 bg-white sticky bottom-0 border-t border-slate-200">
        {message.status === 'pending-review' ? (
          <div className="flex gap-2">
            <button
              onClick={onApprove}
              className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-2 rounded-md font-medium text-sm flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Approve and route
            </button>
            <button className="px-3 py-2 border border-slate-300 text-slate-700 rounded-md text-sm hover:bg-slate-50">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md px-3 py-2 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Auto-routed — actions completed.</span>
            <button className="ml-auto text-xs text-emerald-700 hover:text-emerald-900 underline">View log</button>
          </div>
        )}
      </div>
    </div>
  );
}
