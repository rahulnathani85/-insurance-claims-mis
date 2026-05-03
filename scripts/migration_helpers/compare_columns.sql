-- Run this with -t -A on BOTH NEW and OLD; diff the outputs to find column drift
SELECT table_name || '.' || column_name AS qualified
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  )
ORDER BY table_name, ordinal_position;
