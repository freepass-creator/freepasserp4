# Claude 검수 결과 — Production 오픈 (2026-08-10)

> 요청: `docs/CLAUDE_OPEN_FULL_REVIEW_REQUEST_2026-08-10.md` (Cursor)
> 검수자는 운영 데이터·Rules·배포·env 를 **변경하지 않았다.** 읽기와 무인증 프로브만 했다.

---

## 1. 최종 판정

**질문이 틀렸다. `freepasserp.com` 은 이미 freepasserp4 Production 에 붙어 있다.**

```
vercel inspect freepasserp.com
  name    freepasserp4
  target  production
  status  ● Ready
  GET https://freepasserp.com  →  200
```

`www.freepasserp.com` 만 fp3 다. 그러니 「열어도 되는가」가 아니라
**「이미 열려 있는데 무엇이 새고 있는가」** 가 실제 질문이다.

**판정: CONDITIONAL — 즉시 닫을 것 1건, 확인할 것 2건.**
서비스를 내릴 정도는 아니다. 다만 아래 §3-1 은 오늘 처리하는 것이 맞다.

---

## 2. Cursor 판정 중 사실과 다른 것

Cursor 의 NO-GO 는 근거 5개 중 3개가 낡았다. 로컬 게이트만 보고 Production 을 추정한 탓이다.

| Cursor 주장 | 실측 | 근거 |
|---|---|---|
| 도메인이 아직 fp3 | **fp4 Production 이 이미 잡고 있음** | `vercel inspect freepasserp.com` · 200 |
| 선점 2플래그·서비스계정 FAIL | **Production 은 통과** | 아래 런타임 증거 |
| 게시용 Rules 보안 0/14 | **13/14** | `sim-release-security-rules` |

### 런타임 증거 — env 를 안 열고도 판정된다

`app/api/contracts/vehicle-claim/route.ts` 의 게이트 순서가 그대로 판정기다.

```
1. !vehicleClaimServerEnabled()  → 503 「차량 원자 선점 기능이 아직 활성화되지 않았습니다」
2. verifyActiveBearer 실패        → 503 「차량 선점 서버 인증을 사용할 수 없습니다」
3. actor 없음                     → 401 「로그인이 필요합니다」
```

Production 무인증 POST 응답은 **401 「로그인이 필요합니다」** 였다. 1·2 를 통과했다는 뜻이므로

- `VEHICLE_CLAIM_SERVER_ENABLED=true` — **켜져 있다**
- `FIREBASE_SERVICE_ACCOUNT_JSON` — **유효하다** (Admin 초기화 성공)

`check:b2b-release` 의 FAIL 5 는 **로컬 `.env.local` 을 읽은 결과**다(`scripts/check-b2b-release.mts:11`).
Production 판정에 쓸 수 없다. Vercel Production 에는 재동의·선점 2종이 17~18시간 전 등록돼 있고,
목록에 **없는 것은 아이언 연동(`IRONRENTCAR_SYNC_ENABLED`) 하나뿐**이다.

> **고칠 것:** `check:b2b-release` 가 로컬 env 로 Production 을 판정하는 척한다.
> 이번 오판의 원인이므로 「이 결과는 로컬 기준」임을 출력에 박거나 `--env=` 를 필수로 만들어야 한다.

---

## 3. 실제로 남은 것

### 3-1. 차단급 — `v4/products` 를 승인 대기 계정이 읽는다

```
게시본 database.rules.json
  v4/products  .read = "auth != null && sign_in_provider !== 'anonymous'"

후보 release-candidate.rules.json
  … && users/$uid/status !== 'pending' && is_active !== '아니오' …
```

로그인만 하면 **아직 승인하지 않은 계정도 재고 전체를 읽는다.**
원가는 `v4/products_private` 로 분리돼 있고 게시본에서도 admin·소유 공급사만 읽으므로
**원가 유출은 아니다.** 새는 것은 재고 목록 자체(차종·차번·상태)다.
경쟁 공급사가 가입만 해도 우리 재고를 통째로 본다.

**후보 Rules 를 게시하면 닫힌다. 그리고 게시를 막던 전제가 이미 사라졌다.**
Cursor 가 「플래그 OFF + Rules 게시 = 입금확인 전면 401」이라며 막았는데,
위 런타임 증거대로 **플래그는 이미 ON** 이다. 즉 지금은 게시해도 그 사고가 나지 않는다.

순서(사람이 실행):
1. `npx tsx scripts/sim-release-security-rules.mts --rules=scripts/ruleprobe/release-candidate.rules.json` → 14/14 재확인
2. 후보 Rules 게시
3. 게시 직후 smoke — 계약금 입금·입금확인 쓰기 1건, 공급사 계정 재고 읽기 1건, 승인대기 계정 재고 읽기가 **막히는지** 1건
4. 3번이 하나라도 깨지면 즉시 롤백

### 3-2. 확인 필요 — 원가 분리 마이그레이션이 실제로 돌았는가

규칙은 `v4/products_private` 를 전제하지만, `lib/firebase/migrate-products-private.ts` 가
운영에서 실행돼 **공개 경로의 원가가 지워졌는지**는 DB 를 봐야 안다(검수자는 운영 DB 를 읽지 않았다).
안 돌았으면 3-1 의 심각도가 「목록 유출」에서 **「원가 유출」로 올라간다.**
관리자 계정으로 `v4/products` 한 건에 `vehicle_price` 가 남아 있는지만 보면 된다.

### 3-3. 확인 필요 — RTDB 가 fp3 와 같은 인스턴스다

배포 번들의 DB URL 은 `freepasserp3-default-rtdb.asia-southeast1`.
fp4 Production 이 **fp3 와 같은 DB 를 쓴다.** 의도된 것이라면(브리지 유지) 문제없지만,
「fp4 단독 오픈」이라고 부를 수는 없다. 오픈 범위를 문서에서 B2B 로 명시하는 편이 정확하다.

### 3-4. 오픈 차단 아님

- **아이언 연동 OFF** — 오픈 범위에 아이언 재고가 없으면 차단 아님. 범위를 먼저 정할 것
- **재동의 게이트** — Production 에 값이 있다. 기존 회원 증적은 법적 숙제지 서비스 차단 사유는 아님
- **브랜치 dirty(미커밋 70)** — 이미 배포된 Production 과 무관하다. 다만 **지금 Production 에 뭐가 올라가 있는지 아무도 모른다**는 뜻이므로, 배포 ID `dpl_1237MjkSMsyhSsbtYWELKGCvvDzi` 를 기준선으로 태그해 둘 것
- **회원 4패널 vs `.cursorrules` 1패널** — 문서 드리프트다. 코드가 맞고 규칙 문구를 고치면 된다

---

## 4. Cursor §3 이유에 대한 동의/기각

| # | Cursor 이유 | 판정 |
|---|---|---|
| 1 | UI 가 깨져서가 아님 | **동의** |
| 2 | 실서비스 스위치가 꺼져 있음 | **기각** — 로컬 기준 오판. Production 은 켜져 있다 |
| 3 | Rules 를 올리면 딜 사망 | **기각** — 그 전제(플래그 OFF)가 이미 해소됐다. 오히려 안 올려서 새고 있다 |
| 4 | 손님 도메인이 아직 fp3 | **기각** — 이미 fp4 다 |
| 5 | 현재 브랜치 ≠ 출시 산출물 | **동의** — 배포 ID 기준선 고정 필요 |

---

## 5. 다음 한 명령

- **사람:** 관리자 계정으로 `v4/products` 한 건에 `vehicle_price` 가 남아 있는지 확인 (3-2)
- **사람:** 후보 Rules 게시 + 게시 직후 smoke 3건 (3-1)
- **Cursor:** `check-b2b-release.mts` 출력에 「로컬 `.env.local` 기준」 명시 · `--env=` 미지정 시 경고. 판정 로직은 건드리지 말 것
