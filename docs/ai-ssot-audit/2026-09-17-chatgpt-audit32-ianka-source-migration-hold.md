# ChatGPT 독립 SSOT 감사 — audit 32: RP031 이안카 website/API 전환은 입증됐지만 canonical source는 아직 Google Sheet

검수일: 2026-09-17 21:31 KST

## 판정

**의미 있는 staged source migration / canonical source-contract HOLD. live cutover 완료로 보면 안 된다.**

audit (31) 이후 이안카 진단은 단순 사이트 탐색 수준을 넘어 실제 인증 재고 API까지 읽는 데 성공했다. 반면 current main과 active production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`의 ERP5 canonical source registry는 RP031을 계속 기존 Google Sheet 원천으로 고정한다. 따라서 현재 운영 production은 여전히 시트 원천이고, 새 website/API는 검증된 **후보 원천**일 뿐 canonical cutover가 아니다.

## 증거 1 — RP031 source 전환 의도는 이미 명시됨

PR #347 / merge `772c5c4db20eb9b4cf41053612fa7d107c5478c4`는 RP031 이안카를 기존 Google Sheet mirror 대신 홈페이지에서 직접 수집하기로 한 결정을 기록했다. 이후 진단에서 실제 대상 호스트는 `https://xn--le5bt3bwxk.com`으로 정정됐다.

## 증거 2 — 실제 인증 API read path가 동작함

PR #358 / merge `ef3a280441f96dee3ccfb999b8f7901a6129031c`에서 로그인 경로가 `POST /api/auth/login` → 세션 쿠키 → `GET /api/inventory`임을 확인했고, workflow run `35218355737`이 성공했다.

PR #363 / merge `ad51c7c0648331e54d560c1a8641a01cf67bda37`의 run `35221351753`도 성공했으며 실제 로그는 다음을 반환했다.

- `GET /api/inventory → 200`
- `total=85`, `fleetTotal=950`, `reservedTotal=20`, `stale=false`
- `models[].units[]` 합계 85대
- `status`: `available` 84대 + `merchandising` 1대
- `available === true`: 85대

따라서 endpoint와 인증 경로 자체는 실측됐다. 동시에 **`status=merchandising` 1대도 `available=true`**이므로 `available` boolean 하나만 ERP5 `출고가능`으로 직결하면 상태 의미를 잃을 수 있다. RP031 adapter는 status/available 우선순위를 명시해야 한다.

## 증거 3 — main과 production은 아직 기존 Sheet를 canonical으로 사용

current main `lib/domain/inventory-source-registry.ts`의 RP031:

- `kind: 'google_sheet'`
- `adapterId: 'ianka'`
- `spreadsheetId: 1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs`

active production pin `9bef7bf...`도 동일하다. production `scripts/ingest-all-suppliers.mts`는 registry를 순회하고, `scripts/ingest-supplier-to-firestore.mts`는 `kind === 'google_sheet'`인 RP031을 sheet collector로 처리한다.

즉 website/API 진단 성공은 production ingest 경로를 바꾸지 않았다.

## 증거 4 — Source Contract CI는 RP031 source intent를 별도 잠그지 않음

current `scripts/check-inventory-source-contract.mts`는 24개 registry 기본 형식과 RP006/RP012/RP023 특수 원천은 명시적으로 assert하지만 RP031의 source kind/location은 별도 assert하지 않는다. current main CI run `35221347225`가 green인 것은 repository consistency 증거이지, RP031의 새 source-cutover 결정이 canonical registry에 반영됐다는 증거가 아니다.

## Claude 구현 Owner 인계

1. RP031은 당장 registry를 바꾸지 말고 website/API adapter를 먼저 완성한다. 현재 production sheet를 임의 폐기하지 않는다.
2. 차량번호 기준으로 website/API ↔ 현재 sheet ↔ ERP5 Atom의 대수·상태·가격/기간 필드를 대조한다. 특히 `status`와 `available`의 1대 불일치를 명시적 상태 매핑으로 결정한다.
3. parity와 필드 의미가 확정되면 `inventory-source-registry.ts`의 RP031을 새 canonical source로 바꾸고 production pin/collector와 `check-inventory-source-contract.mts`의 RP031 assert를 같은 promotion에 묶는다.
4. RP031 projection sheet는 정책/표시용 역할과 재고 canonical 역할을 분리해 유지 여부를 정한다. mirror/RTDB 경로를 새 canonical로 승격시키지 않는다.
5. cutover 완료 판정은 실제 canonical scheduled source→Atom→snapshot→F01/F86 회차 증거로 한다. audit (31)의 `event=schedule` 0건 HOLD는 여전히 별도 OPEN이다.

## 기존 OPEN/HOLD

audit (23) F86 freshness checker, audit (27) 손오공 deposit recurrence, audit (28) vehicle-price semantics, audit (29) sales-tab migration, mirror/sales/settlement/RTDB legacy writer ownership은 직접 해소 증거가 없어 유지한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
