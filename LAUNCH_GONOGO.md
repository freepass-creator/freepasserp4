# freepasserp4 — 오픈 런북 & Go/No-Go

> 스택: **Vercel(서버리스) + Firebase RTDB(프로젝트 `freepasserp3`) + 클라 구독**.
> 자체서버·LB·큐·SQL 없음 → 전통 체크리스트의 인프라 항목 대부분 N/A. 진짜 리스크는 **보안규칙·일방향 데이터이관·관측성**에 집중.
> 세 질문: ①어디서 크게 터지나(규칙·정산) ②터진 걸 얼마나 빨리 아나(관측) ③얼마나 빨리 되돌리나(코드=쉬움/데이터=어려움).

---

## 1. 현재 상태 (2026-08-04 기준)

> **최신 판정: 🔴 NO-GO.** 아래 6개 운영 게이트가 끝나기 전 Production 오픈 금지.

| 오픈 필수 게이트 | 현재 | 완료 조건 |
|---|---|---|
| 법적 운영자 정보 | ❌ 6개 모두 미설정 | 상호·대표자·주소·사업자등록번호·문의 이메일·개인정보 보호책임자를 Preview/Production 환경변수에 입력하고 약관·개인정보 화면 확인 |
| Firebase Admin 서버 경로 | 🟡 Preview 정상·Production 미설정 | Preview 무인증 403 실측 완료. 5역할 smoke 통과 후 Production에도 `FIREBASE_SERVICE_ACCOUNT_JSON` 설정 |
| 차량 원자 선점 | 🟡 Preview 두 플래그 ON | Preview 무인증 claim이 로그인 게이트까지 진입함을 실측. 실계정 경쟁·취소 smoke 통과 후 Production 반영 |
| RTDB 후보 Rules | 🟡 후보 Emulator 40/40·운영 미게시 | 현재 Rules와 RTDB 백업 → 사람/Claude 실데이터 게이트 → 후보 게시 → 5역할 실제 읽기/쓰기 smoke |
| 아이언 홈페이지 재고 | 🟡 Preview 플래그 ON·실관리자 적용 대기 | Preview 관리자 미리보기에서 49/24/25·수정21·신규3·부재차단4 확인 → 명시 적용 28건 → RP006 활성 24대·시트 제외·감사로그 확인 |
| Production 도메인 전환 | ❌ `freepasserp.com`은 기존 `freepasserp3`에 연결 | 최신 fp4 Production 고유 URL smoke 완료 → 마지막에 custom-domain alias 전환. 기존 fp3 배포 ID를 롤백 대상으로 보존 |

추가 필수 순서:

1. 운영자 정보 확정 뒤 Preview에서 기존 회원 재동의 1회 검수
2. Production `NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT=true` 적용 여부 최종 승인
3. 배포 직전 RTDB export와 직전 정상 Vercel 배포 ID 확보 — 2026-08-04 13:15 RTDB/Rules 백업 완료, 실제 게시가 지연되면 재실행
4. 관리자·영업관리자·영업자·공급사관리자·공급사직원 5역할 핵심 여정 확인

아이언렌트카 웹 연동은 사용자의 오픈 범위 확정에 따라 출시 필수다. `IRONRENTCAR_SYNC_ENABLED`는 Preview 관리자 화면 검수 때만 켜고, revision·예상 28건이 일치하는 명시 적용을 통과한 뒤 Production 반영 여부를 확정한다.

최신 검증 Preview는 `dpl_CvmrL7vtnYfVtTh2mbEvZTXz6cc5` / `https://freepasserp4-b2apnu51l-freepass-projects.vercel.app`다. 기준 커밋은 `242de54`이며 Production과 운영 Rules는 변경하지 않았다. 정적·도메인·build 게이트는 PASS이고, `npm audit --omit=dev` 잔여는 Critical 0 / High 3 / Moderate 8이다. High 완전수정은 Next 16 메이저 업그레이드를 요구하므로 별도 호환 검증 없이 `npm audit fix --force`를 실행하지 않는다.

현재 실서비스 도메인 `freepasserp.com`·`www.freepasserp.com`은 Vercel 프로젝트 `freepasserp3`의 `dpl_4K9TWPGwomjKnLmS2fc4VYFPmaJ5`에 연결돼 있다. `freepasserp4`의 기존 Production `dpl_89iS1W6cP2MYd2egoqQFMJFSt6Xq`는 최신 후보 이전 빌드라 새 서버 API가 404다. 최종 오픈 때는 최신 fp4 Production을 먼저 고유 URL로 완전히 검수한 뒤 alias만 마지막에 전환하며, DNS·domain ownership을 미리 제거하지 않는다.

### 과거 2026-07 판정 기록

| 블로커 | 상태 | 조치 |
|---|---|---|
| **B1** RTDB 규칙 (유일 보안경계) | ✅ 검증됨 | 게시 + 규칙 로직 검증(쿼리레벨 격리) + 커서 브라우저 격리 스모크(PERMISSION_DENIED) 통과 (2026-07-28) |
| **B2** API 프록시 SSRF/오픈프록시 | ✅ 수정됨 | img/sheet host allowlist, ocr prod 가드 (커밋 `3586c96`) |
| **B3** 관측성 0 | ✅ 최소치 구축 | 에러바운더리 + RTDB 에러수집 + env검증 (커밋 `eefa217`) |
| **B4** 일방향 이관·백업 미검증 | ✅ 검증됨 | 전체 26MB export + 복구 리허설(주입→확인→삭제) 통과 (2026-07-28) |
| **B5** 돈흐름 정합성(H1 등) | 🟡 H1 반영 | H1 지정보존 코드 반영([auth.ts](lib/firebase/auth.ts) `approveUser`) · idempotency 등 부수항목은 오픈 후 |

**당시 결론: 🟢 Go (2026-07-28).** 이후 후보 Rules·서버 차량 선점·법적 정보 게이트가 추가됐으므로 현재 판정에는 사용하지 않는다.

---

## 2. 배포 절차 (코드)

- **배포**: `main` 푸시 → Vercel 자동빌드 → `freepasserp.com`. 빌드게이트 = `tsc`(엄격) · 린트는 설정없어 스킵.
- **버전확인**: 상단바 메뉴 하단 `v4.0.0 · #빌드번호`(git 커밋수 자동증가). 배포 반영 확인용.
- **프리뷰**: PR/브랜치 푸시 → Vercel 프리뷰 URL(운영 데이터 접근 주의 — 같은 Firebase 봄).

## 3. 롤백 절차

> **코드 롤백은 쉽고, 데이터/규칙 롤백은 사실상 불가.** 둘을 분리해서 판단.

**코드 롤백 (즉시):**
1. Vercel 대시보드 → Deployments → 직전 정상 배포 → **Promote to Production** (또는 `git revert <sha>` 푸시).
2. 소요 ~1분. 사용자 영향 최소.

**데이터/규칙 롤백 (주의):**
- 규칙: 게시 전 **현재 규칙 텍스트를 반드시 백업**(Firebase 콘솔 규칙 탭 복사 → `database.rules.PREV.json`). 문제 시 그 텍스트 재게시.
- 데이터: RTDB 이관은 되돌리기 없음 → **이관 전 export가 유일한 복구수단**(§5).

## 4. B1 — 규칙 게시 리허설 (너 실행)

콘솔: https://console.firebase.google.com/project/freepasserp3/database/freepasserp3-default-rtdb/rules

**순서(반드시 준수):**
1. [ ] **현재 게시된 규칙 텍스트 백업** → 로컬 저장(롤백용).
2. [ ] `database.rules.json`(244줄+)을 규칙 시뮬레이터에서 **읽기/쓰기 시뮬레이션**:
   - admin uid로 settlements read → 허용
   - provider A uid로 provider B의 settlements read → **거부** 확인
   - 비로그인으로 customers read → **거부** 확인
3. [ ] 게시.
4. [ ] **테넌트 격리 스모크**(실계정): provider A 로그인 → B 실적/PII 접근 시도 → 막히는지 눈으로 확인.
5. [ ] 게시 후 앱 핵심기능(상품목록·문의·계약·정산) 정상 동작 확인.

⚠ 게시하면 v3 잠금영역 데이터 접근이 끊길 수 있음 → **민감정보 마이그레이션·개인채널 백필**을 게시와 순서 맞춰 진행(기존 진행 항목).

## 5. B4 — 백업 & 복구 리허설 (너 실행)

> "백업이 있다"가 아니라 **"복구해봤다"**가 증거.

1. [ ] **정기 export 설정**: Firebase 콘솔 → RTDB → 백업(또는 `firebase database:get / --output backup.json`로 수동 export). 최소 **일 1회**.
2. [ ] **복구 리허설 1회**: 백업 json을 **스테이징/별도 경로**에 import → 데이터 건수·정합성 확인.
3. [ ] **RPO/RTO 합의(소규모 기준)**: 예) RPO=24h(일 1회 export), RTO=1h(수동 재import). 문서에 명시.
4. [ ] 시나리오 연습: "운영 노드 실수 삭제" → 마지막 export에서 해당 서브트리만 복구.

## 6. B5 — 돈흐름 (너 결정 + 나 수정)

- [ ] **H1**: 승인 시 관리자지정 신원 덮어씀([lib/firebase/auth.ts](lib/firebase/auth.ts) approveUser) — **지정보존 vs 재매칭** 결정 필요. 결정 주면 수정.
- [ ] 정산 확정액션 부재 · 취소시 환수 로직 · 계약/정산 **중복제출 방지**(idempotency) 점검.

## 7. 관측 (B3 구축분 — 오픈 후 볼 것)

- **클라 에러**: RTDB `v4/_client_errors` 노드(admin read). 콘솔에서 watch → 급증 시 이상신호.
- **수동 대시보드(최소)**: 오픈 직후 수시 확인 —
  - Firebase 콘솔: RTDB 사용량(read 급증=과금·성능), Auth 로그인 성공/실패
  - Vercel: Functions 에러율, 대역폭
  - `v4/_client_errors` 증가 추이
- ⚠ 자동 알림은 아직 없음 → **오픈 당일은 수동 관찰**. 여력되면 Sentry(무료티어) 연동이 다음 단계.

## 8. 오픈 당일 체크

**오픈 전:**
- [ ] main 최신 커밋·빌드번호 확인 · Vercel 빌드 성공 확인
- [ ] 규칙 게시 완료(§4) · 백업 최신(§5)
- [ ] 핵심여정 스모크: 공급사 상품등록 → 영업자 검색·문의 → 관리자 승인·계약·정산 → 고객 서명
- [ ] 외부연동 확인: `/api/sheet`·`/api/img` 정상, OCR은 prod 501(정상)
- [ ] 롤백 대상(직전 배포) 식별 · 담당(너/태윤) 대기

**오픈 직후 관찰:**
- 로그인 성공률 · 상품목록 로딩 · 문의/계약 생성 · `v4/_client_errors` · RTDB read량 · Vercel 에러율

## 9. Go/No-Go 기준

**🔴 오픈 중단:** 인증/인가 우회 · PII 노출 · 정산 금액오차/중복 · 데이터 손상·복구불가 · 규칙 미게시 · 백업 복구 미검증

**🟡 조건부 오픈:** 비핵심 UI 불안정(다크모드 badges 색 등) · 영향 국소 · 수동관찰로 커버 가능

**🟢 오픈 후 처리:** UI 규격 잔여 · 성능 최적화 · SEO/OG · 자동 알림 구축

---

_생성: Claude Code 검수. B2·B3는 반영 완료, B1·B4·B5는 실행/결정 대기._

---

## 10. QA 긴급건 조치 이력 (2026-07-31)

| ID | 내용 | 상태 | 남은 것 |
|---|---|---|---|
| AUTH-6 | 비활성·삭제·반려 계정이 그대로 로그인해 데이터 접근 | ✅ **완료** | 앱 게이트 + **서버 규칙 32곳 게시 완료**(2026-07-31) |
| RATE-1 | 수수료율 오입력이 정산액 100배로 이어짐 | 코드 반영 | — |
| CACHE-1/SYNC-1 | 상대가 보낸 새 문의·새 메시지가 세션 내내 목록·뱃지에 안 붙음 | 코드 반영 | — |
| AUTH-7 | 가입·기존 회원 약관/개인정보 동의 증적 | 코드 반영·재동의 기본 OFF | **운영자 정보 입력 + Preview 재동의 검수 후 ON** |
| STOR-1 | `contract-signed/**` 무인증 업로드·덮어쓰기(계약서 위조) | ✅ **완료** | 게시 후 200→**403** 실측 · 잔여 파일 0개(악용 흔적 없음) |
| 이관 | erp3 대화·계약·정산을 v4 로 | ✅ **완료** | 5·6단계 실행, 검증 10/10. 8단계(브리지 제거)는 매물 302대 게이트로 보류 — `MIGRATION_PLAN.md §7` |

### STOR-1 상세

`contract-signed` · `contract-unsigned` 는 v3·v4 어느 코드도 쓰지 않는 유령 경로였다(전수 grep 0건).
그런데 signed 쪽 `allow create, update` 에는 `request.auth != null` 조건 자체가 없어서, 로그인 없이
Storage REST 로 임의 경로에 파일을 올리고 **기존 서명본을 같은 경로로 덮어쓸 수 있었다.**
쓰는 코드가 없으므로 쓰기를 닫고(`allow write: if false`) 읽기는 인증으로 좁혔다.
**규칙 파일만 고쳤을 뿐 아직 게시되지 않았다** — 게시해야 실제로 막힌다.

남은 것(별건, 규칙만으로는 못 고침): v3 호환 경로 `contract-files/{contractId}` · `chat-files/{roomId}` 는
**로그인한 아무나** 남의 계약 첨부(면허증 사본 등)와 남의 방 파일을 읽을 수 있다.
Storage 규칙은 RTDB 를 못 읽으므로 소속 검사가 불가능하다. 해결하려면 Auth 커스텀 클레임에
`company_code`·`role` 을 실어 규칙에서 대조하거나, 다운로드를 서버 라우트로 우회시켜야 한다.
v4 신규 경로(`erp/{companyId}/...`)는 이미 업로더 본인만 읽도록 좁혀져 있어 신규 업로드는 영향 없음.

### AUTH-7 잔여 — 사람이 확인·활성화할 것

1. **운영자 정보 기재.** Vercel Preview/Production의 `NEXT_PUBLIC_OPERATOR_*` 환경변수가 비어 있으면
   /terms·/privacy 상단에 빨간 경고가 뜬다. 채워야 할 값: 상호(법인명) · 대표자 · 사업장 주소 ·
   사업자등록번호 · 문의 이메일 · (선택)대표 전화 · 개인정보 보호책임자. 사실 정보라 임의로 채울 수
   없어 비워 뒀으며, 입력 뒤 재배포하고 `npm run check:release -- --rules=...`와 공개 문서를 확인한다.
2. **기존 회원 재동의 활성화.** 재동의 화면과 본인 증적 저장은 구현됐지만
   `NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT=false`가 기본값이다. 운영자 정보와 약관 본문을 확정한 뒤
   Preview 전용 기존 회원으로 1회 표시 → 두 필수 동의 저장 → 재로그인 시 미표시를 확인하고
   Production에서만 `true`로 켠다. 게스트·공개 경로·차단 계정은 재동의 게이트 대상이 아니다.

약관·방침 본문(`lib/legal.ts`)은 서비스 구조에 맞춰 쓴 초안이며 **법률 검토를 대신하지 않는다.**
본문을 고치면 `LEGAL_VERSION` 을 올릴 것 — 안 올리면 회원이 무엇에 동의했는지 증명할 수 없다.
