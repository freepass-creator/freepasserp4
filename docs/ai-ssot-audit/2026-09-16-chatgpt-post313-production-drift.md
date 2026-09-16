# 2026-09-16 — ChatGPT 독립 감사: PR #313 이후 production 색/F86 사실관계 정정

상태: **MATERIAL CONFLICT / Claude 구현 Owner 확인 필요**

## 결론

PR #313의 최신 감사 항목은 `픽업구독` 색 문제를 `해소됨`으로 기록했지만, 현재 `main`과 실제 production pin을 교차검증하면 그 수정은 **production lineage에 들어가 있지 않다.** 또한 같은 항목의 “origin에는 F86 자동 발행 workflow가 없다”는 설명도 현재 repository 사실과 반대다.

이 문서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않고, 독립 감사 결과만 기록한다.

## 1. PR #313의 픽업 색 수정은 current production에 없음

현재 `main` HEAD:

- `c147b1362d4aaf86ad9dedbf4ac93fd025cf37d8`
- `docs: F01/F86 픽업구독 구분색 정정 감사로그 기록 (#313)`

이 commit은 `docs/AI-SSOT-AUDIT-LOG.md`만 변경한 문서 commit이다.

현재 production workflow `.github/workflows/erp5-ssot-refresh.yml` checkout ref:

- `308511563d8e8f56dbd94f715469d8ae7ed9171a`

`main`과 `308511563...` 양쪽의 `lib/domain/category-colors.ts`를 직접 확인하면 둘 다 실제로 다음 키를 가진다.

```ts
'분류': {
  '신차렌트': '#B81A8C',
  '중고렌트': '#0D706B',
  '중고구독': '#6B3DB3',
  '신차구독': '#474D57',
  '픽업구독': '#C2185B',
}
```

따라서 PR #313 감사 항목의 “`category-colors.ts`에는 `'분류'` 키 자체가 없다”는 설명은 current main/production 기준으로 사실이 아니다.

더 중요한 점은 `308511563...`의 `lib/domain/sales-sheet-format.ts`가:

```ts
export const GUBUN_INK = Object.entries(MASTER_CATEGORY_COLORS['분류'] ?? {})
```

로 실제 `GUBUN_INK`를 위 canonical map에서 생성한다는 것이다. 즉 현재 production engine의 `픽업구독` canonical 값은 여전히 `#C2185B`다.

PR #313에 적힌 `0F766E` 수정 commit `4647c484`는 `codex/rtdb-cutover-current` 작업 가지의 수정이며, current `main`이나 production pin `308511563...`에 반영된 근거가 없다.

### 판정

**PR #313의 “픽업구독 색 해소됨”은 production 기준으로 해소 판정 불가.** 수동 발행으로 live sheet가 잠시 teal이 됐더라도 현재 scheduled production engine이 같은 규칙을 보존하지 않으므로 다음 production publish에서 다시 덮일 수 있다.

## 2. PR #313의 “F86 자동 workflow 없음” 설명은 current repository와 반대

현재 `main`의 `.github/workflows/erp5-ssot-refresh.yml`은 같은 ERP5 snapshot으로 다음을 자동 수행한다.

- F01 판매시트 게시
- F86 발행 직전 백업
- `scripts/build-channel-supplier-sheet.mts --채널=하허호 --apply`로 F86 게시
- F86 ↔ Atom 감사
- Atom ↔ F01 ↔ F86 칸 단위 대조
- 차량번호/사진 링크 감사

따라서 PR #313 항목의 “이 저장소(origin)엔 F86을 쓰는 자동 workflow가 아직 없고 erp5-ssot-refresh는 F01만 발행한다”는 문장은 **명백히 stale/incorrect**다.

이 사실 때문에 F86 수동 서식 수정은 더더욱 publisher 원천에 반영되지 않으면 다음 자동/수동 production 발행에서 사라질 수 있다.

## 3. F86 `구분` 고정 초록은 승인된 최신 표시계약과 충돌

승인 handoff:

- `docs/ai-ssot-audit/2026-09-16-f86-display-rule-handoff.md`

여기서는 F86의 `배차상태`와 `상품구분`을 **각각 독립된 값별 텍스트 색상 체계**로 유지하도록 확정돼 있다.

하지만 current production pin `308511563...`의 `lib/domain/channel-retro-skin.ts`는:

1. `applyRetroSkin()`에서 모든 `addConditionalFormatRule` 요청을 제거하고,
2. `BODY_INK.구분 = '34A853'`을 공급사 탭 `구분` 열 전체에 고정 적용한다.

따라서 F86은 현재 product-type별 `GUBUN_INK`를 최종 렌더링에서 표현하지 못하고, `픽업구독/신차렌트/중고렌트/...`가 모두 같은 초록으로 보일 수 있다.

PR #313 감사 항목은 이 초록을 “기존 확정 규격이며 이번 건과 무관”으로 처리했지만, **최신 permanent display handoff와 현재 사용자 승인 요구 기준으로는 충돌**이다.

### 판정

이 문제는 ERP5 Atom/canonical source 문제가 아니라 **F86 projection/presentation drift**다. 수정 위치는 F86 formatter/retro-skin/publisher 계열이며 가격·기간·원자 의미를 바꾸면 안 된다.

## 4. 변동 없음 — canonical source / 특수탭 / legacy latent risk

이번 독립 재검증에서 아래는 최신 감사 결론과 동일하다.

- canonical source: RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=`RebornCar`
- 손오공=`손오공구독` 별도 탭, 오토플러스=`오플구독` 별도 탭, 공급사 고유 기간/요금 유지
- `mirror-sync.yml` cron `*/30 * * * *` 잔존
- `sales-erp-hourly.yml` cron `0 0-9 * * 1-5` 잔존
- `MIRROR_SOURCES` RP023 `from`은 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U` 잔존

GitHub UI에서 legacy workflow가 실제 disabled인지 이번 connector 범위에서는 독립 확인하지 못했으므로 active 충돌로 단정하지 않고 기존 **latent conflict** 판정을 유지한다.

## 5. 최근 CI의 의미

`main` HEAD `c147b136...`에 대한 CI run `35050789201`은 `success`다. 다만 HEAD 자체가 감사문서만 바꾼 commit이므로 이 초록불은 `4647c484` 색 수정이 production pin에 들어갔거나 F86 표시 drift가 해소됐다는 증거가 아니다.

## Claude 구현 Owner에게 넘기는 정확한 작업

1. PR #313의 `해소됨` 판정을 production 기준으로 다시 연다.
2. 원하는 `픽업구독` 토큰을 **실제 production engine lineage**의 canonical 상품구분 표 한 곳에 반영한다. 임의 HEX를 새로 만들지 않는다.
3. F01/F86이 같은 canonical product-type map을 소비하도록 유지하되, F86 `channel-retro-skin`이 값별 색을 삭제하고 고정 초록으로 덮는 현행 동작을 최신 표시계약과 맞춘다.
4. F86의 별도 미해소 표시계약(공지사항 제거 / 종합만 시간+대수 / 공급사 탭 이름+대수)도 같은 projection 레이어에서 처리한다.
5. production pin/validated allowlist를 함께 맞춘 뒤 실제 `erp5-ssot-refresh` apply 회차로 F01/F86 publish + cross-audit + photo-link audit를 완료하고, 마지막으로 Google Sheets `effectiveFormat`을 F01/F86 양쪽에서 확인한다.

ChatGPT 감사 세션은 위 사실 확인과 문서 기록만 수행하며 application code/business logic는 수정하지 않는다.
