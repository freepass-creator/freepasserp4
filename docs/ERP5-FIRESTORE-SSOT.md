# ERP5 Firebase SSOT와 ERP4 연결

ERP5 Rules는 기본 `.firebaserc`를 사용하지 않는다. 사람 승인 뒤 대상 프로젝트와 전용 config를 모두 명시해서만 배포한다.

```bash
firebase deploy --config firebase.erp5.json --project erp5-3e2fc --only firestore:rules
```

## 이름과 경계

- **ERP4**: 현재 운영 플랫폼 이름이다.
- **ERP3**: 기존 Firebase 프로젝트다. 로그인·채팅·계약 등 유지 운영 데이터만 당분간 남긴다.
- **ERP5**: 상품·차종 원자를 공급하는 독립 Firebase 프로젝트(`erp5-3e2fc`)다.

ERP5 상품은 ERP3/ERP4 `products`를 복사해 만들지 않는다. 공급사 원천 Google Sheets가 상품 행·가격·상태의 주인이고, Google 상품마스터가 같은 `공급사코드 + 차량번호`의 차종·검증 참조다. 차종마스터는 Google Sheet 채택값과 Encar 참조본을 대조해 만든다.

## 데이터 흐름

| 구간 | 원천 | 역할 |
|---|---|---|
| 상품 원자 | 등록 공급사 Sheets 4곳 | 차량 행, 원천 상태, 기간별 대여료, 보증금 숫자/규칙 |
| 상품 참조 | Google `상품마스터_구버전` 고정 gid | 같은 차번의 확정 차종, 표시값, 상태 교차검증 |
| 차종 원자 | Google 차종마스터 + Encar artifact | 계층명, 기본형 투영, 제원, 검증상태 |
| 저장 | ERP5 Firestore 버전 컬렉션 | 검증본 보존 후 활성 포인터 교체 |
| 소비 | ERP4 서버 | ERP3 Auth로 사용자를 확인한 뒤 ERP5 활성 버전 읽기 |

Google Sheets 호출은 모두 GET이다. 발행기는 Google Sheet를 수정하지 않는다.

ERP4의 기존 계약 엔진은 유지기간 동안 ERP3에 락을 기록한다. ERP4 서버는 `locked_by_contract`가 실제로 있는 `계약중/출고불가`만 일시 오버레이하고, 기존 화면 호환용 `status`·`listable`은 그 락에서 파생한다. ERP3의 차명·가격·공급사 원천 상태는 ERP5 원자에 합치지 않으며 이 락도 ERP5에 저장하지 않는다.

## 상품 상태 규칙

ERP5에는 상태를 한 칸으로 뭉개지 않고 다음 네 값을 함께 보존한다.

- `source_status_raw`: 공급사 원문
- `source_status_canonical`: 공급사 원문을 ERP 상태 규격으로 판정한 값
- `google_status_raw`: Google 상품마스터 원문
- `google_status_canonical`: Google 상품마스터 규격값

공급사 상태가 실행 상태의 주인이다. Google 값은 교차검증만 한다.

| 대조 결과 | 원자 저장 | `listable` | 버전 활성화 |
|---|---:|---:|---:|
| 공급사와 Google 상태 일치, Google 차종 확정 | 예 | 판매요건 충족 시 예 | 허용 |
| 상태 충돌 | 예 | 아니오 | 차단 |
| 공급사 상태 공란 | 예 | 아니오 | 차단 |
| Google 행/확정 차종 누락 | 예 | 아니오 | 차단 |
| Google에만 있고 공급사 원천에 없음 | 상품 원자 생성 안 함 | 아니오 | 차단 |
| 양쪽 모두 명시적 출고불가 | 예 | 아니오 | 허용 |

공란 상태를 `출고협의`로 추정하지 않는다. 불일치는 `verification_state`, `verification_reasons`, `listing_reasons`로 남긴다.

## 가격·보증금 규칙

- Google 상품마스터의 숫자 `price`는 ERP5에 복사하지 않는다.
- 공급사 어댑터의 `adapter_pricing.rent`와 `rentVariants`가 가격 정본이다.
- 손오공은 `SONOGONG_RENT_X_YEARS_MAX3`(월대여료 × 약정연수, 최대 ×3)를 저장한다.
- 오토플러스 국산은 `AUTOPLUS_DOMESTIC_X2`, 수입은 `AUTOPLUS_IMPORT_12_X3_18P_X6`를 저장한다.
- ERP4 화면에 기존 `price` 숫자 맵이 필요할 때만 공통 함수가 정책을 계산한다. 정책 원자는 숫자로 대체하지 않는다.

## 차종마스터 규칙

- Google 채택명과 Encar 참조를 각각 증거로 보존한다.
- 세부트림 공란은 ERP5 발행명에서만 `기본형`으로 투영한다.
- 모델과 세부모델이 같으면 발행 세부모델만 `기본형`으로 투영하고 Google 원문은 남긴다.
- `G80 RG3` 기본형, 손오공, 오토플러스 보증금 규칙은 회귀검사에 포함한다.
- FL 표기, 기아 세대명 미변환, Encar 근거 부족, 검토 충돌은 활성화 blocker다.
- 차종마스터 명칭·키·매핑 내용은 이 발행 경로에서 수정하지 않는다.

## Firestore 경로

| 역할 | 경로 |
|---|---|
| 상품 버전 | `productMasterVersions/{versionId}` |
| 상품 문서 | `productMasterVersions/{versionId}/products/{partnerCode_plate}` |
| 활성 상품 포인터 | `ssotState/products` |
| 차종 버전 | `vehicleMasterVersions/{versionId}` |
| 차종 문서 | `vehicleMasterVersions/{versionId}/entries/{stableId}` |
| 활성 차종 포인터 | `ssotState/vehicleMaster` |
| 상품·차종 결합 release | `ssotReleases/{releaseId}` |

상품 문서는 `vehicle_master_entry_id`와 버전 메타데이터의 `vehicleMasterVersionId`로 차종 원자를 가리킨다. 상품과 차종은 따로 활성화하지 않고, 전체 문서 해시를 검증한 동일 release에서 두 포인터를 한 트랜잭션으로 교체한다.

클라이언트 쓰기는 전부 금지한다. 독립 규칙은 `firebase.erp5.json`과 `firestore.erp5.rules`에만 둔다. 규칙 배포는 운영 권한 검증과 사람 승인 후 별도로 실행하며 게시 워크플로가 자동 배포하지 않는다.

## 자격증명

- `GOOGLE_SA_JSON`: 공급사·상품마스터·차종마스터 Sheets 조회 전용
- `ERP5_FIREBASE_WRITER_SERVICE_ACCOUNT_JSON`: `erp5-3e2fc` draft 쓰기·release 승격 전용
- `ERP5_FIREBASE_READER_SERVICE_ACCOUNT_JSON`: ERP4 런타임의 ERP5 읽기 전용
- `ERP5_FIREBASE_PROJECT_ID`: 선택값, 기본 `erp5-3e2fc`
- `ERP5_CUTOVER_STATE`: `precutover`(기본 유지), `complete`(ERP5), `rollback-approved`(명시 승인 롤백)

Google 조회 자격증명과 ERP5 writer의 `project_id`가 같으면 발행을 중단한다. ERP5 writer와 reader는 분리한다. 서비스계정은 코드로 만들거나 추정할 수 없고 Firebase에서 발급한 실제 계정이어야 한다.

## ERP4 절체 규칙

ERP5 초안 저장과 ERP4 상품 절체는 분리한다. Google 상품마스터 최종 반영 전이나 ERP5 활성 포인터가 없는 동안에는 `ERP5_CUTOVER_STATE=precutover`로 두고 ERP4가 기존 ERP3 상품 유지본을 읽게 한다.

다음 조건을 모두 충족한 뒤 ERP4 서버에 `ERP5_CUTOVER_STATE=complete`를 설정한다. 절체 후 ERP3로 되돌릴 때는 일반 boolean을 끄지 말고 별도 승인 후에만 `rollback-approved`를 사용한다.

1. ERP5 서비스계정이 배포 환경에 설치되어 있다.
2. 상품·차종 draft가 실제 `erp5-3e2fc`에 저장되었다.
3. 원천·Google·Encar 대조 blocker가 0이고 차종 계층키가 모두 존재한다.
4. 두 draft의 전체 SHA-256 read-back이 일치한다.
5. 동일 draft를 `promote-erp5-release.mts`로 승격했다.
6. 상품·차종 활성 포인터와 `ssotReleases`를 재조회해 같은 release인지 확인했다.

스위치가 켜진 뒤 상품 읽기가 실패하면 ERP4는 `503`을 반환하며 ERP3 상품으로 자동 복귀하지 않는다. ERP3에서 합치는 값은 유지기간의 실제 계약 락(`locked_by_contract`, `계약중/출고불가`)뿐이다. 화면용 상태 별칭은 이 락에서만 파생한다. 스위치를 끄는 것은 운영자가 판단하는 명시적 롤백이며, 애플리케이션 내부의 묵시적 폴백이 아니다.

## 실행 순서

```bash
node --import tsx scripts/check-erp5-boundary.mts
node --import tsx scripts/sim-erp5-product-ssot.mts
node --import tsx scripts/sim-erp5-vehicle-master-ssot.mts

# 읽기·대조만
node --import tsx scripts/publish-products-to-erp5-firestore.mts --version=review-products-YYYYMMDD --vehicle-version=review-vehicle-YYYYMMDD
node --import tsx scripts/publish-vehicle-master-to-erp5-firestore.mts --version=review-vehicle-YYYYMMDD --encar=tmp/vehicle-master/dist/vehicle-master.flat.json

# ERP5 draft 저장
node --import tsx scripts/publish-vehicle-master-to-erp5-firestore.mts --version=review-vehicle-YYYYMMDD --encar=tmp/vehicle-master/dist/vehicle-master.flat.json --apply
node --import tsx scripts/publish-products-to-erp5-firestore.mts --version=review-products-YYYYMMDD --vehicle-version=review-vehicle-YYYYMMDD --apply

# blocker 0과 전체 해시를 사람이 확인한 동일 draft만 승격
node --import tsx scripts/promote-erp5-release.mts \
  --products=review-products-YYYYMMDD \
  --vehicle=review-vehicle-YYYYMMDD \
  --release=release-YYYYMMDD
```

발행기의 `--activate`는 금지되어 있다. 새 원천을 다시 읽어 곧바로 활성화하지 않는다.

## 2026-09-14 실제 데이터 확인 결과

- Google 차종마스터 1,668행과 Encar 참조 6,350행을 대조했다.
- 기존 검증기는 53건을 막았고, 그중 카니발 13행은 Google 최종 `종합판정=확정`을 읽지 않던 코드 오류였다. 최종 판정을 우선하도록 수정했다.
- 현재 Google 차종마스터에는 계층키 열이 없어 `modelKey/subModelKey/trimKey/atomKey`가 공란이다. 값을 임의 생성하지 않고 활성화 blocker로 처리한다.
- 라이브 Google 값에는 `G80 RG3 / 기본형`이 없고 `G80 RG3 / 블랙`만 있다. 테스트의 기본형은 실데이터 증거가 아니므로 Google 최종 반영 전에는 RG3 기본형을 확정으로 주장하지 않는다.
- 독립 ERP5 쓰기 성공 기록은 아직 없다. 과거 성공한 상품 1,538대·차종 1,668행 draft는 `freepasserp3`에 작성된 구 설계 결과이며 ERP5 활성본이 아니다.

ERP3에 과거 잘못 작성된 `productMasterVersions`/`vehicleMasterVersions` draft는 ERP5 활성 포인터가 아니며 이 경로에서 읽지 않는다. 삭제는 별도 승인 전까지 하지 않는다.
