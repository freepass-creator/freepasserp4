# ChatGPT 독립 SSOT 감사 — audit (44) override (2026-09-18 KST)

> Claude 구현 세션은 이 파일을 최신 독립 감사 진입점으로 본다. audit (44)은 audit (43)의 schedule/HOLD를 유지하면서 **RP031 canonical Sheet actual write**와 **상품구분 색 main ↔ production-pin drift**를 최우선으로 추가한다.

## 현재 판정

- **OPEN / RP031 writer-boundary crossing.** run `35301987039`(head `9ce3bb6815d09c9bc2b9158183b9b4839c835e68`)이 `apply=true`로 `이안카-재고시트.mjs --쓰기`를 실제 실행했다. API 82대 + Sheet-only 3대 = 85행을 canonical RP031 Google Sheet에 썼고, rendered-DOM 요금표로 blank finance **53행·389칸**을 채웠다. registry는 여전히 그 Google Sheet를 RP031 canonical source로 본다. audit (42)/(43)의 identity/finance provenance HOLD 중 값이 canonical source Sheet 안으로 들어간 상태이므로 write 전 backup ↔ current Sheet diff와 authority 검증이 필요하다.
- **RESOLVED / PARTIAL — 상품구분 색 manual repaint 경로.** PR #406 `ae41fb87...`가 `신차렌트`를 원래 밝은 분홍 `#FF00FF`로 복구했고, PR #407 `e8956bca...`가 credential composite-action parser 오류를 고쳤다. run `35302940384`은 `apply=true`로 성공해 27개 공급사 탭의 조건부서식을 재도색했다. audit (18)의 composite-action load 오류는 이 경로에서 해소됐다.
- **OPEN / 색 SSOT production-pin drift.** canonical `erp5-ssot-refresh.yml` pin은 여전히 `9bef7bf0...`; 그 pin의 `category-colors.ts`는 `신차렌트=#B81A8C`다. current main은 `#FF00FF`다. one-time repaint만으로는 durable하지 않으며, schedule 복구 후 pinned F01/F86 publisher가 재발행하면 어두운 자주색이 다시 나타날 수 있다.
- **OPEN / audit (43) schedule delivery.** 본 감사 재조회에서도 repository 최신 `event=schedule`은 `35235961510`(2026-09-17 23:47:38 KST) 그대로다. manual/push success를 schedule 복구 증거로 쓰지 않는다.
- audit (35) F86 freshness checker, audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics, mirror/sales/settlement/RTDB legacy writer HOLD는 그대로다.
- audit (43) 이후 implementation diff는 credential action, Ianka diag/write path, Ianka lease taskId, category-colors 네 파일뿐이다. ERP5 canonical registry/F01/F86 core workflow/Sonogong·AutoPlus routing/mirror·sales·RTDB core는 이 구간에서 변하지 않았다.

## Claude 구현 Owner 우선순위

1. **RP031 current canonical Sheet를 write 전 backup과 diff**해 신규 69대 및 DOM-derived 389 finance cells의 provenance/authority를 확정한다. 검증 전 DOM finance를 authoritative canonical 값으로 간주하지 않는다.
2. **`신차렌트=#FF00FF`를 실제 production-pinned publisher lineage에도 보존**한다. one-time supplier repaint로 끝내지 말고 full F01/F86 publish 뒤에도 색이 재역전되지 않는 것을 증명한다.
3. audit (43)의 schedule delivery와 audit (35)의 F86 freshness parser는 별도 OPEN으로 계속 닫는다.
4. 기존 audit (27)/(28)/(29)/(34) 및 legacy writer HOLD는 별도 해소 증거가 생길 때까지 유지한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — audit (44)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit44-rp031-write-color-pin-drift.md`
- RP031 actual apply run `35301987039`
- color repaint apply run `35302940384`
- main color fix `ae41fb87bf9e4028ea207c6822e88f014ec50810`
- credential action fix `e8956bcac84e87f8bcf4a0b3b212119c7642be8c`
- production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60` — `신차렌트=#B81A8C`
- latest repository schedule run `35235961510`

이번 독립 감사에서는 application code/business logic을 수정하지 않는다. 구현 변경은 Claude 단일 SSOT 세션만 수행한다.
