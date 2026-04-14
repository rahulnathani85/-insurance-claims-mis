// Comprehensive activity logger for all user actions
// Logs to activity_log table in Supabase

export async function logActivity({
  userEmail,
  userName,
  action,
  entityType,
  entityId,
  claimId,
  refNumber,
  details,
  company = 'NISLA',
}) {
  try {
    await fetch('/api/activity-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: userEmail,
        user_name: userName,
        action,
        entity_type: entityType,
        entity_id: entityId,
        claim_id: claimId,
        ref_number: refNumber,
        details: typeof details === 'string' ? details : JSON.stringify(details),
        company,
      }),
    });
  } catch (e) {
    console.warn('Activity log failed (non-fatal):', e.message);
  }
}

// Pre-defined action types for consistency
export const ACTIONS = {
  // Claim lifecycle
  CLAIM_CREATED: 'claim_created',
  CLAIM_UPDATED: 'claim_updated',
  CLAIM_DELETED: 'claim_deleted',

  // Pipeline stages
  STAGE_UPDATED: 'stage_updated',
  STAGE_COMPLETED: 'stage_completed',
  STAGE_SKIPPED: 'stage_skipped',

  // Documents
  DOCUMENT_UPLOADED: 'document_uploaded',
  DOCUMENT_DELETED: 'document_deleted',
  PHOTO_UPLOADED: 'photo_uploaded',

  // FSR
  FSR_GENERATED: 'fsr_generated',
  FSR_DOWNLOADED_PDF: 'fsr_downloaded_pdf',
  FSR_DOWNLOADED_WORD: 'fsr_downloaded_word',
  FSR_SAVED_TO_FOLDER: 'fsr_saved_to_folder',

  // Assignments
  TEAM_ASSIGNED: 'team_assigned',
  TEAM_REASSIGNED: 'team_reassigned',

  // Data changes
  CHANGES_SAVED: 'changes_saved',
  SURVEYOR_ASSIGNED: 'surveyor_assigned',
  SLA_DATE_SET: 'sla_date_set',
};
