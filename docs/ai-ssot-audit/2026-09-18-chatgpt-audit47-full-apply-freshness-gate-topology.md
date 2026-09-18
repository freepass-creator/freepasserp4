# 2026-09-18 ChatGPT 독립 SSOT 감사 — audit (47)

## 판정

**의미 있는 운영 검증 진전 + F86 감사 topology 정정.** audit (46) 이후 production engine 자체가 바뀐 것은 아니지만, current production pin `14892951a929cf03796231f260e6bc2ff3060efc`로 **실제 `workflow_dispatch apply=true` full publish**가 실행돼 source→Atom→snapshot→F01/F86→cross-audit/photo-audit까지 통과했다. 전체 job이 red인 이유는 audit (45)/(46)의 known F86 freshness tab-name false-positive 하나다.

## 1. 새 full-apply 운영 증거

GitHub Actions:

- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- run: `35310163711`
- event: `workflow_dispatch`
- main head at run: `b30091880d29738ed1f96263e34c4c6a82c6ec73`
- production checkout ref: `14892951a929cf03796231f260e6bc2ff3060efc`
- input: `apply=true`
- conclusion: `failure` — 단, 아래 freshness checker false-positive 때문

실제 로그:

- Source Contract: PASS
- 공급사 preflight: **24/24 success**
- 실제 ERP5 ingest: **24/24 success**
- settlement `접수/취소` Atom-lock bridge: success, 변경 0 / unlock 0 (이미 일치)
- policy reconcile: changes 0 / dangling 0
- snapshot: `20260918052533743-1d860ea408cd`
  - 등록 1,615
  - 출고불가 937
  - 현재 재고 **678**
- public catalog: expected/actual **671**, missing/extra/policy/photo mismatch 전부 0
- F01 publish: **678대**
- F86 backup: success
- F86 publish: **19탭 / 678대**
- Atom↔F01: 빠진 차 0 / 내려야 할 차 0 / 값 다른 칸 0
- F01↔F86: 빠진 차 0 / 추가 차 0 / 값 다른 칸 0
- photo-link audit: F01/F86 mismatch 0
- snapshot artifact: `erp5-ssot-snapshot-35310163711`

따라서 audit (46)의 “new pin으로 `apply=true` 운영 증거 없음”은 **더 이상 최신 사실이 아니다.** current pin은 실제 live full publish를 수행했고 값/사진 parity까지 확인됐다.

## 2. F86 failure는 그대로 checker false-positive

같은 run의 `하허호 F86 ↔ 원자 칸 대조·신선도(첫 관문)`:

- freshness 계산: **oldest 0분** (허용 120분)
- cell audit: **19 tabs / 1,067 rows / 44,283 cells / mismatch 0**
- 그런데 현재 publisher 계약의 탭 이름을 대상으로 `탭 이름에 발행 시각이 없다`를 19건 발생시켜 exit 1

즉 publish/data drift가 아니라 audit (45)의 **builder↔freshness-checker contract drift**가 재현된 것이다. PR #411의 방향(공유 `f86TabCarriesMark`로 종합만 mark를 요구)은 여전히 타당하지만 아직 draft/open이고 production pin도 미승격이다.

## 3. topology 정정 — 이 step은 실제로 downstream audit을 gate하지 않는다

PR #411 설명에는 “이 첫 관문이 풀리면 지금 skipped인 cross-audit/photo도 실행” 취지의 서술이 있었지만, current live workflow와 run `35310163711`은 반대 증거를 준다.

current `.github/workflows/erp5-ssot-refresh.yml`에서:

- F86 freshness audit은 `if: always() && steps.snapshot.outcome == 'success' ...`
- Atom↔F01↔F86 cross-audit은 `if: always() && steps.f01.outcome == 'success' && steps.f86.outcome == 'success'`
- photo audit은 `if: always() && steps.f86.outcome == 'success'`

즉 downstream 두 감사는 **freshness checker outcome에 의존하지 않는다.** 실제 run에서도 freshness step이 failure였는데 cross-audit과 photo-audit은 둘 다 실행되어 success했다.

따라서 명칭상 “첫 관문”이지만 현재 orchestration topology상 downstream gate는 아니다. Claude는 PR #411을 merge할 때 이 사실을 기준으로 설명/검증 계획을 정정해야 한다. 이 정정은 checker를 약화시키라는 뜻이 아니라, **이미 실행되는 downstream parity 증거를 skipped로 잘못 취급하지 말라**는 뜻이다.

## 4. 신차렌트 색 판정 범위 갱신

새 pin `14892951...`로 full `apply=true` publish가 실제 성공했으므로 audit (45)/(46)의 “새 pin full apply 자체가 아직 없음”은 해소된다. 다만 이번 run 로그는 Google Sheets `effectiveFormat`의 `신차렌트=#FF00FF`를 직접 읽어 assert하지 않는다.

따라서:

- code/contract + new-pin live publisher execution: **RESOLVED/PROVEN**
- FF00FF가 live sheet에서 다시 뒤집히지 않았다는 color-specific runtime/effectiveFormat proof: **별도 확인 전까지 HOLD**

## 5. schedule 대응은 아직 미승격

- PR #410 (`:05 → :17`)은 여전히 open / unmerged.
- current live workflow cron은 계속 `:05`.
- 이번 감사 시점에 새 `event=schedule` 회차가 audit (45)의 `35304903901` 이후 추가로 확인되지 않았다.

따라서 punctuality/cadence HOLD는 유지한다. `workflow_dispatch apply=true` 성공을 schedule delivery 정상화 증거로 사용하지 않는다.

## 6. 기존 HOLD 재확인

직접 해소 증거가 없어 유지:

- RP031 finance/identity provenance 및 canonical Sheet bootstrap crossing
- RP023 canonical RebornCar vs legacy `MIRROR_SOURCES` Google Sheet source
- `mirror-sync.yml` scheduled apply writer
- `sales-erp-hourly.yml` scheduled apply writer
- `settlement-sync.yml` legacy ledger→supplier-status writer
- audit (27) Sonogong deposit recurrence
- audit (28) vehicle-price source→Atom lineage
- audit (29) sales-tab naming migration
- audit (34) newest-Atom freshness semantics

canonical source registry도 그대로다: RP006=ironrentcar.com, RP012=sokrc.com/api, RP023=RebornCar, RP031=Google Sheet.

## Claude 구현 Owner 인계

1. audit (46)의 “new pin full apply 증거 없음” 문구는 닫는다. run `35310163711`이 current pin live full-apply + value/photo parity 증거다.
2. PR #411은 여전히 production OPEN을 닫지 못했다. merge/repin/Source Contract 후 실제 run에서 F86 freshness step 자체가 green인지 확인한다.
3. PR #411 검증 설명에서 downstream cross-audit/photo가 현재 이미 freshness failure와 무관하게 실행된다는 topology를 반영한다.
4. 색은 new-pin live publish까지 증명됐지만 `effectiveFormat` 직접 검증 없이 color-specific runtime proof까지 과장하지 않는다.
5. PR #410은 실제 scheduled `:17` 회차가 연속 도착하기 전 schedule HOLD를 닫지 않는다.

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.