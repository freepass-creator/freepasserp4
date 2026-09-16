# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 AI/Claude 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

상태 설명은 **이 파일 + `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목 + 최신 dated audit**를 우선한다.

최신 독립 감사 근거:

- `docs/AI-SSOT-AUDIT-LOG.md`의 최신 항목
- `docs/ai-ssot-audit/2026-09-16-chatgpt-main-vs-production-f01-contract-drift.md`
- `docs/ai-ssot-audit/2026-09-16-chatgpt-2e880cef-source-contract-resolution.md`
- `docs/ai-ssot-audit/2026-09-16-chatgpt-rtdb-zero-ratchet.md`
- 직전 완전 production full-run 기준: `docs/ai-ssot-audit/2026-09-16-chatgpt-run14-production-pass.md`

---

## 작업 전 불변 원칙

1. `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다.
2. F01/F86/오공구독/오플구독/픽업구독/고객면은 projection이다. Projection을 canonical Source로 역류시키지 않는다.
3. **production pin과 current `main`은 현재 같은 코드계보/계약이 아니다. 반드시 따로 읽는다.**
4. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다. workflow, same-output writer, mirror/RTDB legacy path까지 같이 본다.
5. production 계약상 손오공 RP012 비픽업 구독은 `오공구독`, 오토플러스 RP023은 `오플구독`, 픽업은 `픽업구독`으로 분리하고 공급사 고유 기간·주행거리·요금 구조를 보존한다.
6. 실제 코드 수정은 Claude 단일 구현 세션만 한다. ChatGPT findings는 근거를 재확인한 뒤 처리한다.
7. 과거 감사 판정은 삭제하지 않는다. 해소/정정 시 감사 기록에 새 항목으로 남긴다.

---

# 현재 최신 판정 — 2026-09-16

## 1. current production pin은 `2e880cef...`

current `.github/workflows/erp5-ssot-refresh.yml` checkout ref:

- `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`

이번 독립 감사가 읽은 애플리케이션 코드 기준 current-main HEAD는 PR #326 merge:

- `cb06553a08a4a596de51c52fa9d265bb05d1f322`

그 뒤 ChatGPT가 추가한 변경은 감사 문서뿐이다. 애플리케이션/비즈니스 로직은 수정하지 않았다.

production pin은 같은 ERP5 snapshot으로 F01/F86을 발행·감사하며 다음 규칙을 가진다.

- F01 canonical tabs: `상품리스트` / `오공구독` / `픽업구독` / `오플구독`
- F86: `종합` 첫 탭, 종합만 timestamp+대수, 공급사 탭은 timestamp 없이 회사명+대수
- 장기요금 없는 차량도 싣고 요금 칸만 비움
- F01/F86 cross-audit 및 차량번호 사진링크 감사 포함

## 2. 해소 유지 — Source Contract는 `2e880cef...`을 승인함

PR #325 이후 main `VALIDATED_ENGINES`에 `2e880cef...`가 포함되고:

- `SSOT Source Contract` run `35067923610` — success
- generic CI run `35067923638` — success

이므로 과거 production-pin allowlist HOLD는 해소된 상태다.

단, `2e880cef...` 자체의 **정규 production full-run**은 Source Contract/수동발행과 별도다. canonical source → ERP5 Atom → snapshot → F01/F86 → cross/photo audit까지 `2e880cef...`을 checkout한 완료 Actions 증거는 독립 재확인 전까지 HOLD로 둔다.

## 3. 신규 중요 충돌 — current main legacy hourly writer가 production과 같은 F01을 다른 계약으로 씀

이제 legacy writer 위험을 단순히 “cron이 남아 있음”으로만 보면 부족하다. **실제 same-output schema conflict**가 확인됐다.

### production pin `2e880cef...`

`lib/domain/sales-published-tabs.ts`:

- canonical publish tabs = `상품리스트`, `오공구독`, `픽업구독`, `오플구독`
- 옛 `손오공구독`은 읽기 호환 alias이며 발행 시 `오공구독`으로 canonicalize

`lib/intake/entities.ts`:

- 7 canonical product types = `신차렌트`, `중고렌트`, `신차구독`, `중고구독`, `오플구독`, `픽업구독`, `오공구독`
- `손오공구독`/`손오공 구독` → `오공구독` alias

`lib/domain/category-colors.ts` + `check:color-ssot`:

- 7개 product type을 한 canonical color map에서 커버하고 소비처 하드코딩을 잠금

### current main `cb06553...`

`lib/domain/sales-published-tabs.ts`:

- publish tabs = `상품리스트`, **`손오공구독`**, `픽업구독`, `오플구독`
- production pin의 `canonicalSalesTabName()` 없음

`lib/intake/entities.ts`:

- `PRODUCT_TYPES`가 5개(`신차렌트`, `중고렌트`, `신차구독`, `중고구독`, `픽업구독`)뿐
- `오공구독`, `오플구독`이 canonical enum/alias에 없음
- 다만 `canonProductType()`은 모르는 구독 갈래를 임의로 `중고구독`으로 접지 않고 raw value를 보존하므로, 이 사실만으로 guest 화면 오표시를 단정하지 않는다.

`lib/domain/category-colors.ts`:

- product-type canonical map이 5개뿐이며 `오공구독`, `오플구독` 없음

`package.json`:

- main `check:sync`에 production pin의 `check:color-ssot` 없음
- current main에는 `scripts/check-color-ssot.mts` 자체가 없음

### 왜 이게 실제 writer conflict인가

current main `.github/workflows/sales-erp-hourly.yml`은:

- schedule `0 0-9 * * 1-5`
- schedule이면 `cloud-hourly-sync.mts --apply`

를 실행한다. 이어 `scripts/hourly-sync.mts`는 F01에:

- 상품리스트
- **`--only=RP012:구독 --tab=손오공구독 --at=1`**
- 픽업구독
- 오플구독

을 발행한다.

더 중요한 점은 current main `scripts/publish-origin-tab.mts` 기본 SHEET와 production pin `scripts/make-sample-sheet-google.mts --main`의 `SRC_SHEET`가 **동일한 F01 문서**라는 것이다.

- `1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs`

production F01 writer는 `production-sheet-write-gate`를 통과하지만 current main legacy `publish-origin-tab.mts`는 이 gate를 사용하지 않는다.

따라서 `sales-erp-hourly.yml`이 GitHub UI에서 enabled라면 **production이 만든 `오공구독`/7캐논 계약의 동일 F01을 current main이 옛 `손오공구독` 계약으로 다시 쓸 수 있다.** 탭 중복/구형 탭 재생성/서식·색 계약 불일치 가능성이 있는 구체적 same-output conflict다.

이번 독립 감사에서는 Actions UI enable/disable 상태를 확정하지 못했으므로 실제 동시쓰기 사고가 발생했다고 단정하지 않는다. 그러나 repository 기준으로는 `active-capable writer conflict`다.

상세 근거:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-main-vs-production-f01-contract-drift.md`

## 4. 정산 Atom-lock orchestration gap은 유지 — 새 도구는 production pin에만 있음

정정해서 읽어야 한다.

- `scripts/sync-vehicle-lock-from-ledger.mts`는 production pin `2e880cef...` 계보에 존재
- **current main에는 이 파일이 없음**
- current main `.github/workflows/settlement-sync.yml`은 여전히 옛 `scripts/sync-contract-from-ledger.mts`를 호출
- `erp5-ssot-refresh.yml`에도 새 lock tool 실제 실행 step은 없음

따라서 “정산원장 `접수` → Atom `계약중` lock / `취소` → unlock”을 정규 scheduled operation이 이미 수행한다고 보면 안 된다.

Claude 구현 Owner는 기존 supplier-sheet mutation 경로와 production pin Atom-lock 경로 중 ownership을 명확히 하고 scheduled orchestration을 current ledger contract에 맞춰야 한다.

## 5. 상품구분 색 — production 구조는 7캐논 잠금, 픽업 최신 색은 여전히 미해소

production pin `2e880cef...` canonical map:

- 신차렌트 `#B81A8C`
- 중고렌트 `#0D706B`
- 중고구독 `#6B3DB3`
- 신차구독 `#474D57`
- 픽업구독 `#C2185B`
- 오공구독 `#5B21B6`
- 오플구독 `#A16207`

`check:color-ssot`은 7개가 canonical map에서 빠지지 않는 것을 잠근다. 하지만 픽업구독 최신 승인색과 `#C2185B`의 불일치는 별개로 남아 있다.

current main의 5색 map을 production 정본으로 역수입하지 않는다.

## 6. writer topology — legacy scheduled writer 둘 다 repository 기준 active-capable

### `sales-erp-hourly.yml`

- schedule `0 0-9 * * 1-5`
- schedule이면 `cloud-hourly-sync.mts --apply`
- 동일 F01에 old `손오공구독` 계약으로 쓰는 구체적 same-output conflict가 §3에서 확인됨

따라서 **최우선 writer ownership 대상**이다.

### `mirror-sync.yml`

- schedule `*/30 * * * *`
- repository-level fail-closed guard 없음
- schedule이면 `sync-mirror-all.mts --apply`

current `MIRROR_SOURCES` RP023 `from`:

- old Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`

canonical RP023은 RebornCar다. mirror는 projection/legacy 용도일 뿐 canonical source가 아니다.

## 7. 해소 유지 — app/lib/components RTDB direct-open baseline 0

PR #321 이후:

- app/lib/components에서 명시적 swap/adapter를 우회한 RTDB direct-open baseline = 0
- `check:store`가 main CI에 연결됨

다만 scripts/workflows의 legacy writer 존재와는 별개 판정이다.

## 8. canonical source 유지

current main canonical registry:

- RP006 아이언 = `ironrentcar.com`
- RP012 손오공 = `sokrc.com/api`
- RP023 오토플러스 = `reborncar.co.kr`

current main mirror의 RP023 old Google Sheet를 canonical source로 승격시키지 않는다.

## 9. recent main/CI

이번 감사가 읽은 app/code main 기준:

- `cb06553a08a4a596de51c52fa9d265bb05d1f322` — PR #326
- 직전 `f4d57258440d50f6672a2b6c91941500c28e3cfd` CI run `35073100855` — success
- `cb06553...` CI run `35073829492`는 감사 시점 `in_progress`

PR #305/#326은 주로 guest/customer presentation 변경이며, 이번에 확인한 F01 writer contract split을 해소하는 변경은 아니다.

---

# Claude 구현 Owner의 즉시 우선순위

1. **`sales-erp-hourly.yml` ownership부터 정리한다.** 이건 단순 오래된 cron이 아니라 production과 같은 F01 문서를 옛 `손오공구독` 계약으로 쓰는 writer다. UI disable만 믿지 말고 repository 수준에서 production sole-writer를 강제한다.
2. 방법은 구현 Owner가 정하되, legacy schedule 제거 / explicit fail-closed / production write gate 적용 / 완전 read-only consumer화 중 하나로 **같은 F01에 두 계약이 쓰이지 않게 한다.**
3. current main이 앞으로도 F01을 쓸 가능성을 남긴다면 `오공구독` + 7 canonical product types + canonical color map/lock을 production pin과 같은 계약으로 맞춘다. 반대로 legacy writer를 retire하면 old projection code가 운영에 재진입하지 못하게 막는다.
4. **production 정본을 main의 옛 `손오공구독`/5캐논 계약으로 되돌리지 않는다.**
5. 정산 lock orchestration을 정리한다. 새 `sync-vehicle-lock-from-ledger.mts`는 production pin에만 있고 current main scheduled path에는 없다.
6. `2e880cef...` 기준 정규 `erp5-ssot-refresh` full-run 증거를 확인한다.
7. 픽업구독 색 변경 시 `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 처리하고 `check:color-ssot`를 유지한다.
8. `mirror-sync.yml` ownership/disable을 별도로 정리하고 RP023 old mirror를 canonical source로 승격시키지 않는다.
9. RTDB direct-open baseline 0을 유지한다.
10. 구현 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

이 entry point는 구현 지시의 요약이다. 세부 근거와 과거 판정은 `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목과 최신 dated audit를 우선한다.
