# 파일 저장·Google Drive 백업 운영 문서

## 결정

- Firebase Storage가 서비스 원본이다.
- Realtime Database에는 파일 본문 대신 Storage URL과 메타데이터만 저장한다.
- 상품 사진과 계약 서류는 Google Drive에 2차 사본을 만든다.
- 채팅 첨부는 대화량과 중복 비용을 고려해 Storage에만 저장한다.
- Drive 백업 실패는 원본 업로드와 업무 저장을 취소하지 않는다.
- ERP에서 파일을 삭제해도 Drive 사본은 보존한다. Drive는 장애 복구용이다.
- 기존 RTDB의 data URL은 자동 변환하지 않고 계속 읽을 수 있게 유지한다.

## 저장 경로

신규 파일은 아래 경로를 사용한다.

```text
erp/{companyId}/{product|contract|chat}/{entityId}/{uploaderUid}/{timestamp_uuid}_{fileName}
```

Drive에는 지정한 루트 폴더 아래에 자동으로 폴더를 만든다.

```text
백업 루트/
├─ 상품/{productCode}/
└─ 계약/{contractCode}/
```

Drive 파일에는 `source`, `kind`, `entity_id`, `storage_path`, `uploader_uid`를
`appProperties`로 기록해 원본과 대조할 수 있다.

## 활성화

Firebase Storage는 Firebase 프로젝트에서 Storage 버킷을 만든 뒤 Rules를 게시해야 한다.
이 프로젝트는 V3와 버킷을 공유하므로 `storage.rules`에는 V3의 기존 7개 경로 규칙도
그대로 병합돼 있다. V4의 `/erp` 규칙만 따로 게시하면 V3 업로드가 중단된다.

```powershell
npx firebase-tools deploy --only storage --project freepasserp3
```

Google Cloud 프로젝트에서 Drive API를 켜고 OAuth 클라이언트와 오프라인
refresh token을 만든다. 현재 최소 권한인 `drive.file`을 사용하므로 백업 루트는
해당 OAuth 앱이 직접 생성한 폴더여야 한다. 다른 도구가 만든 폴더 ID를 넣으면
권한이 있어도 앱에서 `404 File not found`로 보일 수 있다.
운영 환경에 아래 네 값을 모두 설정하면 Drive 백업이 자동 활성화된다.

```dotenv
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_BACKUP_FOLDER_ID=
```

하나라도 없으면 `/api/drive-backup`은 비활성 상태를 반환하며 Storage 업로드는 정상 진행한다.
브라우저에는 OAuth 비밀값이 노출되지 않는다.

2026-07-27 운영 상태:

- Storage Rules 게시 완료
- Google Drive API 활성화 완료
- 백업 앱 전용 루트 `FreepassERP4 자동백업`
  (`1KT0jDkm3yYFpcYWnv6-kJQutIhZwEum3`) 생성 완료
- OAuth 앱·테스트 사용자·데스크톱 클라이언트·오프라인 refresh token 구성 완료
- 로컬 `/api/drive-backup`: HTTP 200, `{"enabled":true}`
- Vercel Production·Preview 환경변수 4종 암호화 설정 완료
- 실제 helper 업로드로 `상품/DRIVE-CONNECTION-TEST/` 폴더와 확인 파일 생성 완료

## 제한과 보안 경계

- 상품 사진 3MB, 계약 서류 4MB, 채팅 첨부 3MB가 파일당 상한이다.
- Storage 쓰기·삭제는 업로더 UID로 제한한다.
- Firebase Storage Rules는 RTDB의 조직·역할 데이터를 직접 조회할 수 없다.
- 다른 업무 사용자의 열람은 권한 스코프가 적용된 RTDB 레코드에 저장된 난수 download URL을
  통해 이뤄진다. URL 자체는 전달받은 사람이 열 수 있는 capability URL이므로 외부 공유 금지다.
- Drive 루트는 플랫폼 관리자 또는 백업 담당자만 공유받아야 한다. Drive ACL을 직원 전체에게
  열면 ERP의 역할별 계약 범위를 우회할 수 있다.
- 계약 서류처럼 개인정보가 강한 파일에 대해 URL 공유까지 강제로 차단하려면 후속 단계에서
  Admin SDK 기반 인증 다운로드 프록시와 짧은 수명의 서명 URL로 교체한다.

## 삭제·복구

- ERP 삭제: RTDB 메타데이터와 Firebase Storage 원본을 삭제한다.
- Drive 사본: 자동 삭제하지 않는다.
- 복구: Drive에서 `storage_path` 또는 계약·상품 코드로 찾은 뒤 관리자 검토를 거쳐 다시 업로드한다.
- 계약 메타데이터 저장이 실패하면 방금 올린 Storage 파일은 자동 정리한다.
- 채팅 메시지 저장이 실패해도 방금 올린 Storage 파일을 자동 정리한다.
- 상품 편집 취소는 새로 업로드한 파일을 정리하고, 저장은 제거된 기존 사진을 성공 이후 정리한다.
- 브라우저 강제 종료나 네트워크 단절 시 고아 파일이 남을 수 있으므로 오픈 후 예약 정리 작업으로
  RTDB 미참조 파일을 탐지하는 것이 후속 과제다.

## 배포 전 확인

1. Storage Rules 게시
2. 관리자·공급사·영업자 실제 계정별 사진/서류/채팅 첨부
3. RTDB에 data URL이 아닌 `https://firebasestorage...` URL 저장 확인
4. Drive의 `상품/{코드}`, `계약/{코드}` 사본 생성 확인
5. Drive 인증을 일부러 끈 상태에서도 Storage 업로드 성공 확인
6. ERP 삭제 후 Storage 원본 삭제 및 Drive 사본 보존 확인
