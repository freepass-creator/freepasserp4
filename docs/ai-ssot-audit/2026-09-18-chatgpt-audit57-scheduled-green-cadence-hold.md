# 2026-09-18 ChatGPT audit 57 — scheduled production green / cadence hold

상태: **RESOLVED/PARTIAL — scheduled delivery 0건 판정 해소 + production scheduled full-run green / cadence·punctuality HOLD**

## 새로 확인된 운영 사실

Audit (56) 시점에는 repository-wide 최신 `event=schedule`이 ERP5 run `35304903901`(2026-09-18 12:53:42 KST, failure)이었고 그 뒤 scheduled event가 없었다. 현재 재조회에서는 그 이후 실제 scheduled run이 생겼다.

- run: **`35347508078`**
- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- event: **`schedule`**
- created: **2026-09-18 21:58:18 KST** (`2026-09-18T12:58:18Z`)
- conclusion: **success**
- workflow head SHA: `5f6a144b89e0638527e6f73cedc3560a3a36677d`
- 실제 checkout production engine: **`cf940df642edf315adbc6da2b4134fbad53da160`**

따라서 audit (56)의 “12:53 이후 scheduled event 0건”은 현재 기준 stale이며, **scheduled delivery 자체가 완전히 멈췄다는 판정은 해소/부분해소**한다.

## run `35347508078` — production full-run 증거

실제 job/log 기준 아래가 모두 green이다.

- canonical source registry 검사: **24 providers / 21 inventory locations / 21 policy locations PASS**
- Sonogong/TCar option audit: HOLD 0
- 정산원장 → ERP5 계약락 동기: Atom 1,615대, 이번 변경 0/해제 0, 원장과 원자 이미 일치
- ingest preflight: **24/24 success**
- ingest apply: **24/24 success**
- policy reference reconcile: products 1,615 / policies 81 / changes 0 / dangling 0
- snapshot: **등록 1,615 / 출고불가 944 / 현재 재고 671**
- public catalog: expected 664 = actual 664, hash 동일, missing/extra/policy/photo mismatch 0
- F01: `상품리스트 / 오공구독 / 픽업구독 / 오플구독`, **671대** 반영
- F86 backup: success
- F86: **19탭 / 671대 / 90열** 반영
- 장기 요금 없는 차 8대: 기존 확정 규칙대로 차는 싣고 요금 칸만 빈 채 유지
- F86 freshness: `종합 09.18 22:09 · 388대`, **1분 전 / 허용 120분**
- F86 Atom audit: **43,925 cells / mismatch 0**
- Atom ↔ F01: missing 0 / extra 0 / value diff 0
- F01 ↔ F86: missing 0 / extra 0 / value diff 0
- publication contract drift: listable 0 / status_kind 0 / source identity 0 / deleted marker 0 / deposit-rule 0
- photo-link audit: F01/F86 전 탭 mismatch 0
- snapshot artifact upload: success

즉 audit (56)의 production pin `cf940df...`은 이제 **실제 scheduled event에서 source → lock → ingest → snapshot → public → F01 → F86 → freshness → cross parity → photo-link 전 구간 green** 증거를 갖는다. PR #412의 F86 freshness checker 수정도 scheduled runtime에서 실제 PASS가 확인됐다.

## cadence / punctuality는 아직 해소하지 않음

current main의 ERP5 cron은 `17 0-10 * * 1-6`, 즉 월~토 KST **09:17~19:17**이다. 그런데 이번 run은 **21:58 KST**에 생성됐다. 마지막 선언 슬롯 19:17보다 약 2시간 41분 늦고, audit (56) 이후 관측된 scheduled success도 아직 이 1회뿐이다.

따라서 다음은 계속 HOLD다.

1. `:17` 변경이 정상 cadence를 회복했다는 판정
2. declared window 안에서 연속 scheduled event가 생성된다는 증거
3. repository의 다른 scheduled writer(`contract-status`, `settlement-sync`, map상 꺼짐인 `sales-erp-hourly`/`mirror-sync`)의 실제 GitHub UI runtime enabled/disabled 상태
4. 자동운영 GO 판정

**수동 dispatch green이 아니라 scheduled full-run green이 생긴 것은 중요하지만, 1회의 지연 delivery를 cadence 정상화로 확대하지 않는다.**

## 기존 HOLD 재확인

이번 구간에서 application/business logic commit은 audit (56) 이후 새로 들어오지 않았다. 따라서 직접 해소 증거가 없는 아래 항목은 유지한다.

- `LEDGER` vs `정산원장` contract-lock dual writer ownership
- `settlement-sync`의 legacy `정산` writer
- RP023 canonical RebornCar vs `MIRROR_SOURCES` old Google Sheet
- RP031 API/DOM feeder provenance / canonical migration
- main `deposit-policy.ts` vs production special-tab deposit-rule single-definition
- Sonogong/AutoPlus deposit recurrence/lineage
- vehicle-price source → Atom lineage
- sales-tab naming migration
- newest-Atom freshness semantics
- `/inventory` ERP4 read/write boundary

## Claude 구현 Owner 인계

- audit (56)의 “schedule event가 12:53 이후 없다”는 문장은 폐기한다.
- production pin `cf940df...`의 **scheduled end-to-end green은 확인 완료**로 취급한다. 같은 F86 checker/runtime 검증을 다시 구현하지 않는다.
- 다만 schedule cadence는 계속 HOLD다. declared schedule window에서 연속 회차가 실제 생성·성공해야 자동운영 GO를 판단한다.
- 구현 우선순위는 기존대로 contract-lock owner 단일화 → settlement legacy writer retire/rewire → legacy workflow runtime enabled/disabled 확정이다.

이번 ChatGPT 감사에서는 application code나 business logic을 수정하지 않았다.
