# Insurance Claims MIS - Auto Folder Creator
# Run this script on the cloud server to auto-create folders for claims and policies
# Usage: .\create-folders.ps1 (runs once) or schedule via Task Scheduler

$SUPABASE_URL = "https://ffljqrcavjkfpkvvsvza.supabase.co"
$SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmbGpxcmNhdmprZnBrdnZzdnphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzA0NTUsImV4cCI6MjA5MDUwNjQ1NX0.2L0PSlrdum5hFkB18os1yaw3pMaOcXVCeHBADK3Hn8o"
$BASE_PATH = "D:\2026-27"

$headers = @{
    "apikey" = $SUPABASE_KEY
    "Authorization" = "Bearer $SUPABASE_KEY"
    "Content-Type" = "application/json"
}

Write-Host "===== Insurance Claims MIS - Folder Creator =====" -ForegroundColor Cyan
Write-Host "Base Path: $BASE_PATH" -ForegroundColor Gray
Write-Host ""

# Create base directory
if (!(Test-Path $BASE_PATH)) {
    New-Item -ItemType Directory -Path $BASE_PATH -Force | Out-Null
    Write-Host "[Created] $BASE_PATH" -ForegroundColor Green
}

# ========== CLAIM FOLDERS ==========
Write-Host "`n--- Creating Claim Folders ---" -ForegroundColor Yellow

try {
    $claimsUrl = "$SUPABASE_URL/rest/v1/claims?select=id,company,lob,ref_number,insured_name,folder_path&order=created_at.desc"
    $claims = Invoke-RestMethod -Uri $claimsUrl -Headers $headers -Method Get

    foreach ($claim in $claims) {
        if ($claim.folder_path -and !(Test-Path $claim.folder_path)) {
            try {
                New-Item -ItemType Directory -Path $claim.folder_path -Force | Out-Null
                Write-Host "[Created] $($claim.folder_path)" -ForegroundColor Green
            } catch {
                Write-Host "[Error] Could not create: $($claim.folder_path) - $_" -ForegroundColor Red
            }
        }
    }
    Write-Host "Processed $($claims.Count) claims" -ForegroundColor Gray
} catch {
    Write-Host "[Error] Failed to fetch claims: $_" -ForegroundColor Red
}

# ========== POLICY FOLDERS ==========
Write-Host "`n--- Creating Policy Folders ---" -ForegroundColor Yellow

try {
    $policiesUrl = "$SUPABASE_URL/rest/v1/policies?select=id,company,policy_number,insured_name,folder_path&order=created_at.desc"
    $policies = Invoke-RestMethod -Uri $policiesUrl -Headers $headers -Method Get

    foreach ($policy in $policies) {
        if ($policy.folder_path -and !(Test-Path $policy.folder_path)) {
            try {
                New-Item -ItemType Directory -Path $policy.folder_path -Force | Out-Null
                Write-Host "[Created] $($policy.folder_path)" -ForegroundColor Green
            } catch {
                Write-Host "[Error] Could not create: $($policy.folder_path) - $_" -ForegroundColor Red
            }
        }
    }
    Write-Host "Processed $($policies.Count) policies" -ForegroundColor Gray
} catch {
    Write-Host "[Error] Failed to fetch policies: $_" -ForegroundColor Red
}

Write-Host "`n===== Folder Creation Complete =====" -ForegroundColor Cyan
Write-Host "Tip: Schedule this script in Windows Task Scheduler to run every 5 minutes" -ForegroundColor Gray
