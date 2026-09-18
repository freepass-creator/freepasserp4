# ERP5 Canonical SSOT

`freepasserp5`는 상품·공급사 조건·가격/대여료·보증금·재고/판매상태·차종마스터 등 ERP5 원자의 **유일한 canonical DB**다. `freepasserp4`는 UI/운영 플랫폼이며 canonical 원자를 소비한다.

## 확정 원칙

1. `freepasserp5`만 canonical 원자를 생성·갱신한다.
2. `freepasserp4` Firestore, 로컬 JSON, 판매시트, 공개 카탈로그는 ERP5의 상위 원천이 아니다.
3. ERP4 UI에서 canonical 값을 변경해야 하는 기능이 생기면 `ERP4 UI -> ERP5 write API -> freepasserp5` 경로로만 구현한다.
4. ERP4의 `products` 컬렉션이나 로컬 파일을 ERP5 active pointer로 승격하는 역방향 게시를 production에서 금지한다.
5. 판매시트·공개 카탈로그·ERP4 화면은 한 회차에 고정된 ERP5 snapshot을 소비한다.
6. 공급사 원문과 파싱 근거는 보존하되, 파생 산출물을 별도 SSOT로 취급하지 않는다.

## 운영 데이터 흐름

```text
[공급사 원천]
     |
     v
[Parser / Adapter / Normalizer]
     |
     v
[freepasserp5 canonical atoms]
     |
     v
[Versioned / fixed snapshot]
     |----> freepasserp4 UI/운영
     |----> 판매 Sheet
     |----> 고객/화이트라벨 공개 Catalog
     `----> 기타 소비 API/App
```

화살표가 ERP4/판매시트/공개 카탈로그에서 ERP5 canonical 쪽으로 역류하면 안 된다.

## 현재 production writer

`.github/workflows/erp5-ssot-refresh.yml`이 검증된 ERP5 writer다.

- GitHub OIDC로 `github-inventory-writer@freepasserp5.iam.gserviceaccount.com`을 사용한다.
- `GOOGLE_CLOUD_PROJECT=freepasserp5`를 명시한다.
- `scripts/ingest-all-suppliers.mts`가 공급사 원천을 ERP5 원자로 계산한다.
- 정책 참조 정합화 후 `scripts/capture-sales-publish-snapshot.mts`로 한 회차 snapshot을 고정한다.
- 같은 snapshot으로 공개 카탈로그 대사와 판매시트 발행을 수행한다.

현재 운영 workflow는 검증된 엔진 커밋에 고정되어 있다. 이 고정은 운영 안정성을 위한 임시 안전장치이며, main과의 차이는 별도 검증 후 단계적으로 해소한다. 검증 없이 ref를 main으로 바꾸지 않는다.

## ERP4의 역할

ERP4는 다음만 수행한다.

- ERP5 canonical 원자 조회
- 영업/운영 UI 제공
- 접수·계약·운영 등 ERP4 고유 업무 데이터 관리
- canonical 수정이 필요한 경우 ERP5 전용 write boundary를 호출

ERP4 고유 업무 데이터와 ERP5 상품 원자는 논리적으로 분리한다. 계약·상담·사용자·정산 같은 ERP4 업무 데이터를 ERP5 상품 원자에 섞지 않는다.

## 차종마스터

차종마스터도 ERP5 canonical 소유다.

- Encar/제조사/Google Sheet/기타 참조 데이터는 evidence 또는 입력 근거다.
- `public/data/vehicle-master.json` 같은 파일은 사람이 독립적으로 관리하는 원천이 되어서는 안 된다.
- JSON이 필요하면 ERP5 canonical vehicle master에서 생성되는 파생 산출물로 취급한다.
- 괄호 제거 등 Freepass 표준화 규칙은 canonical 생성 단계에서 적용하고 원문 근거는 evidence로 남긴다.

## 레거시 migration 도구

다음 스크립트는 과거 동일-Firebase 설계에서 만들어진 레거시 migration 도구다.

- `scripts/publish-products-to-erp5-firestore.mts`
- `scripts/publish-vehicle-master-to-erp5-firestore.mts`

이 스크립트들은 production writer가 아니다. GitHub Actions에서 자동/수동 게시 경로로 호출하지 않는다. 향후 완전 제거 전까지 과거 데이터 분석·migration 참고용으로만 남긴다.

## CI 경계

`npm run check:erp5-firebase`는 파일명 호환성을 위해 기존 이름을 유지하지만 실제 의미는 **ERP5 canonical boundary 검사**다.

검사는 최소 다음을 강제한다.

- production refresh workflow가 `freepasserp5`를 명시하는지
- OIDC writer가 `freepasserp5` 서비스계정인지
- ERP4 Firebase 자격증명을 canonical writer로 사용하지 않는지
- 레거시 workflow가 ERP4 -> ERP5 역방향 writer를 호출하지 않는지
- 문서가 동일-Firebase 전제를 다시 도입하지 않는지

## 소비처와 갱신 계약

상품 원자 기준 소비처는 다음 한 방향만 허용한다.

| 소비처 | ERP5를 읽는 방법 | 갱신 계약 |
|---|---|---|
| F01 판매시트 | 고정 ERP5 snapshot 발행 | canonical refresh 한 회차 안에서 발행 |
| F86 하허호 | F01과 같은 고정 ERP5 snapshot 발행 | canonical refresh 한 회차 안에서 발행 |
| 손님/화이트라벨 | 서버가 `freepasserp5/products` 직접 조회 | 서버 공용 캐시 최대 60초 + 열린 목록 45초 폴링/포커스 복귀 |
| ERP5/상품찾기 Finder | 인증은 ERP4, 상품 값은 `GET /api/products` → ERP5 | 30초 폴링 + 포커스/탭 복귀, 서버 ERP5 캐시 최대 60초 |
| 내부 상품상세 `/m/[code]` | 인증 `GET /api/products?code=...` → ERP5 | 60초 재확인 + 포커스/탭 복귀 |
| Finder 시트 상세링크 매핑 | F01 + ERP5 products/partners | 요청 시 canonical ERP5 대조 |
| 영업자 내부정보 | ERP5 product/policy/partner | 요청 시 canonical ERP5 대조 |
| 읽기전용 관제 재고 | ERP5 product/partner | 요청 시 canonical ERP5 대조 |

중요한 구분:

- **downstream 반영 속도**와 **upstream 원천수집 주기**는 다르다. ERP5 Atom이 갱신된 뒤 웹/Finder가 따라오는 시간은 대체로 1~2분 이내지만, 공급사 원천 → ERP5 수집 자체가 시간당이면 그보다 더 신선해질 수 없다.
- 소비처 장애 시 ERP4/RTDB/판매시트 값을 ERP5 대체 정본처럼 자동 폴백하지 않는다. 마지막 정상 화면을 유지하거나 오류를 드러내고 재시도한다.
- `/inventory` 편집 화면은 **별도 HOLD**다. 현재 읽기/쓰기가 ERP4 Store에 함께 묶여 있어 읽기만 ERP5로 바꾸면 저장은 다른 DB로 가는 더 위험한 반쪽 전환이 된다. ERP5 write API/권한/감사로그 경계를 만든 뒤 읽기·쓰기를 함께 전환한다.
- 차종마스터는 별도의 ERP5 version/pointer 계약을 따른다. 상품 원자 소비 경로와 섞지 않는다.

## Firebase 프로젝트 배포 경계

루트 `.firebaserc` / `firebase.json`은 **ERP5 canonical writer 설정이 아니다.**

- `firebase.json`은 RTDB·Firestore·Storage 규칙을 함께 담고 있으므로 루트의 generic `firebase deploy` 기본 타깃을 `freepasserp5`로 두지 않는다.
- `freepasserp5` canonical 쓰기는 검증된 production workflow의 OIDC 서비스계정과 `GOOGLE_CLOUD_PROJECT=freepasserp5` 경계로만 지정한다.
- `npm run check:erp5-firebase`는 `.firebaserc`의 default가 `freepasserp5`로 바뀌면 실패한다. 즉 누가 편의상 ERP5를 루트 기본 프로젝트로 바꿔도 CI가 canonical Rules 오배포 위험을 차단한다.
- 별도 배포가 필요하면 목적별 명시적 project/config를 사용하고, canonical 원자 writer와 일반 Firebase Rules 배포를 같은 암묵적 default에 의존시키지 않는다.

## 변경 원칙

새로운 상품/가격/보증금/공급사/차종 기능을 만들 때 먼저 다음 질문에 답한다.

1. 이 값의 canonical owner는 어디인가?
2. writer는 하나인가?
3. ERP4/시트/JSON이 원천처럼 행동하지 않는가?
4. 같은 ERP5 snapshot에서 모든 소비면이 파생되는가?
5. 원문 evidence와 canonical normalized value가 구분되는가?

답이 하나로 정리되지 않으면 SSOT 변경으로 승인하지 않는다.
