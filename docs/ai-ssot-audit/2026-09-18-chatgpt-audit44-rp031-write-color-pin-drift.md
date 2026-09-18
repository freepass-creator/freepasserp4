# ChatGPT 독립 SSOT 감사 (44) — RP031 canonical write + 상품구분 색 production-pin drift

- 날짜: 2026-09-18 KST
- 역할: 독립 auditor. application/business logic 비수정.
- 비교 기준: audit (43) 기록 commit `38f04df6b6e6f4077b17277d64f8de2589741d06` → 관측 main `e8956bcac84e87f8bcf4a0b3b212119c7642be8c`.
- production pin: `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60` 유지.

## 1. audit (43) 이후 main 변화 범위

`38f04df...` → `e8956bca...` compare는 4 commits / 4 files만 변경한다.

- `.github/workflows/diag-ianka-collector.yml` — RP031 collector에 `apply` 입력과 `--쓰기` 경로 추가.
- `ianka/scripts/이안카-재고시트.mjs` — valid lease taskId 보정.
- `lib/domain/category-colors.ts` — `신차렌트 #B81A8C → #FF00FF`.
- `.github/actions/prepare-credentials/action.yml` — composite-action description 안의 잘못된 literal secrets expression 제거.

이 구간에서 `erp5-ssot-refresh.yml`, ERP5 canonical source registry, F01/F86 publisher 핵심 경로, Sonogong/AutoPlus special-tab routing, mirror/sales/RTDB core workflow 자체는 변경되지 않았다.

## 2. RP031 — HOLD 중 canonical source Sheet에 실제 write 발생

PR #404가 이안카 API inventory + rendered-DOM finance bootstrap을 기존 RP031 Google Sheet에 합치는 feeder를 만들었고, PR #405가 `--쓰기`를 막던 invalid taskId를 수정했다.

성공 run `35301987039`(head `9ce3bb6815d09c9bc2b9158183b9b4839c835e68`)의 raw job log는 다음을 확인한다.

- workflow input 분기: `if [ "true" = "true" ]; then node ianka/scripts/이안카-재고시트.mjs --쓰기`.
- API inventory: 82대, 기존 Sheet 차량번호 행 16대.
- 교집합 13대, API-only 69대, Sheet-only 보존 3대 → 최종 **85행**.
- rendered-DOM 요금표: 27모델.
- blank-only finance fill: **53행 · 389칸**.
- write 직전 backup 생성 로그가 있고 최종 `✅ 이안카 ← 85행`.

현재 `이안카-재고시트.mjs --쓰기`는 기존 RP031 data range(A2~)를 clear하고 최종 allRows를 다시 쓰는 full-sheet writer다. `inventory-source-registry.ts`는 RP031을 계속 `google_sheet` canonical source로 지정한다. 따라서 DOM finance를 “부트스트랩, SSOT 아님”이라고 주석 처리했더라도, 실행 결과는 canonical source Sheet 내부로 들어갔다.

**감사 판정:** audit (42)/(43)의 identity/finance provenance HOLD가 운영상 crossing 됐다. 이는 API가 canonical로 승격됐다는 뜻은 아니다. 오히려 registered canonical Sheet가 feeder 산출물을 포함하게 되었으므로, Claude는 write 전 backup ↔ 현재 live Sheet diff를 기준으로 389칸의 출처와 deterministic model/plate/term/deposit mapping을 증명해야 한다. 검증 전 DOM-derived 값 자체를 authoritative finance SSOT로 승격하면 안 된다.

## 3. 상품구분 색 — live repaint 성공, 그러나 durable하지 않음

PR #406 merge `ae41fb87bf9e4028ea207c6822e88f014ec50810`은 `MASTER_CATEGORY_COLORS['분류']['신차렌트']`를 `#B81A8C`에서 기존 판매시트의 밝은 분홍 `#FF00FF`로 되돌렸다.

첫 repaint run `35302572900`은 old composite-action metadata parser 문제 때문에 실패했다. PR #407 merge `e8956bcac84e87f8bcf4a0b3b212119c7642be8c`은 `.github/actions/prepare-credentials/action.yml` description의 literal secrets expression을 제거했다.

그 직후 repaint run `35302940384`은 input `apply=true`로 실행됐다. raw log는 `prepare-credentials` success, `npx tsx scripts/repaint-type-chip-colors.mts --apply`, 손오공 `렌트재고/구독재고/픽업재고`, 오토플러스 `재고`, 이안카 `재고` 등을 포함한 **27개 탭 반영**, job success를 확인한다. 따라서 audit (18)의 composite action `Unrecognized named-value: secrets` 로딩 오류는 적어도 이 동일 action 소비 경로에서 해소됐다.

하지만 canonical `erp5-ssot-refresh.yml`은 여전히 pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`을 checkout한다. 해당 pin의 `lib/domain/category-colors.ts`에는 `신차렌트: #B81A8C`가 남아 있고 current main은 `#FF00FF`다. `sales-sheet-format.ts`는 `MASTER_CATEGORY_COLORS`를 import한다.

**감사 판정:** 지금 27개 공급사 탭의 live repaint는 성공했지만 색 SSOT lineage는 OPEN이다. audit (43)의 schedule delivery가 복구되고 production pin publisher가 다시 F01/F86 발행/서식을 재생성하면 old `#B81A8C`가 재출현할 위험이 있다. `#FF00FF` 수정을 production engine lineage에 보존하고 실제 full publish 후 재역전이 없는 것을 확인하기 전에는 색 문제를 CLOSED 처리하지 않는다.

## 4. 기존 OPEN/HOLD 재검증

- repository-wide 최신 `event=schedule`은 여전히 `35235961510`(2026-09-17 23:47:38 KST). audit (43) schedule-delivery OPEN 유지.
- audit (35) F86 freshness checker drift 유지.
- audit (27) Sonogong deposit recurrence, audit (28) vehicle price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics 유지.
- Sonogong/AutoPlus special-tab 분리 규칙 변경 없음.
- mirror/sales/settlement/RTDB legacy writer HOLD 변경 없음.

## Claude 구현 owner 우선순위

1. RP031 write 전 backup을 기준으로 current Sheet와 diff하여 DOM-derived 389칸 및 신규 69대의 identity/finance provenance를 확정한다. provenance가 증명되지 않은 값은 canonical authority로 승격하지 않는다.
2. `신차렌트=#FF00FF`를 production-pinned publisher lineage에도 반영/보존한다. 단순 one-time repaint가 아니라 full F01/F86 publish 뒤에도 FF00FF가 유지됨을 증명한다.
3. schedule delivery와 F86 freshness checker는 별도 OPEN으로 계속 추적한다.
4. 그 외 기존 audit HOLD는 별도 해소 증거가 생길 때까지 유지한다.

이 감사에서 application code/business logic은 수정하지 않았다.
