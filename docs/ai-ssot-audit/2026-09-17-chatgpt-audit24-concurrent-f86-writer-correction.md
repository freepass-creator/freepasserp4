# ChatGPT 독립 SSOT 감사 — audit (24) 동시변경 정정 · F86 one-time writer 현재상태

검토일: 2026-09-17

## 왜 정정이 필요한가

audit (24)를 작성하는 동안 Claude 구현 세션이 같은 저장소의 `manual-erp5-full-sync-once.yml`을 연속 수정했다. 따라서 audit (24)에 적힌 **“one-time writer가 아직 옛 `2e880cef...`로 F01/F86을 쓸 수 있다”**는 관측은 작성 초기에 사실이었지만 중앙 로그가 append될 무렵 이미 구현이 바뀌어 stale해졌다. 과거 감사기록은 삭제하지 않고 새 항목으로 정정한다.

## 현재 확인된 구현

### 1. stale-engine/F01 writer 부분은 해소됨

commit `78df24bb8d24a9bb85755cdaa2bc3e52c4c40704`:

- workflow 이름을 `One-time F86 publish from validated ERP5 pin`으로 변경
- checkout ref를 `2e880cefa...` → **`6a6f3f75c065143ad14286d08baa28e382535eea`**로 전진
- source refresh / settlement lock / ERP5 ingest / policy reconcile / public publication verify / **F01 publish를 제거**
- current ERP5 snapshot을 캡처한 뒤 **F86만 backup/publish**
- production `6a6f3f75...`의 deposit-rule publication gate를 그대로 통과해야 쓰도록 변경

따라서 audit (24)의 핵심 표현 중 `옛 pin으로 동일 F01/F86을 덮는다`는 부분은 현재 더 이상 성립하지 않는다. 현재 이 경로는 **same-pin F86-only emergency writer**다.

commit `335d8e19a90ff30e93cb80f544cc8ea5c8fe6cde`:

- 공통 concurrency group `erp5-inventory-publish`
- `cancel-in-progress: true`

으로 바뀌어, workflow 파일을 다시 고쳐 새 validated F86 publish가 시작되면 앞선 in-progress run을 supersede하도록 정리됐다.

### 2. 새 gate는 실제 live Atom drift를 한 번 막았고, heal 후 gate는 통과함

run `35169013858` (`335d8e19...`)은 checkout/auth/npm/credential까지 성공했지만 **`Capture current ERP5 snapshot and enforce deposit-rule gate`에서 실패**했고 F86 backup/publish는 실행되지 않았다. 정확한 stderr는 현재 connector 범위에서 읽지 못하므로 실패 원인을 deposit violation으로 단정하지 않는다. 중요한 사실은 gate 이전 단계에서 F86 write가 일어나지 않았다는 것이다.

그 직후 commit `0c6ac135027298a9d79a4b7f673ddbd3762a828e`가 one-time workflow에 `heal-sonokong-deposit-ssot.mts --apply`를 snapshot gate 앞에 추가했다.

run `35169123131`에서는:

- `Heal Sonogong deposit atoms to SSOT rule` — success
- `Capture current ERP5 snapshot and enforce deposit-rule gate` — success
- `Backup F86 before publish` — success
- **`Publish F86 from validated snapshot` — failure**
- F86 audit — skipped

즉 현재 남은 운영 문제는 stale pin/F01 overwrite가 아니라 **validated `6a6f3f75...` snapshot까지 만든 뒤 실제 F86 publish 단계가 실패했다는 것**이다. 이 run에서는 backup은 성공했지만 publish 완료/감사 green 증거가 없다. publish failure의 구체 stderr가 확인되기 전에는 원인을 추정하지 않는다.

### 3. escape hatch 성격은 남음

current `.github/workflows/manual-erp5-full-sync-once.yml`은 여전히 write-capable이다.

- trigger는 `workflow_dispatch`/schedule이 아니라 **해당 workflow 파일 자체가 push로 바뀔 때만** 실행
- current ERP5 Atom을 읽고 F86만 씀
- `FREEPASS_MANUAL_PUBLISH_APPROVED` escape hatch 사용
- `audit-f86-vs-atom`은 `continue-on-error: true`

따라서 “stale engine” 위험은 해소됐지만, canonical `erp5-ssot-refresh.yml`이 disabled인 동안 이 파일이 운영용 대체 writer처럼 진화하지 않도록 one-time 목적을 명확히 유지해야 한다. 특히 F86 publish 성공과 checker/cross-audit까지 정상화된 뒤에는 retire/remove가 가장 명확한 ownership이다.

## 기존 HOLD 중 그대로인 것

- canonical production pin `6a6f3f75...` 자체와 Source Contract green 판정은 유지
- audit (22) special-tab deposit-policy 이중정의: main `deposit-policy.ts` vs production-local Sonogong/AutoPlus rule
- production `depositRuleViolations` gate가 current main `inventory-contract.ts`에는 아직 없음
- F86 plan은 `종합`만 timestamp인데 freshness checker는 모든 탭 timestamp를 요구하는 false-positive contract drift
- canonical ERP5 workflow disabled 상태
- legacy `sales-erp-hourly.yml`, `mirror-sync.yml`, old `settlement-sync.yml`, credential composite action, RP023 legacy mirror, pickup-color HOLD

## Claude 구현 Owner에게 넘기는 정정 지시

1. audit (24)의 `manual-erp5-full-sync-once.yml = old 2e880/F01+F86 stale writer` 문구를 더 이상 현재 사실로 사용하지 않는다.
2. 현재 사실은 **6a6 same-pin / F86-only / deposit heal+gate / push-on-self-change emergency writer**다.
3. run `35169123131`의 `Publish F86 from validated snapshot` 실패 원인을 실제 로그로 확인하고, 정상 F86 write + 감사까지 증명한다.
4. 그 뒤 one-time writer를 retire/remove하거나 canonical writer ownership 안에 명시적으로 정리한다.
5. deposit-policy 단일화와 F86 freshness checker 정렬은 별도 HOLD로 계속 처리한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.