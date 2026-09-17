# ChatGPT 독립 SSOT 감사 — audit (35) override (2026-09-18 KST)

> 이 파일은 Claude 구현 Owner의 **최신 진입점 요약**이다. 과거 판정과 상세 증거는 `docs/AI-SSOT-AUDIT-LOG.md`와 최신 `docs/ai-ssot-audit/` 문서를 우선한다. 실제 application/business logic 수정은 Claude 단일 SSOT 세션만 수행한다.

## 현재 판정

- **schedule delivery 재출현:** audit (31)/(34) 당시 2026-09-17 `event=schedule` 0건이었으나 canonical `ERP5 SSOT 원천 최신화(매시간)` run **`35235961510`**이 실제 `event=schedule`로 생성됐다. 따라서 “schedule event 자체가 없다”는 요약은 stale이다.
- **cadence/timeliness는 여전히 HOLD:** 이 run은 2026-09-17 **23:47 KST**에 시작했다. workflow cron은 월~토 KST 09:05~19:05이므로 당일 마지막 선언 slot보다 4시간 42분 이상 늦다. 한 회차 출현만으로 hourly 정시 운용 정상화를 선언하지 않는다.
- **canonical write path는 실제 동작:** production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`에서 supplier preflight/apply 24/24, settlement Atom-lock, snapshot, public catalog, F01 694대, F86 19탭/694대 발행까지 성공했다.
- **현재 scheduled blocker = F86 freshness checker:** F86 값 대조는 45,186칸 mismatch 0이고 freshness 계산도 가장 오래된 탭 0분이었지만, checker가 current tab-name 계약을 이해하지 못해 19개 탭 전부 “발행 시각 없음”으로 실패시켰다. Atom↔F01↔F86 cross-audit와 photo-link는 모두 mismatch 0이다. 따라서 run red는 데이터 발행 실패가 아니라 audit (23)/(30)의 checker-contract drift다.
- audit (34)의 observability HOLD도 유지한다. `/shop` freshness accessor는 여전히 newest Atom semantics이며, scheduled run이 한 번 생겼다고 전체 inventory/snapshot freshness sentinel이 되는 것은 아니다.
- audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming migration, audit (33) RP031 API feeder/provenance, mirror/sales/settlement/RTDB legacy writer ownership HOLD는 이 한 회차로 닫지 않는다.
- canonical source는 계속 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar다. RP031은 아직 Google Sheet canonical이다.
- audit 직전 application 기준 main은 `c6f6c3e0253e6d6f172ce52067d7261358b3e4a9`; production pin은 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`으로 변화 없다.

## Claude 구현 Owner 우선순위

1. `audit-f86-vs-atom.mts` freshness 판단을 `channel-f86-plan`의 실제 탭명 계약(종합에만 시각, 공급사 탭은 회사명+대수)과 공유/정렬한다. **차량/칸 값 대조는 약화하지 않는다.**
2. 수정 뒤 실제 `event=schedule` 회차에서 source→Atom→snapshot→public/F01/F86→F86 audit→cross-audit→photo-audit 전체 green을 확보한다.
3. schedule cadence 정상화는 선언된 시간대에 scheduled run이 지속 생성되는 별도 증거로 판정한다. workflow_dispatch/one-time run으로 대체하지 않는다.
4. audit (27)/(28)/(29)/(33)/(34)와 legacy writer ownership은 각각의 promotion/runtime 증거가 생길 때만 닫는다.
5. production pin/current main을 같은 계보라고 가정하지 말고 항상 별도로 대조한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — 최신 audit (35)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit35-scheduled-delivery-f86-checker.md`
- GitHub Actions scheduled run `35235961510`, job `105251799335`

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
