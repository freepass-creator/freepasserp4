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

## 1. current production pin `0c4ec76b...`은 실제 운영 발행 PASS

현재 `.github/workflows/erp5-ssot-refresh.yml` checkout ref:

- `0c4ec76b605c3ac50efcd9483dd2294bd89e22c0`

PR #308에서 F01 metadata fields 마스크를 잘못 만들어 run `35042070104`의 F01 발행을 깨뜨렸지만:

- PR #310 merge commit `47b556812dcefbd7e6fe8e1a2fc52bf3427502c0` — fields 마스크 긴급 수정
- PR #311 merge commit `8078b978e071982e0ebec5bb056518cb5701785c` — production ref를 `0c4ec76b...`로 repin

한 뒤 새 운영 검증이 완료됐다.

Actions run `35043402729`:

- conclusion: **success**
- 원천 계약 검사: success
- 공급사 재수집: success
- ERP5 원자 계산/반영: success
- 정책 참조 정합화: success
- snapshot 고정: success
- public catalog 발행 대사: success
- F01 발행: **success**
- F86 백업: success
- F86 발행: **success**
- F86 ↔ 원자 감사: success
- 원자 ↔ F01 ↔ F86 칸 단위 대조: **success**
- 차번 셀 사진 링크 대조: **success**
- 회차 증거 보존: success

따라서 PR #308의 **런타임 F01 발행 회귀 자체는 PR #310/#311 이후 운영 회차에서 해소됨**으로 본다.

중요: 이것은 `0c4ec76b...`의 **현재 실행 경로가 정상**이라는 뜻이지, 아래의 Git 계보/색상 SSOT drift까지 해소됐다는 뜻은 아니다.

## 2. 긴급 구조 drift — `0c4ec76b...`은 PR #303 색상 SSOT를 잃은 diverged 가지

workflow 주석은 `0c4ec76b...`가 기존 `d635f8c8...` 위에 PR #308/#310을 얹은 것처럼 설명하지만 실제 Git 계보는 다르다.

실제 비교:

- `d635f8c8...` vs `0c4ec76b...` = **diverged**
- merge base = `3a334ddf6e8acd721883757f7951052bf9188b87`
- `0c4ec76b...`는 d635 대비 ahead 3 / behind 1

`d635f8c8...`에만 남은 독자 변경 파일:

- `lib/domain/category-colors.ts`
- `lib/domain/sales-sheet-format.ts`
- `lib/domain/supplier-template-sheet.ts`

이는 PR #303의 **상품 분류/구분 색상 단일출처** 변경이다.

실제 production ref `0c4ec76b...`:

- `category-colors.ts`에 current main의 `'분류'` SSOT 표가 없음
- `sales-sheet-format.ts`에 `GUBUN_INK`가 다시 직접 하드코딩됨
- 일부 `분류` 색도 별도 하드코딩됨

따라서 현재 pin은 **런타임 PASS지만 색상/표현 SSOT 관점에서는 회귀**다.

### Claude 구현 Owner가 해야 할 것

PR #303 + #308 + #310이 모두 포함된 **단일 production 계보**로 재구성한 뒤:

1. workflow pin 갱신
2. validated engine allowlist 동시 갱신
3. 실제 apply run
4. F01/F86/Atom cross audit + photo link audit PASS 확인

까지 해야 한다.

## 3. 직전 안정 기준점 `d635f8c8...`도 보존

비교 기준으로 마지막 완전 PASS였던 이전 pin:

- `d635f8c87c3840a6956184b4d20f99dd968b6138`
- Actions run `35039845907`
- F01 735대 = F86 735대
- F86 ↔ Atom 46,675칸 mismatch 0
- Atom ↔ F01 mismatch 0
- F01 ↔ F86 mismatch 0
- 사진 링크 mismatch 0

`0c4` 런타임 회귀는 해소됐지만, #303 포함 여부를 비교할 때 이 pin의 계보를 기준점으로 삼는다.

## 4. F86 표시계약 drift — 수동 시트 수정만 하면 다음 publish에 되돌아감

현재 승인된 F86 표시 요구:

- `공지사항` 탭 제거
- `종합` 탭만 시간 + 대수 표기
- 공급사 탭은 시간 없이 `이안카 000대` 형태
- `구분` 칸은 상품구분별로 명확히 다른 색 체계 적용
- 데이터/대여료/ERP5 Atom/SSOT 의미는 변경하지 않음

그러나 production ref `0c4ec76b...` 코드:

- `scripts/build-channel-supplier-sheet.mts`가 `ensureNoticeTab()`으로 `공지사항`을 다시 만든다.
- `0 = 공지사항` 전제로 탭 인덱스를 잡는다.
- stale tab 삭제에서도 `공지/안내`를 보존한다.
- `lib/server/channel-f86-plan.ts`가 **모든 탭**을 `${company} ${mark} · ${N}대` 형식으로 만든다.
- 상품구분 색 표현도 현재 production 가지에서 한 SSOT로 통합되지 않았다.

따라서 Google Sheet를 수동으로 고쳐도 다음 F86 publish 때 되돌아갈 수 있다.

### 구현 원칙

이건 **F86 projection/presentation 수정**이다.

- F86 builder/plan/format에서 처리
- ERP5 Atom 변경 금지
- canonical source 변경 금지
- 공급사 고유 가격/기간 의미 변경 금지

## 5. canonical source / 특수 판매탭은 유지

current main canonical registry:

- RP006 아이언 = `ironrentcar.com`
- RP012 손오공 = ERP/API
- RP023 오토플러스 = RebornCar

운영결정:

- 손오공 = `손오공구독` 별도 탭
- 오토플러스 = `오플구독` 별도 탭
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

- engine = `0c4ec76b...`

production engine 계보를 최종 정리한 뒤 그 validated pin과 문서를 함께 맞춘다.

---

# Claude 구현 Owner의 즉시 우선순위

1. **production lineage 복구:** PR #303 + #308 + #310을 모두 포함하는 단일 엔진 구성.
2. 그 엔진으로 repin 후 실제 apply F01/F86 통합 발행 및 모든 감사 PASS 확인.
3. **F86 presentation contract 반영:** 공지사항 제거 / 종합만 시간+대수 / 공급사 탭 이름+대수 / 상품구분 색상 SSOT.
4. `docs/예약작업-지도.md`와 stale handoff를 최종 production 사실과 맞춤.
5. legacy writer UI-disable 의존성은 기존 latent conflict로 유지하고 별도 구현 판단.
6. 변경 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append.

세부 근거는 `docs/AI-SSOT-AUDIT-LOG.md`의 최신 항목을 본다.
