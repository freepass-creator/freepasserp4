# Claude 실행 오더 — Audit (92) override

최우선 최신 판정: **production pin `c3838708b84527db241f1985c140a3ec6ece6bff`은 ERP5 run `35564286647`로 end-to-end full-green 검증됐다. 14:05 recovery ERP5 `35566458884`도 full-green이다. 다만 current-main RP012 registry/status semantic skew는 계속 OPEN이고 safe-chain monitor는 14:05 success를 아직 in-progress/pending으로 저장해 stale하다.**

`35564286647`의 Sonogong bulk-registration step은 skipped였으므로 `register_sonogong_current`는 implemented-but-unexercised로 유지한다. Production three-bucket/status semantics를 stale main에 맞춰 되돌리지 말고 current-main RP012 registry/runtime helper/Source Contract를 production truth에 정렬한다. Monitor는 completed Actions result와 reconciliation한다.

F86 fixed tabs `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`, F01 `상품리스트 · 오공구독 · 픽업구독 · 오플구독`, RP023 RebornCar, retired mirror/sales automatic writer, RTDB/mirror non-canonical boundary는 유지한다.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit92-c383-full-green-monitor-reconciliation.md`

---
# Claude 실행 오더 — Audit (91) override

최우선 최신 판정: **Audit (90)의 Sonogong runtime/main registry drift는 아직 해소되지 않았고, PR #451이 production engine을 `c3838708b84527db241f1985c140a3ec6ece6bff`로 전진시키면서 status/listability 의미까지 skew가 깊어졌다. PR #450은 별도로 현재 Sonogong API 전 차량을 명시적으로 정식 등록하는 default-off 수동 ERP5 writer mode를 추가했다.**

Production `c3838708...`은 RP012 `sokrc.com/api`의 `LOW_SONOKONG_DAILY · LOW_SONOKONG · LOW_TCAR` 세 bucket 의미를 유지하면서, Sonogong API `계약중`은 `계약중`으로 보존하고 `listable=true`로 처리한다. 일반 sheet의 `계약중`은 계속 `출고불가`로 보수적으로 해석한다. 반면 current `main:lib/domain/inventory-source-registry.ts`는 아직 RP012 channels를 `LOW_SONOKONG · LOW_TCAR` 둘만 선언하고 obsolete third-bucket HOLD를 유지하며, current main에는 `direct-source-status.ts` 자체가 없다.

Current-main Source Contract는 production pin SHA를 `c3838708...`로 허용했지만 collector가 `cf940df6`와 같다는 인접 주석은 stale하다. 실제 pinned engine은 `scripts/ingest-supplier-to-firestore.mts` status semantics를 변경한다. RP012 channels/hold/status parity를 fail-closed로 검사하지 않으므로 PR #451의 `source-contract`/`verify` green을 runtime/main semantic parity 증거로 쓰지 않는다.

Writer topology에도 새 항목이 생겼다. `register_sonogong_current`는 `workflow_dispatch && apply && register_sonogong_current`일 때만 RP012 direct ingest `--apply`를 실행하는 **default-off manual registration mode**다. source authority는 같은 Sonogong ERP API로 유지되므로 제2 원천으로 승격하지 말되, production writer topology에는 명시해야 한다. 첫 post-pin manual run `35564286647`에서는 이 step이 skipped였으므로 실행 사실로 과장하지 않는다.

F86 fixed tabs `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`, F01 `상품리스트 · 오공구독 · 픽업구독 · 오플구독`, RP023 RebornCar, retired mirror/sales automatic writer, RTDB/mirror non-canonical boundary는 유지한다.

**Claude implementation owner:** production `c3838708...`을 stale main에 맞춰 되돌리지 말고 current-main RP012 registry/runtime helpers와 Source Contract를 실제 production semantics에 맞춰 정렬한다. 3-channel/hold/status-listability parity를 검증하고 stale validated-engine 설명을 수정한다. `register_sonogong_current`의 default-off manual-writer 성격도 writer topology/guard에 반영한다. F01/F86 parity 및 special-tab/legacy-retirement 경계는 약화하지 않는다.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit91-sonogong-status-pin-manual-registration-writer.md`

---
# Claude 실행 오더 — Audit (90) override

최우선 최신 판정: **Audit (89)의 Atom↔F01↔F86 cross-audit red는 PR #448 / engine `99167ee27a825e7f8588e49c004297fb019da17f`에서 full-green run `35561514414`로 해소됐다. 그러나 PR #449가 production engine을 `2478900272eb742035db5c3743c45a3683161219`로 다시 전진시키면서 current-main canonical registry와 runtime engine 사이에 새 Sonogong channel/hold version skew가 생겼다.**

Production `247890...`은 RP012 `sokrc.com/api`에서 `LOW_SONOKONG_DAILY · LOW_SONOKONG · LOW_TCAR` 세 request bucket을 읽고 각각 `중고렌트 · 오공구독 · 픽업구독`으로 구분한다. 반면 current `main:lib/domain/inventory-source-registry.ts`는 아직 `LOW_SONOKONG · LOW_TCAR` 둘만 선언하고 `일반 렌트재고 ERP API 버킷은 아직 코드에서 확인되지 않음` HOLD를 유지한다. **source URL authority는 바뀐 것이 아니며, runtime/main canonical-registry version skew가 문제다.**

Current-main Source Contract도 이 차이를 못 잡는다. RP012 kind/adapter/source URL만 검사하고 channel/hold parity를 잠그지 않으며, `247890...` validated-engine 주석은 collector가 이전 lineage와 같다고 쓰지만 실제 commit은 `scripts/ingest-supplier-to-firestore.mts`와 Sonogong helpers를 변경한다. 그래서 Source Contract `35562386495`와 generic CI `35562386522`가 green이어도 이 semantic skew는 OPEN이다.

Scheduler/recovery는 별도 트랙이다. 12:05 recovery ERP5 `35562037889`은 실제 cancelled, 13:05 `35562059650`은 F01/F86/cross-audit/photo까지 full green success라 persisted monitor pending 상태가 stale하다. Native ERP5 schedule `35562733391`도 13:56:57 KST에 재출현해 14:06:54 KST **success**로 완료됐고 새 pin `247890...`의 native production chain 성공까지 확인됐다. 다만 settlement native cadence와 전체 timeliness HOLD는 여전히 OPEN이다.

F86 fixed tabs는 `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`, F01은 `상품리스트 · 오공구독 · 픽업구독 · 오플구독` 그대로다. RP023 RebornCar, retired mirror/sales automatic writer, RTDB/mirror non-canonical boundary도 유지한다.

**Claude implementation owner:** production `247890...`의 third-bucket semantics를 stale main에 맞춰 되돌리지 말고 current-main registry와 Source Contract를 실제 runtime 의미와 정렬한다. RP012 channels/hold와 pinned-engine collector semantics를 fail-closed로 검사하고 stale validated-engine 설명을 바로잡는다. Scheduler/cancellation 문제는 별도로 처리하며 F01/F86 parity gate를 약화하거나 F01 명칭을 임의 변경하지 않는다.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit90-sonogong-full-bucket-runtime-main-registry-drift.md`

---
# Claude 실행 오더 — Audit (89) override

최우선 최신 판정: **Audit (88)의 scheduler/recovery HOLD는 유지되지만 Core SSOT 요약 중 production pin/F86 special-tab 부분은 stale이다. PR #447 / merge `6691b0f27c3df91ab07f3e0078903c69a1471f5e`가 ERP5 production engine을 `0c31f98d412d9e006e1894804ebe767fc91683f1`로 repin했고, F86 low-credit projection contract가 실제로 바뀌었다.**

Current F86 첫 네 고정 탭은 정확히 `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`이다. RP012 non-pickup 재고(중고렌트 + 오공구독)는 `손오공상품`, T카 pickup external stock은 `픽업구독`, RP023은 `오플구독`으로 간다. Special-tab 차량은 일반 공급사 탭에 중복하지 않으며 fixed 탭명에는 시간/대수 suffix가 없다. F86 freshness는 Drive `modifiedTime`을 사용한다.

**F01은 의도적으로 그대로다.** F01 `TAB_ORDER`는 `상품리스트 · 오공구독 · 픽업구독 · 오플구독`; F01/F86은 동일 Atom/fixed snapshot 및 공통 row/cell builder를 쓰며 F86 `손오공상품`은 F01 `오공구독` column block을 재사용한다. 이 audit만으로 F01을 `손오공상품`으로 rename하지 않는다.

Main push `SSOT Source Contract` run `35560310869`과 generic `CI` run `35560310925`은 green이다. 그러나 새 pin 검증 run **`35560321553`은 post-publish failure**다. Source→Atom→fixed snapshot→public catalog→F01 publish→F86 backup/publish→F86↔Atom freshness/cell first gate까지 성공한 뒤 **Atom↔F01↔F86 cell-level cross-audit에서 실패**했다. Photo audit와 evidence preservation은 성공했다. 즉 output publication은 됐지만 repin을 full-green으로 보지 않는다. `erp5-ssot-snapshot-35560321553` evidence를 사용해 mismatch를 원인 규명하고 audit gate는 약화하지 않는다.

Canonical source authority는 변경 없다: 24-source registry, RP012 `sokrc.com/api`, RP023 RebornCar. Retired mirror/sales automatic writer와 RTDB non-canonical/runtime-retirement boundary도 유지한다.

**Audit (88) native cadence + recovery continuity HOLD 및 monitor reconciliation WATCH는 계속 OPEN**이다. Projection repin/cross-audit 문제와 scheduler delivery 문제를 분리한다.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit89-f86-production-repin-cross-audit-red.md`

---
# Claude 실행 오더 — Audit (88) override

최우선 최신 판정: **Audit (87)의 10:05/11:05 watchdog recovery 연속 동작 뒤, 다음 12:05 settlement logical slot은 configured 20-minute grace를 넘긴 12:53 KST까지 native `schedule`도 heartbeat `push` recovery도 없었다. 따라서 native cadence HOLD에 더해 recovery continuity도 다시 HOLD다. ERP5 canonical authority/core business semantics는 그대로다.**

근거: `.github/workflows/settlement-intake-sync.yml`은 09:05–18:05 KST Mon–Sat hourly schedule을 선언하고, `.automation/safe-chain-monitor.json`은 `missingScheduleGraceMinutes=20`을 선언한다. 11:45–12:53 KST Actions 조회에서 `event=schedule`은 0건이며, 같은 구간 push run에 `1205` recovery가 없다. Heartbeat는 11:05에 머물고 persistent monitor도 12:21 KST 체크에서 11:05까지만 처리했다.

Monitor reconciliation은 일부 진전됐다. 10:05는 `erp5-audit-failure`/F86 tab-order failure로 교정됐지만, 11:05 ERP5 `35556051763`은 Audit (87)에서 full-green success가 확인됐음에도 persistent monitor에는 여전히 `erp5-in-progress`/audits pending이고 `lastKnownGoodErp5RunId`도 09:05에 머문다. **Audit gate를 약화시키지 말고 completed Actions conclusion과 persisted monitor truth를 정합화한다.**

12:05 miss는 permanent GitHub scheduler outage나 ERP5/F01/F86 data corruption의 증거로 확대하지 않는다. Claude는 native schedule delivery, watchdog grace/recovery continuity, monitor reconciliation을 분리해 원인을 잡는다.

Core SSOT는 변경하지 않는다: ERP5 canonical ownership, 24-source registry, same fixed-snapshot F01/F86, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, existing F86 special-tab policy, retired mirror/sales automatic writers, RTDB/mirror non-canonical boundary 유지.

계속 OPEN: Audit (84) FreePass Data SHADOW latency/non-interference, Audit (83) Production Deploy Recovery credentials, Audit (67) quote-default freshness, Audit (71) ERP5 concurrency/pending-replacement + 15:05 reconciliation, Audit (76) successful-native false replay, native cadence/timeliness HOLD. **Audit (88)에서 recovery continuity HOLD가 추가됐다.**

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit88-1205-native-and-recovery-gap.md`

---
# Claude 실행 오더 — Audit (87) override

최우선 최신 판정: **Audit (86)의 “10:05가 fallback 없이 남고 safe-chain cursor가 09:05에 고정” 증상은 해소됐다. Watchdog가 10:05와 11:05를 연속 복구했다. 다만 10:05 downstream ERP5는 F01/F86 publish 이후 parity/freshness audit에서 red였고, 11:05 downstream ERP5는 같은 canonical pipeline 전체가 full green이다. Persistent monitor는 이 두 완료 결과를 아직 in-progress/pending으로 들고 있어 reconciliation drift가 남는다. Native cadence HOLD도 그대로다.**

10:05 recovery commit `2040362546ffc2c6c7bd8cda723034a0d089cefd` → settlement `35555972014` push/success → ERP5 `35556005697` workflow_run/failure. 해당 ERP5는 source/Atom/snapshot/public/F01/F86 write까지 success 후 F86↔Atom 및 Atom↔F01↔F86 validation이 failed였고 photo audit은 success였다. **정확한 mismatch/root cause log 없이 data corruption으로 확대하지 않는다.**

11:05 recovery commit `6eaa2db5e42d3328a1e122be0cebbf91a021c478` → settlement `35555988134` push/success → ERP5 `35556051763` workflow_run/completed/success. Source→Atom→snapshot→public/F01/F86→F86 freshness/cell audit→cross-audit→photo audit까지 모두 green이므로 **latest recovery data-plane은 full green**이다.

하지만 current `.automation/safe-chain-monitor.json`은 10:05 ERP5를 `erp5-in-progress`, 11:05 ERP5를 `erp5-pending`으로 저장한 채 audits pending을 유지한다. Cursor 전진과 completed-run reconciliation을 분리해서 본다. Claude는 monitor가 실제 Actions conclusion(failure/success)을 반영하도록 책임을 정리하고, 10:05 post-publish audit red의 실제 로그 원인을 확인하되 parity/audit gate를 약화시키지 않는다.

Native schedule은 별도 HOLD다. Newest native `event=schedule` evidence는 여전히 ERP5 `35447185563`(2026-09-19 22:55:32 KST / success)이며 10:05·11:05는 recovery push/workflow_run이다.

Core SSOT는 변경하지 않는다: production pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source registry, same fixed-snapshot F01/F86, 손오공·오토플러스 special-tab rules, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired mirror/sales automatic writers, RTDB/mirror non-canonical boundary 유지.

계속 OPEN: Audit (84) FreePass Data SHADOW latency/non-interference, Audit (83) Production Deploy Recovery credentials, Audit (67) quote-default freshness, Audit (71) ERP5 concurrency/pending-replacement + 15:05 reconciliation, Audit (76) successful-native false replay, native cadence/timeliness HOLD.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit87-1005-postpublish-audit-red-1105-green.md`

---
# Claude 실행 오더 — Audit (86) override

최우선 최신 판정: **Audit (85)의 09:05 recovery chain full-green은 유효하지만, 다음 10:05 settlement logical slot이 20분 grace 이후에도 native schedule이나 heartbeat fallback으로 복구되지 않았고 safe-chain persistent state도 09:05에서 멈춰 있다. 따라서 native cadence뿐 아니라 fallback continuity도 HOLD다. ERP5 canonical authority/core business semantics는 그대로다.**

Pre-audit main은 `8c1a6affd96d798c794b3914e07acdaaacb4072f`. `settlement-intake-sync.yml`은 KST 09:05~18:05 hourly cron과 heartbeat fallback을 선언하고 monitor policy는 20분 grace다. 2026-09-21 11:21 KST 기준 newest native `event=schedule`은 여전히 ERP5 `35447185563`(2026-09-19 22:55:32 KST). 10:05 slot은 11:21까지 recovery run 없이 남았다.

또한 `.automation/heartbeats/settlement-intake-sync.txt`와 `.automation/safe-chain-monitor.json`은 계속 09:05에 머문다. Monitor는 실제 10:32:58 KST full-success한 ERP5 `35550547914`을 아직 `erp5-in-progress`/audits pending으로 기록하고 `lastKnownGoodErp5RunId`도 `35439046831`로 남겨 live Actions와 불일치한다.

구현 Owner인 Claude는 ① 10:05 missed slot이 grace 뒤에도 fallback으로 이어지지 않은 실행 주체/check cadence를 확인하고, ② completed ERP5 run을 monitor state가 reconcile하고 다음 slot으로 전진하는 책임을 명확히 하고, ③ 실제 후속 missing-slot recovery + state reconciliation 증거 전까지 fallback continuity를 GO로 닫지 않는다. Audit (85)의 09:05 data-plane PASS는 뒤집지 않는다.

Core SSOT는 변경하지 않는다: production pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source registry, same fixed-snapshot F01/F86, 손오공·오토플러스 special-tab rules, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired mirror/sales writers, RTDB/mirror non-canonical boundary 유지.

기존 OPEN 유지: Audit (84) FreePass Data SHADOW latency/non-interference, Audit (83) Production Deploy Recovery credentials, Audit (67) quote-default freshness, Audit (71) ERP5 concurrency/pending-replacement + 15:05 reconciliation, Audit (76) successful-native false replay.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit86-1005-recovery-gap-stale-monitor-state.md`

---
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