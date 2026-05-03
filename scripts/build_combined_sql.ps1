# Concatenate all 48 migrations into one SQL file. Each migration is wrapped
# in its OWN `BEGIN;`/`COMMIT;` so that:
#   - successful migrations commit independently
#   - on failure, all PRIOR migrations are already persisted
#   - we can query a tracking table after the run to pinpoint exactly which
#     migration failed (the next one after the last successful entry)
#
# Standalone `BEGIN;` and `COMMIT;` lines inside each migration are stripped;
# `BEGIN`/`END;` PL/pgSQL bodies are left intact.
#
# Output: supabase/_combined_for_sql_editor.sql (gitignored)

$ErrorActionPreference = 'Stop'

$migrationsDir = 'supabase\migrations'
$out = 'supabase\_combined_for_sql_editor.sql'

if (-not (Test-Path $migrationsDir)) {
    Write-Host "ERROR: $migrationsDir not found" -ForegroundColor Red
    exit 1
}

$files = Get-ChildItem $migrationsDir -Filter '*.sql' | Sort-Object Name

# Header: create the tracking table outside any migration's transaction so it
# survives any failure. SQL Editor runs everything in a single session, so the
# table will be visible to subsequent statements.
$header = @"
-- ================================================================
-- NISLA Surveyor MIS - Combined initial schema for new project
-- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
-- Migrations: $($files.Count)
-- Project: khtxngncvkwhoaybiigt
--
-- Strategy: each migration runs in its own transaction (BEGIN/COMMIT).
-- Tracking table _bootstrap_progress records each successful migration so
-- that on a failure we can identify exactly which migration broke.
--
-- After running:
--   - Success: SELECT count(*) FROM _bootstrap_progress;  -- should be $($files.Count)
--   - Failure: SELECT * FROM _bootstrap_progress ORDER BY id DESC LIMIT 5;
--              The migration AFTER the latest entry is the one that failed.
-- ================================================================

-- Tracking table (committed immediately so it survives any later failure)
DROP TABLE IF EXISTS _bootstrap_progress;
CREATE TABLE _bootstrap_progress (
    id           BIGSERIAL PRIMARY KEY,
    migration    TEXT NOT NULL,
    applied_at   TIMESTAMPTZ DEFAULT now()
);

"@

Set-Content -Path $out -Value $header -Encoding UTF8

# Regex: standalone "BEGIN;" / "COMMIT;" lines (transaction control). Will
# NOT match "BEGIN" without a semicolon (PL/pgSQL block start).
$txnLineRegex = '^\s*(BEGIN|COMMIT)\s*;\s*$'

$strippedCount = 0
$index = 0
foreach ($f in $files) {
    $index++
    $name = $f.Name

    $marker = @"

-- ================================================================
-- [$index/$($files.Count)] $name
-- ================================================================
BEGIN;
INSERT INTO _bootstrap_progress (migration) VALUES ('$name');
"@
    Add-Content -Path $out -Value $marker -Encoding UTF8

    $content = Get-Content $f.FullName
    $cleaned = @()
    foreach ($line in $content) {
        if ($line -match $txnLineRegex) {
            $strippedCount++
            $cleaned += "-- [stripped txn-control: $($line.Trim())]"
        } else {
            $cleaned += $line
        }
    }
    Add-Content -Path $out -Value ($cleaned -join "`n") -Encoding UTF8
    Add-Content -Path $out -Value "COMMIT;" -Encoding UTF8
}

$footer = @"

-- ================================================================
-- DONE. Verify:
--   SELECT count(*) FROM _bootstrap_progress;  -- expect $($files.Count)
-- ================================================================
"@
Add-Content -Path $out -Value $footer -Encoding UTF8

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "Wrote $out ($size KB, $($files.Count) migrations, stripped $strippedCount inner txn-control lines)" -ForegroundColor Green
