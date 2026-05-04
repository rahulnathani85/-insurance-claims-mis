-- ============================================================
-- Backfill claims.folder_path for rows that registered without one
-- ------------------------------------------------------------
-- Mirrors the JS helper in lib/folderPath.js / the legacy POST
-- /api/claims behaviour:
--   D:\2026-27\<company>\<LOB>\<safe ref> - <safe insured>
--
-- Why this exists: claims born from the comms pipeline
-- (lib/comms/executor.js actionCreateClaim) were inserted with
-- folder_path = NULL. The new registration flow (PUT /api/claims/[id]
-- promotion + POST /register) didn't set folder_path either. Files
-- uploaded via the Documents tab on those claims have no target
-- directory layout. Going forward the PUT route writes folder_path
-- at ref-promotion time; this migration covers everything already
-- registered with a real ref but a NULL folder_path.
--
-- Safety:
--   - Idempotent: only touches rows where folder_path IS NULL.
--   - Skips placeholder-ref rows (ref_number LIKE 'INTAKE/%') —
--     those aren't real refs yet; folder_path will be computed
--     by the PUT route when they're promoted.
--   - Skips rows missing ref_number (defensive — should never
--     happen given the NOT NULL UNIQUE constraint, but the WHERE
--     keeps the UPDATE bounded).
--
-- Char set scrubbed: < > : " / \ | ? *  (Windows-illegal in
-- filenames). Matches the JS regex /[<>:"/\\|?*]/g.
-- ============================================================

BEGIN;

UPDATE public.claims
SET folder_path = concat(
  'D:\2026-27\',
  regexp_replace(coalesce(company, 'NISLA'), '[<>:"/\\|?*]', '_', 'g'),
  '\',
  regexp_replace(coalesce(lob, 'Miscellaneous'), '[<>:"/\\|?*]', '_', 'g'),
  '\',
  regexp_replace(coalesce(ref_number, ''), '[<>:"/\\|?*]', '_', 'g'),
  ' - ',
  substring(
    regexp_replace(coalesce(insured_name, 'Unknown'), '[<>:"/\\|?*]', '_', 'g')
    from 1 for 50
  )
)
WHERE folder_path IS NULL
  AND ref_number IS NOT NULL
  AND ref_number NOT LIKE 'INTAKE/%';

COMMIT;
