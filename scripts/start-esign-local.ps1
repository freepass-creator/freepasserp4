param(
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$baseUrl = 'http://127.0.0.1:4004'
$esignUrl = "$baseUrl/esign"
$logDir = Join-Path $repoRoot 'tmp'
$outLog = Join-Path $logDir 'esign-local.out.log'
$errLog = Join-Path $logDir 'esign-local.err.log'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Test-EsignServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $esignUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-EsignServer)) {
  $npm = 'C:\Program Files\nodejs\npm.cmd'
  if (-not (Test-Path -LiteralPath $npm)) {
    throw "Node.js 실행 파일을 찾지 못했습니다: $npm"
  }

  Start-Process `
    -FilePath $npm `
    -ArgumentList 'run', 'dev' `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden | Out-Null

  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 500
    if (Test-EsignServer) { break }
  } while ((Get-Date) -lt $deadline)

  if (-not (Test-EsignServer)) {
    $lastError = if (Test-Path -LiteralPath $errLog) {
      (Get-Content -LiteralPath $errLog -Tail 20) -join [Environment]::NewLine
    } else { '오류 로그 없음' }
    throw "전자계약 로컬 서버가 45초 안에 시작되지 않았습니다.`n$lastError"
  }
}

# 직원이 누를 경로를 한 번씩 호출해 Next 개발서버의 최초 컴파일 지연을 미리 끝낸다.
@('/login', '/esign/sample-contract', '/esign/preview/PREWARM') | ForEach-Object {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl$_" -TimeoutSec 30 | Out-Null
  } catch {
    Write-Warning "미리 준비하지 못한 화면: $_"
  }
}

Write-Host "전자계약 서버 준비 완료: $esignUrl"
if (-not $NoOpen) {
  Start-Process $esignUrl
}
