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

**즉 이건 데이터 사고가 아니라 게이트 설계가 "오토플러스는 전용 `오플구독` 탭"이라는 이미 확정된 운영결정을 반영하지 못해서 생기는 구조적 오탐(false positive)이다.** 정제시트 5~6일 미동기화(원 로그의 별도 경고)는 진짜 문제이지만, 게이트가 **죽는 이유** 자체는 이것과 무관하다.

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
- `mirror-sync.yml`도 current main의 `MIRROR_SOURCES`를 사용하며 RP023 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`가 아직 `from`으로 남아 있다.

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

---

## 2026-09-16(5) — ChatGPT 독립 감사: production engine 재고정 + 보증금 projection 해소 + 예약지도 pin drift

### A. 변경됨 — production engine pin이 `d635f8c8...`로 다시 이동

**판정: 확인됨 / 진입점 갱신 필요**

현재 `origin/main` HEAD는 `81abd90df3bed9590c2bf498461af652488cc92e`(PR #304 merge)다.

현재 `.github/workflows/erp5-ssot-refresh.yml`의 실제 checkout pin은:

- `d635f8c87c3840a6956184b4d20f99dd968b6138`

이다. PR #303의 분류/구분 칩 색 단일출처 변경을 production 엔진 가지에 cherry-pick한 뒤 PR #304가 이 커밋으로 재고정했다. 같은 PR에서 `VALIDATED_ENGINES`에도 새 pin을 추가했다.

PR #304 head `f234b99eff7ae4712a13d300adcebabd33dbd286`에 대해 최근 Actions는:

- `SSOT Source Contract` run `35039651351` — success
- `CI` run `35039651361` — success

으로 확인했다. merge commit의 Vercel deployment도 success다.

다만 PR #304의 test plan에는 merge 뒤 `workflow_dispatch(apply=true)` 실제 발행 확인이 미체크로 남아 있으므로, **코드/CI pin 정합성 확인과 실제 운영 F01/F86 한 회차 발행 성공은 구분해서 본다.** 이번 감사에서는 새 pin으로 실제 운영 발행이 완료됐다고 단정하지 않는다.

### B. 확인됨 — 새 production pin에서도 F86 핵심 불변조건은 유지

`d635f8c8...`의 실제 파일을 대조했다.

- `scripts/build-channel-supplier-sheet.mts`는 같은 고정 snapshot → `buildF86Plan` 경로를 사용한다.
- 장기요금이 없는 `shortOnly` 차량도 **싣고 요금 칸만 빈 채**로 둔다(F01과 대수 일치 목표).
- 운영 F86 쓰기는 `production-sheet-write-gate.ts`를 통과해야 한다.
- gate 허용은 F86에 대해 `ERP5 SSOT 원천 최신화(매시간)` 한 워크플로뿐이다.
- 손오공/오토플러스는 별도 판매탭을 유지하고 공급사 고유 기간·주행거리·요금 구조를 보존한다.
- canonical source는 계속 RP012=ERP API, RP023=RebornCar다.

즉 이번 repin에서 **F86=F01 규칙, 특수 공급사 분리, canonical source 계약의 회귀는 확인되지 않았다.**

### C. 해소됨 — 손님 보증금 projection drift(PR #299)

이전 `(4)-E`의 미해소 판정은 현재 상태가 아니다.

PR #299가 merge commit `64ce8ec8e98697767048e15ba222ccc08a8c2a18`로 main에 들어왔다.

현재 main 코드:

- `lib/domain/public-catalog.ts`의 `PUBLIC_PRODUCT_FIELDS`에 `deposit_note`가 포함됨.
- `lib/format.ts`에 `depositLine(deposit, note, money)`가 존재하고, 금액 → 규칙 글자 → `보증금 없음` 순으로 의미를 보존함.

따라서 Atom의 규칙형 보증금 의미가 public projection에서 잘려 나가던 직접 원인은 **해소됨**으로 판정한다. PR #299 설명상 카드·상세·공유 미리보기도 같은 helper로 정렬했고 `tsc`, `check:ui`, `check:design`을 통과했다.

### D. 충돌(신규) — `docs/예약작업-지도.md`의 production pin 설명이 실제 workflow보다 뒤처짐

**판정: 문서/workflow drift — Claude 구현 Owner가 정리 필요**

현재 실제 workflow:

- `.github/workflows/erp5-ssot-refresh.yml` → `ref: d635f8c87c3840a6956184b4d20f99dd968b6138`

현재 `docs/예약작업-지도.md` 설명:

- `통합 워크플로 엔진 = 3a334ddf...`

즉 예약지도는 한 단계 전 production pin을 가리킨다. PR #304가 workflow와 검증 allowlist를 올렸지만 예약지도 설명은 같이 올라오지 않았다.

이 문서는 스스로 `예약/자동 writer 지도`를 운영 기준으로 선언하고, engine pin을 바꾸면 같은 흐름에서 지도를 맞추라고 규정한다. 따라서 단순 문구 오타가 아니라 **운영자가 어느 엔진이 production인지 잘못 판단할 수 있는 SSOT 문서 drift**다.

이번 감사자는 구현 Owner가 아니므로 `docs/예약작업-지도.md` 자체는 수정하지 않았다. Claude 단일 구현 세션이 실제 workflow의 `d635f8c8...`와 지도를 맞춰야 한다.

### E. 미해소 — IANKA 가격 4칸 mismatch + projection stale

수동 live-gate run `35034104413`의 실제 로그는 여전히 다음을 보여 준다.

- IANKA `133허5372`
  - 24개월: SOURCE/ATOM `540000` vs PUBLISH `585000`
  - 36개월: `525000` vs `569000`
  - 48개월: `510000` vs `553000`
  - 60개월: `495000` vs `537000`
- 같은 run에서 아이카·아이언·오토플러스·이안카 규격화/projection 시트가 6~7일 stale.

`2026-09-16(4)` 이후 current main의 변경은 보증금 표시, F86 engine pin/검증 allowlist, 분류색 단일출처, 수동 색 재도색 workflow 등이며 이 IANKA 가격 mismatch 자체를 해소한 변경은 확인되지 않았다.

따라서 **이 항목은 미해소 유지**다. RP023 stale을 이유로 legacy mirror의 옛 Google Sheet를 곧바로 `--apply`하지 않는다는 기존 지시도 유지한다.

### F. 미해소 — legacy writer 재활성화 위험

변화 없음.

- `sales-erp-hourly.yml`에는 `0 0-9 * * 1-5` cron이 남아 있음.
- `mirror-sync.yml`에는 `*/30 * * * *` cron이 남아 있음.
- 예약지도는 둘을 `꺼짐`으로 기록함.
- `MIRROR_SOURCES` RP023에는 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`가 여전히 `from`으로 남아 있음.
- production write gate는 현재 main이 아니라 pinned engine 쪽에 존재함.

이번 connector 범위에서는 GitHub Actions UI의 실제 enable/disable 상태를 독립 확인하지 못했으므로 active 충돌이라고 단정하지 않는다. 다만 UI 재활성화 시 legacy writer가 되살아날 **latent conflict** 판정은 그대로다.

### 이번 감사 최종 판정

1. **production pin:** `fb4872dd...` → `d635f8c8...`로 변경됨. current main HEAD는 `81abd90...`.
2. **F86/특수탭/canonical source 계약:** 새 pin에서 회귀 확인 안 됨.
3. **손님 보증금 projection drift:** PR #299 merge로 해소됨.
4. **예약지도:** 실제 pin `d635f8c8...`와 문서 `3a334ddf...`가 불일치 — 신규 문서 drift.
5. **IANKA 4칸 mismatch / stale projection:** 미해소.
6. **legacy writer 재활성화 위험:** 미해소.

### Claude 구현 Owner에게 넘기는 다음 작업

1. `CLAUDE-AUDIT.md`를 production pin `d635f8c8...`, PR #299 해소 상태로 갱신한다.
2. `docs/예약작업-지도.md`의 통합 엔진 설명을 실제 workflow pin `d635f8c8...`와 맞춘다.
3. 새 pin으로 실제 `erp5-ssot-refresh` 운영 회차가 F01/F86 발행·감사까지 성공했는지 Actions run으로 확인한다.
4. IANKA `133허5372` 4칸 mismatch와 projection stale 원인은 canonical source 기준으로 계속 추적한다.
5. old workflow UI disable 의존성/재활성화 위험은 별도 구현 판단으로 유지한다.

---

## 2026-09-16(6) — ChatGPT 독립 감사: `d635f8c8...` 실제 운영 발행 성공 + canonical/legacy 신호 분리

### A. 해소됨 — 새 production pin의 실제 `apply=true` 운영 발행이 끝까지 성공

**판정: 해소됨 / 운영 증거 확인**

이전 `(5)-A`에서 보류했던 "새 pin으로 실제 운영 F01/F86 한 회차 발행 성공 여부"가 확인됐다.

GitHub Actions run:

- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- run: `35039845907` (run #11)
- event: `workflow_dispatch`
- conclusion: `success`
- 실행된 checkout ref: `d635f8c87c3840a6956184b4d20f99dd968b6138`
- `apply=true`로 실행됨

실행 로그의 핵심 결과:

- 공급사 사전검사: **24/24 성공**
- 실제 ERP5 반영: **24/24 성공**
- 정책 참조 정합화: products 1,592 / policies 81 / changes 0 / dangling 0
- 고정 snapshot: `20260916003428110-083c958cb668`
  - 등록 1,592
  - 출고불가 857
  - 현재 재고 735
- 공개 카탈로그 대사: expected/actual **727대 동일**, hash 동일, missing/extra/policy/photo mismatch 전부 0
- F01 발행: **735대**
  - 상품리스트 381
  - 오공구독 54
  - 픽업구독 234
  - 오플구독 66
- F86 발행 전 백업 성공
- F86 발행: **735대 / 19개 탭 / 90열**
  - 장기요금 없는 9대도 규칙대로 싣고 요금 칸만 비움
- F86 ↔ 원자 감사: **46,675칸 대조 / 어긋남 0**, 가장 오래된 탭 1분(허용 120분)
- 원자 ↔ F01: 빠진 차 0 / 내려야 할 차 0 / 값 다른 칸 0 / 파생값 drift 0
- F01 ↔ F86: 빠진 차 0 / 추가 차 0 / 값 다른 칸 0
- 차량번호/사진 링크 감사: F01/F86 모두 어긋남 0
- snapshot artifact 보존 성공

따라서 `d635f8c8...`은 단순 CI/계약검사 통과 수준이 아니라 **실제 canonical source 수집 → ERP5 Atom → 고정 snapshot → public/F01/F86 발행 → 칸 단위 감사까지 한 운영 회차가 성공한 pin**으로 확인한다.

### B. 판정 정리 — IANKA 과거 4칸 mismatch는 현재 production F01 오류로 보지 않는다

이전 live-gate run `35034104413`은 IANKA `133허5372`의 24/36/48/60개월 가격이 `SOURCE/ATOM`과 당시 `publish-origin-tab` 발행 예정값 사이에서 달랐고, 4개 정제/projection 시트의 stale 상태도 잡았다.

하지만 이번 실제 production run `35039845907`은 **동일 canonical snapshot 기준 원자 ↔ F01 값 다른 칸 0**을 확인했다. 따라서 과거 IANKA 4칸 mismatch를 현재 production F01의 미해소 오류라고 계속 표현하는 것은 부정확하다.

정확한 현재 판정:

- **canonical production 경로(ERP5 Atom → snapshot → F01/F86): 정상 확인.**
- 과거 IANKA mismatch는 `publish-origin-tab`/legacy projection 계열에서 관측된 신호로 재분류한다.
- 아이카·아이언·오토플러스·이안카 정제/projection 시트가 실제로 지금도 stale인지는 이번 통합 production run이 그 legacy mirror를 갱신하지 않으므로 **별도 재검증 전까지 HOLD**다.
- 특히 RP023의 legacy mirror `from`은 여전히 옛 Google Sheet이므로, freshness 경고만 보고 무작정 `--apply`하지 않는 기존 지시는 유지한다.

### C. 충돌 유지 — 예약지도 pin drift + ACTIVE 인계문서의 오래된 상태

`docs/예약작업-지도.md`는 아직 통합 엔진을 `3a334ddf...`로 적고 있으나 실제 workflow는 `d635f8c8...`이다. `(5)-D`의 문서/workflow drift는 그대로다.

추가로 이번 감사에서 `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`를 다시 읽은 결과, 문서가 `ACTIVE` 상태이면서도 다음 오래된 사실을 그대로 적고 있다.

- production collector pin을 `eafbd88e...`로 설명
- F86의 9대 `RETRO_SHORT` 제외를 현재 검증 사실처럼 설명
- `mirror-sync`/`sales-erp-hourly`를 자동 writer 잔존으로 서술

최신 `CLAUDE-AUDIT.md`와 이 감사 로그가 이를 덮어쓰고 있어 실행 현실 판정에는 영향을 주지 않았지만, 이 문서는 "시작할 때 반드시 읽는 순서"에 포함되어 있어 **후속 AI가 오래된 결론을 다시 채택할 위험이 있는 문서 drift**다. 구현 Owner가 예약지도와 함께 현재 상태로 정리하는 편이 안전하다.

### D. 미해소 — legacy writer 재활성화 위험

current main 재확인 결과 변화 없음.

- `.github/workflows/sales-erp-hourly.yml` cron `0 0-9 * * 1-5` 잔존
- `.github/workflows/mirror-sync.yml` cron `*/30 * * * *` 잔존
- `lib/domain/mirror-sources.ts`의 RP023 `from`은 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`
- canonical registry의 RP023은 계속 RebornCar

예약지도에는 legacy workflow가 꺼짐으로 기록되어 있으므로 active 충돌이라고 단정하지 않는다. 다만 저장소 자체로 disable 상태를 강제하지 못하는 latent conflict 판정은 유지한다.

### 이번 감사 최종 판정

1. **새 pin 운영 검증:** 해소 — `d635f8c8...`으로 실제 apply=true 통합 발행/감사 성공.
2. **현재 canonical production F01/F86:** 735대 동일, 칸 단위 mismatch 0.
3. **IANKA 4칸 mismatch:** 현재 production 오류가 아니라 legacy projection/live-gate 신호로 재분류. legacy projection freshness 자체는 HOLD.
4. **예약지도 pin drift:** 미해소.
5. **ACTIVE 협업 handoff stale:** 신규 문서 drift로 확인.
6. **legacy writer 재활성화 위험:** 미해소.

### Claude 구현 Owner에게 넘기는 다음 작업

1. `docs/예약작업-지도.md`의 engine pin을 실제 `d635f8c8...`와 맞춘다.
2. `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`의 오래된 pin/F86 9대 제외/legacy 상태 설명을 현재 감사 결론과 맞춘다.
3. legacy projection 시트가 지금도 필요한 운영면이라면 `ssot-live-gate`를 다시 실행해 IANKA/4개 projection freshness의 **현재 상태만** 재확인한다. canonical production은 이미 별도로 PASS다.
4. old workflow UI disable 의존성/재활성화 위험은 코드화 또는 schedule 제거 중 하나로 구현 판단한다.

---

## 2026-09-16(7) — ChatGPT 독립 감사: production engine 계보 회귀 + F01 발행 회귀/HOLD + F86 표시계약 drift

### A. 충돌 후 긴급 수정 진행 — PR #308이 F01 발행을 실제로 깨뜨림

**판정: 회귀 확인 / 긴급 수정은 merge·repin됐으나 새 pin의 운영 PASS는 아직 HOLD**

실제 운영 run `35042070104`(run #12, head `c8c938bb0ff929ed291a89c7330ef21bf40879ce`)를 확인했다.

- 원천 계약 검사: success
- 공급사 재수집: success
- ERP5 원자 계산/반영: success
- 정책 참조 정합화: success
- snapshot 고정: success
- public catalog 대사: success
- **F01 발행(`동일 스냅샷으로 판매시트 게시`): failure**
- F86 백업: success
- F86 발행: success
- F86 ↔ 원자 첫 관문: success
- 원자 ↔ F01 ↔ F86 대조: F01 실패로 skipped
- 차번 셀 사진 링크 대조: failure
- 전체 workflow conclusion: failure

PR #310(`47b556812dcefbd7e6fe8e1a2fc52bf3427502c0`)의 실제 설명과 diff 기준, 직접 원인은 PR #308에서 F01 기존 조건부서식을 지우기 위해 추가한 Sheets metadata `fields` 마스크가 잘못 중첩돼 Google Sheets API 400(`Request contains an invalid argument`)을 만든 것이다. PR #310은 이를 기존 정상 코드와 같은 sibling fields 문법으로 고쳤다.

이어 PR #311 merge commit `8078b978e071982e0ebec5bb056518cb5701785c`이 production checkout ref를 `0c4ec76b605c3ac50efcd9483dd2294bd89e22c0`으로 재고정했다.

현재 새 pin 검증 run `35043402729`는 이번 감사 시점에 **아직 진행 중**이며 `원천에서 ERP5 현재 원자 계산` 단계까지 진행됐다. 따라서 `0c4ec76b...`을 새로운 운영 PASS pin이라고 아직 선언하지 않는다. 직전 마지막 완전 PASS 증거는 계속 `d635f8c8...` / run `35039845907`이다.

### B. 충돌(중요) — 현재 production pin `0c4ec76b...`은 `d635f8c8...`의 후손이 아니며 PR #303 색상 SSOT를 잃음

**판정: production lineage drift / workflow 주석과 실제 Git 계보 불일치**

`.github/workflows/erp5-ssot-refresh.yml` 주석은 현재 `0c4ec76b...`가 `d635f8c8...`의 색상 SSOT 위에 PR #308, #310을 얹은 것처럼 설명한다. 그러나 실제 commit 비교는 그렇지 않다.

`d635f8c8...` → `0c4ec76b...` 비교:

- status: `diverged`
- merge base: `3a334ddf6e8acd721883757f7951052bf9188b87`
- `0c4ec76b...`는 `d635f8c8...` 대비 ahead 3 / behind 1

역방향 비교에서 `d635f8c8...` 쪽의 유일한 독자 변경은 정확히 다음 세 파일이다.

- `lib/domain/category-colors.ts`
- `lib/domain/sales-sheet-format.ts`
- `lib/domain/supplier-template-sheet.ts`

이는 PR #303에서 도입한 **분류/구분 색상 단일출처** 변경이다.

실제 production ref `0c4ec76b...`의 파일도 재확인했다.

- `lib/domain/category-colors.ts`에는 current main에 존재하는 `'분류'` 색상표가 없다.
- `lib/domain/sales-sheet-format.ts`는 다시 `GUBUN_INK`를 직접 하드코딩한다.
- `분류`에 대해서도 일부 값만 별도 하드코딩하는 옛 방식이 남아 있다.

반면 current main의 `category-colors.ts`에는 `신차렌트/중고렌트/중고구독/신차구독/픽업구독`을 한 표로 모은 `'분류'` SSOT가 존재한다.

따라서 현재 production pin은 **#303을 포함했다고 주석에는 적혀 있지만 실제로는 그 변경을 잃은 가지**다. 데이터/가격 Atom이 틀렸다는 뜻은 아니지만, 상품구분 색 표현의 SSOT가 production에서 다시 갈라졌다.

Claude 구현 Owner는 단순히 `0c4ec76b...`를 PASS 처리하지 말고, **#303 색상 SSOT + #308 조건부서식 누적정리 + #310 fields 수정이 모두 한 계보에 들어간 검증 엔진**을 다시 구성한 뒤 repin/실발행해야 한다.

### C. 충돌(현재 F86 projection) — 승인된 표시 요구가 production builder에 반영되지 않아 수동 수정은 다음 발행에 덮임

**판정: F86 presentation contract drift / upstream Atom 변경 금지**

현재 승인된 F86 표시 요구는 다음과 같다.

- `공지사항` 탭 제거
- `종합` 탭만 시간 + 대수를 표시
- 나머지 공급사 탭은 시간 없이 `이안카 000대`처럼 공급사명 + 대수만 표시
- `구분` 칸은 상품구분별로 서로 확실히 구별되는 색 체계를 적용
- 데이터/대여료/ERP5 Atom/SSOT 의미는 변경하지 않음

그런데 current production ref `0c4ec76b...`의 실제 코드:

- `scripts/build-channel-supplier-sheet.mts`가 `ensureNoticeTab()`을 호출해 `공지사항` 탭을 보장한다.
- 탭 인덱스도 `0 = 공지사항`을 전제로 시작한다.
- stale tab 삭제 로직도 `공지/안내` 탭을 보존한다.
- `lib/server/channel-f86-plan.ts`는 모든 탭 제목을 `${company} ${mark} · ${N}대`로 만든다. 즉 종합뿐 아니라 공급사별 탭에도 매번 시간이 들어간다.
- 현 production 서식은 `구분`을 주로 글자색 조건부서식으로 처리하고 있으며, 사용자 승인 표시계약과 일치하는 단일 표현 규칙이 production에 고정돼 있지 않다.

따라서 Google Sheet에서 공지 탭 삭제/탭 이름 단순화/구분색 변경을 직접 해도 **다음 F86 production publish가 현재 builder 규칙대로 다시 되돌릴 수 있다.**

이 수정은 F86이 projection/presentation이라는 구조 계약 안에서 처리해야 한다. `ERP5 Atom`, canonical source, 공급사 가격/기간 의미를 바꾸지 않는다.

### D. 확인됨 — canonical source 및 손오공/오토플러스 전용탭 결정은 이번 변경에서 회귀 증거 없음

current main의 `lib/domain/inventory-source-registry.ts`는 계속:

- RP006 = ironrentcar.com
- RP012 = Sonogong ERP/API
- RP023 = RebornCar

를 canonical source로 고정한다.

`2026-09-16-sonogong-autoplus-tab-routing.md`의 확정 결정도 그대로 유효하다.

- 손오공 = 별도 `손오공구독`
- 오토플러스 = 별도 `오플구독`
- 고유 기간/요금 축 보존
- 공통화는 템플릿 표현만

이번 감사에서 이 계약 자체가 뒤집힌 근거는 찾지 못했다.

### E. 충돌 유지 — 예약지도는 이제 실제 pin과 더 멀어졌고 legacy writer latent risk도 그대로

`docs/예약작업-지도.md`는 통합 engine을 아직 `3a334ddf...`로 적는다. 실제 workflow pin은 이제 `0c4ec76b...`이므로 문서 drift는 계속된다.

legacy 경로도 변화 없음.

- `sales-erp-hourly.yml` cron `0 0-9 * * 1-5` 잔존
- `mirror-sync.yml` cron `*/30 * * * *` 잔존
- `MIRROR_SOURCES`의 RP023 `from`은 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`
- canonical RP023은 RebornCar

예약지도상 두 workflow는 꺼짐이지만, repository 자체가 disable 상태를 강제하지 못한다는 latent conflict 판정은 유지한다.

### 이번 감사 최종 판정

1. **직전 완전 검증 production:** `d635f8c8...` / run `35039845907` PASS.
2. **PR #308 회귀:** 실제 run `35042070104`에서 F01 발행 failure 확인.
3. **긴급 수정:** PR #310 merge + PR #311 repin으로 current pin `0c4ec76b...`; 새 운영 run `35043402729`는 감사 시점 진행 중이라 HOLD.
4. **신규 핵심 drift:** `0c4ec76b...`이 `d635f8c8...`과 diverged되어 PR #303 분류색 SSOT를 잃었다. workflow 주석의 계보 설명도 틀림.
5. **F86 표시계약 drift:** 공지사항 탭/모든 탭 timestamp/구분 색상 방식이 승인된 현재 표시 요구와 불일치하며 수동 편집은 다음 publish에 덮일 수 있음.
6. **canonical source·손오공/오토플러스 전용탭:** 회귀 증거 없음.
7. **예약지도/legacy writer latent risk:** 미해소.

### Claude 구현 Owner에게 넘기는 즉시 작업

1. `0c4ec76b...`을 최종 PASS로 보지 말고 run `35043402729` 완료 결과부터 확인한다.
2. production engine 가지를 재정리해 **PR #303 + #308 + #310**을 모두 포함하는 단일 계보로 만든다. 그 뒤 workflow pin/validated allowlist를 함께 올리고 실제 apply run으로 F01/F86/감사까지 확인한다.
3. F86 presentation은 승인된 요구대로 builder/plan에서 고친다: 공지사항 탭 제거, 종합만 시간+대수, 공급사 탭은 이름+대수, 구분 색상은 한 SSOT에서 일관되게 적용한다. **Atom/가격/기간 로직은 손대지 않는다.**
4. `docs/예약작업-지도.md`와 ACTIVE handoff의 stale 상태를 실제 pin/현재 규칙과 맞춘다.
5. legacy writer UI-disable 의존성 문제는 기존 판정을 유지하고 별도 구현 결정을 한다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다. 감사 문서와 Claude 진입점만 갱신한다.

---

## 2026-09-16(8) — ChatGPT 독립 감사 후속: `0c4ec76b...` 운영 재검증 PASS, 구조 drift는 잔존

### A. 해소됨 — PR #310/#311 이후 current production pin의 실제 운영 발행 성공

`2026-09-16(7)` 작성 직후 진행 중이던 run `35043402729`가 종료됐다.

- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- head: `8078b978e071982e0ebec5bb056518cb5701785c`
- production checkout ref: `0c4ec76b605c3ac50efcd9483dd2294bd89e22c0`
- conclusion: **success**
- 완료 시각: 2026-09-16 01:31:12 UTC

모든 핵심 단계가 success다.

- 원천 계약 검사
- 현재 원천 재수집
- ERP5 현재 원자 계산
- 정책 참조 정합화
- 발행 snapshot 고정
- public catalog 발행 대사
- **F01 판매시트 게시**
- F86 백업 및 게시
- F86 ↔ 원자 감사
- **원자 ↔ F01 ↔ F86 칸 단위 대조**
- **차번 셀 사진 링크 대조**
- 회차 증거 보존

따라서 PR #308이 만들었던 F01 API 400 런타임 회귀는 PR #310 수정 + #311 repin 이후 실제 운영 회차에서 **해소됨**으로 판정한다.

### B. 충돌 유지 — runtime PASS와 production lineage/색상 SSOT PASS는 별개

run `35043402729` 성공은 `0c4ec76b...`의 현재 발행 경로가 동작한다는 강한 증거다. 하지만 `(7)-B`의 Git 계보 사실은 바뀌지 않았다.

- `0c4ec76b...`과 `d635f8c8...`은 diverged
- `0c4ec76b...`은 PR #303의 `category-colors.ts` / `sales-sheet-format.ts` / `supplier-template-sheet.ts` 색상 SSOT 변경을 포함하지 않음
- production ref의 상품구분 색은 다시 하드코딩된 옛 구조

따라서 현재 판정은 다음처럼 분리한다.

- **데이터/발행 runtime:** PASS
- **상품구분 색상 SSOT/계보:** 충돌 잔존

Claude 구현 Owner는 성공한 run을 이유로 `(7)-B`를 닫지 않는다. PR #303 + #308 + #310이 모두 한 검증 엔진 계보에 들어가야 구조적 drift가 해소된다.

### C. 충돌 유지 — F86 표시계약은 아직 builder와 불일치

run이 성공하면서 오히려 한 가지가 더 명확해졌다. current builder가 정상적으로 다시 F86을 발행했으므로, 수동 표시 편집은 다음 회차에 builder 규칙으로 덮이는 구조가 실제 운영 중이다.

현재 승인 요구:

- 공지사항 탭 제거
- 종합만 시간 + 대수
- 공급사 탭은 시간 없이 이름 + 대수
- 구분 상품별 명확한 색 구별

current `0c4ec76b...` builder/plan은 여전히:

- `ensureNoticeTab()`으로 공지사항 보장
- 모든 탭에 `${mark} · N대` 사용
- 색상 SSOT도 PR #303이 빠진 옛 구조

따라서 이 항목은 **미해소 유지**다. 해결 위치는 F86 projection/builder이며 Atom·가격·기간 로직은 건드리지 않는다.

### 최종 후속 판정

1. `0c4ec76b...` **실제 운영 발행 PASS** — PR #308 런타임 회귀 해소.
2. **PR #303 색상 SSOT 누락/production lineage drift는 미해소.**
3. **F86 표시계약 drift는 미해소.**
4. canonical source/손오공·오토플러스 전용탭 결정에는 신규 회귀 증거 없음.
5. 예약지도/legacy writer latent risk도 기존 판정 유지.

---

## 2026-09-16(9) — ChatGPT 독립 감사: PR #312로 production 계보/상품구분 색 SSOT 복구, 새 pin 실발행은 검증 중

### A. 해소됨 — `(7)/(8)`의 production lineage / PR #303 색상 SSOT 누락이 PR #312로 구조적으로 해소

**판정: 해소됨(코드 계보) / 새 pin 운영 실발행은 아래 B에서 HOLD**

current main HEAD는 PR #312 merge commit `59e45d8d69ae94ea7edb0e77e10fa3640bfe0bec`이다. 현재 `.github/workflows/erp5-ssot-refresh.yml`의 production checkout ref와 `scripts/check-inventory-source-contract.mts`의 validated allowlist는 모두 다음 커밋을 가리킨다.

- `308511563d8e8f56dbd94f715469d8ae7ed9171a`

실제 Git 계보를 다시 확인하면:

- `308511563...` → parent `298120fbaa2a4dd4227fcea5431f3ffbd84c1be6` (PR #308 조건부서식 누적정리)
- `298120f...` → parent `d635f8c87c3840a6956184b4d20f99dd968b6138` (PR #303 분류/구분 색 SSOT 포함 검증 엔진)
- `308511563...` 자체는 PR #310의 Sheets metadata fields-mask 400 수정까지 포함

따라서 직전 `0c4ec76b...`에서 갈라졌던 잘못된 계보는 더 이상 current production이 아니다. **PR #303 색상 SSOT + PR #308 조건부서식 정리 + PR #310 fields 수정이 한 계보에 다시 합쳐졌다.** `(7)-B`, `(8)-B의 production lineage/color-SSOT 충돌은 이 범위에서 해소됨으로 갱신한다.

근거: PR #312, merge `59e45d8d...`, production pin `308511563...`, `check-inventory-source-contract.mts` validated allowlist.

### B. 보류 — 새 production pin `308511563...`의 실제 apply 발행은 현재 진행 중

PR #312 merge 직후 workflow_dispatch run `35044774559`(run #14)가 시작됐다.

감사 시점 확인 결과:

- checkout / OIDC / npm ci: success
- 원천 계약 검사: success
- 원천 자격증명 준비: success
- 현재 원천 재수집: success
- 티카 유료옵션 감사: success
- `원천에서 ERP5 현재 원자 계산`: **in progress**
- 이후 snapshot / F01 / F86 / F86↔Atom / Atom↔F01↔F86 / 사진링크 감사: 아직 pending

따라서 `308511563...`을 **운영 PASS라고 아직 선언하지 않는다.** 직전 완전 운영 PASS 증거는 `0c4ec76b...` / run `35043402729`; 이번 새 pin은 계보 정합성은 복구됐지만 실제 F01/F86 운영 회차 완료를 기다려야 한다.

### C. 확인됨 — 배차상태와 상품구분 색은 서로 다른 의미/표를 사용하도록 현재 pin에 분리돼 있음

current production pin `308511563...`의 `lib/domain/sales-sheet-format.ts`를 직접 확인했다.

- 상품구분(`구분`) → `GUBUN_INK = MASTER_CATEGORY_COLORS['분류']`에서 가져와 단일출처 사용
- 배차상태 → 별도 `STATE_INK`
  - `즉시출고`, `출고가능` = 파랑
  - `상품화중`, `출고협의` = 주황
  - `계약중`, `출고불가` = 회색
- `channel-retro-skin.ts`도 F86 레트로 스킨에서 **구분·배차상태 값별 색을 살린다**고 명시

따라서 “배차상태와 상품구분을 각각 자기 의미에 맞게 색칠”하는 구조 자체는 현재 production 엔진에 존재한다. 다만 B의 새 pin 실발행이 완료되기 전까지 실제 운영 시트 최종 표시 PASS로는 확정하지 않는다.

### D. 충돌 유지 — F86의 공지사항/탭명 표시계약은 여전히 builder와 불일치

PR #312는 production pin/allowlist만 바꾼 것이며 F86 builder의 표시 규칙은 바꾸지 않았다. `308511563...`의 실제 코드에는 여전히:

- `scripts/build-channel-supplier-sheet.mts` → `ensureNoticeTab()` 호출로 `공지사항` 탭 보장
- `lib/server/channel-f86-plan.ts` → 공급사 탭도 `회사 + 시각 + 대수` 제목 사용

이 남아 있다. 따라서 승인된 “공지사항 제거 / 종합만 시간+대수 / 공급사 탭은 이름+대수” 계약은 미해소다. 구글시트 직접 편집은 다음 publish에서 다시 덮일 수 있으므로 해결 위치는 F86 projection/builder다. Atom·가격·기간 로직은 건드리지 않는다.

### E. 변화 없음 — canonical source/특수탭은 유지, 예약지도와 legacy writer latent risk는 잔존

재검증 결과:

- canonical registry: RP006=ironrentcar.com, RP012=sokrc.com API, RP023=RebornCar 유지
- 손오공=`손오공구독`, 오토플러스=`오플구독`, 고유 기간/요금 유지 결정에 신규 회귀 없음
- `docs/예약작업-지도.md`는 production engine을 아직 `3a334ddf...`로 적어 실제 `308511563...`와 불일치
- `sales-erp-hourly.yml` cron `0 0-9 * * 1-5`, `mirror-sync.yml` cron `*/30 * * * *`가 repository에 계속 남아 있음
- `MIRROR_SOURCES` RP023의 옛 Google Sheet `from` 잔존

따라서 예약지도 pin drift와 legacy writer UI-disable 의존성/재활성화 위험은 기존 판정을 유지한다.

### Claude 구현 Owner에게 넘기는 즉시 작업

1. run `35044774559` 완료 뒤 F01/F86/칸 대조/사진링크까지 모두 PASS인지 먼저 확인한다.
2. PASS면 `308511563...`을 최신 완전검증 production pin으로 확정한다.
3. F86 표시계약은 builder/plan에서만 수정한다: 공지사항 제거, 종합만 시간+대수, 공급사 탭 이름+대수. 배차상태와 상품구분은 서로 다른 색 규칙을 유지한다.
4. `docs/예약작업-지도.md`와 ACTIVE handoff를 최신 pin/규칙으로 맞춘다.
5. legacy writer latent risk는 별도 구현 판단을 유지한다.

이번 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16(10) — ChatGPT 독립 감사: PR #312 새 production pin 실발행 PASS — HOLD 해소, F86 표시 drift는 유지

### A. 해소됨 — run `35044774559`가 끝까지 `success`, `308511563...`을 최신 완전검증 production pin으로 확정

`2026-09-16(9)-B`에서 HOLD였던 workflow_dispatch run `35044774559`(run #14)를 다시 확인했다.

- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- head: `59e45d8d69ae94ea7edb0e77e10fa3640bfe0bec`
- production checkout ref: `308511563d8e8f56dbd94f715469d8ae7ed9171a`
- job `refresh`: **completed / success**
- 완료 시각: 2026-09-16 01:51:05 UTC

실제 job의 핵심 단계가 모두 success다.

- 원천 계약 검사 / 현재 원천 재수집 / 티카 유료옵션 감사
- ERP5 현재 원자 계산 / 정책 참조 정합화
- ERP5 발행 스냅샷 고정 / 공개 카탈로그 발행 대사
- **동일 스냅샷으로 F01 판매시트 게시**
- **F86 발행 직전 백업 / 동일 스냅샷으로 F86 게시**
- **F86 ↔ 원자 칸 대조·신선도**
- **원자 ↔ F01 ↔ F86 칸 단위 대조**
- **차번 셀 사진 링크 대조**
- 회차 증거 보존

따라서 `(9)-B`의 운영 실발행 HOLD는 **해소됨**이다. PR #312가 복구한 `PR #303 색상 SSOT + PR #308 조건부서식 누적정리 + PR #310 fields-mask 수정` 계보가 실제 운영 F01/F86 회차까지 통과했다.

### B. 확인됨 — 이후 main 변경은 감사/문서 계열이며 production app 회귀 증거 없음

감사 시점 current `main`은 run #14 이후 문서/감사 인계 변경이 추가됐지만, production workflow의 checkout ref는 계속 `308511563...`이다. 최근 `main` CI도 success가 확인됐다.

따라서 이번 감사에서 run #14 PASS 이후 애플리케이션 코드나 비즈니스 로직이 다시 바뀌어 production 계약을 회귀시켰다는 증거는 찾지 못했다.

### C. 충돌 유지 — F86 표시계약 drift는 run PASS로 해소되지 않음

run #14가 성공했다는 것은 **현재 builder가 의도한 규칙대로 정상 발행했다**는 뜻이지, 최신 표시 요구가 구현됐다는 뜻은 아니다.

`308511563...`에는 여전히:

- `scripts/build-channel-supplier-sheet.mts`의 `ensureNoticeTab()` — 공지사항 탭 보장
- `lib/server/channel-f86-plan.ts`의 공급사 탭 `회사 + 시각 + 대수` 제목

이 남아 있다.

따라서 “공지사항 제거 / 종합만 시간+대수 / 공급사 탭은 이름+대수” F86 presentation contract drift는 **미해소 유지**다. 해결 위치는 F86 projection/builder이며 ERP5 Atom·canonical source·가격/기간 의미는 건드리지 않는다.

### D. 변화 없음 — canonical source·특수탭·legacy writer latent risk 판정 유지

이번 재검증에서 다음 기존 판정을 뒤집을 신규 근거는 없었다.

- canonical registry: RP006=ironrentcar.com, RP012=sokrc.com API, RP023=RebornCar
- 손오공=`손오공구독`, 오토플러스=`오플구독`, 공급사 고유 기간/요금 축 보존
- `sales-erp-hourly.yml` / `mirror-sync.yml` cron 잔존과 UI-disable 의존성
- `MIRROR_SOURCES` RP023 옛 Google Sheet 잔존
- `docs/예약작업-지도.md`의 engine pin stale

### 최종 판정

1. **`308511563...` = 최신 완전검증 production pin.** run `35044774559`의 F01/F86/cross-audit/photo-audit 전체 PASS.
2. **PR #312 계보 복구의 운영 검증 HOLD 해소.**
3. **F86 공지/탭명 presentation drift는 미해소.**
4. canonical source/손오공·오토플러스 전용탭/legacy writer latent risk는 기존 판정 유지.

상세 보강 근거는 `docs/ai-ssot-audit/2026-09-16-chatgpt-run14-production-pass.md`를 함께 본다.

이번 감사에서도 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16 — F01/F86 픽업구독 「구분」 글자색 정정 (Claude, 구현·운영발행 실행)

### 배경

동료 세션이 `lib/domain/category-colors.ts`의 `MASTER_CATEGORY_COLORS['분류']['픽업구독']`이 여전히 `#C2185B`(자홍)로 남아 있다고 보고했다. 실제로는 그 파일에 `'분류'` 키 자체가 없었다 — 지목된 위치가 부정확했다. 사장님이 "실행은 Claude 단일 세션, 임의 hex 생성 금지, F01/F86 canonical map 유지, production publish 후 live 검증" 조건으로 작업을 지시했다.

### 1차 시도 — 죽은 코드를 고침(판정: 오류, 즉시 정정)

`lib/domain/sales-sheet-format.ts`의 `byValue('분류', [['중고구독','7E57C2'],['픽업구독','C2185B']])`을 찾아 픽업구독 값을 `0F766E`(teal, `components/ui/badges.tsx`의 기존 `productTypeStyle['픽업구독']='teal'` → `--bdg-teal-fg` 라이트값과 동일)로 고쳐 커밋(`4a202a44`)하고 운영 발행까지 실행했다.

**그런데 발행 칼럼명 실측 결과 F01/F86엔 「분류」라는 칼럼이 없다** — 실제 발행 칼럼은 「구분」이다(`lib/domain/sales-published-tab-columns.ts` `IDENTITY` 배열). `byValue('분류', …)`는 `idx('분류')`가 항상 -1을 반환해 조용히 no-op하는 죽은 코드였다 — 즉 옛 자홍(`C2185B`)도, 방금 고친 teal도 실제로는 **한 번도 렌더링된 적이 없었다.**

### 2차 — 진짜 활성 표(GUBUN_INK) 수정 (판정: 해소됨)

진짜 살아있는 색 표는 `byValue('구분', GUBUN_INK)` 하나뿐이다. `GUBUN_INK`(같은 파일)엔 `신차렌트·중고렌트·중고구독·신차구독` 넷만 있고 `픽업구독` 항목 자체가 없었다. 여기에 `['픽업구독', '0F766E']`를 추가하고, 죽은 `byValue('분류', …)` 호출은 지웠다. 커밋 `4647c484`.

값 출처: **임의 hex 생성 없음** — `components/ui/badges.tsx:193` `productTypeStyle['픽업구독'] = 'teal'`, 그 teal 톤의 라이트 전경색 `app/globals.css:63` `--bdg-teal-fg: #0f766e`를 그대로 가져왔다.

### Live 검증 (Google Sheets API `effectiveFormat` 직접 조회 — `userEnteredFormat`이 아니라 조건부서식이 실제 반영된 값)

- **F01** — 상품시트(`1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs`) 「픽업구독」 탭 B2 `formattedValue="픽업구독"` → `effectiveFormat.textFormat.foregroundColor = 0F766E` ✓
- **F86** — 하허호 시트(`1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg`) 「손오공」 탭 C2 `formattedValue="픽업구독"` → `effectiveFormat.textFormat.foregroundColor = 34A853`(초록, 전 행 공통). **이건 이 값별 색표와 무관하다** — `lib/domain/channel-retro-skin.ts`의 `applyRetroSkin()`이 2026-09-15 사장님 확정("딱 과거 거로만") 규격에 따라 F86 탭에서 값별 조건부서식을 전부 걷어내고 「구분」 칼럼을 회사탭 고정 단색(`BODY_INK.구분 = '34A853'`)으로 칠한다(251·314줄). 그래서 F86엔 픽업구독만의 개별 색이 설계상 없다 — 이번 건과 무관하며 손대지 않았다.
- F01·F86 둘 다 같은 `buildSalesFormatRequests()`(`sales-sheet-format.ts`)를 거치므로 **canonical 색 표는 하나로 유지**된다 — F86의 결과가 다른 건 그 위에 덮이는 별도 확정 스킨(retro) 때문이지 표가 갈라진 게 아니다.
- 손오공 특수탭 일관성: 같은 탭 내 다른 행도 전부 같은 초록(탭 전체 단색 규격이므로 값과 무관하게 일관) — 확인됨.

### 운영 발행 기록

- production write gate(`lib/server/production-sheet-write-gate.ts`) 통과: `FREEPASS_MANUAL_PUBLISH_APPROVED` 사장님 승인 경로(로컬 GitHub Actions 워크플로 없음, 긴급 수동발행).
- 스냅샷 `20260916030617229-11b34cd69b05`(2026-09-16T03:06:17.229Z) 기준으로 F01·F86 재발행.
- F01: https://docs.google.com/spreadsheets/d/1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs/edit (731대 · 69~72열)
- F86: https://docs.google.com/spreadsheets/d/1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg/edit (19탭 · 731대 · 90열)
- 이 저장소(`origin`)엔 F86을 쓰는 자동 워크플로가 아직 없다(`erp5-ssot-refresh.yml`은 F01만 발행) — workflow run 번호 없음, 로컬 수동 실행 기록만 남긴다.

### 변경 파일

- `lib/domain/sales-sheet-format.ts` (erp5 워크트리 `freepasserp4-rtdb-current`, branch `codex/rtdb-cutover-current`, commit `4a202a44`→`4647c484`)

### 최종 판정

**해소됨.** 픽업구독 「구분」 글자색은 이제 F01·F86 공용 canonical 표(`GUBUN_INK`)에서 나오고, 값은 기존 UI 토큰(teal `#0F766E`)을 그대로 재사용했다. F86 회사탭의 단색 구분색(초록)은 이 건과 무관한 기존 확정 규격이다. ERP5 Atom·canonical source·대여료/상품 의미는 변경하지 않았다.

---

## 2026-09-16(11) — ChatGPT 독립 감사: #313 색상 “해소됨”은 side branch/manual publish 한정 — current main/production에는 미반영

### A. 충돌(중요) — 직전 Claude 항목이 side branch 상태를 current main/production 상태처럼 기록함

**판정: 감사 결론 정정 필요 / 픽업구독 색상은 구조적으로 미해소**

current `main` HEAD는 `c147b1362d4aaf86ad9dedbf4ac93fd025cf37d8`(#313)이다. 이 커밋은 `docs/AI-SSOT-AUDIT-LOG.md`만 바꾼 문서 커밋이며, 애플리케이션 색상 코드를 main/production에 병합하지 않았다.

현재 main과 production pin `308511563d8e8f56dbd94f715469d8ae7ed9171a`을 직접 다시 읽으면 둘 다 다음 구조다.

- `lib/domain/category-colors.ts`에 `MASTER_CATEGORY_COLORS['분류']`가 **실제로 존재**한다.
- 그 canonical map의 `픽업구독` 값은 여전히 **`#C2185B`**다.
- `lib/domain/sales-sheet-format.ts`의 `GUBUN_INK`는 이 `MASTER_CATEGORY_COLORS['분류']`에서 파생된다.

반면 직전 Claude가 수정한 `codex/rtdb-cutover-current` branch head `4647c484d756a594302d1417e405e61a820c23fb`은:

- `category-colors.ts`에 `'분류'` map이 없고,
- `sales-sheet-format.ts`의 `GUBUN_INK`를 별도 하드코딩하며,
- `픽업구독 = 0F766E`를 그 하드코딩 표에 추가한 상태다.

Git 비교 결과도 두 계보가 분리돼 있음을 확인했다.

- `main` ↔ `codex/rtdb-cutover-current`: **diverged**, side branch ahead 521 / behind 448, merge-base `4bab085d...`
- production `308511563...` ↔ side branch `4647c484...`: **diverged**, side branch ahead 74 / behind 43, merge-base `a1da42d4...`

따라서 `4647c484`의 수동 live publish에서 F01 픽업구독이 `0F766E`로 보였다는 사실과, **현재 repository/production SSOT가 그 변경을 채택했다는 사실은 별개**다. 다음 정규 production publish가 현재 pin을 사용하면 side-branch 수동 결과가 유지된다고 보장할 수 없다.

### B. 충돌(중요) — “origin에는 F86 자동 workflow가 없다”는 직전 기록은 current main과 반대

current main의 `.github/workflows/erp5-ssot-refresh.yml`은 production pin `308511563...`을 checkout한 뒤 한 회차에서:

- F01 판매시트 게시
- F86 발행 직전 백업
- `scripts/build-channel-supplier-sheet.mts --채널=하허호 --apply`로 F86 게시
- F86 ↔ Atom 감사
- Atom ↔ F01 ↔ F86 칸 대조
- 차량번호/사진 링크 감사

를 수행한다.

즉 직전 Claude 항목의 “이 저장소(origin)엔 F86을 쓰는 자동 워크플로가 아직 없다 / `erp5-ssot-refresh.yml`은 F01만 발행” 문장은 **현재 main 기준으로 사실이 아니다.** run `35044774559`에서 이 F01/F86 통합 production workflow가 이미 완전 PASS한 기존 감사 결론이 여전히 유효하다.

### C. CI 해석 — #313 main CI success는 색상 구현 merge 증거가 아님

current main `c147b136...`에 대한 CI run `35050789201`은 success다. 하지만 #313은 감사로그 문서만 바꾼 commit이므로 이 success를 `4647c484` 색상 수정이 main/production에 들어갔다는 증거로 사용하면 안 된다.

### D. 변화 없음 — canonical source / 특수탭 / legacy writer latent risk

이번 재감사에서 아래 기존 계약을 뒤집는 신규 근거는 없었다.

- canonical source: RP006=ironrentcar.com, RP012=sokrc.com API, RP023=RebornCar
- 손오공=`손오공구독`, 오토플러스=`오플구독`, 공급사 고유 기간/요금 구조 유지
- `sales-erp-hourly.yml` / `mirror-sync.yml` cron 잔존과 UI-disable 의존성
- `MIRROR_SOURCES` RP023 옛 Google Sheet `from` 잔존
- F86 공지사항/탭명 presentation drift도 기존 미해소 판정 유지

### Claude 구현 Owner에게 넘기는 정정 지시

1. **#313의 `해소됨`을 current production 해소로 간주하지 않는다.** `4647c484`는 side branch/manual publish 증거다.
2. side branch의 하드코딩 `GUBUN_INK`를 그대로 main에 합치지 않는다. current production이 이미 복구한 PR #303 구조, 즉 `MASTER_CATEGORY_COLORS['분류']` 단일 canonical map을 유지한다.
3. 승인된 픽업구독 색을 적용하려면 **current production lineage의 canonical map 한 곳**을 수정하고, F01/F86가 그 map을 소비하는 구조를 보존한다.
4. 수정 후 정규 `erp5-ssot-refresh` production 회차로 F01/F86을 재발행하고, Google Sheets `effectiveFormat`까지 다시 확인한 뒤에만 `해소됨`으로 닫는다.
5. F86 별도 retro/presentation 규칙이 상품구분 값별 색을 덮는다면 그 충돌도 최신 사용자 요구와 함께 명시적으로 정리한다. Atom·canonical source·가격/기간 의미는 변경하지 않는다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16(12) — ChatGPT 독립 감사: F86 표시계약 side branch 구현 진전, production 미반영 + 색 SSOT 회귀 위험 유지

### A. 확인됨 — `codex/rtdb-cutover-current`에서 승인된 F86 표시 규칙을 코드/잠금 게이트로 구현함

side branch `codex/rtdb-cutover-current`의 현재 head는 `5e39d7d475c971914a64762dc507516ebdf41a54`이다. 이 커밋은 `scripts/build-channel-supplier-sheet.mts`, `scripts/check-f86-locked.mts`, `docs/영업자시트-매뉴얼.md`를 바꿔 다음 규칙을 코드와 잠금 검사에 박았다.

- 하허호 F86에서는 `공지사항`을 만들지 않고, 기존 공지사항도 묵은 탭 정리 대상이 되도록 함
- `종합`이 index 0이며 시간(mark)+대수를 표시
- 공급사 탭은 시간 없이 `회사 · N대` 형식
- 장기 요금이 없는 차도 제외하지 않고 요금 칸만 빈 채 싣는 현재 규칙 유지
- `구분`/`배차상태` 값별 색을 F01과 같은 `buildSalesFormatRequests()` 결과에서 살리도록 retro skin을 잠금

이는 직전 `(11)` 이후 **실제 구현 진전**이다. 다만 아래 B/C 때문에 production 해소로 보지는 않는다.

### B. 보류/충돌 유지 — current main/production은 그대로이며 side branch는 크게 diverged

이번 감사 시작 시 current `main` HEAD는 `805247e07a4f494cb5d89ee6968aaa9b0214ad61`이고, current production workflow의 checkout ref는 계속 `308511563d8e8f56dbd94f715469d8ae7ed9171a`이다. production workflow는 이 pin으로 F01과 F86을 한 회차에서 발행/감사한다.

`main`과 `codex/rtdb-cutover-current` 비교는 여전히 **diverged**이며 현재 side branch가 ahead 525 / behind 451, merge-base `4bab085d30181612cbf47624a76006c57065dccd`다. 따라서 `5e39d7d...`의 F86 표시 구현은 current main/production에 반영된 상태가 아니다. 기존 production F86 표시 drift 판정은 그대로 유지한다.

### C. 충돌(중요) — side branch의 “F01과 같은 색”은 current production의 canonical 색 SSOT 구조와 다름

`5e39d7d...`의 `lib/domain/category-colors.ts`에는 여전히 `MASTER_CATEGORY_COLORS['분류']`가 없다. 대신 `lib/domain/sales-sheet-format.ts`가 `GUBUN_INK`를 직접 하드코딩하며 다음 값을 사용한다.

- 신차렌트 `FF00FF`
- 중고렌트 `34A853`
- 중고구독 `7B3FE4`
- 신차구독 `0F9D9D`
- 픽업구독 `0F766E`

반면 current production `308511563...`은 PR #303에서 복구한 `MASTER_CATEGORY_COLORS['분류']` 단일 canonical map을 사용하며 `픽업구독`은 아직 `#C2185B`다. 따라서 side branch의 F86 표시 구현을 **색상 구조까지 통째로 merge/cherry-pick하면 PR #303 단일 SSOT를 다시 깨뜨릴 위험이 있다.**

Claude 구현 Owner는 side branch에서 검증된 **F86 presentation 동작만 current production lineage에 옮기고**, 상품구분 색은 `MASTER_CATEGORY_COLORS['분류']` 단일출처 구조를 보존해야 한다.

### D. 보류 — 최신 side branch Actions는 green이 아님

head `5e39d7d...` push로 시작된 Actions run `35053821352`(`.github/workflows/refresh-30min.yml`)은 `conclusion: failure`이고 jobs 조회 결과 0건이었다. 즉 이번 감사 증거만으로는 F86 구현 코드 자체가 실패 원인이라고 단정할 수 없지만, **관련 side branch에 green GitHub Actions 검증이 없는 상태**다. 직전 `0aa39ae...` push에서도 branch workflows가 failure였으므로, production 반영 전에는 current lineage에서 관련 CI/잠금 검사와 정규 F01/F86 production publish를 다시 통과시켜야 한다.

### E. 변화 없음 — canonical source / 특수탭 / legacy writer latent risk

이번 재감사에서 다음 기존 계약을 뒤집는 신규 근거는 없었다.

- canonical source: RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar
- 손오공=`손오공구독`, 오토플러스=`오플구독`, 공급사 고유 기간·주행거리·요금 축 보존
- `sales-erp-hourly.yml` cron `0 0-9 * * 1-5`와 `mirror-sync.yml` cron `*/30 * * * *`가 main에 잔존
- `MIRROR_SOURCES` RP023의 옛 Google Sheet `from` 잔존
- UI-disable에 의존하는 legacy writer 재활성화 위험 판정 유지

### Claude 구현 Owner에게 넘기는 즉시 지시

1. `5e39d7d...`을 production 해소로 처리하지 않는다. current production은 계속 `308511563...`이다.
2. side branch에서 구현한 **공지사항 없음 / 종합만 시간+대수 / 공급사 탭 이름+대수 / F01과 동일 의미의 구분·배차상태 색 유지** 동작을 current production lineage에 선택적으로 옮긴다.
3. 상품구분 색은 side branch hardcoded `GUBUN_INK`를 가져오지 말고 current `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT를 유지한다. 픽업구독 최신 색 결정도 이 canonical map 한 곳에서 처리한다.
4. current lineage에서 `check-f86-locked` 또는 동등한 잠금 검사, source contract/CI를 통과시키고, 정규 `erp5-ssot-refresh`로 F01/F86을 발행한 뒤 live `effectiveFormat`까지 검증한 후에만 해소 판정을 남긴다.
5. Atom·canonical source·가격/기간 의미는 변경하지 않는다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16(13) — ChatGPT 독립 감사: F86 production 반영 진전 + production pin/source-contract drift + writer topology 정정

### A. 해소됨/변경됨 — `(12)`의 “F86 표시 구현은 side branch에만 있음” 판정은 최신 production 기준 stale

**판정: 구현 반영 확인 / 기존 감사 결론 정정 필요**

이번 감사에서 current `main` 구현 상태를 다시 대조했다. 감사 시작 시 확인한 main 구현 HEAD는 `a607a4e26d1be841c530a6b0bd504f65038408f4`(PR #319 merge)이며, `.github/workflows/erp5-ssot-refresh.yml`의 current production checkout ref는:

- `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`

로 이동했다.

이 production lineage는 F01과 F86을 같은 회차에서 발행/감사하며, `(12)`에서 side branch 구현으로만 보였던 F86 projection 동작도 current production 계보에 들어왔다. 직접 확인한 경로 기준 핵심 동작은 다음과 같다.

- `scripts/build-channel-supplier-sheet.mts` — 묵은 `공지사항`을 제거 대상으로 처리하고 다시 만들지 않음
- `lib/server/channel-f86-plan.ts` — `종합`을 첫 탭으로 두고 `종합`에만 timestamp+대수, 공급사 탭에는 timestamp 없이 공급사명+대수
- 장기 요금이 없는 차도 제외하지 않고 요금 칸만 빈 채 싣는 F86=F01 규칙 유지
- F86 `구분`/`배차상태` 값별 색은 shared sales-format 경로를 통해 적용하도록 production lineage에 반영

중간 production commit `1939018a8edb0f4993d61e12e5e0df4864ca9cb8`은 `check:f86` 통과 후 F01/F86 수동 발행·live 검증(탭 순서·이름, 값별 색, 내장/Km 미입력, 0km 보존)이 commit/CI 이력에 기록되어 있고, 그 뒤 production pin이 `1f923d27...`로 다시 전진했다.

따라서 `(12)-B`의 “current production은 여전히 `308511563...`, F86 수정은 side branch only”는 **현재 상태가 아니다.** 다만 이번 독립 감사에서는 `1f923d27...`로 완료된 정규 scheduled production 회차를 새로 확인하지 못했으므로, current pin 자체의 다음 정상 scheduled publish 증거는 별도 확인 대상으로 남긴다.

### B. 충돌(신규/HOLD) — main의 Source Contract가 현재 production pin 자체를 거부함

**판정: SSOT governance gate drift / 즉시 정합화 필요**

현재 main `scripts/check-inventory-source-contract.mts`의 validated-engine allowlist는 다음 계보까지만 승인한다.

- `404de5...`
- `627246...`
- `baaed18...`
- `308511563d8e8f56dbd94f715469d8ae7ed9171a`

즉 current production workflow가 실제 checkout하는 `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`가 allowlist에 없다.

이 drift는 실제 current-main Actions에서 재현됐다.

- workflow: `SSOT Source Contract`
- run: `35058214607`
- job: `104672754543`
- conclusion: **failure**
- 정확한 실패문: `.github/workflows/erp5-ssot-refresh.yml: checkout ref 1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f is not an approved validated engine`

따라서 main은 현재 **자기가 선언한 production engine을 자기 SSOT Source Contract로 승인하지 못하는 상태**다.

이 실패가 곧바로 production publish runtime 실패를 뜻하는 것은 아니다. `erp5-ssot-refresh.yml`은 pinned engine을 checkout한 뒤 그 engine의 검사 코드를 실행하므로, 위 실패는 우선 **main repository governance/CI 계약의 drift**로 판정한다. 하지만 SSOT 감사 기준으로는 source-contract gate가 current production pin을 인정하고 다시 green이 되기 전까지 **HOLD**가 맞다.

### C. 충돌 유지 — 픽업구독 canonical 색은 여전히 production SSOT에 반영되지 않음

current production pin `1f923d27...`의 `lib/domain/category-colors.ts`를 직접 확인했다.

- `MASTER_CATEGORY_COLORS['분류']['픽업구독'] = '#C2185B'`

즉 side branch/manual publish에서 검증했던 teal `#0F766E`는 아직 production canonical SSOT가 아니다. `(11)`의 핵심 색상 판정은 이 점에서 **여전히 유효**하다.

Claude 구현 Owner는 이 색을 해결할 때 channel-local `GUBUN_INK`를 다시 하드코딩하지 말고, production의 `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 결정해야 한다.

### D. writer topology 정정 — `sales-erp-hourly.yml`은 “UI-disabled latent risk”로만 보면 부족함

**판정: active-capable scheduled writer로 취급해 ownership 재확인 필요**

current `.github/workflows/sales-erp-hourly.yml`은 schedule을 여전히 보유하고 있으며, `SALES_ERP_CLOUD_SCHEDULED_SYNC_ENABLED`도 repository variable이 없으면 `true`를 기본값으로 사용한다.

더 중요한 실제 증거가 있다.

- scheduled run `34955061603`이 2026-09-15에 실제로 dispatch됐고 **failure**했다.
- PR #317 / commit `330ada9569f6b6bcff28d1cead8132b388136ad9`의 commit message는 이 workflow가 매 회차 `손오공 계정 없음`으로 죽고 있었으며, secrets는 존재했지만 `.손오공계정.json` 준비 단계가 이 workflow에만 빠져 있던 것이 원인이라고 명시한다.
- PR #317은 그 credential preparation을 공통 composite action으로 통합해 이 recurring writer 경로를 복구했다.

따라서 과거 감사의 “GitHub UI에서 꺼져 있는 것으로 기록된 latent risk”만으로는 현재 topology를 충분히 설명하지 못한다. Claude는 `sales-erp-hourly.yml`을 **실제 schedule dispatch 이력이 있고 최근에 실행 blocker까지 수리된 active-capable writer**로 보고, ERP5 canonical/projection ownership과 충돌하지 않도록 명시적으로 경계를 다시 확인해야 한다.

반면 `.github/workflows/mirror-sync.yml`은 current main에서 job 자체가 `vars.MIRROR_SYNC_ENABLED == 'true'` 조건으로 fail-closed되어 있어, 이번 감사에서는 신규 active conflict 증거를 찾지 못했다.

### E. 변화 없음 — canonical source / 손오공·오토플러스 특수탭 / RTDB canonical 제거

이번 재감사에서 다음 계약을 뒤집는 신규 근거는 없었다.

- ERP5 canonical source registry: RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar
- 손오공/오토플러스 별도 판매탭과 공급사 고유 기간·주행거리·요금 축 보존
- RTDB를 canonical inventory source로 되돌리는 신규 회귀 없음
- `MIRROR_SOURCES`의 legacy 정보는 canonical source 권한이 없음

### 최종 판정

1. `(12)`의 **F86 production 미반영** 판정은 해소/변경됨 — current production pin은 `1f923d27...`이며 F86 presentation 구현이 production lineage에 들어왔다.
2. **신규 HOLD:** main의 `SSOT Source Contract`가 current production pin `1f923d27...`를 승인하지 않아 run `35058214607`이 실패한다.
3. **픽업구독 canonical 색:** 미해소 — production SSOT는 여전히 `#C2185B`.
4. **writer topology:** `sales-erp-hourly.yml`은 실제 schedule dispatch 및 최근 credential-path 복구 이력이 있으므로 단순 dormant/UI-disabled로 취급하면 안 된다.
5. canonical source/특수탭/RTDB canonical 제거에는 신규 회귀 없음.

상세 근거: `docs/ai-ssot-audit/2026-09-16-chatgpt-production-pin-contract-writer-topology.md` (audit evidence commit `c7a2db6d10106cdd23303b1c49a92c15749199a1`).

### Claude 구현 Owner에게 넘기는 즉시 지시

1. current production pin `1f923d27...`을 validated-engine contract에 반영하고 `SSOT Source Contract`를 다시 green으로 만든다.
2. `1f923d27...` 기준 정규 production scheduled 회차가 F01/F86 발행·감사까지 정상 완료되는지 확인한다.
3. 픽업구독 색은 `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT에서만 해결한다. side-branch hardcoded 색표를 가져오지 않는다.
4. `sales-erp-hourly.yml`의 실제 writer ownership/feature flag를 재확인해 ERP5 canonical inventory writer와 중복 권한이 생기지 않도록 한다.
5. `mirror-sync.yml`은 현재 fail-closed guard를 유지하고, RTDB/mirror를 canonical source로 되돌리지 않는다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16(14) — ChatGPT 독립 감사 정정: `mirror-sync` fail-closed 판정 오류 + writer topology 위험 재상향

### A. 정정 — `(13)`의 `mirror-sync.yml` fail-closed 설명은 current main과 불일치

**판정: 감사 결론 정정 / writer topology 위험 재상향**

`2026-09-16(13)`은 current `.github/workflows/mirror-sync.yml`의 job에 `vars.MIRROR_SYNC_ENABLED == 'true'` 조건이 있어 repository 차원에서 fail-closed된다고 기록했다. 이번 재감사에서 파일 원문을 직접 다시 확인한 결과 **그 조건은 존재하지 않는다.**

current main `.github/workflows/mirror-sync.yml`의 실제 동작:

- `on.schedule`: `cron: '*/30 * * * *'`
- `jobs.mirror`에 `MIRROR_SYNC_ENABLED` 또는 동등한 repository-level `if` guard 없음
- `정제시트 일괄 갱신` step은 schedule 이벤트이면 `scripts/sync-mirror-all.mts --apply`를 실행

따라서 이 workflow가 GitHub Actions UI에서 disabled라면 실행되지 않을 수는 있지만, **repository 코드 자체는 disable을 강제하지 않는다.** UI에서 enable되면 30분 schedule writer가 다시 실제 쓰기를 수행할 수 있는 구조다. `(13)-D`의 mirror-sync 부분과 `(13)` 마지막 지시의 “현재 fail-closed guard를 유지” 문구는 최신 판정이 아니다.

### B. 충돌 유지 — RP023 legacy mirror source는 canonical source와 별개로 계속 살아 있음

current `lib/domain/mirror-sources.ts`의 RP023:

- `kind: 'sheet'`
- `from: 1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U` (옛 Google Sheet)
- `to: 1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0`

반면 current `lib/domain/inventory-source-registry.ts`의 RP023 canonical source는 계속 **RebornCar**다.

즉 mirror 경로는 projection/legacy 용도로만 취급되어야 하며 canonical inventory source 권한을 가져서는 안 된다. 다만 repository 기준으로 `mirror-sync.yml`은 active-capable scheduled writer이므로, 실제 운영 ownership/enable 상태를 명시적으로 정리하지 않으면 옛 RP023 시트를 기준으로 projection/mirror가 다시 갱신될 수 있다.

### C. `(13)`의 나머지 핵심 판정은 재확인됨

이번 재감사에서 다음은 그대로 유효하다.

- current production pin: `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`
- F86 presentation 규칙은 production lineage에 반영됨: 공지사항 미생성/정리, 종합만 시간+대수, 공급사 탭은 회사명+대수
- current main Source Contract allowlist는 `1f923d27...`을 승인하지 못하며 run `35058214607`이 failure
- production canonical `MASTER_CATEGORY_COLORS['분류']['픽업구독']`은 여전히 `#C2185B`
- `sales-erp-hourly.yml`은 실제 schedule dispatch 이력과 최근 credential-path 복구가 있는 active-capable writer
- canonical source는 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar
- 손오공=`손오공구독`, 오토플러스=`오플구독`, 공급사 고유 기간·주행거리·요금 축 보존

최근 main의 애플리케이션/운영 구현 기준 주요 변경은 PR #319 merge `a607a4e26d1be841c530a6b0bd504f65038408f4`까지이며, 그 이후 `c7a2db6...`, `f96aff2...`, `c64f45e...`는 감사 문서 계열이다. 이번 ChatGPT 감사에서도 애플리케이션 코드나 비즈니스 로직은 수정하지 않았다.

### Claude 구현 Owner에게 넘기는 즉시 지시

1. `1f923d27...`을 validated-engine contract와 정합화해 `SSOT Source Contract`를 green으로 만든다.
2. `sales-erp-hourly.yml` **뿐 아니라 `mirror-sync.yml`도 active-capable scheduled writer로 취급**하고, 실제 ownership/disable 방식을 repository 수준에서 명시적으로 결정한다. UI disable만으로 안전하다고 간주하지 않는다.
3. RP023 옛 Google Sheet mirror를 canonical source로 승격시키지 않는다. RP023 canonical은 계속 RebornCar다.
4. 픽업구독 색은 `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT에서만 해결한다.
5. `1f923d27...` 기준 정규 production scheduled 회차의 F01/F86 전체 감사 성공 여부를 확인한다.

---

## 2026-09-16(15) — ChatGPT 독립 감사: RTDB direct-open 24→0 CI 래칫 해소, writer/source-contract HOLD 유지

### A. 해소됨 — app/lib/components의 RTDB 직접 문 열기가 0으로 내려가고 main CI에 고정됨

**판정: 구현 개선 확인 / RTDB direct-open debt 해소**

current main 구현 기준 핵심 변경은 PR #321 / commit `fa8915319afbd0c61affe01d99895db0e5ef9c8a`다.

- `scripts/check-store-canon.mts`의 self-test가 실제 production 파일이 계속 RTDB를 직접 열고 있어야 성립하던 구조에서 **합성 in-memory 표본 기반**으로 변경됨.
- 정적/admin import, dynamic import, `require`, re-export, 이어 붙인 specifier는 반드시 잡고, 주석·문자열·Firestore import는 잡지 않는 대조군을 사용함.
- `app`, `lib`, `components`에서 명시적 swap/adapter gate를 제외한 RTDB 직접 열기 baseline이 **24 → 0**으로 내려감.
- `.github/workflows/ci.yml`에 `npm run check:store`가 실제 연결되어 새 직접 RTDB 접근이 생기면 generic CI에서 실패하도록 래칫이 걸림.

최신 main `294ecce4eb84109bd2e5244a89dca11fa0446cd7`의 CI run `35062421549`는 **completed / success**다. 따라서 이 검사는 코드에만 존재하는 것이 아니라 현재 main에서 실제 CI-enforced + green 상태다.

상세 근거: `docs/ai-ssot-audit/2026-09-16-chatgpt-rtdb-zero-ratchet.md` (evidence commit `8155cf6e13dd68be0e1341c316c80f1d9f3bf3aa`).

### B. 경계 확인 — RTDB 0은 writer topology 단일화 해소가 아님

PR #321의 `0`은 **app/lib/components가 스왑점을 우회해 RTDB SDK 문을 직접 여는가**를 재는 값이다. scheduled writer 자체의 존재/권한을 없앤 것은 아니다.

current main 재확인:

- `.github/workflows/mirror-sync.yml`: `*/30 * * * *`, repository-level fail-closed guard 없음, schedule이면 `sync-mirror-all.mts --apply`
- `.github/workflows/sales-erp-hourly.yml`: `0 0-9 * * 1-5`, schedule이면 `cloud-hourly-sync.mts --apply`
- `lib/domain/mirror-sources.ts` RP023 `from`: 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`
- canonical `inventory-source-registry.ts` RP023: RebornCar

따라서 `(14)`의 **두 legacy schedule을 active-capable writer로 보고 repository 수준 ownership/disable을 정리해야 한다**는 판정은 그대로다. `RTDB direct-open 0`을 근거로 이 항목을 닫으면 안 된다.

### C. HOLD 유지 — current production pin과 Source Contract allowlist 불일치 그대로

current `.github/workflows/erp5-ssot-refresh.yml` production ref는 계속:

- `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`

current main `scripts/check-inventory-source-contract.mts`의 `VALIDATED_ENGINES`는 여전히 `308511563...`까지만 포함하고 `1f923d27...`을 포함하지 않는다.

따라서 기존 `SSOT Source Contract` run `35058214607` failure 판정은 해소되지 않았다. 최신 generic CI run `35062421549`가 green인 사실은 이 별도 governance gate failure를 덮어쓰지 않는다.

### D. 보류 유지 — `1f923d27...` 정규 scheduled production PASS 증거는 아직 없음

현재 Actions에서 관측한 최신 scheduled `ERP5 SSOT 원천 최신화(매시간)` success run `35053074482`는 PR #318/#319이 production ref를 `1f923d27...`로 올리기 **전** 회차다. 따라서 current pin의 scheduled 검증 증거로 쓰지 않는다.

이번 감사 시점에는 repin 이후 `1f923d27...`을 실제 checkout해 완료된 새 scheduled ERP5 success를 확인하지 못했다. 이것만으로 schedule 고장/disable을 단정하지는 않지만, 기존 요구인 **current pin 기준 정상 scheduled F01/F86 full-audit 성공 확인**은 계속 pending이다.

### E. 나머지 SSOT 판정 변화 없음

- production canonical `MASTER_CATEGORY_COLORS['분류']['픽업구독']`은 여전히 `#C2185B` — 미해소.
- F86 production lineage에는 공지사항 제거, 종합 첫 탭/종합만 timestamp, 공급사 탭 timestamp 없음, 장기요금 없는 차 포함, shared formatting path가 들어 있음.
- canonical registry는 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar 유지.
- 손오공=`손오공구독`, 오토플러스=`오플구독`, 손오공 중고렌트는 손오공구독 내부 반납형, 공급사 고유 기간·주행거리·요금 축 보존.

### Claude 구현 Owner에게 넘기는 즉시 지시

1. RTDB direct-open debt는 **해소됨**으로 취급하되 `check:store` baseline 0을 유지한다.
2. 이를 writer topology 해소로 오인하지 않는다. `mirror-sync.yml`과 `sales-erp-hourly.yml`의 ownership/disable은 별도로 정리한다.
3. `1f923d27...`을 validated-engine contract와 정합화하고 `SSOT Source Contract`를 green으로 만든다.
4. current pin 기준 정규 scheduled F01/F86 full-audit 성공 회차를 확인한다.
5. 픽업구독 색은 `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 해결하고 정규 publish 뒤 live `effectiveFormat`까지 확인한다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16(16) — ChatGPT 독립 감사: Source Contract HOLD 해소 + production pin `2e880cef...` + 정산원장 락 자동화 미연결

### A. 해소됨 — production pin / `VALIDATED_ENGINES` 계약 drift가 PR #325로 정합화됨

**판정: 기존 `(13)~(15)` Source Contract HOLD 해소**

current main HEAD는 PR #325 merge commit `c8234f4155f51ab2aae63f411d2531b0c62ceb17`이다. 현재 `.github/workflows/erp5-ssot-refresh.yml`의 production checkout ref는 더 이상 `1f923d27...`이 아니라:

- `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`

이다.

PR #325는 `scripts/check-inventory-source-contract.mts`의 `VALIDATED_ENGINES`에 당일 전진 계보 `1939018a...`, `1f923d27...`, `2e880cef...`를 추가했다. 실제 main Actions도:

- `SSOT Source Contract` run `35067923610` — **success**
- generic `CI` run `35067923638` — **success**

로 확인된다. 따라서 main이 자기 production pin을 승인하지 못하던 governance HOLD는 **해소됨**이다.

### B. 변경됨/보류 — current production pin은 collector 의미까지 바뀐 `2e880cef...`; 이전 pin의 runtime PASS를 그대로 승계하면 안 됨

`2e880cef...`은 표시규칙만 바꾼 커밋이 아니다. 부모 계보의 `60d1d2dd3ef04f38461454e13175edd54af150e5`에서:

- `scripts/ingest-supplier-to-firestore.mts`가 원천에서 사라진 `계약중` 차량을 더 이상 보호하지 않고 `출고불가`로 retire할 수 있도록 변경됨
- 락이 있던 차량의 source disappearance는 `status_reason='계약완료'`로 구분됨
- 새 `scripts/sync-vehicle-lock-from-ledger.mts`가 정산원장 `접수`/`취소`를 읽어 ERP5 Atom의 계약 락을 걸고 푸는 도구로 추가됨

그 위 `2e880cef...`에서는 상품구분 7캐논 색을 단일 표로 채우고 `check:color-ssot`로 소비처 하드코딩을 잠갔다.

따라서 `1f923d27...` 이전 회차의 성공을 현재 collector semantics의 완전 운영 PASS 증거로 재사용하지 않는다. **`2e880cef...` 기준 정규 F01/F86 full-audit 운영 성공은 별도 확인 전까지 보류**다.

### C. 충돌(신규) — “정산원장 접수→Atom 락 / 취소→락 해제” 구현은 존재하지만 현재 scheduled orchestration에 연결되지 않음

**판정: 구현 도구 존재 / 자동 운영 경로 미연결**

current main 및 production pin `2e880cef...`의 `.github/workflows/settlement-sync.yml`은 여전히 `원장에서 계약중 세우기` 단계에서:

- `scripts/sync-contract-from-ledger.mts`

를 호출한다.

그런데 이 옛 스크립트는 `SETTLEMENT_LEDGER_TAB`을 읽고, current `lib/domain/settlement-ledger.ts`에서 그 호환 상수는 여전히:

- `SETTLEMENT_LEDGER_TAB = '정산'`

이다. 같은 파일의 current 운영 계약은 실제 탭을 `접수`, `취소`, `분납실적`, `완납실적`, `청구`로 정의하고, `정산`은 “가르기 전 이름 / 옛 도구 호환”으로만 남긴다.

반면 새 `scripts/sync-vehicle-lock-from-ledger.mts`는 정확히 current `접수`/`취소` 탭을 대상으로 Atom 락을 걸고 푸는 대체 경로지만, 이번 감사에서 `settlement-sync.yml`이나 `erp5-ssot-refresh.yml`의 **실행 step**으로 연결된 흔적은 찾지 못했다. production workflow에는 이 기능을 설명하는 주석만 있고 실제 호출은 없다.

따라서 현재 production pin 설명의 “정산원장 접수→락 / 취소→락 해제”를 **정규 자동운영에서 이미 동작한다고 보면 안 된다.** Claude 구현 Owner가 기존 supplier-sheet mutation 경로와 새 Atom-lock 경로 중 정본을 명확히 하고 scheduled orchestration을 맞춰야 한다.

### D. 개선됨/미해소 병존 — 상품구분 색 SSOT 잠금은 진전, 픽업구독 최신 색 요구는 그대로 미해소

`2e880cef...`은 `MASTER_CATEGORY_COLORS['분류']`가 `PRODUCT_TYPES` 7캐논을 전부 덮도록 하고 `check:color-ssot`를 `check:sync`에 연결했다. 추가된 값:

- 오공구독 `#5B21B6`
- 오플구독 `#A16207`

등으로, 소비처가 정본에서 파생되는 구조는 강화됐다.

하지만 `픽업구독` 값은 여전히:

- `#C2185B`

이므로 `(11)~(15)`에서 남긴 최신 승인 색과의 불일치 판정은 닫지 않는다. **색 SSOT 구조/잠금 개선과 픽업구독 실제 색 결정은 별개**다.

### E. 변화 없음 — canonical source / 특수탭 / legacy writer topology

재검증 결과:

- canonical registry: RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar
- 손오공=`손오공구독`, 오토플러스=`오플구독`, 손오공 중고렌트=`손오공구독` 내부 반납형, 공급사 고유 기간·주행거리·요금 축 유지
- F86은 `종합`만 timestamp+대수, 공급사 탭은 timestamp 없이 회사명+대수, 장기요금 없는 차 포함 규칙 유지
- `mirror-sync.yml`과 `sales-erp-hourly.yml`의 cron/write-capable 구조는 repository에 잔존
- `MIRROR_SOURCES` RP023은 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`를 계속 `from`으로 가짐

따라서 RTDB direct-open baseline 0 해소와 별개로 legacy writer ownership/disable 문제는 기존 판정 유지다.

### Claude 구현 Owner에게 넘기는 즉시 지시

1. Source Contract HOLD는 **해소됨**으로 닫는다. current production pin은 `2e880cef...`이다.
2. `settlement-sync.yml`이 여전히 옛 `sync-contract-from-ledger.mts`/`정산` 탭 경로를 호출하는 문제를 우선 정리한다. 새 `sync-vehicle-lock-from-ledger.mts`를 어디서 정규 실행할지 결정하고 Atom을 정본으로 유지한다.
3. collector semantics가 바뀐 `2e880cef...` 기준 정규 production F01/F86 full-audit 성공을 새로 확인한다.
4. 픽업구독 색은 기존처럼 `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 해결한다. `check:color-ssot` 잠금을 유지한다.
5. `mirror-sync.yml` / `sales-erp-hourly.yml` writer ownership/disable은 별도 미해소 항목으로 유지한다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16(17) — ChatGPT 독립 감사: current main legacy F01 writer가 production 7캐논/`오공구독` 계약과 실제로 갈림

### A. 충돌(신규/구체화) — production pin과 current main의 F01 상품구분·특수탭 계약이 서로 다름

**판정: same-output schema conflict / Claude 구현 Owner가 writer ownership을 우선 정리해야 함**

이번 감사가 읽은 application/code main 기준 HEAD는 `cb06553a08a4a596de51c52fa9d265bb05d1f322`(PR #326)이고, production pin은 계속 `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`다.

production pin `2e880cef...`:

- `lib/domain/sales-published-tabs.ts`의 canonical publish tabs = `상품리스트`, `오공구독`, `픽업구독`, `오플구독`
- 옛 `손오공구독`은 읽기 호환 alias이고 발행 시 `오공구독`으로 canonicalize
- `lib/intake/entities.ts`의 `PRODUCT_TYPES` = 7개(`신차렌트`, `중고렌트`, `신차구독`, `중고구독`, `오플구독`, `픽업구독`, `오공구독`)
- `손오공구독`/`손오공 구독`은 `오공구독` alias
- `category-colors.ts` + `check:color-ssot`가 7개 product type의 canonical 색 계약을 잠금

current main `cb06553...`:

- `lib/domain/sales-published-tabs.ts`의 publish tabs = `상품리스트`, **`손오공구독`**, `픽업구독`, `오플구독`
- production pin의 `canonicalSalesTabName()`이 없음
- `lib/intake/entities.ts`의 `PRODUCT_TYPES`가 5개(`신차렌트`, `중고렌트`, `신차구독`, `중고구독`, `픽업구독`)뿐이고 `오공구독`, `오플구독`이 canonical enum/alias에 없음
- `lib/domain/category-colors.ts`도 5개 상품구분 색만 가지며 `오공구독`, `오플구독`이 없음
- main `check:sync`에는 production pin의 `check:color-ssot` 잠금이 없고, `scripts/check-color-ssot.mts`도 current main에는 없음

단, current main `canonProductType()`은 모르는 구독 갈래를 임의로 `중고구독`으로 접지 않고 raw value를 보존한다. 따라서 위 enum 차이만으로 current guest UI가 반드시 오공/오플을 중고구독으로 오표시한다고 단정하지 않는다. 이번 finding은 **writer/projection contract 차이**에 한정한다.

### B. 충돌(운영 영향) — main legacy hourly writer가 production F01과 정확히 같은 Google Sheet를 old contract로 씀

current main `.github/workflows/sales-erp-hourly.yml`은:

- schedule `0 0-9 * * 1-5`
- schedule이면 `scripts/cloud-hourly-sync.mts --apply`

를 실행한다.

그 아래 current main `scripts/hourly-sync.mts`의 실제 F01 발행 step은:

- `publish-origin-tab.mts`로 `상품리스트`
- `publish-origin-tab.mts --only=RP012:구독 --tab=손오공구독 --at=1`
- 픽업구독
- 오플구독

을 발행한다.

current main `scripts/publish-origin-tab.mts`의 기본 F01 SHEET는:

- `1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs`

production pin `scripts/make-sample-sheet-google.mts --main`의 `SRC_SHEET`도 **정확히 같은 문서**:

- `1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs`

다.

production F01 writer는 `production-sheet-write-gate`를 통과해야 하지만 current main legacy `publish-origin-tab.mts`는 그 gate를 사용하지 않는다.

따라서 `sales-erp-hourly.yml`이 GitHub Actions UI에서 enabled라면 **production writer가 만든 `오공구독`/7캐논 계약의 같은 F01을 current main이 옛 `손오공구독` 계약으로 다시 쓸 수 있다.** 단순 cron 잔존보다 구체적인 탭 중복·구형 탭 재생성·서식/색 계약 drift 위험이다.

이번 감사에서는 UI enable/disable 상태를 독립 확정하지 못했으므로 실제 동시쓰기 사고가 이미 발생했다고 단정하지 않는다. repository 기준 `active-capable same-output writer conflict`로 판정한다.

### C. 정산 lock gap 정정 — 새 tool은 production pin에만 있고 current main에는 없음

`2026-09-16(16)`의 정산 lock gap은 유지하되 위치를 더 정확히 한다.

- `scripts/sync-vehicle-lock-from-ledger.mts`는 production pin `2e880cef...` 계보에 존재
- **current main에는 해당 파일이 없음**
- current main `.github/workflows/settlement-sync.yml`은 여전히 옛 `scripts/sync-contract-from-ledger.mts`를 호출
- `erp5-ssot-refresh.yml`에도 새 Atom-lock tool 실행 step은 없음

따라서 “정산원장 `접수` → Atom lock / `취소` → unlock”은 여전히 정규 scheduled operation으로 연결되지 않은 상태다.

### D. canonical source / mirror 판정은 변화 없음

current main canonical registry:

- RP006 = `ironrentcar.com`
- RP012 = `sokrc.com/api`
- RP023 = RebornCar

반면 `MIRROR_SOURCES` RP023은 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`를 계속 `from`으로 갖고, `mirror-sync.yml`은 repository-level fail-closed guard 없이 30분 schedule/`--apply` 경로를 유지한다.

mirror는 projection/legacy일 뿐 canonical inventory source가 아니다.

### E. recent main / CI

- audit가 읽은 app/code main: `cb06553...` (PR #326)
- 직전 `f4d57258...` main CI run `35073100855`: **success**
- `cb06553...` CI run `35073829492`: 감사 시점 **in_progress**
- PR #305/#326은 guest/customer presentation 변경이며 이번 F01 writer contract split을 직접 해소하는 변경은 아님

### 최종 판정

1. **신규 구체적 충돌:** production pin과 current main의 F01 특수탭/상품구분 contract가 다르다.
2. **운영 영향 있음:** main legacy hourly writer가 production과 같은 F01 spreadsheet에 old `손오공구독` contract로 쓸 수 있다.
3. **색 SSOT 잠금도 main에는 없음:** production의 7캐논 색 계약을 main legacy writer가 보장하지 못한다.
4. **정산 Atom-lock orchestration gap 유지:** 새 lock tool은 production pin에만 있고 current main scheduled path에는 미연결.
5. **canonical source 계약 변화 없음:** RP023 canonical은 RebornCar이며 old Google Sheet는 mirror/legacy다.
6. **current pin full-run HOLD 유지:** `2e880cef...`의 정규 production full-run 성공을 독립 확정하는 새 Actions 증거는 이번 감사에서 확인하지 못했다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-main-vs-production-f01-contract-drift.md`

### Claude 구현 Owner에게 넘기는 즉시 지시

1. `sales-erp-hourly.yml`을 단순히 “남아 있는 옛 workflow”로 보지 말고 **같은 F01을 old schema로 쓰는 writer**로 취급한다.
2. production F01 sole-writer 원칙을 repository 수준에서 강제한다. 구현 선택지는 legacy schedule 제거 / explicit fail-closed / production write gate 적용 / read-only consumer화 중 하나다.
3. current main이 앞으로 F01을 쓸 가능성을 남긴다면 `오공구독` + 7 canonical product types + canonical color map/lock을 production pin과 같은 계약으로 맞춘다. legacy writer를 retire한다면 old projection code가 운영에 재진입하지 못하도록 막는다.
4. **production 정본을 current main의 옛 `손오공구독`/5캐논 계약으로 되돌리지 않는다.**
5. 정산 lock scheduled orchestration gap과 mirror writer ownership도 기존 미해소 항목으로 유지한다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16(18) — ChatGPT 독립 감사: required checker drift + shared credential action runtime break + settlement scheduled failure

### A. 충돌(신규) — required `check:shop-data-parity`가 cache helper refactor를 이해하지 못해 current main CI가 red

**판정: checker-contract drift / 현재 증거만으로 데이터 경로 회귀로 단정하지 않음**

감사 시작 시 application/code main HEAD는 `1769d36cf0cda806f9f1b89561e637e62693b1ad`였다. current CI run `35077840002`의 required step `웹·모바일이 같은 Firestore 피드를 쓰는가`가 failure다.

`scripts/sim-shop-data-parity.mts`는 `lib/server/whitelabel-erp5-catalog.ts` 소스 안에 literal `collection('products')`, `collection('policy')`가 있어야 통과하도록 검사한다. 그러나 PR #329/#330의 60초 cache/inflight refactor 후 실제 reader는:

- `collection('products', 'products')`
- `collection('policies', 'policy')`
- helper 내부 `erp5Firestore().collection(name).get()`

형태로 같은 ERP5 Firestore collection을 읽는다.

따라서 현재 관측 failure는 **helper를 모르는 정적 regex checker drift**로 보는 것이 근거에 맞다. 이 사실만으로 guest/catalog가 ERP5 Firestore 이외 소스로 회귀했다고 단정하지 않는다. 다만 PR #327의 checker manifest가 이 검사를 required로 올렸기 때문에, checker를 실제 코드 구조에 맞추기 전까지 main CI가 red이고 해당 parity ratchet의 보증도 사용할 수 없다.

### B. 충돌(신규/운영) — 공통 credential composite action 자체가 GitHub Actions load 단계에서 깨짐

current `.github/actions/prepare-credentials/action.yml`의 input description에는 다음 문자열이 있다.

- `` `${{ secrets.GOOGLE_SA_JSON }}` ``

GitHub Actions는 composite action metadata의 이 표현도 해석하지만 그 위치에서는 `secrets` context를 허용하지 않는다. 실제 최신 관측 scheduled `계약중 표기(30분)` run `35067894061`은 checkout 이후 local action을 읽는 순간:

- `Unrecognized named-value: 'secrets'. Located expression: secrets.GOOGLE_SA_JSON`

로 failure했고 `mark-contract-in-listings.mts`는 실행되지 않았다. 이 shared action 도입 commit은 `330adaf32ccf3e69f67fc4a649cb5c03cabe5231`이다.

중요한 경계: 이것은 writer ownership이 안전하게 닫힌 것이 아니라 **writer가 우연히 실행 전 깨진 운영 회귀**다. repository에는 schedule/`--apply` 가능 경로가 그대로 있으므로 이를 governance retirement로 간주하지 않는다.

또 current generic CI의 `check:workflows`는 이 상태에서도 통과했다. 즉 현재 workflow checker는 local composite action metadata expression 유효성까지 검증하지 못한다는 coverage gap도 확인됐다.

### C. 충돌 유지 + 운영 증거 강화 — settlement scheduled 경로는 current ledger contract와 실제로 실패 중

latest observed scheduled `정산 접수 반영(1시간)` run `35056578656`은 legacy `scripts/sync-contract-from-ledger.mts` 단계까지 갔지만:

- `시트 "정산"을(를) 찾지 못했습니다.`

로 실패했다.

current `.github/workflows/settlement-sync.yml`은 여전히 이 옛 스크립트를 호출한다. 반면 current ledger contract는 `접수`, `취소`, `분납실적`, `완납실적`, `청구` 탭을 사용하며, production pin `2e880cef...`의 새 `scripts/sync-vehicle-lock-from-ledger.mts`는 `접수`/`취소`를 ERP5 Atom lock/unlock으로 해석하지만 scheduled orchestration에는 연결되지 않았다.

따라서 `(16)/(17)`의 settlement Atom-lock gap은 단순 코드 추론이 아니라 **실제 scheduled failure로 계속 재현되는 미해소 운영 충돌**이다.

### D. 기존 SSOT HOLD/충돌은 닫지 않음

이번 감사에서 다음을 해소하는 신규 근거는 없었다.

- production pin은 `2e880cefa96e3fa4bfc79902fed448d5bd74abdb` 유지
- current main의 legacy F01 projection은 여전히 `손오공구독`/5-product-type 계약, production pin은 `오공구독`/7-canonical/color-lock 계약 — `(17)` same-output conflict 유지
- current main `lib/domain/category-colors.ts`의 픽업구독은 계속 `#C2185B`
- `mirror-sync.yml`은 `*/30` schedule + schedule `--apply`, `sales-erp-hourly.yml`도 scheduled `--apply` 경로가 repository에 남아 있음
- canonical inventory source는 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar; RP023 old Google Sheet mirror는 canonical source가 아님
- `2e880cef...` current semantics 기준 정상 scheduled F01/F86 full-audit PASS는 이번 감사에서도 새로 독립 확정하지 못함

상세 증거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-ci-runtime-regressions.md`

### Claude 구현 Owner에게 넘기는 즉시 지시

1. `(17)`의 **same-output F01 writer/contract conflict를 최우선 SSOT ownership 문제로 계속 유지**한다. 우연한 schedule failure를 writer retirement로 착각하지 않는다.
2. `check:shop-data-parity`를 helper-mediated ERP5 Firestore 경로까지 의미적으로 검증하도록 고쳐 required ratchet을 다시 유효하게 만든다.
3. `.github/actions/prepare-credentials/action.yml`의 metadata runtime 오류를 고치고, local composite action도 실제 Actions parser 관점에서 검증하는 CI/정적 검사를 추가한다.
4. settlement scheduled path를 current ledger/ERP5 Atom lock 계약에 맞춰 정리하고 `접수` lock + `취소` unlock이 실제 scheduled run에서 성공하는지 확인한다.
5. production pin full-run, 픽업구독 canonical 색, mirror/RTDB legacy ownership HOLD는 직접 해소 증거가 생길 때까지 유지한다.

이번 ChatGPT 감사에서도 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-16(19) — ChatGPT 독립 감사: Claude entry point의 존재하지 않는 application SHA 정정, audit `(18)` 실질 판정 유지

### A. 충돌/정정 — `CLAUDE-AUDIT.md`가 존재하지 않는 application SHA를 최신 기준점으로 적고 있었음

**판정: 감사 entry-point drift / 구현계약 자체의 신규 회귀는 아님**

current main `7f942cb59bd0cf77838c31681aae18f1a81bc1a5`의 `CLAUDE-AUDIT.md`는 audit `(18)` 이후 application change를:

- `b7942ed59026041e29e21cbd80ec28b19da32840`

로 적고 있었다. GitHub commit 조회 결과 이 SHA는 `freepass-creator/freepasserp4`에 존재하지 않는다.

실제 PR #334 application commit은:

- `b794345499bbcbc467462dfd1e25a46bea42c6d9`

이다. 실제 diff는 `app/(shop)/shop/ShopView.tsx`, `app/(shop)/shop/page.tsx` 중심의 첫 화면 SSR/상품사진 preload UI 개선이며, SSOT source registry, production engine pin, F01/F86 writer, ERP5 collector, mirror topology, settlement orchestration, canonical product-type/color 계약을 변경하지 않는다.

따라서 Claude가 Git lineage를 재검증할 때 존재하지 않는 SHA를 따라가게 만드는 **감사 진입점 자체의 drift**는 정정하지만, audit `(18)`의 실질 SSOT finding은 그대로 유지한다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-entrypoint-sha-drift.md`

### B. 확인됨 — latest main CI red는 audit `(18)`과 동일한 checker-contract drift

latest observed main CI run `35080449988`도 **failure**다. 다만 실패 step은 audit `(18)`에서 이미 기록한 required `check:shop-data-parity` 하나이며, 원인도 동일하다.

- actual guest catalog reader는 helper를 거쳐 ERP5 Firestore를 읽음
- checker는 literal `collection('products')` / `collection('policy')` 형태를 요구해 helper refactor를 오탐함

같은 run에서 그 앞의 workflow/schedule checks와 `check:store`는 통과하며 RTDB direct-open baseline은 계속 0이다. 이번 재검수에서 새로운 SSOT implementation regression은 확인되지 않았다.

### C. 기존 미해소 항목은 그대로 유지

- production pin `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`
- production과 current-main legacy writer의 same-output F01 contract conflict
- 공통 credential composite action load-time failure
- settlement `접수/취소` → ERP5 Atom lock scheduled orchestration gap
- 픽업구독 canonical 색 `#C2185B`
- mirror/sales scheduled writer ownership
- current `2e880cef...` semantics의 정상 scheduled F01/F86 full-audit PASS 확인 HOLD

`CLAUDE-AUDIT.md`는 실제 PR #334 SHA로 정정하고 latest main이 audit 문서 계열임을 명시한다. 이번 감사에서도 애플리케이션 코드나 비즈니스 로직은 수정하지 않았다.

---

## 2026-09-16(20) — ChatGPT 독립 감사: 선언된 cron 대비 GitHub `schedule` event가 16:18 KST 이후 끊김

### A. 충돌(신규/운영) — repository cron과 실제 schedule dispatch가 장시간 불일치

**판정: schedule-delivery/enablement drift / 원인 미확정**

2026-09-16 21:36 KST 기준 GitHub Actions API의 `event=schedule&created=2026-09-16` 실행 기록은 하루 전체에 **4건뿐**이었다.

- 10:32:35 KST — `계약중 표기(30분)` run `35044497887` — success
- 12:46:35 KST — `ERP5 SSOT 원천 최신화(매시간)` run `35053074482` — success
- 13:41:34 KST — `정산 접수 반영(1시간)` run `35056578656` — failure
- 16:18:54 KST — `계약중 표기(30분)` run `35067894061` — failure

추가 API 조회에서도 2026-09-16 17:00 KST 이후 `schedule` run은 0건이었다. 즉 마지막 관측 schedule event 이후 약 5시간 17분 동안 새 scheduled run이 기록되지 않았다.

하지만 current main의 workflow 원문에는 여전히 다음 cron이 선언돼 있다.

- `.github/workflows/erp5-ssot-refresh.yml`: `5 0-10 * * 1-6`
- `.github/workflows/settlement-sync.yml`: `5 0-9 * * 1-6`
- `.github/workflows/sales-erp-hourly.yml`: `0 0-9 * * 1-5`
- `.github/workflows/mirror-sync.yml`: `*/30 * * * *`

수요일 기준 마지막 관측 run 뒤에도 ERP5 refresh 17:05/18:05/19:05 KST, settlement 17:05/18:05 KST, sales 17:00/18:00 KST, mirror 30분 주기의 다수 회차가 repository 선언상 기대된다. 그러나 실제 Actions run 목록에는 없다.

이번 감사 도구 범위에서는 각 workflow의 GitHub Actions UI enabled/disabled 상태나 GitHub scheduler 내부 지연/누락 원인을 직접 확정하지 못했다. 따라서 “workflow가 disabled됐다” 또는 “GitHub scheduler 장애다”라고 단정하지 않는다. 다만 **선언된 cadence대로 scheduled publisher/writer가 계속 실행 중이라는 운영 가정은 현재 실행 기록으로 뒷받침되지 않는다.**

### B. 기존 runtime failure와 구분 — 새 코드는 안 바뀌었지만 scheduled operation의 실행 증거가 끊김

current main의 애플리케이션/SSOT 구현은 audit `(19)` 이후 새로 바뀌지 않았다. latest main CI run `35085813150`의 failure도 audit `(18)/(19)`에서 이미 기록한 `check:shop-data-parity` checker-contract drift와 동일하다.

또 다음 기존 미해소 항목도 그대로다.

- 공통 credential composite action의 `${{ secrets.GOOGLE_SA_JSON }}` metadata 오류
- settlement의 옛 `sync-contract-from-ledger.mts` / `정산` 탭 scheduled failure
- production pin `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`
- production과 current-main legacy writer의 same-output F01 contract conflict
- 픽업구독 canonical 색 `#C2185B`
- `mirror-sync.yml`/`sales-erp-hourly.yml`의 write-capable cron 선언
- RP023 legacy mirror의 옛 Google Sheet `from`

새로운 점은 **그 scheduled workflow들이 실제로 dispatch되고 있다는 증거 자체가 끊겼다**는 것이다. 우발적인 미기동을 writer retirement나 SSOT 단일화로 해석하면 안 된다.

### C. Claude 구현 Owner에게 넘기는 즉시 지시

1. GitHub Actions에서 `erp5-ssot-refresh`, `settlement-sync`, `sales-erp-hourly`, `mirror-sync`, `contract-status` 각각의 실제 enabled/disabled 상태를 먼저 확인한다.
2. intentional disable이라면 repository cron/예약지도/writer ownership 계약을 그 상태와 맞춰 코드로 증명 가능하게 만든다.
3. intentional disable이 아니라면 schedule event 미발생 원인을 확인하고, 특히 production `2e880cef...`의 다음 정상 scheduled F01/F86 full-audit run을 확보한다.
4. schedule 미발생을 이유로 legacy writer ownership 문제를 `해소됨`으로 닫지 않는다.
5. application code/business logic 수정은 Claude 단일 구현 세션만 수행한다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-schedule-delivery-gap.md`

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-17(21) — ChatGPT 독립 감사: PR #337로 required parity checker drift 해소, main CI green 복구

### A. 해소됨 — `check:shop-data-parity`가 current helper 구조를 따라가도록 수정됨

**판정: audit `(18)~(20)`의 checker-contract drift 해소**

current application/checker main 기준점은 PR #337 merge commit:

- `7535c581245f89b2da95f910e05fead4d14a24e2`

PR #337은 `scripts/sim-shop-data-parity.mts` 한 파일만 수정했다. 기존 checker가 cache/helper refactor 이전 형태인 `collection('products')`, `collection('policy')`와 feed route 내부 직접 reader 호출을 요구하던 것을 current implementation에 맞춰 다음을 검증하도록 변경했다.

- `collection('products', 'products')`
- `collection('policies', 'policy')`
- `app/api/catalog/feed/route.ts`가 `loadGuestListing` 사용
- `lib/server/guest-listing.ts`가 `readWhitelabelCatalogFromErp5` 사용
- `includePartners: !!providerCode`, `includeUsers: !!share` 유지
- feed/listing 양쪽의 `firebaseAdminApp`, `firestore-ref-shim`, `.ref(` 직접 경로 금지 유지

즉 required ratchet을 제거하거나 느슨하게 만든 것이 아니라, helper 아래로 이동한 ERP5 Firestore 읽기 계약을 따라 검사 위치를 이동한 수정이다.

### B. 실제 CI 증거 — main red 해소

PR head `ff02d8f662e84290c949d1b3a3e1a2c388d9dacd`의 `verify` check는 success였다.

merge 뒤 main push CI:

- run `35117788232`
- head `7535c581245f89b2da95f910e05fead4d14a24e2`
- conclusion: **success**

job `104867526238`에서 다음 단계가 실제 success다.

- `RTDB 스왑점 밖 직접 열기`
- `웹·모바일이 같은 Firestore 피드를 쓰는가`
- `Production build`

따라서 `CLAUDE-AUDIT.md`의 기존 “latest main CI red / parity checker를 고쳐야 함” 요약은 stale였고 이번 감사에서 갱신했다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-17-chatgpt-parity-checker-resolution.md`

### C. schedule-delivery HOLD는 미해소 유지

2026-09-17 00:50 KST 근처에 `event=schedule` 기록을 다시 조회했지만 2026-09-16 실행은 여전히 4건뿐이며 마지막은 16:18:54 KST run `35067894061`이었다. repository cron 선언은 그대로다.

따라서 audit `(20)`의 schedule-delivery/enablement drift는 **미해소 유지**다. workflow disable인지 scheduler delivery 누락/지연인지 원인을 단정하지 않는다.

### D. 나머지 SSOT/운영 HOLD는 변화 없음

PR #337은 checker 파일 하나만 바꿨으므로 다음 기존 판정은 닫지 않는다.

- production pin `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`
- production과 current-main legacy writer의 same-output F01 contract conflict
- `.github/actions/prepare-credentials/action.yml`의 composite-action metadata `${{ secrets.GOOGLE_SA_JSON }}` 문제
- settlement `접수/취소` → ERP5 Atom lock scheduled orchestration gap
- 픽업구독 canonical 색 `#C2185B`
- `mirror-sync.yml` / `sales-erp-hourly.yml` write-capable cron 및 RP023 legacy mirror source
- `2e880cef...` current semantics 기준 정상 scheduled F01/F86 full-audit 확인 HOLD

canonical inventory source도 그대로다.

- RP006 = `ironrentcar.com`
- RP012 = `sokrc.com/api`
- RP023 = RebornCar

### Claude 구현 Owner에게 넘기는 즉시 지시

1. `check:shop-data-parity` checker drift는 **해소됨**으로 닫고 현재 ERP5 Firestore 의미 검사를 약화시키지 않는다.
2. schedule-delivery gap과 same-output F01 writer ownership을 우선 미해소 항목으로 유지한다.
3. credential composite action과 settlement Atom-lock scheduled orchestration을 실제 Actions 기준으로 고친다.
4. 픽업구독 색은 production `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 처리한다.
5. mirror/RTDB legacy 경로를 canonical source로 승격시키지 않는다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.

---

## 2026-09-17(22) — ChatGPT 독립 감사: production 특수탭 보증금 규칙이 main canonical deposit-policy SSOT를 우회

### A. 충돌(신규 발견) — production pin에 current main 보증금 정책 SSOT가 없음

**판정: Sonogong/AutoPlus special-tab projection contract drift / Claude 구현 Owner 확인 필요**

current main에는 `lib/domain/deposit-policy.ts`가 있고, commit `110bb75935688dc6b01d361d1e6dcac335e65b50`가 손오공/오토플러스 보증금 규칙을 한 곳으로 모았다. 이어 `aae377d048181f09edbeaa7546ae0afb71c09be4`가 제조사 미입력 오토플러스를 국산으로 추정하지 않도록 `undefined`로 fail-closed했고, `80a0d82317fc84b80dd7b5e7ff4d45426966e9b0`가 `sales-published-tabs.ts`가 이 SSOT를 소비하도록 바꿨다.

current main 계약:

- 손오공 `보증금 반납형`은 원본 문자열 복사가 아니라 `SONOGONG_DEPOSIT_POLICY.label` 발행
- 오토플러스는 `resolveAutoplusDepositPolicy(maker)?.label ?? ''`
- maker가 비어 있으면 정책 미확정으로 두고 국산 ×2를 추정하지 않음

반면 current production pin `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`에는 `lib/domain/deposit-policy.ts` 자체가 없다. production `lib/domain/sales-published-tabs.ts`는:

- `오공구독`의 `보증금 반납형`을 원본 special-tab block에서 계속 복사하고,
- AutoPlus 규칙을 로컬 하드코딩해 `isImportBrand(String(maker ?? '')) ? 수입규칙 : 국산규칙`으로 표시한다.

따라서 maker가 빈 문자열이면 production은 **`국산: 월 대여료×2`로 추정**하지만 current main canonical resolver는 **정책 미확정/빈 표시**다. 이 부분은 코드상 실제 의미 차이다.

`110bb759...` ↔ `2e880cef...` 비교도 `diverged`이고 merge-base는 `4bab085d30181612cbf47624a76006c57065dccd`라 production lineage가 main의 보증금 정책 centralization을 상속했다고 볼 수 없다.

### B. 범위 — 기존 source/tab/F86 판정을 뒤집는 것은 아님

- canonical inventory source는 계속 RP012=`sokrc.com/api`, RP023=RebornCar다.
- production 특수탭의 `오공구독 / 픽업구독 / 오플구독` naming과 F86 projection 계약은 기존 판정을 유지한다.
- 이번 finding은 특수탭 **보증금 정책 SSOT/표시 projection**에 한정한다.
- 손오공 원본 `보증금 반납형` 문자열이 현재 canonical 규칙과 실제 값까지 다른지는 이번 감사에서 단정하지 않는다. 다만 production projection이 canonical policy object에 잠겨 있지 않은 것은 확정이다.
- AutoPlus maker 누락 동작은 current main과 production이 명확히 다르다.

### C. 함께 재확인된 기존 상태

- latest main CI run `35127816502`는 success이며 `check:store`, Firestore parity, Production build가 모두 green이다.
- production pin은 계속 `2e880cef...`이다.
- `event=schedule` 최신 run은 여전히 2026-09-16 16:18:54 KST의 `35067894061`이라 audit `(20)/(21)`의 schedule gap은 미해소다.
- credential composite action, settlement Atom-lock, same-output F01 legacy writer, 픽업구독 색, mirror writer ownership HOLD도 해소 증거가 없다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-17-chatgpt-special-tab-deposit-policy-drift.md`

### Claude 구현 Owner에게 넘기는 즉시 지시

1. production lineage에 current main `deposit-policy.ts`의 canonical rules를 선택적으로 이식/병합하되 production의 7-canonical 상품구분, `오공구독` naming, F86, collector semantics를 되돌리지 않는다.
2. 손오공/오토플러스 adapter 및 special-tab publisher가 같은 deposit policy object/resolver를 소비하도록 정리한다.
3. 특히 AutoPlus maker 누락을 국산으로 추정하지 않는 current canonical fail-closed semantics를 current business rule 기준으로 확인하고 production publish/audit에서 검증한다.
4. 기존 schedule gap, same-output F01 writer, credential action, settlement Atom-lock, pickup color, mirror ownership HOLD는 별도로 유지한다.

이번 ChatGPT 감사에서는 application code나 business logic을 수정하지 않았다.

---

## 2026-09-17(23) — ChatGPT 독립 감사: ERP5 workflow disabled 확인 + settlement lock 배선 진전 + F86 freshness checker drift

### A. 확인됨 — audit `(20)~(22)`의 schedule-gap 원인이 적어도 ERP5 canonical workflow에 대해서는 좁혀짐

**판정: `ERP5 SSOT 원천 최신화(매시간)` workflow disabled 확인 / 다른 scheduled writer 상태는 별도 HOLD**

current main은 `392ebff47d30fdfea3e579bb66c7cc77565d8a9a`이고 main CI run `35165360527`은 success다. 다만 canonical workflow를 수동 dispatch하려 한 run `35164315681` / job `105021859423`은 GitHub API에서 정확히 다음 오류를 받았다.

`HTTP 422: Cannot trigger a 'workflow_dispatch' on a disabled workflow`

대상 workflow id는 `358276101`이며 `.github/workflows/erp5-ssot-refresh.yml`이다. 따라서 audit `(20)~(22)`의 “workflow disable인지 scheduler delivery 문제인지 원인 미확정” 중 **ERP5 refresh는 실제 disabled였음이 확정**됐다. 이 증거를 `settlement-sync`, `sales-erp-hourly`, `mirror-sync`까지 같은 상태였다고 일반화하지 않는다.

### B. 해소됨/진전 — canonical ERP5 refresh에 정산원장 `접수/취소` Atom lock step이 실제 배선됨

commit `276f37e33e26544bde0439f1c387a1a624a62138`은 current `.github/workflows/erp5-ssot-refresh.yml`에 다음 실행 step을 추가했다.

- schedule 또는 `apply=true`일 때 `scripts/sync-vehicle-lock-from-ledger.mts --apply`
- `접수` → ERP5 Atom 계약락
- `취소` → Atom 락 해제

이 commit의 `SSOT Source Contract` run `35164053755`는 success다. 따라서 audit `(16)~(22)`의 “새 Atom-lock tool이 canonical ERP5 refresh에 연결되지 않았다”는 부분은 **해소됨**으로 갱신한다.

단, `.github/workflows/settlement-sync.yml`의 옛 `sync-contract-from-ledger.mts` / `정산` 탭 경로가 별도로 남아 있는 문제까지 해소됐다는 뜻은 아니다. legacy settlement workflow의 ownership/retirement는 별도 미해소다.

### C. 충돌(신규) — 같은 production pin 안에서 F86 builder와 freshness 감사기가 서로 반대의 탭명 계약을 가짐

**판정: checker-contract drift / F86 데이터 발행 실패로 오인하면 안 됨**

production pin은 계속 `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`다. 이 pin의 `lib/server/channel-f86-plan.ts`는 현재 승인 규칙대로:

- `종합`만 `MM.DD HH:MM:SS · N대`
- 공급사 탭은 `회사 · N대`로 **시간 없이** 발행

하도록 `f86TabTitle()`을 구현한다.

그런데 같은 pin의 `scripts/audit-f86-vs-atom.mts` freshness 검사는 **모든 탭**에 `MM.DD HH:MM:SS · N대`가 있어야 한다는 regex를 적용하고, 공급사 탭에 시간이 없으면 failure를 추가한다.

실제 one-time full sync run `35165360537`에서 이 모순이 그대로 재현됐다.

- canonical source preflight: 24/24 success
- 실제 Atom 반영: 24/24 success
- settlement lock step: success
- policy reconcile: 1,592 products / 81 policies / dangling 0
- snapshot: 재고 695대
- public catalog: expected/actual 687대, hash 및 mismatch 0
- F01 publish: success, 695대
- F86 backup/publish: success, 19탭 / 695대 / 90열
- F86 칸 대조: **44,653칸, 값 어긋남 0**
- 그러나 공급사 탭 18개가 `회사 · N대`라서 “탭 이름에 발행 시각이 없다” 18건으로 audit step failure
- 그 결과 이후 Atom↔F01↔F86 cross-audit와 photo-link audit는 skipped

즉 이 run의 F86 failure는 **builder의 최신 탭명 계약을 freshness checker가 따라가지 못한 false positive**다. Claude 구현 Owner는 freshness를 `종합` timestamp 하나에서 판정하거나 plan의 timestamp contract를 공유하도록 고치되, 칸/차례/값 대조를 약화시키지 않는다.

### D. 충돌(신규 governance) — current main에 별도 write-capable one-time F01/F86 workflow가 남음

current main에는 `.github/workflows/manual-erp5-full-sync-once.yml`이 존재한다.

- 도입: `05a3b53540130873d38d175e032bc48055b31d1e`
- manual publish 승인 추가: `392ebff47d30fdfea3e579bb66c7cc77565d8a9a`
- production pin `2e880cef...`을 checkout해 source→Atom→snapshot→F01/F86을 직접 수행
- `FREEPASS_MANUAL_PUBLISH_APPROVED='2026-09-17 morning manual sync'`로 normal workflow-name allowlist 밖에서 운영 F01/F86 쓰기 gate를 연다

긴급 수동 발행 자체는 owner 승인 escape hatch 계약에 존재하지만, 이 workflow가 main에 상주하면 기존 `ERP5 SSOT 원천 최신화(매시간)` 외 **두 번째 production writer 진입점**이 된다. prior writer topology 문서에도 없던 신규 경로다. 감사자는 이를 애플리케이션 로직으로 확장하지 않고, Claude 단일 구현 Owner가 긴급 사용 후 retire/remove 또는 명시적 통제 경로로 정리할 대상으로 넘긴다.

### E. 기존 미해소 항목

이번 변경으로 아래를 닫지 않는다.

- production ↔ current-main legacy `sales-erp-hourly` same-output F01 contract conflict
- RP023 legacy mirror source / `mirror-sync` ownership
- composite credential action metadata `${{ secrets.GOOGLE_SA_JSON }}` parser 문제
- special-tab deposit-policy drift(audit `(22)`)
- 픽업구독 canonical 색 HOLD

### Claude 구현 Owner에게 넘기는 즉시 지시

1. canonical ERP5 workflow `358276101`의 intended enabled/disabled 상태를 운영 결정과 맞춘다. 자동 시동을 다시 켤 경우 current `2e880cef...` full path를 기준으로 검증한다.
2. `audit-f86-vs-atom.mts` freshness contract를 현재 `channel-f86-plan.ts` 탭명 규칙(종합만 시간)과 맞추고, same snapshot cross-audit/photo-audit까지 다시 green을 확보한다.
3. `manual-erp5-full-sync-once.yml`은 긴급 회차 후 permanent second writer가 되지 않게 retire/remove 또는 명시적 통제 방식으로 정리한다.
4. canonical refresh에 settlement Atom-lock 배선은 **해소됨**으로 취급하되 legacy `settlement-sync.yml`은 별도 정리한다.
5. audit `(22)` deposit-policy, legacy F01/mirror, credential action, pickup color HOLD는 직접 해소 증거가 생길 때까지 유지한다.

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다. 감사 문서와 Claude entry point만 갱신한다.



---

## 2026-09-17(24) — ChatGPT 독립 감사: production `6a6f3f75...` 전진 + stale emergency F01/F86 writer

**판정: 의미 있는 implementation change + same-output writer drift.**

- canonical `.github/workflows/erp5-ssot-refresh.yml` production pin은 PR #340 merge `7203c0ee703475f9f55cedf4c4d1034432d4069a`에서 `6a6f3f75c065143ad14286d08baa28e382535eea`로 전진했다. `2e880cef...`의 직계 전진 2커밋이며 Source Contract run `35168129260`과 verify run `35168129290`은 success다.
- 새 production engine은 차량가격 빈칸 `미입력`, 손오공 보증금 숫자 제거 + 규칙글자 보존, `depositRuleViolations` publication gate를 추가했다.
- 그러나 `.github/workflows/manual-erp5-full-sync-once.yml`은 아직 옛 `2e880cefa...`를 checkout해 동일 F01/F86을 직접 쓴다. audit (23)의 second writer가 이제 **canonical보다 뒤처진 stale-engine writer**가 됐다. 다시 트리거되면 새 보증금/미입력/gate semantics 없는 옛 engine으로 같은 output을 덮을 수 있다.
- audit (22) special-tab deposit-policy drift는 미해소다. current main은 `deposit-policy.ts` canonical object/resolver를 쓰지만 active production `6a6f3f75...`에는 그 파일이 없고 별도 Sonogong rule text/AutoPlus fallback을 사용한다. main은 AutoPlus maker blank를 fail-closed하지만 production은 국산 fallback한다. current main `inventory-contract.ts`에도 production의 `depositRuleViolations` gate가 아직 없다.
- audit (23) F86 freshness checker drift도 유지된다. plan은 `종합`만 timestamp를 붙이지만 checker는 여전히 모든 공급사 탭에 timestamp를 요구한다.
- canonical source는 RP006=ironrentcar.com, RP012=sokrc.com/api, RP023=RebornCar로 유지. legacy sales/mirror/settlement/credential/pickup-color HOLD도 해소 증거가 없다.

Claude 구현 Owner 우선순위: stale one-time writer retire/remove 또는 canonical engine과 동일 계약으로 통제 → production deposit gate를 main canonical deposit-policy와 단일화 → F86 freshness checker contract 정렬. application/business logic은 이번 감사에서 수정하지 않았다.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-production-6a6-emergency-writer-drift.md` (evidence commit `6b33cd420d0bab681bd4c0e521a19173a9ccc640`).


---

## 2026-09-17(25) — ChatGPT 독립 감사: audit (24) 동시변경 정정 + F86 emergency writer 현행화

**판정: audit (24)의 stale-engine/F01 writer finding은 동시 구현으로 해소됨. 별도 F86 publish failure는 OPEN.**

- audit (24) 작성 중 commit `78df24bb8d24a9bb85755cdaa2bc3e52c4c40704`가 `.github/workflows/manual-erp5-full-sync-once.yml`을 바꿨다. checkout은 옛 `2e880cef...`가 아니라 canonical production `6a6f3f75c065143ad14286d08baa28e382535eea`가 됐고, source/Atom/F01 writer 단계는 제거되어 **F86-only**가 됐다. 따라서 audit (24)의 “old pin으로 F01/F86을 다시 쓸 수 있다”는 문구는 현재 사실이 아니다.
- commit `335d8e19a90ff30e93cb80f544cc8ea5c8fe6cde`는 `erp5-inventory-publish` concurrency를 `cancel-in-progress: true`로 바꿔 뒤의 validated F86 publish가 앞선 in-progress 회차를 supersede하게 했다.
- run `35169013858`은 `Capture current ERP5 snapshot and enforce deposit-rule gate`에서 실패해 F86 write 전에 멈췄다. stderr를 독립 확보하지 못했으므로 원인을 deposit violation이라고 단정하지 않는다.
- commit `0c6ac135027298a9d79a4b7f673ddbd3762a828e`가 `heal-sonokong-deposit-ssot.mts --apply`를 gate 앞에 추가했다. 그 뒤 run `35169123131`에서는 heal=success, snapshot/deposit gate=success, F86 backup=success까지 갔지만 **`Publish F86 from validated snapshot`이 failure**였고 audit은 skipped됐다. 따라서 현재 OPEN은 stale engine이 아니라 **validated snapshot을 만든 뒤 F86 실제 publish가 완료되지 않는 운영 실패**다.
- current one-time workflow는 self-file push trigger, same-pin `6a6f3f75...`, Sonogong heal + deposit gate, F86-only write, `FREEPASS_MANUAL_PUBLISH_APPROVED`, F86 audit `continue-on-error: true` 구조다. canonical `erp5-ssot-refresh.yml`이 disabled인 동안 상시 대체 writer로 키우지 말고 성공 회차 확보 후 retire/remove 또는 명시적 ownership으로 정리한다.
- audit (22) special-tab deposit-policy 이중정의와 audit (23) F86 freshness checker contract drift는 여전히 미해소다. production의 `depositRuleViolations` gate도 current main `inventory-contract.ts`에는 아직 없다. legacy sales/mirror/settlement/credential/RP023 mirror/pickup-color HOLD도 유지한다.

Claude 구현 Owner 우선순위: (1) run `35169123131`의 F86 publish failure 실제 로그 원인 확인 및 정상 publish+audit 증명, (2) one-time writer retire/remove/ownership 정리, (3) production deposit gate를 main canonical deposit-policy와 단일화, (4) F86 freshness checker contract 정렬.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit24-concurrent-f86-writer-correction.md` (evidence commit `0c48501e5263f2bd5769355b225d9da5ba4190cd`).

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.


---

## 2026-09-17(26) — ChatGPT 독립 감사: F86 publish failure 원인 확정 — 보증금 SSOT는 정상, values A1 addressing에서 400

**판정: audit (25)의 원인 미확정 OPEN을 구체화. 손오공 보증금 SSOT/gate는 정상이며, 현재 blocker는 validated F86의 values write-addressing runtime failure다.**

- Actions run `35169123131`, job `105036728879`의 전체 로그를 독립 재확인했다. checkout은 production pin `6a6f3f75c065143ad14286d08baa28e382535eea`다.
- Sonogong heal 결과는 **RP012 692대 중 고칠 차 0대**, `보증금 숫자가 남은 차 0대`, `규칙 글자가 다른 차 0대`였다. live Atom의 규칙 글자 정본은 `월 대여료 × 약정연수 (최대 3개월)`이며, 따라서 이번 failure를 deposit-rule regression으로 보면 안 된다.
- 같은 run의 snapshot/deposit publication gate는 **PASS**했다. snapshot `20260917010511539-16123390d345`, 등록 1,615 / 출고불가 861 / 현재 재고 754. F86 backup도 PASS했다.
- F86 plan은 754대(`상품리스트 391 · 오공구독 51 · 픽업구독 251 · 오플구독 61`)를 만들고 locked-format 검사와 수동 production-write approval까지 통과했다.
- 실제 실패 지점은 `scripts/build-channel-supplier-sheet.mts`의 `values:batchUpdate`다. 정확한 Google Sheets 오류는 **HTTP 400 `INVALID_ARGUMENT`: `Invalid data[0]: Unable to parse range: '종합 09.17 10:05:11 · 391대'!A1`** 이다. 그 결과 F86 audit은 skipped됐다.
- production builder는 탭의 structural/format `batchUpdate`를 먼저 보내고, 이후 동적 `title` 문자열로 `'<title>'!A1` range를 만들어 values batch를 보낸다. 따라서 Claude 구현 Owner가 고칠 대상은 **F86 summary/tab A1 addressing과 write ordering/원자성**이며, deposit gate를 완화하거나 되돌리는 것이 아니다.
- 운영 F86 불변 ID `1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg`를 read-only로 확인한 현재 summary tab은 `종합 09.17 10:05:01 · 391대`이고 A1:H5가 정상 데이터로 채워져 있다. 실패 run이 시도한 `10:05:11` title은 live에 남아 있지 않으므로, 이번 증거만으로 failed run이 live sheet를 blank/corrupt했다고 단정하지 않는다. 다만 validated `10:05:11` snapshot이 정상 publish+audit까지 완료되지 않은 것은 확정이다.
- audit (22)의 main-vs-production deposit-policy 이중정의, audit (23)의 F86 freshness checker contract drift, canonical ERP5 workflow disabled, one-time F86 writer ownership, legacy sales/mirror/settlement/credential/RP023 mirror/pickup-color HOLD는 직접 해소 증거가 없어 유지한다.

Claude 구현 Owner 우선순위: (1) F86 summary/tab values range addressing 및 structural-before-values 비원자성 정리, (2) backup → publish → F86 audit/cross-audit까지 green 증명, (3) 성공 후 one-time writer retire/remove 또는 명시적 ownership 정리. **보증금 gate는 유지한다.**

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit26-f86-range-addressing.md`.

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
