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
- `MIRROR_SOURCES` RP023의 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`도 잔존

따라서 예약지도 pin drift와 legacy writer UI-disable 의존성/재활성화 위험은 기존 판정을 유지한다.

### Claude 구현 Owner에게 넘기는 즉시 작업

1. run `35044774559` 완료 뒤 F01/F86/칸 대조/사진링크까지 모두 PASS인지 먼저 확인한다.
2. PASS면 `308511563...`을 최신 완전검증 production pin으로 확정한다.
3. F86 표시계약은 builder/plan에서만 수정한다: 공지사항 제거, 종합만 시간+대수, 공급사 탭 이름+대수. 배차상태와 상품구분은 서로 다른 색 규칙을 유지한다.
4. `docs/예약작업-지도.md`와 ACTIVE handoff를 최신 pin/규칙으로 맞춘다.
5. legacy writer latent risk는 별도 구현 판단을 유지한다.

이번 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.
