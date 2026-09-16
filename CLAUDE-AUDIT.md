# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 AI/Claude 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

위 handoff의 **역할 분리 원칙은 유효**하지만 일부 상태 설명은 오래됐다. 현재 운영 사실은 이 파일과 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 항목을 우선한다.

최신 독립 감사 보강 기록:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-run14-production-pass.md`
- `docs/AI-SSOT-AUDIT-LOG.md`의 `2026-09-16(11)` — #313 side-branch 색상 “해소” 정정
- `docs/AI-SSOT-AUDIT-LOG.md`의 `2026-09-16(12)` — side branch F86 표시 규칙 구현 진전 / production 미반영·색 SSOT 회귀 위험

---

## 작업 전 필독

- `docs/AI-SSOT-AUDIT-LOG.md` — 최신 항목부터 읽기
- `docs/ai-ssot-audit/2026-09-16-chatgpt-run14-production-pass.md` — run #14 PASS + 최신 상품구분 색 요구 drift
- `docs/ai-ssot-audit/FREEPASS-SSOT-ARCHITECTURE-CONTRACT.md`
- `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`
- `docs/예약작업-지도.md` — current production pin 설명이 stale
- `docs/ai-ssot-audit/AI-INBOX.md`

불변 원칙:

1. `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다.
2. F01/F86/손오공/오토플러스/고객면은 projection이다. Projection을 canonical Source로 역류시키지 않는다.
3. production pin과 current `main`을 반드시 구분한다.
4. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다. workflow, writer topology, mirror/RTDB legacy path까지 같이 본다.
5. 손오공은 별도 `손오공구독`, 오토플러스는 별도 `오플구독`을 유지하고 공급사 고유 기간/요금 구조를 보존한다.
6. 실제 코드 수정은 Claude 단일 구현 세션만 한다. ChatGPT findings는 근거를 재확인한 뒤 처리한다.
7. 과거 감사 판정은 삭제하지 않는다. 해소 시 새 항목으로 남긴다.

---

# 현재 최신 판정 — 2026-09-16

## 0. 긴급 정정 — PR #313의 픽업구독 색상 “해소됨”은 current main/production 해소가 아님

PR #313 이후 독립 재감사에서 직전 감사로그의 범위 혼동이 확인됐다.

직전 Claude 구현은 `codex/rtdb-cutover-current` branch의 commit `4647c484d756a594302d1417e405e61a820c23fb`에서 `GUBUN_INK`에 `픽업구독 = 0F766E`를 추가하고 수동 F01/F86 publish를 수행했다. 그러나 이 branch는 current `main` 및 production pin과 **diverged** 상태이며 해당 코드 변경은 main/production에 병합되지 않았다.

현재 main과 production pin `308511563d8e8f56dbd94f715469d8ae7ed9171a`의 실제 구조는 계속 다음과 같다.

- `lib/domain/category-colors.ts`에 `MASTER_CATEGORY_COLORS['분류']`가 존재
- `픽업구독 = #C2185B`
- `lib/domain/sales-sheet-format.ts`의 `GUBUN_INK`는 이 canonical map에서 파생

반면 side branch `4647c484...`는 `'분류'` map이 없고 `GUBUN_INK`를 별도 하드코딩한다. 따라서 side branch의 하드코딩 표를 그대로 main에 병합하면 PR #303에서 복구한 **상품구분 색 단일 SSOT 구조를 다시 깨뜨릴 수 있다.**

또한 직전 감사로그의 “origin에는 F86 자동 workflow가 없다 / `erp5-ssot-refresh.yml`은 F01만 발행”이라는 설명도 current main과 반대다. current `.github/workflows/erp5-ssot-refresh.yml`은 production pin을 checkout해 **F01 + F86 백업/발행 + F86↔Atom + Atom↔F01↔F86 + 사진링크 감사까지 한 회차에서 수행**한다.

따라서 현재 정본 판정은:

- side branch/manual publish에서 보인 색상 변화 = **관측된 실험/수동발행 결과**
- current main/production의 픽업구독 canonical 색상 변경 = **미반영 / 미해소**
- 정규 production에서 해소하려면 `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT 구조를 유지한 채 승인된 색을 적용하고 정규 production publish 후 effectiveFormat까지 재검증해야 함

세부 근거: `docs/AI-SSOT-AUDIT-LOG.md`의 `2026-09-16(11)` 항목.

## 0-A. side branch의 F86 표시계약 구현은 진전됐지만 아직 production 해소가 아님

`2026-09-16(11)` 이후 `codex/rtdb-cutover-current`가 `5e39d7d475c971914a64762dc507516ebdf41a54`까지 진행됐다. 이 commit은 F86 builder와 `check-f86-locked.mts`에 다음 표시 규칙을 코드/잠금 검사로 넣었다.

- F86 `공지사항` 미생성 + 기존 공지사항 정리
- `종합`이 첫 탭이며 종합만 시간(mark)+대수
- 공급사 탭은 시간 없이 `회사 · N대`
- 장기요금 없는 차도 제외하지 않고 요금 칸만 빈 채 싣기
- F86 `구분`/`배차상태` 값별 색은 F01 쪽 format 결과를 살리기

따라서 F86 presentation 자체는 side branch에서 **구현 진전**이 있다. 하지만 current production 해소로 보지 않는다.

- current production checkout ref는 계속 `308511563d8e8f56dbd94f715469d8ae7ed9171a`
- `main` ↔ `codex/rtdb-cutover-current`는 diverged이며 감사 시점 side branch ahead 525 / behind 451
- side branch `5e39d7d...`의 `category-colors.ts`에는 `MASTER_CATEGORY_COLORS['분류']`가 없고, `sales-sheet-format.ts`의 `GUBUN_INK`를 직접 하드코딩한다
- 따라서 “F01과 같은 색”이라는 side branch 규칙은 **그 branch 내부 F01과 같은 색**이라는 뜻이지, current production의 canonical `MASTER_CATEGORY_COLORS['분류']` 구조와 같다는 뜻이 아니다
- side branch hardcoded `GUBUN_INK`를 통째로 가져오면 PR #303의 상품구분 색 단일 SSOT를 다시 깨뜨릴 수 있다

또한 head `5e39d7d...` push의 Actions run `35053821352`(`refresh-30min.yml`)은 failure이며 jobs 조회 결과 0건이다. 이 증거만으로 F86 코드 자체가 실패 원인이라고 단정하지 않지만 **green branch CI 증거도 없다.**

따라서 Claude 구현 Owner는 `5e39d7d...`에서 **F86 presentation 동작만 current production lineage로 선택적으로 이식**하고, 상품구분 색은 current `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT 구조를 반드시 보존한다. 이후 current lineage의 CI/잠금 검사 + 정규 F01/F86 production publish + live `effectiveFormat` 검증이 끝나야 해소로 닫는다.

세부 근거: `docs/AI-SSOT-AUDIT-LOG.md`의 `2026-09-16(12)` 항목.

## 1. current production pin은 `308511563...` — PR #312로 계보 drift 구조적 해소

현재 `.github/workflows/erp5-ssot-refresh.yml` checkout ref:

- `308511563d8e8f56dbd94f715469d8ae7ed9171a`

PR #312 merge commit:

- `59e45d8d69ae94ea7edb0e77e10fa3640bfe0bec`

실제 계보:

- `308511563...` → `298120fbaa2a4dd4227fcea5431f3ffbd84c1be6` (PR #308 조건부서식 누적 정리)
- `298120f...` → `d635f8c87c3840a6956184b4d20f99dd968b6138` (PR #303 분류/구분 색 SSOT 포함)
- `308511563...`에는 PR #310 Sheets metadata fields-mask 400 수정도 포함

`scripts/check-inventory-source-contract.mts`의 `VALIDATED_ENGINES`에도 같은 `308511563...`이 들어 있다.

따라서 직전 `0c4ec76b...`에서 발생했던 **PR #303 상품구분 색상 SSOT 누락 / diverged production lineage 문제는 current pin에서 구조적으로 해소됨**으로 본다.

## 2. `308511563...` 실제 운영 발행까지 완전 PASS 확인

PR #312 merge 직후 workflow_dispatch run:

- run `35044774559` (run #14)
- head `59e45d8d69ae94ea7edb0e77e10fa3640bfe0bec`
- production checkout ref `308511563d8e8f56dbd94f715469d8ae7ed9171a`
- conclusion: **success**

실제 Actions job에서 다음 단계가 모두 success로 끝났다.

- 원천 계약 검사 / 현재 원천 재수집 / 티카 유료옵션 감사
- ERP5 현재 원자 계산·반영 / 정책 참조 정합화
- 발행 snapshot 고정 / public catalog 발행 대사
- **F01 판매시트 게시**
- **F86 발행 직전 백업 / F86 게시**
- **F86 ↔ 원자 칸 대조·신선도 감사**
- **원자 ↔ F01 ↔ F86 칸 단위 대조**
- **차번 셀 사진 링크 대조**
- 회차 증거 artifact 보존

보존 artifact:

- `erp5-ssot-snapshot-35044774559`
- digest `sha256:4498d645f463cb6ffd50b3a71595b1751590c9b49f0bc5e52ed467e17b570930`

따라서 이전 문서의 “새 pin 운영 실발행 HOLD”는 더 이상 최신 판정이 아니다. **`308511563...`은 현재 최신 완전검증 production pin**이다.

## 3. F01/F86 상품구분 색 SSOT 공유 구조는 존재하지만 `픽업구독` 최신 색 결정은 미반영

`308511563...`의 `lib/domain/sales-sheet-format.ts`는:

- `GUBUN_INK = MASTER_CATEGORY_COLORS['분류']`
- F01의 `구분`에 `GUBUN_INK` 적용
- F86/공급사 계열의 `분류`에도 같은 `GUBUN_INK` 적용
- 배차상태는 별도 `STATE_INK`

으로 구성되어 있다.

즉 **F01/F86은 이미 같은 canonical 상품구분 색표를 참조한다.** F01만 별도 색표를 새로 만들면 안 된다.

현재 canonical map(`lib/domain/category-colors.ts`) 값:

- 신차렌트 `#B81A8C`
- 중고렌트 `#0D706B`
- 중고구독 `#6B3DB3`
- 신차구독 `#474D57`
- 픽업구독 `#C2185B`

하지만 최신 승인 요구는:

- 신차렌트/중고렌트/중고구독 기존 색 유지
- 신차구독 = 회색 유지
- **픽업구독 = 손오공에서 이미 쓰는 하늘색/sky-blue 계열 기존 토큰 재사용**
- 임의 HEX 신규 생성 금지
- F01/F86/ERP 표현이 같은 canonical map을 공유

이다.

따라서 **현재 `픽업구독 #C2185B`는 최신 요구와 충돌한다.** Claude 구현 Owner는 손오공에서 실제 쓰는 기존 sky-blue 토큰을 찾아 정확한 값을 확정한 뒤 `MASTER_CATEGORY_COLORS['분류']` 한 곳만 바꾸고, F01/F86을 정규 production 경로로 재발행해 live sheet의 실제 텍스트 색을 둘 다 확인한다. 배차상태 `STATE_INK`는 건드리지 않는다.

`codex/rtdb-cutover-current`의 `0F766E` 수동발행 결과는 참고 증거일 뿐 current production 해소 증거가 아니다. 그 branch의 하드코딩 `GUBUN_INK` 구조를 그대로 가져오지 않는다.

main에서 실행된 `F01 구분 칸 색 진단(읽기전용, 수동)` run `35045707947`은 success였지만, 독립 감사에서는 그 step의 원문 로그까지 확보하지 않았으므로 success 상태만으로 실제 렌더링된 각 HEX를 재판정하지 않는다.

## 4. F86 표시계약 drift는 production에서 여전히 미해소

현재 승인된 F86 표시 요구:

- `공지사항` 탭 제거
- `종합`만 시간 + 대수 표기
- 공급사 탭은 시간 없이 `이안카 000대` 형태
- 배차상태와 상품구분은 **각각 독립된 값별 텍스트 색상 규칙** 유지
- 데이터/대여료/ERP5 Atom/SSOT 의미 변경 금지

현재 production `308511563...` 코드에는 여전히:

- `scripts/build-channel-supplier-sheet.mts` → `ensureNoticeTab()`으로 공지사항 탭 보장
- `lib/server/channel-f86-plan.ts` → 공급사 탭도 `회사 + 시각 + 대수` 제목 사용

이 남아 있다.

side branch `5e39d7d...`에서는 이 표시계약을 구현/잠금한 진전이 확인됐지만, **production pin에는 아직 반영되지 않았다.** 따라서 Google Sheet를 수동으로 고쳐도 current production publish가 기존 builder 규칙으로 되돌릴 수 있다.

### 구현 원칙

이건 **F86 projection/presentation 수정**이다.

- F86 builder/plan/format에서 처리
- ERP5 Atom 변경 금지
- canonical source 변경 금지
- 공급사 고유 가격/기간 의미 변경 금지
- current production의 `GUBUN_INK` / `STATE_INK` 분리와 `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT 의미를 훼손하지 않음

## 5. canonical source / 특수 판매탭은 유지

current main canonical registry:

- RP006 아이언 = `ironrentcar.com`
- RP012 손오공 = `sokrc.com/api`
- RP023 오토플러스 = RebornCar

운영결정:

- 손오공 = `손오공구독` 별도 탭
- 오토플러스 = `오플구독` 별도 탭
- 손오공 중고렌트 = `손오공구독` 내부 반납형
- 공급사 고유 기간·요금 축 유지
- 공통화는 표현 템플릿만

이번 감사에서 이 계약 자체의 신규 회귀는 확인하지 않았다.

## 6. writer topology latent conflict는 그대로

- `sales-erp-hourly.yml` cron `0 0-9 * * 1-5` 잔존
- `mirror-sync.yml` cron `*/30 * * * *` 잔존
- `MIRROR_SOURCES` RP023의 `from` = 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`
- canonical RP023 = RebornCar
- `docs/예약작업-지도.md`는 두 legacy workflow를 꺼짐으로 기록

UI에서 실제 disabled면 active writer 충돌이라고 단정하지 않지만, repository 자체가 disable 상태를 강제하지 못해 재-enable 시 되살아날 latent conflict는 유지한다.

## 7. 예약작업 지도 stale

`docs/예약작업-지도.md`:

- 통합 engine = `3a334ddf...`

실제 current workflow:

- engine = `308511563...`

이 문서와 ACTIVE handoff의 오래된 pin/상태 설명은 Claude 구현 Owner가 최신 상태와 맞춰야 한다.

## 8. current `main`의 최신 변화는 감사 문서이며 production pin은 변하지 않음

이번 감사 직전의 main HEAD는 `805247e07a4f494cb5d89ee6968aaa9b0214ad61`이었다. 이후 독립 감사자가 `docs/AI-SSOT-AUDIT-LOG.md`에 `(12)`를 추가했고 이 `CLAUDE-AUDIT.md`도 최신 요약으로 갱신한다.

이 변경들은 감사 문서뿐이며 애플리케이션 코드나 비즈니스 로직을 수정하지 않는다. production workflow checkout ref는 계속 `308511563...`이다.

---

# Claude 구현 Owner의 즉시 우선순위

1. **`308511563...`을 최신 완전검증 production pin으로 취급한다.** run `35044774559`의 F01/F86/cross-audit/photo-audit가 전부 success다.
2. **#313 side-branch 색상 해소 판정을 production 해소로 보지 않는다.** current production의 `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT 구조를 보존한 채 승인된 픽업구독 색을 적용한다. 임의 HEX 금지. 정규 production 재발행 후 F01/F86 effectiveFormat까지 검증한다.
3. **F86 presentation은 `5e39d7d...`의 동작만 선택적으로 이식:** 공지사항 없음 / 종합만 시간+대수 / 공급사 탭 이름+대수 / 구분·배차상태 의미 일치. side branch의 hardcoded `GUBUN_INK` 색 구조는 가져오지 않는다.
4. current lineage에서 관련 잠금 검사·CI를 green으로 만든 뒤 `erp5-ssot-refresh` 정규 회차로 F01/F86/cross-audit/photo-audit를 다시 통과시키고 live effectiveFormat을 검증한다.
5. `docs/예약작업-지도.md`와 stale handoff를 `308511563...` 및 최신 규칙과 맞춘다.
6. legacy writer UI-disable 의존성은 기존 latent conflict로 유지하고 별도 구현 판단.
7. 구현 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append.

세부 근거는 `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목과 `docs/ai-ssot-audit/2026-09-16-chatgpt-run14-production-pass.md`를 본다.
