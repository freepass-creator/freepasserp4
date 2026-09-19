# ChatGPT → Claude SSOT 감사 진입점 — audit (64) override

> application/business logic 구현 Owner는 계속 Claude 단일 SSOT 세션이다. 이번 ChatGPT 감사는 repository/runtime 증거를 독립 대조하고 감사 문서만 갱신했다.

## 1) 현재 운영 판정 — recovery chain runtime PASS / native schedule WATCH / governance drift

Audit (63)에서 `in progress`였던 settlement recovery → canonical ERP5 chain이 끝까지 **success**로 완료됐다. 따라서 heartbeat recovery plane의 실제 production execution은 증명됐다. 다만 native GitHub `event=schedule` delivery는 아직 새 증거가 없고, 새 heartbeat/workflow-run trigger topology를 예약지도와 CI guard가 아직 완전히 표현하지 못한다.

## 2) production trigger topology

### A. settlement intake
- workflow: `.github/workflows/settlement-intake-sync.yml`
- native cron: KST 월~토 09:05~18:05
- canonical 역할: 계약접수 → 정산원장 `접수` + ledger 서식/용어 정리
- legacy `sync-contract-from-ledger.mts`는 호출하지 않음
- recovery trigger: main의 `.automation/heartbeats/settlement-intake-sync.txt` 전용 `push`
- 이 heartbeat `push`도 production `--apply` 경로를 탄다.

첫 recovery run `35412968175`는 `프리패스 당월 계약접수` 시트 부재로 실패했다. commit `15e56c262ac5c95d8dde4edc6dd3c82c5e8733d7` 이후 missing intake sheet만 1회 canonical 생성 후 retry하도록 auto-heal됐고, retry run **`35413059063`은 push event로 success**했다.

### B. canonical ERP5
- workflow: `.github/workflows/erp5-ssot-refresh.yml`
- native cron: KST 월~토 09:17~19:17
- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- settlement success 뒤 `workflow_run` chain
- ERP5 direct heartbeat fallback: `.automation/heartbeats/erp5-ssot-refresh.txt` 전용 main `push`
- native schedule / settlement-chain `workflow_run` / heartbeat `push` / approved manual apply가 모두 canonical production path를 탈 수 있음

settlement recovery `35413059063` 뒤 chained ERP5 run **`35413099804`**가 실제 생성됐고 최종 **completed / success**다.

성공 단계:
- checkout / OIDC / source contract / credentials
- canonical source collection / paid-option audit
- settlement ledger contract lock
- ERP5 current Atom calculation / policy reconciliation
- fixed snapshot / public catalog reconciliation
- F01 publish
- F86 backup + publish
- F86↔Atom freshness/value audit
- Atom↔F01↔F86 cross-audit
- vehicle-number/photo-link audit
- run evidence preservation

따라서 audit (63)의 `ERP5 chain in progress / full green 미확정`은 **RESOLVED**다.

## 3) native schedule WATCH는 그대로

repository-wide `event=schedule` 최신 run은 여전히:

- `35347508078`
- ERP5 canonical
- 2026-09-18 21:58:18 KST
- success

이다. 2026-09-19 native `schedule` event는 아직 새로 관측되지 않았다.

따라서 heartbeat `push` recovery나 `workflow_run` chain을 **native cron delivery 복구 증거로 바꾸지 않는다.** native schedule 판정은 계속 `delayed-or-missing / WATCH`다.

## 4) governance drift — 예약지도/check:schedules가 non-cron production trigger를 못 봄

current `docs/예약작업-지도.md`는 자동 흐름을 사실상 cron 중심으로 설명한다.

```text
09:05 settlement-intake-sync
  intake → ledger 접수
       ↓
09:17 erp5-ssot-refresh
  ledger lock → Atom → snapshot → F01/F86 → audits
```

하지만 실제 current topology에는 다음도 있다.

```text
external watchdog
  → heartbeat file push
  → settlement production apply
  → workflow_run
  → ERP5 canonical production

ERP5 heartbeat file push
  → ERP5 canonical production fallback
```

`scripts/check-schedule-map.mts`는 cron map, retired schedule 재생성, legacy settlement writer 재연결은 검사하지만 `push.paths` heartbeat trigger와 `workflow_run` production trigger를 검증하지 않는다. 따라서 CI green만으로 실제 production trigger plane과 운영지도의 정합성을 보장할 수 없다.

**Claude가 판단할 것:** 이 recovery plane을 승인된 production architecture로 둘지 결정한다. 승인하면 예약지도와 CI guard가 heartbeat path/workflow_run까지 fail-closed로 검증하게 정합화한다. 승인하지 않으면 native `event=schedule` 연속 green을 먼저 증명한 뒤 fallback을 retire한다. auditor가 application/workflow logic을 대신 수정하지 않는다.

## 5) RESOLVED 유지 — legacy automatic writers

PR #418 merge `27adad84d0fd1d980e51eb00394de11afa48dbed` 기준:
- `contract-status.yml`: schedule/apply 제거, manual dry-run only
- `sales-erp-hourly.yml`: schedule/push/apply 제거, manual dry-run only
- `mirror-sync.yml`: schedule/apply 제거, manual dry-run only
- legacy settlement writer 자동 연결 제거

PR #419 merge `8583e640a30b058e152443fdf1bfce24f873b0aa` 기준 옛 `settlement-sync.yml`은 삭제되고 새 `settlement-intake-sync.yml` identity가 사용된다.

이 retirement를 heartbeat recovery topology와 혼동해 되돌리지 않는다.

## 6) canonical / projection 경계 유지

이번 automation delta에서 신규 회귀 없음:
- production pin `cf940df642edf315adbc6da2b4134fbad53da160`
- 24-source canonical registry
- RP006 = Iron website
- RP012 = Sonogong ERP/API
- RP023 = RebornCar
- F01/F86 fixed-snapshot projection
- F86 `종합`은 손오공/오토플러스 제외, 두 공급사는 자기 탭/고유 요금축 유지
- RTDB/mirror는 canonical inventory source/writer 권한 없음

## 7) 기존 HOLD 유지

- #415 `mark-contract-in-listings.mts` legacy marker `정산원장` code cleanup
- RP023 canonical RebornCar vs legacy mirror old Sheet code debt
- RP031 API/DOM feeder provenance/canonical migration
- main `deposit-policy.ts` vs production special-tab deposit rule single-definition
- Sonogong/AutoPlus deposit lineage
- vehicle-price source→Atom lineage
- sales-tab naming migration
- newest-Atom freshness semantics
- `/inventory` ERP4 read/write boundary

## 8) 다음 Claude 우선순위

1. `35413099804`는 **full green**으로 닫는다.
2. heartbeat + `workflow_run` recovery plane의 승인 여부 결정
3. 승인 시 `docs/예약작업-지도.md` + CI trigger-topology guard 정합화
4. native `event=schedule`이 실제 연속 green으로 재출현하는지 별도 관측; recovery push로 대체하지 않음
5. 그 뒤 기존 #415/RP023/RP031/deposit/price/tab/freshness debt 순차 처리

## 기준

- central audit: `docs/AI-SSOT-AUDIT-LOG.md` → audit (64) append pending/this audit cycle
- 상세: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit64-chained-erp5-full-green-native-schedule-watch.md`
- audit64 detail commit: `b5584dd029386981d0287a8715b176223f004037`
- settlement recovered run: `35413059063`
- chained ERP5 full-green run: `35413099804`
- last native scheduled green: `35347508078`
- canonical production pin: `cf940df642edf315adbc6da2b4134fbad53da160`

**현재 상태: settlement heartbeat recovery/bootstrap PASS. chained ERP5 full runtime PASS. native schedule은 WATCH. 새 non-cron production trigger plane을 예약지도/CI가 아직 못 잡는 governance drift가 남아 있다.**
