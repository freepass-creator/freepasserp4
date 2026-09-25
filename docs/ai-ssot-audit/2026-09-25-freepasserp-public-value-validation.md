# FreePassERP.com — 공개 상품 값 검증

- 점검일: 2026-09-25 (KST)
- 저장소: `freepass-creator/freepasserp4` (기술 저장소명 유지)
- 작업 브랜치: `chatgpt/freepasserp-shadow-nonblocking-20260925`
- 점검 기준 HEAD: `52c26da1bcb81ab6cef4b27319f7a699ec2bfd9b`
- 범위: 공통 화이트라벨의 공개 데이터 Consumer 검증. F01/F86 운영·동기화, 원천 데이터, 계약·정산, 디자인 변경은 제외.

## 1. 실제 재현한 결함

기준 HEAD의 `freepass-catalog-contract.ts`를 읽고 Git blob SHA
`ce8218756aa4e322d90346eb3d3d8b2f046e4af6`와 일치하는 소스로 로컬에서 재현했다.

| 반례 | 기존 결과 | 수정 후 결과 |
|---|---|---|
| 정상 12개월 요금 + 음수 36개월 요금 | 빈 오류 목록 | `invalid-price` |
| `rent: true` | `Number(true)` 때문에 정상 취급 | `invalid-price` |
| 61개월 요금 | 정상 취급 | `invalid-term` |
| 음수 보증금 | 정상 취급 | `invalid-deposit` |
| `null` 상품 | 검사기가 예외를 던짐 | `invalid-product` |

기존 검사는 유효 요금이 한 행만 있으면 다른 행의 오류를 놓쳤다.
타입 이름과 `as` 단언은 런타임 검증이 아니므로 외부 입력은 `unknown`으로 검사한다.

## 2. 변경

- 모든 요금행을 검사한다. 월 대여료는 유한한 양수 number, 보증금은 유한한 0 이상 number만 유효하다.
- `true`, `null`, 숫자 문자열을 정상 숫자로 강제 변환하지 않는다.
- 기간은 정수 1~60개월. 기존 `24_3만`, `36_20000` 등 주행거리별 키의 의미는 바꾸지 않는다.
- 명시된 주행거리가 음수·무한대·비수치이면 기록한다. 미제공 정보로 검색을 막지 않는다.
- 실제 이미지 URL의 형식만 검사한다. http/https와 동일 오리진 상대경로는 허용하고 실행 스킴, 잘못된 주소, 인증정보 포함 URL은 기록한다.
- `photo_link`는 폴더/원천 목록일 수 있으므로 단일 이미지 URL로 간주하지 않는다.
- 동일 오류가 여러 기간/이미지에서 발생해도 상품당 한 번 집계한다.
- 기존 4개 오류 코드는 유지하고 신규 코드만 추가했다. 공개 응답 Contract version `1.0`은 변경하지 않았다.
- 검사 결과는 관측용이다. 상품 제외, 금액 보정, 원천 write, 활성 reader 전환은 없다.

기존 `guest-listing.ts`의 응답 후 관측 경로가 같은 검사 함수를 호출하므로 신규 검사가 그 경로에 적용된다.
`check-freepass-catalog-boundary.mts`에서 새 오프라인 회귀검사를 import하도록 연결했다.
기존 `npm run check:whitelabel` 명령에 포함되며 새로운 예약 작업은 만들지 않았다.

## 3. 검증 — 실행한 범위

| 검증 | 결과 |
|---|---|
| 원본 계약 파일 Git blob SHA 대조 | PASS |
| 원본 경계 검사 파일 SHA `9765ede990b960452fbd0e03be2656cde4a78d20` 대조 | PASS |
| 위 5개 기존 결함 재현 | 재현 확인 |
| `sim-freepass-catalog-contract.mts`의 90개 정상/반례 사례 | PASS |
| ID fallback, 입력 불변성, 오류 집계 추가 assertion | PASS |
| 계약 모듈 + 신규 sim + 경계 검사 스크립트의 isolated strict TypeScript 컴파일 | PASS (TypeScript 5.8.3, NodeNext, ES2022) |
| 공개 타입의 내부 필드 접근 금지 / open string index 금지 컴파일 반례 | PASS |
| 로컬 변경 diff 공백 검사 | PASS |

실제 실행한 로컬 명령:

```sh
tsc --strict --target ES2022 --module NodeNext --moduleResolution NodeNext \
  --skipLibCheck --outDir build scripts/check-freepass-catalog-boundary.mts \
  scripts/sim-freepass-catalog-contract.mts
node build/scripts/sim-freepass-catalog-contract.mjs
git diff --check
```

출력: `PASS 90 contract cases + identity/immutability/summary assertions`

위 명령은 필요한 파일만 검증한 격리 환경이다. 전체 저장소 빌드나 전체 `check:whitelabel` 통과로 해석하면 안 된다.
설치된 저장소에서는 `npx tsx scripts/sim-freepass-catalog-contract.mts`로 직접 실행할 수 있다.

## 4. 배포/운영 판정: HOLD

- 기준 HEAD의 GitHub Vercel commit status는 `failure`였다. 이전 대화의 `pending` 상태를 완료 상태로 다시 확인했다.
- 연결된 Vercel 도구의 배포 로그 요청은 `Deployment not found`(404)로 응답했다. 따라서 그 배포의 실패 원인은 확인하지 못했다.
- 로컬에서는 GitHub 호스트를 DNS 해석하지 못해 저장소 전체 clone 및 의존성 설치를 하지 못했다.
- 전체 Next.js 빌드, 전체 TypeScript 검사, 전체 화이트라벨 검사, 브라우저 화면 검증, 실데이터 parity는 이번에 완료하지 않았다.
- 기존 20개 커밋에 대한 전면 검증도 별도로 필요하다. 특히 좁은 공개 타입과 여전히 넓은 Query/initial 타입 사이의 전달 경계를 확인해야 한다.
- main 병합, production 배포, 데이터 공급원 전환은 하지 않는다. Draft PR에 검증 범위와 미확인 사항을 남긴다.

## 5. 원천 계약에 남길 사항

이 검사는 공개 Adapter를 지난 값을 관측한다. Adapter 앞에서 이미 0으로 바뀌거나 누락된 원천 값은 복원해서 판별할 수 없다.
예컨대 원천 보증금 누락과 확정 0원은 공급 계약에서 구분해 내려와야 한다. 이번 변경은 기존 보정 로직을 정당화하거나 확장하지 않는다.
연식 표현·상태 enum·schema version/freshness·release hash·필드별 값 타입의 완전 검증은 공급 측 규격과 실제 자료에 맞춰 추가할 별도 항목이다.
이 결과를 `PARITY_VERIFIED`나 실재고 무결성 증명으로 사용하지 않는다.

## 6. 후속 실제 CI에서 확인한 공개 타입 연결 오류

앞 절의 격리 검증 이후 Draft PR #496을 생성하여 실제 GitHub Actions 전체 검사를 실행했다.
CI run `36117548023`, job `108015079108`에서 의존성 설치는 통과했지만 Typecheck가 실패했다.
실제 로그는 `ShopView.tsx` 443/886/887행과 `shop/page.tsx` 117행의 오류 4건을 보고했다.
공개 타입을 좁힌 이전 변경과 달리 Query 결과 및 서버 initial이 `EntityRecord[]`로 남아
필수 `_key`, `product_code`, `price`를 보장하지 못하는 연결 오류다.

- `ShopResult<T>` 및 `runShopQuery<T>`가 입력 행의 타입을 그대로 반환하도록 변경했다.
- 기본 `ShopResult`는 공개 상품 타입이다. 기존의 넓은 내부/테스트 입력은 추론된 타입을 유지하며 공개 타입으로 승격시키지 않는다.
- 정렬용 `Ranked`/`rankRows`도 `T`를 유지한다. 강제 형변환이나 공개 필수 필드 완화는 없다.
- 서버 initial 타입을 `FreepassCatalogProduct[]`로 맞췄다.
- `tests/freepass-catalog-query.types.ts`에 공개/원시/확장 타입 보존과 반례를 추가했다. 기존 전체 Typecheck에 포함된다.
- 수정 전 원본 Query/SSR 파일은 Git blob SHA `b519d0ebd8c09ba04b90ee7ec55029d1336ddd14` / `5ef0415e7a2f00bffe899c42e132b669f6804bea`와 일치함을 확인했다.
- 두 파일의 타입 제거 후 JavaScript를 수정 전후 비교하여 완전히 동일함을 확인했다(PASS). 검색/필터/정렬/초기 화면의 실행 로직과 기존 업무 이력은 유지했다.
- 기존 90개 계약 사례를 다시 실행해 PASS를 확인했다. `git diff --check`도 PASS다.

전체 CI가 실패 단계 이후의 디자인/화이트라벨/Production build 검사를 건너뛰었으므로
그 검사들이 통과했다는 뜻이 아니다. 이 후속 수정의 CI 재실행 결과는 PR에 별도 기록하며,
독립 검증과 전체 게이트 완료 전까지 Draft/HOLD를 유지한다.


## 7. 원천 Contract와 Adapter 오류 분리

공개 상품만 검사하면 Adapter가 원천 오류를 정상값처럼 보이게 만든 경우를 구분할 수 없다.
이를 위해 `diffFreepassCatalogIssues(input, published)`를 추가하고 실제 `guest-listing` 경로에서
각 공개 상품마다 원천 입력과 Adapter 출력의 오류를 비교 집계한다.

- `inputIssues`: FreePass Data/Consumer Contract 쪽에서 해결해야 할 입력 이상.
- `publishedIssues`: 공개 경계까지 남아 실제 White Label에 영향을 줄 수 있는 이상.
- `maskedByAdapter`: 입력 이상이 현재 호환 보정 때문에 공개면에서는 사라진 경우. 호환부채로 기록하며 원천 수정 없이 영구 허용하지 않는다.
- `introducedByAdapter`: 입력에는 없었는데 Adapter 이후 생긴 이상. FreePassERP.com 구현 회귀로 분류한다.

이 집계는 `after()`에서 로그만 남기며 응답 차단·상품 제외·원천 write·값 추정을 하지 않는다.
특정 개별 화이트라벨 채널의 운영/동기화도 건드리지 않는다.

## 8. 2026-09-25 후속 CI 및 검사기 오탐 수정

CI run `36127820529`에서 다음 단계가 모두 PASS했다:
Typecheck, 폰트/디자인 토큰, 상품찾기 격자, 확정 디자인, Stability Lock, 보증금, 건물도면,
UI 계약, 검색/필터 성능, 브랜드, 워크플로, ERP5 Firebase 경계, RTDB 경계, 견적 회귀,
웹·모바일 공통 feed, guest surface/fields, 옵션 파서, 공급사 울타리.

`check:whitelabel`의 기존 구조검사는 모두 PASS했지만 신규 공개 Contract guard가
함수 인자 `source: unknown`를 공개 상품 필드 `source`로 오인해 실패했다.
금지 필드 검사는 이제 전체 파일 문자열이 아니라 `FreepassCatalogProduct` 타입 본문만 검사한다.
보호 강도는 낮추지 않았으며 `vehicle_price`, `fee`, `commission`, `account_number`,
`provider_company_code`, `partner_code`, `source` 공개를 계속 차단한다.

별도 전수 스캔에서 `app/(shop)`, `components/shop`, `lib/shop`의 실행 코드에는
Firebase/Firestore/RTDB 직접 의존과 ERP4 런타임 의존이 0건으로 확인됐다.
