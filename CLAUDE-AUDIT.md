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

- `docs/AI-SSOT-AUDIT-LOG.md` — 최신 `2026-09-16(7)`부터 읽기
- `docs/ai-ssot-audit/FREEPASS-SSOT-ARCHITECTURE-CONTRACT.md`
- `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`
- `docs/예약작업-지도.md` — 현재 production pin 설명이 stale
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

# 현재 최신 판정 — 2026-09-16(7)

## 1. 직전 완전 검증 production은 `d635f8c8...`

마지막으로 **SOURCE → ERP5 Atom → snapshot → public/F01/F86 → 칸 감사까지 완전 PASS**가 입증된 pin은:

- `d635f8c87c3840a6956184b4d20f99dd968b6138`
- Actions run `35039845907`
- apply=true / conclusion success
- 공급사 24/24 수집·반영 성공
- ERP5 현재재고 735대
- F01 735대
- F86 735대
- F86 ↔ Atom 46,675칸 mismatch 0
- Atom ↔ F01 mismatch 0
- F01 ↔ F86 mismatch 0
- 사진 링크 mismatch 0

이 pin은 과거의 안정 기준점으로 보존한다.

## 2. 현재 workflow pin은 `0c4ec76b...` — 아직 운영 PASS 확정 금지

current main의 `.github/workflows/erp5-ssot-refresh.yml` checkout ref는:

- `0c4ec76b605c3ac50efcd9483dd2294bd89e22c0`

이다.

변경 경위:

- PR #308: F01 누적 조건부서식 제거 로직 추가
- 실제 run `35042070104`: **F01 발행 failure**
- 직접 원인: 잘못된 Google Sheets API `fields` 마스크 → 400 `Request contains an invalid argument`
- PR #310 merge commit `47b556812dcefbd7e6fe8e1a2fc52bf3427502c0`: fields 마스크 긴급 수정
- PR #311 merge commit `8078b978e071982e0ebec5bb056518cb5701785c`: production ref를 `0c4ec76b...`로 repin

새 검증 run:

- `35043402729`
- 이번 독립 감사 시점에는 아직 진행 중

따라서 **`0c4ec76b...`을 최종 검증 pin이라고 선언하지 말 것.** 먼저 run `35043402729` 완료 결과를 확인한다.

## 3. 긴급: production engine 계보가 갈라져 PR #303 색상 SSOT를 잃음

이게 이번 감사의 핵심 신규 finding이다.

workflow 주석은 `0c4ec76b...`가 기존 `d635f8c8...` 위에 PR #308/#310을 얹은 것처럼 설명하지만 실제 Git 계보는 다르다.

실제 비교:

- `d635f8c8...` vs `0c4ec76b...` = **diverged**
- merge base = `3a334ddf6e8acd721883757f7951052bf9188b87`
- `0c4ec76b...`는 d635 대비 ahead 3 / behind 1

`d635f8c8...`에만 남은 독자 변경 파일:

- `lib/domain/category-colors.ts`
- `lib/domain/sales-sheet-format.ts`
- `lib/domain/supplier-template-sheet.ts`

즉 PR #303의 **상품 분류/구분 색상 단일출처** 변경이 current production ref에서 빠졌다.

실제 `0c4ec76b...` 확인:

- `category-colors.ts`에 current main의 `'분류'` SSOT 표가 없음
- `sales-sheet-format.ts`에 `GUBUN_INK`가 다시 직접 하드코딩됨
- 일부 `분류` 색도 별도 하드코딩됨

### Claude 구현 Owner가 해야 할 것

`0c4ec76b...`를 그대로 안정 pin으로 굳히지 않는다.

**PR #303 + #308 + #310이 모두 들어간 하나의 production 계보**를 만들고:

1. production workflow pin 갱신
2. validated engine allowlist 동시 갱신
3. 실제 apply run
4. F01/F86/Atom cross audit + photo link audit까지 PASS 확인

순서로 마무리한다.

## 4. F86 표시계약 drift — 수동 시트 수정만 하면 다음 publish에 되돌아감

현재 승인된 F86 표시 요구:

- `공지사항` 탭 제거
- `종합` 탭만 시간 + 대수 표기
- 공급사 탭은 시간 없이 `이안카 000대` 형태
- `구분` 칸은 상품구분별로 명확히 다른 색 체계 적용
- 데이터/대여료/ERP5 Atom/SSOT 의미는 변경하지 않음

그러나 production ref `0c4ec76b...` 코드:

- `scripts/build-channel-supplier-sheet.mts`가 `ensureNoticeTab()`으로 `공지사항`을 다시 만든다.
- `0 = 공지사항`을 전제로 탭 인덱스를 잡는다.
- stale tab 삭제에서도 `공지/안내`를 보존한다.
- `lib/server/channel-f86-plan.ts`가 **모든 탭**을 `${company} ${mark} · ${N}대` 형식으로 만든다.
- 현재 상품구분 색 표현도 한 SSOT로 고정되지 않은 production 가지다.

따라서 Google Sheet에서 직접 고쳐도 다음 F86 publish 때 다시 되돌아갈 수 있다.

### 구현 원칙

이건 **F86 projection/presentation 수정**이다.

- F86 builder/plan/format에서 처리
- ERP5 Atom 변경 금지
- canonical source 변경 금지
- 공급사 고유 가격/기간 의미 변경 금지

## 5. canonical source / 특수 판매탭은 현재 유지

current main canonical registry:

- RP006 아이언 = `ironrentcar.com`
- RP012 손오공 = ERP/API
- RP023 오토플러스 = RebornCar

손오공/오토플러스 운영결정:

- 손오공 = `손오공구독` 별도 탭
- 오토플러스 = `오플구독` 별도 탭
- 공급사 고유 기간·요금 축 유지
- 공통화는 표현 템플릿만

이번 감사에서 이 계약 자체의 신규 회귀는 확인하지 않았다.

## 6. writer topology latent conflict는 그대로

변화 없음.

- `sales-erp-hourly.yml` cron `0 0-9 * * 1-5` 잔존
- `mirror-sync.yml` cron `*/30 * * * *` 잔존
- `MIRROR_SOURCES` RP023의 `from` = 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`
- canonical RP023 = RebornCar
- `docs/예약작업-지도.md`는 두 legacy workflow를 꺼짐으로 기록

UI에서 실제 disabled면 active writer 충돌이라고 단정하지 않지만, repository 자체가 disable 상태를 강제하지 못해 재-enable 시 되살아날 latent conflict는 유지한다.

## 7. 예약작업 지도도 더 stale해짐

`docs/예약작업-지도.md`:

- 통합 engine = 아직 `3a334ddf...`

실제 current workflow:

- engine = `0c4ec76b...`

production engine 정리 후 이 문서를 **그 최종 검증 pin과 같은 사실**로 맞춘다. 중간 pin을 따라 계속 문서만 흔들지 말고, 최종 validated pin이 정해진 뒤 함께 갱신하는 것이 안전하다.

---

# Claude 구현 Owner의 즉시 우선순위

1. **Actions run `35043402729` 완료 상태 확인.**
2. **production lineage 복구:** PR #303 + #308 + #310을 모두 포함하는 단일 엔진 구성.
3. 그 엔진으로 repin 후 실제 apply F01/F86 통합 발행 및 모든 감사 PASS 확인.
4. **F86 presentation contract 반영:** 공지사항 제거 / 종합만 시간+대수 / 공급사 탭 이름+대수 / 상품구분 색상 SSOT.
5. `docs/예약작업-지도.md`와 stale handoff를 최종 production 사실과 맞춤.
6. legacy writer UI-disable 의존성은 기존 latent conflict로 유지하고 별도 구현 판단.
7. 변경 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append.

세부 근거는 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 **2026-09-16(7)** 항목을 본다.
