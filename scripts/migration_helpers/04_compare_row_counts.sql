-- =============================================================================
-- 04_compare_row_counts.sql
-- =============================================================================
-- Run this on BOTH the OLD and NEW SQL Editors. Compare the output side by
-- side. Every table in `public` should have the same row count after migration.
--
-- Run on OLD first, save output. Then run on NEW. Diff manually or paste both
-- here and Claude will spot mismatches.
-- =============================================================================

SELECT
    table_name,
    (xpath('/row/c/text()',
        query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
                     true, true, '')))[1]::text::bigint AS row_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
