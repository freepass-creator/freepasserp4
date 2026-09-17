# ChatGPT 독립 SSOT 감사 — audit (34) override (2026-09-17 23:22 KST)

> 이 파일은 Claude 구현 Owner의 **최신 진입점 요약**이다. 과거 판정과 상세 증거는 `docs/AI-SSOT-AUDIT-LOG.md`와 최신 `docs/ai-ssot-audit/` 문서를 우선한다. 실제 application/business logic 수정은 Claude 단일 SSOT 세션만 수행한다.

## 현재 판정

- **freshness source alignment 개선:** PR #375 / merge `8b7a417578e6e2b2b2fac673588cf1b0db9e59a9`가 `/shop`의 갱신시각을 ERP4 별도 status/pipeline 기록이 아니라 실제 화면 재고가 읽는 ERP5 `products` Atom의 `_direct_ingest_at` / `_var_polled_at`에서 읽도록 바꿨다. 화면 데이터와 시각 source가 갈리던 문제는 이 UI 경로에서 개선됐다.
- **신규 observability HOLD:** current `readErp5StockFreshness()`는 두 timestamp field 각각 `orderBy(..., 'desc').limit(1)` 한 문서만 읽고 둘 중 최대값을 반환한다. 이는 **가장 최근 Atom write 시각**이지 전체 inventory cohort, publication snapshot, canonical full-run 또는 F01/F86 freshness가 아니다. 일부 공급사/일부 Atom만 갱신돼도 시각은 앞으로 갈 수 있다.
- PR #375 기록상 운영 Atom 1,615대 중 `_direct_ingest_at` 보유 1,153대, `_var_polled_at` 보유 897대다. 전체 재고 freshness를 말하려면 coverage/stale distribution 또는 검증된 canonical run/snapshot sentinel이 별도로 필요하다.
- canonical `.github/workflows/erp5-ssot-refresh.yml`은 계속 월~토 KST 09:05~19:05 cron과 production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`을 선언한다. PR #375 자체 기록도 2026-09-16 12:46 KST 이후 예약 실행 부재와 2026-09-17 10:04 Atom write가 GitHub Actions 기록 없는 수동 실행임을 명시한다. **audit (31) schedule-delivery OPEN은 유지한다.**
- audit (33)의 RP031 status mapping/feeder 진전은 유지하지만 RP031 canonical은 아직 Google Sheet이며 85 API ↔ 16 기존 sheet parity, 신규 차량 금융값 provenance promotion HOLD를 닫지 않는다.
- audit (23) F86 freshness checker contract drift, audit (27) Sonogong deposit recurrence guard, audit (28) vehicle-price lineage gap, audit (29) sales-tab naming migration, mirror/sales/settlement/RTDB legacy writer ownership HOLD도 직접 해소 증거가 없어 유지한다.
- canonical source는 계속 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar다. RP031은 아직 Google Sheet canonical이다.

## Claude 구현 Owner 우선순위

1. ERP5 Atom을 freshness source로 쓰는 방향은 유지하고 ERP4 status timestamp와 다시 섞지 않는다.
2. 현 머리띠 의미는 `가장 최근 원자 갱신`으로 제한한다. 전체 재고 freshness로 표현하려면 coverage/stale distribution 또는 canonical run/snapshot sentinel을 함께 사용한다.
3. 실제 `event=schedule` source→Atom→snapshot→F01/F86 full-run이 생성되고 audit까지 green이 되기 전에는 audit (31)을 닫지 않는다.
4. RP031/API feeder, deposit recurrence, vehicle-price, F86 checker, sales-tab migration 및 legacy writer ownership은 각각의 promotion/runtime 증거가 생길 때만 닫는다.
5. production pin/current main을 같은 계보라고 가정하지 말고 항상 별도로 대조한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — 최신 audit (34)
- `docs/ai-ssot-audit/2026-09-17-chatgpt-audit34-erp5-freshness-observability-gap.md`
- evidence commit: `0f359c8b48d89f3f5ed7b579a540db9882561716`

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
