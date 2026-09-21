# Claude 실행 오더 — Audit (99) current entry point

최우선 최신 판정: **현재 repository의 configured ERP5 production engine은 PR #457 이후 `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`지만, 이 re-pin은 아직 production-equivalent full-green을 확보하지 못했다.** Audit (97)의 `c3838708...` current-production 판정은 superseded다.

PR #457 merge `5266d634187493d871f4c5f13a07af0fb0f70698`가 ERP5 workflow/Core receipt/AI Core shadow/validated-engine allowlist를 `0e0bfb3...`로 전진시켰다. 이 lineage는 Sonogong three-bucket/source-specific classification과 F86 `손오공상품` projection 계약을 가진다. Stale current-main metadata에 맞추려고 임의 rollback하지 말고 검증 증거 기준으로 유지·정렬한다.

**Post-repin ERP5 validation은 계속 HOLD다.** Runs `35572350744` 및 `35573163050`은 모두 cancelled돼 fixed snapshot → public/F01/F86 publish → freshness/cross-audit/photo/evidence의 full-green을 만들지 못했다. 이 run들을 published-data corruption으로 확대 해석하지도, Audit (95)의 historical full-green을 새 pin 검증으로 대체 사용하지도 않는다.

**Audit 90–91 runtime↔main semantic skew는 계속 OPEN이다.** Current-main `lib/domain/inventory-source-registry.ts`는 RP012 channels를 아직 `LOW_SONOKONG · LOW_TCAR` 둘만 선언하고 일반 렌트 ERP API bucket HOLD를 남긴다. Active engine 의미와 registry/runtime helper/Source Contract를 fail-closed로 정렬한다. Canonical authority 자체는 RP012 Sonogong ERP/API, RP023 RebornCar로 유지한다.

**Dedicated SSOT Source Contract gate도 계속 HOLD다.** Re-pin 이후에도 dedicated workflow가 pre-job failure를 반복해 실제 source-contract job green을 만들지 못했다. Generic CI는 이 전용 fail-closed gate를 대체하지 않는다.

**Sheet Contract writer 상태는 Audit (98)보다 진전됐다.** PR #459 merge `9a5a21e7fa5b71984f9761868722125c963e7054`가 delegated Workspace scope를 existing publisher의 DWD scope와 맞췄다. F01 widths dry-run `35573509757`은 `SHEET_FORMAT_APPLY=false`로 preflight/readback/evidence까지 success였다. 이어 F01 guarded apply-mode run `35573824838`도 `SHEET_FORMAT_APPLY=true`, expected snapshot hash/revision/timestamp를 건 상태에서 success했고 receipt가 `READBACK_PASS`, `beforeHash == afterHash`, `fails=[]`, `writes=0`이었다. 즉 **F01 widths mode의 auth·precondition·zero-op apply/readback 경로는 PASS**지만, 이미 폭이 규격에 맞아 실제 mutation은 0건이므로 실제 write/rollback 검증까지 PASS로 확대하지 않는다.

PR #458의 `.github/workflows/sheet-formatting-only.yml`은 계속 manual `workflow_dispatch` 표시 전용 writer다. Ingest/Firestore/row write를 하지 않으며 inventory SSOT authority로 승격하지 않는다. `full` title/wrapping mode는 `contracts/sheets/reference-audit.json`이 `VERIFIED`되기 전까지 fail-closed로 유지한다. Fresh F86 post-fix validation도 별도 확보한다.

Legacy boundary는 유지한다. `mirror-sync.yml` / `sales-erp-hourly.yml`은 schedule-free manual dry-run retired 상태이며 RTDB/mirror는 non-canonical이다. F01/F86 fixed-snapshot parity, Sonogong/AutoPlus source authority, retired mirror/RTDB 경계를 약화하지 않는다.

기존 native cadence/recovery timeliness, persistent monitor reconciliation, Production Deploy Recovery credential path 등 OPEN은 별도 트랙으로 유지한다.

상세 근거:
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit99-sheet-auth-dryrun-partial-resolution.md`
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit98-pr457-repin-pr458-sheet-contract-hold.md`
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit97-pr455-safety-revert-audit96-race-correction.md`
- `docs/AI-SSOT-AUDIT-LOG.md` — append-only 중앙 원장

이 파일은 최신 실행 진입점이다. 과거 감사 이력은 중앙 원장과 `docs/ai-ssot-audit/` dated decisions를 따른다.
