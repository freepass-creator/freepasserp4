# ERP5 Firestore SSOT 복원·연결

ERP4는 계속 운영한다. ERP5는 별도 Firebase 프로젝트가 아니라 **ERP4가 쓰는 같은 Firebase 프로젝트 안의 버전 컬렉션**으로 상품과 차종마스터만 단방향 게시한다. 계약·상담·사용자·정산 데이터는 이 경로로 보내지 않는다.

## 데이터 흐름

1. 공급사 원천을 어댑터로 읽어 가격축을 보존한다. **기본은 제공시트·정제시트 표준 열**(`ProvidedSheetAdapter`). 전용 어댑터는 열이 표준이 아닌 두 탭뿐이다 — 오토플러스 정제시트 「재고」(`12개월2만` 기간×주행) · 손오공 제공시트 「구독재고」(`N개월 반납형` + 연수×대여료 보증금). 손오공 「재고」는 표준 제공시트다. 문패가 가리키는 시트를 읽는다. 이안카·아이카 외부 원본은 읽지 않는다.
2. ERP4 Firestore `products`의 현재 상품 원자를 공개 필드 allowlist로 복사한다.
3. Google Sheet `차종마스터`의 채택명과 Encar 참조본을 대조한다.
4. 같은 Firestore의 ERP5 전용 버전 경로에 새 버전을 만든다.
5. 쓰기 수량과 blocker를 검증한 뒤 활성 포인터만 교체한다.

ERP4 원본 컬렉션은 삭제하거나 덮어쓰지 않는다. 프로젝트는 하나지만 원본 경로와 ERP5 버전 경로는 분리한다.

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

`firestore.rules` 하나가 ERP4 운영 경계와 ERP5 SSOT 읽기 경계를 함께 가진다. 역할 클레임은 `admin`, `agent`, `whitelabel` 세 값만 허용한다.

- 클라이언트 쓰기는 모든 경로에서 금지한다.
- 관리자는 검증 버전과 활성 버전을 읽을 수 있다.
- 영업자와 화이트라벨은 `ssotState/*`가 가리키는 활성 버전만 읽을 수 있다.
- 기존 ERP4 컬렉션의 접근 규칙은 그대로 유지한다.

규칙 배포는 기존 ERP4 규칙까지 함께 갱신하므로 수동 검증과 승인 후에만 실행한다. 배포 대상 프로젝트 ID도 공용 자격증명에서 읽는다.

```bash
PROJECT_ID="$(node -e "const a=require('./tmp/firebase-auth/sa.json'); process.stdout.write(a.project_id)")"
GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json \
  npx firebase-tools deploy --project "$PROJECT_ID" --config firebase.json --only firestore:rules
```

## 실행

GitHub Actions의 `ERP5 Firestore 상품·차종 SSOT 게시`를 수동 실행한다.

필수 Repository secrets:

- `GOOGLE_SA_JSON`: 공용 Firebase 읽기·ERP5 버전 경로 쓰기 및 Google Sheets 읽기용

별도 ERP5 서비스계정이나 대상 프로젝트 ID는 사용하지 않는다. 자격증명의 `project_id`가 읽기와 쓰기의 단일 대상이다. 필요하면 `ERP_FIREBASE_PROJECT_ID` 또는 기존 `ERP4_FIREBASE_PROJECT_ID`로 기대 프로젝트를 고정하고, 자격증명이 다르면 즉시 중단한다.

차종마스터 Google Sheet는 같은 서비스계정의 Workspace 도메인 위임으로 읽는다. 조직에 승인된 `spreadsheets` 범위를 사용하지만 발행기 코드는 조회 API만 호출하고 시트 쓰기는 수행하지 않는다.

첫 실행은 `apply=false`로 검사한다. 이후 `apply=true`로 검증 버전만 저장하고, 결과를 확인한 뒤 상품과 차종마스터 활성화를 각각 켠다. 규칙 배포는 이 발행 워크플로에 넣지 않는다. ERP5 SSOT 클라이언트 읽기가 필요할 때만 기존 ERP4 규칙까지 실데이터로 검증·승인한 뒤 위의 Firebase CLI 명령을 별도로 실행한다. 차종마스터는 blocker가 한 건이라도 있으면 활성화할 수 없다.

로컬 명령:

```bash
npm run sim:erp5-product-ssot
npm run sim:erp5-vehicle-master-ssot
npm run publish:erp5-products -- --version=review-YYYYMMDD
npm run publish:erp5-vehicle-master -- --version=review-YYYYMMDD --encar=tmp/vehicle-master/dist/vehicle-master.flat.json
```

실제 쓰기에는 `--apply`, 활성 포인터 교체에는 `--apply --activate`를 추가한다.
