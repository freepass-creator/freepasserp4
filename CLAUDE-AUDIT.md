# Claude 실행 오더 — Audit (98) current entry point

최우선 최신 판정: **Audit (97)의 `c3838708b84527db241f1985c140a3ec6ece6bff` current-production 판정은 PR #457 이후 stale이다. 현재 repository의 configured ERP5 production engine은 `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`다. 다만 이 re-pin은 아직 production-equivalent full-green을 확보하지 못했다.**

PR #457 merge `5266d634187493d871f4c5f13a07af0fb0f70698`가 `.github/workflows/erp5-ssot-refresh.yml`, Core ingest receipt revision, AI Core shadow source/revision, validated-engine allowlist를 `0e0bfb3...`로 다시 전진시켰다. 이 lineage는 Sonogong three-bucket/source-specific classification과 `손오공상품` projection 계약을 가진다. Stale current-main metadata에 맞추기 위해 임의 rollback하지 말고, 구현 owner가 검증 증거를 기준으로 유지/수정한다.

**Post-repin ERP5 validation은 HOLD다.** Run `35572350744`은 source recollection과 settlement→Atom contract lock까지 성공했지만 `원천에서 ERP5 현재 원자 계산`에서 cancelled됐다. 따라서 fixed snapshot, public catalog, F01/F86 publish, freshness, Atom↔F01↔F86 cross-audit, photo/evidence는 모두 실행되지 않았다. 이 run을 data corruption으로 확대 해석하지도, full PASS로 취급하지도 않는다. 새 pin의 운영 확정은 production-equivalent full pipeline green 뒤에만 한다.

**Audit 90–91 runtime↔main semantic skew는 계속 OPEN이다.** Current-main `lib/domain/inventory-source-registry.ts`는 RP012 channels를 아직 `LOW_SONOKONG · LOW_TCAR` 둘만 선언하고 일반 렌트 ERP API bucket HOLD를 남긴다. Active engine 의미와 registry/runtime helper/Source Contract를 fail-closed로 정렬한다. Canonical authority 자체는 RP012 Sonogong ERP/API, RP023 RebornCar로 유지한다.

**Dedicated SSOT Source Contract gate도 계속 HOLD다.** Re-pin 이후 run `35571946592`, PR #458 head `35572954687`, current-main `35572965499`가 pre-job failure로 끝났다. Generic CI는 이 전용 fail-closed gate를 대체하지 않는다. `.github/workflows/ssot-source-contract.yml`의 workflow/YAML governance 문제를 구현 세션에서 복구하고 실제 source-contract job green을 확보한다.

**PR #458은 새로운 opt-in 표시 전용 writer topology를 추가했다.** Merge `0366d714532ecbee86763716efa13279067675de`의 `.github/workflows/sheet-formatting-only.yml`은 F01/F86만 대상으로 하는 manual `workflow_dispatch`이며 ingest/Firestore/row writes를 하지 않는다. `widths` mode는 엄격한 evidence gate 아래 column width만 쓸 수 있고, `full` title/wrapping mode는 `contracts/sheets/reference-audit.json`이 `UNAVAILABLE`인 동안 fail-closed로 막혀 있다. 이 경로를 inventory SSOT authority로 승격하지 않는다.

첫 Sheet Contract runs도 운영 적용 증거가 아니다. F01 `35572968635`와 F86 `35573151608`은 모두 preflight에서 `unauthorized_client`로 실패했고 failure receipts는 `writeAttempted=false`다. Workspace delegated authentication을 해결하고 fresh dry-run evidence를 다시 확보하기 전에는 apply하지 않는다. Full mode는 Apps Script/external consumer reference audit가 `VERIFIED`가 되기 전까지 계속 막는다.

15:05 Audit (95) full-green은 historical last-known-good evidence로 유지하지만 새 `0e0bfb3...` pin의 검증 증거로 대체 사용하지 않는다. Native cadence/recovery timeliness, persistent monitor reconciliation, Production Deploy Recovery credential path 등 기존 OPEN도 별도 트랙으로 유지한다.

Legacy boundary는 유지한다. `mirror-sync.yml` / `sales-erp-hourly.yml`은 schedule-free manual dry-run retired 상태이며 RTDB/mirror는 non-canonical이다. F01/F86 parity gate, Sonogong/AutoPlus source authority, retired mirror/RTDB 경계를 약화하지 않는다.

상세 근거:
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit98-pr457-repin-pr458-sheet-contract-hold.md`
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit97-pr455-safety-revert-audit96-race-correction.md` — superseded current-pin conclusion
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit95-1505-downstream-erp5-full-green.md`
- `docs/AI-SSOT-AUDIT-LOG.md` — append-only 중앙 원장

이 파일은 최신 실행 진입점이다. 과거 감사 이력은 중앙 원장과 `docs/ai-ssot-audit/` dated decisions를 따른다.
