# AI Core Core Contract Adoption — ERP4 / ERP5 SSOT — 2026-09-19

상태: **SHADOW PILOT**

## 기준

ERP4 current main:
`44a67cedc5f0d3e38efc68f1e8f84e6c28ab97b3`

Production SSOT engine pinned by workflow:
`cf940df642edf315adbc6da2b4134fbad53da160`

중요:
current main의 `scripts/ingest-all-suppliers.mts`는 production writer가 아니다.
현재 파일은 **SSOT HARD GUARD**이고 직접 실행 시 exit 2로 막는다.

실제 production writer 경계는:
`.github/workflows/erp5-ssot-refresh.yml`

이며 위 workflow가 검증된 engine revision을 checkout해 실행한다.

## 1. Source Registry SHADOW

`contracts/ai-core/erp5-products.source-registry.json`

선언:
- canonical owner: `freepasserp5`
- canonical writer: `erp5-ssot-refresh.yml`
- canonical source: ERP5 Firestore products
- fallback: NONE
- explicit activation/evidence requirement 유지

기존 ERP5 SSOT 의미를 바꾸지 않는다.

## 2. Snapshot SHADOW

기존 SalesPublishSnapshot은 이미:
- Firestore read-only transaction
- same-read products/policies/partners
- immutable file create (`wx`)
- payload hash
- snapshot ID
- capturedAt
- max-age check

를 갖는다.

`lib/domain/ai-core-contract-shadow.ts`는 이를 재계산하지 않고 다음처럼 투영한다.

- snapshotId → Core snapshot_id
- payloadHash → `sha256:<hash>`
- payloadHash → content subject revision
- pinned ERP5 engine git SHA → source_revision
- 기존 snapshot 전체 → payload

즉 기존 snapshot이 정본이고 Core envelope는 shadow projection이다.

## 3. Import Pipeline SHADOW

`contracts/ai-core/erp5-product-refresh.pipeline.json`

실제 pinned engine을 다시 읽어 확인한 동작:

1. 전체 supplier dry-run preflight
2. preflight 모두 성공해야 apply 시작
3. supplier별 sequential apply
4. 한 supplier가 apply 중 실패해도 다음 supplier를 계속 시도
5. 마지막에 실패 건수가 있으면 process exit 1

따라서 전역 atomic batch가 아니다.

정직한 Core 표현:
- commit_policy: `BEST_EFFORT_BATCH`
- partial_failure_policy: `ALLOW_PARTIAL_WITH_RECEIPT`
- receipt_required: true

### 현재 gap

현재 supplier apply 전체 결과에 대한 **durable Core PARTIAL/FAILED receipt는 아직 없다**.

GitHub log만으로 VALIDATED를 선언하지 않는다.

그래서 현재 결과는:
`SHADOW_WITH_RECEIPT_GAP`

이다.

## 4. Export Pipeline SHADOW

`contracts/ai-core/erp5-sales-publish.pipeline.json`

- fixed ERP5 snapshot read
- project/public projection
- serialize
- F01/F86/public catalog deliver

Core에서는 READ_ONLY export pipeline으로 표현한다.

공개 카탈로그는 현재도 `verify-whitelabel-publication --write-receipt`로 별도 검증 receipt를 남긴다.
다만 전체 F01/F86 publication orchestration receipt와는 구분한다.

## 5. CI

`.github/workflows/ssot-source-contract.yml`에:

`npx tsx scripts/check-ai-core-contract-shadow.mts`

를 추가한다.

검사는:
- workflow가 audited engine revision에 pin되어 있는지
- ERP5 project/OIDC writer가 유지되는지
- current main direct ingest가 HARD GUARD인지
- no fallback source registry인지
- BEST_EFFORT partial pipeline을 거짓 atomic으로 선언하지 않았는지
- existing snapshot → Core snapshot projection이 digest/revision을 보존하는지

를 확인한다.

## 6. 아직 VALIDATED가 아닌 이유

- import partial-success durable receipt 없음
- 전체 publish operation receipt 없음
- Core request/error contract는 API write boundary에 아직 미적용
- production workflow 자체를 Core contract로 실행하는 cutover는 하지 않음

따라서 이 PR은 production behavior 변경이 아니라 **실제 운영 의미를 기계 계약으로 SHADOW 표현하고 검증하는 단계**다.

## 7. 다음 gate

1. 이 branch SSOT CI PASS
2. supplier batch PARTIAL/SUCCEEDED/FAILED durable receipt 구현
3. existing sales snapshot → Core snapshot 실제 artifact receipt 연결
4. F01/F86/public publication 전체 orchestration receipt
5. 반복 CI + production evidence
6. 그 뒤 해당 계약만 SHADOW → VALIDATED 검토
