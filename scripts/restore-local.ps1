# 새로 클론한 뒤 로컬 작업환경을 되돌린다.
#
# git 에 없는 것이 둘 있다 — 둘 다 .gitignore 대상이라 clone 만으로는 안 돌아온다.
#   .env.local                  Vercel 프로덕션 env 또는 미러에서
#   tmp/firebase-auth/sa.json   감사·시트 스크립트 전부가 이걸 쓴다
#
# 2026-08-05 D 드라이브를 두 번 밀었다. 그때마다 이 둘을 손으로 찾느라 시간을 썼다.
# 사람이 기억해야 하는 절차는 언젠가 빠뜨린다 — 그래서 스크립트로 박는다.
#
#   powershell -ExecutionPolicy Bypass -File scripts\restore-local.ps1
#   ... -Mirror 'D:\백업\_PC미러\dev\freepasserp4'   미러 위치가 다르면

param(
  [string]$Mirror = 'G:\내 드라이브\_PC미러\dev\freepasserp4'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
Write-Host "복구 대상: $root`n"

# ── 1. 비밀값 ────────────────────────────────────────────────
$secrets = @(
  @{ Path = '.env.local';                From = 'Vercel env 또는 미러' },
  @{ Path = 'tmp\firebase-auth\sa.json'; From = 'Firebase 콘솔 새 비공개 키 또는 미러' }
)

foreach ($s in $secrets) {
  $dest = Join-Path $root $s.Path
  if (Test-Path $dest) { Write-Host "  이미 있음  $($s.Path)"; continue }
  $src = Join-Path $Mirror $s.Path
  if (Test-Path $src) {
    $dir = Split-Path $dest -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item $src $dest -Force
    Write-Host "  미러에서 복구  $($s.Path)"
  } else {
    Write-Host "  ❌ 없음  $($s.Path)   ← $($s.From)"
  }
}

# .env.local 이 없으면 Vercel 에서 받는 길을 알려준다. 33개 키가 프로덕션에 살아 있다.
if (-not (Test-Path (Join-Path $root '.env.local'))) {
  Write-Host "`n  .env.local 은 Vercel 에서도 받을 수 있다:"
  Write-Host "     npx vercel link --yes --project freepasserp4"
  Write-Host "     npx vercel env pull .env.local --environment=production"
}

# ── 2. 의존성 ────────────────────────────────────────────────
if (Test-Path (Join-Path $root 'node_modules\next')) {
  Write-Host "`n  이미 있음  node_modules"
} else {
  Write-Host "`n  npm install ..."
  & npm install --silent
  if ($LASTEXITCODE -ne 0) { Write-Host "  ❌ npm install 실패"; exit 1 }
  Write-Host "  설치 완료"
}

# ── 3. 확인 ──────────────────────────────────────────────────
Write-Host "`n── 확인 ──"
& npm run --silent typecheck
Write-Host "  타입 $(if ($LASTEXITCODE -eq 0) { '0 오류' } else { '오류 있음' })"

if (Test-Path (Join-Path $root 'tmp\firebase-auth\sa.json')) {
  Write-Host "`n  데이터 감사(채팅·계약·정산이 온전한가):"
  Write-Host "     npx tsx scripts/audit-v4-standalone-core.mts"
} else {
  Write-Host "`n  ⚠ sa.json 이 없어 감사·시트 스크립트는 못 돈다."
  Write-Host "     Firebase 콘솔 → freepasserp3 → 설정 → 서비스 계정 → 새 비공개 키 생성"
  Write-Host "     → tmp\firebase-auth\sa.json 으로 저장"
}

Write-Host "`n복구 끝. 개발 서버는 npm run dev (4004)`n"
exit 0
