# 2026-09-17 ChatGPT 독립 SSOT 감사 — audit (34)

## 판정

**개선됨 + 신규 observability HOLD.** PR #375는 손님 화면의 재고 갱신 시각을 ERP4의 별도 status/pipeline 기록에서 실제 화면이 소비하는 ERP5 `products` Atom 시각으로 옮겼다. source alignment 자체는 올바른 방향이다. 다만 현재 구현은 "재고 전체/발행 snapshot이 언제 것인가"가 아니라 **어느 한 Atom이 가장 최근에 쓰인 시각**만 반환한다. 이 값을 canonical scheduled full-run freshness의 증거로 사용하면 안 된다.

## 근거

### 1. audit (33) 이후 core SSOT 변경은 없고 freshness/diagnostic만 추가

`docs/AI-SSOT-AUDIT-LOG.md` audit (33) commit `5d2450f1cfe4a99aa9c0ce9cbebc7902b7a1df01` 이후 current main `8b7a417578e6e2b2b2fac673588cf1b0db9e59a9`까지 3 commits / 8 files가 바뀌었다.

- PR #372 — Ianka read-only vehicle-detail diagnostic
- PR #373 — ERP5 Atom freshness diagnostic
- PR #375 — shop header freshness source 변경

production workflow pin, canonical inventory registry, F01/F86 publisher, Sonogong/AutoPlus special-tab writer, mirror/RTDB writer topology는 이 delta에서 바뀌지 않았다.

### 2. PR #375의 source alignment는 개선

current `lib/server/whitelabel-erp5-catalog.ts`의 `readErp5StockFreshness()`는 ERP5 `products`에서 `_direct_ingest_at`, `_var_polled_at`을 직접 읽는다. `app/api/shop/status/route.ts`는 이 Atom 시각이 하나라도 있으면 옛 ERP4 `sheet_daily_sync` / `ops/pipeline` 기록과 섞지 않고 즉시 반환한다.

따라서 이전처럼 **화면 재고는 ERP5인데 갱신시각은 ERP4 별도 파이프라인을 보는 source split**은 이 UI 경로에서 해소됐다. ERP4 fallback은 cutover OFF / 색인 없음 / Atom timestamp read 실패 때만 남는다.

### 3. 신규 HOLD — 구현은 newest single-Atom timestamp이지 inventory freshness가 아님

`readErp5StockFreshness()`는 두 필드 각각에 대해:

- `orderBy(field, 'desc').limit(1)`
- 두 결과 중 `Math.max(...)`

만 계산한다. 즉 1,615개 전체 Atom의 상태를 보는 게 아니라 **가장 최근 timestamp를 가진 문서 최대 2개**만 본다.

반면 같은 PR 계보의 `scripts/diag-erp5-atom-freshness.mts`는 전수 Atom을 읽어 다음을 별도로 계산한다.

- timestamp field별 보유 문서 수
- newest / median / oldest
- timestamp 없는 문서
- >3h / >12h / >24h / >72h stale 분포

PR #375 commit 기록 자체도 `_direct_ingest_at` 1,153대, `_var_polled_at` 897대라고 적는다. 전체 운영 Atom 1,615대에 비해 어느 한 timestamp field의 coverage가 100%가 아니다. 따라서 newest 한 건이 09-17 10:04라고 해서 **현재 표시 중인 재고 전체가 10:04 기준으로 수집·검증·발행됐다는 뜻은 아니다.**

### 4. canonical schedule gap은 그대로이며 newest Atom time으로 덮으면 안 됨

2026-09-17 GitHub Actions `event=schedule` 조회는 계속 0건이다. current canonical `.github/workflows/erp5-ssot-refresh.yml`은 월~토 KST 09:05~19:05 cron과 production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`을 선언하지만 실제 scheduled source→Atom→snapshot→F01/F86 회차 증거는 없다.

PR #375 commit도 09-17 10:04 Atom 쓰기는 GitHub Actions 기록이 없는 **수동 실행**이라고 명시한다. 따라서 새 머리띠가 10:04를 표시해도 audit (31)의 schedule-delivery OPEN은 해소되지 않는다.

특히 부분 ingest나 한 공급사/일부 Atom 수동 갱신만 있어도 newest timestamp는 앞으로 이동할 수 있다. 이 값은 "최신 Atom write" 관측에는 유효하지만 **canonical full-run freshness / inventory cohort completeness / F01/F86 발행 freshness**를 증명하지 않는다.

## current production/SSOT 판정

- active production pin: `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60` 유지.
- canonical source: RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar 유지. RP031은 아직 Google Sheet canonical이며 audit (33) feeder/parity HOLD 유지.
- audit (23) F86 freshness checker contract drift 유지.
- audit (27) Sonogong deposit recurrence guard 미승계 유지.
- audit (28) vehicle-price semantics 미승계 유지.
- audit (29) sales-tab naming staged migration 유지.
- mirror/sales/settlement/RTDB legacy ownership HOLD 유지.

## Claude 구현 Owner 인계

1. **ERP5 Atom을 freshness source로 쓰는 방향은 유지한다.** ERP4 status/pipeline timestamp로 되돌리거나 두 계열을 `max()`로 섞지 않는다.
2. 현재 머리띠를 그대로 유지하려면 의미를 `가장 최근 원자 갱신`으로 명확히 제한한다. "재고 전체가 이 시각 기준"으로 해석하지 않는다.
3. 실제 재고 freshness를 보여주려면 newest 1건이 아니라 최소 coverage + stale distribution 또는 검증된 canonical run/snapshot sentinel을 함께 사용한다. 어떤 방식이든 source→Atom→snapshot→F01/F86의 성공 회차와 연결돼야 한다.
4. audit (31)은 실제 `event=schedule` full-run이 생기기 전까지 OPEN 유지한다. 수동 Atom write/header timestamp를 scheduled recovery 증거로 사용하지 않는다.
5. application/business logic 구현은 Claude 단일 SSOT 세션만 수행한다.

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
