# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 AI/Claude 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

위 handoff의 역할 분리 원칙은 유효하지만, 상태 설명은 **이 파일 + `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목 + 최신 dated audit**를 우선한다.

최신 독립 감사 근거:

- `docs/AI-SSOT-AUDIT-LOG.md`의 `2026-09-16(16)`
- `docs/ai-ssot-audit/2026-09-16-chatgpt-2e880cef-source-contract-resolution.md`
- `docs/ai-ssot-audit/2026-09-16-chatgpt-rtdb-zero-ratchet.md`
- 직전 완전 production full-run 기준: `docs/ai-ssot-audit/2026-09-16-chatgpt-run14-production-pass.md`

---

## 작업 전 불변 원칙

1. `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다.
2. F01/F86/손오공/오토플러스/고객면은 projection이다. Projection을 canonical Source로 역류시키지 않는다.
3. production pin과 current `main`을 반드시 구분한다.
4. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다. workflow, writer topology, mirror/RTDB legacy path까지 같이 본다.
5. 손오공은 별도 `오공구독`, 오토플러스는 별도 `오플구독`을 유지하고 공급사 고유 기간·주행거리·요금 구조를 보존한다.
6. 실제 코드 수정은 Claude 단일 구현 세션만 한다. ChatGPT findings는 근거를 재확인한 뒤 처리한다.
7. 과거 감사 판정은 삭제하지 않는다. 해소/정정 시 감사 기록에 새 항목으로 남긴다.

---

# 현재 최신 판정 — 2026-09-16

## 1. current production pin은 `2e880cef...`

current `.github/workflows/erp5-ssot-refresh.yml` checkout ref:

- `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`

current `main` HEAD가 #325를 반영한 시점의 기준 commit은:

- `c8234f4155f51ab2aae63f411d2531b0c62ceb17`

이 production lineage는 F01과 F86을 같은 ERP5 snapshot에서 발행·감사한다.

확인된 F86 projection 동작:

- 하허호 F86은 `공지사항`을 새로 만들지 않고 기존 묵은 공지도 제거 대상
- `종합`이 첫 탭
- `종합`만 timestamp + 대수
- 공급사 탭은 timestamp 없이 `회사 · N대`
- 장기 요금 없는 차량도 제외하지 않고 요금 칸만 빈 채 싣기
- F01/F86 교차 감사 및 차량번호 사진링크 감사가 production workflow에 포함

## 2. 해소됨 — main Source Contract가 current production pin을 승인함

과거 `1f923d27...`이 allowlist에 없어 실패하던 governance HOLD는 현재 상태가 아니다.

current main `scripts/check-inventory-source-contract.mts`의 `VALIDATED_ENGINES`에는 다음이 포함된다.

- `1939018a8edb0f4993d61e12e5e0df4864ca9cb8`
- `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`
- `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`

실제 current-main checks 증거:

- `source-contract` — run `35067923610`, **success**
- `verify` — run `35067923638`, **success**

따라서 `(13)~(15)`의 “main이 자기 production engine을 승인하지 못한다”는 HOLD는 **해소됨**으로 본다.

## 3. 중요 변경 — `2e880cef...`은 collector 의미도 변경함

이 repin은 presentation-only가 아니다.

`2e880cef...`에는 다음이 함께 들어 있다.

- 차량번호: 사진/차번 링크가 있는 줄만 파랑, 링크 없으면 검정
- 새 `sync-vehicle-lock-from-ledger.mts`: 정산원장 `접수` → 원자 `계약중` lock, `취소` → lock 해제 의도
- `ingest-supplier-to-firestore.mts`의 “계약중이면 원천에서 사라져도 유지” 예외 제거
  - 계약중 차량도 canonical source에서 이탈하면 출고불가/계약완료 방향으로 반영
- 상품구분/표시낱말 SSOT 잠금(`check:color-ssot`)
- 7개 canonical 상품구분 모두 canonical 색상표에서 커버하도록 검사

단, Source Contract가 검사하는 fail-closed 가드(`SSOT HARD GUARD`, `inventory-source-registry`, `process.exit(2)`)와 canonical source 주소는 유지된다.

Claude는 이 engine을 단순 “F86 서식 변경 pin”으로 보면 안 된다. **원천 이탈 시 상태 천이 규칙이 바뀐 production engine**이다.

### 중요 충돌 — 새 정산원장 Atom lock 도구는 아직 scheduled orchestration에 연결되지 않음

current main과 production pin `2e880cef...`의 `.github/workflows/settlement-sync.yml`은 여전히:

- `scripts/sync-contract-from-ledger.mts`

를 호출한다. 이 옛 스크립트는 `SETTLEMENT_LEDGER_TAB`을 읽고, current `lib/domain/settlement-ledger.ts`에서 그 호환 상수는 `정산`이다. 반면 current 운영 원장은 `접수`, `취소`, `분납실적`, `완납실적`, `청구` 다섯 탭을 정본으로 두고 `정산`은 옛 도구 호환 이름으로만 남긴다.

새 `scripts/sync-vehicle-lock-from-ledger.mts`는 current `접수`/`취소` 탭에 맞춰 만들어졌지만, 이번 독립 감사에서는 `settlement-sync.yml`이나 `erp5-ssot-refresh.yml`의 **실제 실행 step**으로 연결된 흔적을 찾지 못했다. production workflow에는 해당 기능을 설명하는 주석만 있다.

따라서 **“정산원장 접수→Atom lock / 취소→unlock”을 정규 자동운영에서 이미 동작한다고 간주하면 안 된다.** 구현 Owner가 기존 supplier-sheet mutation 경로와 새 Atom-lock 경로의 ownership을 정리하고 scheduled path를 맞춰야 한다.

## 4. HOLD — current pin의 정규 production full-run 증거는 별도 확인 필요

PR #324 commit 기록에는 `2e880cef...`에서:

- `tsc`
- `check:f86`
- `check:color-ssot`
- F01/F86 수동 발행 live 검증
- 오공구독 `#5B21B6`, 오플구독 `#A16207`
- 차량번호 링크색 mismatch 0

이 기록되어 있다.

하지만 독립 감사 기준으로는 **`2e880cef...`을 실제 checkout한 정규 `erp5-ssot-refresh` 회차가 canonical source 수집 → ERP5 Atom → snapshot → F01/F86 → F86↔Atom → Atom↔F01↔F86 → 사진링크 감사까지 끝까지 성공한 Actions 증거를 아직 별도로 확정하지 않았다.**

Source Contract/CI green 및 수동 live publish와 정규 production full-run은 구분해서 본다.

## 5. 픽업구독 canonical 색은 여전히 `#C2185B`

production pin `2e880cef...`의 `lib/domain/category-colors.ts`:

- `MASTER_CATEGORY_COLORS['분류']['픽업구독'] = '#C2185B'`

현재 canonical map은 7개 상품구분을 모두 포함한다.

- 신차렌트 `#B81A8C`
- 중고렌트 `#0D706B`
- 중고구독 `#6B3DB3`
- 신차구독 `#474D57`
- 픽업구독 `#C2185B`
- 오공구독 `#5B21B6`
- 오플구독 `#A16207`

`check:color-ssot`은 이 7개가 **한 canonical map에서 빠지지 않는 것**을 잠근다. 그러나 side branch/manual publish에서 검증됐던 teal `#0F766E`가 canonical에 채택됐다는 뜻은 아니다.

코드 주석은 오히려 픽업구독의 기존 자홍색을 유지한다고 명시한다. 따라서 변경한다면 `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 처리한다. channel-local 색표를 새로 만들지 않는다.

## 6. writer topology — legacy scheduled writer 둘 다 repository 기준 active-capable

### `sales-erp-hourly.yml`

current `.github/workflows/sales-erp-hourly.yml`:

- schedule `0 0-9 * * 1-5`
- schedule event이면 `scripts/cloud-hourly-sync.mts --apply`
- credential preparation도 #317 이후 실제 실행 가능한 형태로 수리됨

따라서 이 경로는 단순 dead file로 보지 않는다.

### `mirror-sync.yml`

current `.github/workflows/mirror-sync.yml`:

- schedule `*/30 * * * *`
- repository-level fail-closed `if` 없음
- schedule event이면 `scripts/sync-mirror-all.mts --apply`

GitHub Actions UI에서 disabled라면 실제 dispatch가 막힐 수 있지만 **repository 코드 자체는 disable을 강제하지 않는다.**

current `lib/domain/mirror-sources.ts` RP023:

- old Google Sheet `from = 1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`

canonical RP023은 RebornCar이므로 이 mirror 경로는 projection/legacy 용도일 뿐 canonical inventory source 권한을 가져서는 안 된다.

## 7. 해소 유지 — app/lib/components RTDB direct-open baseline 0

PR #321 이후:

- `app`, `lib`, `components`에서 명시적 swap/adapter를 우회한 RTDB 직접 열기 baseline = **0**
- `npm run check:store`가 main CI에 연결돼 새 direct-open을 막음

이 해소는 유지한다.

단, 이것은 §6의 legacy scheduled writer가 없어졌다는 뜻이 아니다. **RTDB direct-open 0과 writer topology 단일화는 별개 판정**이다.

## 8. canonical source / 특수 판매탭 계약 유지

current canonical registry:

- RP006 아이언 = `ironrentcar.com`
- RP012 손오공 = `sokrc.com/api`
- RP023 오토플러스 = `reborncar.co.kr`

production pin `2e880cef...`의 tab routing:

- 손오공 RP012: 픽업 외 차량은 `오공구독`
- 오토플러스 RP023: `오플구독`
- 픽업 대상은 `픽업구독`
- 그 외는 `상품리스트`

공급사 고유 기간·주행거리·요금 축을 유지하고 공통화는 projection 표현 수준에서만 한다.

---

# Claude 구현 Owner의 즉시 우선순위

1. **정산원장 lock orchestration부터 정합화한다.** `settlement-sync.yml`의 옛 `sync-contract-from-ledger.mts`/`정산` 탭 경로와 새 `sync-vehicle-lock-from-ledger.mts`/`접수·취소` Atom-lock 경로의 ownership을 하나로 정리하고, 실제 scheduled path가 current 원장 계약을 따르게 한다.
2. 그 뒤 `2e880cef...` 기준 **정규 `erp5-ssot-refresh` full-run**이 F01/F86/cross/photo audit까지 정상 완료됐는지 Actions 증거를 확인한다.
3. `2e880cef...`의 **계약중 차량 원천 이탈 → 출고불가/계약완료** 변경을 임의로 옛 “락이면 보존” 예외로 되돌리지 않는다. 정산 lock과 source-retirement 규칙의 역할을 구분한다.
4. 픽업구독 색 변경 시 `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 처리하고 `check:color-ssot`를 유지한다.
5. `sales-erp-hourly.yml`과 `mirror-sync.yml`을 active-capable scheduled writer로 보고 실제 ownership/disable 방식을 repository 수준에서 명시적으로 정리한다. UI disable만으로 안전하다고 간주하지 않는다.
6. RTDB direct-open baseline 0을 유지한다.
7. RP023 old Google Sheet mirror를 canonical source로 승격하지 않는다. RP023 canonical은 계속 RebornCar다.
8. 구현 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

이 entry point는 구현 지시의 요약이다. 세부 근거와 과거 판정은 `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목과 최신 dated audit를 우선한다.