# ChatGPT 독립 SSOT 감사 — audit (41) override (2026-09-18 KST)

> Claude 구현 세션은 이 파일을 최신 독립 감사 진입점으로 본다. audit (41)이 audit (40)의 `pre-merge` 범위 설명을 정정한다.

## 현재 판정

- **OPEN / HOLD — PR #402는 이미 main에 merge됐다.** merge commit `86ecb136681151f4c7602a3ccdd4ef6eae51fb0a`.
- current main `ianka/scripts/이안카-재고시트.mjs`는 API `차명원문`을 canonical Sheet의 `세부모델` alias에 쓰고, 같은 `세부모델`을 rendered-DOM finance lookup key로 사용한다.
- `행빌드()`는 existing row를 복사한 뒤 non-empty source 값을 대상 칸에 다시 쓰므로 `--쓰기`가 실행되면 기존 `세부모델`을 API raw display name으로 덮어쓸 수 있다. **identity/model mutation과 finance lookup이 결합된 current-main writer conflict**다.
- API `차명원문` = canonical `세부모델`이라는 business identity 계약, 기존 값 보존/마이그레이션 규칙, DOM rate의 deterministic model/plate/term/mileage/deposit mapping, finance upstream authority/provenance는 아직 증명되지 않았다.
- 실제 RP031 Sheet에는 `차명(원문)`·`차명`·`차량명`뿐 아니라 **`연식` 칼럼도 없다.** `연식`은 별도 schema completeness gap으로 처리한다.
- **live corruption 증거는 아직 없다.** diagnostic workflow는 manual preview-only이고 `--쓰기`를 호출하지 않는다. RP031 registry는 계속 Google Sheet canonical이며 production pin은 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다.
- audit (35) F86 freshness checker false positive, audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics, mirror/sales/settlement/RTDB legacy writer HOLD는 그대로다.

## Claude 구현 Owner 우선순위

1. current main의 `차명원문 → 세부모델 overwrite`를 canonical solution으로 승인하거나 `--쓰기`/scheduled writer에 연결하지 않는다.
2. rawName/subModel 의미 동일성, 기존 `세부모델` 보존»마이그레이션 규칙을 먼저 확정한다.
3. finance join은 identity overwrite와 분리해 deterministic model/plate/term/mileage/deposit key와 source provenance/parity를 증명한다.
4. `연식` 칼럼 부재를 명시적 schema gap으로 닫는다.
5. DOM finance authority가 승인된 경우에만 registry + Source Contract + writer topology를 변경하고 source-sheet parity → Atom → snapshot → F01/F86 cross-audit로 production promotion을 닫는다.
6. 그 전까지 audit (38)/(39)의 consumer/bootstrap-only 원칙과 RP031 Google-Sheet canonical HOLD를 유지한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — audit (41)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit41-ianka-submodel-merged-main.md`
- PR #402 merge `86ecb136681151f4c7602a3ccdd4ef6eae51fb0a`
- evidence commit `b1c6672104dedb4039e336a3ed1fb425d62868d8`

이번 독립 감사에서는 application code/business logic을 수정하지 않는다. 구현 변경은 Claude 단일 SSOT 세션만 수행한다.
