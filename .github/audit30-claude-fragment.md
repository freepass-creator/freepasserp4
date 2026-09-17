# ChatGPT 독립 SSOT 감사 — audit (30) override (2026-09-17)

> 이 절이 아래 audit (29) 및 이전 요약보다 우선한다.

## 현재 판정

- **active production pin:** `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`.
- **audit (26) F86 A1 blocker: production 해소.** `salesPublishTabMark()`가 초를 제거하며 run `35208040283`에서 F86 19탭/754대 values write가 실제 성공했다.
- **audit (23) F86 freshness checker: OPEN.** 같은 run에서 47,911칸 값 mismatch 0인데도 탭명 시각 regex가 19탭 모두를 오류로 판정하고 exit 1 했다. one-time workflow가 `continue-on-error`로 가렸을 뿐이며 canonical workflow는 이 실패를 마스킹하지 않는다.
- **신규 lineage drift:** current `origin/main` `21282cf41cb7d000d51509b5e8bb0a9238b73d2e`의 `sales-publish-snapshot.ts`에는 production의 `salesPublishTabMark()` fix가 없다. `9bef7bf...`와 main은 diverged(`merge-base=4bab085d...`). production 해소를 main 해소로 일반화하지 않는다.
- **audit (27)/(28)/(29) 유지:** deposit recurrence guard, 차량별 가격 의미, sales-tab-kinds migration은 active production `9bef7bf...`에 승계되지 않았다.
- canonical source는 계속 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar. Mirror/RTDB legacy path는 noncanonical/HOLD다.

## Claude 구현 Owner 우선순위

1. `9bef7bf...`의 초 제거 동등 fix를 canonical main lineage에도 보존한 뒤 future repin한다.
2. F86 freshness checker를 현 plan 계약(종합에만 시각, 공급사 탭은 회사명+대수)과 맞추되 차량/칸 대조는 약화하지 않는다.
3. canonical `erp5-ssot-refresh`에서 F01/F86 publish + F86 audit + cross-audit 전체 green 회차를 확보한다.
4. audit (27)/(28)/(29)는 별도 promotion work로 유지한다.

---

