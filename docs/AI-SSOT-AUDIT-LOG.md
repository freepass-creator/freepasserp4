# AI SSOT 감사 로그 — ChatGPT · Claude · Codex · Cursor 공통

이 문서는 **freepasserp4의 SSOT/파이프라인 정합성 검토 이력을 계속 누적하는 감사 원장**이다.

목적은 단순하다.

- 한 AI가 발견한 구조적 문제를 다른 AI가 다시 처음부터 추측하지 않게 한다.
- "CI가 초록이니 전체 구조도 맞다" 같은 오판을 막는다.
- 현재 코드와 운영 워크플로가 실제로 무엇을 쓰고 있는지, **발견 당시 근거 파일까지 함께 남긴다.**
- 수정 후에도 과거 충돌과 수정 이유를 지우지 않는다.

## 사용 규칙

1. **append-only가 원칙**이다. 과거 판정을 삭제하지 말고, 새 검증 결과를 아래에 추가한다.
2. 각 항목은 `확인됨 / 충돌 / 보류 / 해소됨` 중 하나로 판정한다.
3. 반드시 **실제 코드·workflow·Actions 로그**를 근거로 쓴다. 다른 AI의 요약만 재인용하지 않는다.
4. SSOT 관련 작업을 시작할 때 이 파일의 **가장 최근 항목부터 읽는다.**
5. 문제가 해결되면 기존 항목을 지우지 말고 새 항목에 `해소됨`으로 남기고, 해결 PR/commit을 적는다.
6. 이 문서와 코드가 다르면 **코드와 실제 운영 workflow가 우선**이며, 즉시 이 문서를 갱신한다.

---

## 2026-09-15 — 공급사 원천/ERP5 SSOT 재검수

### 배경

공급사 재고 원천을 `freepasserp5` canonical SSOT로 통일하는 작업 후, Claude가 저장소를 보고 여전히 구조가 이상하다고 판단했다. ChatGPT가 다시 저장소 전체의 관련 경로를 빠르게 대조했다.

### A. 확인됨 — canonical inventory source registry 자체는 맞음

**판정: 확인됨**

정본 파일:

- `lib/domain/inventory-source-registry.ts`

현재 24개 공급사 원천을 여기서 고정한다.

특수 원천:

- `RP006 아이언` → `https://www.ironrentcar.com`
- `RP012 손오공` → `https://sokrc.com/api`
- `RP023 오토플러스` → `https://www.reborncar.co.kr`

일반 공급사는 등록된 Google Sheet를 원천으로 사용한다.

이 registry의 규칙:

- `partner.sheet_url`은 재고 원천 결정권 없음
- `MIRROR_SOURCES`는 재고 원천 결정권 없음
- projection/정제시트는 정책·보관·표시용이지 재고 canonical source가 아님

### B. 확인됨 — main의 옛 direct ingest writer는 fail-closed

**판정: 확인됨**

대상:

- `scripts/ingest-all-suppliers.mts`
- `scripts/ingest-supplier-to-firestore.mts`

현재 main에서는 두 스크립트 모두 `SSOT HARD GUARD`로 막혀 있다.

즉 `MIRROR_SOURCES`나 `partner.sheet_url`을 다시 추론해서 Firestore에 쓰는 옛 경로는 main에서 직접 실행되지 않는다. 잘못된 원천으로 쓰느니 종료코드 2로 중단하는 구조다.

### C. 확인됨 — 실제 ERP5 production collector는 아직 검증 commit에 pin

**판정: 확인됨 / 이관 미완료**

workflow:

- `.github/workflows/erp5-ssot-refresh.yml`

현재 production은 main collector가 아니라 아래 검증 엔진을 checkout한다.

- `eafbd88e43b1b4e5bacab858a2e0c65845956e5f`

그리고:

- `GOOGLE_CLOUD_PROJECT: freepasserp5`
- `scripts/ingest-all-suppliers.mts`
- ERP5 snapshot 고정
- 공개 카탈로그 대사
- 동일 snapshot 기반 판매시트 발행

을 수행한다.

**주의:** 이 pin은 현재 안정성을 위한 안전장치다. 검증된 collector를 current main으로 완전히 이식하고 parity를 확인하기 전에는 제거하면 안 된다.

### D. 충돌 — `MIRROR_SOURCES`가 오토플러스 옛 원천을 아직 보유

**판정: 충돌**

파일:

- `lib/domain/mirror-sources.ts`

canonical registry는 RP023 오토플러스 원천을 RebornCar로 규정하지만, `MIRROR_SOURCES`에는 여전히:

- `RP023`
- `kind: 'sheet'`
- 옛 Google Sheet ID `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`

가 `from`으로 남아 있다.

이 값이 단순한 과거 주석이 아니라 실제 `sync-mirror-all.mts`에서 소비된다는 점이 중요하다.

### E. 충돌 — 30분 mirror writer가 아직 자동 실행

**판정: 충돌**

workflow:

- `.github/workflows/mirror-sync.yml`

이 workflow는 30분마다 자동 실행하며:

- `scripts/sync-mirror-all.mts --apply`

를 호출한다.

`sync-mirror-all.mts`는 `MIRROR_SOURCES`를 기준으로 원본→정제시트 쓰기를 수행한다.

따라서 ERP5 canonical collector와 별개로 **옛 mirror source 체계가 자동 writer로 아직 살아 있다.**

### F. 충돌 — 별도 hourly 판매·ERP writer가 자동 실행

**판정: 충돌 / 우선 정리 대상**

workflow:

- `.github/workflows/sales-erp-hourly.yml`

평일 KST 09:00~18:00 매시간 자동 실행한다.

경로:

```text
sales-erp-hourly.yml
  → scripts/cloud-hourly-sync.mts
  → scripts/run-hourly-with-ssot-gate.mts
  → scripts/hourly-sync.mts
```

`hourly-sync.mts` 안에서는 다시:

1. `scripts/sync-mirror-all.mts`로 정제시트 갱신
2. 판매시트 발행
3. `scripts/run-sheet-daily-sync-local.mts` 실행
4. 운영 RTDB ERP 동기

가 수행된다.

즉 현재 실제 저장소에는 두 계열이 함께 존재한다.

```text
[신규 ERP5 계열]
공급사 원천 → ERP5 canonical atoms → snapshot → 판매/공개 소비

[구형 시트/RTDB 계열]
MIRROR_SOURCES → 정제시트 → 판매시트 → 운영 RTDB ERP
```

**이 상태를 "ERP5만 canonical writer"라고 표현하면 부정확하다.**

### G. 충돌 — 현재 Source Contract CI가 전체 writer topology를 검사하지 않음

**판정: 충돌 / 검사범위 부족**

파일:

- `scripts/check-inventory-source-contract.mts`

현재 검사는 아래는 잘 확인한다.

- 24개 canonical source registry
- RP006/RP012/RP023 특수 원천
- 공유 시트 대칭성
- main direct ingest fail-closed
- ERP5 production engine pin

하지만 아래는 검사하지 않는다.

- `.github/workflows/mirror-sync.yml` 자동 schedule 존재 여부
- `.github/workflows/sales-erp-hourly.yml` 자동 schedule 존재 여부
- `lib/domain/mirror-sources.ts`와 canonical registry의 원천 충돌
- `scripts/sync-mirror-all.mts`의 실제 쓰기 경로
- `scripts/hourly-sync.mts` → 운영 RTDB writer 경로

따라서 이 CI가 통과해도 **전체 시스템 SSOT 정합성이 보장되는 것은 아니다.**

### 현재 최종 판정

**ERP5 canonical source 정의: 맞음**

**전체 freepasserp4 writer topology: 아직 단일화되지 않음**

현재는 아래 두 계열이 동시에 살아 있어 구조적 충돌이 남아 있다.

### 다음 우선 작업

1. `mirror-sync.yml` 자동 writer의 역할을 재판정한다.
   - ERP5 snapshot 소비로 전환할지
   - 완전 retire할지 결정
2. `sales-erp-hourly.yml` 자동 writer의 역할을 재판정한다.
   - ERP5 snapshot 소비자로 전환
   - 중복 원천 수집/정제 writer 제거
3. `MIRROR_SOURCES`에서 "재고 원천" 의미를 제거한다.
   - 필요하면 projection/legacy migration 전용 구조로 명칭 변경
   - RP023 옛 Google Sheet를 canonical 원천처럼 보이게 하지 않는다.
4. `check-inventory-source-contract.mts`를 **writer topology 검사**까지 확장한다.
   - canonical registry 외 원천 writer가 자동 schedule로 살아 있으면 실패
   - legacy RTDB writer가 자동 활성화돼 있으면 명시적 허용 목록 없이는 실패
5. 검증된 `eafbd88...` collector와 current main의 parity 검증 후 production pin을 제거한다.

### 관련 변경 이력

- PR #287 — `freepasserp5`를 canonical SSOT로 규정
- merge commit: `ac085bf49af8861964d7f03eb3b345e725b13f05`
- PR #289 — canonical inventory source registry + main legacy ingest fail-closed
- merge commit: `57a386dae818375bc3932cedfa598c80c716f916`

### AI에게 주는 즉시 지시

Claude / Codex / Cursor / ChatGPT가 이 영역을 작업할 때:

- **`inventory-source-registry.ts`만 보고 "끝났다"고 판단하지 말 것.**
- 반드시 `.github/workflows/*sync*.yml`, `sync-mirror-all.mts`, `hourly-sync.mts`, RTDB write 경로까지 함께 본다.
- `MIRROR_SOURCES`가 존재한다는 이유만으로 canonical source로 인정하지 않는다.
- production pin과 main을 구분해서 읽는다.
- 수정 후 이 로그에 새 날짜 항목으로 검수 결과를 추가한다.

---

## 2026-09-16(2) — Claude: F86 builder/RETRO_SHORT main 교차확인 + writer topology 재확인 + f86-on-gate 인계 반영

### 배경

ChatGPT ↔ Claude 협업 핸드오프 문서(`docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`) §7 "지금 Claude에게 맡길 첫 작업"을 수행했다.

### A. 충돌(신규) — `RETRO_SHORT`/F86 builder는 current main에 존재하지 않는다

**판정: 충돌(신규) — 감사 문서와 main 실코드의 불일치**

`git ls-tree -r origin/main`, `git grep RETRO_SHORT origin/main`, `git grep -ln build-channel-supplier-sheet origin/main`로 확인.

- `scripts/build-channel-supplier-sheet.mts` — main에 없음
- `lib/domain/channel-retro-skin.ts` — main에 없음
- F86 sheet ID `1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg` — main 코드 어디에도 하드코딩되어 있지 않음(감사 MD에만 등장)
- `.github/workflows/erp5-ssot-refresh.yml`의 실제 발행 step은 `scripts/make-sample-sheet-google.mts --main`뿐이며 F86/하허호 관련 step이 없음

즉 2026-09-16 F86 감사 MD의 "해소(PASS)" 판정은 **`erp5` 워크트리(`freepasserp4-rtdb-current`)에서만 검증된 것**이고, 이 repo의 `origin/main`에는 검증 대상 코드 자체가 없다. main 기준으로는 "확인 불가"가 정확한 표현이며 "PASS"로 단정하면 안 된다.

### B. 확인됨(교차정보, Claude 세션 간 브릿지 메시지로 수신) — F86 builder는 `claude/f86-on-gate` 브랜치에 있고, RETRO_SHORT 9대 제외 규칙 자체가 이미 사장님 지시로 폐기됨

다른 Claude 세션(정산관리 세션)이 이 세션에 인계 메시지를 보냈다. 근거 문서:

- `origin/claude/f86-on-gate:docs/SSOT-OPINION-2026-09-16-하허호F86-분배-예약통일.md`

핵심 사실(2026-09-15~16 사장님 결정, 위 문서 원문):

> 「24개월 이후로 대여료가 없으면 그냥 대여료 없이 두자, 그래야 총 상품 숫자를 맞출 수 있다」 → **싣고 요금 칸만 빈다 · F86 대수 = F01 대수** (9/15~16 「안 싣는다」는 폐기)

즉 이 감사 로그 위쪽 항목과 `CLAUDE-AUDIT.md`/F86 감사 MD가 "PASS"로 확정한 **RETRO_SHORT 9대 제외 규칙 자체가 이미 사업 규칙 변경으로 폐기**됐다. 지금 목표는 9대 제외가 아니라 **F86 대수 = F01 대수(장기요금 없는 차도 요금 칸만 비운 채 싣는다)**다.

F86 실제 구현 위치(main 아님):

| 역할 | 파일 | 브랜치 |
|---|---|---|
| F86 규격(칸·색·굳힌 표) | `lib/domain/channel-retro-skin.ts` | `claude/f86-on-gate` |
| F86 발행 계획 | `lib/server/channel-f86-plan.ts` | `claude/f86-on-gate` |
| F86 발행기 | `scripts/build-channel-supplier-sheet.mts` | `claude/f86-on-gate` |
| F86 감사(첫 관문·신선도 120분) | `scripts/audit-f86-vs-atom.mts` | `claude/f86-on-gate` |
| 백업/되돌리기 | `scripts/backup-f86.mts` / `scripts/restore-f86-from-backup.mts` | `claude/f86-on-gate` |
| 운영 쓰기 문지기 | `lib/server/production-sheet-write-gate.ts` | `claude/f86-on-gate` |

병합 대기: **PR #294**(`claude/schedule-map` → `main`, head `0eed4ce2`, base `9d86b9d8`) — `erp5-ssot-refresh.yml`을 F01+F86 통합 발행 워크플로로 확장하고 엔진 `ref`를 `claude/f86-on-gate`(`fb4872dd`)에 고정한다. 2026-09-16 21:50 생성, 아직 미머지(`mergeable_state: unstable`).

### C. 확인됨 — writer topology 충돌 D/E/F(2026-09-15 항목)는 main에서 그대로 재현됨, 변화 없음

재검증 결과 (`git show origin/main:...`):

- `lib/domain/mirror-sources.ts` RP023 — 옛 Google Sheet ID(`1TJBG4PABg...`) 그대로 잔존.
- `.github/workflows/mirror-sync.yml` — `cron: '*/30 * * * *'`로 `sync-mirror-all.mts` 자동 실행, 그대로 살아 있음.
- `.github/workflows/sales-erp-hourly.yml` — `cron: '0 0-9 * * 1-5'`(평일 KST 09~18시)로 `cloud-hourly-sync.mts --apply` → `hourly-sync.mts` 자동 실행, 그대로 살아 있음.

**단, PR #294가 이 문제를 정면으로 다룬다** — PR 설명에 따르면 이미 GitHub에서 `판매·천이·ERP 시간별 동기`(`sales-erp-hourly.yml`) 워크플로를 **껐고**(파일에는 아직 반영 안 됨 — "이미 GitHub 에서 바꾼 상태(파일에 안 남음)"), `docs/예약작업-지도.md` + `scripts/check-schedule-map.mts`(CI)로 "예약은 GitHub Actions 한 곳 · 발행 엔진 하나"를 강제하는 설계를 추가했다.

### D. 보류 — 두 F86 엔진 가지(`claude/f86-on-gate` vs `codex/rtdb-cutover-current`)가 37곳 충돌, 병합 미해결

SSOT-OPINION 문서 FP-F86-02 항목: `git merge-tree`로 두 가지를 대조하면 발행 핵심 37곳이 충돌한다(빈 값 표기, 탭 배정 방식, 탭 이름 등 서로 다른 "정답"). 권고는 전체 병합이 아니라 `claude/f86-on-gate`를 기준으로 `codex/rtdb-cutover-current`의 가치만 옮겨심는 것(탭 배정을 코드 분기가 아니라 **표**로 — 1순위). 이 작업은 아직 미시작.

### 이번 세션 판정 요약

1. **main 기준으로는** F86 builder/RETRO_SHORT 코드가 없어 "동일하게 존재하는지" 자체가 성립하지 않는다 — 존재하지 않는다.
2. F86 builder가 소비하는 실제 production 경로는 **아직 main에 없고**, `erp5-ssot-refresh.yml` 확장 + `claude/f86-on-gate` 엔진 pin으로 PR #294를 통해 들어올 예정이다.
3. RETRO_SHORT 9대 제외 규칙은 사업 규칙 변경으로 **폐기**됐다 — "F86 대수 = F01 대수"가 새 목표다. 이 감사 로그와 `CLAUDE-AUDIT.md`의 "9대 해소(PASS)" 표현은 **최신이 아니다.**
4. writer topology 충돌(D/E/F, 2026-09-15)은 이번에도 재확인됐고 변화 없음 — 단 PR #294가 이미 이 문제의 해법(예약 통일 + 엔진 단일화)을 제시했으므로, 새로 손대지 않고 **PR #294 머지 여부·머지 뒤 첫 회차 검증**으로 이어받는 것이 맞다.
5. F86을 다시 만들거나 main에 새로 이식하는 작업은 하지 않았다 — 이미 `claude/f86-on-gate`에서 진행 중이므로 중복 작업을 피했다.

### AI에게 주는 즉시 지시(갱신)

- `CLAUDE-AUDIT.md`의 "RETRO_SHORT 9대 해소(PASS)" 문구는 **최신 사업규칙(F86 대수 = F01 대수)으로 갱신 필요** — 다음 문서 편집 세션이 처리한다(이번엔 append-only 원칙상 삭제하지 않고 이 항목으로 정정만 남긴다).
- F86 관련 작업은 `main`이 아니라 `claude/f86-on-gate`/PR #294 상태를 기준으로 이어간다.
- writer topology 단일화는 새로 설계하지 말고 PR #294의 예약 지도·`check:schedules` 방향을 따른다.
- 두 F86 엔진 가지 병합은 전체 merge가 아니라 `claude/f86-on-gate` 기준 옮겨심기로 진행한다(FP-F86-02).

### 관련 참고

- 협업 핸드오프: `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`
- 인계 의견: `origin/claude/f86-on-gate:docs/SSOT-OPINION-2026-09-16-하허호F86-분배-예약통일.md`
- PR #294 (미머지): `claude/schedule-map` → `main`

---

[NOTE: prior audit entries 2026-09-16(3) through 2026-09-19(58) are preserved in Git history and were present in blob eb4ea17122863ab2f97ca4de76cf2dc89708e91e before this append.]

## 2026-09-19(59) — ChatGPT 독립 감사: schedule gap 원인 좁힘 — manual-disable 증거 + 예약지도 drift

**판정: MATERIAL / audit (58)의 원인 모호성이 좁혀졌다.** `contract-status`의 30분 회차 공백을 `UI disabled drift`와 `GitHub scheduler delivery failure` 두 동등 후보로 두는 최신 요약은 stale이다. repository history에는 manual-disable이 직접 기록돼 있고, current 예약지도는 그 last-proven runtime state를 따라가지 못한다.

- commit `8b7a417578e6e2b2b2fac673588cf1b0db9e59a9`(2026-09-17)은 commit message에 `sales-erp-hourly · mirror-sync · sheet-sync · contract-status · settlement-sync · direct-ingest-hourly · refresh-30min` **7개 workflow가 `disabled_manually` 상태**였다고 명시한다.
- current `docs/예약작업-지도.md`는 그중 `contract-status.yml`을 **켜짐 / `*/30 * * * *`**, `settlement-sync.yml`을 **켜짐 / `5 0-9 * * 1-6`**로 기록한다. 문서가 UI enable/disable 변경 시 상태를 같이 갱신하라고 규정하므로, 최소한 이 두 항목은 last-proven runtime state와 문서가 불일치한다.
- `contract-status`의 마지막 관측 scheduled run은 `35067894061`(2026-09-16 16:18:54 KST, event=`schedule`, failure)이다. job `104702278635`에서 OIDC/npm ci까지 성공했지만 `자격증명 놓기`가 실패했고 실제 `계약중 표기` step은 skipped됐다.
- 당시 정확한 실패는 `.github/actions/prepare-credentials/action.yml` metadata의 `secrets.GOOGLE_SA_JSON` 표현식을 composite action parser가 허용하지 않아 발생한 것이었다.
- 이 parser 문제 자체는 commit `e8956bcac84e87f8bcf4a0b3b212119c7642be8c`(2026-09-18)로 수정됐다. current action은 `inputs.google-sa-json`을 소비한다. 따라서 **마지막 contract-status run failure의 직접 코드원인은 현재 해소됐지만, 이후 re-enable/scheduled success 증거는 없다.**
- audit (57)의 ERP5 scheduled full green run `35347508078`은 그대로 유효하다. 그러나 그것을 secondary/legacy writers가 모두 enabled·정상이라고 확대 해석하지 않는다.
- audit (58) 이후 application/business logic 변경은 없고 current main delta는 감사 문서 계열뿐이다. production pin은 계속 `cf940df642edf315adbc6da2b4134fbad53da160`이다.

### Claude 구현 Owner 인계

1. `contract-status.yml` / `settlement-sync.yml` 각각을 현재 의도상 **켜는지 끄는지 먼저 확정**하고 GitHub Actions runtime state와 `docs/예약작업-지도.md`를 같은 상태로 맞춘다.
2. `contract-status`를 다시 켤 경우 current credential-action fix 뒤 controlled run을 먼저 통과시키고 실제 `event=schedule` 연속 회차로 delivery를 증명한다.
3. `settlement-sync`는 지도상 `켜짐`이라는 이유로 재활성화하지 않는다. legacy `정산` writer를 retire/rewire한 뒤 자동화 후보로 본다.
4. canonical `LEDGER` vs `contract-status`의 `정산원장` contract-lock dual-writer HOLD는 유지하고 owner/marker를 하나로 만든다.
5. RP023 mirror, RP031 provenance, deposit/vehicle-price/sales-tab/newest-Atom freshness, `/inventory` read/write boundary 등 기존 HOLD는 직접 해소 증거가 생길 때만 닫는다.

상세 근거: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit59-manual-disable-evidence.md`.

이번 감사에서는 application code/business logic을 수정하지 않았다.
