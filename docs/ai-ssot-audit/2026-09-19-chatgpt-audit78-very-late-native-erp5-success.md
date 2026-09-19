# ChatGPT 독립 SSOT 감사 — Audit 78

## 판정

**PARTIAL RESOLVED / native delivery resumed very late; cadence·timeliness HOLD 유지.**

## 새 runtime 증거

Audit 77은 2026-09-19 22:24 KST 기준 repository-wide newest native `event=schedule`이 ERP5 run `35434923578`(18:31:19 KST, success)이고, 당일 마지막 direct ERP5 cron 19:17 KST 이후 native event가 3시간 7분 이상 관측되지 않았다고 기록했다.

그 뒤 새 native run이 실제로 생성됐다.

- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- run: `35447185563`
- event: `schedule`
- created / started: **2026-09-19 22:55:32 KST**
- completed: **2026-09-19 23:05:39 KST**
- conclusion: **success**
- head SHA: `e1f196ff93e4ecc2c570b58fa6296c2346062455`
- production checkout pin: `cf940df642edf315adbc6da2b4134fbad53da160`

현재 direct cron의 당일 마지막 선언 slot은 19:17 KST다. 이 native event는 그 시각보다 **3시간 38분 32초 뒤** 생성됐다. GitHub Actions run metadata는 이 실행이 원래 어느 nominal cron slot에 대응하는지 별도 slot identity를 노출하지 않으므로, 이를 확정적으로 “19:17 run”이라고 부르지는 않는다. 다만 Audit 77 이후 첫 post-audit native direct ERP5 schedule이며, 당일 final window dispatch가 극단적으로 지연돼 들어온 것과 일치한다.

## full pipeline 결과

Run `35447185563`의 `refresh` job은 아래 핵심 production 단계가 모두 success였다.

- checkout / OIDC / node / npm ci
- SSOT source contract check
- source credentials 준비
- 현재 원천 재수집
- 티카 유료옵션 감사
- 정산원장 접수/취소 → ERP5 Atom lock 반영
- 24-source ingest
- 정책 참조 정합화
- fixed ERP5 sales snapshot 생성
- public catalog 대사
- 동일 snapshot F01 publish
- F86 backup
- 동일 snapshot F86 publish
- F86↔Atom freshness / cell parity
- Atom↔F01↔F86 cross-audit
- 차량번호·사진 링크 audit
- snapshot artifact 보존

따라서 Audit 77의 “18:31 이후 native schedule event가 아직 없다”는 **runtime snapshot은 stale**이다. Native direct delivery 자체는 다시 관측됐고 이번 회차는 end-to-end green이다.

## 닫지 않는 항목

이 1회의 매우 늦은 success를 cadence 정상화로 보지 않는다.

1. **native cadence / timeliness HOLD 유지** — run은 declared schedule window 밖인 22:55 KST에 도착했다. 연속적이고 예측 가능한 native `event=schedule` delivery 증거가 아직 없다.
2. **Audit 71 OPEN 유지** — burst/backfill pending ERP5 cancellation hazard와 15:05 ERP5 `35427915834` cancelled-before-job reconciliation은 별도 해소 증거가 없다.
3. **Audit 76 OPEN 유지** — 이미 성공한 native 18:05 settlement slot을 fallback이 재실행한 recovery reconciliation drift는 이번 run으로 해소되지 않는다.
4. **Audit 67 OPEN 유지** — `standard-quote-defaults.snapshot.json` source-trigger/freshness gap은 별도 항목이다.

## code / SSOT boundary 재확인

Audit 77 이후 `origin/main`에는 application/business-logic commit이 추가되지 않았다. 이번 scheduled run head도 Audit 77 문서 commit `e1f196ff93e4ecc2c570b58fa6296c2346062455`다.

재확인한 core boundary:

- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- ERP5 canonical source registry: 24 providers
- F01/F86: same fixed snapshot
- F86 summary: `종합`은 손오공·오토플러스 제외, 각 special company tab 유지
- Sonogong: `오공구독` / `픽업구독`
- AutoPlus: `오플구독`
- `contract-status.yml`, `sales-erp-hourly.yml`, `mirror-sync.yml`: scheduled automatic writer retired; manual dry-run only
- `MIRROR_SOURCES` / RTDB legacy paths: non-canonical inventory authority

이 범위에서 새 regression/drift는 확인되지 않았다.

## Claude implementation owner handoff

이번 finding은 **native delivery resumption**으로만 반영하고 **cadence recovery**로 닫지 않는다. Fallback/`workflow_run` coverage와 direct native `event=schedule` proof를 계속 분리한다. Audit 71/76의 queue/recovery reconciliation과 Audit 67의 quote-default freshness gap도 직접 해소 evidence 없이 닫지 않는다.

이번 독립 감사에서는 application code나 business logic을 수정하지 않았다.
