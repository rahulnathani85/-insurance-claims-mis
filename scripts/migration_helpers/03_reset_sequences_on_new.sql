-- =============================================================================
-- 03_reset_sequences_on_new.sql
-- =============================================================================
-- Run this on the NEW project's SQL Editor AFTER importing data from OLD.
--
-- When you bulk-INSERT rows that include explicit BIGSERIAL ids (e.g. claims.id
-- = 1, 2, 3 from OLD), Postgres does NOT advance the underlying sequence. The
-- next INSERT without a specified id would try id=1 and fail with PK conflict.
--
-- This script walks every BIGSERIAL/IDENTITY sequence in the public schema and
-- sets it to MAX(id) + 1 so future INSERTs work cleanly.
-- =============================================================================

DO $$
DECLARE
    rec RECORD;
    seq_name TEXT;
    max_id BIGINT;
BEGIN
    FOR rec IN
        SELECT
            c.oid::regclass::text AS table_name,
            a.attname              AS column_name,
            pg_get_serial_sequence(c.oid::regclass::text, a.attname) AS seq_full
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND pg_get_serial_sequence(c.oid::regclass::text, a.attname) IS NOT NULL
          AND c.relkind = 'r'  -- regular tables only, no views
    LOOP
        seq_name := rec.seq_full;
        EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %s', rec.column_name, rec.table_name)
            INTO max_id;

        IF max_id > 0 THEN
            EXECUTE format('SELECT setval(%L, %s, true)', seq_name, max_id);
            RAISE NOTICE 'Reset % to %', seq_name, max_id;
        ELSE
            -- empty table: leave sequence at its current state, next val will be 1
            RAISE NOTICE 'Skipped % (table empty)', seq_name;
        END IF;
    END LOOP;
END $$;

-- Verify a few key sequences look right
SELECT
    sequence_name,
    last_value,
    is_called
FROM information_schema.sequences s
JOIN pg_sequences ps ON ps.sequencename = s.sequence_name AND ps.schemaname = s.sequence_schema
WHERE s.sequence_schema = 'public'
ORDER BY sequence_name;
