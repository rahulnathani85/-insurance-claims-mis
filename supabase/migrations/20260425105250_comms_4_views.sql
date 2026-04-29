-- ============================================================
-- Comms Intelligence — Migration 4: Views
-- SAFE: Purely additive. Idempotent (CREATE OR REPLACE).
-- ============================================================
-- Two views for the UI:
--   v_comms_inbox_with_classification  — one row per message
--       joined to its active classification, extraction, and
--       tag metadata
--   v_comms_today_stats                — per-tag totals for today
-- ============================================================

BEGIN;

CREATE OR REPLACE VIEW v_comms_inbox_with_classification AS
SELECT
  m.id                  AS message_id,
  m.source,
  m.from_address,
  m.from_display,
  m.subject,
  m.body_plain,
  m.received_at,
  m.attachments_count,
  m.status              AS message_status,
  m.company,
  m.mailbox_user_email,
  c.id                  AS classification_id,
  c.tag                 AS auto_tag,
  c.confidence,
  c.reasoning,
  c.classified_at,
  c.classified_by,
  e.extracted_data,
  e.is_valid            AS extraction_valid,
  td.display_label      AS tag_label,
  td.ui_color           AS tag_color,
  td.routing_actions    AS proposed_actions,
  td.auto_route_threshold
FROM inbox_messages m
LEFT JOIN message_classifications c
  ON c.message_id = m.id AND c.is_active = true
LEFT JOIN extraction_results e
  ON e.classification_id = c.id
LEFT JOIN tag_definitions td
  ON td.tag = c.tag;

COMMENT ON VIEW v_comms_inbox_with_classification IS
  'Single-row-per-message view combining classification, extraction, and tag metadata for UI consumption.';

CREATE OR REPLACE VIEW v_comms_today_stats AS
SELECT
  m.company,
  c.tag,
  count(*) FILTER (WHERE m.status = 'auto_routed')      AS auto_routed_count,
  count(*) FILTER (WHERE m.status = 'pending_review')   AS pending_review_count,
  count(*) FILTER (WHERE m.status = 'error')            AS error_count,
  count(*)                                              AS total_count,
  avg(c.confidence)                                     AS avg_confidence
FROM inbox_messages m
JOIN message_classifications c
  ON c.message_id = m.id AND c.is_active = true
WHERE m.received_at >= current_date
GROUP BY m.company, c.tag;

COMMENT ON VIEW v_comms_today_stats IS
  'Per-company per-tag stats for today, used in the dashboard header.';

COMMIT;
