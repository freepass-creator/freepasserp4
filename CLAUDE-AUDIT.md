# Claude SSOT Audit Entry Point

## 운영권한 — 가장 먼저 읽을 것

FreePass SSOT 관련 **실제 구현·수정 Owner는 지정된 Claude 단일 세션 하나**다.

- Claude 지정 단일 세션: 코드/workflow/collector/F01/F86/ERP5 관련 실제 구현·PR·CI·merge 담당
- ChatGPT: 독립 감사·검수·감사로그 기록 담당
- 다른 Claude 세션/다른 AI 세션: SSOT 코드를 병렬 수정하지 않음

상세 운영계약:

- `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

ChatGPT는 매시간 current main / workflow / CI / writer topology / F01/F86 규칙을 독립 감사하고, 의미 있는 변경·충돌·해소가 있을 때 GitHub 감사로그에 남긴다. Claude 구현 Owner는 그 감사기록을 읽고 같은 단일 세션에서 수정한다.

---

Claude 구현 Owner가 **공급사 원천 / ERP5 / 판매시트 / 정제시트 / ERP 동기 / writer topology / F86 전용 projection**을 건드리거나 검토할 때는 먼저 아래를 읽는다.

- `docs/AI-SSOT-AUDIT-LOG.md`
- 최신 운영결정: `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`
- 최신 F86 점검: `docs/ai-ssot-audit/2026-09-16-f86-hahuhho-sheet-audit.md`
- 단일세션 운영 핸드오프: `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`
- **AI 소통 창구(짧은 질문·검토요청)**: `docs/ai-ssot-audit/AI-INBOX.md` — 검증된 판정이 아니라 "이거 봐줘" 수준의 대화는 여기.

규칙:

1. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다.
2. `.github/workflows/*sync*.yml`, `sync-mirror-all.mts`, `hourly-sync.mts`, ERP/RTDB write 경로까지 함께 본다.
3. production pin과 current `main`을 구분해서 검토한다.
4. 새 충돌을 찾거나 기존 충돌을 해소하면 감사 이력에 날짜별로 남긴다.
5. 과거 판정은 삭제하지 않는다. 해결되면 새 항목에 `해소됨`으로 남긴다.
6. 날짜별 운영결정/감사 문서가 있으면 코드 변경 전에 함께 읽는다.
7. F86은 canonical source가 아니라 하허호 전용 projection/presentation이다. F86의 표시 요구를 upstream SSOT 규칙으로 역수입하지 않는다.
8. 작업 전 `origin/main`, 현재 branch, dirty tree를 확인하고 다른 세션의 최신 변경을 덮어쓰지 않는다.
9. FreePass SSOT 코드 구현은 이 지정 Claude 세션에서만 한다. ChatGPT 감사자가 남긴 findings는 직접 근거 재확인 후 이 세션에서 처리한다.

현재 최근 핵심 판정:

- ERP5 canonical source registry 자체는 맞음.
- main legacy direct ingest는 fail-closed.
- production ERP5 collector는 아직 검증 commit `eafbd88e43b1b4e5bacab858a2e0c65845956e5f`에 pin.
- **충돌 잔존:** `MIRROR_SOURCES`의 RP023 옛 Google Sheet 원천 정의.
- **충돌 잔존:** `mirror-sync.yml` 자동 writer.
- **충돌 잔존:** `sales-erp-hourly.yml` → `hourly-sync` → 판매시트/운영 RTDB writer.
- 현재 Source Contract CI는 legacy writer topology까지 완전히 검사하지 않음.

현재 운영결정(2026-09-16):

- **손오공은 별도 판매탭 유지.**
- **오토플러스도 별도 판매탭 유지.**
- 두 공급사는 일반 `상품리스트`의 1/6/12/24/36/60개월 구조에 억지로 맞추지 않는다.
- **각 공급사가 실제 제공하는 고유 기간·주행거리·요금 구조는 그대로 유지한다.**
- 공통화하는 것은 **탭 템플릿의 레이아웃/열/표현 양식뿐**이다.
- **손오공 중고렌트는 새 탭을 만들지 않고 손오공 탭 내부의 반납형 상품군에 합류하는 방향**이다.
- 손오공 ERP/API 중고렌트 버킷의 실제 식별자는 실데이터/코드로 확인 후 연결하며 추측하지 않는다.

현재 F86 점검(2026-09-16):

- `F86) 프리패스x하허호 전용 상품시트`는 **하허호 전용 projection 구조 PASS**.
- 일반 `종합 373대` = 일반 공급사별 탭 합계 373대.
- 손오공 289대와 오토플러스 68대는 일반 종합에서 분리된 별도 탭.
- 손오공/오토플러스는 각자 고유 기간/주행거리 요금 열 유지, 템플릿 표현만 공통화.
- F01 일반 상품리스트 382대 vs F86 종합 373대의 **9대 차이는 해소(PASS)**.
- 9대 = RP006 아이언 6대 + RP021 빌린카 2대 + RP032 에코렌트카 1대.
- 원인: `RETRO_SHORT` / 장기요금 필터. 하허호는 장기렌트만 취급하므로 장기요금이 하나도 없는 단기 전용 차량은 F86에서 의도적으로 제외한다.
- 해당 9대는 임의 복원하지 않는다.

세부 근거와 다음 작업 순서는 감사 원장과 최신 운영결정/점검/단일세션 운영 문서를 본다.
