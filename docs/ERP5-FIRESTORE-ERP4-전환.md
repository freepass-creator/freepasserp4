# ERP4 화이트라벨 → Firebase freepasserp5 Firestore 전환 경계

기준일: 2026-09-14  
범위: ERP4의 화이트라벨 공개 카탈로그(`/shop`, `/uniauto`, `/q/[code]`,
`/api/catalog/feed`, `/api/catalog/quote`)만. 내부 ERP·계약·정산·직원 로그인과 ERP5의
원자 스키마·데이터·Rules는 이 문서의 변경 대상이 아니다.

## 확정 대상

이 범위의 `freepasserp4` 화이트라벨은 Firebase 프로젝트 **`freepasserp5`의 Cloud Firestore**만
소비한다. ERP5 reader가 선택된 요청은 ERP3와 Firebase Realtime Database를 호환 경로나 fallback으로
사용하지 않는다. 기존 내부 ERP 소비자 전환은 별도 작업이며 이번 스위치에 포함하지 않는다.

ERP5 Native Firestore `(default)` 데이터베이스가 `asia-northeast3`에 생성된 사실은 확인했다. 이는
ERP4가 소비할 컬렉션·필드·권한 계약이 이미 준비됐다는 뜻은 아니다.

## 새 연결 경계

`lib/server/erp5-firestore-app.ts`만 ERP5 Admin 앱을 연다.

- 프로젝트 ID는 코드에서 `freepasserp5`로 고정한다.
- 로컬과 운영 모두 `ERP5_FIREBASE_SERVICE_ACCOUNT_JSON`만 사용한다. 그 JSON의 `project_id`가
  `freepasserp5`가 아니면 즉시 실패한다.
- 기존 `FIREBASE_SERVICE_ACCOUNT_JSON`(ERP3)은 ERP5 연결의 대체값으로 쓰지 않는다.
- 이 모듈에는 `firebase-admin/database`, `databaseURL`, RTDB fallback이 없다.

## 클릭 전환 게이트

화이트라벨의 새 소비 경로는 `ERP5_WHITELABEL_FIRESTORE_ENABLED=true`와 ERP5 Firestore
`ops/erp4_whitelabel_cutover` 영수증을 **둘 다** 요구한다. 환경변수만 켜서 데이터가 덜 옮겨진 상태를
정상처럼 서비스하는 일을 막기 위한 이중 kill switch다.

원자 담당은 대사 완료 후 아래처럼 식별정보 없이 영수증을 남긴다. 이 문서의 작성자는 ERP4가
아니며, ERP4는 읽고 검증만 한다.

```json
{
  "status": "READY",
  "targetProject": "freepasserp5",
  "validationRunId": "immutable-audit-id",
  "approvedAt": "ISO-8601 timestamp",
  "inventory": { "sourceCount": 0, "targetCount": 0, "missingCount": 0 }
}
```

`sourceCount`와 `targetCount`는 같고 `missingCount`는 0이어야 한다. 현재 확인된 상품 71건
누락이 해소되기 전에는 영수증을 `READY`로 만들 수 없다.

## 운영 전환 전 HOLD 조건

아래가 모두 원본·실데이터 기준으로 확인되기 전에는 ERP4의 기존 소비 경로를 이 모듈로 바꾸거나
Vercel 환경변수를 바꾸지 않는다.

1. ERP5 Firestore의 실제 상품·정책·공급사·영업자 컬렉션, 문서 ID, 원자 필드가 공개 카탈로그 요구와 대응한다.
2. ERP5 Admin 서비스계정이 위 네 컬렉션을 읽을 수 있고, 공개 API sanitizer가 비공개 필드를 내보내지 않음을 검증한다.
3. `/shop`, `/uniauto`, `/q/[code]`의 목록·상세·담당자 귀속·사진·정책 대표 흐름을 ERP5 데이터로 재현한다.
4. ERP5 reader가 선택된 요청에서 ERP3·RTDB reader/fallback이 없고, 오류 시 503으로 fail-closed함을 확인한다.
5. 프로덕션 전환 대상, 앱 배포 롤백 방식, 사용자 직전 승인을 확보한다.

현재 상품 71건 누락 및 1~4의 실증이 없으므로 상태는 **HOLD**다. 이는 RTDB 복구 권한이나
ERP5 스키마 변경 권한을 뜻하지 않는다.

## 점검 명령

```powershell
npx tsx scripts/check-erp5-firestore-boundary.mts
npm run check:erp5-firestore-cutover
```

이 명령은 ERP5 전용 연결 경계의 정적 계약만 확인한다. `HOLD`가 나오면 운영 전환이 완료되지 않았다는 뜻이다.
