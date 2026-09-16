# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 AI/Claude 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

위 handoff의 **역할 분리 원칙은 유효**하지만 일부 상태 설명은 오래됐다. 현재 운영 사실은 이 파일과 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 항목을 우선한다.

---

## 작업 전 필독

- `docs/AI-SSOT-AUDIT-LOG.md` — 최신 항목부터 읽기
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

## 3. F01/F86 상품구분 색 SSOT 공유 구조는 current pin에 존재

`308511563...`의 `lib/domain/sales-sheet-format.ts`는:

- `GUBUN_INK = MASTER_CATEGORY_COLORS['분류']`
- F01의 `구분`에 `GUBUN_INK` 적용
- F86/공급사 계열의 `분류`에도 같은 `GUBUN_INK` 적용
- 배차상태는 별도 `STATE_INK`

으로 구성되어 있다.

즉 **F01과 F86이 서로 다른 상품구분 색표를 갖는 구조는 현재 production pin에서 해소되어 있고, 같은 canonical map을 참조한다.**

현재 canonical map(`lib/domain/category-colors.ts`) 값:

- 신차렌트 `#B81A8C`
- 중고렌트 `#0D706B`
- 중고구독 `#6B3DB3`
- 신차구독 `#474D57`
- 픽업구독 `#C2185B`

배차상태는 별도 의미로 유지한다.

- `즉시출고`, `출고가능` = 파랑
- `상품화중`, `출고협의` = 주황
- `계약중`, `출고불가` = 회색

참고로 main에서 실행된 `F01 구분 칸 색 진단(읽기전용, 수동)` run `35045707947`도 success였으나, 이번 독립 감사에서는 해당 step의 원문 로그까지 확보하지 않았으므로 **success 상태만으로 실제 렌더링된 각 색 HEX까지 재판정하지 않는다.** 표현 변경이 필요하면 Claude 구현 Owner가 canonical map과 live sheet를 함께 대조한다.

## 4. F86 표시계약 drift는 여전히 미해소

현재 승인된 F86 표시 요구:

- `공지사항` 탭 제거
- `종합`만 시간 + 대수 표기
- 공급사 탭은 시간 없이 `이안카 000대` 형태
- 배차상태와 상품구분은 **각각 독립된 값별 텍스트 색상 규칙** 유지
- 데이터/대여료/ERP5 Atom/SSOT 의미 변경 금지

현재 `308511563...` 코드에는 여전히:

- `scripts/build-channel-supplier-sheet.mts` → `ensureNoticeTab()`으로 공지사항 탭 보장
- `lib/server/channel-f86-plan.ts` → 공급사 탭도 `회사 + 시각 + 대수` 제목 사용

이 남아 있다.

따라서 Google Sheet를 수동으로 고쳐도 다음 F86 publish가 builder 규칙으로 되돌릴 수 있다.

### 구현 원칙

이건 **F86 projection/presentation 수정**이다.

- F86 builder/plan/format에서 처리
- ERP5 Atom 변경 금지
- canonical source 변경 금지
- 공급사 고유 가격/기간 의미 변경 금지
- 현재 복구된 `GUBUN_INK` / `STATE_INK` 분리 의미를 훼손하지 않음

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

## 8. current `main` 최신 변경은 감사/문서 계열이며 production app 회귀 증거 없음

감사 시점 current `main` HEAD:

- `6dbdd24d412a7ea3974e01ff02025bf31137cf70`
- message: `chore: temporary placeholder for F86 rule tracing`

이 commit은 `docs/ai-ssot-audit/.tmp-f86-rules-placeholder`만 추가한다. 같은 HEAD의 CI run `35045588568`은 success다.

따라서 run `35044774559` 완료 이후 current main에서 **새 애플리케이션/비즈니스 로직 회귀를 만든 변경은 이번 감사 범위에서 확인되지 않았다.**

---

# Claude 구현 Owner의 즉시 우선순위

1. **`308511563...`을 최신 완전검증 production pin으로 취급한다.** run `35044774559`의 F01/F86/cross-audit/photo-audit가 전부 success다.
2. **F86 presentation contract 반영:** 공지사항 제거 / 종합만 시간+대수 / 공급사 탭 이름+대수. 배차상태와 상품구분의 독립 색상 규칙은 유지.
3. 상품구분 색 표현을 변경할 경우 F01/F86을 따로 고치지 말고 `MASTER_CATEGORY_COLORS['분류']` 한 곳을 기준으로 한다. live sheet 재발행/진단까지 검증한다.
4. `docs/예약작업-지도.md`와 stale handoff를 `308511563...` 및 최신 규칙과 맞춘다.
5. legacy writer UI-disable 의존성은 기존 latent conflict로 유지하고 별도 구현 판단.
6. 변경 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append.

세부 근거는 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 항목을 본다.
