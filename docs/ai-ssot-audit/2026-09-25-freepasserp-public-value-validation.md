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
