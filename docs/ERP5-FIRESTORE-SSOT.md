# ERP5 Firestore SSOT 복원·연결

ERP4는 계속 운영하고, ERP5에는 상품과 차종마스터만 단방향으로 게시한다. 계약·상담·사용자·정산 데이터는 이 경로로 보내지 않는다.

## 데이터 흐름

1. 공급사 원천을 전용 어댑터로 읽어 가격축을 보존한다.
2. ERP4 Firestore `products`의 현재 상품 원자를 공개 필드 allowlist로 복사한다.
3. Google Sheet `차종마스터`의 채택명과 Encar 참조본을 대조한다.
4. ERP5 Firestore에 새 버전을 만든다.
5. 쓰기 수량과 blocker를 검증한 뒤 활성 포인터만 교체한다.

ERP4 원본과 ERP5의 기존 컬렉션은 삭제하거나 덮어쓰지 않는다.

## Firestore 경로

| 역할 | 경로 |
|---|---|
| 상품 버전 | `productMasterVersions/{versionId}` |
| 상품 문서 | `productMasterVersions/{versionId}/products/{erp4ProductId}` |
| 활성 상품 포인터 | `ssotState/products` |
| 차종 버전 | `vehicleMasterVersions/{versionId}` |
| 차종 문서 | `vehicleMasterVersions/{versionId}/entries/{stableId}` |
| 활성 차종 포인터 | `ssotState/vehicleMaster` |

소비 앱은 버전 컬렉션을 임의로 고르지 않고 `ssotState/*`의 `activeVersionId`를 먼저 읽는다.

## 보존 규칙

- 상품명·차명·금액은 ERP4 확정값을 바꾸지 않는다.
- 수수료·커미션·차대번호·계약·상담·고객·전화·이메일·주소·계좌 필드는 내보내지 않는다.
- 오토플러스는 `termMonths × annualKm` 가격축과 `depositPolicy` 규칙 원자를 보존한다. 제조사가 없으면 국산 규칙을 추정하지 않는다.
- 손오공은 `termMonths` 가격축과 `SONOGONG_RENT_X_YEARS_MAX3` 정책 원자(월 대여료 × 연수, 최대 ×3)를 보존한다.
- 차종 계층은 `원산지 → 제조사 → 모델 → 세부모델 → 세부트림`이다.
- 연료·배기량·구동·인승·배터리는 계층명이 아니라 `facts.variants`에 둔다.
- 세부트림이 비어 있으면 ERP5 투영에서만 `기본형`으로 채우고, `trimDefaulted: true`를 남긴다.
- 모델과 세부모델이 같으면 ERP5 발행명만 `기본형`으로 투영하고 Google Sheet 원문은 `evidence.googleSheet.sourceNames`에 남긴다.
- 괄호는 F03 규칙대로 제거해 발행하고, FL 표기·기아 N세대 미변환·Encar 근거 부족·상충 검토는 활성화 blocker다.

## ERP5 접근 규칙

`firestore.erp5.rules`는 ERP4 규칙과 분리되어 있다. 역할 클레임은 `admin`, `agent`, `whitelabel` 세 값만 허용한다.

- 클라이언트 쓰기는 모든 경로에서 금지한다.
- 관리자는 검증 버전과 활성 버전을 읽을 수 있다.
- 영업자와 화이트라벨은 `ssotState/*`가 가리키는 활성 버전만 읽을 수 있다.
- 그 밖의 컬렉션은 읽기와 쓰기를 모두 거부한다.

대상 자격증명이 준비된 뒤 ERP5 프로젝트에만 다음 규칙을 배포한다.

```bash
GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/erp5-sa.json \
  npx firebase-tools deploy --project erp5-3e2fc --config firebase.erp5.json --only firestore:rules
```

## 실행

GitHub Actions의 `ERP5 Firestore 상품·차종 SSOT 게시`를 수동 실행한다.

필수 Repository secrets:

- `GOOGLE_SA_JSON`: 현재 ERP4 Firestore 및 Google Sheets 읽기용
- `ERP5_FIREBASE_SERVICE_ACCOUNT_JSON`: 대상 ERP5 프로젝트 쓰기용

대상 프로젝트 기본값은 `erp5-3e2fc`이며, 자격증명의 `project_id`가 다르면 즉시 중단한다.

첫 실행은 `apply=false`로 검사한다. 대상 규칙이 없으면 `deploy_rules=true`로 전용 규칙을 먼저 배포한다. 이후 `apply=true`로 검증 버전만 저장하고, 결과를 확인한 뒤 상품과 차종마스터 활성화를 각각 켠다. 차종마스터는 blocker가 한 건이라도 있으면 활성화할 수 없다.

로컬 명령:

```bash
npm run sim:erp5-product-ssot
npm run sim:erp5-vehicle-master-ssot
npm run publish:erp5-products -- --version=review-YYYYMMDD
npm run publish:erp5-vehicle-master -- --version=review-YYYYMMDD --encar=tmp/vehicle-master/dist/vehicle-master.flat.json
```

실제 쓰기에는 `--apply`, 활성 포인터 교체에는 `--apply --activate`를 추가한다.
