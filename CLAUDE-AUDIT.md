## 최신 override — audit (29)

충돌 시 이 override와 `docs/AI-SSOT-AUDIT-LOG.md` audit (29)를 audit (28) 이하보다 우선한다.

- **신규 staged projection-contract migration:** Claude 단일 구현 branch `claude/f86-peer-spec-transplant` head `a6843cdb...`에 `lib/domain/sales-tab-kinds.ts` + `check:sales-tabs`가 생겼다. target은 F01/F86 공통 `상품리스트 · 손오공상품 · 픽업구독 · 오토플러스`, legacy read alias는 `종합/오공구독/손오공구독/오플구독`에서 새 이뮄으로 매핑한다.
- **아직 live 아님:** commit 자체가 `1/3단계 — 정의만`, `발행에는 아직 안 붙였다`고 명시하고, 같은 branch F86 plan도 아직 `RETRO_SUMMARY_TAB`/`종합` 경로를 사용한다. 새 checker 존재를 production 해소 증거로 쓰지 않는다.
- 현재 naming은 3계약 과도기다: main=`상품리스트/손오공구독/픽업구독/오플구독`, production `6a6f3f75...`=`상품리스트/오공구독/픽업구독/오플구독`, staged target=`상품리스트/손오공상품/픽업구독/오토플러스`. 2/3 F86 + 3/3 F01에서 publisher/auditor/old-tab cleanup/locked layout을 같은 SSOT에 함께 연결해야 한다.
- `a6843cdb...`는 production `6a6f3f75...`보다 5 commits ahead/0 behind인 직계 전진 계보다. audit (27)/(28) deposit/vehicle-price fixes 위에 tab definition이 추가된 상태지만 canonical workflow는 아직 `6a6f3f75...`를 checkout한다.
- audit (26) F86 A1 400, audit (27) deposit recurrence, audit (28) vehicle-price lineage gap 및 audit (22)/(23) deposit-policy/freshness/legacy writer HOLD는 **이번 1단계 정의만으로 해소되지 않음**.
- promotion 전 새 naming은 projection에만 적용하고 canonical source/Atom 의미를 바꾸지 않는다. production repin 후 F01/F86 publish + cross-audit green을 확보한 뒤에만 naming migration을 해소 처리한다.

상세: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit29-sales-tab-kind-staging.md`

---

## 최신 override — audit (28)

충돌 시 이 override와 `docs/AI-SSOT-AUDIT-LOG.md` audit (28)를 audit (27) 요약보다 우선한다.

- **신규 vehicle-price lineage gap:** active production `6a6f3f75...` collector는 차량가격/소비자가격을 source에서 Atom `consumer_price`로 읽지 않고, production projection은 차량가격에서 supplier-policy 공통값을 차량별 Atom보다 먼저 반환한다.
- Claude feature lineage `b6933732...` → `b0aedeee...`는 이를 실측/수정했다. 기록상 손오공 listable 258대가 전부 36,000,000으로 보였고, 수정 뒤 Sonogong 258대 차량가격이 Atom에 들어갔다. 이 두 commit은 audit (27)의 `e5fac1b...` deposit guard와 함께 production보다 3 commits ahead인 같은 계보다.
- canonical workflow는 여전히 `6a6f3f75...`를 checkout하고 current main collector는 HARD GUARD stub이다. 다음 canonical ingest 전에 vehicle-price 두 수정 + audit (27) deposit guard를 production lineage에 선택 이식하고 차량번호 기준 SOURCE→ATOM→F01/F86을 검증할 것.
- 현재 live F01/F86가 반드시 지금 잘못됐다고 단정하지 않는다. finding은 **현재 production lineage가 다음 ingest에서 차량별 가격 의미를 재생성/보존할 수 없는 것**이다. RP023/RP006 가격 원천은 별도 HOLD이며 임의 보강 금지.
- audit (27) 손오공 보증금 recurrence, audit (26) F86 A1 400, audit (22)/(23) deposit-policy/freshness checker/legacy writer HOLD는 계속 유지.

상세: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit28-vehicle-price-atom-drift.md`

---

## 최신 override — audit (27)

충돌 시 이 override와 `docs/AI-SSOT-AUDIT-LOG.md` audit (27)를 audit (26) 이하보다 우선한다.

- **audit (26) 정정/보강:** run `35169123131`에서 live RP012 Atom이 숫자 보증금 0대/규칙글자 불일치 0대이고 snapshot gate가 PASS한 사실은 그대로 맞다. 그러나 이것은 ingest recurrence까지 해소됐다는 뜻이 아니다.
- Claude feature-branch commit `e5fac1b40de282f0a59dc22a39cc42a2e01de8d3`에서 production pin `6a6f3f75...` 계보의 ingest를 다시 돌리자 **274대에 옛 숫자 보증금이 재생성되는 경로가 실제 재현**됐다. 두 price-write 지점 중 하나가 기존 값을 되살렸다.
- `e5fac1b...`는 `levelDepositsForRuleText()` 쓰기 직전 guard를 두 ingest write 지점에 적용하고 heal → 동일 ingest 재실행 후 violation 0을 검증했다. 하지만 `6a6f3f75...`보다 3 commits ahead인 feature-branch commit이며 current main에도 이 함수가 없다.
- current canonical `erp5-ssot-refresh.yml`은 아직 `6a6f3f75...`를 checkout한다. workflow가 다시 enabled되거나 같은 pin ingest를 실행하면 recurrence risk는 미해소다. F86-only emergency writer의 heal-before-gate는 그 경로의 완충책일 뿐 canonical ingest fix가 아니다.
- **보증금 publication gate는 유지한다.** 구현 Owner는 `e5fac1b...`의 normalization guard만 current production lineage에 선택적으로 이식하고 `heal → ingest --apply → snapshot`에서 `depositRuleViolations=0`을 다시 증명한다.
- audit (26)의 F86 A1 range-addressing HTTP 400 blocker는 별도 OPEN으로 유지한다. audit (22) deposit-policy 이중정의, audit (23) freshness checker drift/workflow disabled, legacy sales/mirror/settlement/credential/RP023/pickup-color HOLD도 유지한다.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit27-sonogong-deposit-recurrence.md`.

---
## 최신 override — audit (26)

충돌 시 이 override와 `docs/AI-SSOT-AUDIT-LOG.md` audit (26)를 audit (25) 이하보다 우선한다.

- audit (25)의 “run `35169123131` publish stderr 원인 확인 필요”는 **해결된 조사 과제**다. 정확한 실패는 Google Sheets values write의 HTTP 400 `INVALID_ARGUMENT`: `Invalid data[0]: Unable to parse range: '종합 09.17 10:05:11 · 391대'!A1`.
- **손오공 보증금 SSOT는 이 run에서 정상 확인:** RP012 692대, 숫자 보증금 잔존 0대, 규칙 글자 불일치 0대. snapshot/deposit gate도 PASS(등록 1,615 / 출고불가 861 / 현재 재고 754). 보증금 gate를 약화/롤백하지 않는다.
- F86 backup과 plan/locked-format/manual write approval까지 PASS했지만 values publish에서 멈춰 F86 audit은 skipped. 현재 blocker는 **F86 dynamic summary/tab A1 addressing + structural-before-values write ordering**이다.
- 운영 F86 read-only 확인상 현재 summary는 `종합 09.17 10:05:01 · 391대`로 데이터가 채워져 있으며 failed `10:05:11` title은 남아 있지 않다. 따라서 live corruption은 단정하지 않고, 최신 validated snapshot 미발행으로 본다.
- 구현 Owner 우선순위: range/write-order fix → backup/publish/F86 audit/cross-audit green → one-time writer retire/remove/ownership 정리.
- audit (22) deposit-policy 이중정의, audit (23) freshness checker drift, canonical workflow disabled, legacy settlement/credential/sales/mirror/RP023/pickup-color HOLD는 미해소 유지.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit26-f86-range-addressing.md`.

---
## 최신 override — audit (25)

충돌 시 이 override와 `docs/AI-SSOT-AUDIT-LOG.md` audit (25)를 audit (24) 이하보다 우선한다.

- **audit (24) 정정:** `manual-erp5-full-sync-once.yml`은 더 이상 old `2e880cef...` F01/F86 stale writer가 아니다. commit `78df24bb...`에서 current production `6a6f3f75...`로 repin되고 source/Atom/F01 단계를 제거한 **F86-only emergency writer**가 됐다. commit `335d8e19...`에서 shared concurrency `cancel-in-progress: true`도 적용됐다.
- current workflow는 self-file push trigger, `6a6f3f75...`, Sonogong heal + snapshot/deposit gate, F86 backup/publish, `FREEPASS_MANUAL_PUBLISH_APPROVED` 구조다.
- **현재 최우선 OPEN:** run `35169123131`은 heal=success, snapshot/deposit gate=success, F86 backup=success 뒤 **Publish F86 from validated snapshot=failure**, audit skipped. 정확한 publish stderr를 확인하고 정상 write + audit 증거를 확보할 것.
- canonical ERP5 refresh workflow disabled 판정은 유지. one-time F86 writer를 장기 대체 writer로 키우지 말고 성공 회차 후 retire/remove 또는 ownership을 명시할 것.
- audit (22) main-vs-production deposit-policy 이중정의, production gate의 main 미이식, audit (23) F86 freshness checker drift, legacy settlement/credential/sales/mirror/RP023/pickup-color HOLD는 미해소 유지.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit24-concurrent-f86-writer-correction.md`.

---
## 최신 override — audit (24)

충돌 시 이 override와 `docs/AI-SSOT-AUDIT-LOG.md` audit (24)를 기존 audit (23) 요약보다 우선한다.

- **current canonical production pin = `6a6f3f75c065143ad14286d08baa28e382535eea`** (PR #340 merge `7203c0ee...`), Source Contract/verify green.
- 새 production 의미: 차량가격 빈칸 `미입력`; 손오공 보증금은 숫자 대신 규칙글자; `depositRuleViolations` publication gate.
- **최우선 HOLD:** `manual-erp5-full-sync-once.yml`은 여전히 옛 `2e880cef...`로 동일 F01/F86을 쓸 수 있는 stale-engine second writer다. retire/remove 또는 canonical engine과 동일 계약으로 통제.
- audit (22) deposit-policy drift 미해소: main canonical policy와 production local Sonogong/AutoPlus 규칙이 병존. production gate를 유지하면서 하나의 policy object/resolver로 합칠 것.
- F86 freshness checker drift 미해소: plan은 `종합`만 timestamp, checker는 모든 탭 timestamp를 요구.
- legacy settlement/credential/sales/mirror/pickup-color HOLD와 canonical ERP5 workflow disabled 판정은 직접 해소 증거가 생길 때까지 유지.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-production-6a6-emergency-writer-drift.md`.

---
# Claude SSOT Audit Entry Point

## 최신 override — audit (23)

아래 내용은 이 파일의 기존 audit (22) 요약보다 최신이며, 충돌 시 **이 override와 `docs/AI-SSOT-AUDIT-LOG.md` audit (23)을 우선**한다.

- canonical `ERP5 SSOT 원천 최신화(매시간)` workflow id `358276101`은 run `35164315681`에서 `workflow_dispatch`가 HTTP 422 `disabled workflow`로 거부됐다. 따라서 ERP5 refresh의 schedule gap 원인은 적어도 이 시점에는 **workflow disabled**로 확인됐다. settlement/sales/mirror까지 같은 상태였다고 일반화하지 않는다.
- commit `276f37e33e26544bde0439f1c387a1a624a62138`으로 canonical `erp5-ssot-refresh.yml`에 `sync-vehicle-lock-from-ledger.mts --apply`가 배선됐다. `접수/취소` Atom-lock의 **canonical refresh 미연결 finding은 해소됨**이다. legacy `settlement-sync.yml`은 별도 미해소다.
- production pin `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`의 F86 builder는 `종합`만 timestamp, 공급사 탭은 `회사 · N대`로 만든다. 같은 pin의 `audit-f86-vs-atom.mts`는 모든 탭 timestamp를 요구해 checker-contract drift가 있다.
- one-time run `35165360537`은 24/24 source preflight/apply, settlement lock, F01 695대, F86 19탭·695대 발행까지 성공했고 F86 **44,653칸 값 mismatch 0**이었다. 다만 공급사 탭 18개의 timestamp 부재만으로 freshness audit가 실패해 이후 cross-audit/photo-audit가 skipped됐다. 따라서 데이터 drift가 아니라 **freshness checker false positive**이며, 완전 full-audit PASS로 닫지는 않는다.
- current main에는 `.github/workflows/manual-erp5-full-sync-once.yml`이 `FREEPASS_MANUAL_PUBLISH_APPROVED` escape hatch를 써 F01/F86을 쓸 수 있는 별도 production writer 진입점으로 남아 있다. 긴급 회차 후 retire/remove 또는 명시적 통제 필요.
- audit (22)의 special-tab deposit-policy drift, legacy same-output F01/mirror writer, credential composite-action parser 문제, pickup canonical color HOLD는 해소 증거가 없으므로 유지한다.

Claude 구현 Owner 우선순위: (1) canonical ERP5 workflow enable/disable 운영결정 정합화, (2) F86 freshness checker를 `종합` timestamp/공용 plan 계약에 맞추고 cross-audit/photo-audit까지 green 확보, (3) emergency one-time writer 정리, (4) canonical refresh의 settlement Atom-lock 배선 유지 + legacy settlement 별도 정리, (5) 기존 audit (22) HOLD 계속 추적.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-disabled-workflow-f86-checker-drift.md`

---

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT의 실제 구현·수정 Owner는 **지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 AI/Claude 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

항상 아래 순서로 읽는다.

1. 이 파일
2. `docs/AI-SSOT-AUDIT-LOG.md`의 **가장 최신 항목**
3. 최신 dated audit — 현재 핵심은:
   - `docs/ai-ssot-audit/2026-09-17-chatgpt-special-tab-deposit-policy-drift.md`
   - `docs/ai-ssot-audit/2026-09-17-chatgpt-parity-checker-resolution.md`
   - `docs/ai-ssot-audit/2026-09-16-chatgpt-schedule-delivery-gap.md`
   - `docs/ai-ssot-audit/2026-09-16-chatgpt-ci-runtime-regressions.md`
   - `docs/ai-ssot-audit/2026-09-16-chatgpt-main-vs-production-f01-contract-drift.md`
   - `docs/ai-ssot-audit/2026-09-16-chatgpt-2e880cef-source-contract-resolution.md`
   - `docs/ai-ssot-audit/2026-09-16-chatgpt-rtdb-zero-ratchet.md`

---

## 불변 원칙

1. `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다.
2. F01/F86/오공구독/오플구독/픽업구독/고객면은 projection이다. Projection을 canonical Source로 역류시키지 않는다.
3. production pin과 current `main`은 현재 같은 코드계보/계약이 아니다. 반드시 따로 읽는다.
4. `inventory-source-registry.ts`만 보고 SSOT가 끝났다고 판단하지 않는다. workflow, same-output writer, mirror/RTDB legacy path까지 같이 본다.
5. production 계약상 RP012 비픽업 구독은 `오공구독`, RP023은 `오플구독`, 픽업은 `픽업구독`으로 분리하고 공급사 고유 기간·주행거리·요금 구조를 보존한다.
6. 실제 코드 수정은 Claude 단일 구현 세션만 한다. 감사 findings는 실제 코드/Actions를 재확인한 뒤 처리한다.
7. 과거 감사 판정은 삭제하지 않는다. 해소/정정은 `docs/AI-SSOT-AUDIT-LOG.md`에 새 항목으로 남긴다.
8. repository에 cron이 있다는 사실과 GitHub Actions에서 **실제로 schedule event가 dispatch되고 있다는 사실을 구분**한다. 우발적 미기동을 writer retirement로 간주하지 않는다.

---

# 현재 최신 판정 — 2026-09-17 / audit `(22)` 기준

## 1. production pin / current main

current `.github/workflows/erp5-ssot-refresh.yml` production checkout ref:

- `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`

Source Contract allowlist drift는 PR #325 이후 해소됐고 run `35067923610`이 green이었다.

`check:shop-data-parity` 해소 기준점은 PR #337 merge:

- `7535c581245f89b2da95f910e05fead4d14a24e2`

그 뒤 PR #336이 이 commit을 base로 merge되어 application main은 다음까지 전진했다.

- `d9cbc3f98577a18048a37657d7ddd1955433d4ee` — 업무동 `ProductRowCard` 모바일 카드에 웹과 같은 출고상태·상품구분·옵션 표시 + `check-design-locked` 잠금 갱신

PR #336은 `components/ProductRowCard.tsx`, `scripts/check-design-locked.mts` 두 파일만 바꾼 **UI presentation parity 변경**이다. canonical source, ERP5 writer, production pin, F01/F86 projection writer, special-tab routing, mirror/RTDB 경로는 변경하지 않았다. main push CI run `35118126431`도 success다.

이후 application main은 PR #338 merge까지 전진했다.

- `ac528430e2bd46a80dda60aacede16237e526c6f` — `components/WhitelabelFrame.tsx` 한 파일에서 모바일 고정 머리띠의 날짜·시각·날씨 둘째 줄 제거

PR #338도 **UI-only 변경**이다. canonical source, ERP5 writer, production pin, F01/F86 projection writer, special-tab routing, mirror/RTDB 경로를 바꾸지 않았고 main push CI run `35122525775`도 success다.

그 뒤 main은 감사 문서 전용 commit들까지 전진했으며, 이번 audit `(22)`에서도 application code/business logic은 변경하지 않았다.

`2e880cef...` current collector semantics 기준 **정규 scheduled F01/F86 full-audit 성공은 여전히 HOLD**다. schedule dispatch 자체가 2026-09-16 16:18:54 KST 이후 관측되지 않은 상태가 이어지고 있다.

## 2. 운영 HOLD — 선언된 cron과 실제 schedule dispatch가 갈림

**판정: schedule-delivery/enablement drift / 원인 미확정**

2026-09-17 07:42 KST 재조회에서도 GitHub Actions API의 최신 `event=schedule` 실행은 여전히 2026-09-16 16:18:54 KST의 run `35067894061`이며, 그 뒤 새 schedule event는 관측되지 않았다.

2026-09-16 확인된 schedule 실행은 4건뿐이다.

- 10:32:35 KST — 계약중 표기(30분) run `35044497887` — success
- 12:46:35 KST — ERP5 SSOT 원천 최신화(매시간) run `35053074482` — success
- 13:41:34 KST — 정산 접수 반영(1시간) run `35056578656` — failure
- 16:18:54 KST — 계약중 표기(30분) run `35067894061` — failure

repository 원문은 계속 다음 cron을 선언한다.

- `erp5-ssot-refresh.yml`: `5 0-10 * * 1-6`
- `settlement-sync.yml`: `5 0-9 * * 1-6`
- `sales-erp-hourly.yml`: `0 0-9 * * 1-5`
- `mirror-sync.yml`: `*/30 * * * *`

원인은 workflow disable인지 scheduler delivery 누락/지연인지 독립 확정하지 않는다. **schedule 미발생을 writer retirement 증거로 사용하지 않는다.**

상세 근거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-schedule-delivery-gap.md`

## 3. 최우선 SSOT 충돌 — 같은 F01을 production과 legacy main writer가 다른 계약으로 쓸 수 있음

production pin:

- F01 canonical tabs = `상품리스트`, `오공구독`, `픽업구독`, `오플구독`
- product types = 7 canonical types
- canonical color map + `check:color-ssot`

current main legacy path:

- `sales-erp-hourly.yml` schedule 선언 존재
- `hourly-sync.mts`가 같은 F01 Google Sheet에 `손오공구독` 계약으로 발행 가능
- main product-type/color contract는 production보다 오래됨
- production write gate를 이 legacy writer가 사용하지 않음

따라서 **production F01 sole-writer ownership을 repository 수준에서 먼저 정리**한다. schedule 미발생을 이 writer가 안전하게 retire됐다는 증거로 사용하면 안 된다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-main-vs-production-f01-contract-drift.md`

## 4. 신규 SSOT 충돌 — 손오공/오토플러스 특수탭 보증금 정책이 main canonical policy와 production에서 갈림

**판정: special-tab deposit-policy projection drift / 구현 Owner 확인 필요**

current main에는 `lib/domain/deposit-policy.ts`가 있고 다음 계보가 보증금 규칙을 canonicalize했다.

- `110bb75935688dc6b01d361d1e6dcac335e65b50` — 손오공/오토플러스 보증금 규칙 중앙화
- `aae377d048181f09edbeaa7546ae0afb71c09be4` — AutoPlus maker 미입력 시 국산으로 추정하지 않는 fail-closed 보완
- `80a0d82317fc84b80dd7b5e7ff4d45426966e9b0` — `sales-published-tabs.ts`가 canonical policy를 소비하도록 연결

current main 의미:

- 손오공 `보증금 반납형`은 `SONOGONG_DEPOSIT_POLICY.label`에서 발행
- 오토플러스는 `resolveAutoplusDepositPolicy(maker)?.label ?? ''`
- **maker가 비어 있으면 정책 미확정/빈 표시**

그러나 current production pin `2e880cef...`에는 `lib/domain/deposit-policy.ts`가 없고 production `sales-published-tabs.ts`는:

- `오공구독`의 `보증금 반납형`을 원본 special-tab block에서 복사
- 오토플러스 규칙을 로컬 하드코딩
- maker가 비어 있어도 import brand가 아니라고 보고 **`국산: 월 대여료×2`로 추정**

즉 current main canonical 계약과 production special-tab projection의 실제 의미가 다르다. `110bb759...`과 `2e880cef...`도 diverged 계보다.

이 finding은 canonical inventory source나 `오공구독/오플구독` tab naming을 되돌리라는 뜻이 아니다. production의 7-canonical/F86/collector semantics를 유지하면서 **보증금 policy object/resolver만 같은 SSOT로 정렬**해야 한다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-17-chatgpt-special-tab-deposit-policy-drift.md`
- `docs/AI-SSOT-AUDIT-LOG.md` audit `(22)`

## 5. 해소됨 — required `check:shop-data-parity` checker drift / main CI red

PR #337이 audit `(18)~(20)`의 checker-contract drift를 해소했다.

변경 범위:

- `scripts/sim-shop-data-parity.mts` 한 파일
- cache helper 형태 `collection('products', 'products')`, `collection('policies', 'policy')`를 검증
- feed가 `loadGuestListing`을 사용하고, `guest-listing.ts`가 `readWhitelabelCatalogFromErp5`를 사용하는 실제 계층을 따라 검사
- feed/listing의 RTDB/admin 우회 경로 금지는 유지

검증:

- PR head `ff02d8f662e84290c949d1b3a3e1a2c388d9dacd` `verify` success
- PR #337 main push CI run `35117788232` / head `7535c581...` success
- 후속 PR #336 main push CI run `35118126431` / head `d9cbc3f...` success
- 후속 PR #338 main push CI run `35122525775` / head `ac528430...` success
- latest observed main CI run `35127816502`도 success이며 `RTDB 스왑점 밖 직접 열기`, `웹·모바일이 같은 Firestore 피드를 쓰는가`, `Production build`가 모두 green

따라서 이전 `latest main CI red / parity checker 수리 필요` 지시는 **폐기**한다. 현재 ratchet 의미를 약화시키지 않는다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-17-chatgpt-parity-checker-resolution.md`

## 6. 운영 회귀 유지 — 공통 credential composite action이 load 단계에서 깨짐

current `.github/actions/prepare-credentials/action.yml`의 input description에는 아직 다음 표현이 있다.

- `` `${{ secrets.GOOGLE_SA_JSON }}` ``

실제 scheduled `계약중 표기(30분)` run `35067894061`은 local composite action을 읽는 단계에서:

- `Unrecognized named-value: 'secrets'. Located expression: secrets.GOOGLE_SA_JSON`

로 실패했다. current main CI의 `check:workflows`가 green인 사실은 이 실제 Actions parser failure를 해소한 증거가 아니다. local composite action metadata 검증 coverage도 필요하다.

## 7. 정산 Atom-lock orchestration gap 유지

current main `.github/workflows/settlement-sync.yml`은 여전히:

- `scripts/sync-contract-from-ledger.mts`

를 호출한다. scheduled run `35056578656`은 `시트 "정산"을(를) 찾지 못했습니다.`로 실패했다.

current ledger contract는 `접수`, `취소`, `분납실적`, `완납실적`, `청구`다. production pin의 새 `scripts/sync-vehicle-lock-from-ledger.mts`는 `접수`/`취소`를 ERP5 Atom lock/unlock으로 처리하지만 current scheduled orchestration에는 연결되지 않았다.

## 8. 상품구분 색 HOLD 유지

production 7-canonical color SSOT 구조/잠금은 유지한다. 다만 production `MASTER_CATEGORY_COLORS['분류']['픽업구독']`은 여전히:

- `#C2185B`

이다. 최신 승인 색과의 불일치는 미해소다. 해결은 canonical map 한 곳에서만 하고 channel-local hardcode를 만들지 않는다.

## 9. writer topology / mirror legacy 유지

repository 기준 아래 둘은 계속 write-capable schedule을 선언한다.

- `.github/workflows/sales-erp-hourly.yml`
- `.github/workflows/mirror-sync.yml`

`MIRROR_SOURCES`의 RP023 `from`에는 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`가 남아 있지만 **canonical source 권한은 없다.**

canonical inventory source는 계속:

- RP006 = `ironrentcar.com`
- RP012 = `sokrc.com/api`
- RP023 = RebornCar

이다.

app/lib/components의 RTDB direct-open baseline 0 / `check:store` CI 래칫은 해소 상태를 유지한다. 이것을 scheduled writer topology 해소로 오인하지 않는다.

---

# Claude 구현 Owner의 즉시 우선순위

1. **GitHub Actions 실제 workflow enable/disable 상태와 schedule delivery부터 확인**한다. 선언 cron과 실제 schedule events가 2026-09-16 16:18:54 KST 이후 끊긴 이유를 확정하고, intentional disable이면 repository 계약에 반영한다.
2. production `erp5-ssot-refresh`가 enabled/정상이라면 `2e880cef...` current semantics 기준 다음 scheduled F01/F86 full-audit PASS를 확보한다.
3. **same-output F01 writer 충돌을 정리**한다. production의 `오공구독`/7-canonical 계약을 current main의 옛 `손오공구독`/5-type 계약으로 되돌리지 않는다.
4. **손오공/오토플러스 special-tab 보증금 정책을 production과 main에서 한 SSOT로 정렬**한다. production의 7-canonical/F86/collector semantics는 유지하고, 특히 AutoPlus maker 미입력 시 국산으로 추정하는 현재 production 동작을 그대로 둘지 current canonical fail-closed 계약과 대조해 확정한다.
5. `.github/actions/prepare-credentials/action.yml`의 composite-action metadata 오류를 고치고 local composite action 유효성 검사를 CI에 추가한다.
6. settlement scheduled path를 current ledger + ERP5 Atom lock 계약에 맞춘다. 실제 schedule에서 `접수` lock / `취소` unlock 성공을 확인한다.
7. 픽업구독 색은 canonical map 한 곳에서만 해결하고 정규 publish/live `effectiveFormat`까지 확인한다.
8. mirror/sales legacy writer ownership은 명시적 repository 수준 결정으로 닫는다. UI disable이나 우발적 runtime failure에 의존하지 않는다.
9. `check:shop-data-parity`는 **해소됨**으로 유지하되 현재 ERP5 Firestore 의미 검사를 약화시키지 않는다.
10. 구현 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

이 entry point는 구현 지시의 요약이다. 세부 근거와 과거 판정은 `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목과 최신 dated audit를 우선한다.
