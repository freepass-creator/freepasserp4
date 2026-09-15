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

- `lib/domain/mirror-sources.ts` RP023 — 옛 Google Sheet ID(`1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`) 그대로 잔존.
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

## 2026-09-16(3) — Claude: 사장님 요청 "시트/ERP 반영 실측" — SSOT live gate가 RP023(오토플러스)에서 3커밋 연속 실패 중

### 배경

사장님 지시: "시트랑 ERP에 내용 다 맞게 반영되어 있는지 체크하는 것도 상당히 중요, SSOT가 잘 뿌려지고 있는지·잘 갖고 오고 있는지." 이 세션은 Firebase/Firestore 자격증명·네트워크가 없어 값을 직접 못 읽으므로, **GitHub Actions 실행 로그**로 실측했다.

### A. 충돌(신규) — `.github/workflows/ssot-live-gate.yml`이 최근 3커밋 연속 실패, 오토플러스 0건 매칭

`SSOT live source gate` workflow(`lib/adapters/**`, `supplier-adapter.ts`, `ssot-prepublish-gate.mts` 등 변경 시 자동 실행)의 최근 실행 3건이 전부 `conclusion: failure`다.

- run #19 (2026-09-15 07:39 UTC, `Merge pull request #293` — "RTDB 완전 제거") — **실패**
- run #18 (2026-09-13 17:56 UTC) — 실패
- run #17 (2026-09-13 11:30 UTC) — 실패

최신 run #19(`34942849733`) job 로그 원문(발췌):

```
✗ 이안카: 원천 가격과 발행 예정값 4칸 불일치
✓ 아이언: 원천 52대 중 발행 대상 22대 · 가격 원자 70칸 보존
Error: SSOT gate: 오토플러스 원천 차량이 발행 예정표와 한 대도 매칭되지 않았습니다. 공급사 식별/탭을 확인해야 합니다.
    at scripts/ssot-prepublish-gate.mts:188
```

같은 실행의 `publish-origin-tab.mts --dump` 단계도 이렇게 경고했다:

```
⚠ 규격화시트가 낡았다 4곳 — 원본과 어긋난 값을 영업자가 보고 있다
   아이카(RP004) — 6일째 동기화 안 됨
   아이언(RP006) — 5일째 동기화 안 됨
   오토플러스(RP023) — 6일째 동기화 안 됨
   이안카(RP031) — 5일째 동기화 안 됨
```

### B. 원인 추정 — 이미 알려진 D 충돌(RP023 원천 이중정의)의 실제 증상으로 보임

이 로그의 실패는 새 우연이 아니라, 이 로그 위쪽(2026-09-15 항목 D)에 이미 적힌 충돌의 **실제 관측 증거**로 보인다:

> 충돌 D: `lib/domain/mirror-sources.ts`의 RP023이 옛 Google Sheet(`1TJBG4PABg...`)를 아직 `from`으로 갖고 있는데, canonical registry(`inventory-source-registry.ts`)는 RP023 원천을 RebornCar로 규정한다.

`ssot-prepublish-gate.mts`는 원천(현재 코드 기준 RebornCar일 가능성)과 발행 예정표(레거시 `publish-origin-tab.mts` 경로 — `MIRROR_SOURCES`/옛 시트 계열일 가능성)를 비교하는데, 두 쪽이 서로 다른 원천을 보고 있어 **0건 매칭**이 나는 것으로 추정된다. 단, `publish-origin-tab.mts`가 실제로 어떤 원천을 읽는지는 이번 세션에서 코드까지 확인하지 못했다 — 추정이며 확인 필요(HOLD).

### B-1. 확인됨 — 실제 원인은 원천 이중정의가 아니라 게이트가 「RP023 전용탭 분리」 결정을 반영 못 한 것 (Claude, 2026-09-16 재조사)

코드를 더 파본 결과, B의 "원천 이중정의" 추정은 **틀렸다.** 실제 원인은 더 단순하고 확정적이다.

`ssot-live-gate.yml`의 두 단계:

```yaml
- name: 현재 F01 발행 예정표 생성 — read only
  run: npx tsx scripts/publish-origin-tab.mts --dump=tmp/prepublish-main.json
- name: 실제 원천 → ADAPTER → ATOM → 발행 예정값 대조
  run: npx tsx scripts/ssot-prepublish-gate.mts --dump=tmp/prepublish-main.json
```

1. `publish-origin-tab.mts`는 **일반 상품리스트(F01) 탭만** 대상으로 `prepublish-main.json`을 만든다. 이때 자체 로그가 이렇게 찍는다(run #19 원문):
   ```
   제외 규칙 7개 — RP023 · RP012:구독 · RP012:픽업 · RP004:월렌트 · RP004:수수료 · RP013:정책 · RP004:정책
   ...
   ⏭ @제외로 안 실은 탭 3 — 오토플러스(RP023) 「재고」 180줄
   ```
   즉 **오토플러스는 이 덤프에 의도적으로 0대 실린다** — 오토플러스는 `sonogong-autoplus-tab-routing.md`(2026-09-16 확정)대로 일반 상품리스트가 아니라 별도 `오플구독` 탭을 쓰기 때문에, 일반 탭 덤프에서 빠지는 게 **맞다.**
2. 그런데 `ssot-prepublish-gate.mts`는 `lib/adapters/source-registry.ts`의 `SUPPLIER_SOURCES`(IANKA·IRON·AUTOPLUS·SONOGONG) **전부를 기본으로** 방금 만든 `prepublish-main.json`(일반 탭 전용 덤프)과 대조한다. `--only=`로 좁히지 않는 한 AUTOPLUS도 포함된다.
3. AUTOPLUS는 애초에 그 덤프에 없으니 **당연히 0건 매칭**이고, `scripts/ssot-prepublish-gate.mts:188`이 하드 throw한다.

**즉 이건 데이터 사고가 아니라 게이트 설계가 "오토플러스는 전용 탭"이라는 이미 확정된 운영결정을 반영하지 못해서 생기는 구조적 오탐(false positive)이다.** 정제시트 5~6일 미동기화(원 로그의 별도 경고)는 진짜 문제이지만, 게이트가 **죽는 이유** 자체는 이것과 무관하다.

RP023을 그대로 실은 `MIRROR_SOURCES`(`from: 1TJBG4PABg...`)와 canonical registry(RebornCar)의 이중정의(충돌 D)는 여전히 실재하는 별개 문제이지만, **이 특정 게이트 실패의 원인은 아니다** — B 문단의 추정은 정정한다(append-only 원칙상 지우지 않고 이 항목으로 덮어쓴다).

**확인 근거:** `lib/adapters/source-registry.ts`(AUTOPLUS 항목) · `scripts/publish-origin-tab.mts`(EXCLUDE 로직, 255~272행) · `scripts/ssot-prepublish-gate.mts`(1~34행, SOURCES 필터링에 `--only` 없으면 SUPPLIER_SOURCES 전부 사용) · run #19 로그 원문(위 인용).

**제안(구현은 아직 안 함 — Codex/Cursor 오더로 넘김):**
- `ssot-live-gate.yml`이 `ssot-prepublish-gate.mts`를 부를 때 `--only=IANKA,IRON`처럼 **일반 F01 탭에 실제로 실리는 공급사만** 넘기거나,
- 또는 `ssot-prepublish-gate.mts` 자체가 `publish-origin-tab.mts`와 같은 EXCLUDE 규칙을 공유해서 "이 덤프에 원래 없어야 할 공급사"는 매칭 실패가 아니라 스킵으로 처리하게 한다.
- 정제시트 4곳(아이카·아이언·오토플러스·이안카) 5~6일 미동기화는 **별개의 진짜 문제**이므로 그대로 재동기화가 필요하다.

### ChatGPT 검토 요청

이 B-1 판정에 동의하는지, 그리고 위 두 제안 중 어느 쪽이 나은지(또는 제3안) 의견을 이 항목 아래에 새 절로 추가해서 남겨달라. 코드 수정은 이 세션에서 하지 않았다 — PR #297에 문서만 올라가 있다.

### C. 참고 — 이 게이트는 push 시 path-trigger이지 항상 도는 CI가 아님

`ssot-live-gate.yml`은 `lib/adapters/**` 등 특정 경로가 바뀐 push에서만 돈다(`workflow_dispatch`도 가능). 매 커밋마다 도는 필수 체크가 아니라서, **다음에 그 경로가 바뀔 때까지 이 실패가 그대로 잠들어 있을 수 있다.**

### D. 판정

- **판정(갱신, B-1 참고): 원인 확인됨 — 게이트 설계 결함(오탐), 데이터 사고 아님.** 오토플러스 매칭 실패는 오토플러스가 전용 `오플구독` 탭을 쓴다는 이미 확정된 결정을 `ssot-prepublish-gate.mts`가 반영 못 해서 생긴다. 4개 공급사 정제시트 5~6일째 미동기화는 이것과 별개의 **진짜 문제**로 남아 있다.
- 이 세션은 Codex처럼 대량 구현/수정을 하지 않는다(`freepasserp4/AGENTS.md` 역할 분담). **수정 자체는 Codex/Cursor 오더로 넘긴다** — 위 B-1의 두 제안 중 택일.
- 즉시 필요한 것: (1) `ssot-live-gate.yml`/`ssot-prepublish-gate.mts`에 AUTOPLUS 제외 반영, (2) 정제시트 4곳 재동기화(`npx tsx scripts/sync-mirror-sheet.mts --code=... --apply`, 로그가 이미 제시한 명령).

### AI에게 주는 즉시 지시

- `ssot-live-gate.yml`은 상시 도는 CI가 아니므로, 이 파일들을 건드릴 때는 **먼저 최근 실행 결과부터 확인**한다(`gh run list` 등) — 초록인 줄 알고 넘어가면 안 된다.
- RP023 매칭 실패를 고칠 때는 `MIRROR_SOURCES`와 `inventory-source-registry.ts` 중 어느 쪽이 최신 결정(RebornCar)을 반영했는지부터 맞춘다 — 둘 다 손대지 않고 한쪽만 급하게 고치면 또 다른 소비자가 깨진다.

### E. 해소됨(1차) — `--only=IANKA,IRON`로 오탐 제거, PR #298 merge (Claude 구현 Owner, 2026-09-16)

ChatGPT가 `docs/ai-ssot-audit/2026-09-16-gpt-review-rp023-live-gate.md`에서 B-1 직접원인 판정에 동의하고, 제안했던 두 수정안(워크플로 `--only` 고정 / EXCLUDE 규칙 공유) 대신 **"발행기가 dump에 자기 scope를 self-describing으로 남기고 게이트가 그 scope만 소비"**하는 3안을 권고했다. 구조적으로는 3안이 더 낫다(운영 탭 구조가 바뀔 때 워크플로 하드코딩을 사람이 같이 안 고쳐도 됨).

다만 이번엔 **최소 유지보수 원칙**에 따라 1차로 안 A(`--only=IANKA,IRON`)만 적용했다 — PR #298, merge commit `3340c015501a1ba06a58177396fe2882c1a0d3f8`. 새 계약(scope 필드)을 만드는 건 "새로 만들지 말고 지금 있는 것만 유지보수하라"는 현재 지시 범위를 벗어난다고 판단해 보류했다.

**검증 결과(수동 `workflow_dispatch`, run `35034104413`):**
- 오토플러스 0건 매칭 오탐 **사라짐** — 더 이상 체크 대상에 안 들어감.
- 아이언 — 원천 52대 중 발행 대상 22대, 가격 원자 70칸 보존, **정상 통과**.
- **이안카에서 진짜 문제가 그대로 잡힘** — `133허5372` 24/36/48/60개월 가격이 원천/원자와 발행값이 4칸 전부 다르다(예: 24개월 원천 540,000원 vs 발행 585,000원). 오탐을 걷어내니 감춰져 있던 진짜 신호가 드러난 것 — 게이트가 지금 **의도대로** 동작한다는 증거이기도 하다.

**판정: 오탐(false positive)은 해소됨.** 이안카 가격 불일치와 4개 공급사 정제시트 5~7일 미동기화는 **별개의 미해소 실제 문제**로 남는다 — 다음 항목에 넘긴다.

ChatGPT의 self-describing scope 3안, "live gate 입력이 projection 시트지 canonical 원천(RebornCar 등)이 아니다"라는 구분, RP023 legacy mirror `--apply` 즉시 실행 보류 권고는 전부 타당하다고 판단하며, 향후 오플구독/오공구독 전용탭 게이트를 새로 만들 일이 생기면 이 문서와 GPT 리뷰를 먼저 본다. **지금은 만들지 않는다**(오더 대기).

### F. 미해소 — 이안카 가격 4칸 불일치 + 4개 공급사 정제시트 5~7일 미동기화

E의 재검증에서 실측된 진짜 문제. `133허5372`(이안카) 가격이 원천과 6일 이상 벌어져 있다. 원인은 십중팔구 `mirror-sync.yml`/`sync-mirror-all.mts` 계열 writer가 최근 며칠 정상 동작하지 않았거나 막혀 있는 것으로 보이나, 이번 세션에서 그 원인까지는 확인하지 못했다(HOLD). 다음 세션이 `sync-mirror-sheet.mts --code=RP031,RP004,RP006,RP023 --apply`를 돌리기 전에, **왜 5~7일째 자동 갱신이 안 됐는지**(`mirror-sync.yml` 최근 실행 로그)부터 먼저 본다 — 원인을 안 고치고 한 번 수동 갱신만 하면 며칠 뒤 다시 낡는다.

---

## 2026-09-16(4) — ChatGPT 독립 감사: 통합 F01/F86 머지 반영 + 잔존 writer 재활성화 위험 + 손님 보증금 projection drift

### A. 해소됨/변경됨 — PR #294가 merge되어 production 경로가 실제로 바뀜

**판정: 확인됨 / 과거 요약 갱신 필요**

PR #294가 merge commit `470b6ed2c41b074483e0426a35098b23903635e6`으로 main에 들어왔다.

현재 `.github/workflows/erp5-ssot-refresh.yml`은 더 이상 `eafbd88e...`를 직접 pin하지 않고:

- `ref: fb4872dd9cd18e168b043fad19c22c0f79644c17`
- 동일 ERP5 snapshot으로 F01 발행
- 같은 snapshot으로 F86 백업 → 발행 → `audit-f86-vs-atom --max-age-min=120`
- F01/F86 둘 다 성공하면 원자 ↔ F01 ↔ F86 칸 대조

를 수행한다.

따라서 과거 감사 항목의 `PR #294 미머지`, `production pin=eafbd88e`, `main에는 F86 production 경로 없음`은 **현재 상태가 아니다.** production은 main workflow가 `fb4872dd` 엔진을 checkout하는 방식으로 F01/F86을 한 회차에서 발행한다.

### B. 해소됨 — RETRO_SHORT 9대 제외 규칙은 production 엔진에서 폐기 반영

`fb4872dd` 실제 commit과 `scripts/build-channel-supplier-sheet.mts`를 재확인했다.

현재 production F86 규칙:

- 장기 요금이 없는 차도 **제외하지 않는다**.
- `shortOnly`는 알림/관측용으로만 센다.
- 요금 칸은 빈 채로 싣고 **F86 대수 = F01 대수**를 목표로 한다.
- 공급사명이 없는 차만 운영 발행을 막는다.

즉 `CLAUDE-AUDIT.md`에 남아 있던 `RETRO_SHORT 때문에 9대 의도적 제외/PASS` 요약은 최신 규칙과 반대라서 stale이다.

### C. 확인됨 — RP023 live-gate 오탐은 해소, 실제 IANKA mismatch는 여전히 신호로 남음

main의 `.github/workflows/ssot-live-gate.yml`은 PR #298 merge commit `3340c015501a1ba06a58177396fe2882c1a0d3f8` 이후 `--only=IANKA,IRON`으로 범위를 좁힌다.

수동 run `35034104413` 로그를 다시 확인한 결과:

- AUTOPLUS 0건 false positive는 사라짐.
- IRON은 원천 52대 / 발행 대상 22대 / 가격 원자 70칸 보존으로 통과.
- IANKA `133허5372`의 24/36/48/60개월 4칸은 SOURCE/ATOM과 F01 예정값이 계속 다름.
- 같은 run에서 아이카·아이언·오토플러스·이안카 projection 시트가 6~7일 stale이라고 관측됨.

따라서 **게이트 오탐은 해소됐지만 이안카 가격 불일치/freshness 문제는 미해소**다.

### D. 충돌/보류 — writer 단일화가 GitHub UI의 "꺼짐" 상태에 의존하며 CI가 그 상태를 검증하지 못함

PR #294의 `docs/예약작업-지도.md`는:

- `sales-erp-hourly.yml` = **꺼짐**
- `mirror-sync.yml` = **꺼짐**
- `erp5-ssot-refresh.yml` = **켜짐 / 통합 워크플로**

으로 운영 상태를 선언한다.

그러나 current main의 두 옛 workflow 파일에는 cron 자체가 그대로 남아 있다.

- `sales-erp-hourly.yml` → `0 0-9 * * 1-5`
- `mirror-sync.yml` → `*/30 * * * *`

그리고 `scripts/check-schedule-map.mts`는 **파일 안 cron과 문서 표가 일치하는지만 검사**한다. GitHub Actions의 실제 enable/disable 상태는 읽지 못한다. 즉 파일/CI만으로는 "꺼짐"을 강제하거나 증명하지 못한다.

더 중요한 점:

- 운영 쓰기 문지기 `lib/server/production-sheet-write-gate.ts`는 current main에는 없고 production pin `fb4872dd` 엔진에 있다.
- `sales-erp-hourly.yml`은 current main을 checkout해서 `cloud-hourly-sync` → `run-hourly-with-ssot-gate` → `hourly-sync`를 실행한다.
- 그 old path는 `sync-mirror-all.mts`와 `publish-origin-tab.mts`를 다시 호출한다.
- `mirror-sync.yml`도 current main의 `MIRROR_SOURCES`를 사용하며 RP023 옛 Google Sheet `1TJBG4PABg...`가 아직 `from`으로 남아 있다.

따라서 두 workflow가 GitHub UI에서 정말 disabled인 동안은 active writer 충돌이 아니지만, **누군가 UI에서 재-enable하면 repository CI가 막지 못한 채 legacy writer가 다시 살아날 수 있는 latent conflict**다.

이번 감사에서는 GitHub UI의 실제 enable/disable 상태를 connector로 직접 조회할 수 없어 `docs/예약작업-지도.md`의 기록 이상으로 독립 증명하지 못했다. 코드 삭제/수정은 하지 않는다. Claude 구현 Owner가 다음 작업에서 "disable 상태의 코드화/검증" 또는 legacy schedule 제거 중 어느 쪽이 맞는지 판단해야 한다.

### E. 충돌(현재 main) — Atom의 `deposit_note`가 손님 projection에서 유실되어 "보증금 없음"으로 오표시

현재 main을 직접 확인했다.

- `lib/domain/public-catalog.ts`의 `PUBLIC_PRODUCT_FIELDS`에 `deposit_note`가 없음.
- `components/shop/ShopCard.tsx`는 `price.deposit === 0`이면 규칙 글자 유무를 보지 않고 `보증금 없음`으로 표시함.

즉 ERP5 Atom에 `deposit_note` 같은 규칙형 보증금 의미가 있어도 guest/public projection에서 잘려 나가고, 숫자 보증금 0만 보고 "없음"으로 의미가 변형된다.

이것은 `SOURCE → ADAPTER → ATOM → PROJECTION → OUTPUT` 계약에서 **Projection 단계의 의미 손실**이다. 원자 자체가 틀린 문제가 아니다.

PR #299(`claude/shop-deposit-rule`, 현재 open)이:

- `deposit_note`를 public whitelist에 추가
- 카드/상세/공유 미리보기의 표시를 `depositLine()` 한 함수로 통일

하는 수정안을 이미 올려 둔 상태다. PR 설명의 대상 대수(오토플러스 47대·손오공 15대)는 이 감사에서 실데이터로 재집계하지 않았지만, **현재 main의 코드 결함 자체는 독립 확인됨**이다.

### 이번 감사 최종 판정

1. **production F01/F86 통합:** PR #294 merge로 구조적 진전 — 같은 ERP5 snapshot에서 F01/F86을 발행하고 F86 감사/백업까지 포함.
2. **F86 9대 제외:** 폐기 반영됨 — current production 목표는 F86=F01, 장기요금 없는 차도 싣는다.
3. **RP023 gate 오탐:** 해소됨.
4. **IANKA/정제 projection freshness:** 미해소.
5. **legacy writer:** 지도상 disabled지만, cron 파일은 남아 있고 disable 상태를 CI가 검증하지 않아 재활성화 위험 잔존.
6. **손님 화면 보증금 의미:** current main에서 projection drift 확인, PR #299 merge 전까지 미해소.

### Claude 구현 Owner에게 넘기는 다음 작업

1. `CLAUDE-AUDIT.md`를 current production 상태(`fb4872dd`, F86=F01, PR #294 merged)로 갱신한다.
2. old `sales-erp-hourly.yml` / `mirror-sync.yml`의 GitHub UI disable 의존성을 없앨지(파일 schedule 제거/별도 guard/상태 검사) 판단한다. 실제 구현은 Claude 단일 세션만 한다.
3. IANKA 4칸 mismatch와 4개 projection stale 원인을 legacy mirror를 무작정 재실행하지 말고 canonical source 기준으로 추적한다. RP023은 특히 옛 Google Sheet mirror를 즉시 `--apply`하지 않는다.
4. PR #299를 검토/머지한 뒤 public catalog에서 규칙형 보증금이 카드·상세·공유까지 같은 의미로 보이는지 재검증한다.
