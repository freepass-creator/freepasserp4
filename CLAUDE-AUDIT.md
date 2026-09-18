# ChatGPT 독립 SSOT 감사 — audit (40) override (2026-09-18 KST)

> Claude 구현 세션은 이 파일을 최신 독립 감사 진입점으로 본다. 상세 근거는 `docs/AI-SSOT-AUDIT-LOG.md` audit (40)과 dated evidence 문서를 함께 확인한다.

## 현재 판정

- **OPEN / HOLD — PR #402의 `차명원문 → 세부모델` 해결책은 canonical identity와 DOM-finance join을 한 칸에 결합한다.** audit (39)의 missing `차명` 문제를 해결하려고 API `차명원문`을 canonical Sheet `세부모델`에 쓰고, 같은 `세부모델`을 finance lookup key로 쓰는 것은 deterministic identity/provenance가 증명되기 전에는 허용하지 않는다.
- PR #402는 이 감사 시점 **open / unmerged**, head `af041f83661cf1959f9405424ef80bff17436802`다. current main/production에 이 변경으로 인한 live corruption 증거는 없다.
- 실제 Sheet schema는 `차명(원문)`·`차명`·`차량명`뿐 아니라 **`연식` 칼럼도 없다.** `세부모델`이 있다는 이유만으로 API raw display name의 대체 저장소로 간주하지 않는다.
- `행빌드()`는 기존 row를 기반으로 하되 source 값이 있으면 대상 칸을 다시 쓰므로 PR #402를 `--쓰기`로 실행하면 기존 `세부모델`을 덮어쓸 수 있다. 이는 finance FILLIFEMPTY보다 강한 identity mutation이다.
- RP031 canonical registry는 계속 Google Sheet이며 production pin은 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다. diagnostic workflow도 preview-only다.
- audit (35) F86 freshness checker false positive, audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics, mirror/sales/settlement/RTDB legacy writer HOLD는 그대로다.

## Claude 구현 Owner 우선순위

1. PR #402를 현재 형태 그대로 merge/write하지 않는다. API `차명원문`과 canonical `세부모델`의 의미 동일성 및 기존 값 보존/마이그레이션 계약부터 증명한다.
2. finance join은 display-name overwrite와 분리해 deterministic model/plate/term/mileage/deposit key와 source parity/provenance를 증명한다.
3. `연식` 칼럼 부재를 별도 schema gap으로 처리한다. 쓰일 곳이 없다는 이유로 누락을 canonical completeness로 해석하지 않는다.
4. DOM finance를 실제 authority로 승인할 때만 registry + Source Contract + writer topology를 명시적으로 바꾸고 source-sheet parity → Atom → snapshot → F01/F86 cross-audit로 promotion을 닫는다.
5. 그 전까지 audit (38)/(39)의 consumer/bootstrap-only 원칙과 RP031 Google-Sheet canonical HOLD를 유지한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — audit (40)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit40-ianka-submodel-identity-boundary.md`
- PR #402 head `af041f83661cf1959f9405424ef80bff17436802`
- evidence commit `5c8fed2fb5074d7fe102eb96e2b3ee3d756355ef`

이번 독립 감사에서는 application code/business logic을 수정하지 않는다. 구현 변경은 Claude 단일 SSOT 세션만 수행한다.
