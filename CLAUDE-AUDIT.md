# ChatGPT 독립 SSOT 감사 — audit (42) override (2026-09-18 KST)

> Claude 구현 세션은 이 파일을 최신 독립 감사 진입점으로 본다. audit (42)가 audit (41)의 `세부모델` destructive-overwrite 범위를 갱신한다.

## 현재 판정

- **RESOLVED / PARTIAL — PR #403 merge `88b16da5c07a1091eba401540891c41280731408`.** 기존 non-empty canonical `세부모델`을 API `차명원문`으로 ALWAYS 덮던 audit (41) 위험은 해소됐다. 전용 차명 칼럼이 없을 때 `세부모델` fallback은 이제 **FILLIFEMPTY**다.
- PR head CI run `35294178908`은 success했고, main preview run `35294388217`도 success했다.
- **OPEN / HOLD — FILLIFEMPTY는 identity 계약의 증명이 아니다.** blank `세부모델`에는 여전히 API rawName이 들어갈 수 있고, 같은 `세부모델`이 rendered-DOM finance lookup alias로 쓰일 수 있다. `rawName=subModel` business identity, deterministic `model/plate/term/mileage/deposit` mapping, finance source provenance/authority는 아직 미증명이다.
- 실제 RP031 Sheet의 `연식` 칼럼 부재도 그대로다.
- run `35294388217`은 API 85대(출고가능 84), 요금 27종, preview 88행(신규72/보존3), rate FILLIFEMPTY 56행·413칸을 만들고 `[미리보기만] 라이브 안 건드림`으로 끝났다. 따라서 live Sheet/Atom/F01/F86 cutover 증거는 아니다.
- production pin은 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다. audit (41) 이후 main delta는 1 commit / 2 files뿐이라 production workflow, registry, F01/F86, Sonogong/AutoPlus, mirror/RTDB 경로는 이번 변경으로 닫히지 않았다.
- audit (35) F86 freshness checker, audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics, mirror/sales/settlement/RTDB legacy writer HOLD는 그대로다.

## Claude 구현 Owner 우선순위

1. non-empty `세부모델` 보존은 **해소됨**으로 보고 PR #403의 FILLIFEMPTY 안전화를 되돌리지 않는다.
2. FILLIFEMPTY를 canonical identity 승인으로 확대하지 않는다. blank 신규행의 `rawName → subModel` 의미와 보존/마이그레이션 계약을 먼저 확정한다.
3. finance join을 identity fallback과 분리해 deterministic model/plate/term/mileage/deposit key와 source provenance/parity를 증명한다.
4. `연식` 칼럼 부재를 명시적 schema gap으로 닫는다.
5. 위 경계를 닫은 뒤에만 `--쓰기` / scheduled writer / production repin을 검토하고 Sheet → Atom → snapshot → F01/F86 cross-audit로 승격을 증명한다.
6. 기존 audit (35)/(27)/(28)/(29)/(34) 및 legacy writer HOLD는 별도 해소 증거가 생길 때까지 유지한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — audit (42)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit42-ianka-fillifempty-resolution.md`
- PR #403 merge `88b16da5c07a1091eba401540891c41280731408`
- PR CI run `35294178908`
- main preview run `35294388217`

이번 독립 감사에서는 application code/business logic을 수정하지 않는다. 구현 변경은 Claude 단일 SSOT 세션만 수행한다.
