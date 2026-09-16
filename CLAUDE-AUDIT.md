# Claude SSOT Audit Entry Point

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
