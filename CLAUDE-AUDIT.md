# Claude 실행 오더 — Audit (81) override

최우선 최신 판정: **Audit (80)의 AI Core SHADOW main-push Source Contract coverage gap은 해소됐다. 동시에 정산 신규접수 API의 AI Core mapping이 새 SHADOW pilot으로 추가됐지만 runtime authority/cutover는 바뀌지 않았다.**

PR #439 / commit `d81c97fccc37566aa97e67d133dca6341bf42721`이 `.github/workflows/ssot-source-contract.yml`의 `push.paths`에 `scripts/check-ai-core-contract-shadow.mts`, `lib/domain/ai-core-contract-shadow.ts`, `contracts/ai-core/**`를 추가했다. Current main `0b3f9d13ef12a86a6e83ac3c95d2c6985c08226c`은 실제로 `contracts/ai-core/**`를 변경했고, 그 resulting main push에서 `SSOT Source Contract` run **`35507383468`**이 `event=push / success`로 생성됐다. 따라서 audit (80)의 “AI Core shadow-only main change가 Source Contract 없이 들어갈 수 있음” finding은 **RESOLVED**로 닫는다.

PR #440 / current main `0b3f9d13...`은 `contracts/ai-core/settlement-intake.api-shadow.json`, `scripts/check-ai-core-api-shadow.mts`와 generic CI step을 추가했다. 이 contract는 `runtime_owner=ERP4`, `runtime_authority_preserved=true`, `cutover_authorized=false`, `external_response_shape_changed=false`를 명시하며 request/correlation/idempotency/revision/result-envelope 미도입 부분은 `SHADOW_WITH_GAPS`로 남긴다. 같은 head의 generic CI run **`35507383421`**도 `success`다. **이 SHADOW를 production API cutover나 canonical writer 변경으로 해석하지 않는다.**

Production engine pin은 계속 `cf940df642edf315adbc6da2b4134fbad53da160`이다. Core boundary는 unchanged: 24-source ERP5 runtime registry, 동일 fixed-snapshot F01/F86, F86 `종합`의 손오공·오토플러스 제외 + 각 dedicated tab 유지, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired `mirror-sync`/`sales-erp-hourly` automatic writer, RTDB/mirror non-canonical boundary를 유지한다.

계속 OPEN: audit (67) standard quote-defaults projection freshness trigger, audit (71) shared concurrency/pending-replacement 및 15:05 cancelled-before-job reconciliation, audit (76) 이미 성공한 native 18:05 settlement의 fallback false replay, native cadence/timeliness HOLD. 이번 audit은 이 항목들을 닫지 않는다.

Claude는 audit (80)의 CI gap을 재수정하지 말고 **해소됨**으로 취급한다. 새 settlement-intake Core mapping은 SHADOW/non-authoritative 상태를 유지한다. Canonical source/writer, F01/F86, special-tab, mirror/RTDB, settlement business semantics 변경은 이번 audit에서 요구하지 않는다. 구현은 Claude 단일 SSOT 세션만 수행한다.

Detail: `docs/ai-ssot-audit/2026-09-20-chatgpt-audit81-ai-core-push-guard-resolved-api-shadow.md`

---

# Claude 실행 오더 — Audit (80) override

최우선 최신 판정: **AI Core Core Contract SHADOW가 main에 실제 병합됐고, production SSOT 의미는 유지되지만 main push CI path guard에 새 빈틈이 있다.** Current main implementation delta의 기준 merge는 `14056f8c2c3a7cc973d956b4f23929a4c420fb98`이다. 이 merge는 `contracts/ai-core/**`, `lib/domain/ai-core-contract-shadow.ts`, `scripts/check-ai-core-contract-shadow.mts`, `scripts/core-contract/**`와 ERP5 ingest Core receipt shadow를 추가했다.

Production engine pin은 계속 `cf940df642edf315adbc6da2b4134fbad53da160`이다. `erp5-ssot-refresh.yml`의 새 receipt 경로는 helper만 `${{ github.workflow_sha }}`에서 sparse checkout하고 receipt build/upload를 `continue-on-error: true`로 수행하므로 canonical writer/publish 경계를 대체하지 않는다. Merge push run `35479442674`의 Source Contract CI는 canonical inventory contract, AI Core shadow, receipt parser, workflow regression까지 전부 success다.

**새 OPEN:** `.github/workflows/ssot-source-contract.yml`의 `pull_request.paths`에는 `scripts/check-ai-core-contract-shadow.mts`, `lib/domain/ai-core-contract-shadow.ts`, `contracts/ai-core/**`가 포함되지만 `push.paths`에는 이 세 경로가 빠져 있다. 따라서 이 shadow 파일들만 바뀌는 future main push/merge는 resulting main commit에서 `SSOT Source Contract`를 트리거하지 않을 수 있다. 현재 `main`은 branch protection이 꺼져 있고 required status check도 없으므로 PR-only 실행을 fail-closed enforcement로 가정하면 안 된다. 이는 **CI/governance coverage gap**이며 현재 ERP5 canonical data 오류 증거는 아니다.

Core boundary는 unchanged: 24-source ERP5 runtime registry, fixed-snapshot F01/F86, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, F86 `종합`의 Sonogong/AutoPlus special-channel 제외, retired legacy automatic writers, RTDB/mirror non-canonical boundary를 유지한다. Audit (67), (71), (76), native cadence/timeliness HOLD도 직접 해소 evidence 없이 닫지 않는다.

Claude는 SHADOW/non-authoritative 상태를 유지하면서 Source Contract의 main push path coverage를 PR path coverage와 동등하게 fail-closed로 맞춘다. 구현은 Claude 단일 SSOT 세션만 수행한다.

Detail: `docs/ai-ssot-audit/2026-09-20-chatgpt-audit80-ai-core-shadow-ci-push-filter-gap.md`

---

# Claude 실행 오더 — Audit (78) override

최우선 최신 판정: **native direct ERP5 delivery 재관측 / cadence·timeliness HOLD 유지.** Audit (77)의 “18:31 이후 native `event=schedule`이 없고 final 19:17 slot이 계속 미관측” runtime snapshot은 stale이다. 새 ERP5 native schedule run **`35447185563`**이 **2026-09-19 22:55:32 KST** 생성돼 **23:05:39 KST `success`**로 끝났다. Production pin은 `cf940df642edf315adbc6da2b4134fbad53da160`이며 source contract → source recollection → settlement Atom lock → 24-source ingest → fixed snapshot → public/F01/F86 → freshness/cross-parity/photo audit까지 full green이다.

다만 current direct cron의 당일 마지막 선언 slot은 19:17 KST이고, 이 run은 그보다 **3시간 38분 32초 뒤** 도착했다. GitHub run metadata가 nominal slot identity를 노출하지 않으므로 이를 확정적으로 “19:17 run”이라고 부르지 않는다. **Native delivery resumption은 확인됐지만 연속 cadence·정시성 복구는 미증명**이다. Fallback `push`/settlement→ERP5 `workflow_run` coverage와 direct native schedule proof를 계속 분리한다.

계속 OPEN: audit (71) pending-replacement/15:05 cancelled-before-job reconciliation, audit (76) successful native 18:05 settlement false replay, audit (67) quote-defaults projection freshness trigger. Audit (77) 이후 application/business logic commit은 없으며 24-source registry, fixed-snapshot F01/F86, F86 `종합`의 손오공·오토플러스 제외 + 각 special tab 유지, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired legacy automatic writers, RTDB/mirror non-canonical boundary는 unchanged다.

Claude는 이 1회의 very-late green을 cadence recovery로 닫지 않는다. 구현은 Claude 단일 SSOT 세션만 수행한다.

Detail: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit78-very-late-native-erp5-success.md`

---

# Claude 실행 오더 — Audit (77) override

최우선 최신 판정: **native direct ERP5 cadence HOLD 강화.** audit (76) 이후 application/business logic 변화는 없지만, 2026-09-19 22:24 KST 기준 repository-wide newest `event=schedule`은 여전히 ERP5 run `35434923578`(18:31:19 KST, success)이다. Direct cron은 KST `09:17~19:17`이므로 **19:17 마지막 slot이 3시간 7분 이상 native event 없이 지나갔다.** audit (75)의 “19:17은 아직 missing으로 단정하기 이르다”는 설명은 stale이다.

이 finding은 **native cron delivery/cadence**에 한정한다. audit (76)의 18:05 fallback settlement `35439018911`과 downstream ERP5 `35439046831`은 성공했으므로 19:17 direct event 부재를 “production refresh가 전혀 없었다” 또는 data corruption으로 확대하지 않는다. Recovery coverage와 native-cron proof를 분리한다.

계속 OPEN: audit (71) pending-replacement/15:05 cancelled-before-job reconciliation, audit (76) successful native slot false replay, audit (67) quote-defaults projection freshness trigger. Production pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source registry, fixed-snapshot F01/F86, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired legacy schedules, RTDB/mirror non-canonical boundary는 unchanged다.

Claude는 연속 real `event=schedule` 회차가 확인되기 전 native cadence/timeliness를 닫지 않는다. 구현은 Claude 단일 SSOT 세션만 수행한다.

Detail: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit77-1917-native-erp5-slot-missing.md`

---

# CLAUDE-AUDIT — latest SSOT audit entry point

## Audit (76) override — 2026-09-19 KST

Claude is the sole implementation owner. ChatGPT is an independent auditor only.

### New material delta

- **NEW recovery reconciliation conflict:** logical settlement slot `2026-09-19 18:05 KST` had already succeeded natively via settlement run `35434637121` (`event=schedule`, created 18:25:08 KST, success) and downstream ERP5 `35434667030` (success), but commit `a6293e5845adde5bf4a86e384fc025bbf4fc73d8` at 20:02:30 KST still classified 18:05 as missing and wrote the heartbeat fallback.
- The fallback caused a second settlement production invocation `35439018911` (`event=push`, success) and second ERP5 `35439046831` (`event=workflow_run`, success). Current monitor state records those fallback IDs as the recovered 18:05 slot.
- **Do not call this data corruption:** no duplicate rows or corrupted projection are proven. The confirmed defect is redundant same-slot production replay caused by recovery eligibility/reconciliation drift.
- **Audit (71) queue hazard remains OPEN:** redundant fallbacks add triggers to the same `erp5-inventory-publish` concurrency plane, while the 15:05 ERP5 `35427915834` cancelled-before-job slot is still unreconciled.
- **Native cadence/timeliness remains HOLD:** native settlement/direct ERP5 delivery has returned but has been delayed and is not yet stable enough for GO.
- Audit (75) public ERP5-only read lock remains valid. Production pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source canonical registry, same-snapshot F01/F86, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired legacy automatic writers, and RTDB/mirror non-canonical boundary are unchanged. Audit (67) quote-defaults freshness HOLD remains OPEN.

### Claude handoff

1. Reconcile a logical settlement slot against successful native runs and prior recovery history **before** heartbeat fallback eligibility.
2. Make recovery slot/cursor state monotonic and no-replay, with explicit slot identity shared across native settlement, heartbeat fallback, and downstream ERP5 chain.
3. Suppress redundant fallback for a slot already proven successful natively; avoid unnecessary ERP5 triggers while audit (71) queue safety remains unresolved.
4. Keep the 15:05 cancelled-before-job reconciliation and native cadence/timeliness HOLDs separate.
5. Preserve current canonical source, F01/F86 fixed-snapshot, special-tab, ERP4 MAIN public read-lock, and legacy-retirement contracts.

Detail: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit76-false-settlement-recovery-replayed-successful-native-slot.md`

No application code or business logic was modified by the auditor.