# ChatGPT 독립 감사 — current main ↔ production F01 contract drift

- 감사일: 2026-09-16
- current main: `cb06553a08a4a596de51c52fa9d265bb05d1f322`
- production pin: `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`
- 역할: 독립 감사만 수행. 애플리케이션/비즈니스 로직 수정 없음.

## 결론

current production pin과 current main의 F01 상품구분/특수탭 계약이 서로 다르다. 이 차이는 main이 단순 웹앱 코드만 가진 상태라면 즉시 운영 충돌이라고 할 수 없지만, current main의 `sales-erp-hourly.yml`이 schedule을 보유하고 같은 F01 Google Sheet에 `--apply`로 쓰는 경로를 유지하므로 **active-capable same-output writer conflict**로 본다.

## 1. production pin의 정본 계약

`2e880cef...:lib/domain/sales-published-tabs.ts`:

- 발행 탭 정본 = `상품리스트`, `오공구독`, `픽업구독`, `오플구독`
- `손오공구독`은 읽기 호환 alias로만 허용하고 발행은 `오공구독`으로 canonicalize

`2e880cef...:lib/intake/entities.ts`:

- `PRODUCT_TYPES` = `신차렌트`, `중고렌트`, `신차구독`, `중고구독`, `오플구독`, `픽업구독`, `오공구독`
- `손오공구독`/`손오공 구독`은 `오공구독` alias

`2e880cef...:lib/domain/category-colors.ts` + `check:color-ssot`:

- 7개 canonical 상품구분을 한 canonical map에서 커버
- 소비처 하드코딩 회귀를 `check:color-ssot`로 잠금

## 2. current main의 계약은 뒤처져 있음

`cb06553...:lib/domain/sales-published-tabs.ts`:

- 발행 탭 배열 = `상품리스트`, `손오공구독`, `픽업구독`, `오플구독`
- production pin에 있는 `canonicalSalesTabName()`이 없음

`cb06553...:lib/intake/entities.ts`:

- `PRODUCT_TYPES`가 5개(`신차렌트`, `중고렌트`, `신차구독`, `중고구독`, `픽업구독`)뿐
- `오공구독`, `오플구독`이 canonical enum/legacy alias에 없음
- 다만 `canonProductType()`은 모르는 구독 갈래를 임의로 `중고구독`으로 접지 않고 원문을 보존하므로, 이 사실만으로 current guest 화면이 오공/오플을 중고구독으로 오표시한다고 단정하지 않는다.

`cb06553...:lib/domain/category-colors.ts`:

- 상품구분 map이 5개뿐이고 `오공구독`, `오플구독`이 없음

`cb06553...:package.json`:

- main의 `check:sync`에는 production pin의 `check:color-ssot` 잠금이 없음
- current main에는 `scripts/check-color-ssot.mts` 자체가 없음

## 3. 이 차이는 dead-code drift가 아니라 같은 F01을 쓰는 경로에 연결됨

current main `.github/workflows/sales-erp-hourly.yml`:

- schedule `0 0-9 * * 1-5`
- schedule event이면 `scripts/cloud-hourly-sync.mts --apply`

current main `scripts/hourly-sync.mts`의 실제 F01 발행:

- `publish-origin-tab.mts`로 상품리스트 발행
- `--only=RP012:구독 --tab=손오공구독 --at=1`로 손오공 탭 발행
- 픽업구독/오플구독도 같은 회차에서 발행

current main `scripts/publish-origin-tab.mts` 기본 SHEET:

- `1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs`

production pin `scripts/make-sample-sheet-google.mts --main`의 `SRC_SHEET`도 정확히 같은:

- `1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs`

이다.

production pin의 F01 writer는 `production-sheet-write-gate`를 통과해야 하지만, current main의 `publish-origin-tab.mts` legacy writer는 그 gate를 사용하지 않는다.

따라서 `sales-erp-hourly.yml`이 실제 enabled 상태라면 production writer가 만든 `오공구독`/7캐논 계약과 **같은 F01 문서를 old `손오공구독` 계약으로 다시 쓸 수 있다.** 구체적으로 탭 중복/구형 탭 재생성/서식·색 계약 불일치 위험이 있다. 이번 감사에서는 GitHub UI enable/disable 상태를 독립 확정하지 못했으므로 실제 동시쓰기 사고가 발생했다고 단정하지 않고, repository 기준 `active-capable conflict`로 판정한다.

## 4. main ↔ production 분리는 F86/정산 lock에서도 확인됨

current main에는 `lib/server/channel-f86-plan.ts`가 없지만 production pin에는 존재한다. 또한 새 `scripts/sync-vehicle-lock-from-ledger.mts`는 production pin 계보에 있으나 current main에는 없다. current main `settlement-sync.yml`은 여전히 옛 `sync-contract-from-ledger.mts`를 호출한다.

즉 현재 구조는 단순히 main이 production pin보다 몇 줄 뒤처진 것이 아니라, **production projection/collector 계보와 current main legacy writer 계보가 서로 다른 운영계약을 가진 채 공존**하는 상태다.

## 5. canonical source와 mirror 판정은 변화 없음

current main canonical registry:

- RP006 = `ironrentcar.com`
- RP012 = `sokrc.com/api`
- RP023 = RebornCar

반면 `MIRROR_SOURCES` RP023은 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`를 계속 `from`으로 가진다. `mirror-sync.yml`도 repository-level fail-closed guard 없이 30분 schedule/`--apply` 경로를 유지한다. mirror는 projection/legacy일 뿐 canonical source가 아니다.

## 6. CI/최근 main

- audit 시점 current main = `cb06553...` (PR #326)
- 직전 `f4d57258...` main CI run `35073100855` = success
- `cb06553...` CI run `35073829492`는 감사 시점 `in_progress`
- PR #326은 guest/public 정책 노출 정리 변경으로, 위 F01 contract drift를 직접 해소하는 변경은 아님

## 독립 감사 판정

1. **신규 구체적 충돌:** production pin과 current main의 F01 특수탭/상품구분 SSOT가 다름.
2. **운영 영향 있음:** current main legacy hourly writer가 production F01과 같은 spreadsheet에 old contract로 쓸 수 있음.
3. **색 SSOT 잠금도 main에는 없음:** production의 7캐논 색 계약을 main legacy writer가 보장하지 못함.
4. **정산 Atom-lock orchestration gap 유지:** 새 lock tool은 production pin 계보에만 있고 current main scheduled workflow에는 미연결.
5. **canonical source 계약 변화 없음:** RP023 canonical은 RebornCar, old Google Sheet는 mirror/legacy일 뿐.
6. **current pin full-run HOLD 유지:** `2e880cef...`의 정규 production full-run 성공을 독립 확정하는 새 Actions 증거는 이번 감사에서 확인하지 못함.

## Claude 구현 Owner에게 넘길 조치

- `sales-erp-hourly.yml`을 단순히 “남아 있는 옛 workflow”로 보지 말고, **같은 F01을 old schema로 쓰는 writer**로 취급한다.
- 선택지는 구현 Owner가 정하되, production F01 sole-writer 원칙을 강제해야 한다: legacy schedule 제거/명시적 fail-closed/production gate 적용/완전 소비자화 중 하나.
- current main이 앞으로 F01을 쓸 가능성을 남긴다면 `오공구독` + 7 canonical product types + canonical color map/lock을 production pin과 같은 계약으로 맞춰야 한다. 반대로 main legacy writer를 retire한다면 old projection code가 운영에 재진입하지 못하도록 repository 수준으로 막는다.
- production pin의 정본을 current main의 옛 `손오공구독` 계약으로 되돌리지 않는다.
- Atom/canonical source/공급사 고유 가격·기간 의미는 변경하지 않는다.
