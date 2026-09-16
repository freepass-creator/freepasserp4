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

---

# 현재 최신 판정 — 2026-09-16 / audit `(18)` 기준

## 1. production pin

current `.github/workflows/erp5-ssot-refresh.yml` production checkout ref:

- `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`

Source Contract allowlist drift는 PR #325 이후 해소됐고 run `35067923610`이 green이었다.

audit `(18)`에서 SSOT/운영 코드 기준으로 관측한 main 기준점은:

- `1769d36cf0cda806f9f1b89561e637e62693b1ad`

그 뒤 application commit `b7942ed59026041e29e21cbd80ec28b19da32840`이 상품사진 사전 준비 UI만 변경했다. 독립 재검토 결과 이 변경은 SSOT source/writer/F01/F86/ERP5 canonical 계약을 건드리지 않는다. 이후 `876c8868...`까지는 감사 문서 변경뿐이며, audit `(18)`의 SSOT 판정은 그대로 유효하다.

`2e880cef...`의 collector semantics까지 포함한 **정규 scheduled F01/F86 full-audit 성공은 최신 독립 증거가 생기기 전까지 HOLD**한다.

## 2. 최우선 SSOT 충돌 — 같은 F01을 production과 legacy main writer가 다른 계약으로 쓸 수 있음

`docs/AI-SSOT-AUDIT-LOG.md` `(17)` 판정이 계속 최우선이다.

production pin:

- F01 canonical tabs = `상품리스트`, `오공구독`, `픽업구독`, `오플구독`
- product types = 7 canonical types
- canonical color map + `check:color-ssot`

current main legacy path:

- `sales-erp-hourly.yml` schedule 존재
- `hourly-sync.mts`가 같은 F01 Google Sheet에 `손오공구독` 계약으로 발행 가능
- main product-type/color contract는 production보다 오래됨
- production write gate를 이 legacy writer가 사용하지 않음

따라서 **production F01 sole-writer ownership을 repository 수준에서 먼저 정리**한다. 우연한 workflow failure를 retirement로 간주하지 않는다.

## 3. 신규 CI 충돌 — required `check:shop-data-parity`가 current implementation을 오탐해 main CI red

current CI run `35077840002`에서 required `check:shop-data-parity`가 failure다.

직접 원인:

- checker `scripts/sim-shop-data-parity.mts`는 literal `collection('products')`, `collection('policy')`를 찾는다.
- current `lib/server/whitelabel-erp5-catalog.ts`는 cache helper를 거쳐 `erp5Firestore().collection(name).get()`을 호출한다.
- 실제 호출은 `collection('products','products')`, `collection('policies','policy')` 형태다.

현재 증거는 **ERP5 Firestore 이탈이 아니라 checker-contract drift**를 가리킨다. required ratchet 자체는 유지하되 helper-mediated 경로를 의미적으로 검사하도록 고쳐야 한다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-ci-runtime-regressions.md`

## 4. 신규 운영 회귀 — 공통 credential composite action이 load 단계에서 깨짐

current `.github/actions/prepare-credentials/action.yml`의 input description에 `` `${{ secrets.GOOGLE_SA_JSON }}` `` 표현이 들어 있다.

실제 scheduled `계약중 표기(30분)` run `35067894061`은 local composite action을 읽는 단계에서:

- `Unrecognized named-value: 'secrets'. Located expression: secrets.GOOGLE_SA_JSON`

로 실패했고 writer 본체는 실행되지 않았다.

이것은 안전한 fail-closed/ownership 정리가 아니라 **우발적 runtime break**다. schedule/write-capable 경로 자체는 repository에 남아 있다.

또 current `check:workflows`는 이 오류를 잡지 못했다. local composite action metadata도 Actions parser 관점에서 검증하는 coverage가 필요하다.

## 5. 정산 Atom-lock orchestration gap — 실제 scheduled failure로 확인

current main `.github/workflows/settlement-sync.yml`은 여전히 legacy:

- `scripts/sync-contract-from-ledger.mts`

를 호출한다.

latest observed scheduled run `35056578656`은:

- `시트 "정산"을(를) 찾지 못했습니다.`

로 실패했다.

current ledger contract는 `접수`, `취소`, `분납실적`, `완납실적`, `청구`다. production pin의 새 `scripts/sync-vehicle-lock-from-ledger.mts`는 `접수`/`취소`를 ERP5 Atom lock/unlock으로 처리하지만 **current scheduled orchestration에는 연결되지 않았다.**

따라서 `접수 → Atom lock`, `취소 → unlock`이 scheduled operation에서 실제 성공하도록 ownership과 실행 경로를 정리해야 한다.

## 6. 상품구분 색

production 7-canonical color SSOT 구조/잠금은 유지하되, 픽업구독 canonical 값은 여전히:

- `#C2185B`

이다. 최신 승인 색과의 불일치는 별도 미해소 항목이다. 해결은 `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 하고 channel-local hardcode를 만들지 않는다.

## 7. writer topology / mirror legacy

repository 기준 아래 둘은 계속 write-capable schedule을 가진다.

- `.github/workflows/sales-erp-hourly.yml`
- `.github/workflows/mirror-sync.yml`

`MIRROR_SOURCES`의 RP023 `from`에는 옛 Google Sheet가 남아 있지만 **canonical source 권한은 없다.**

canonical inventory source는 계속:

- RP006 = `ironrentcar.com`
- RP012 = `sokrc.com/api`
- RP023 = RebornCar

이다.

app/lib/components의 RTDB direct-open baseline 0 / `check:store` CI 래칫은 해소 상태를 유지한다. 이것을 scheduled writer topology 해소로 오인하지 않는다.

---

# Claude 구현 Owner의 즉시 우선순위

1. **same-output F01 writer 충돌부터 정리**한다. production의 `오공구독`/7-canonical 계약을 current main의 옛 `손오공구독`/5-type 계약으로 되돌리지 않는다.
2. `check:shop-data-parity`를 현재 cache/helper 구조에서도 ERP5 Firestore 경로를 의미적으로 검증하도록 고쳐 required CI를 다시 green으로 만든다.
3. `.github/actions/prepare-credentials/action.yml`의 composite-action metadata 오류를 고치고 local composite action 유효성 검사를 CI에 추가한다.
4. settlement scheduled path를 current ledger + ERP5 Atom lock 계약에 맞춘다. 실제 schedule에서 `접수` lock / `취소` unlock 성공을 확인한다.
5. `2e880cef...` current semantics 기준 정상 scheduled F01/F86 full-audit 성공을 독립 확인한다.
6. 픽업구독 색은 canonical map 한 곳에서만 해결하고 정규 publish/live effective format까지 확인한다.
7. mirror/sales legacy writer ownership은 명시적 repository 수준 결정으로 닫는다. UI disable이나 우발적 runtime failure에 의존하지 않는다.
8. 구현 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

이 entry point는 구현 지시의 요약이다. 세부 근거와 과거 판정은 `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목과 최신 dated audit를 우선한다.