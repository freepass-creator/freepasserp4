# Sheet Contract v1 — 표시 전용

## 기준과 범위

2026-09-21 origin/main `562ff11a547562b90298af6517938220855f8650`에서 분리했다.
PR454의 엔진·분류·ingest·발행기 변경을 포함하지 않는다. 운영 pin은 기존 `c3838708b84527db241f1985c140a3ec6ece6bff` 그대로다.
정본은 `contracts/sheets/sheet-contract-v1.json`이다.

실제 worksheet title만 바꾼다. 배너 행이나 셀은 추가하지 않는다.
첫 탭은 `상품리스트 MM-dd HH:mm N대`, 다음은 `손오공 N대`, `픽업 N대`, `오플 N대`다.
기타 회사 탭은 확인된 회사명 + 공백 + 실제 데이터 행 수다. 상품리스트 대수에 회사 탭을 더하지 않는다.
내부 identity는 상품리스트/손오공상품/픽업구독/오플구독이며 구명칭은 이 실행기의 읽기 별칭으로만 처리한다.
동일 identity가 둘이면 삭제·병합·분류 수정 없이 대상 전체 HOLD다.

차명(원본)/차명(원문)은 최소 180px, 옵션(원본)/옵션(원문)은 최소 320px다.
현재 폭이 더 크면 보존한다. 헤더로 열을 찾으며 헤더부터 마지막 데이터 행까지 wrapStrategy만 CLIP으로 바꾼다.
sheetId, index, 셀 값·수식, 데이터/행 순서, 필터, 고정, 병합, 보호, 행 높이와 나머지 사용자 서식은 보존한다.

## 실행과 증거

`sheet-formatting-only.yml`의 workflow_dispatch만 사용한다. 예약은 없고 기존 writer와 같은 concurrency group을 사용한다.
기존 GOOGLE_SA_JSON만 사용한다. 새 자격증명·공유·권한 설정은 하지 않는다.
dry-run은 Sheets 전체 grid/metadata와 Drive version/modifiedTime을 읽고 전후 revision이 같은지 확인한다.
로컬 snapshot planner는 Google에 접근하지 않는다. 실제 apply는 공식 저장소 main의 정확한 checkout에서만 허용한다.
현재 main에 엔진 전용 공용 쓰기 gate가 없으므로 이 실행기 내부에서 target/workflow/main/commit/hash/time을 검증한다.

apply=false로 생성된 snapshot hash, revision, capturedAt를 apply=true 입력에 그대로 전달해야 한다(90분 이내).
참조 감사는 같은 snapshot hash와 contract hash에 결합되어야 하며 미확정 참조·보호·수식·폭·중복은 HOLD다.
apply 직전 동일 snapshot을 재조회한다. 한 대상당 batchUpdate 한 번만 수행하고 자동 재시도하지 않는다.
변경 후 전체 상태를 재조회하여 소유 필드 외 상태 해시와 값/순서/제목/폭/CLIP을 대조한다.
실패 시 재시도하지 않으며 복구 요청은 현재 poststate hash 및 별도 승인 없이는 실행하지 않는다.
Actions artifact는 제목·열 폭 차이와 해시·판정·복구 서식 요청만 담는다. 차량 원문·전체 snapshot·자격증명은 저장하지 않는다.

## 현재 HOLD와 완료 경계

reference-audit.json은 UNAVAILABLE이다. Apps Script 및 외부 소비자 검증을 통과한 것으로 바꾸지 않는다.
main의 기존 `lib/domain/sales-published-tabs.ts`는 옛 prefix로 탭을 선택하므로 새 표시명과 호환되지 않는다.
그 선택기를 쓰는 감사/소비자 및 실제 고정 운영 엔진의 이름 의존성을 별도로 확인해야 한다.
기존 발행기는 이 PR 범위 밖이며 후속 정기 발행이 표시를 덮을 수 있다. 지속 적용을 보장하지 않는다.
F01의 손오공상품/오공구독 중복 또는 분류 차이는 별도 HOLD이며 이 도구로 고치지 않는다.

검증: typecheck, check:sync, `npx tsx scripts/sim-sales-sheet-banner.mts`, check:schedules, 기존 CI와 Cursor 독립 diff 검토.
새 sim은 표시 전용 workflow가 직접 실행한다. 기존 CI 검사기 규칙·정본 및 package scripts는 바꾸지 않는다.
검사 성공과 dry-run 성공은 실제 반영 완료가 아니다. 실제 완료는 apply 이후 READBACK_PASS 증거로만 판정한다.

## 2026-09-21 검증 기록

- typecheck, check:sync, exact sim, check:schedules, check:fonts, check:tokens, check:workflows PASS.
- 변경 파일의 private-key/API-token 패턴 및 민감 파일 경로 검사 0건. 이 패턴 검사는 모든 비밀 탐지를 보증하지 않는다.
- AGENTS 추가 게이트 master-lock은 12건 실패, master-pass도 FAIL. 변경 없는 base 562ff11a detached worktree에서 두 결과를 재실행했고 각각의 전체 출력 SHA-256이 동일하다. 기존 실패를 PASS로 처리하지 않는다.
- 이 PR은 기준 밖 차종마스터를 수정하지 않는다. live dry-run/apply 및 원격 CI 결과는 해당 Actions 실행 증거로 별도 판정한다.
- Cursor 독립 파일 검토: 표시 전용 범위 및 UNAVAILABLE 차단에 동의. write-site도 executableRequests를 사용하도록 방어를 보강했다.
- GITHUB 환경 검사는 실행 경로 가드이며 자격증명 소유자의 악의적 로컬 위조를 인증적으로 막는 장치는 아니다. 실제 실행은 공식 Actions만 사용하며 새 OIDC 권한·인증 체계는 이 변경에 추가하지 않는다.
