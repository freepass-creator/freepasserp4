# ChatGPT 독립 SSOT 감사 — audit (35): scheduled delivery 재출현 + F86 checker canonical failure

검토일: 2026-09-18 KST

## 판정

**의미 있는 운영 상태 변화가 있다.** audit (31)/(34) 시점의 “2026-09-17 `event=schedule` 0건”은 더 이상 현재 사실이 아니다. canonical `ERP5 SSOT 원천 최신화(매시간)` scheduled run `35235961510`이 실제 생성되어 source→ERP5 Atom→snapshot→public/F01/F86 발행까지 수행했다.

다만 회차는 전체 `failure`다. 실패 원인은 데이터/발행 parity가 아니라 이미 audit (23)/(30)에서 지적한 **F86 builder와 freshness checker의 탭명 계약 불일치**다. 또한 scheduled run은 2026-09-17 23:47 KST에 시작해 workflow가 선언한 마지막 당일 slot 19:05 KST보다 4시간 42분 이상 늦었다. 따라서 schedule delivery 존재는 확인하지만 cadence/timeliness 정상화는 확인하지 않는다.

## Evidence

Current main 기준점은 `c6f6c3e0253e6d6f172ce52067d7261358b3e4a9`. Canonical workflow `.github/workflows/erp5-ssot-refresh.yml`은 `cron: '5 0-10 * * 1-6'`(월~토 KST 09:05~19:05), production checkout ref `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`을 유지한다.

GitHub Actions run `35235961510`은 event=`schedule`, created=`2026-09-17T14:47:38Z` = 23:47:38 KST, conclusion=`failure`다. Audit (31)의 “actual event=schedule run이 없음”은 더 이상 유지할 수 없지만, 당일 마지막 선언 slot보다 4시간 42분 이상 늦으므로 hourly cadence 복구 증거로는 쓰지 않는다.

Run `35235961510` / job `105251799335`의 canonical write path는 실제 성공했다.

- production pin `9bef7bf...` checkout PASS
- inventory source registry PASS (`providers=24 inventory_locations=21 policy_locations=21`)
- supplier preflight/apply 24/24 PASS
- settlement `접수/취소` Atom lock PASS
- policy reconcile products 1,615 / policies 81 / dangling 0
- snapshot `20260917145848487-344b1c66e52f`: registered 1,615 / unavailable 921 / open 694
- public catalog expected 687 = actual 687, hash 동일, mismatch 0
- F01 694대 발행 (`상품리스트 394 · 오공구독 43 · 픽업구독 197 · 오플구독 60`)
- F86 backup PASS, 19탭 / 694대 / 90열 발행 PASS

F86 audit은 `가장 오래된 탭 0분 전 (허용 120분)`과 `45,186칸 · 어긋남 0`까지 계산한 뒤, current builder 형태인 `종합 09.17 23:58 · 394대` 및 `손오공 · 240대`, `이안카 · 164대` 등 공급사 탭을 모두 `탭 이름에 발행 시각이 없다`로 판정해 exit 1 했다. 따라서 audit (23)/(30)의 checker-contract drift가 canonical scheduled production에서도 재현됐다.

그 뒤 cross-audit는 Atom↔F01 missing/should-remove/cell-diff 0, F01↔F86 missing/extra/cell-diff 0, `보증금규칙 0`을 확인했고 photo-link audit도 mismatch 0이었다. 그러므로 run conclusion `failure`를 source/Atom/F01/F86 데이터 mismatch로 해석하면 안 된다.

## 기존 HOLD 영향

- audit (31): “event 없음” 부분은 해소, cadence/timeliness 및 full-run green은 HOLD.
- audit (23)/(30): checker drift가 canonical scheduled workflow의 실제 red 원인으로 확인되어 더 강한 증거 확보.
- audit (27): 한 회차 `depositRuleViolations=0`만으로 recurrence guard production 이식을 증명하지 못하므로 OPEN 유지.
- audit (28): Atom→projection parity와 SOURCE→ATOM 차량별 가격 의미는 다른 검사이므로 OPEN 유지.
- audit (29): sales-tab naming staged migration OPEN 유지.
- audit (33): RP031은 이 run에서도 current Google Sheet canonical path; API feeder cutover HOLD 유지.
- audit (34): `/shop` freshness는 여전히 newest Atom semantics; scheduled run 존재가 accessor 의미를 바꾸지 않음.
- legacy mirror/sales/settlement/RTDB ownership HOLD 유지.

## Claude 구현 Owner 액션

1. `audit-f86-vs-atom.mts`의 freshness tab-name parser를 `channel-f86-plan`의 current 계약과 공유/정렬한다.
2. 값/차량/칸 대조는 약화하지 않는다.
3. 수정 뒤 실제 `event=schedule` run에서 전체 green을 확보한다.
4. cadence 정상화는 scheduled run이 선언 시간대에 지속적으로 생성되는 별도 증거로 판정한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
