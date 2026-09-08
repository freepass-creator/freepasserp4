# 코덱스 요청 — 배포 서버에서 파이어스토어가 안 열린다 (`16 UNAUTHENTICATED`)

작성: 2026-09-05 · 클로드코드 → 코덱스 · 브랜치 `feat/spring-atom-monitor`

## 1. 증상 (사장님 실측)

Vercel 배포에서 손님 화면에 **차가 한 대도 안 나왔다**. 로컬(:4004)은 멀쩡했다.

```
[catalog/feed] 16 UNAUTHENTICATED: Request had invalid authentication credentials.  → 503
[firestore-shim] 폴백 products 16 UNAUTHENTICATED …                                  → 응답 상태 0(타임아웃)
```

## 2. 여기까지 밝혀 둔 것

| 항목 | 확인값 |
|---|---|
| 로컬 서비스계정 | `firebase-adminsdk-fbsvc@freepasserp3.iam.gserviceaccount.com` (project `freepasserp3`) |
| 그 계정으로 파이어스토어 읽기 | **된다** — products 1,375 · policy 81 · partner 64 · user 168 · contract 121 · settlement 14 |
| 배포 서버에서 RTDB 읽기 | **된다**(폴백이 실제로 데이터를 가져온다) |
| 배포 서버에서 파이어스토어 | **안 된다** — `16 UNAUTHENTICATED` |
| Vercel env | `FIREBASE_SERVICE_ACCOUNT_JSON` 이 **Preview 스코프에만** 있음(32일 전 등록) |
| | `NEXT_PUBLIC_FIREBASE_PROJECT_ID=freepasserp3` · `NEXT_PUBLIC_DATA_BACKEND=rtdb` |

⇒ **가장 유력한 원인**: Vercel 에 저장된 서비스계정 JSON 이 낡았거나(키 회전·비활성) 파이어스토어 권한이 없는 계정이다.
   RTDB 는 되는데 파이어스토어만 막히는 것이 그 방향을 가리킨다. Production 스코프에 값이 아예 없는 것도 확인 대상.

## 3. 부탁드리는 것

1. Vercel 프로젝트 `freepasserp4` 의 `FIREBASE_SERVICE_ACCOUNT_JSON` 이
   ㉠ 어느 계정인지 ㉡ 파이어스토어(Cloud Datastore User) 권한이 있는지 ㉢ Production 스코프에도 있는지 확인.
2. 없거나 낡았으면 **로컬에서 되는 계정**으로 교체(사장님 승인 뒤).
3. 교체 후 확인 — 아래 셋이면 충분하다.

```
npm run audit:firestore-parity                     # 갈래별 RTDB ↔ 파이어스토어 대조
npx vercel logs <배포주소> --json | grep firestore-shim   # 폴백 로그가 «사라져야» 정상
/uniauto 를 열어 목록 대수 확인                      # 파이어스토어면 729대 · RTDB 폴백이면 721대
```

## 4. 지금 코드가 어떻게 버티고 있나 (건드릴 필요 없음)

- `lib/server/firestore-ref-shim.ts` — **파이어스토어 먼저, 실패하면 RTDB.**
  · 읽기 제한시간 1.5초(`FIRESTORE_READ_TIMEOUT_MS`)
  · **첫 실패를 기억**해 그 서버에서는 더 두드리지 않는다(매번 기다리다 함수가 타임아웃 났었다)
  · 서버 인스턴스가 새로 뜨면 한 번은 다시 시도 — **자격증명만 고치면 배포 없이 저절로 돌아온다**
- 손님 동 두 곳이 그 심을 쓴다: `app/api/catalog/feed/route.ts` · `lib/server/guest-quote.ts`
- 컬렉션 이름 대응: `v4/products→products` · `policies→policy` · `partners→partner` · `users→user`

## 5. 그다음 (자격증명이 풀린 뒤)

- `NEXT_PUBLIC_DATA_BACKEND=firestore` 로 두면 `db.ref('v4/*')` 를 직접 파는 나머지 라우트도 심을 탄다.
  쓰기가 섞인 라우트가 있어 **묶음별로** 옮기고 확인한다(현재 RTDB 를 읽는 라우트 28개).
- 별도 건: 파이어스토어 products **159대에 `policy_code` 가 없다** → 손님 상세에서 보험·이용조건이 빠진다.
  원인은 `scripts/ingest-supplier-to-firestore.mts` 가 시트의 「정책코드」 열을 안 읽는 것.
