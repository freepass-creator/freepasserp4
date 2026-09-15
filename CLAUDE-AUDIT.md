# Claude SSOT Audit Entry Point

Claude Code가 **공급사 원천 / ERP5 / 판매시트 / 정제시트 / ERP 동기 / writer topology / F86 전용 projection**을 건드리거나 검토할 때는 먼저 아래 감사 원장의 **가장 최근 항목**을 읽는다.

- `docs/AI-SSOT-AUDIT-LOG.md`
- 최신 운영결정: `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`
- 최신 F86 점검: `docs/ai-ssot-audit/2026-09-16-f86-hahuhho-sheet-audit.md`
- ChatGPT ↔ Claude 협업 핸드오프: `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

규칙:

1. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다.
2. `.github/workflows/*sync*.yml`, `sync-mirror-all.mts`, `hourly-sync.mts`, ERP/RTDB write 경로까지 함께 본다.
3. production pin과 current `main`을 구분해서 검토한다.
4. 새 충돌을 찾거나 기존 충돌을 해소하면 감사 이력에 날짜별로 남긴다.
5. 과거 판정은 삭제하지 않는다. 해결되면 새 항목에 `해소됨`으로 남긴다.
6. 날짜별 운영결정/감사 문서가 있으면 해당 결정을 코드 변경 전에 함께 읽는다.
7. F86은 canonical source가 아니라 하허호 전용 projection/presentation이다. F86의 표시 요구를 upstream SSOT 규칙으로 역수입하지 않는다.
8. 다른 AI/세션이 동시에 작업 중일 수 있으므로 변경 전에 `origin/main`, 현재 branch, dirty tree를 확인하고 최신 변경을 덮어쓰지 않는다.

현재 최근 핵심 판정:

- ERP5 canonical source registry 자체는 맞음.
- main legacy direct ingest는 fail-closed.
- production ERP5 collector는 아직 검증 commit `eafbd88e43b1b4e5bacab858a2e0c65845956e5f`에 pin.
- **충돌 잔존:** `MIRROR_SOURCES`의 RP023 옛 Google Sheet 원천 정의.
- **충돌 잔존:** `mirror-sync.yml` 30분 자동 writer.
- **충돌 잔존:** `sales-erp-hourly.yml` → `hourly-sync` → 판매시트/운영 RTDB writer.
- 현재 Source Contract CI는 위 legacy writer topology까지 완전히 검사하지 않음.

현재 운영결정(2026-09-16):

- **손오공은 별도 판매탭을 유지한다.**
- **오토플러스도 별도 판매탭을 유지한다.**
- 두 공급사는 일반 `상품리스트`의 1/6/12/24/36/60개월 구조에 억지로 맞추지 않는다.
- **각 공급사가 실제 제공하는 고유 기간·주행거리·요금 구조는 그대로 유지한다.**
- 공통화하는 것은 **탭 템플릿의 레이아웃/열/표현 양식뿐**이다.
- **손오공 중고렌트는 새 탭을 만들지 않고 손오공 탭 내부의 반납형 상품군에 합류하는 방향**이다.
- 손오공 ERP/API 중고렌트 버킷의 실제 식별자는 실데이터/코드로 확인 후 연결하며 추측하지 않는다.

현재 F86 점검(2026-09-16):

- `F86) 프리패스x하허호 전용 상품시트`는 **하허호 전용 projection 구조 PASS**.
- 일반 `종합 373대` = 일반 공급사별 탭 합계 373대로 내부 정합성 맞음.
- 손오공 289대와 오토플러스 68대는 일반 종합에서 분리된 별도 탭으로 유지됨.
- 손오공/오토플러스는 각자 고유 기간/주행거리 요금 열을 유지하고, 템플릿 표현만 공통화됨.
- F01 일반 상품리스트 382대 vs F86 종합 373대의 **9대 차이는 해소(PASS)**.
- 9대 = RP006 아이언 6대 + RP021 빌린카 2대 + RP032 에코렌트카 1대.
- 원인: `RETRO_SHORT` / 장기요금 필터. 하허호는 장기렌트만 취급하므로 장기요금이 하나도 없는 단기 전용 차량은 F86에서 의도적으로 제외한다.
- 따라서 해당 9대는 임의 복원하지 않는다.
- 단, 감사 근거가 `erp5` 워크트리 `freepasserp4-rtdb-current`에서 확인된 이력이 있으므로 current main 및 실제 production F86 builder 경로에서도 동일 규칙이 적용되는지 최종 교차확인한다.

Claude가 지금 시작할 때는 협업 핸드오프 문서의 **7. 지금 Claude에게 맡길 첫 작업**부터 실행한다.

세부 근거와 다음 작업 순서는 반드시 감사 원장과 최신 운영결정/점검/협업 문서를 본다.
