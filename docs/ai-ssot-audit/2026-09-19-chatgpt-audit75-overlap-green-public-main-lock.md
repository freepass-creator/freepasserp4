# ChatGPT independent SSOT audit (75) — 2026-09-19 KST

## Verdict

**PARTIAL RESOLVED / IMPLEMENTATION CHANGE / STRUCTURAL HOLD.**

Audit (74)의 실제 overlap pair는 모두 정상 종료됐다. 그러나 audit (71)의 burst/backfill concurrency hazard와 native cadence/timeliness HOLD는 해소되지 않았다. 동시에 audit (74) 이후 ERP4 MAIN public browse의 canonical read boundary를 ERP5로 잠그는 implementation change가 main에 들어왔다.

## 1. Audit (74) live overlap pair — both green

Audit (74) 당시 settlement native success가 만든 ERP5 `workflow_run` **35434667030**은 `in_progress`, direct ERP5 native cron **35434923578**은 같은 `erp5-inventory-publish` concurrency group에서 `pending`이었다.

현재 두 run을 다시 확인한 결과:

- ERP5 `35434667030` (`event=workflow_run`) — **completed / success**
- ERP5 `35434923578` (`event=schedule`) — **completed / success**

따라서 이 특정 overlap에서는 direct native run이 running settlement-chain run 뒤에 직렬화된 뒤 실제로 실행되어 완료됐고, 신규 data corruption / duplicate-row / projection-drift 증거는 확인되지 않았다.

## 2. Audit (71) structural queue hazard — still OPEN

이 결과를 audit (71)의 구조적 finding 해소로 확대하지 않는다.

Current `.github/workflows/erp5-ssot-refresh.yml`은 여전히:

- `schedule`
- settlement `workflow_run`
- heartbeat `push`

세 production trigger를 같은 full `refresh` job으로 보내고,

- `concurrency.group: erp5-inventory-publish`
- `cancel-in-progress: false`

를 공유한다. 최근 성공한 settlement-chain과 direct cron을 event-level에서 dedupe/coalesce하는 gate는 없다.

따라서 running 1개 + pending 1개 상태에서 더 새로운 pending production trigger가 들어오는 burst/backfill 상황에는 audit (71)에서 실제 관측된 pending replacement/cancellation 위험이 그대로 남아 있다. **15:05 ERP5 `35427915834` cancelled-before-job failure도 아직 해당 slot 기준 reconciliation evidence가 없다.**

Audit (75)는 audit (74)의 특정 두 run이 둘 다 green이었다는 runtime 상태만 닫는다. Queue safety contract 자체는 OPEN이다.

## 3. Native cadence/timeliness — HOLD 유지

- 18:05 settlement native schedule은 약 20분 늦게 도착했다.
- 18:17 direct ERP5 native schedule은 약 14분 늦게 도착했다.
- 이번 audit snapshot에서 repository-wide newest native `event=schedule`은 `35434923578`이다.

19:17 ERP5 slot은 audit 시점에 충분한 delay envelope를 넘지 않았으므로 `missing`으로 단정하지 않는다. Native delivery가 다시 보인 것은 긍정적이지만, 연속 cadence와 punctuality normalisation은 아직 증명되지 않았다.

## 4. Audit (74) 이후 main implementation change — ERP4 MAIN public reader is CI-locked to ERP5 canonical catalog

Audit (74) recorder commit `7e62ee167aa5e1f3e47406d61b6cbef87bc07dff` 이후 current main `2d9fd07075aae7d6d64687fabbf61126e166c34c`은 **2 commits ahead**다.

### `d041da248fa131e62043ed3c66bbace98cda4e44`

ERP4 MAIN을 public Product Browse로 고정하고 안정화 규격을 CI gate로 잠갔다.

특히 `scripts/check-erp4-main-lock.mts`가:

- public guest listing이 `readWhitelabelCatalogFromErp5`를 사용해야 한다고 강제하고,
- legacy ERP4 `getStore` / RTDB fallback을 금지하며,
- public surface의 auth/session 분리와 guest projection 경계를 검사한다.

따라서 audit (55)/(56)에서 main에 병합된 ERP5 canonical downstream read 전환이 이제 ERP4 MAIN stability lock의 required regression guard로 한 단계 더 고정됐다.

### `2d9fd07075aae7d6d64687fabbf61126e166c34c`

기간·월대여료·보증금 조건과 facet/정렬/카드 대표가격을 **동일 price row**에서 판정하도록 통일했다. 이는 public projection/filter consistency hardening이며 inventory source/writer authority 변경은 아니다.

Current head verify run **35437192663**은 success다.

## 5. Unchanged authoritative SSOT boundaries

이번 delta에서 다음 core contract의 신규 drift는 확인되지 않았다.

- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- 24-source ERP5 canonical registry
  - RP006 = Iron website
  - RP012 = Sonogong ERP/API
  - RP023 = RebornCar
  - RP031 = current Google Sheet canonical source
- F01/F86 = same fixed ERP5 snapshot projection
- Sonogong special tabs = `오공구독` / `픽업구독`
- AutoPlus special tab = `오플구독`
- supplier-specific period/mileage/rate semantics preserved
- retired `contract-status` / `sales-erp-hourly` / `mirror-sync` automatic writer schedules
- RTDB / mirror paths are non-canonical inventory authority

Audit (67)의 `standard-quote-defaults.snapshot.json` source-trigger/freshness gap도 그대로 OPEN이다. Current exporter workflow는 actual source `lib/domain/estimate/cost-settings.ts`와 `scripts/export-standard-quote-defaults.mts`를 `push.paths`로 감시하지 않고 cron도 없다.

## Claude implementation owner handoff

1. Audit (74)의 **specific pair**는 both-green으로 닫되 audit (71)의 third-trigger/burst queue hazard를 닫지 않는다.
2. Settlement-chain / direct schedule / heartbeat production trigger 간 explicit dedupe, coalescing 또는 lossless serial queue contract를 정한다. 15:05 cancelled slot은 별도 reconciliation evidence가 생길 때까지 OPEN으로 둔다.
3. Native cadence/timeliness는 실제 연속 `event=schedule` success와 delay pattern으로만 해소한다.
4. ERP4 MAIN의 ERP5-only public read boundary와 `check:erp4-main` regression lock을 유지한다.
5. Canonical source, fixed-snapshot F01/F86, Sonogong/AutoPlus special-tab, retired legacy writer, RTDB/mirror boundary를 이번 queue/runtime 문제 때문에 변경하지 않는다.
6. Audit (67) quote-defaults projection freshness HOLD는 별도 항목으로 유지한다.

No application code or business logic was modified by the auditor.