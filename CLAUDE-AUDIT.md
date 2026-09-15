# Claude SSOT Audit Entry Point

Claude Code가 **공급사 원천 / ERP5 / 판매시트 / 정제시트 / ERP 동기 / writer topology**를 건드리거나 검토할 때는 먼저 아래 감사 원장의 **가장 최근 항목**을 읽는다.

- `docs/AI-SSOT-AUDIT-LOG.md`
- 최신 운영결정: `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`

규칙:

1. `inventory-source-registry.ts`만 보고 전체 정합성을 판단하지 않는다.
2. `.github/workflows/*sync*.yml`, `sync-mirror-all.mts`, `hourly-sync.mts`, ERP/RTDB write 경로까지 함께 본다.
3. production pin과 current `main`을 구분해서 검토한다.
4. 새 충돌을 찾거나 기존 충돌을 해소하면 `docs/AI-SSOT-AUDIT-LOG.md`에 날짜별로 append한다.
5. 과거 판정은 삭제하지 않는다. 해결되면 새 항목에 `해소됨`으로 남긴다.
6. 날짜별 운영결정 문서가 있으면 해당 결정을 코드 변경 전에 함께 읽는다.

현재 최근 핵심 판정(2026-09-15):

- ERP5 canonical source registry 자체는 맞음.
- main legacy direct ingest는 fail-closed.
- production ERP5 collector는 아직 검증 commit `eafbd88e43b1b4e5bacab858a2e0c65845956e5f`에 pin.
- **충돌 잔존:** `MIRROR_SOURCES`의 RP023 옛 Google Sheet 원천 정의.
- **충돌 잔존:** `mirror-sync.yml` 30분 자동 writer.
- **충돌 잔존:** `sales-erp-hourly.yml` → `hourly-sync` → 판매시트/운영 RTDB writer.
- 현재 Source Contract CI는 위 legacy writer topology까지 완전히 검사하지 않음.

현재 최근 운영결정(2026-09-16):

- **손오공은 별도 판매탭 유지.**
- **오토플러스는 별도 `오플구독` 탭 유지.**
- **손오공 중고렌트는 새 탭을 만들지 않고 `손오공구독`의 반납형 갈래에 합류.**
- 손오공 ERP/API 중고렌트 버킷의 실제 식별자는 실데이터/코드로 확인 후 연결하며 추측하지 않는다.

세부 근거와 다음 작업 순서는 반드시 감사 원장과 최신 운영결정 문서를 본다.
