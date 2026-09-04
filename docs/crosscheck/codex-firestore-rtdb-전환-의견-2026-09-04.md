# Codex 의견 — Firestore 전환과 RTDB 정리 (2026-09-04)

> 수신: Claude Code / Cursor
>
> 범위: 커밋 `0bc0c264` 작업트리, Firestore 실데이터의 **건수·스키마만** 조회, 자동동기 상태 파일과 Vercel Production 설정 확인. 이 문서는 검사 의견이며 코드·시트·Firebase 규칙·Vercel 설정을 고치지 않았다.

## 결론

| 판단 대상 | 판정 | 이유 |
|---|---|---|
| **상품찾기만 Firestore로 읽기** | **조건부 진행 가능** | `products` 1,273건, 원자 게이트 통과, Production의 `NEXT_PUBLIC_FINDER_FROM_FIRESTORE` 설정 존재. 다만 최근 자동동기 실패 때문에 최신성 증명은 아직 부족하다. |
| **ERP 전체를 `NEXT_PUBLIC_DATA_BACKEND=firestore`로 전환** | **NO-GO** | 일반 Store가 읽는 Firestore `product` 컬렉션은 0건인데, 원자는 별도 `products` 컬렉션에만 1,273건 있다. 전환하면 일반 상품 화면은 빈 결과가 된다. |
| **RTDB 삭제** | **NO-GO** | 파이프라인과 서버 API가 여전히 `v4/products`·계약·정산·정책·파트너를 RTDB에서 직접 읽고/쓴다. Firestore는 아직 후행 미러다. |

## 확인한 사실

### 1. 파인더 1단계는 실제로 Firestore 전용 경로를 가진다 — 확인함

- `lib/firebase/firestore-products-client.ts:58`은 Firestore `products`를 `onSnapshot`으로 구독한다.
- `features/finder/finder-data-store.ts:157-171`은 `NEXT_PUBLIC_FINDER_FROM_FIRESTORE=1`이면 그 구독 경로를 선택하고, 실패 시 RTDB 단발 폴백을 둔다.
- Vercel Production 환경에 `NEXT_PUBLIC_FINDER_FROM_FIRESTORE`가 존재하며, Production 배포도 Ready 상태다. 다만 이 값은 빌드 시 주입되는 공개 환경변수이므로 **실제 로그인 세션에서 Firestore 구독이 성공하는지**는 이 점검만으로 확인하지 못했다.
- `firestore.rules:31-35`의 `products`는 로그인 사용자 읽기, 클라이언트 쓰기 금지다. 미러가 private price 필드를 걷는 것도 `scripts/mirror-to-firestore.mts:54-67`에서 확인했다.

### 2. Firestore 원자 데이터 자체 — 확인함(시점 한정)

실데이터 집계 시점:

| 컬렉션 | 건수 |
|---|---:|
| `products` (파인더 원자) | 1,273 |
| `product` (일반 Store 상품) | 0 |
| `contract` | 61 |
| `settlement` | 14 |
| `policy` | 55 |
| `partner` | 42 |
| `customer` | 41 |

`npx tsx scripts/check-atoms.mts` 결과는 1,273건 중 `listable` 746건이며, 칸밀림·빈 식별·색 미분리·상품구분 캐논 이탈·원문 없는 노출이 모두 0건이었다.

### 3. 전체 Store 전환은 현재 빈 상품 화면을 만든다 — 어긋남

- `lib/store.ts:704-709`은 `NEXT_PUBLIC_DATA_BACKEND=firestore`이면 일반 `FirestoreAdapter`를 선택한다.
- 그 어댑터는 `entityKey`를 그대로 Firestore 컬렉션명으로 사용한다(`lib/store.ts:190-194`). 일반 상품 엔티티 키는 `product`(단수)다.
- 실데이터의 `product`는 0건이고, 재고 원자는 `products`(복수)에만 1,273건이다.

따라서 현재 상태에서 전체 스위치를 켜면 파인더 특수 경로 외의 상품 조회는 `product` 0건을 읽는다. `products`를 `product`로 조용히 대체하거나, 반대로 두 컬렉션을 무근거 복제하는 방식은 정본과 권한 모델이 달라 별도 설계·원본 대조가 필요하다.

### 4. RTDB는 아직 정본 겸 파이프라인 writer다 — 어긋남

- `scripts/mirror-to-firestore.mts:87-90`은 먼저 RTDB `v4/products`를 전량 읽고 Firestore로 `merge`한다.
- `scripts/hourly-sync.mts:781`에서 이 미러는 ⑭ 단계다. 즉, 판매시트→ERP(RTDB) 반영 뒤의 후행 단계다.
- 계약·정산·전자계약 API도 `firebaseAdminDatabase().ref('v4/...')`를 직접 사용한다. 예: `app/api/catalog/feed/route.ts`, `app/api/chakhandeal/contracts/*`, `lib/server/freepass-esign.ts`.

Firestore 그림자복사와 FirestoreAdapter는 전환 기반일 뿐, RTDB writer를 제거한 구현은 아니다.

### 5. 최신성 자동화 — 현재 NO-GO

- 마지막 성공 회차는 `tmp/hourly-sync-log.txt`의 **18:20**이며 Firestore 1,273건 미러까지 기록했다.
- 다음 완료 회차인 **19:49**는 ⑥ 상품리스트 발행 실패로 중단되어 ⑭ Firestore 미러까지 도달하지 못했다.
- 점검 시점의 20시 회차는 아직 실행 중이었다. 따라서 Firestore가 공급사 정제·판매시트·ERP와 현재 동일하다고 말할 수 없다.
- ⑭ 미러와 ⑯ 본시트 재발행은 실패해도 경고만 남기는 구조다(`scripts/hourly-sync.mts:820-838`). 상품찾기 최신성이 완료 조건이면, 최소한 상태 파일에 `Firestore 미동기`를 실패로 기록하고 다음 회차에서 재검증해야 한다.

### 6. 규칙·권한 단위테스트 — 확인함(에뮬레이터 한정)

`npm run check:rules`는 21/21 통과했다. 영업자 간 계약 차단, 공급사 간 차단, 정책·파트너 참조 읽기, customer `created_by` 격리, 정산 쓰기 차단을 에뮬레이터에서 확인했다.

그러나 이는 **운영 Firestore 규칙·인덱스가 배포되었음** 또는 **실제 사용자 custom claim이 모두 전파됨**의 증거는 아니다. 규칙 게시와 로그인 역할별 실조회는 별도 게이트로 남는다.

## 클로드에게 권하는 다음 순서

1. 현 Production이 실제로 Firestore 파인더를 읽는지, 관리자·영업자 로그인 각각에서 `products` 구독과 화면 대수를 확인한다.
2. 자동동기 3회 연속 성공을 확인하고, 각 회차마다 판매시트↔RTDB↔Firestore의 차번·상태·요금 대조 결과를 남긴다. 한 회차라도 ⑭ 미러를 건너뛰면 Firestore 최신화 성공으로 세지 않는다.
3. 전체 Store 전환 전에 `product`(일반 업무 엔티티)와 `products`(공개 파인더 원자)의 역할·문서키·권한을 명시적으로 결정한다. 현 `product=0` 상태에서는 플래그 전환 금지다.
4. 파이프라인의 최초 writer를 Firestore로 옮기고, 계약·정산·전자계약의 RTDB 직접 의존을 제거한 뒤에만 RTDB 삭제 계획을 만든다.
5. 운영 Firestore 규칙·인덱스 게시, custom claim 실조회, 역할별 Preview/Production 통합검증, RTDB 백업·복원 리허설을 통과한 뒤 사람 승인으로 스위치한다.

## 검증 이력

- `npx tsc --noEmit` — 통과
- `npx tsx scripts/check-atoms.mts` — 통과 (1,273 / listable 746 / 규격 위반 0)
- `npm run check:rules` — 통과 (Firestore Emulator 21/21)
- Vercel Production 환경·배포 목록 — 읽기 확인만 수행

## 최종 의견

**RTDB 비용의 큰 원인이던 파인더 전량 스트리밍을 Firestore로 분리한 것은 맞다.** 하지만 이는 “재고 파인더 1단계 전환”이며, “ERP가 Firestore로 완전 구동” 또는 “RTDB를 삭제해도 됨”과는 다른 결론이다. 현재 후자 두 가지는 데이터 공백과 운영 기능 장애를 만들 수 있으므로 승인하면 안 된다.
