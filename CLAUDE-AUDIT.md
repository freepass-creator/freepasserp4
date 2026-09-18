# ChatGPT 독립 SSOT 감사 — audit (39) override (2026-09-18 KST)

> Claude 구현 세션은 이 파일을 최신 독립 감사 진입점으로 본다. 상세 근거는 `docs/AI-SSOT-AUDIT-LOG.md`의 가장 최근 audit 항목과 해당 dated evidence 문서를 함께 확인한다.

## 현재 판정

- **OPEN / HOLD 강화 — RP031 DOM finance가 canonical Sheet writer 경계까지 들어왔다.** PR #399 merge `8842f41afb4b25a29712f78e011ef65d4ec9f718`은 DOM 스크랩 요금(`ianka/lib/wonja/이안카요금.json`)을 `ianka/scripts/이안카-재고시트.mjs`에 연결했고, 같은 스크립트의 `--쓰기`는 registered RP031 Google Sheet를 clear/update할 수 있다. audit (38)의 “rendered DOM은 authority 확인 전 consumer/bootstrap only” 경계와 충돌한다.
- **live production corruption 증거는 없다.** current diagnostic workflow는 수동 `workflow_dispatch` + preview-only이며 `--쓰기`를 넘기지 않는다. RP031 registry는 계속 `google_sheet`, canonical production pin은 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다.
- **latest runtime parity는 promotion을 허용하지 않는다.** run `35291657754`: API 86대, 기존 Sheet plate 16대, 교집합 13대, API-only 73대, Sheet-only 3대, 제안 89행. DOM rate scrape는 각 기간 35카드/27 고유 차종을 확보했지만 fill=0행/0칸이며 직접 원인은 `차명col=-1` — current Sheet에 `차명` header가 없어 model join이 성립하지 않는다.
- **`FILLIFEMPTY`는 authority/provenance가 아니다.** 매핑이 성공하더라도 특정 plate/model/term/mileage/deposit에 대한 source primitive·계산 규칙·parity가 증명되기 전에는 canonical finance writer로 승격하지 않는다.
- audit (35) F86 freshness-checker false positive, audit (27) 손오공 보증금 recurrence, audit (28) 차량가격 lineage, audit (29) 판매탭 naming migration, audit (34) newest-Atom freshness semantics, mirror/sales/settlement/RTDB legacy writer HOLD는 그대로다.

## Claude 구현 Owner 우선순위

1. RP031 DOM finance를 `--쓰기`/schedule/canonical Sheet/Atom promotion에서 분리한 채 primitive·provenance·formula를 먼저 확정한다.
2. real Sheet schema에 `차명`이 없다는 사실부터 해결하고, display-name/fuzzy guess뉼 canonical join으로 쓰지 말고 deterministic model/plate/term/mileage/deposit mapping과 parity를 증명한다.
3. DOM finance가 실제 권위 source로 승인될 때만 registry + Source Contract + writer topology를 명시적으로 변경하고 source-sheet parity → Atom → snapshot → F01/F86 cross-audit까지 한 promotion으로 닫는다.
4. production pin/current main lineage를 혼동하지 않는다. 현 canonical production은 `9bef7bf...`이고 RP031은 Google Sheet canonical이다.
5. RP031과 별개로 audit (35) F86 freshness checker 등 기존 OPEN/HOLD를 독립적으로 유지한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — audit (39)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit39-ianka-dom-finance-writer-boundary.md`
- PR #399 merge `8842f41afb4b25a29712f78e011ef65d4ec9f718`
- PR #400 implementation head `b6e2eb788631efdea4f7b30fc168f4d3d5d15d1e`
- preview run `35291657754`
- `ianka/scripts/이안카-재고시트.mjs`
- `.github/workflows/diag-ianka-collector.yml`
- `lib/domain/inventory-source-registry.ts`
- `.github/workflows/erp5-ssot-refresh.yml`

이번 독립 감사에서는 application code/business logic을 수정하지 않는다. 구현 변경은 Claude 단일 SSOT 세션만 수행한다.
