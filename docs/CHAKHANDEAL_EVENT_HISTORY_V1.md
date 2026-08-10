# 착한거래 전자계약 이력 규격 v1

작성: Codex · 2026-08-10  
상태: 사용자 방향 승인 · 저장소 구현은 커서 현재 작업 인수 후 진행

## 1. 역할

- **착한거래가 전자계약 이력의 SSOT**다.
- 프리패스는 계약 원장과 입력값을 소유하고, 착한거래 계약 ID 및 최신 상태를 투영한다.
- 향후 다른 전자계약 업체는 이 이력 규격으로 변환하는 adapter를 구현한다.
- 프리패스가 서명·본인확인·PDF 완료 시각을 임의로 만들거나 착한거래 이력을 직접 수정하지 않는다.

## 2. 식별자

| 필드 | 소유자 | 의미 |
|---|---|---|
| `contractId` | 착한거래 | 전자계약 전역 식별자 |
| `externalRef` | 회원사 | 프리패스에서는 `contract_code` |
| `memberCompany` | 착한거래 | 회원사 격리 키 |
| `provider` | 이력 규격 | `chakhandeal` 또는 향후 외부 업체 코드 |
| `providerContractId` | adapter | 외부 업체가 발급한 계약 ID |

`memberCompany + externalRef`는 발행 idempotency key다. 같은 조합의 재요청은 새 계약을 만들지 않는다.

## 3. 이벤트 공통 구조

```json
{
  "schemaVersion": 1,
  "eventId": "opaque-id",
  "sequence": 1,
  "contractId": "chd_...",
  "externalRef": "CT-...",
  "memberCompany": "freepass",
  "provider": "chakhandeal",
  "providerContractId": "",
  "type": "contract.issued",
  "occurredAt": 1786280000000,
  "recordedAt": 1786280000100,
  "actor": { "kind": "member", "id": "freepass" },
  "source": { "kind": "api", "idempotencyKey": "..." },
  "data": {}
}
```

규칙:

- 이벤트는 append-only다. 수정·삭제 대신 정정 이벤트를 추가한다.
- `eventId`와 `sequence`는 한 계약 안에서 중복될 수 없다.
- 같은 `idempotencyKey` 또는 같은 공급자 이벤트 ID는 한 번만 기록한다.
- 이벤트에는 주민번호, 신분증·셀카·서명 원본, 파일 경로, API Key를 넣지 않는다.
- 고객정보가 필요한 이벤트도 값 대신 제출 여부·시각·참조 ID만 기록한다.

## 4. 표준 이벤트

| 이벤트 | 최소 data | 발생 시점 |
|---|---|---|
| `contract.issued` | `templateId`, `expiresAt` | 링크 발급 확정 |
| `contract.opened` | 없음 | 고객 최초 열람 |
| `consent.completed` | `key` | 동의 단계 최초 완료 |
| `identity.submitted` | `hasIdCard`, `hasSelfie` | 본인확인 자료 제출 |
| `identity.verified` | `method` | 본인확인 완료 |
| `document.submitted` | `key` | 요구서류 제출 |
| `supplement.requested` | `items`, `messagePresent` | 보완 링크 생성 |
| `supplement.completed` | `items` | 요청 항목 전부 보완 |
| `contract.signing` | 없음 | 서명·PDF 봉인 잠금 시작 |
| `contract.signed` | 없음 | 서명 확정 |
| `document.sealed` | `sha256`, `bytes` | 완료 PDF 봉인 성공 |
| `handover.recorded` | `contractStart`, `contractEnd` | 차량 인도일 확정 |
| `contract.expired` | 없음 | 만료 확정 |
| `contract.cancelled` | `reasonCode` | 계약 취소 |
| `contract.corrected` | `targetEventId`, `fields` | 이전 이력 정정 고지 |

`consent.completed`의 `key`는 현재 착한거래/프리패스 공통 키를 유지한다:

`identity_verified`, `identity`, `vehicle`, `rental`, `insurance`, `documents`, `agreement`, `signed`.

## 5. 현재 인스턴스와의 관계

- `contractInstances`의 현재 필드는 빠른 화면 조회용 projection으로 유지한다.
- 이력 이벤트가 원본이고, `status`, `openedAt`, `signedAt`, `consents`, `supplements`, `handovers`, PDF 메타는 그 결과 상태다.
- 기존 계약은 현재 필드에서 초기 이력을 한 번 backfill하되 `source.kind = "legacy_backfill"`로 구분한다.
- backfill은 운영 반영 전 건수·순서·중복을 별도 검증한다.

## 6. 회원사 조회와 프리패스 투영

- 착한거래 회원사 API는 계약 소유 회원사만 이력을 조회할 수 있다.
- 1차 API 후보: `GET /api/v1/contract/{contractId}/events?afterSequence=N&limit=100`.
- 응답은 `events`, `nextSequence`, `hasMore`를 반환한다.
- 프리패스는 전체 이력을 RTDB에 복제하지 않는다.
- 프리패스 계약에는 `esign_id`, 최신 상태, `esign_last_event_sequence`, `esign_sync_at`만 저장한다.
- 상세 이력이 필요할 때 착한거래에서 조회하고, 목록은 기존 상태 projection을 사용한다.

## 7. 외부 전자계약 업체 adapter

외부 업체 adapter는 아래만 책임진다.

1. 계약 발행 요청을 업체 payload로 변환
2. 업체 계약 ID를 `providerContractId`로 연결
3. webhook/poll 응답을 표준 이벤트로 변환
4. 중복 webhook을 공급자 이벤트 ID로 차단
5. 원본 응답은 보안 저장소에 보관하고 회원사 API에는 표준 이벤트만 공개

프리패스는 업체별 상태명이나 webhook 구조를 직접 알지 않는다.

## 8. 구현 게이트

- 커서의 현재 `contractInstances.js`·발행/서명 테스트 작업이 끝난 뒤 파일을 다시 읽고 구현한다.
- 저장 위치(Firestore subcollection 또는 별도 event store)는 사람/Claude 게이트에서 확정한다.
- `writeAudit`은 운영 감사로그이며 계약 도메인 이력을 대신하지 않는다. 두 기록은 목적과 보존정책을 분리한다.
- 기존 상태 API 호환을 깨지 않는다.
- 이벤트 쓰기 실패 시 계약 상태만 진행되어 이력과 어긋나지 않도록 원자성 또는 재시도 outbox가 필요하다.
- 운영 데이터 backfill·Rules·배포는 별도 승인 전 실행하지 않는다.

## 9. 완료 테스트

- 같은 발행 요청 2회 → `contract.issued` 1건
- 열람 2회 → 최초 `contract.opened` 1건
- 동의·서류 재호출 → 단계별 최초/보완 이벤트가 의도대로 구분
- 서명 경쟁 요청 → `contract.signing`, `contract.signed`, `document.sealed` 각 1건
- 보완 요청·완료 순서 보존
- 다른 회원사의 이력 조회 404
- 이벤트 응답에 개인정보 원본·내부 경로 없음
- `afterSequence` 증분 동기화 중 누락·중복 없음
- 기존 상태 API와 이벤트로 재구성한 projection 일치
