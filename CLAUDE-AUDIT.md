# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 AI/Claude 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

위 handoff의 역할 분리 원칙은 유효하지만, 상태 설명은 **이 파일 + `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목**을 우선한다.

최신 독립 감사 근거:

- `docs/AI-SSOT-AUDIT-LOG.md`의 `2026-09-16(13)`
- `docs/ai-ssot-audit/2026-09-16-chatgpt-production-pin-contract-writer-topology.md`
- 직전 완전 PASS 기준: `docs/ai-ssot-audit/2026-09-16-chatgpt-run14-production-pass.md`

---

## 작업 전 불변 원칙

1. `SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT` 한 방향을 지킨다.
2. F01/F86/손오공/오토플러스/고객면은 projection이다. Projection을 canonical Source로 역류시키지 않는다.
3. production pin과 current `main`을 반드시 구분한다.
4. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다. workflow, writer topology, mirror/RTDB legacy path까지 같이 본다.
5. 손오공은 별도 `손오공구독`, 오토플러스는 별도 `오플구독`을 유지하고 공급사 고유 기간·주행거리·요금 구조를 보존한다.
6. 실제 코드 수정은 Claude 단일 구현 세션만 한다. ChatGPT findings는 근거를 재확인한 뒤 처리한다.
7. 과거 감사 판정은 삭제하지 않는다. 해소 시 `docs/AI-SSOT-AUDIT-LOG.md`에 새 항목으로 남긴다.

---

# 현재 최신 판정 — 2026-09-16

## 1. current production pin은 `1f923d27...`

current `.github/workflows/erp5-ssot-refresh.yml`의 checkout ref:

- `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`

따라서 이전 entry point의 `308511563...`을 current production이라고 한 설명은 stale이었다.

이 production lineage는 F01과 F86을 같은 회차에서 발행/감사하며, 직전 side-branch only로 보였던 F86 presentation 규칙도 production 계보에 들어왔다.

확인된 F86 projection 동작:

- 묵은 `공지사항` 탭 제거 / 재생성하지 않음
- `종합`이 첫 탭
- `종합`만 timestamp + 대수
- 공급사 탭은 timestamp 없이 `회사 · N대`
- 장기 요금 없는 차량도 제외하지 않고 요금 칸만 빈 채 싣기
- `구분`/`배차상태` 값별 색은 shared sales-format 경로로 적용
- F01/F86 교차 감사 및 차량번호 사진링크 감사가 production workflow에 포함

단, `1f923d27...` 기준 **새 정규 scheduled production 회차의 완전 성공 증거는 최신 감사에서 아직 별도 확인 대상으로 남아 있다.**

## 2. HOLD — main Source Contract가 current production pin을 승인하지 못함

current main `scripts/check-inventory-source-contract.mts`의 `VALIDATED_ENGINES`는 `308511563...`까지만 승인하고, production pin `1f923d27...`은 포함하지 않는다.

실제 current-main Actions 증거:

- workflow: `SSOT Source Contract`
- run: `35058214607`
- job: `104672754543`
- conclusion: **failure**
- exact failure: `.github/workflows/erp5-ssot-refresh.yml: checkout ref 1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f is not an approved validated engine`

이것은 production runtime 실패를 직접 증명하는 것은 아니지만, **main이 자기 production engine을 자기 governance gate로 인증하지 못하는 계약 drift**다. Source Contract가 current pin을 인정하고 다시 green이 되기 전까지 SSOT governance 판정은 HOLD다.

## 3. 픽업구독 canonical 색은 아직 미해소

production pin `1f923d27...`의 `lib/domain/category-colors.ts`:

- `MASTER_CATEGORY_COLORS['분류']['픽업구독'] = '#C2185B'`

side branch/manual publish에서 보였던 teal `#0F766E`는 production canonical SSOT가 아니다.

해결 원칙:

- channel-local `GUBUN_INK` 하드코딩 금지
- `MASTER_CATEGORY_COLORS['분류']` 한 곳에서만 확정
- F01/F86이 같은 canonical map을 계속 참조
- 정규 production 재발행 후 live `effectiveFormat` 검증

## 4. writer topology — `sales-erp-hourly.yml`은 dormant로 가정하면 안 됨

current `.github/workflows/sales-erp-hourly.yml`은 schedule을 보유하고 있으며 `SALES_ERP_CLOUD_SCHEDULED_SYNC_ENABLED`도 repository variable이 없으면 `true`를 기본값으로 사용한다.

실제 증거:

- scheduled run `34955061603`이 2026-09-15 실제 dispatch됨
- PR #317 / commit `330ada9569f6b6bcff28d1cead8132b388136ad9`에서 recurring workflow의 손오공 credential 준비 누락을 수리

따라서 Claude는 이 경로를 **active-capable scheduled writer**로 보고 ERP5 canonical writer/projection ownership과 중복 권한이 없는지 재확인해야 한다.

반면 `.github/workflows/mirror-sync.yml`은 current main에서 `vars.MIRROR_SYNC_ENABLED == 'true'` 조건으로 fail-closed되어 있다. `MIRROR_SOURCES`의 legacy 정보는 canonical source 권한이 없다.

## 5. canonical source / 특수 판매탭 / RTDB 판정은 유지

current canonical registry:

- RP006 아이언 = `ironrentcar.com`
- RP012 손오공 = `sokrc.com/api`
- RP023 오토플러스 = `reborncar.co.kr`

운영계약:

- 손오공 = `손오공구독` 별도 탭
- 오토플러스 = `오플구독` 별도 탭
- 공급사 고유 기간·주행거리·요금 축 유지
- 공통화는 표현 템플릿만
- RTDB를 canonical inventory source로 되돌리는 신규 회귀 없음

---

# Claude 구현 Owner의 즉시 우선순위

1. `1f923d27...`을 `VALIDATED_ENGINES` 계약과 정합화하고 `SSOT Source Contract`를 green으로 만든다.
2. `1f923d27...` 기준 정규 scheduled production 회차가 F01/F86 발행·F86↔Atom·Atom↔F01↔F86·사진링크 감사까지 정상 완료되는지 확인한다.
3. 픽업구독 색은 `MASTER_CATEGORY_COLORS['분류']` 단일 SSOT에서만 해결한다. side-branch hardcoded 색표를 가져오지 않는다.
4. `sales-erp-hourly.yml`의 writer ownership/feature flag를 재확인해 ERP5 canonical inventory writer와 중복 권한이 생기지 않도록 한다.
5. `mirror-sync.yml` fail-closed를 유지하고 mirror/RTDB legacy 경로를 canonical source로 승격하지 않는다.
6. 구현 후 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`을 append한다.

이 entry point는 구현 지시의 요약이다. 세부 근거와 과거 판정은 `docs/AI-SSOT-AUDIT-LOG.md` 최신 항목을 우선한다.
