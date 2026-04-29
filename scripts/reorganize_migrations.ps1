# Reorganizes the legacy flat .sql files in supabase/ (and one at repo root)
# into supabase/migrations/<14-digit-UTC>_<name>.sql so the Supabase CLI
# can manage them. Each file's prefix is derived from the unix timestamp of
# its FIRST git commit, with a 1-second offset added for files committed
# together (so all prefixes are unique and chronological).
#
# Run from repo root: powershell -ExecutionPolicy Bypass -File scripts\reorganize_migrations.ps1

$ErrorActionPreference = 'Stop'

# Format: @(unix_ts, intra_commit_offset, old_path, descriptive_name)
$renames = @(
    @(1775537863, 0, 'supabase/schema.sql',                                      'initial_schema'),
    @(1775537863, 1, 'supabase/migration_v2.sql',                                'v2_company_and_folders'),
    @(1775537863, 2, 'supabase/migration_v3.sql',                                'v3_extended_schema'),
    @(1775537863, 3, 'supabase/migration_v4_development_mode.sql',               'v4_development_mode'),
    @(1775539654, 0, 'supabase/migration_v5_user_management_lor_ila.sql',        'v5_user_management_lor_ila'),
    @(1775540244, 0, 'supabase/migration_v6_development_sample_data.sql',        'v6_development_sample_data'),
    @(1775548182, 0, 'supabase/migration_v7_assignments_activity.sql',           'v7_assignments_activity'),
    @(1775548182, 1, 'supabase/migration_v8_activity_log_columns.sql',           'v8_activity_log_columns'),
    @(1775553027, 0, 'supabase/migration_v9_broker_master_claim_lifecycle.sql',  'v9_broker_master_claim_lifecycle'),
    @(1775564127, 0, 'migration_v10_claim_documents_gmail.sql',                  'v10_claim_documents_gmail'),
    @(1775626333, 0, 'supabase/migration_v11_chat_user_monitoring.sql',          'v11_chat_user_monitoring'),
    @(1775630487, 0, 'supabase/migration_v12_chat_mentions.sql',                 'v12_chat_mentions'),
    @(1775660758, 0, 'supabase/migration_v13_global_chat.sql',                   'v13_global_chat'),
    @(1775719763, 0, 'supabase/migration_v14_ew_vehicle_claims.sql',             'v14_ew_vehicle_claims'),
    @(1775904420, 0, 'supabase/migration_v15_ew_unique_ref_number.sql',          'v15_ew_unique_ref_number'),
    @(1776092708, 0, 'supabase/migration_fix_inconsistencies.sql',               'fix_inconsistencies'),
    @(1776096979, 0, 'supabase/migration_claim_categories.sql',                  'claim_categories'),
    @(1776097924, 0, 'supabase/migration_claim_categories_text_fields.sql',      'claim_categories_text_fields'),
    @(1776146507, 0, 'supabase/migration_seed_level4_and_ew_overhaul.sql',       'seed_level4_and_ew_overhaul'),
    @(1776146961, 0, 'supabase/migration_ew_stages_12_to_8.sql',                 'ew_stages_12_to_8'),
    @(1776148354, 0, 'supabase/migration_pipeline_stages.sql',                   'pipeline_stages'),
    @(1776150029, 0, 'supabase/migration_team_assignments.sql',                  'team_assignments'),
    @(1776156935, 0, 'supabase/migration_ai_features.sql',                       'ai_features'),
    @(1776179303, 0, 'supabase/migration_fsr_templates.sql',                     'fsr_templates'),
    @(1776181191, 0, 'supabase/migration_ew_documents_and_logging.sql',          'ew_documents_and_logging'),
    @(1776183209, 0, 'supabase/fix_duplicate_doc_categories.sql',                'fix_duplicate_doc_categories'),
    @(1776347491, 0, 'supabase/migration_ew_lots.sql',                           'ew_lots'),
    @(1776349407, 0, 'supabase/migration_ew_claims_lot_number.sql',              'ew_claims_lot_number'),
    @(1776668157, 0, 'supabase/001_lifecycle_engine.sql',                        'lifecycle_engine'),
    @(1776694559, 0, 'supabase/migration_fix_ew_claim_id_uuid.sql',              'fix_ew_claim_id_uuid'),
    @(1776694939, 0, 'supabase/migration_policies_insurer_office.sql',           'policies_insurer_office'),
    @(1777114367, 0, 'supabase/migration_comms_1_enums.sql',                     'comms_1_enums'),
    @(1777114367, 1, 'supabase/migration_comms_2_tables.sql',                    'comms_2_tables'),
    @(1777114367, 2, 'supabase/migration_comms_3_tag_seeds.sql',                 'comms_3_tag_seeds'),
    @(1777114367, 3, 'supabase/migration_comms_4_views.sql',                     'comms_4_views'),
    @(1777114367, 4, 'supabase/migration_comms_5_gmail_tokens_additive.sql',     'comms_5_gmail_tokens_additive'),
    @(1777114367, 5, 'supabase/migration_comms_6_oauth_state_and_patterns.sql',  'comms_6_oauth_state_and_patterns'),
    @(1777114367, 6, 'supabase/migration_comms_7_classification_runs.sql',       'comms_7_classification_runs'),
    @(1777114367, 7, 'supabase/migration_comms_8_config_and_audit.sql',          'comms_8_config_and_audit'),
    @(1777187822, 0, 'supabase/migration_comms_9_human_triage.sql',              'comms_9_human_triage'),
    @(1777193130, 0, 'supabase/migration_comms_10_pubsub_columns.sql',           'comms_10_pubsub_columns'),
    @(1777275498, 0, 'supabase/migration_comms_10_routing.sql',                  'comms_10_routing'),
    @(1777275498, 1, 'supabase/migration_comms_11a_enum_extend.sql',             'comms_11a_enum_extend'),
    @(1777275498, 2, 'supabase/migration_comms_11b_tag_updates.sql',             'comms_11b_tag_updates'),
    @(1777283858, 0, 'supabase/migration_comms_12_email_drafts.sql',             'comms_12_email_drafts'),
    @(1777283858, 1, 'supabase/migration_comms_13_enable_draft_reply.sql',       'comms_13_enable_draft_reply'),
    @(1777299244, 0, 'supabase/migration_comms_14_claim_phase.sql',              'comms_14_claim_phase'),
    @(1777307142, 0, 'supabase/migration_comms_15_intake_metadata.sql',          'comms_15_intake_metadata')
)

if (-not (Test-Path 'supabase/migrations')) {
    New-Item -ItemType Directory -Path 'supabase/migrations' | Out-Null
    Write-Host "Created supabase/migrations/"
}

$missing = @()
$plan = @()
foreach ($r in $renames) {
    $unixTs = [int64]$r[0] + [int64]$r[1]
    $offset = [DateTimeOffset]::FromUnixTimeSeconds($unixTs).ToUniversalTime()
    $prefix = $offset.ToString('yyyyMMddHHmmss')
    $newName = "${prefix}_$($r[3]).sql"
    $oldPath = $r[2]
    $newPath = "supabase/migrations/$newName"
    if (-not (Test-Path $oldPath)) {
        $missing += $oldPath
        continue
    }
    $plan += [PSCustomObject]@{Old = $oldPath; New = $newPath}
}

if ($missing.Count -gt 0) {
    Write-Host "Missing files (will skip):" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Plan: $($plan.Count) files to rename" -ForegroundColor Cyan
Write-Host ""

# Check for duplicate prefixes
$dups = $plan | Group-Object { Split-Path $_.New -Leaf } | Where-Object { $_.Count -gt 1 }
if ($dups) {
    Write-Host "ERROR: duplicate target names" -ForegroundColor Red
    $dups | ForEach-Object { Write-Host "  $($_.Name)" -ForegroundColor Red }
    exit 1
}

foreach ($p in $plan) {
    $output = git mv $p.Old $p.New 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL: $($p.Old) -> $($p.New)" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        exit 1
    }
}

Write-Host "Renamed $($plan.Count) files into supabase/migrations/" -ForegroundColor Green
