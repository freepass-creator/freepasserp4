# Claude 실행 오더 — Audit (85) override

최우선 최신 판정: **2026-09-21 09:05 KST settlement native cron delivery가 새 영업일에도 다시 미관측됐고 safe recovery가 필요했다. Recovery plane과 downstream canonical data-plane은 full green이지만 native cadence/timeliness HOLD는 강화된다. ERP5 canonical authority/core business semantics는 그대로다.**

Pre-audit main은 `b5734e4d0f7dc1f248ab40bd45b94fda3dbac1bd`. `settlement-intake-sync.yml`은 계속 KST 월~토 09:05~18:05 native cron을 선언하지만 09:05 logical slot은 native `event=schedule`가 아니라 recovery commit `95a1f5084ec0ce60e7d165bdf5b75220b1afa3f7`로 복구됐다. Settlement run `35550513984`은 `event=push / success`였다.

후속 ERP5 `35550547914`은 `event=workflow_run`, 10:19:50 KST 생성 → 10:32:58 KST completed/success. production pin 고정, source contract/recollection, settlement Atom-lock, 24-source ingest, fixed snapshot, public/F01/F86, F86 freshness, cross-audit, photo audit까지 전 단계 green이다. **따라서 recovery/data-plane은 PASS지만 native cron proof는 아니다.**

Fresh repository-wide `event=schedule` newest는 여전히 ERP5 `35447185563`(2026-09-19 22:55:32 KST / success)이다. 2026-09-20/21 newer native scheduled event가 이번 audit window에서 관측되지 않았으므로 실제 연속 native 회차가 나타나기 전 cadence/timeliness HOLD를 유지한다. GitHub scheduler 영구 장애/disabled라고 단정하지 않는다.

ERP5 canonical boundary는 unchanged: production engine pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source registry, 동일 fixed-snapshot F01/F86, F86 `종합`의 손오공·오토플러스 제외 + dedicated tabs, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired mirror/sales automatic writers, RTDB/mirror non-canonical boundary 유지.

계속 OPEN: Audit (84) FreePass Data SHADOW latency/non-interference, Audit (83) Production Deploy Recovery credential path, Audit (67) quote-default freshness, Audit (71) shared ERP5 concurrency/pending-replacement + 15:05 reconciliation, Audit (76) already-successful native slot false replay.

Claude는 fallback success를 native schedule recovery로 오인하지 않는다. Core source/writer, F01/F86, special-tab, mirror/RTDB, settlement business semantics를 이번 scheduler finding 때문에 변경하지 않는다.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit85-0905-native-settlement-miss-recovery.md`

---
# Claude 실행 오더 — Audit (84) override

최우선 최신 판정: **Audit (83)의 generic main CI chain-break는 해소됐다. 대신 PR #445로 ERP.com 전체 공개 카탈로그에 FreePass Data SHADOW observer가 실제 runtime에 연결됐고, 활성화 시 고객 응답 latency와 결합되는 새 gap이 있다. ERP5 canonical authority는 그대로다.**

Current pre-audit main `cd77fdfabce41a58612f1c92df0a598437b476c9`의 CI run **`35547094484`**가 success이며 ERP4 MAIN stability / ERP5 canonical Firebase / RTDB retirement / settlement / AI Core SHADOW / simulations / Production build가 실제 실행되어 모두 green이다. 따라서 Audit (83)의 “latest main에서 downstream SSOT guards가 skipped” HOLD는 **RESOLVED**다. 다만 `Production Deploy Recovery` run **`35544475310`**의 credential-gate failure는 별도 경로이며 후속 green evidence가 없어 OPEN 유지한다.

PR #445 / merge `757ec62ff521c3046d136ec8004ce38a1e4abf19`의 FreePass Data consumer contract는 active read를 `freepasserp5 / PRODUCTION_READ / fallback NONE`, target을 `freepass-data / SHADOW_READ`, writer cutover를 `OUT_OF_SCOPE`, RTDB를 `NO_NEW_USAGE`로 고정한다. Source Contract run `35545948422`도 success다. 즉 **FreePass Data를 canonical read/write owner로 cutover한 것이 아니다.**

새 OPEN: `lib/server/guest-listing.ts`의 unfiltered public catalog path가 `await observeFreepassDataShadow(products)`를 호출한다. Shadow flag가 true면 observer는 외부 endpoint를 fetch하고 default 1200ms, 최대 5000ms timeout을 기다린다. 오류는 잡고 FreePass Data 값을 고객에게 공급하지 않으므로 data authority/value는 ERP5 그대로지만, 활성 상태에서는 shadow latency가 고객 응답 latency에 영향을 줄 수 있다. Contract의 `shadow_failure=DO_NOT_AFFECT_CUSTOMER_READ`가 latency까지 포함한다면 **runtime non-interference gap**이다. Production flag 활성 여부는 이번 감사에서 증명하지 않았으므로 현재 장애로 단정하지 않는다. Shadow enablement는 HOLD/WATCH로 둔다.

ERP5 canonical boundary는 unchanged: production engine pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source registry, 동일 fixed-snapshot F01/F86, F86 `종합`의 RP012/RP023 제외 + Sonogong `오공구독`/`픽업구독` + AutoPlus `오플구독`, retired mirror/sales automatic writers, RTDB/mirror non-canonical boundary를 유지한다. Audit (82)의 settlement optimistic revision guard/UI transport도 유지된다.

계속 OPEN: audit (67) quote-default freshness, audit (71) shared ERP5 concurrency/pending-replacement + 15:05 reconciliation, audit (76) already-successful native slot false replay, native cadence/timeliness HOLD, Audit (83)의 Production Deploy Recovery credential path.

Claude는 FreePass Data를 non-authoritative SHADOW로 유지한다. `DO_NOT_AFFECT_CUSTOMER_READ`가 latency isolation까지 의미하는지 먼저 확정하고, 포함한다면 customer-response critical path에서 observer를 분리하는 구현만 Claude 단일 SSOT 세션에서 수행한다. 이 audit을 writer cutover, RTDB fallback, canonical source 변경 근거로 사용하지 않는다.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit84-main-ci-recovered-freepass-data-shadow-latency-gap.md`

---
# Claude 실행 오더 — Audit (83) override

최우선 최신 판정: **Audit (82)의 settlement revision-guard/UI 활성화는 계속 유효하지만, current main은 SSOT 검증 체인 기준 CI HOLD다.** Audit 시점 `origin/main` `15d9e651669bdfbc0368643d38d013fcea35e3c2`의 generic CI **`35544887444`**가 `확정 디자인 — 손님 동 규격이 그대로인가`에서 실패했고, 그 뒤 ERP4 MAIN stability / ERP5 canonical Firebase / RTDB / settlement / AI Core SHADOW / simulation / Production build 단계가 전부 skipped 됐다. 따라서 **latest main에서 이 SSOT guards가 green이라고 가정하지 않는다.** Skipped는 failure 증거가 아니라 미실행 증거다.

Current ShopCard/list-money code와 design checker는 목록만 `manShort(price.rent, { decimal: true })`로 축약하고 상세·계약·정산 실제 금액은 원 단위로 유지하는 계약으로 이미 맞춰져 있다. 이 audit은 canonical money corruption을 주장하지 않으며, direct log evidence 없이 남은 design-gate failure를 해당 formatter 탓으로 단정하지 않는다. Claude는 intended UI와 confirmed-design gate를 reconcile하고 **fresh main CI에서 downstream SSOT guards가 실제 실행되어 green**인 증거를 만든다.

별도 운영 HOLD: `Production Deploy Recovery` run **`35544475310`**은 `배포 자격 확인`에서 실패해 install/main 검증/Deploy Hook/Vercel link/CLI production deploy가 모두 skipped 됐다. Workflow 정의상 `VERCEL_DEPLOY_HOOK` 또는 `VERCEL_TOKEN` 중 하나가 필요한데 이 run에서는 둘 다 사용할 수 없었다. 이는 **repo recovery workflow가 그 run에서 deploy를 수행하지 못했다는 뜻**이며, external/native Vercel Git deployment 상태까지 단정하지 않는다. 해당 recovery path를 운영용으로 유지할 것이면 선언된 credential path를 복구/승인하고 green evidence를 남긴다.

ERP5 canonical boundary는 unchanged: production engine pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source registry, 동일 fixed-snapshot F01/F86, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired mirror/sales automatic writers, RTDB/mirror non-canonical boundary를 유지한다. Audit (82)의 ERP4 active optimistic revision guard/first-party expected_revision transport는 유지하고 AI Core는 SHADOW_WITH_GAPS/non-authoritative다.

계속 OPEN: audit (67) quote-default freshness, audit (71) shared ERP5 concurrency/pending-replacement + 15:05 reconciliation, audit (76) already-successful native slot false replay, native cadence/timeliness HOLD.

구현은 Claude 단일 SSOT 세션만 수행한다. 이 audit을 canonical source/writer migration 또는 settlement business semantics 변경 근거로 사용하지 않는다.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit83-main-ci-and-deploy-recovery-red.md`

---

# Claude 실행 오더 — Audit (82) override

최우선 최신 판정: **Audit (81)의 “정산 Core 작업은 route-unchanged SHADOW mapping” 요약은 stale이다. PR #441과 #442로 ERP4 정산 update의 optimistic revision guard와 두 first-party UI transport가 실제 runtime에 활성화됐다. 다만 AI Core contract 자체는 계속 SHADOW_WITH_GAPS이며 ERP5 canonical SSOT 경계는 바뀌지 않았다.**

PR #441 / merge `8e4bcb7a484f1ae024f05297923be100d8a21628`은 Firestore `DocumentSnapshot.updateTime`을 `resource_revision=firestore:<seconds>:<nanoseconds>`로 사용하고, update 호출이 `expected_revision`을 보내면 transaction에서 read/compare/write한다. stale이면 write 없이 HTTP 409 `VERSION_MISMATCH`를 반환한다. Revision을 보내지 않는 legacy/external caller는 호환 경로가 유지된다.

PR #442 / merge `1b31af44fac362085649c13d155e4e0c089ae929`은 SettlementBoard와 IntakeStation이 list/line-detail revision을 보존하고 edit 시 `expected_revision`을 보내게 만들었다. mismatch는 사용자에게 알리고 즉시 최신 데이터를 reload한다. Contract는 `runtime_owner=ERP4`, `runtime_authority_preserved=true`, `cutover_authorized=false`, `OPTIONAL_EXPECTED_REVISION`; request/correlation ID와 full Core error/result envelope는 계속 gap이다. Main 검증은 #441 CI `35507964978` + Source Contract `35507965001`, #442 CI `35508944501` + Source Contract `35508944490` 모두 success다.

Production engine pin은 계속 `cf940df642edf315adbc6da2b4134fbad53da160`이다. Core boundary도 unchanged: 24-source ERP5 registry, 동일 fixed-snapshot F01/F86, F86 `종합`의 손오공·오토플러스 제외 + dedicated tabs, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired `mirror-sync`/`sales-erp-hourly` automatic writer, RTDB/mirror non-canonical boundary를 유지한다. Commit `6188a9ea6b22a7513e51c325384c8558201708e2`의 FreePass Data Hub handoff는 docs-only이며 이 경계를 바꾸지 않는다.

계속 OPEN: audit (67) standard quote-defaults projection freshness, audit (71) shared ERP5 concurrency/pending-replacement + 15:05 cancelled-before-job reconciliation, audit (76) successful native 18:05 settlement false replay, native cadence/timeliness HOLD.

Claude는 active revision guard와 first-party UI transport를 보존한다. 이 감사를 AI Core runtime cutover, ERP5 canonical writer migration, settlement business semantics 확대의 근거로 사용하지 않는다. Legacy/external caller까지 `expected_revision`을 강제할지는 별도 구현 결정이다. 구현은 Claude 단일 SSOT 세션만 수행한다.

Detail: `docs/ai-ssot-audit/2026-09-20-chatgpt-audit82-settlement-revision-ui-active.md`

---

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