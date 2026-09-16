# 2026-09-16 ChatGPT 독립 SSOT 감사 — `2e880cef` production 전진 / Source Contract HOLD 해소

## 범위

`CLAUDE-AUDIT.md`, `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목, current `main`, production workflow/engine pin, Source Contract, ERP5 canonical source registry, F01/F86 projection, 손오공·오토플러스 특수탭, legacy mirror/RTDB writer 경로, 최근 commit/CI를 독립 대조했다.

## 1. 해소됨 — Source Contract governance HOLD

current `main` HEAD는 `c8234f4155f51ab2aae63f411d2531b0c62ceb17` (#325)이고, `.github/workflows/erp5-ssot-refresh.yml`의 production checkout ref는 현재:

- `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`

이다.

current `scripts/check-inventory-source-contract.mts`의 `VALIDATED_ENGINES`에는 이제 `1939018a...`, `1f923d27...`, `2e880cef...`가 모두 명시적으로 포함된다.

main HEAD의 실제 GitHub Checks:

- `source-contract` — run `35067923610`, job `104702374975`, **success**
- `verify` — run `35067923638`, job `104702374928`, **success**

따라서 audit `(13)~(15)`의 “current production pin을 main Source Contract가 승인하지 못한다”는 HOLD는 **해소됨**이다.

## 2. 변경됨 — current production engine은 단순 presentation repin이 아니라 collector 의미까지 바꿈

`2e880cef...`은 `1f923d27...` 이후 다음을 포함한다.

- 차량번호: 사진/차번 링크가 있는 줄만 파랑, 링크 없으면 검정
- 정산원장 `접수` → 원자 `계약중` lock, `취소` → lock 해제
- `ingest-supplier-to-firestore.mts`의 “계약중이면 원천에서 사라져도 유지” 예외 제거
  - 즉 계약중 차량도 canonical source에서 사라지면 출고불가/계약완료 방향으로 반영
- 상품구분/표시낱말 SSOT 잠금(`check:color-ssot`)
- 7개 canonical 상품구분 모두 색상표에서 커버하도록 잠금

이 변경은 단순 F86 겉모양 수정이 아니라 **원천 이탈 시 상태 천이 규칙을 건드린 production collector 의미 변경**이다. 다만 Source Contract가 확인하는 fail-closed 가드(`SSOT HARD GUARD`, `inventory-source-registry`, `process.exit(2)`)와 canonical source 주소는 유지된다.

## 3. 확인됨 — F86 projection / 특수탭 / canonical source 계약 유지

production pin `2e880cef...` 직접 확인:

- F86 하허호는 `공지사항`을 새로 만들지 않고 기존 묵은 공지도 제거 대상
- `종합`이 첫 탭, `종합`에만 timestamp + 대수
- 공급사 탭은 timestamp 없이 `회사 · N대`
- 장기요금이 없는 차도 제외하지 않고 요금 칸만 빈 채 싣기
- F01/F86 모두 같은 Atom snapshot과 shared row/format 경로를 사용
- 손오공 RP012: 픽업 외 차량은 `오공구독` 탭
- 오토플러스 RP023: `오플구독` 탭

current canonical registry도 그대로다.

- RP006 = `ironrentcar.com`
- RP012 = `sokrc.com/api`
- RP023 = `reborncar.co.kr`

## 4. 미해소 — 픽업구독 canonical 색은 여전히 `#C2185B`

production pin `2e880cef...`의 `MASTER_CATEGORY_COLORS['분류']`는 7개 canonical 상품구분을 모두 커버하지만:

- `픽업구독 = #C2185B`

이다. side branch/manual publish에서 검증했던 teal `#0F766E`는 current canonical SSOT에 채택되지 않았다.

새 `check:color-ssot`은 “7개 모두 한 canonical map에 존재함”을 잠그는 개선이지만, **픽업구독 색 자체의 이전 감사 HOLD를 자동으로 해소하는 것은 아니다.** 코드 주석은 오히려 기존 자홍색을 유지한다고 명시한다. Claude 구현 Owner는 최신 사업결정이 자홍 유지인지 teal 전환인지 다시 확인한 뒤 canonical map 한 곳에서만 처리해야 한다.

## 5. 미해소 — legacy writer topology는 그대로 active-capable

current main:

- `.github/workflows/mirror-sync.yml`
  - `*/30 * * * *`
  - repository-level fail-closed guard 없음
  - schedule이면 `sync-mirror-all.mts --apply`
- `.github/workflows/sales-erp-hourly.yml`
  - `0 0-9 * * 1-5`
  - schedule이면 `cloud-hourly-sync.mts --apply`
- `lib/domain/mirror-sources.ts` RP023 `from`
  - 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`
- canonical RP023
  - RebornCar

따라서 RTDB direct-open 0 래칫이 유지되더라도 writer topology 단일화가 해소된 것은 아니다.

## 6. 보류 — `2e880cef...`의 정규 production full-run 증거

PR #324 commit 설명에는 `2e880cef...`에서 `tsc`, `check:f86`, `check:color-ssot` 통과 및 F01/F86 수동 발행 live 검증(오공구독/오플구독 색, 차량번호 링크색 mismatch 0)이 기록돼 있다.

하지만 이번 독립 감사에서는 **current pin `2e880cef...`을 실제 checkout한 정규 `erp5-ssot-refresh` 회차가 canonical source 수집 → ERP5 Atom → snapshot → F01/F86 → cross/photo audit까지 끝까지 성공한 Actions 증거를 별도로 확인하지 못했다.** Source Contract/verify green과 수동 live publish는 이 full-run 증거와 구분한다.

## 최종 판정

1. Source Contract HOLD — **해소됨** (`c8234f...`, run `35067923610` success).
2. current production pin — **`2e880cef...`로 변경됨**.
3. collector 의미 변경 — **계약중 차량 원천 이탈 예외 제거**를 포함하므로 Claude가 반드시 인지해야 함.
4. F86/특수탭/canonical source — **신규 회귀 없음**.
5. 픽업구독 canonical 색 `#C2185B` — **미해소**.
6. legacy scheduled writer topology — **미해소**.
7. current pin 정규 production full-run — **독립 검증 보류**.

이번 감사에서는 애플리케이션 코드·workflow·비즈니스 로직을 수정하지 않았다. 감사 문서만 기록한다.
