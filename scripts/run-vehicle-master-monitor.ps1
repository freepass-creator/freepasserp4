$ErrorActionPreference = 'Stop'
$repoPath = 'C:\dev\freepasserp4'
$auditPath = Join-Path $env:LOCALAPPDATA 'FreepassERP4\vehicle-master-audit'
$env:GOOGLE_CLOUD_PROJECT = 'southern-range-505903-b2'
Set-Location -LiteralPath $repoPath
& (Join-Path $repoPath 'node_modules\.bin\tsx.cmd') (Join-Path $repoPath 'scripts\monitor-vehicle-master-integrity.mts')
$auditExitCode = $LASTEXITCODE

# AI reviews are advisory only. They receive the privacy-minimized latest report,
# may read only the two monitor scripts, and cannot edit files or run commands.
$latestPath = Join-Path $auditPath 'LATEST.md'
if (Test-Path -LiteralPath $latestPath) {
  $latest = Get-Content -Raw -Encoding utf8 -LiteralPath $latestPath
  $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $reviewRoot = Join-Path $auditPath 'ai-reviews'
  New-Item -ItemType Directory -Path $reviewRoot -Force | Out-Null
  $common = @"
This is an independent, read-only review of the hourly vehicle-master integrity audit.
Do not seek or output personal data, vehicle plates, or raw rows. You may inspect only
scripts/monitor-vehicle-master-integrity.mts and scripts/run-vehicle-master-monitor.ps1.
Do not edit files, run commands, or transmit data. Review the privacy-minimized report
for false positives, missing checks, incorrect status decisions, and human follow-up priority.
Do not propose automatic fixes. Respond concisely in Korean.

$latest
"@

  $reviews = @(
    @{ Name = 'cursor'; Command = 'cursor-agent'; Args = @('--print', '--mode', 'plan', '--trust', '--workspace', $repoPath, "$common`nRole: review code-to-consumer links, exception handling, and regression risk.") },
    @{ Name = 'claude'; Command = 'claude'; Args = @('--print', '--permission-mode', 'plan', '--tools', 'Read', '--no-session-persistence', "$common`nRole: review manual-rule logic, counterexamples, and false completion claims.") },
    @{ Name = 'gemini'; Command = 'gemini'; Args = @('--prompt', "$common`nRole: review sheet structure, aggregate consistency, and missing-data patterns.", '--approval-mode', 'plan', '--skip-trust', '--output-format', 'text') }
  )

  foreach ($review in $reviews) {
    $reviewPath = Join-Path $reviewRoot "$runStamp-$($review.Name).md"
    try {
      & $review.Command @($review.Args) 2>&1 | Out-File -LiteralPath $reviewPath -Encoding utf8
      if ($LASTEXITCODE -ne 0) {
        "REVIEW_UNAVAILABLE: exit $LASTEXITCODE" | Out-File -LiteralPath $reviewPath -Encoding utf8
      }
    } catch {
      'REVIEW_UNAVAILABLE: execution or login failed' | Out-File -LiteralPath $reviewPath -Encoding utf8
    }
  }
}

# The deterministic audit remains the authoritative scheduler result.
exit $auditExitCode
