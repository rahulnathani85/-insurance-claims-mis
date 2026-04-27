// ============================================================
// lib/comms/prompts/replyPrompt.js
// ------------------------------------------------------------
// Builds the prompt that asks the LLM to draft a reply email
// for a triaged inbox message.
//
// Per-tag tone guidance:
//   insurer_query   — formal, address each query point, commit to
//                     a turnaround time when documents are gathered
//   client_followup — empathetic, clear next-step, set expectations
//   consent_email   — acknowledge receipt, confirm next action
//   intimation      — acknowledge intimation, confirm appointment
//                     details, request access if needed
//
// Output contract: a strict JSON object with { subject, body }
// so we can save them as separate fields without parsing prose.
// ============================================================

const TAG_GUIDANCE = {
  insurer_query:
    'Tone: formal, professional. Address each query point in the original email. ' +
    'If documents are pending, commit to a turnaround (typically 5-7 working days) and list what is being collected. ' +
    'Sign off with the surveyor name and contact.',
  client_followup:
    'Tone: empathetic, reassuring. Confirm the current claim status, give a clear next step, ' +
    'and set realistic expectations on timing. Avoid jargon.',
  consent_email:
    'Tone: warm, brief. Acknowledge receipt of the consent. State the next action ' +
    '(e.g., "we will proceed with the survey scheduled for ...").',
  intimation:
    'Tone: prompt, professional. Acknowledge the intimation. Confirm appointment details if any. ' +
    'Request access / contact details if not already provided.',
  surveyor_photos:
    'Tone: brief, professional. Acknowledge receipt of photos. Confirm they are filed against the claim.',
  default:
    'Tone: professional, brief. Acknowledge the email and indicate the next action being taken.',
};

const OUTPUT_INSTRUCTIONS = `
Output ONLY a JSON object on a single block, no markdown, no explanation, in this exact shape:

{
  "subject": "Re: <original-subject>",
  "body": "Dear <name>,\\n\\n<reply paragraphs>\\n\\nRegards,\\n<surveyor name>"
}

Rules:
- "subject" must start with "Re:" if not already present in the original
- "body" must use \\n for newlines (real linebreaks inside JSON would be invalid)
- Do NOT invent claim numbers, amounts, or dates that aren't in the input
- Do NOT mark up with HTML — plain text only
- Keep under 250 words
- Sign off with "Nathani Insurance Surveyors & Loss Assessors" and the surveyor name from extracted_data if available
`;

export function buildReplyPrompt({ message, tag, extractedData = {}, claim, surveyorName }) {
  const guidance = TAG_GUIDANCE[tag] || TAG_GUIDANCE.default;

  const systemPrompt = [
    'You are an experienced insurance loss-adjusting surveyor at Nathani Insurance Surveyors & Loss Assessors',
    'drafting a reply to an inbound email. The reply will be reviewed and edited by a human before sending.',
    '',
    'Guidelines for this email type:',
    guidance,
    '',
    OUTPUT_INSTRUCTIONS.trim(),
  ].join('\n');

  const claimContext = claim
    ? `Claim reference: ${claim.ref_number || claim.id}\nLOB: ${claim.lob || 'unknown'}\nStatus: ${claim.claim_status || claim.status || 'unknown'}\n`
    : '(no matching claim was found in our system — keep the reply generic and ask the sender to clarify the claim reference if needed)\n';

  const extractedSummary = Object.keys(extractedData).length
    ? `\nExtracted from the inbound email:\n${Object.entries(extractedData)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join('\n')}\n`
    : '';

  const userMessage = [
    `Inbound email is tagged as: ${tag}`,
    '',
    'Inbound email metadata:',
    `  From: ${message.from_address || 'unknown'}`,
    `  Subject: ${message.subject || '(no subject)'}`,
    `  Received: ${message.received_at || ''}`,
    '',
    'Inbound email body (plain text):',
    '"""',
    (message.body_plain || '').slice(0, 4000),
    '"""',
    '',
    'Claim context:',
    claimContext,
    extractedSummary,
    surveyorName ? `Surveyor signing off: ${surveyorName}` : '',
    '',
    'Draft the reply now.',
  ].join('\n');

  return { systemPrompt, userMessage };
}

export function parseReplyJson(text) {
  if (!text) throw new Error('Empty LLM response');
  // Strip code fences if present.
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  // Some models wrap in extra prose; grab the first {...} block.
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in response');
  const slice = stripped.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(slice);
  } catch (err) {
    throw new Error(`Reply JSON parse failed: ${err.message}`);
  }

  if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
    throw new Error('Reply JSON missing subject/body');
  }
  return parsed;
}
