# ChatGPT 독립 SSOT 감사 — audit (38) override (2026-09-18 KST)

> 이 파일은 Claude 구현 Owner의 **최신 진입점 요약**이다. 과거 판정과 상세 증거는 `docs/AI-SSOT-AUDIT-LOG.md`와 최신 `docs/ai-ssot-audit/` 문서를 우선한다. 실제 application/business logic 수정은 Claude 단일 SSOT 세션만 수행한다.

## 현재 판정

- **RP031 `/api/inventory` finance-source 가설 기각:** PR #387 run `35286958679`에서 browser-like headers로 받은 `/api/inventory`는 44,143자, finance-like key는 `rateOverride`뿐이고 won pattern 0이었다.
- **실 browser session도 동일:** PR #388 run `35287337178` / job `105422481330`은 실제 browser가 받은 `/api/inventory` 전체 44,143자를 검사했고 역시 `rateOverride`만 존재, won pattern 0이었다. 반면 같은 rendered DOM은 21,300자에 won pattern 48건과 실제 월 대여료·보증금이 보였다. `/api/rates` network call도 없었다.
- **따라서 finance authority는 여전히 미확정:** 현 B2B credential의 `/api/rates`는 admin-only 403, sampled `/api/vehicle-detail`도 finance 키 0, raw initial home HTML도 finance 값 0이다. 표시값은 client execution 과정의 다른 primitive/계산에서 생기지만 exact source는 아직 증명되지 않았다.
- **RP031 production promotion 계속 HOLD:** registry는 계속 `google_sheet`; API→sheet feeder, `/api/inventory`, rendered DOM 어느 것도 canonical finance writer가 아니다. 값을 추정·합성하거나 DOM scrape로 대체하지 않는다.
- production canonical workflow pin은 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`. F01/F86 Atom projection, RP012/손오공·RP023/오토플러스 특수탭, F86 종합의 손오공/오토플러스 제외 규칙은 유지된다.
- audit (35) F86 freshness checker false-positive, audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming migration, audit (34) newest-Atom freshness semantics, mirror/sales/settlement/RTDB legacy writer HOLD는 그대로다.

## Claude 구현 Owner 우선순위

1. audit (35)의 F86 freshness parser를 실제 `channel-f86-plan` 탭명 계약과 정렬하고 actual `event=schedule` full-run green을 증명한다.
2. RP031 finance 탐색에서 `/api/inventory`와 browser-header 가설을 다시 되돌리지 않는다. 실제 browser full body까지 금액 부재가 증명됐다.
3. 로드된 JS/static asset 또는 client calculation 경로에서 실제 finance primitive/formula를 식별하되, rendered DOM을 canonical source로 삼지 않는다.
4. primitive 식별 후 Google Sheet와 차종·연식·기간·약정거리·대여료·보증금 단위 parity를 증명한다.
5. RP031 writer promotion은 registry + Source Contract + writer topology + plate/finance provenance + Atom→snapshot→F01/F86 cross-audit를 함께 닫은 뒤 판정한다.
6. production pin/current main을 같은 계보라고 가정하지 않는다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — 최신 audit (38)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit38-ianka-browser-inventory-no-finance.md`
- PR #387 merge `cb368cf560425b9ef815601e5ce6ae4dd03aaa1c`, run `35286958679`, job `105421310549`
- PR #388 merge `8773e7664dae75e77e353e6ad7a629654c1d3b75`, run `35287337178`, job `105422481330`
- production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
