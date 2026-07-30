# RTDB 규칙 프로브 (실제 에뮬레이터 검증)

**왜 이게 있나:** `scripts/sim-*.mts` 14개는 **규칙 회귀를 원리적으로 잡지 못한다**. 검증 결과:

- `sim-authorization.mts` — 규칙 표현식을 **정적 문자열 매칭**만 한다. 규칙 끝에 `|| true`(전면 개방)를 붙여도 **44/44 PASS**. 역으로 리팩터로 문자열만 바뀌면 오탐 FAIL.
- `sim-contract-rules.mts` · `sim-chat-rules.mts` — 규칙을 TS로 **손수 재구현한 미러**. 규칙 파일만 고치고 미러를 안 고치면 여전히 PASS(드리프트 무탐지). 미러는 역할 3종만 다루는데 실제 규칙은 6종 분기.
- `sim-vehicle-lock` · `sim-agent` · `sim-e2e-settlement` · `sim-lifecycle` · `sim-phase12` — RTDB를 아예 타지 않는 순수 도메인 테스트(그 자체로는 가치 있음, 규칙 검증은 0%).

즉 `LAUNCH_GONOGO.md`의 "B1 규칙 ✅ 검증됨"은 **실패할 수 없는 테스트**에 근거했고, 그래서 `products` 전면 쓰기 구멍이 검증을 통과한 채 남았다.

이 프로브는 **실제 Firebase 에뮬레이터**(Auth + Database)에 테스트 계정을 만들고 REST로 요청해 **HTTP 200/401을 직접 확인**한다. 규칙을 잘못 고치면 반드시 실패한다.

## 실행

```bash
# 사전: Java 21+ (에뮬레이터 요구사항)
cd scripts/ruleprobe
npx firebase-tools@13 emulators:exec --project demo-freepasserp4 --only auth,database "node probe2.mjs"
```

- `probe2.rules.json` — 검증 대상 규칙(강화안). 실제 `database.rules.json`을 여기 복사해 돌린다.
- `probe2.mjs` — 케이스 정의. 각 케이스는 `기대 status` 와 `실제 status` 를 비교하고 불일치 시 실패.
- `probe.mjs` / `probe.rules.json` — 1차 탐색용(초안 검증). 참고용으로 보존.

## 이 하네스로 잡아낸 것 (2026-07-30)

| 케이스 | 발견 |
|---|---|
| P1 | **소유판정을 `newData` 기준으로 하면 매물 탈취 가능** — 공급사 B가 남의 매물에 자기 코드를 같이 써넣으면 200(성공). `data` 기준으로 바꿔야 401 |
| P11/P12 | **RTDB는 자식 `.read`가 부모 읽기를 만들지 못한다** — `users/$uid`에 admin을 넣어도 admin의 노드 통째 GET은 401. `.read`를 admin 전용으로 **강등**해야 회원관리가 산다 |
| P6/P7 | 소유필드 없는 고아 매물(949건) 리프패치 — provider 401 / admin 200. 어댑터의 소유코드 **승계 스탬프가 없으면 죽는다** |
| P15 | `newData.exists()` 가드가 본인 노드 자가삭제(승인게이트 우회)를 막는지 |
| P3/P2 | 통째 PUT과 리프 PATCH가 **한 `.write`로 둘 다** 커버되는지(캐스케이드 확인) |

## 규칙을 고칠 때

1. `database.rules.json` 수정
2. `probe2.rules.json`에 반영(또는 복사)
3. 케이스 추가 — **새로 막는 것**과 **계속 통과해야 하는 정당 경로** 양쪽 다
4. 위 명령으로 실행 → 전 케이스 통과 확인
5. 그 다음에 콘솔 게시

**정당 경로 케이스를 빠뜨리면 배포 후 조용히 기능이 죽는다**(목록 read 실패는 catch가 삼켜 "빈 목록"으로 보인다).
