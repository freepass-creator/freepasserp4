# 2026-09-16 — ChatGPT 독립 SSOT 감사: `308511563...` 운영 검증 완료

상태: **해소됨 + 잔존 이슈 확인**

## 1. 해소됨 — PR #312 production pin이 실제 운영 회차까지 완전 PASS

현재 production workflow `.github/workflows/erp5-ssot-refresh.yml`은 검증 엔진을 다음 commit으로 고정한다.

- `308511563d8e8f56dbd94f715469d8ae7ed9171a`

PR #312 merge:

- `59e45d8d69ae94ea7edb0e77e10fa3640bfe0bec`

직전 감사에서는 workflow_dispatch run `35044774559`가 진행 중이라 운영 PASS를 HOLD했다. 이번 재검증에서 해당 run은 `completed / success`로 종료됐고 다음 핵심 단계가 전부 성공했다.

- 원천 계약 검사
- 현재 원천 재수집
- 티카 유료옵션 감사
- ERP5 현재 원자 계산·반영
- 정책 참조 정합화
- 발행 snapshot 고정
- public catalog 발행 대사
- F01 판매시트 게시
- F86 발행 직전 백업
- F86 게시
- F86 ↔ 원자 칸 대조·신선도 감사
- 원자 ↔ F01 ↔ F86 칸 단위 대조
- 차번 셀 사진 링크 대조
- 회차 증거 artifact 보존

artifact:

- `erp5-ssot-snapshot-35044774559`
- digest `sha256:4498d645f463cb6ffd50b3a71595b1751590c9b49f0bc5e52ed467e17b570930`

따라서 `308511563...`은 이제 **계보 정합성뿐 아니라 실제 canonical source → ERP5 Atom → snapshot → F01/F86 → cross-audit까지 끝난 최신 완전검증 production pin**이다.

## 2. 확인됨 — F01/F86 상품구분 색은 같은 canonical map을 참조

production pin의 `lib/domain/sales-sheet-format.ts`는 `GUBUN_INK`를 `MASTER_CATEGORY_COLORS['분류']`에서 만들고,

- F01 `구분`
- F86/공급사 계열 `분류`

양쪽에 같은 표를 적용한다. 배차상태는 별도 `STATE_INK`다.

현재 production pin의 `lib/domain/category-colors.ts` 상품구분 값은:

- 신차렌트 `#B81A8C`
- 중고렌트 `#0D706B`
- 중고구독 `#6B3DB3`
- 신차구독 `#474D57`
- 픽업구독 `#C2185B`

이다.

main의 read-only workflow `F01 구분 칸 색 진단(읽기전용, 수동)` run `35045707947`도 success였지만, 이번 감사에서는 그 step의 원문 출력까지 확보하지 않았으므로 success 상태만으로 live F01에 렌더링된 각 HEX를 다시 확정하지 않는다.

## 3. 미해소 — F86 표시계약은 builder와 계속 불일치

production pin의 실제 코드에는 여전히:

- `scripts/build-channel-supplier-sheet.mts`가 `ensureNoticeTab()`을 호출해 `공지사항`을 보장하고,
- `lib/server/channel-f86-plan.ts`가 공급사 탭까지 `${company} ${mark} · ${N}대` 형식으로 만든다.

따라서 확정 요구인:

- 공지사항 탭 제거
- 종합만 시간+대수
- 공급사 탭은 `공급사명 + 대수`

는 아직 영구 구현되지 않았다. 수동 시트 수정은 다음 발행에서 되돌아갈 수 있다. 해결 위치는 F86 projection/builder이며 ERP5 Atom·가격·기간·canonical source는 바꾸지 않는다.

## 4. 변화 없음 — canonical source / 특수탭 / legacy writer latent risk

재검증 결과:

- RP006 아이언 = `ironrentcar.com`
- RP012 손오공 = `sokrc.com/api`
- RP023 오토플러스 = RebornCar
- 손오공 = `손오공구독` 별도 탭
- 오토플러스 = `오플구독` 별도 탭
- 공급사 고유 기간/요금 축 유지

legacy 쪽은 여전히:

- `.github/workflows/sales-erp-hourly.yml` cron `0 0-9 * * 1-5`
- `.github/workflows/mirror-sync.yml` cron `*/30 * * * *`
- `lib/domain/mirror-sources.ts` RP023 `from` = 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`

가 저장소에 남아 있다. canonical RP023은 RebornCar이므로 UI disable 상태에 의존하는 재활성화 위험 판정은 유지한다.

## 5. current main 최근 변경

감사 시작 시 main HEAD `6dbdd24d412a7ea3974e01ff02025bf31137cf70`은 `docs/ai-ssot-audit/.tmp-f86-rules-placeholder`만 추가한 문서성 commit이었고 CI run `35045588568`은 success였다. 따라서 run `35044774559` 이후 새 애플리케이션/비즈니스 로직 회귀는 이번 감사 범위에서 발견하지 않았다.

## Claude 구현 Owner에게 넘기는 결론

1. `308511563...`을 최신 완전검증 production pin으로 취급한다.
2. F86 표시계약은 builder/plan에서만 영구 반영한다.
3. 상품구분 색을 변경할 때 F01/F86을 따로 수정하지 말고 `MASTER_CATEGORY_COLORS['분류']` 한 곳을 기준으로 한다.
4. `docs/예약작업-지도.md`의 오래된 engine pin과 ACTIVE handoff 상태 설명을 정리한다.
5. legacy writer UI-disable 의존성은 계속 별도 위험으로 본다.

이번 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.
