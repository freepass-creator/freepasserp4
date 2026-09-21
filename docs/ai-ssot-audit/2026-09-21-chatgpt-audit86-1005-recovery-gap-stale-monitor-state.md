# ChatGPT Audit 86 — 2026-09-21 10:05 recovery gap + stale safe-chain monitor state

## 판정

**MATERIAL REGRESSION / recovery-plane continuity HOLD / monitor-state reconciliation drift. ERP5 canonical data authority and business semantics are unchanged.**

## 확인 사실

- 감사 시작 시 `origin/main`은 `8c1a6affd96d798c794b3914e07acdaaacb4072f` (`docs(audit): record audit 85 native recovery`)였다.
- `settlement-intake-sync.yml`은 계속 월~토 KST 09:05~18:05 매시 native cron(`5 0-9 * * 1-6`)과 missing-schedule heartbeat `push` fallback을 선언한다. `.automation/safe-chain-monitor.json`의 정책은 missing schedule grace를 20분으로 둔다.
- Audit (85)는 09:05 slot을 recovery commit `95a1f5084ec0ce60e7d165bdf5b75220b1afa3f7`로 복구했고 settlement run `35550513984`과 downstream ERP5 `35550547914`이 full green으로 끝났음을 확인했다.
- 그러나 2026-09-21 11:21 KST 재확인 시 repository-wide newest native `event=schedule`은 여전히 ERP5 `35447185563`(2026-09-19 22:55:32 KST created / success)였다. 2026-09-21의 native schedule event는 새로 나타나지 않았다.
- 더 중요한 신규 delta는 **다음 settlement logical slot인 10:05 KST가 20분 grace를 훨씬 넘긴 11:21 KST까지 fallback으로도 복구되지 않았다는 것**이다. Fresh recent Actions에서 마지막 push-triggered workflow activity는 Audit 85 recorder 계열 10:40 KST였고, 10:05 settlement recovery run/heartbeat advancement는 관측되지 않았다.
- 현재 `.automation/heartbeats/settlement-intake-sync.txt`도 여전히 `slot=2026-09-21T09:05:00+09:00`이다. 즉 fallback heartbeat가 10:05로 전진하지 않았다.
- `.automation/safe-chain-monitor.json`도 `lastCheckedAt=2026-09-21T10:23:03+09:00`, `lastCheckedThroughSlot=09:05`, `lastHeartbeatSlot=09:05`에서 멈춰 있다. 더구나 09:05 recovery의 ERP5 run `35550547914`을 아직 `erp5-in-progress`, `erp5ProductionWritesCompleted=false`, F86/parity/photo audits `pending`으로 기록하고 `lastKnownGoodErp5RunId`도 옛 `35439046831`에 머문다. 이는 실제 Actions/Audit (85)에서 `35550547914`이 10:32:58 KST full success로 확인된 사실과 불일치한다.

## 해석

Audit (85)의 **09:05 한 회차 recovery/data-plane PASS 자체는 유효**하다. 그러나 그 결과를 recovery plane의 지속 동작성 증거로 일반화할 수 없게 됐다. 다음 10:05 missed slot이 선언된 20분 grace 후에도 복구되지 않았고 persistent monitor state가 이전 성공도 reconcile하지 못했기 때문이다.

이 finding은 scheduler 또는 watchdog가 영구적으로 disabled됐다고 단정하지 않는다. 또한 09:05 recovery 이후 canonical F01/F86 데이터가 손상됐다는 증거도 아니다. 정확한 판정은 **native cadence HOLD + fallback continuity HOLD + monitor-state stale**다.

## Core SSOT cross-check

이번 delta에서 core SSOT contract 회귀는 확인하지 않았다.

- ERP5 production engine pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- canonical inventory source registry: 24 providers 유지; RP006=Iron website, RP012=Sonogong API, RP023=RebornCar, RP031=current Google Sheet
- F01/F86: 동일 fixed snapshot 기반 projection 유지
- F86 `종합`: 손오공·오토플러스 제외 + dedicated supplier tabs 유지
- Sonogong product types: `오공구독` / `픽업구독`; AutoPlus: `오플구독`
- `mirror-sync.yml` / `sales-erp-hourly.yml`: automatic schedule 없이 manual dry-run only 상태 유지
- RTDB/mirror legacy paths: canonical inventory authority로 복귀한 증거 없음

Audit (84)의 FreePass Data SHADOW latency/non-interference HOLD, Audit (83)의 Production Deploy Recovery credential-path OPEN, Audit (67) quote-default freshness, Audit (71) shared ERP5 concurrency/pending-replacement + 15:05 reconciliation, Audit (76) already-successful native slot false replay도 직접 해소 증거가 없어 유지한다.

## Claude 구현 Owner 인계

1. Audit (85)의 09:05 recovery success는 보존하되 recovery plane 전체를 GO로 간주하지 않는다.
2. 10:05 missed settlement slot이 왜 grace 뒤에도 heartbeat recovery로 이어지지 않았는지 watchdog/check cadence와 실행 주체를 확인한다.
3. `.automation/safe-chain-monitor.json`이 completed ERP5 `35550547914`을 reconcile하고 다음 slot으로 전진할 수 있도록 상태 갱신 책임을 명확히 한다.
4. 실제 후속 missed slot recovery와 monitor-state reconciliation 증거가 생기기 전 native cadence와 fallback continuity 모두 HOLD한다.
5. 이 운영 finding 때문에 production pin/source registry/F01-F86/special-tab/legacy-retirement business semantics를 변경하지 않는다.

이번 독립 감사에서는 application code나 business logic을 수정하지 않았다.
