# ERP5 Ingest Core Receipt Shadow — 2026-09-19

상태: **SHADOW / NON-BLOCKING / PRODUCTION OBSERVATION REQUIRED**

기준:
- ERP4 Core Contract SHADOW: PR #434
- production engine pin: `cf940df642edf315adbc6da2b4134fbad53da160`

## 목적

ERP5 supplier batch는 전역 atomic이 아니다.

실제 engine은:
1. 전체 dry-run preflight
2. supplier별 sequential apply
3. apply 중 일부 실패 가능
4. 이미 성공한 supplier write는 남을 수 있음
5. 마지막 exit code는 실패

따라서 실패를 단순 `FAILED` 한 단어로만 남기면
“아무것도 안 써짐”과 “22곳 성공 + 2곳 실패”를 구분할 수 없다.

## 구현

### Engine pin 유지

production root checkout은 기존과 동일하게 검증 engine revision을 사용한다.

writer code/ref를 바꾸지 않는다.

### Receipt helper만 workflow revision에서 별도 checkout

`.core-contract-helper` 경로에:
- `github.workflow_sha`
- sparse checkout: `scripts/core-contract`

만 가져온다.

즉:
- writer = pinned production engine
- evidence helper = 현재 workflow revision

을 분리한다.

### Ingest stdout

기존 실행 명령에:
- `set -o pipefail`
- `tee tmp/core-contract/erp5-ingest.log`

를 추가한다.

`pipefail` 때문에 기존 command 실패는 그대로 step 실패다.
tee가 실패를 숨기지 못한다.

raw log는 artifact로 업로드하지 않는다.

### Receipt

`scripts/core-contract/build-erp5-ingest-receipt.mjs`

마지막 phase summary를 읽는다.

예:
- 반영 성공 24 / 실패 0 → SUCCEEDED
- 반영 성공 22 / 실패 2 → PARTIAL
- preflight 실패 → FAILED / SUPPLIER_PREFLIGHT_FAILED
- summary 자체 미관측 → HOLD / INGEST_LOG_UNPARSEABLE
- manual dry-run → preview receipt

보존하는 값:
- engine revision
- GitHub run / attempt
- phase
- supplier success / failed / total
- input/output digest
- execution time
- non-sensitive evidence ref

차량번호·고객정보·원문 row는 receipt에 넣지 않는다.

## 현재 non-blocking인 이유

receipt step과 artifact upload는 `continue-on-error: true`다.

즉 receipt 코드의 버그 때문에 기존 ERP5 refresh/publication이 중단되지 않는다.

이 단계에서는:
- writer semantics 변경 금지
- publication gate 변경 금지
- production evidence를 먼저 관측

한다.

## CI

PR/일반 CI에서는 production writer를 실행하지 않는다.

대신:
- success
- partial
- preflight fail
- preview
- unparseable

5개 합성 log로 receipt parser를 검증한다.

그리고 workflow 정적 검사로:
- engine pin 유지
- helper revision 분리
- pipefail 유지
- receipt step 존재
- non-blocking 유지

를 확인한다.

## 다음 gate

실제 production ERP5 refresh에서 receipt artifact가 반복 생성되는 것을 관측한 뒤:

1. receipt schema conformance 확인
2. PARTIAL/FAILED 실제 사례 또는 controlled fixture 확인
3. 민감정보 미포함 확인
4. artifact retention 확인
5. 그 뒤 receipt step을 required gate로 승격할지 별도 결정

관측 전에는 `SHADOW`를 넘지 않는다.
