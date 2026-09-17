# ChatGPT 독립 SSOT 감사 — audit (36) override (2026-09-18 KST)

> 이 파일은 Claude 구현 Owner의 **최신 진입점 요약**이다. 과거 판정과 상세 증거는 `docs/AI-SSOT-AUDIT-LOG.md`와 최신 `docs/ai-ssot-audit/` 문서를 우선한다. 실제 application/business logic 수정은 Claude 단일 SSOT 세션만 수행한다.

## 현재 판정

- **신규 main 변화:** PR #374 merge `42ca5541e4e92fc11b655fd330b6f324a59efe94`가 `scripts/diag-ianka-vehicle-detail.mts` read-only 진단만 main에 추가했다. production writer/adapter/projection 변경은 아니다.
- **RP031 `vehicle-detail` 금융값 후보 배제:** authenticated run `35228945659` / job `105227660941`에서 `/api/vehicle-detail?vehicleNo=128896` 성공 응답 22,630자를 전부 검사했고 rate/price/fee/대여료/보증금/month 계열 키 0건, `N,NNN원` 패턴 0건이었다. payload는 specs/summaries/photos 성격이다. 따라서 “앞 2,000자 뒤에 기간별 요금이 있을 수 있다”는 의문은 표본 응답 기준 해소됐다.
- **RP031 production promotion은 계속 HOLD:** audit (33)의 `/api/rates` GET 403는 그대로이고 `vehicle-detail`도 1~60개월 rent/deposit의 대체 source가 아니다. API-only 신규 차량의 금융값을 추정·합성하지 않는다. 현재 canonical은 계속 Google Sheet이고 API→sheet feeder는 production writer로 승격되지 않았다.
- **audit (35) 유지:** canonical scheduled run `35235961510`은 production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`에서 source→Atom→snapshot→public/F01/F86 발행과 값 대조까지 맞았지만, F86 freshness checker가 현재 탭명 계약을 못 읽는 false-positive로 workflow를 red로 만들었다. cadence/timeliness도 아직 HOLD다.
- audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming migration, audit (34) newest-Atom freshness observability, mirror/sales/settlement/RTDB legacy writer ownership HOLD는 이번 진단 merge로 닫지 않는다.
- canonical source baseline은 계속 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar이며 RP031은 Google Sheet canonical이다.

## Claude 구현 Owner 우선순위

1. audit (35)의 `audit-f86-vs-atom.mts` freshness parser를 `channel-f86-plan`의 실제 탭명 계약과 공유/정렬하고, 실제 `event=schedule` full-run green을 증명한다.
2. RP031 금융값 source 탐색에서 `/api/vehicle-detail`을 다시 후보로 가정하지 않는다. 현재 검증된 경계는 `/api/rates` 권한 부족 + sampled `vehicle-detail` 금융키 없음이다.
3. RP031 feeder promotion 전 API-only 차량의 금융값 provenance를 확보하거나, 값이 없으면 `NO_RENT`/미노출을 명시적으로 검증한다. 값을 추정·합성하지 않는다.
4. feeder를 canonical writer로 채택한다면 writer topology와 Source Contract에 ownership을 박고 plate parity→Atom→snapshot→F01/F86 cross-audit로 닫는다.
5. audit (27)/(28)/(29)/(34)와 legacy writer ownership은 각각 별도 code/runtime 증거가 생길 때만 닫는다.
6. production pin/current main을 같은 계보라고 가정하지 말고 항상 별도로 대조한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — 최신 audit (36)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit36-ianka-vehicle-detail-no-rates.md`
- PR #374 / merge `42ca5541e4e92fc11b655fd330b6f324a59efe94`
- GitHub Actions diagnostic run `35228945659`, job `105227660941`
- audit (35) scheduled production run `35235961510`

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
