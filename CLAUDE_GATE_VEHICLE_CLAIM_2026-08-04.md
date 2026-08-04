# Claude 위험영역 게이트 — 차량 원자 선점 (2026-08-04)

대상: `74b1860..242de54` (55파일 · +3,761)
검수자: Claude · 방식: 코드 정독 + **보고 수치 직접 재현** + 실데이터 측정(읽기 전용)

판정: **차단 1 · 주의 1 · 참고 2.** 구현 자체는 견고하다. 문제는 **게시 순서**다.

---

## 재현한 것 (코덱스 보고를 그대로 믿지 않는다)

```
tsc --noEmit                     통과
sim-vehicle-claim                11/11    ← 보고와 일치
sim-vehicle-lock                 38/38    ← 보고와 일치(14번 포함)
check-b2b-release                37 PASS / 3 FAIL
   FAIL 3건 = 서비스계정 없음 + 두 플래그 OFF — 로컬에선 정상(의도된 차단)
```

실데이터 측정: `tmp/claim-identity-check.mts` — 살아있는 계약 65건 전부 신원 산출 가능, 불일치 0.

---

# 🔴 차단 1 — 게시 순서가 뒤집혀 있다. 그대로 하면 오픈 당일 딜이 멈춘다

## 사실관계

후보 Rules 가 선점 3필드를 **서버 단일 writer**로 잠갔다.

```js
// build-release-candidate.mjs
const serverClaimOnly = "newData.val() === data.val()";
contract.vehicle_identity_hash     = { '.validate': serverClaimOnly };
contract.agent_balance_paid        = { '.validate': serverClaimOnly };
contract.provider_balance_confirmed= { '.validate': serverClaimOnly };
```

기존 값과 **같은 값만** 쓸 수 있다는 뜻이라, 클라이언트는 `''` → `'yes'` 를 영영 못 쓴다.
코덱스 자신의 probe 가 이걸 확인한다.

```
check('agent 선점 필드 직접 write 차단',    … 401);
check('provider 선점 필드 직접 write 차단', … 401);
```

클라이언트가 서버 API 로 우회하는 조건은 **플래그 두 개가 모두 ON** 일 때뿐이다.

```ts
// vehicle-claim-client.ts:15
backend.startsWith('rtdb') && process.env.NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS === 'true'
```

플래그가 OFF 면 `applyStepCheck` 는 기존 직접쓰기 경로로 내려간다 → **`.validate` 에 막혀 401.**

## 그런데 런북 순서가 이렇다

```
HANDOFF.md:1007 · VERIFICATION.md:14
  운영자 정보 → Preview smoke → ④ 후보 Rules 게시 → ⑥ Production 서비스계정·플래그
```

**Rules 게시(④)가 Production 플래그(⑥)보다 앞이다.**

RTDB 는 `freepasserp3` **하나뿐이고 Preview 와 Production 이 같은 인스턴스를 본다.**
따라서 콘솔에서 규칙을 게시하는 순간 **Production 에 즉시 적용**된다. 그 시점의 Production 은
아직 플래그 OFF · 서비스계정 없음이므로 —

```
영업자 「계약금 입금」 체크 → 401
공급사 「입금 확인」 체크   → 401
→ 딜이 한 건도 진행되지 않는다. 오픈 당일 전면 정지.
```

Preview 에서 전부 통과해도 이건 안 잡힌다. Preview 는 플래그가 ON 이기 때문이다.
**「로컬·Preview 통과 ≠ 실데이터 안전」이 정확히 이 자리다.**

## 고칠 것 — 순서를 뒤집는다

```
① 운영자 6필드 (Production/Preview 동일)
② Production 에 FIREBASE_SERVICE_ACCOUNT_JSON + VEHICLE_CLAIM_SERVER_ENABLED=true
                                              + NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS=true
③ Production 재배포 → 실계정으로 계약금 체크 1건 성공 확인   ← 여기서 서버 경로가 살아있음을 증명
④ 현재 Rules 백업
⑤ 후보 Rules 게시
⑥ 게시 후 다시 계약금 체크 1건 + 5역할 smoke
```

**②③ 이 ⑤ 보다 반드시 앞이다.** 플래그를 먼저 켜도 부작용이 없다 —
서버는 Admin SDK 라 구 Rules 에서도 통과하고, 클라이언트는 API 만 부른다.
반대로 하면 그 사이 전부 멈춘다.

롤백은 ④ 백업 재게시. 그것만으로 구 경로가 되살아난다.

---

# 🟡 주의 1 — 죽은 claim 은 스스로 풀리지 않는다. 그 차는 영원히 안 팔린다

`transitionVehicleClaim` 은 두 단계다.

```ts
① claimRef.transaction(...)          → status: 'claiming'
② db.ref('v4').update({ … status: 'active' … })
```

①과 ② 사이에서 함수가 죽으면(Vercel 타임아웃·배포 교체·네트워크) claim 은 `'claiming'` 으로 남는다.
그리고 `reserveVehicleClaim` 은 **소유자만 보고 시각은 보지 않는다.**

```ts
if (current?.contract_code && current.contract_code !== request.contract_code) return null;
```

→ 다른 계약은 **영구히** 그 차를 선점할 수 없다. `updated_at` 을 저장하지만 아무도 안 읽는다.

게다가 클라이언트는 `v4/vehicle_claims` 를 **읽지도 못한다**(`.read` 관리자 한정, `.write: false`).
영업자 화면에는 「같은 차량을 다른 계약(확인 중)이 먼저 선점했습니다」만 뜬다 —
**존재하지 않는 계약을 가리키는 메시지**라 원인 추적이 불가능하다.

권고(작고 안전함): `reserveVehicleClaim` 에 시각 조건 하나.

```ts
const STALE_MS = 2 * 60 * 1000;
if (current?.contract_code && current.contract_code !== request.contract_code) {
  const stale = current.status !== 'active' && now - Number(current.updated_at || 0) > STALE_MS;
  if (!stale) return null;          // 살아있는 선점은 그대로 존중
}
```

`status !== 'active'` 로 좁히므로 **정상 선점은 절대 탈취되지 않는다.** 중간에 죽은 것만 회수한다.
지금 당장 안 넣는다면 최소한 운영 점검 항목으로: `v4/vehicle_claims` 에서
`status !== 'active'` 이고 오래된 항목 조회.

---

# 참고 2건

## ① 테스트 14가 이제 통과하는 이유는 운영과 다르다

`sim-vehicle-lock` 38/38 에는 아까 실패했던 14번(동시 선점)이 포함된다. 통과 이유는
`localVehicleClaims` **Map** 이다. 코덱스가 주석에 «LocalAdapter 시뮬레이션 전용 · 운영 안전장치 아님»
이라고 정확히 적어 뒀다 — 문제는 없다.

다만 **38/38 을 「경쟁 닫힘」으로 읽으면 안 된다.** 운영 보증은 서버 transaction 이고,
그 증거는 `vehicle-claim-api-probe.mjs`(에뮬레이터 통합) 쪽이다. 숫자를 인용할 때 구분할 것.

## ② 신원 해시를 계약 스냅샷에서 뽑는다 — 지금은 문제 없음

```ts
// server/vehicle-claim.ts:40
const direct = vehicleIdentity({ car_number: contract.car_number_snapshot || contract.car_number, … });
```

계약 스냅샷은 동결이고 매물 번호판은 바뀔 수 있다(임시번호 `100신0001` → 실번호).
그러면 같은 실물인데 계약마다 해시가 달라져 claim 이 직렬화되지 않는다.

**실측: 살아있는 계약 65건 전부 일치, 불일치 0.** 그리고 `lockedProductRival` 이 매물 신원으로
다시 검사하므로 backstop 이 있다. 지금 고칠 필요는 없고, 임시번호 신차가 늘면 다시 볼 것.

---

# 잘한 것 — 짚고 넘어간다

- **`lib/legal.ts` 를 지어내지 않았다.** 사업자등록번호 같은 사실정보를 코드에 박는 대신
  `NEXT_PUBLIC_OPERATOR_*` 환경변수로 뺐다. 원칙을 지키면서 차단을 사용자 손으로 옮긴 정확한 판단이다.
- **kill switch 가 이중이다.** 서버(`VEHICLE_CLAIM_SERVER_ENABLED`)가 1차라 URL 직접 호출도 503.
- **`v4/vehicle_claims` 를 클라이언트에서 완전히 닫았다**(`.write: false`, read 관리자 한정).
  claim 원장이 SSOT 인데 클라이언트가 손댈 수 있으면 전체가 무의미해진다.
- **v3 에 쓰지 않는다.** 충돌 판정용으로만 읽는다.
- **`check-b2b-release.mts` 가 플래그 ON 을 강제**하고, 규칙 파일에서 3필드 `.validate` 문자열까지 대조한다.
  게이트를 코드로 박아 둔 건 좋다 — 다만 그 게이트도 **게시 순서까지는 못 막는다**(차단 1).
- 내가 남긴 RACE-2 를 그냥 덮지 않고 `DOUBLE_SALE_GUARD_2026-08-04.md` §9 로 이어 썼다.

# 결론

**코드는 통과. 순서 문서를 고치기 전에는 게시 금지.**
차단 1을 반영해 런북 순서를 뒤집고, 주의 1은 오픈 전에 넣는 편이 낫다(변경이 작고 회수 전용이라 위험이 없다).
