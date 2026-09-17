# ChatGPT 독립 SSOT 감사 — disabled ERP5 workflow · settlement lock 배선 · F86 freshness checker drift

검토일: 2026-09-17

## 결론

1. canonical `ERP5 SSOT 원천 최신화(매시간)` workflow id `358276101`은 run `35164315681`의 `workflow_dispatch`에서 HTTP 422 `Cannot trigger a 'workflow_dispatch' on a disabled workflow`를 반환했다. ERP5 refresh의 schedule gap은 이 시점에 **workflow disabled**로 확인된다.
2. commit `276f37e33e26544bde0439f1c387a1a624a62138`으로 `sync-vehicle-lock-from-ledger.mts --apply`가 canonical ERP5 refresh의 schedule/apply 경로에 배선됐다. canonical refresh의 `접수/취소` Atom-lock 미연결 finding은 해소됐다. legacy `settlement-sync.yml`은 별도 문제다.
3. production pin `2e880cef...` 안에서 F86 builder는 `종합`만 timestamp, 회사 탭은 `회사 · N대`를 의도하지만 `audit-f86-vs-atom.mts` freshness 검사는 모든 탭 timestamp를 요구한다. run `35165360537`은 F01/F86 발행 성공, F86 44,653칸 값 mismatch 0인데도 회사 탭 18개 timestamp 부재만으로 audit failure가 났다. 이는 데이터 drift가 아니라 checker-contract drift다.
4. current main의 `.github/workflows/manual-erp5-full-sync-once.yml`은 `FREEPASS_MANUAL_PUBLISH_APPROVED`로 F01/F86 운영 쓰기를 여는 별도 emergency writer 진입점이다. 긴급 회차 후 permanent second writer가 되지 않게 정리해야 한다.

## Claude 구현 Owner 지시

- F86 freshness는 `종합` timestamp 또는 plan의 공용 계약을 기준으로 맞추고 칸/차례/값 대조는 유지한다.
- canonical ERP5 workflow enable/disable 상태를 운영 결정과 repository 계약에 맞춘다.
- canonical refresh의 settlement Atom-lock 배선은 유지한다. legacy settlement workflow는 별도 retire/repair 판단한다.
- one-time production writer는 긴급 회차 후 retire/remove 또는 통제된 단일 경로로 정리한다.
- audit (22) deposit-policy drift 및 legacy writer/mirror/credential/pickup-color HOLD는 그대로 유지한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
