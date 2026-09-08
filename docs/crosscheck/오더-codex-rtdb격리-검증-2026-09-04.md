# 코덱스 검증 오더 — RTDB 제거 격리 (2026-09-04)

> 코덱스 = **검사만**. 고치지 마라 — 어긋난 것을 «어디가 왜»로 보고하면 클로드가 고친다.
> 검증 기준 = **보안 요구사항**(§1), 클로드 설계 아님.

## §1. 보안 요구사항 (검증 기준)
사장님 「rtdb 없애라 · 문제 없게끔」. Firestore 스위치(`NEXT_PUBLIC_DATA_BACKEND=firestore`) 후:
1. **영업자는 «자기 계약·자기 손님»만** 본다. 남의 것은 절대 안 보인다.
2. **공급사는 «자기 공급사(provider_company_code)» 것만** 본다.
3. **정책·파트너는 참조데이터** — 영업자가 어느 공급사 것이든 read, 쓰기는 admin.
4. **손님(customer)은 개인정보** — 만든 사람(created_by=uid)만 read/update.
5. 정산 금액변경은 admin만. 비로그인 전면 차단.
6. Firestore 는 «규칙=검증»이라, 어댑터 쿼리가 규칙과 «같은 제약»이 아니면 목록이 통째로 거부된다.

## §2. 이번에 바뀐 것 (검증 대상)
| 파일 | 무엇 |
|---|---|
| `firestore.rules` | 계약·정산=provider/agent 격리 · 정책·파트너=참조 · 손님=created_by · 사용자=admin |
| `lib/store.ts` FirestoreAdapter | list/get/update 를 규칙과 같은 제약으로(계약·정산·손님·정책·파트너) |
| `firestore.indexes.json` | 계약·정산 (_key+agent_code)·(_key+provider_company_code) 복합인덱스 |
| `scripts/set-user-claims.mts` | 클레임 = role·company·agent_code(=user_code)·provider_company_code |
| `scripts/check-firestore-rules.mts` | 에뮬레이터 격리 테스트(현재 21/21) |

## §3. 코덱스가 «독립»으로 검증할 것
1. **격리 누출** — `npm run check:rules` 를 돌리고, «영업자A가 영업자B의 계약·손님을 읽는» 케이스를 «추가»로 넣어도 여전히 차단되는지(내가 짠 테스트를 믿지 말고 새 케이스로). 공급사↔공급사도.
2. **어댑터 ↔ 규칙 일치** — `lib/store.ts` 의 list/get/update 쿼리 제약이 `firestore.rules` 와 «정확히» 같은지. 하나라도 어긋나면 쿼리 거부 또는 누출.
3. **클레임 정확성** — `set-user-claims` 의 agent_code=user_code 가 실제 계약 `agent_code` 와 맞는지(실측 17/18 — 안 맞는 1건은 무엇인지). company_code=provider 매핑.
4. **복합인덱스** — get/update 의 `_key + agent_code` 2-equality 쿼리에 인덱스가 정의됐는지(없으면 런타임 실패).
5. **놓친 엔티티** — 앱이 list/get 하는 엔티티 중 규칙·어댑터에서 격리 안 된 게 있는지(스위치 시 거부/누출).
6. **customer created_by** — 규칙이 uid 기준인데 어댑터 list 가 `where created_by==세션 uid` 인지. 세션 uid ↔ auth.uid 일치.

## §4. 통과 기준
- `npm run check:rules` = 전부 통과(현재 21/21) · 코덱스가 추가한 누출 케이스도 차단.
- `npx tsc --noEmit` = 0.
- §3 어긋남 없음. 어긋나면 파일·이유 보고.

## §5. 알려진 미결(고치라는 것 아님)
- 인덱스·규칙 «미배포»(게이트) · 파이프라인 Firestore 쓰기 미전환 · 스위치 미실행.
- 비용은 1단계(파인더 Firestore)로 이미 끊김.
