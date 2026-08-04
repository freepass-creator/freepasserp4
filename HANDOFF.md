# 규격통일 핸드오프 (Claude ↔ Cursor)

> **Codex 법적정보·재동의·최신 claim Preview 활성화(2026-08-04):** 사용자 `다음 ㄱㄱ`를 `개인정보 보호책임자=박영협` Preview 반영 승인으로 해석했고 `NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT=true`도 Preview에만 적용했다. Claude 후속 stale claim 회수까지 포함한 최신 Ready `dpl_AmdZSFwVEaW1RxpPExvTGteFvMLr` / `https://freepasserp4-ooijoten9-freepass-projects.vercel.app`에서 약관·개인정보·로그인 정상, 운영자 경고 0, 한글 깨짐 0, 무인증 session/iron 403, claim 로그인 게이트, runtime error 0을 확인했다. claim 17/17·차량락 38/38·type/UI/tokens/fonts·build 30/30, 후보 Rules+확정 환경 release 차단 0/경고 1(서비스워커), B2B 41/41 PASS다. 관리자/QA 세션이 없어 재동의 저장·5역할·아이언 28건 적용은 미실행이며 실제 사용자를 임의 가장하지 않는다. 자동 생성된 fp4 Production `dpl_3ZrY5dJgZgd41TtPcGHWPw8zAtAt`은 운영자 env 없음·claim OFF라 사용 금지이고, 실서비스 도메인·Rules는 미변경이다.

> **⚠ Claude 게이트 정정 — 게시 순서(2026-08-04):** 아래 두 항목이 적은 「후보 Rules 게시 → Production 서비스계정·플래그」 순서는 **쓰면 안 된다.** 후보 Rules 가 `agent_balance_paid`·`provider_balance_confirmed`·`vehicle_identity_hash` 를 `newData.val() === data.val()` 로 잠가 클라이언트 직접쓰기를 401 로 막고(`release-probe.mjs` 가 확인), 클라이언트가 서버 API 로 우회하는 조건은 차량선점 플래그 두 개가 모두 ON 일 때뿐이다(`vehicle-claim-client.ts:15`). RTDB 는 `freepasserp3` 하나뿐이라 콘솔 게시가 Production 에 즉시 적용되므로, 플래그 OFF 상태에서 게시하면 **영업자 「계약금 입금」·공급사 「입금 확인」이 전면 401 이 되어 딜이 한 건도 진행되지 않는다.** Preview 는 플래그가 ON 이라 이 사고가 Preview 검증으로는 잡히지 않는다. 올바른 순서는 **① 운영자 정보 → ② Production 서비스계정+두 플래그 ON → ③ 재배포·실계정 계약금 체크 1건 성공 → ④ Rules 백업 → ⑤ 후보 게시 → ⑥ 게시후 재확인·5역할 smoke** 이며, ②③ 이 ⑤ 보다 반드시 앞이다(플래그 선행은 부작용 없음 — 서버는 Admin SDK 라 구 Rules 에서도 통과). 근거·롤백은 `CLAUDE_GATE_VEHICLE_CLAIM_2026-08-04.md` 차단 1 과 `LAUNCH_GONOGO.md` §1-1. 같은 게이트의 주의 1(죽은 claim 회수)은 `reserveVehicleClaim` 에 반영 완료(claim sim 17/17).

> **Codex 운영자 정보 Preview 검증(2026-08-04):** 기존 운영 DB와 공식 freepassmobility.com을 교차확인해 상호·대표자·사업자번호·주소·문의 이메일·전화 6개를 Preview에만 입력했다. 첫 PowerShell stdin 입력의 한글 `?` 손상을 실제 약관에서 발견해 값을 제거하고 UTF-8 파일 stdin으로 재등록했으며 임시 파일은 삭제했다. 최신 Ready `dpl_DTapfRfjPhQxz5TABkvo715c7V4y` / `https://freepasserp4-5u6c3gc56-freepass-projects.vercel.app`의 약관·개인정보 화면에서 여섯 값 일치와 깨진 문자 0을 확인했다. 남은 법적 필드는 개인정보 보호책임자 1개다. 공개 근거가 없어 임의 지정하지 않았으며 Production env·도메인은 미변경이다.

> **Codex 오픈 직전 게이트 재검증(2026-08-04):** 기준 `242de54`의 type/fonts/tokens/UI·핵심 domain sim·production build 30/30 PASS. 비게시 Rules 후보는 보안 14/14·계약 26/26·서명 58/58·실제 Auth+RTDB Emulator 40/40 PASS지만 운영 Rules는 미게시다. Preview에 유효한 서버 서비스계정과 차량 claim 서버/클라이언트 플래그, 아이언 플래그를 켜 재배포했고 `dpl_CvmrL7vtnYfVtTh2mbEvZTXz6cc5` / `https://freepasserp4-b2apnu51l-freepass-projects.vercel.app`가 Ready다. 무인증 session·아이언 API 403, claim은 `로그인이 필요합니다`로 서버 초기화/플래그 ON을 실측했다. 실제 브라우저의 로그인·약관·개인정보·게스트 핵심 경로는 렌더되지만 약관 2화면에 운영자 6필드 미입력 경고가 노출된다. RTDB 전체 27,589,451바이트와 현재 라이브 Rules 백업을 새로 생성·해시 검증했고 둘 다 Git ignore 상태다. 현재 판정은 NO-GO다. 다음 작업자는 운영자 6필드 입력 → Preview 재동의/5역할 smoke → 사람/Claude 후보 Rules 승인·게시/게시후 smoke → 관리자 아이언 28건 반영·24대 검증 → Production env/배포 순서를 바꾸지 않는다. 실제 게시가 지연되면 백업부터 갱신한다. Production·운영 Rules·운영 데이터 변경 0.

> **Codex Production 도메인 전환 감사(2026-08-04):** `freepasserp.com`과 `www`는 아직 Vercel `freepasserp3` 프로젝트의 안정 Production `dpl_4K9TWPGwomjKnLmS2fc4VYFPmaJ5`에 연결돼 있다. `freepasserp4` Production `dpl_89iS1W6cP2MYd2egoqQFMJFSt6Xq`는 최신 후보 이전 빌드라 새 session/claim/iron API가 모두 404이며 도메인 연결 금지다. 최종 순서는 최신 fp4 Production 배포 → 고유 `freepasserp4-*.vercel.app`에서 전체 smoke → 마지막에 custom-domain alias 전환이다. 기존 fp3 deployment ID를 즉시 롤백 기준으로 보존한다. 이번 작업에서 도메인·DNS·alias 변경 0.

> **Codex 기존 회원 약관 재동의 게이트(2026-08-04):** `NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT=true`일 때만 현재 `LEGAL_VERSION` 동의 기록이 없는 활성 로그인 회원에게 이용약관·개인정보 처리방침 필수 재동의를 띄우고, 본인 `users/{uid}`의 세 동의 증적만 갱신한다. 게스트·공개 경로·로그인·차단 계정과 캐시 복원 흐름은 제외했다. 순수 17/17·권한 44/44·phase12 69/69·후보 Rules Emulator 40/40·type/UI/fonts·플래그 ON build 30/30 PASS. 코드 `dd1590a`의 Git Preview `dpl_6zTsgwzqjULNNc7MH6cZyG2g8bun` / `https://freepasserp4-ibid81aup-freepass-projects.vercel.app`는 READY이고, Preview 환경의 재동의/운영자 변수는 미설정이라 기본 OFF다. 실제 Chrome의 로그인 이동·공개 약관 2경로·console/runtime error 0을 확인했다. 운영 데이터/Rules/Production/`origin/main` 변경 0. 다음 작업자는 확정 운영자 6필드와 약관 본문을 먼저 확인하고 Preview 전용 기존 회원으로 1회 표시→저장→재로그인 미표시를 검수한 뒤에만 Production flag를 켠다. `database.rules.json`은 사람/Claude 실데이터 게이트 전 게시 금지.

> **Codex 법정 운영자 정보 환경변수 전환(2026-08-04):** 저장소 어디에도 확정 사실값이 없어 임의 입력하지 않고, `lib/legal.ts`의 운영자 7필드를 공개 Vercel `NEXT_PUBLIC_OPERATOR_*` 빌드 환경변수로 전환했다. `check:release`는 필수 6필드 누락과 사업자번호 10자리·이메일 형식을 검사한다. 정상 임시값+재동의 ON+후보 Rules는 차단 0/경고 1, 잘못된 번호·메일은 차단 2, 현재 실제 환경은 6필드 미입력 차단 1/경고 2(재동의 OFF·서비스워커)다. 체크포인트 `84626dd` Preview `dpl_GKwAp17Qw4phW8KmiWnu9md13vdH` / `https://freepasserp4-tqzqmqa61-freepass-projects.vercel.app`가 READY이며 실제 `/terms`·`/privacy`에 6필드 경고와 새 환경변수 안내가 표시되고 runtime error 0이다. 임시값은 저장하지 않았고 운영 Rules·데이터·Vercel 환경·Production 변경 0이다. 다음은 사용자가 상호·대표자·주소·사업자등록번호·문의 이메일·개인정보 보호책임자(대표전화 선택)를 확정해 Preview/Production 환경에 입력하고 재배포한 뒤 공개 문서를 확인하는 단계다.

> **Codex B2B 5역할 Preview 읽기 게이트(2026-08-04):** `GET /api/auth/session`과 `npm run smoke:b2b-roles`를 추가해 플랫폼 관리자·영업채널 관리자·영업자·공급사 관리자·공급사 직원의 세부 역할/조직 범위와 상품 브리지 공개집합·민감값 격리·no-store를 한 번에 검사한다. 토큰은 셸 환경변수로만 받고 uid·토큰·상품키·원가를 출력하지 않으며 GET 두 endpoint만 사용해 write 0이다. 격리 실제 Next API 16/16, 권한 44/44, 상품 브리지 16/16, claim 11/11, 차량 38/38, phase12 69/69, type/UI/fonts/build 30/30 PASS. B2B 게이트는 새 항목 포함 37 PASS/3 FAIL로 서비스계정 없음+두 원자 플래그 OFF만 의도적으로 막고 있다. 체크포인트 `2393586`의 Git Preview `dpl_6D34V44eJWfeCvdqxAqhzQz83CXx` / `https://freepasserp4-palnz4r61-freepass-projects.vercel.app`는 READY이며 비인증 역할/브리지 403·private/no-store, runtime/Chrome console error 0이다. 운영 Rules·데이터·Production은 미변경. 다음은 전용 5역할 QA 토큰을 현재 셸에만 주입해 이 안전 플래그 OFF Preview에서 읽기 smoke를 실행하는 것이며, 사람 실데이터 확인 전 Rules 게시·플래그 ON 금지. 명령은 `docs/SECURITY_RELEASE_GATE_2026-08-03.md`의 게시 전 순서 참조.

> **Codex 원자 선점 후보 Preview 검수(2026-08-04):** 체크포인트 `7e5fa8e`를 `codex/atomic-claim-preview`로 push했고 Git Preview `dpl_8uxH95BGoUa36M7Fae3bJoBPdc2P` / `https://freepasserp4-9913fs0fb-freepass-projects.vercel.app`가 READY다. 서버·클라이언트 원자 선점 플래그는 Preview에 없어 기본 OFF, `database.rules.json`·Production·`origin/main`은 미변경이다. 실제 Chrome 둘러보기에서 데스크톱 주요 5경로와 390×844 `/`·`/contract`를 검사해 console error·runtime error·overflow 0, 모바일 좌측 aside 비노출, 엑셀·비규격 계약 요약 바 미노출을 확인했다. `/inventory` 권한 제한과 `/members`→홈, `/settlement`→`/contract` 이동은 둘러보기 영업자 정책상 정상이다. 이 결과는 읽기 전용 기본 smoke이며, 활성화 Preview의 5역할 실계정 경쟁/취소/공급사 확인 smoke와 사람/Claude Rules 승인 전 Production은 NO-GO다. CLI 직접 업로드의 `dpl_6T8mQQDR3NV3RpDxhdoT9NwiRboj`는 build 0ms `UNKNOWN`이므로 사용 금지. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex 차량 원자 선점 후보 완료(2026-08-04):** 사용자 승인에 따라 번호판/VIN 해시 기반 `v4/vehicle_claims` 서버 RTDB transaction, 인증 API, 클라이언트 기능 플래그, claim 결속 후보 Rules를 구현했다. 같은 신원의 다른 계약금/완료 계약과 트윈 상품의 주인 있는 락을 서버에서 차단하고 v3에는 쓰지 않는다. claim 11/11·차량 38/38·계약 Rules 26/26·권한 44/44·정산 22/22·phase12 69/69·착한거래 9/9·Rules Emulator 37/37·실제 Next API 통합 14/14·type/UI/tokens/fonts·build 30/30 PASS다. 서버 인증은 토큰 실패와 구성/RTDB 장애를 분리해 후자를 503으로 닫고, 무자격증명 초기화는 demo 에뮬레이터 조합에만 한정한다. 서버 전용 kill switch까지 추가해 URL 직접 호출도 명시적 활성화 전 503이다. 현재 B2B 게이트는 서비스계정 없음+서버/클라이언트 플래그 OFF로 33 PASS/3 FAIL, 법정 운영자 정보 6개도 미기재다. `database.rules.json`·운영 데이터·Production은 미변경이며 위험영역이라 새 Preview 역할별 smoke와 사람/Claude 승인 전 커밋·게시·배포 금지. 상세는 `VERIFICATION.md` 최상단과 `docs/DOUBLE_SALE_GUARD_2026-08-04.md` §9 참조.

> **Codex 착한거래 전자계약 이음매(2026-08-04):** 약정 작성완료 뒤 `전자계약 발송` 버튼을 탑재하고 자체 `ContractSign` 신규 발송 진입점은 제거했다. 버튼은 인증된 서버 API만 호출하며 영업자 본인·같은 채널 관리자·플랫폼 관리자만 계약 귀속 검증 뒤 착한거래 계약 발행→SMS 발송이 가능하다. 공급사·타인·타채널은 차단한다. API 키는 서버 전용이고 v3 write는 없다. 현재 착한거래 4개 환경변수는 비어 있어 503 실패-폐쇄하며 외부 호출·운영 write 0이다. 역할/payload 9/9, phase12 69/69, type/UI/tokens/fonts, build 30/30 PASS. 실제 API/IdV 준비 뒤 환경변수와 웹훅 규격을 별도 게이트할 것. 상세는 `VERIFICATION.md` 최상단 참조.

> **과거 RACE-2 기록(2026-08-04, 상단으로 대체):** `8df5c9c` 시점의 클라이언트 check-then-act는 36/38 FAIL이었다. 적대 테스트는 그대로 보존했고 현재 서버 원자 claim 후보에서 38/38 PASS다. 운영 브라우저 mutex가 아니라 서버 RTDB transaction이 유일한 동시성 경계다.

> **Codex 비게시 Rules 후보 재검증(2026-08-04):** 현재 Rules에서 후보를 재생성해도 SHA-256이 동일했고, 후보 보안 14/14·계약 26/26·전자서명 58/58·채팅 43/43·격리 Firebase Emulator 32/32 PASS다. 최신 읽기 전용 실데이터/Sheet 대조는 16곳·388대, v3-only 292건/288대, 브리지 후보 740건, overlay 후보 236대·브리지 유지 5대·공급사 확인 43대다. B2B 게이트는 로컬 서비스계정 부재만 1 FAIL, 일반 출시는 법적 운영자 정보 6개 때문에 1 FAIL이다. 운영 Rules·데이터·배포/write 변경 0. 새 Preview 역할별 QA 브리지 smoke→사람/Claude 승인→백업/롤백 전 후보 게시 금지. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex 공개 전자서명 모바일 재검수(2026-08-04):** `/sign/[token]`의 지우기·제출을 공통 icon+text로 통일하고 제출 전폭, 비상연락 반응형 1열 전환, 색상 토큰, canvas 접근성 이름을 적용했다. 390×844 실제 오류 토큰 화면의 한글·폭을 확인했고 type/UI/fonts, phase12 67/67, build 30/30 PASS다. 현재 `database.rules.json`은 익명 read에 `status === 'sent'` 제한이 없어 보안 게이트 FAIL이며, 기존 비게시 후보는 전자서명 Rules 58/58 PASS다. Rules·계약 write·운영 데이터·배포는 변경하지 않았다. 사람/Claude 실데이터 승인→후보 게시→정상/완료/폐기 토큰 smoke 전 전체 오픈 NO-GO. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex 모바일 재고·정책 조회/편집 분리(2026-08-04):** 공통 `FormReadList`를 추가해 모바일 조회는 `ListGroup + DetailRow`, 수정 시에만 `FormGrid`가 나오도록 했다. 재고 차종/신원/공급사/제원/운영정보와 정책 3패널에 적용했고, 가격표 readOnly는 입력·기간추가·삭제 없이 값 있는 기간만 표시하며 사진 readOnly는 추가·편집을 숨기고 확대만 허용한다. 실제 390×844에서 재고 조회 input/select/사진추가 0, 정책 조회 input 0, 폭 390/390; 수정 진입 시 재고 29 input+6 select, 정책 39 컨트롤 복원을 확인하고 저장 없이 취소했다. phase12 64/64, type/UI/fonts/build 30/30 PASS. 저장 로직/write·Rules·배포 변경 없음. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex 모바일 비계약 실행 버튼 전수 보강(2026-08-04):** 회원 승인/승인취소·백필/분리 도구, 설정 저장·비밀번호·로그인/로그아웃·복사·관심목록 정리, 상품 검수 요청, 재고 초기화·복사·붙여넣기를 공통 icon+text로 통일했다. 간단문의 입력행만 입력폭 규격에 따라 모바일 icon-only/웹 icon+text다. 390×844 실제 회원·설정에서 대상 버튼 SVG 1개, 폭 390/390, 엑셀 노출 0 확인. phase12 59/59, 계약 142/142, type/UI/fonts/build 30/30 PASS. 로직/write·Rules·배포 변경 없음. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex 모바일 상세 실행 버튼 규격 검수(2026-08-04):** 모바일의 모든 버튼을 아이콘-only로 만들지 않고, 탐색/도구만 icon-only, 저장·삭제·승인·정산·문의 등 결정적 실행은 icon+text, 가능·협의·불가 등 선택지는 text 유지로 SSOT를 확정했다. 공통 `ButtonLabel`을 계약 진행·전자서명·메모·서류·금액·정산 액션에 적용했고 390×844 실제 계약 상세 DOM에서 주요 실행 버튼 SVG 1개, 선택지 SVG 0개, 하단 탭 icon+label, 모바일 엑셀 미노출을 확인했다. phase12 53/53, 계약 142/142, type/UI/fonts/build 30/30 PASS. 계약·정산 로직/write·Rules·배포는 변경하지 않았다. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex 모바일 계약 첫 페인트 보강(2026-08-04):** 문의에서 이미 권한 스코프로 읽은 계약 캐시를 `/contract` 첫 렌더에 재사용하고 live read로 갱신한다. 계약 행 표시를 정산 read 완료와 분리했으며 정산은 백그라운드 선조회·상세 시 같은 Promise 재사용 구조다. 파트너 표시명도 상품 원본보다 먼저 읽어 캐시 행에 `RP018` 대신 `스타`가 첫 프레임부터 나온다. 390×844 실제 하단 독 이동에서 계약 첫 프레임 43행, skeleton 0·좌측 inset 0·overflow 0을 확인했다. type/UI/fonts/계약 142/142/build 30/30 PASS. 계약·정산 로직/write·Rules·배포는 변경하지 않았다. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex 모바일 목록 정밀 검수(2026-08-04):** 390×844 실데이터 검수에서 채팅 행의 금지된 좌측 상태 바와, `data-fp-m` 고정값 때문에 리사이즈 후 데스크톱 4패널이 모바일 폭에 압축되는 결함을 발견했다. 공통 `FeedListRow`의 `accent` API를 제거하고 상태는 아이콘·배지·카운트, 선택은 `C.selected` 배경으로 고정했다. 마운트 후 모바일 판정은 live `window.innerWidth`를 따른다. `/chat` 176행, 계약 43행, 재고·회원 각 101행, 정산 11행, 정책 26행에서 좌측 inset 0·가로 overflow 0·모바일 단일 목록을 확인했다. type/UI/fonts/표시 sim/build 30/30 PASS. 로컬 cold 계약·재고 데이터 도착이 20~27초까지 걸린 관찰은 새 Preview 실계정 성능 재검수 대상으로 남겼다. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex Sheet exact patch/CAS dry-run 2단계(2026-08-04):** 1단계 판단 적용계획을 실제 저장 없이 정확한 공개 v4 경로·patch·CAS 기대값으로 변환한다. 유입 제외 원장은 create-if-absent, 동일 삭제키는 기존 soft-merge+삭제표식 해제 CAS, 다른 차량은 공개상품 create-if-absent, 동일차 신원은 승인 원자만 CAS 후보로 만든다. private 유입은 patch 0건으로 차단하고 JSON에 원가·VIN·계좌·수수료·raw를 넣지 않는다. 공급사 대표키 변경은 계약·채팅·견적·private 역사 정책 미확정이라 계속 차단한다. 관리자에 `patch dry-run JSON`을 연결했지만 저장/API/차단해제는 없다. 신규 21/21, 관련 회귀 286/286, type/fonts/UI/build 30/30 PASS. 운영 write·Rules·환경변수 변경 0, `SHEET_DAILY_SYNC_ENABLED=false` 유지. 다음은 실제 원장 JSON을 사람/Claude가 승인하는 게이트다.

> **Codex Sheet 판단 적용계획 1단계(2026-08-04):** 소유권·삭제·신원 결정 원장을 현재 검증 스냅샷과 대조해 `유입 제외/삭제키 복구/신규 생성/공급사 참조 이관/신원 원자 갱신` 후보를 만드는 순수 계획기를 추가했다. 계약·채팅방·견적 참조 수와 공개/private 후보경로를 TSV로 보되 모든 행 `applyAllowed=false`, 실행작업 0이다. 계약보호·대상모호·원장불일치·병합별칭·신규키충돌·계획간 키 중복·stale 원장은 fail-closed한다. 신규 sim 20/20, 관련 회귀 222/222(128+21+10+15+16+17+15), type/fonts/UI/build 30/30 PASS. 실제 patch·동기화 차단 해제·운영 write는 0건이며 `SHEET_DAILY_SYNC_ENABLED=false` 유지. 다음은 정확한 v4 patch/CAS payload를 무저장 생성한 뒤 사람/Claude가 승인하는 단계다. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex 성능·먹통 최종점검(2026-08-04):** 정상 Ready Preview에서 데스크톱 24회+모바일 15회, 총 39회 주요 경로 스트레스를 실행해 실패·먹통·overflow·console error/warning 0을 확인했다. 평균 606/677ms, 최대 1.59/1.565초다. 로컬 관리자 355대 hard reload는 shell 0.50초·전체 행 4.75초라 재고 초기 read가 최대 체감 지연이다. 현재 로컬 소스는 재고 shell-first와 정책·상품·파트너 병렬 read로 보강했고, 모든 공통 로딩은 12초 지연 시 안내+새로고침 복구를 제공한다. type/UI/재고 28/28/build 30/30 PASS. 이 수정은 아직 정상 Preview에 미배포이므로 새 Preview 실계정 재검수가 필요하다. 전체 오픈은 성능이 아니라 법적 6필드·2역할 QA smoke·사람/Claude Rules 승인 때문에 NO-GO다. 상세는 `VERIFICATION.md` 최상단 참조.

> **Codex Chrome 초정밀 검수(2026-08-03):** Ready Preview에서 데스크톱·모바일·영업자·공급사 화면을 실제 클릭 검수했고 console error/warning 0, 모바일 overflow 0·엑셀 미노출·비규격 계약지표 미노출을 확인했다. 관리자 전용 페이지의 초기화 순서를 권한 판정보다 뒤로 옮기고 `/diag`에 관리자 게이트를 추가했다. type/fonts/tokens/UI/build와 비게시 Rules 정적 14/14·26/26·58/58, 격리 Emulator 32/32 PASS다. 전체 오픈은 법적 운영자 정보 6필드, 새 Preview 런타임 재검수, 2역할 QA token smoke, 사람/Claude Rules 승인 전까지 NO-GO다. 상세는 `VERIFICATION.md` 최상단 참조.

> **배포 구분:** 검수 가능한 정상 Preview는 `dpl_9H8TtHymfPhUcocr1gbvpnim66FQ` / `freepasserp4-48ikovxat-freepass-projects.vercel.app`이다. UI 권한 수정본 업로드 시 생성된 `dpl_6MUEdmNbgKp5Ng5oEL9cffn98r8S`는 Vercel CLI 중단으로 `UNKNOWN`, build 0ms이므로 사용 금지다. Production은 변경하지 않았다.

> **작업환경:** 로컬 dev 서버는 `http://localhost:4004`에 숨김 백그라운드로 기동했다. `tmp/vercel-stage-b2b-20260803-2039`에는 배포 재시도 중 복사된 `.next-codex-*` 캐시가 있어 용량이 크지만 ignored 임시 폴더이며 소스가 아니다. 정확한 경로를 확인한 뒤 정리할 것. 새 경량 스테이징은 `tmp/vercel-stage-open-20260803-2251`이다.

> Claude B2B 출시 최종 검토는 `docs/CLAUDE_B2B_RELEASE_GATE_REQUEST.md`를 그대로 실행하고 결과를 `CLAUDE_REVIEW_B2B_RELEASE.md`에 기록한다. 운영 Rules·데이터는 검토 단계에서 변경하지 않는다.

> **Codex 재검증·후보 보강(2026-08-03):** 기존 후보의 `v4/products .read` 계정상태 우회를 발견해 비게시 후보 생성기에 활성·배정 역할 제한을 추가했다. 보안 **14/14**, 계약 **26/26**, 서명 **58/58**, 별도 포트 Emulator **32/32 PASS**다. Preview 서비스계정과 수정 배포까지 확인했지만 운영 Rules는 수정·게시하지 않았고, 남은 배포 게이트는 전용 영업자·공급사 QA 토큰 smoke다.

## 2026-08-03 B2B 운영 오픈 후보

- 손님 공개 페이지는 후속으로 분리하고 실로그인 영업자·공급사의 문의→계약→공급 재고/정책→계약별 정산조회 범위로 재판정했다. 기능·화면 코드 후보는 CONDITIONAL PASS다.
- `lib/domain/sheet-merge.ts`가 Sheet 패치에서 private 상품 원자와 가격 수수료 원자를 제거한다. 공개/비공개 RTDB 2단 transaction의 부분 성공을 Sheet 경로에서 만들지 않는다. merge 128/128 PASS.
- `components/TopBar.tsx`의 웹 계정 표시가 `fp:role`을 구독한다. 브라우저에서 영업자→공급사 전환 시 `둘러보기·제일오토렌탈`로 즉시 바뀌고 `/chat`, `/contract`, `/inventory`, `/policy` 렌더 및 console error 0을 확인했다.
- 핵심 회귀: 영업자 44/44, 공통 48/48, 권한 44/44, 채팅 Rules 43/43, 업무목록 142/142, 재고 28/28, 정산 30/30, 잠금 23/23, 3자 정산 22/22, type/fonts/tokens/UI, build 30/30 PASS.
- 현재 운영 Rules는 check:release 13 FAIL 중 법적 정보 1개를 제외한 B2B 보안 12개가 미해결이다. 특히 운영 `sim-contract-rules`가 차량 snapshot 불변에서 실패한다. 지금 운영 공개는 NO-GO다.
- 비게시 Rules 후보는 보안 14/14·계약 26/26·서명 58/58·Emulator 32/32 PASS다. 사람/Claude 실데이터 게이트와 운영 게시 후 실계정 smoke test를 통과해야 하며, 그 전 Rules 게시·자동연동 활성화는 금지한다.
- 최신 read-only 대조는 Sheet 16곳·389대, v3-only 292건/288대다. 현재 Sheet 연결 239대(참조보호 31), 참조만 7대, Sheet·참조 없음 42대라 후보 Rules만 먼저 게시하면 B2B 재고가 사라진다. 자동 이관은 소유·삭제·가격 충돌 때문에 금지 상태다.
- `/api/products/bridge`와 `verifyActiveBearer`를 추가했다. 실로그인 사용자는 v3 상품을 서버에서 읽고 역할별로 투영받는다. 영업자·타 공급사에는 `vehicle_price`·`vin`·`account_number`·`price.*.fee/commission/fee_memo`가 내려가지 않고, 공급사는 자기 회사 원문만 볼 수 있다. 기존 v4 read/write와 Sheet CAS는 그대로다.
- `RtdbAdapter`는 인증 사용자의 v3 상품에 서버 브리지를 우선 사용하고, 현재 Rules에서 서버 환경이 준비되지 않은 경우에만 직접 read로 복구한다. 후보 Rules 게시 뒤 브리지까지 실패하면 strict health가 실패로 보고해 빈 목록을 정상으로 오인하지 않는다.
- 서버는 활성 재고와 계약·문의 참조 삭제 이력만 선별한다. 최신 운영 read-only 계산은 원시 약 5,700건 중 응답 **740건**으로 상한 2,000건 안이다. 신규 적대검증 16/16, Preview 비인증 API 403, 전체 핵심 회귀, build 30/30, 브라우저 영업자·공급사 5개 화면과 console log 0을 확인했다. 남은 순서는 **2역할 전용 QA 브리지/원가격리 smoke → 사람/Claude Rules 승인 → Rules 게시 → write/read smoke**다. 브리지 배포보다 Rules를 먼저 게시하지 말 것.
- Vercel Preview에만 `FIREBASE_SERVICE_ACCOUNT_JSON`을 Sensitive로 등록했다. 첫 Preview에서 `firebase-admin@14.2.0`의 `jwks-rsa@4/jose@6` CJS·ESM 충돌을 발견해 Admin SDK API 500을 재현했고, `firebase-admin@13.10.0` 고정으로 수정했다. `next@15.5.21`, 서버 `not-found` 경계 수정, SheetJS 0.20.3까지 반영한 최종 Preview `dpl_9H8TtHymfPhUcocr1gbvpnim66FQ`는 Ready다. 로그인 200·없는 경로 404·상품 브리지/기존 Admin API 비인증 403·error 로그 0이며, Production 환경·별칭은 미변경이고 새 API는 계속 404다.
- 중단된 npm `xlsx@0.18.5`는 SheetJS 공식 보안 수정본 `0.20.3` CDN tarball로 고정했고 write/read roundtrip 및 정산·Sheet 회귀를 통과했다. production `npm audit` 잔여는 critical 0 / high 3 / moderate 8이며 남은 high는 Next 내부 `postcss/sharp` 전이 항목과 그 집계다. `npm audit fix --force`나 Next 범위를 벗어난 무검증 override는 금지한다.
- 서비스계정을 현재 프로세스에만 주입한 `npm run check:b2b-release`는 의존성 호환 검사를 포함해 **23 PASS / 0 FAIL**이다. `scripts/smoke-b2b-product-bridge.mts`의 전용 영업자·공급사 ID token과 공급사 코드가 아직 없어 인증 200·원가격리 E2E만 남았다. 실제 운영 사용자를 임의 가장하지 말 것.

## 2026-08-03 신원·미확정 차량별 판단 원장

- `lib/domain/sheet-identity-decision.ts`와 `/api/sheet/identity-decisions`를 추가했다. admin 전용이며 현재 v3+v4 상품·계약을 서버에서 다시 확인하고 계약 차량과 해석 불가능한 원문을 fail-closed한다.
- `components/SheetSync.tsx`의 16대 신원 검토 모달에 유형별 `동일 차량 / 다른 차량 / Sheet 오류` 결정과 철회를 연결했다. 공급사·기존키·Sheet키가 각각 하나가 아니거나 계약보호인 행은 선택 불가다.
- 저장은 PII 없는 `v4/sheet_identity_decisions`와 `v4/audit_logs`뿐이다. raw·차번은 저장하지 않고 원문 전체 지문, 유형, 결정, 공급사, 기존키, Sheet키, 관리자, 시각만 남긴다. 운영 원장 read-only 집계는 0/0/0이며 실제 POST/DELETE는 실행하지 않았다.
- 중요: 판단 원장은 기록 전용이다. 자동/수동 Sheet 계획과 커밋은 이 타입을 import하지 않으며 복구·신규 생성·임시번호 유지/재발급·유입 제외·차단 해제 작업은 모두 0건이다. 적용기를 임의 연결하지 말 것.
- 신원 결정 15/15, 신원 검토 17/17, 기존 결정 15/15, 결정 dry-run 16/16, 가격승인 10/10, 가격행렬 29/29, 일일 21/21, Sheet merge 126/126, type/fonts/tokens/UI, production build 정적 페이지 30/30 PASS. 브라우저 콘솔 error 0이며 관리자 인증 E2E는 남았다.
- 다음 게이트: 공급사/운영자가 실제 15개 비계약 행을 판단 → 현재 Sheet·ERP·계약 재조회 dry-run → 결정 유형별 비파괴 v4 patch/참조 계획 → 사람·Claude 승인. 계약보호 1건은 별도 계약 상태 확인 전 계속 금지다.

## 2026-08-03 미확정 삭제·임시번호 신원 검토

- `lib/domain/sheet-identity-conflict-review.ts`가 공급사 미확정 삭제, 번호미정 식별변경, 같은 임시번호 신원서명 불일치를 제조사·모델·세부모델·트림·내외장색·최초등록/연식·연료 원자로 분해한다.
- 최신 read-only 결과는 전체 16대: 미확정 삭제 8, 식별변경 1, 신원불일치 7, 계약보호 1, 실행작업 0이다. 미확정 삭제 8대는 모두 삭제 1건↔Sheet 1행 단일 연결 후보이고 대상모호는 0이다.
- 미확정 삭제 변경원자는 최초등록/연식 8·세부모델 6·외장색 5·내장색 4·제조사 1이다. 식별변경 1대는 트림·내외장색·연료·최초등록/연식이 다르다. 신원불일치 7대는 트림·내외장색·연료 전부가 달라 자동 동일차 판정 금지다.
- 관리자 검증 화면에 16대 전용 모달과 TSV를 추가했다. 기존키·Sheet키·변경원자·계약보호·다음 확인만 표시하고 결정/적용 버튼은 없다. 모든 행은 applyAllowed=false다.
- 신규 sim 17/17, 결정 15/15, 결정 dry-run 16/16, 가격 10/10, 일일 21/21, Sheet merge 126/126, type/fonts/tokens/UI, production build 30/30 routes PASS. 운영 write·v3/Rules 변경 0건이다.
- 다음 작업자는 미확정 삭제 8대의 실소유·삭제의도와 임시번호 8대의 실제 동일차 여부를 사람/공급사 원본으로 확정하기 전 승인 원장이나 자동복구/재번호 로직을 추가하지 말 것.

## 2026-08-03 Sheet 소유권·삭제 결정 dry-run

- `lib/domain/sheet-conflict-decision-dry-run.ts`가 현재 검증 대상과 결정 원장을 대조해 미결정, 계약보호, 대상모호, 원장불일치, 과거원장, 기존귀속 유지, 참조이관 필요, 삭제유지, 복구후보, 병합별칭 복구금지로 분류한다.
- 소유권을 Sheet 공급사로 바꾸는 건 단순 상품 patch가 아니다. 상품키와 계약·채팅·견적·비공개 원가 참조 이관계획이 필요하다. 기존귀속 유지/삭제유지는 Sheet 유입 제외 정책 후보이고, 동일키 복구만 v4 overlay 후보 경로를 낸다.
- 모든 행은 `applyAllowed=false`, 요약은 `executableOperations=0`으로 고정했다. 수동·자동 Sheet 커밋은 여전히 결정 원장을 읽지 않으므로 hard block을 해제하지 않는다.
- 관리자 검토 모달에 dry-run 분류 수와 `실행작업 0`, `결정 dry-run TSV`를 추가했다. 병합 별칭 tombstone은 복구 선택지도 숨긴다.
- 운영 결정 원장을 Firebase CLI로 read-only 집계한 결과 total 0 / recorded 0 / revoked 0이다. 최신 96대는 비계약 미결정 94, 계약보호 2이며 현재 실행후보 0이다.
- 신규 dry-run sim 16/16, 결정 sim 15/15, 가격 10/10, 일일 21/21, Sheet merge 126/126, type/fonts/tokens/UI, production build 30/30 routes PASS. 운영 write·v3/Rules 변경은 0건이다.

## 2026-08-03 Sheet 소유권·삭제 건별 판단 원장

- 관리자 Sheet 검증 결과에 `소유권·삭제 결정` 검토 모달을 추가했다. 원본 충돌별 한 행으로 묶어 현재 ERP 공급사, 현재 Sheet 공급사, 관련 상품키, 계약보호/모호성, 기록된 결정을 표시한다.
- 선택지는 소유권 `기존 공급사 유지`/`현재 Sheet 공급사로 변경`, 삭제 `삭제 유지`/`동일 상품키 복구`다. 상품키 1개와 단일 Sheet 공급사가 확인되지 않거나 계약보호면 선택할 수 없다.
- `/api/sheet/conflict-decisions` GET/POST/DELETE는 admin Bearer와 서버의 현재 v3+v4 상품·계약 재검증을 요구한다. 저장은 PII 없는 `v4/sheet_conflict_decisions`와 `v4/audit_logs`뿐이고 v3·운영 Rules는 미변경이다.
- 중요: 이 원장은 판단 기록 전용이다. 수동·자동 Sheet 계획/커밋은 이 값을 읽지 않으므로 기록 후에도 소유권 39·삭제 57 hard block과 재고/tombstone 상태가 그대로다. 적용기나 차단 해제 로직을 임의 추가하지 말 것.
- 최신 후보는 비계약 소유권 38대와 동일 상품키 삭제 56대, 계약보호 선택불가 2대다. 실제 판단 수집 후 현재 데이터 재조회 dry-run과 차량별 v4 patch 계획을 만들고 사람/Claude 게이트를 받아야 한다.
- `sim-sheet-conflict-decision` 15/15, 가격승인 10/10, 일일 동기화 21/21, Sheet merge 126/126, type/fonts/tokens/UI, production build 30/30 routes PASS. 관리자 브라우저 인증이 없어 실데이터 모달·POST/DELETE E2E는 preview 운영 게이트로 남겼다.

## 2026-08-03 Sheet 가격기간 유지 승인 워크플로

- `기존 가격기간 누락` 가운데 계약과 무관한 차량만 관리자가 `기존 가격 유지`로 승인할 수 있다. soft-merge는 시트에서 빠진 과거 요율을 삭제하지 않고 ERP 값으로 보존한다.
- 승인 지문은 원문 전체에 묶여 있어 기간·차량·공급사 내용이 바뀌면 자동 무효다. 승인 원문/차번은 원장과 감사로그에 저장하지 않는다.
- 관리자 API: `/api/sheet/conflict-resolutions` GET/POST/DELETE. 활성 admin Bearer 인증과 서버의 현재 v3+v4 상품·계약 재검증을 요구하며, 계약락·계약중·진행계약은 승인 자체를 409로 차단한다.
- 저장은 `v4/sheet_conflict_resolutions`와 PII 없는 `v4/audit_logs`뿐이다. 운영 Rules와 v3는 건드리지 않았다.
- 수동 Sheet 커밋과 02:00 KST 일일 자동 동기화가 같은 승인 로직을 사용한다. 소유권·삭제 재등장·미확정 삭제·임시신원·서명 충돌은 승인 대상이 아니며 계속 hard block이다.
- 관리자 재고 화면은 승인대기/적용/계약보호 수, 공급사·영향별 승인 버튼, 철회 버튼, 전체 TSV를 검증 결과와 함께 표시한다. 서로 다른 95건을 한 번에 승인하던 전역 버튼은 제거했다.
- 최신 운영 read-only 결과는 가격 충돌 96건: RP023 새 기본가격 적용 확인 70, RP023 누락기간 유지 20, RP018 누락기간 유지 6이다. 계약보호 1건을 제외한 실제 승인가능 묶음은 각각 69·20·6건이다.
- 95건 승인 가정 후에도 소유권 39·삭제 재등장 57·미확정 삭제 8·번호미정 변경 1·임시번호 서명 7·계약보호 가격 1건 때문에 전체 동기화는 BLOCKED다.
- 소유권 39대는 단일 현재 Sheet vs 기존 타공급사 38대, 계약보호 1대다. 삭제 재등장 57대는 동일 상품키 삭제이력 56대, 계약보호 1대이며 관련 삭제 레코드 77건 모두 사유·처리자 표식이 없다.
- 소유권·삭제의 안전한 자동처리 후보는 0건이다. 현재 Sheet 우선이나 삭제 tombstone 자동복구를 임의 구현하지 말고 실소유·삭제의도 결정 후 별도 참조/복구 계획을 만든다.
- sim 승인 10/10, 일일 동기화 21/21, Sheet merge 126/126, type/fonts/tokens/UI, production build 30 routes PASS다.
- 로컬 브라우저는 관리자 인증이 없어 새 버튼의 실데이터 조작은 하지 않았다. preview 관리자 세션에서 세 승인 묶음과 승인→재검증→철회 E2E를 확인한 뒤 운영 활성화할 것.
- 현재 전체 출시 판정은 여전히 NO-GO다. 법적 운영자 사실값 6개, v3→v4 절연, 운영 Rules 사람/Claude 실데이터 게이트가 남아 있다.

## 2026-08-03 출시 보안 후보 Rules

- 운영 `database.rules.json`은 변경·게시하지 않았다. `scripts/ruleprobe/build-release-candidate.mjs`가 별도 비게시 후보를 만든다.
- 후보 정적 보안 13/13, 계약 26/26, 서명 58/58, Firebase Auth+RTDB Emulator 26/26 PASS다.
- `lib/firebase/rtdb-settlements.ts` private R1/R2 공통 메타에 `contract_code`를 추가해 원자 multi-location update 상태에서 계약 동결 금액·율 검증이 가능해졌다.
- 완료 전 계약은 영업자 취소를 유지하고 완료 계약은 관리자만 취소·환수하도록 UI·엔진을 함께 막았다. 영업자 차단 무변경과 관리자 환수까지 정산 E2E 22/22 PASS다.
- 남은 정적 출시차단은 법적 운영자 사실값 6개다. 운영 Rules 게시는 별도로 v3→v4 절연 이관이 끝나야 한다.
- 관리자 SDK 전수대조 결과 활성 v3 443건·v4 644건, 차량번호 v3-only 288개, 판매 가능 v3-only 289대다. child key 공통은 1개뿐이며 overlay 합산 기준 v3-only 재고가 계약 5건·채팅방 40건과 연결돼 단순 복사·삭제 금지다.
- 공통 1:1 차량 59대도 트림 57·연식 51·배기량/카탈로그 50·연료 37·공개가격 13대가 다르다. `policy`, `partner`만 v3-only 업무키 0이고 나머지 product/user/room/contract/audit_log 브리지는 유지해야 한다.
- 관리자 화면의 기존 child-key 기준 직접 복사 버튼은 제거했고 `migrateV3ProductsToV4(false)`도 즉시 차단한다. 승인된 자연키·참조 이관계획 없이는 다시 열지 말 것.
- 시트 없는 레거시 partner 껍데기가 같은 코드의 실행대상에 재유입되던 결함을 수정했고 Sheet merge 124/124 PASS다.
- 사용자 승인으로 운영 `v4/partners/RP023.deposit_rule=rent_multiple`을 CAS 저장했고 감사로그 `AL-1785729521849-rp023-deposit-rule`·재조회 일치를 확인했다. v3·재고 write는 없다.
- 최신 운영 설정 dry-run에서 16개 공급사·388대 수집은 PASS했다. v3-only 292건/288대는 Sheet현재 238대, 참조만 7대, Sheet·참조없음 47건/43대로 분류됐다.
- v3 절연 게이트는 진행계약 보호 4대, 시트 충돌 104대, 승인 후 동일 legacy key overlay 후보 132대, 시트 없음·이력참조 브리지 유지 5대, 시트·참조 없음 공급사 확인 43대다. 전체 커밋은 fail-closed라 적용 작업은 0건이다.
- 실제 서버와 같은 product_code overlay 병합 기준으로 활성 중복은 0건이다. 저장은 공급사 소유 충돌 39, 삭제 재등장 57, 미확정 삭제 8, 번호미정 변경 1, 임시번호 서명 7, 가격기간 누락 96건 때문에 BLOCKED다. 운영 설정·재고 write는 0건이다.
- 상세 작업량은 가격기간 96행·공급사 소유 90행·삭제 재등장 77행·미확정 삭제 8행·임시번호 서명 7행·번호미정 변경 1행이며 계약보호 4행은 자동수정 금지다. RP021은 실제 24대다.
- `audit-v3-only-sheet-coverage.mts --firebase-cli`는 서비스계정 없이 로그인된 Firebase CLI의 `database:get`만 사용해 같은 읽기 전용 감사를 실행한다. 원본 값·PII는 출력하지 않는다.
- 사람/Claude 실데이터 게이트 전 Rules 게시 금지. 상세: `docs/SECURITY_RELEASE_GATE_2026-08-03.md`.

## 2026-08-03 중복 재고 v4 patch dry-run

- 참조 기준 후보 62그룹을 공개 상품·비공개 원가까지 대조한 최종 dry-run은 적용후보 0그룹, 작업 0건이다. 차단 그룹에는 patch 작업 자체를 내보내지 않는다.
- 상품값 충돌은 81그룹이다. 연식 69, 연료 55, 배기량 47, 트림 27, 카탈로그 26, 파워트레인 25, 세부모델 13, 가격 8, 차량상태 7그룹이 주요 원인이다.
- 상품 account_number와 파트너 bank_account 불일치는 124그룹, 동일 중복값은 0그룹이다. 값은 출력하지 않았고 자동 복사·폐기하지 않는다.
- 명시 상품 allowlist의 빈 필드만 fill 후보가 되며, 레거시 원가·VIN·수수료는 public/private 분리 후 검사한다.
- 계약 snapshot, 채팅방 ID, messages 경로는 유지한다. 향후 중복 tombstone에는 _merged_into가 필수이며 상품 단건 조회는 예전 URL·찜 키를 대표 상품으로 복원한다.
- 관리자 화면에 중복 patch dry-run TSV를 추가했다. 파괴적 작업과 계약·비공개 원가 작업은 Claude 게이트로 표시하지만 현재 생성된 적용 작업은 0건이다.
- sim-product-duplicate-migration 25/25, sheet-merge 123/123, type/fonts/tokens, production build PASS. 운영 write·삭제·병합과 배포·커밋은 0건이다.
- 다음 순서: product.account_number 정본·폐기 정책 확정 → 81그룹의 차량정보·가격·상태 정본 확정 → dry-run 재실행 → preview 사후조회 → 별도 적용 승인.

## 2026-08-03 중복 재고 대표키·참조 이관계획

- 동일 공급사 중복 하위그룹 148개·300레코드를 계약·채팅방·견적·비공개 원가까지 읽기 전용으로 전수 확인했다. 공급사 간 충돌 차번의 동일 공급사 하위그룹도 포함한 수치라 앞선 전체차번 단위 84그룹보다 크다.
- 대표키 후보는 114그룹(공급사_차번 표준키 109, 정확 참조 최다 기존키 5)이며 추가 차단사유 없는 검토 후보는 62그룹이다. 자동삭제 승인 수가 아니다.
- 정확 참조는 계약 4, 채팅방 34, 견적 0, 비공개 원가 106레코드다. 차번만 남은 참조는 13그룹·17건으로 자동이관 금지다.
- 대표키 불명확 34그룹, 다중 진행계약 보호 1그룹, 공급사 소유권 충돌 하위그룹 63개가 남았다. 사유는 서로 겹칠 수 있다.
- lib/domain/product-duplicate-migration.ts, 관리자 인증 전용 GET /api/inventory/duplicate-plan, 재고 화면의 중복 이관계획 TSV 버튼을 추가했다. 쓰기 endpoint가 아니며 비공개 값은 반환하지 않는다.
- sim-product-duplicate-migration 13/13, sheet-merge 123/123, type/fonts/tokens, production build PASS. 운영 write·삭제·병합과 배포·커밋은 0건이다.
- 다음 게이트는 62그룹의 대표키 후보를 사람·Claude가 승인하고, 계약·채팅방·비공개 원가 참조별 v4 이관 patch와 사후검증을 별도 계획하는 것이다. 승인 전 삭제 금지.

## 2026-08-03 재고 중복·공급사 귀속 충돌 게이트

- Firebase 활성 재고 1,095대를 읽기 전용으로 전수 대조했다. 중복 차번은 129그룹·326레코드이며 같은 공급사 정리 후보 84그룹, 공급사 소유권 판단 43그룹, 계약보호 충돌 2그룹이다.
- lib/domain/sheet-conflict-report.ts와 관리자 Sheet 검증 화면에 상세 충돌 TSV를 추가했다. 각 행에 유형·판단·권장조치·차번·공급사·상품키·상태·출처·계약보호·원본충돌이 들어간다.
- 계약락 또는 진행 중 계약이 있으면 계약보호 · 자동수정 금지로 표시한다. 이 보고서는 삭제 실행기가 아니며 실제 write·삭제·병합은 0건이다.
- 처리 순서는 계약보호 8행 → 같은 공급사 84그룹의 대표키·참조 이관 → 공급사 소유권 43그룹 → 삭제/임시번호/서명/가격기간과 RP004·RP016·RP023 원본 문제 → 충돌 0 및 연속 두 번째 dry-run diff 0 확인이다.
- sim-sheet-merge 123/123, 일일 동기화 18/18, 재고 표시 27/27, fonts/tokens, production build는 PASS다. 사람·Claude의 참조 이관 및 소유권 결정 전 자동 중복 정리와 운영 동기화 활성화는 NO-GO다.

## 2026-08-03 매일 Sheet → 자체 재고 동기화

- 단건 업로드가 아니라 매일 02:00 KST 실행되는 서버 동기화를 추가했다: `vercel.json` → `/api/sheet/sync-daily` → `lib/server/sheet-daily-sync.ts`.
- 신규 Sheet 행은 `v4/products` 자체 재고가 되고 기존 행은 soft-merge된다. 빠진 행은 삭제하지 않고 시트 소유 `출고불가`, 재등장하면 복원한다.
- 재고 화면에서 사람이 바꾼 시트 상품 필드는 `_sheet_manual_fields`로 표시해 이후 Sheet 갱신보다 내부 값을 우선한다. 미수정 필드와 신규 필드는 계속 연동된다.
- 상품 create/patch 전체는 `v4/products` 부모 transaction 하나에서 CAS 검증 후 한꺼번에 반영한다. 한 건 충돌이면 부분 저장 없이 전체 취소한다.
- 실행 인증은 `CRON_SECRET`, 서버 자격증명은 `FIREBASE_SERVICE_ACCOUNT_JSON`, 회사는 `SHEET_SYNC_COMPANY_ID`, 활성 스위치는 `SHEET_DAILY_SYNC_ENABLED`다. `.env.example` 기본값은 false다.
- 관리자 전용 `/api/sheet/sync-status`와 재고 화면 상태 표시를 추가했다. 마지막 실행의 정상/실행 중/차단/실패/비활성, 시각, 신규·수정·부재 건수와 차단 사유를 보여준다. Firebase ID token + 활성 admin 역할을 서버에서 검증한다.
- 일일 sim 18/18, 기존 Sheet merge 123/123, 가격 29/29, 재고 표시 27/27, 업무목록 142/142, type/fonts/tokens, production build와 실행 API 401·상태 API 403·비활성 API 503 fail-closed를 통과했다.
- 운영 데이터와 Rules는 쓰지 않았다. 기존 실제 데이터 충돌과 `check:release` 차단 13개가 남아 있으므로 preview dry-run + 사람/Claude 승인 전에는 flag를 켜지 말 것. 상세는 `VERIFICATION.md` 최상단 참조.

## 2026-08-03 Claude 후속 검토 반영·현재 출시 게이트

- Claude가 찾은 레거시 `출고불가` 오판을 Codex가 수정했다. `출고불가 + status_label=시트에서 제거됨 + source=external_sheet|sheet`만 과거 시트 자동차단으로 복원하며, `일괄 출고불가`와 계약락·출처 없는 보류는 유지한다.
- 판정은 `sheet-merge`와 `sheet-sync-all`이 같은 helper를 사용한다. 사람이 상태를 바꾸면 레거시 라벨도 정리한다.
- `sim-sheet-merge` 120/120, 업무목록 142/142, 가격 29/29, type/fonts/tokens, production build 30 routes는 PASS다.
- 전체 sim 25종 중 22종 PASS. Rules 전용 3종(`contract-rules`, `contract-sign-rules`, `release-security-rules`)은 계속 FAIL이며 `check:release`는 차단 13·경고 2다.
- 출시 후보 `freepasserp4.vercel.app/inventory`의 16개 시트 읽기 전용 검증은 439행→406대, 신규 104, 상태변경 68, 내용수정 234, 부재차단 15로 나왔다. 현재 배포본의 동기화 버튼이 활성화돼도 누르지 말 것. 실제 write는 0건이다.
- 다음 순서: Rules 후보의 레거시 실데이터 사람/Claude 게이트 → 로컬 변경 preview 배포 → 16개 시트 재검증 → 레거시 자동차단 14대와 `일괄 출고불가` 2대 건별 확인 → 대량 diff 운영 승인. 상세 근거는 `VERIFICATION.md` 최상단 참조.

## 2026-07-27 파일 저장·Drive 백업 전환

- 신규 상품 사진·계약 서류·채팅 첨부의 본문을 RTDB data URL이 아니라 Firebase Storage에 저장한다.
- 상품·계약 파일만 Google Drive에 2차 백업하며, 백업 실패가 업무 업로드를 취소하지 않는다.
- ERP 삭제 시 Storage 원본만 삭제하고 Drive 백업은 보존한다.
- 기존 data URL 파일은 계속 읽을 수 있다.
- Drive OAuth 네 환경변수는 로컬과 Vercel Production·Preview에 설정됐다.
- `storage.rules`는 공유 버킷의 V3 7개 기존 경로와 V4 `/erp` 경로를 함께 보존한다.
  V3 호환 블록을 제거하거나 V4 규칙만 단독 게시하면 안 된다.
- V3 호환 + V4 `/erp` Storage Rules를 `freepasserp3` 운영 버킷에 게시했다.
- Google Drive API와 OAuth 테스트 앱을 활성화하고 `drive.file` 최소 권한의
  `FreepassERP4 자동백업` 루트 폴더를 앱 자체로 만들었다.
- 데스크톱 OAuth 클라이언트·테스트 사용자·오프라인 refresh token 구성을 완료했다.
- 로컬 `/api/drive-backup`은 `enabled:true`이며 실제 `uploadDriveBackup` helper로
  `상품/DRIVE-CONNECTION-TEST/` 사본 생성을 확인했다.
- Vercel Production·Preview 환경변수 4종은 모두 암호화 상태다.
- 상세 구조·설정·보안 경계·복구 절차: `docs/FILE_STORAGE_AND_DRIVE_BACKUP.md`

## 2026-07-27 회원·파트너 목록 규격 통일

- 기존 `WorkPage`의 좌측 목록/우측 상세·모바일 목록→상세 구조는 유지했다.
- 회원·파트너 목록행을 재고·문의·계약과 같은 아이콘 + 3줄 `FeedListRow` 규격으로 통일했다.
- 목록 첫 행의 사용자/파트너 등록, 검색 결과 조건 해제, 100명 단위 더보기와 500명 표시 상한을 적용했다.
- 사용자 목록은 역할·승인대기·활성·코드·소속을, 파트너 목록은 유형·수수료·코드·연락처를 표시한다.
- V3 `provider`·`sales_channel`·`operator`를 공급사·영업채널·운영사로 표준화해
  목록·정렬·필터·사업자번호 로그인 안내가 같은 값을 사용한다.
- 실제 관리자 세션에서 사용자 151명, 파트너 38명, 대량 목록·공급사 필터를 확인했다.

## 2026-07-27 오픈 게이트 재조사 결과

1. 출고불가 3대는 자동 해제하지 않는다.
   - `181허5280`: 공급사 `연카(RP011)` 외부 연동 상품. 2026-07-14 플랫폼 관리자가
     `vehicle_status`를 `출고불가`로 직접 변경한 감사기록이 있어 의도된 상태로 본다.
   - `101호9041`: 공급사 코드가 비어 있는 구형 수기/이관 상품. 원본 라벨은
     `출고가능`, 현재 상태는 `출고불가`이며 유일한 계약은 `계약철회`다.
   - `142호3663`: 공급사 코드가 비어 있는 구형 수기/이관 상품. 원본 라벨은
     `출고가능`, 현재 상태는 `출고불가`이고 2026-07-14 영업자 배정 기록과
     미완료 계약요청이 있다.
   - 뒤의 2대는 사업 담당자가 유지·재활성·중복정리 중 하나를 결정해야 한다.
2. 실계정 현황은 영업자 125명, 공급사 직원 17명이지만
   `agent_admin`과 `provider_admin`은 각각 0명이다.
   - 운영 계정을 임의 승격하지 말고 4역할 전용 QA 계정을 만든 뒤 격리 테스트한다.
3. 전자서명 데이터는 `signed` 2건뿐이며 전용 QA 계약
   `TMP-260727-01-3bhy`도 이미 계약완료다.
   - 기존 완료 계약을 되돌리지 말고 새 QA 계약/서명 요청으로 반려·해지·만료를 검증한다.
4. `freepasserp4` Vercel 최신 Production은 2026-07-25 배포이며 Ready다.
   - 로컬 `main`은 이 문서 커밋 후 `origin/main`보다 35커밋 앞선다.
   - `freepasserp.com`, `www.freepasserp.com`은 아직 `freepasserp3` 프로젝트에 연결돼 있다.
   - 원격 push → `freepasserp4` Production 배포 → 미리보기 스모크 →
     커스텀 도메인 전환 → 로그인·모바일·공개 링크 스모크 순서로 진행한다.

Rules 게시, 관리자 운영 E2E, 계약완료·차량잠금·건별/월별/VAT 정산·엑셀,
상품·정산 private 운영 마이그레이션, 27개 라우트 build는 완료됐다.
위 게이트가 끝날 때까지 추가 파일 분리와 UI 리팩터링은 동결한다.

## 2026-07-27 상품·정산 private 운영 적용 완료

- 상품 적용: 검사 `5,666대`, 민감필드 `4,890대`, private 쓰기 `4,890건`,
  public 삭제 `15,800경로`, 총 `20,690경로/52배치`, 안전제외 `0`.
- 상품 사후 dry-run: public 삭제 `0`. private `4,890건`은 보존돼 재실행 가능한 상태다.
- 정산 적용: 검사 `15건`, 금액 정산 `12건`, R1/R2/admin `12/0/0`,
  public 삭제 `24경로`, 총 `36경로/1배치`, 안전제외 `0`.
- 정산 사후 dry-run: 금액 정산 `0`, public 삭제 `0`, 계획경로 `0`.
- 관리자 월별정산은 private 병합 후에도 R1 `89,000원`, R2 `35,600원`,
  순수익 `53,400원`, 정산완료 1건을 정상 표시한다.
- 상품 목록은 적용 후에도 관리자 재고 `450대`, 상품찾기 `446대`로 유지됐다.
- 전체 자동검사와 production build `27개 페이지`를 마이그레이션 후 다시 통과했다.

### 백업

- 적용 전 전체 RTDB 최신 백업:
  `tmp/full-backups/freepasserp3-rtdb-full-2026-07-27-105542.json`
  - `36,726,130 bytes`
  - SHA-256 `B0E10DC39C8665426A9F5757C8E1445278BFBA9A85A7A11D6EB254CE10F855A2`
  - JSON 파싱 및 `products`, `v4`, `users` 루트 확인
- 상품 실행 동일 스냅샷:
  `tmp/migration-backups/freepasserp-products-backup-2026-07-27T01-59-41-464Z.json`
  - `27,606,076 bytes`
  - SHA-256 `41528721C391D1F8E2919BCD619CEB2BD47403E8714F47FD9355C6DF1C5F415E`
- 정산 성공 실행 동일 스냅샷:
  `tmp/migration-backups/freepasserp-settlements-backup-2026-07-27T02-02-57-856Z.json`
  - `14,393 bytes`
  - SHA-256 `312F660E00C07BBB8E27E9A1E53568DBC9144B0D769F253460D92DA87F3CD4A7`
- 백업은 민감 운영 데이터이므로 `/tmp/`를 Git에서 제외했다.
- 브라우저 다운로드 대신 로컬 개발 전용 API가 파일을 원자 저장하고 SHA-256을 반환한다.

### 정산 첫 실행에서 발견·수정한 결함

- 과거 정산 `ST-260701-001`의 누락된 `agent_channel_code`가 private 레코드의
  `undefined` 값으로 남아 Firebase update가 요청 전체를 거부했다.
- 거부 시점에는 단일 원자 update가 시작되지 않아 정산 데이터 변경은 없었다.
- private 레코드에서 중첩 `undefined`를 제거하고 적용 직전 잔존 여부를 검사하도록 수정했다.
- 누락 귀속값 회귀 테스트를 추가해 정산 마이그레이션 시뮬레이션 `12/12` PASS 후 재실행했다.

## 2026-07-27 운영 RTDB 전체 백업

- Firebase Console에서 `freepasserp3` Realtime Database 루트 전체를 JSON으로 내보냈다.
- 보관 위치:
  `C:\Users\user\Downloads\freepasserp3-rtdb-backup-2026-07-27-101030.json`
- 크기: `36,661,857 bytes`
- SHA-256:
  `AC8829FE447D878D9E9E180C91D42A399B336C7C72DA724994A8658FC3D5BC53`
- JSON 파싱 성공, 최상위 20개 키와 `products`, `v4`, `users` 존재를 확인했다.
- 임시 다운로드 원본과 보관본의 해시가 같은 것을 확인한 뒤 중복 임시 파일만 제거했다.
- 복구는 Firebase Console의 Realtime Database 데이터 루트에서 `JSON 가져오기`로 수행한다.
  기존 운영 데이터를 변경하므로 장애복구 승인과 작업 시간 확보 전에는 실행하지 않는다.

## 2026-07-27 상품 private 운영 dry-run

- 최종 검수 재실행: 검사 `5,666대`, 민감필드 상품 `4,890대`, 안전제외 `0`.
- 이동 계획: private 쓰기 `4,890건`, public 삭제 `15,800경로`, 총 `20,690경로/52배치`.
- 최초 미리보기 후 공급 피드가 갱신돼 검사 대상이 25대 늘었다. 실제 실행 직전 수치를
  다시 확인하고, 실행 시점의 동일 스냅샷 자동 백업을 반드시 다운로드한다.
- 실제 실행 시 읽은 동일 스냅샷을 `freepasserp-products-backup-*.json`으로 먼저 다운로드한다.
- 백업 콜백이 없거나 안전하지 않은 키가 있으면 실제 이동을 중단한다.
- 실행 중에는 완료 배치를 `/dev`에 표시하며, private 우선 병합과 null 삭제라 중단 후 재실행 가능하다.
- 상품 private 마이그레이션 시뮬레이션 15/15, typecheck PASS.
- 운영 적용과 사후 public 삭제 0 확인까지 완료했다.

## 2026-07-27 정산 private 운영 dry-run

- 실제 운영 미리보기: 검사 `15건`, 금액 정산 `12건`, 안전제외 `0건`.
- 이동 계획: R1/R2/admin `12/0/0`, public 삭제 `24경로`, 총 `36경로/1배치`.
- 현재 데이터 규모에서는 실제 적용이 RTDB 단일 원자 업데이트로 끝난다.
- 실제 실행 시 읽은 동일 스냅샷을 `freepasserp-settlements-backup-*.json`으로 먼저 다운로드한다.
- 백업 콜백이 없거나 안전하지 않은 키가 있으면 실제 이동을 코드에서 차단한다.
- 운영 적용과 사후 계획경로 0 확인까지 완료했다.
- 전자서명 링크의 7일 만료·해지·Rules 차단은 이미 구현·게시·검증된 상태다.

## 2026-07-27 최종 오픈 전 재검수

- typecheck, 폰트 가드, 13개 권한·채팅·계약·서명·정산·마이그레이션·차량마스터
  시뮬레이션: 전부 PASS.
- 별도 `.next-verification` 디렉터리 production build: 26개 페이지 PASS.
- 실행 중인 포트 4004 서버 유지, 주요 22개 경로 기대 상태코드 PASS.
- Chrome 관리자 세션으로 재고 `450대`, 채팅 `158건`, 계약 `34건`, 회원·파트너
  `146건`, 2026-07 정산 `1건` 로딩 확인.
- 관리자 정산은 새로고침 전후 R1 `89,000원`, R2 `35,600원`, 순수익
  `53,400원`과 로그인 세션이 동일하게 유지됐다.
- `/diag`에서 Firebase Auth 복원 후 `products`, `v4/products`, `policies`,
  `partners`, `contracts`, `v4/contracts`, `users`, `rooms` 읽기 모두 `ok`.
- 잘못된 `/sign` 토큰은 개인정보 없이 유효하지 않은 링크로 종료되고, 잘못된
  `/q` 상품 코드는 `견적을 찾을 수 없습니다`로 종료된다.
- `/data-check`의 230건은 사진·가격 등 콘텐츠 품질 항목이 대부분이다. 오픈 전
  사업 확인이 필요한 높은 항목은 완료 계약 없는 출고불가 3대:
  `181허5280`, `101호9041`, `142호3663`.
- 코드 오류나 서버 오류 로그는 발견되지 않았다. 운영 데이터 쓰기는 실행하지 않았다.

## 2026-07-27 실제 브라우저 E2E 완료 상태

- 운영 Firebase 프로젝트: `freepasserp3`
- 운영 Rules는 최신 `database.rules.json`으로 게시 완료했다.
- 게시 직전 운영 Rules는 `database.rules.PREV.json`에 백업했다.
- Firebase Rules Emulator 실제 쓰기 검증: 4/4 PASS
  - 관리자·소유 공급사 허용
  - 무관 영업자·필수 귀속 누락 거부
- QA 상품: `66소6317`, 상품코드 `veh_4qyabqnync`, 공급사 `스위치플랜 (RP014)`, 현재 `출고불가`.
- QA 계약: `TMP-260727-01-3bhy`, 현재 `계약완료`.
- 전자서명: 공개 링크 제출·관리자 승인 완료, `sign_status=서명완료`.
- 건별 정산: `ST_TMP-260727-01-3bhy`, 현재 `정산완료`.
  - R1 `89,000원`, R2 `35,600원`, 순수익 `53,400원`
- 월별정산 2026-07: 1건 및 위 합계 확인.
- 정산 엑셀: `C:\Users\user\Downloads\freepasserp.com_정산서_2026-07.xlsx`
  - `내역`, `공급사별`, `영업채널별` 시트와 상세·소계 검증 완료.
- VAT 정산서: `AS_2026-07_TMP-260727-01-3bhy` 저장 완료.
  - 청구 `97,900원`, 지급 `39,160원`, 당월수익 `58,740원`
- 운영 Rules 미게시로 중단됐던 계약은 `완료 처리 재시도`와 `finalizeContractIfReady`로 멱등 복구했다.
- 관리자 재고 편집에는 공급사 선택을 추가했고, 공급사 없는 신규 상품 저장을 차단했다.
- 계약 Rules의 컴파일 한계를 피하도록 불변 스냅샷 검증을 필드별 `.validate`로 분리했다.
- QA 데이터는 검증 근거로 보존 중이다. 정리하려면 계약·서명·정산·VAT 정산·상품의 연관 범위를 함께 확인해야 한다.
- 기존 공개 정산 금액은 운영 dry-run과 백업 안전장치까지 완료했으며 실제 이동 승인만 남았다.

## 2026-07-26 전자서명 공개 슬롯 권한 강화

- 기존 `contract_sign/{token}`은 링크만 존재하면 익명 사용자가 계약코드·금액·상태까지 임의 수정할 수 있었다.
- 공개 슬롯에 `agent_uid`, `agent_channel_code`, `provider_company_code` 귀속 스냅샷을 추가했다.
- 로그인 쓰기는 플랫폼 관리자, 소유 영업자, 소유 영업채널 관리자만 허용한다.
- 익명 쓰기는 기존 상태 `sent`에서 `pending_review`로 넘어가는 최초 제출 한 번만 허용한다.
- 계약코드·상품·조직 귀속·기간·금액 스냅샷은 생성 후 불변이다.
- 고객 입력 길이, 서명 데이터 크기, 제출 시간과 알 수 없는 필드 변경을 검증한다.
- `scripts/sim-contract-sign-rules.mts` 15/15, 계약 23/23, 영업 39/39, typecheck PASS.
- 공개 읽기는 무작위 토큰을 bearer 링크로 사용하는 기존 구조를 유지한다. 토큰 유출 시 조회 위험은 별도 만료/해지 설계가 필요하다.

## 2026-07-26 정산 private 마이그레이션 도구

- `lib/firebase/migrate-settlements-private.ts`에 V3·V4 정산 금액 이동 계획기와 dry-run 기본 실행기를 추가했다.
- 기존 private 값이 있으면 공개 값보다 우선 보존한다.
- R1/R2/admin private 쓰기 계획이 있는 정산만 공개 금액 삭제 대상으로 만든다.
- `/dev`에 미리보기와 별도 위험 확인이 필요한 실제 실행 버튼을 추가했다.
- `scripts/sim-settlement-private-migration.mts` 10/10, authorization 44/44, typecheck PASS.
- 라이브 dry-run과 실제 적용은 실행하지 않았다. 순서: Rules 게시 → RTDB 백업 → 관리자 로그인 → 미리보기 → 수치 확인 → 실제 실행.

## 2026-07-26 정산 금액 private 노드 분리 골격

- 신규 RTDB 쓰기는 `v4/settlements` 공개 진행정보, `settlements_provider_private` R1, `settlements_agent_private` R2, `settlements_admin_private` 관리자 금액으로 분리한다.
- 공급사 역할은 자기 회사 R1, 영업자는 개인 R2, 영업채널 관리자는 채널 R2, 플랫폼 관리자는 양쪽을 병합한다.
- 관리자 private `net_amount`가 없으면 R1-R2로 계산한다.
- 기존 공개 정산은 역할별 필드만 호환 병합해 화면 기능을 유지한다.
- Rules에 각 private 노드의 역할·조직 읽기와 create/update 경계를 추가했다.
- 권한·분리 시뮬레이션 44/44, typecheck 및 영업 생애주기 PASS.
- 미완료: 기존 공개 정산의 금액 필드 제거 dry-run 마이그레이션. 완료 전에는 과거 레코드의 SDK 원본 노출이 남는다.

## 2026-07-26 정산 금액 역할별 표시 경계

- 계약진행 정산 상세에서 영업 역할은 영업 지급(R2), 공급사 역할은 공급사 청구(R1), 플랫폼 관리자는 R1·R2·순수익을 본다.
- 정산 엑셀도 같은 역할 기준으로 열을 구성해 반대편 금액과 순수익을 내보내지 않는다.
- `provider_admin`은 기존 화면 역할이 `provider`, `agent_admin`은 `agent`로 투영되므로 조직 관리자도 각 조직 표시 정책을 따른다.
- typecheck·권한 35/35·영업 생애주기 39/39 PASS.
- 한계: RTDB 목록 부모 읽기는 필드 단위 비공개가 불가능하다. 현재는 UI·엑셀 노출 경계이며 네트워크 원본 격리는 아님.
- 다음 보안 작업: 정산 금액을 공급사/영업/관리자 private 노드로 물리 분리하고 마이그레이션한다.

## 2026-07-26 Firebase Rules 5역할 정렬

- 채팅방·메시지·계약·건별 정산 Rules를 조직 5역할 모델에 맞췄다.
- 일반 `agent`는 UID/개인 코드 쿼리만 가능하고 채널 쿼리는 `agent_admin`·레거시 `agent_manager`만 가능하다.
- `provider_admin`은 `provider`와 동일하게 자기 `company_code`의 채팅·계약·정산·재고·정책·비공개 상품에 접근한다.
- 계약 단계 필드는 영업 측 역할군과 공급사 측 역할군을 명시적으로 구분한다.
- 정산 귀속 필드는 생성 후 불변이며 정산 상태·금액·요율은 플랫폼 관리자만 변경한다.
- 역할 부여 UI는 포함하지 않았다.
- 권한 시뮬레이션 35/35, chat rules 40/40, contract rules 23/23 및 핵심 전체 회귀 PASS.
- 중요: Rules 파일만 갱신했으며 Firebase 운영 게시·Emulator·실계정 검증은 아직 하지 않았다.

## 2026-07-26 조직 권한 코드 골격 1차

- `lib/domain/authorization.ts`를 조직 권한 SSOT로 추가했다.
- `admin`, `agent_admin`, `agent`, `provider_admin`, `provider`를 세부 역할로 판정한다.
- 기존 화면은 `agent/provider/admin` 3역할을 계속 사용하고 `rawRole`로 조직 관리자 여부를 구분해 호환성을 유지한다.
- 로그인에서 `agent_manager`를 강제로 `agent_admin`으로 바꾸던 처리를 제거해 원본 역할을 보존한다.
- 일반 영업자는 개인 UID, 영업채널 관리자는 채널 전체, 공급사 역할은 회사 전체 범위로 어댑터 조회를 분리했다.
- 채팅·계약 화면과 메뉴 뱃지의 개인 `agent_code` 재필터를 중앙 권한 판정으로 교체했다.
- 역할 부여·초대·회원관리 UI는 사용자 요청대로 이번 범위에서 제외했다.
- `scripts/sim-authorization.mts` 26/26 PASS.
- 다음 필수 작업: Firebase Rules에서 `provider_admin`과 영업 관리자/직원의 명시적 조건을 동일하게 반영한다.

## 2026-07-26 조직·역할·권한 모델 확정

- 권한 기준 문서: `docs/AUTHORIZATION_MODEL.md`
- 표준 역할은 플랫폼 관리자, 영업채널 관리자, 영업자, 공급사 관리자, 공급사 직원의 5종이다.
- 영업채널 관리자는 자기 채널 전체, 영업자는 자기 UID, 공급사 관리자·직원은 자기 회사 전체가 업무 범위다.
- 채팅은 영업자 개인/영업채널 관리자 채널 전체/공급사 회사 직원 전체가 각각 조회·응대한다.
- 계약 단계는 조직 범위 안에서 영업 측과 공급사 측 담당 필드를 분리한다.
- 정산 상태 변경은 플랫폼 관리자 전용이며 역할별로 노출 금액을 분리한다.
- 현재 코드는 영업 관리자 역할을 `agent`로 축약하고 `provider_admin`이 없어 구현이 기준 모델과 아직 불일치한다.
- 다음 구현은 역할 세분화와 중앙 권한 helper부터 시작한다.

## 2026-07-26 계약 쓰기 권한·완료 조건 강화

- V4 계약의 컬렉션 전체 쓰기를 제거하고 `contracts/{contractId}` 참여자 단위 쓰기로 전환했다.
- 계약 코드·상품·영업자·채널·공급사와 기간·대여료·보증금·수수료율·지급률 스냅샷은 생성 후 불변이다.
- 영업자와 공급사는 각자 담당 단계 필드만 수정할 수 있으며 관리자만 양쪽을 교정할 수 있다.
- 전자서명 승인 후 영업자가 `provider_agreement_sent`를 확정하는 기존 시스템 예외는 유지했다.
- 신규 계약은 `계약요청`만 가능하고 `계약완료`는 5단계의 모든 체크가 완료된 경우에만 허용한다.
- `scripts/sim-contract-rules.mts` 23/23 및 전체 핵심 회귀 PASS.
- Firebase Rules 실게시·Rules Emulator·실제 역할 계정 검증은 아직 미완료다.

## 2026-07-26 채팅 쓰기 권한 경계 강화

- V3·V4 방 쓰기를 레코드 단위로 제한하고 `agent_uid`, `agent_channel_code`, `provider_company_code`를 필수·불변 소유 필드로 지정했다.
- 관리자는 모든 정상 방, 공급사는 자기 회사 방, 영업자는 자기 UID 또는 채널 방만 생성·갱신할 수 있다.
- 메시지는 신규 생성만 허용하며 `sender_uid === auth.uid`를 강제한다. 타방 쓰기·발신자 위조·덮어쓰기·삭제는 거부한다.
- V4 메시지가 V3 전용 레거시 방에도 정상 저장될 수 있도록 V3/V4 방 소유권을 모두 확인한다.
- `scripts/sim-chat-rules.mts`를 40/40으로 확장했고 typecheck·핵심 전체 시뮬레이션을 통과했다.
- 중요: Firebase Rules 실게시 및 실제 역할 계정 테스트는 여전히 미완료다.

## 2026-07-26 채팅 읽기 권한 경계 강화

- `database.rules.json`의 V3·V4 `rooms` 전체 인증 사용자 읽기를 제거했다.
- 관리자만 전체 조회할 수 있고, 공급사는 `provider_company_code`, 영업자는 `agent_uid` 또는 `agent_channel_code` 쿼리로 자기 범위만 조회한다.
- V3 메시지는 `messages/{roomId}` 중첩 구조를 유지하며 해당 방 소유권으로 읽기를 판정한다.
- V4 메시지는 `room_id` 쿼리를 의무화하고 해당 V4 방 소유권으로 읽기를 판정한다.
- `scripts/sim-chat-rules.mts` 21/21 PASS, 전체 기존 시뮬레이션·typecheck·JSON 파싱·diff 검사 PASS.
- 개발 서버는 포트 4004에서 유지 중이며 `/chat`, `/contract` HTTP 200을 확인했다.
- 중요: 규칙은 저장소에만 반영했고 Firebase 콘솔/CLI에는 게시하지 않았다. 실제 계정·에뮬레이터 권한 검증도 아직 필요하다.

공용 규격 = **`CLAUDE.md`**. 둘 다 이거 따름.
**철칙: 같은 파일 동시편집 금지. 편집 전 재확인 → 편집 → `npx tsc --noEmit`(0). 이제 매 push/PR = CI(typecheck·`npm run check:fonts`·sim3종·빌드) 자동 검증.**

---

## 2026-07-27 인수인계 — 4역할 실계정 및 채팅 실시간성 검증

- 전용 QA 조직의 영업채널 관리자·직원, 공급사 관리자·직원 계정이 모두 활성 상태이며 실제 로그인 검증을 마쳤다.
- 자격정보는 ignored `tmp` 파일에만 있고 Git에 포함하지 않는다. 문서에도 비밀번호를 기록하지 않는다.
- QA 영업채널 코드는 `sup_5rzn9q4mqm`, 공급사 코드는 `sup_qgd99qtj85`다.
- 기존 QA 계약은 `TMP-260727-01-yvjf`, 차량은 `99하0727`, 방은 `CH_veh_nbbb6vveg5_QA-2-qKGcudkM`이다.
- 메뉴·본인/채널/공급사 조회·타 조직 차단·양방향 채팅은 실브라우저와 운영 Rules 토큰 쿼리로 확인했다.
- 채팅 본문은 초기 빈 안내 오표시를 제거했고 5초 자동 갱신을 추가했다. 방별 메시지 캐시는 성공 후 해제한다.
- 감사로그는 `v4/audit_logs`가 아니라 운영 Rules가 이미 허용하는 루트 `audit_logs`를 사용한다.
- 설정 페이지 로그인명 hydration mismatch를 수정했다.
- QA 정산 private 노드의 허용/차단 매트릭스는 확인했지만 데이터가 0건이라 실제 R1/R2 금액 화면은 아직 미확인이다.
- 다음 우선순위는 계약 3/5→5/5 역할별 쓰기, 정산 생성 후 역할별 실제 금액 노출, 전자서명 반려·해지·만료다.
- 개발 서버는 재시작하지 않았고 PID `30312`, 포트 4004를 유지했다.
- `.mcp.json`은 사용자 파일이므로 계속 스테이징하지 않는다.

---
## 🗓 최신 세션 (2026-07-22, Claude 레인) — 다음 도구/PC 재개용 · 먼저 읽을 것

> 순서: `git pull` → 이 절 → 아래 2026-07-21 절. 외부 평가 78→86점(보안·UI 실코드 반영).

### ✅ 이번 세션 완료 (전부 커밋·푸시 · CI 초록)
1. **보안 — 계약 읽기 역할 스코프** (`rtdb-adapter.readContractsScoped`): admin=전량·provider=회사·agent=본인uid+채널. v3 `contracts`·`v4/contracts` 양쪽 스코프 쿼리. 고객 PII(이름·전화) 역할 격리(영업자 A가 B 고객 못 봄). rules `v4/contracts`·`v4/customers` `.read` 스코프 + `.indexOn`. 게시 전/후 모두 안전(부분집합만).
2. **보안 — 공급 원가 가림**: `vehicle_price` 를 영업자·손님 read 단(`list`/`get`)에서 제거. admin·provider만. ※완전격리는 `products_private` 이관 후(아래 ③).
3. **보안 — 자가승인 차단**: 가입=항상 `pending`(`auth.ts`), `approveUser`(게이트가 읽는 **최상위** `users/{uid}/status` 에 기록 — v4 아님), `members` 승인버튼, rules `users/$uid` status `.validate`(본인은 pending만·active는 admin). ⚠️ **신규가입 전원 관리자 승인 필요**(members에서 승인).
4. **보안 — 감사로그 위조방지**: `v4/audit_logs` `actor_uid === auth.uid`.
5. **UI/UX 구조통일**: `FW`(두께)·`FS`(크기) 토큰 SSOT 전면 적용(공유원자 6 + 페이지 38 = 346건). 800/900 퇴출. 목록 지브라·호버/선택 색구분·안읽음🟠/진행중🔵 액센트·실차명 해석(product·계약스냅샷·삭제매물 다단 폴백, "삭제된 차량" 명시). **`scripts/check-fonts.mts` 가드 + CI로 잠금** — raw fontSize/fontWeight 재난립 차단.
6. **정산 3자 E2E** (`scripts/sim-e2e-settlement.mts`, 15/15): 공급등록→영업 5단계 계약→정산(수수료 R1·지급 R2·순수익)→관리자 월정산(VAT).
7. **CI** (`.github/workflows/ci.yml`): push/PR마다 typecheck·폰트가드·sim(시트병합·차량락·정산)·빌드. 시크릿 불필요.
8. **버그**: 시트 재동기화 락 대량해제 · 로그인직후 매물 안뜸 · 약정주행 필터중복 · **계약코드 전역충돌(계약 스코핑 회귀 — 두 영업자 같은날 -01 충돌 → 접미사로 전역고유)** · vehicle-lock sim flaky(하네스 Date.now 충돌).
9. **견적·구독 임베드**: `/welrix`·`/sonogong` (외부 Vue 앱 iframe, 공개경로).

### 🔴 다음 (우선순위) — 90+ 로 가는 길
- **① Rules 콘솔 게시 (사장님 손, 미완)** — `database.rules.json` = 최신본(계약/고객 스코프·status validate·감사). 콘솔 → RTDB → 규칙 → 전체 붙여넣기 → 게시. **게시 전엔 어댑터 스코프만 동작(RTDB 직접 우회 미차단).** 게시 후 관리자 화면 정상 확인.
- **② 역할별 침투 테스트** — admin·provider·agentA·agentB·승인대기·비로그인으로 직접 접근해 격리 확인(게시 후).
- **③ `products_private` 물리 분리** — `vehicle_price`·`vin`·`price.*.fee` → `v4/products_private`(관리자만). 현재 어댑터 strip은 앱만 보호(v3 원가 인라인). v3 원가 이관 필요.

### v3→v4 종료(exit) 기준 — 브리지는 "이전 구조"지 최종 아님
현재: 읽기 = v3 라이브 ∪ v4 오버레이 필드병합, 쓰기 = `v4/` 만. 장점=무중단 이전. 장기부채=병합비용·이중추적·삭제복잡·어댑터 병목. **아래 충족 시 v4 단독 전환 검토:**
- [ ] 모든 활성 계약이 v4 스키마로 정착
- [ ] 핵심 상품 데이터 v4 저장(카탈로그·가격·상태)
- [ ] 회원 역할체계 v4 정착(status·role·company)
- [ ] 과거 v3 데이터 read-only 아카이브
- [ ] v3 신규 쓰기 완전 중단(신규는 v4 단독 생성)

권장: 각 엔티티에 `source_version`·`source_id`·`overridden_fields`·`migrated_at`·`migration_status` 부착 → 이관 추적. 일정 시점 후 **신규 데이터만이라도 v4 단독** 생성으로 전환.

---
## 전략 (사장님 결정 2026-07-18)

1. **외부시트 = 공급사마다 고유 시트.** v3 공용 종합/오토플러스 `source` enum 동기화는 **이식하지 않음**.
2. v4 기본 모델(이미 방향 맞음): `partner.sheet_url` + `mapping_profile` + `SheetSync`/`sheet-import` → 공급사별 학습.
3. **나머지 v3 운영기능은 v4 구조로 이식** (원자·`lib/domain`·`getStore`·엔진). v3 JS/HTML 덤프 금지.

---
## 구조 정리 — Cursor 진행

### ✅ Phase 1 — Messaging SSOT
### ✅ Phase 2 — Product 패밀리
### ✅ Phase 3 — 갓페이지 추출 (DONE_VALS→`isDone` SSOT · MasterFitSummary · 원자 adopt)
### ⏭ Phase 4 — Auth + store 단일화 (타 레인)
### ✅ Phase 5 — UI 사전 adopt or delete (레거시 Identity/SpecLine/PriceRows 등 삭제 · Chat/Sign/Finder 원자화)

---
## v3→v4 기능 이식 로드맵 (시트 전제 반영)

### ✅ Phase A — 공급사별 시트 아키텍처 강화
- `lib/domain/sheet-merge.ts` — softMerge / planProductUpsert / `commitSheetProducts` (빈칸→수기 덮어쓰기 금지, price 기간 병합)
- `lib/domain/sheet-adapters.ts` — generic|autoplus 레지스트리, `partnerSheetOpts`
- partner 필드: `adapter_id` · `header_row` · `sheet_tab`=gid
- `SheetSync` — 어댑터·헤더행·gid UI, 커밋=soft-merge upsert, PillTabs
- sim: `npx tsx scripts/sim-sheet-merge.mts` (10/10)
- **안 함:** v3 공용 external-sheet sync

### ✅ Phase B — 계약발송 허브
- 템플릿: `public/contract-template/*.html` (v3 embed API 재사용)
- `lib/domain/contract-send.ts` — buildPayload / draft / send→sign.ts
- `ContractSend.tsx` — iframe + 임시저장·PDF·발송
- `/contract` WorkPage 패널 **발송** 마운트
- 엔티티: `contract_draft`, `sign_draft_at`

### ✅ Phase C — 월별 관리자 정산 (VAT 정산서)
- `lib/domain/admin-settlement.ts` — BLOCKS·VAT10%·정산완료 불러오기
- `AdminSettlementSheet` + `/settlement` 탭 **VAT 정산서**
- 엔티티 `admin_settlement` (건별 settlement와 분리)

### ✅ 손님 공개 연결 (공유·서명)
- Auth: `/q` `/catalog` `/sign` 면제 (`public-access.ts`)
- Store: 공개면에서 RTDB 읽기 (`getSession || isPublicAccess`)
- Rules: `products`/`policies`/`v4/products|policies` `.read: true`
- 서명: `contract_sign/{token}` 공개 슬롯 읽기·제출 (`sign.ts`)
- **규칙 = 2026-07-21 재작성 완료.** `database.rules.json` 이 최신본이다. 아래 "세션 이력" 참고.

### ⏭ Phase D — 알림 + 관리자소통
### ⏭ Phase E — 회원 승인·스코프
### ⏭ Phase F — 카탈로그·OCR·P2

---
## 메모 — 모바일 하단바 (다음에 모바일 레인에서)

**결정 (2026-07-18)**
1. **하단탭/하단바 = 상시.** 모바일에서 숨기거나 스크롤에 사라지게 하지 않음. 네이티브 앱처럼 항상 고정.
2. **홈(파인더 `/`)에도 하단바 메뉴가 있어야 함.** 지금은 `Page`/`BottomNav`가 홈에 안 붙어 있거나(이전·홈만), 홈 전용 메뉴(재고·계약문의·정산·더보기 등)가 없음 → TopBar 드롭다운만으로는 부족.

**구현 방향 (할 때)**
- `BottomNav`를 **탭바 SSOT**로 확장: 홈 / 계약문의 / 재고(역할별) / 정산·더보기 등 주요 레인.
- 홈 화면(`app/page.tsx` finder)도 모바일에서 하단바 **상시 마운트** + `fp-main-pad` 하단 패딩 확보.
- 웹은 기존 콕핏(TopBar·사이드) 유지, **모바일만** 하단 탭 강조(`useIsMobile`).
- 규격: 터치 40+ · `R` · `C.*` · 햅틱(`haptic.nav`) · safe-area.

**하지 말 것**
- 홈만 하단바 없음 / 스크롤 시 자동 숨김 / 페이지마다 다른 하단 높이.

---
갱신: Phase3·5 규격통일 + 영업자 막힘 개선(2026-07-19: session.code=user_code, RTDB rooms/messages 스코프 조회, /q?a= 매칭, 발송 링크 UX).

---
## 🗓 세션 이력 — 2026-07-21 (Claude 레인, 다른 PC 인수인계용)

> 이 세션은 3자 동시 작업이었다: **Claude(나) + Cursor + 다른 Claude**.
> 파일 소유권 분리 = `CURSOR-TASKS.md`(Claude 소유·지시) / `CURSOR-STATUS.md`(Cursor 소유·기록).
> 다른 PC에서 이어받을 때 **먼저 `git pull` → 이 절 → CURSOR-STATUS.md 순으로 읽을 것.**

### ✅ 이번 세션에 끝낸 것 (전부 커밋·푸시됨, tsc 0)
1. **차량 락 재설계 버그 수정** (`474d62d`) — 계약금 체크 해제 시 영구잠금·자기잠금 데드락.
   원인 = 락에 주인이 없었음. `product.locked_by_contract` 도입, 락 쓰기를 `syncVehicleLock` 한 곳으로.
   검증 = `scripts/sim-vehicle-lock.mts` 23/23. 삭제보호는 `blockingContractFor`(락보다 넓음)로 분리.
2. **데이터점검 잠금 정합성** (`4778441`) — `/data-check` 에 매물상태 vs 계약 대조(읽기전용). 옛 규칙 잔재 출고불가 탐지.
3. **TopBar 하이드레이션** (`f454b00`) — 세션을 렌더 중 읽던 것 → 마운트 후로.
4. **진단 페이지 `/diag`** (`2cb57dc`) — RTDB 연결·권한·건수·사진해석을 화면에서 확인(콘솔 대신). 장애 시 여기부터.
5. **홈 총계 기준 통일** (`ef52fed`) — 사이드바 "총 N대"가 rows.length(출고불가 포함) → totalVisible 로. 상단바와 일치.
6. **역할 라벨 SSOT 통일 + settlementCalc 삭제 + 원자 사전 실측** (`ad3f328`).
7. **폐기 ETL 골격 삭제 + CLAUDE.md 락/데이터 규격 정정** (`a723490`) — 문서가 옛 규칙이었음.
8. **비밀번호 재설정 폼 잠김 버그** (`57e54a7`) — 성공 경로에 busy 해제 누락. v3·v4 코드 동일(기능은 있음).
9. **메뉴 워딩 의미화 + 관리자 전 메뉴 + members 게이트** (`1a2327b`).
   상품찾기/계약문의/계약진행 및 정산/재고관리/정책관리. 탭 축약=NAV_TAB_LABEL. 관리자는 TopBar 필터에서 규칙화(seesAll).
10. **가입 승인 게이트** (`45de7de`) — 사업자번호 매칭=즉시 active / 미매칭=pending(승인대기 화면). `AuthProvider` 중앙 게이트.
    `user.status` 필드 부활(is_active 와 의미 분리). 기존회원 보호 위해 `!== 'pending'` 블랙리스트.

### 🔴 다음에 할 일 — 우선순위 순

**① 라이브 RTDB 규칙 게시 (사장님 손 필요, 미완)**
- `database.rules.json` = 최신 재작성본. **아직 콘솔에 게시 안 됨(마지막 pending 가드 60곳 추가분).**
- 절차: `database.rules.json` 전체 → Firebase 콘솔 → Realtime Database → 규칙 → Ctrl+A → 붙여넣기 → 게시.
- ⚠️ Claude 는 firebase CLI 로그인이 이 환경에서 막힘(non-interactive 거부) → **직접 배포 불가.** 붙여넣기만이 경로.
- 게시 후: 관리자·영업자로 로그인해 매물목록·계약·정산·채팅·재고저장 정상인지 확인. 이상 시 즉시 되돌릴 것.
- 막은 것: v4 통째 덤프·삭제, 수수료율·정산금액 조작, 감사로그 열람, contract_sign 부모 읽기(주민번호 대량유출), 승인대기자 접근.

**② 계약·고객 스코프 조회 (어댑터 수정 필요)** — Phase E 후반
- 현재 `v4/contracts`·`v4/customers` 는 로그인 사용자면 **전부 읽힘**(고객 이름·전화번호).
- 규칙에 스코프 조건을 걸면 어댑터의 통째 `get()` 이 거부→`.catch(()=>[])`→빈 목록. 그래서 규칙만으론 못 조임.
- 해결: `rtdb-adapter.ts` 에 `readContractsLive`(역할별 orderByChild 스코프) 추가. **선례 = `readRoomsLive`.**
- 선착순 락은 `product.locked_by_contract` 로 이미 매물에 각인돼 있어, 계약을 못 봐도 락 판정 가능(스코프 걸어도 됨).

**③ 원가 필드 분리** — 1~2h
- `products` 의 `vehicle_price`(원가)·`vin`·`price.*.fee`(수수료)를 `v4/products_private/{코드}` 로 분리, 관리자 읽기 제한.

### ⚠️ 3자 작업 주의
- **dev 서버는 한 명만.** 같은 프로젝트에 서버 2개 띄우면 `.next` 청크 desync → 먹통. 복구 = `.next` 삭제 후 재기동.
- **`lib/tabbar.tsx`·`components/TopBar.tsx` = 모두가 건드리는 SSOT.** 편집 전 확인.
- Cursor T5(하드코딩 스윕)는 해제됨·미착수. 잔여 hex ~52·치수 ~29·raw 컨트롤 ~10.
- 편집 묶음마다 `npx tsc --noEmit` 돌리고 넘어갈 것(이번 세션에 import 누락으로 먹통 2회).

### 미결 판단 (사장님)
- 죽은 원자 28개: 코드 유지·문서만 정리 완료(CLAUDE.md "준비만 된 원자"). 실사용 유도/삭제는 판단 대기.
- 옛 규칙 `출고불가` 잔재 백필: `/data-check` 잠금정합성으로 목록만 노출. 자동복구 안 함(공급사 수기설정과 구분 불가).

갱신: 2026-07-21 — rules 재작성·가입승인·메뉴워딩·락버그. 다음 = ① rules 게시(붙여넣기) → ② 계약/고객 스코프 → ③ 원가분리.
# 진행 중 리팩터링

매물 검색 대형 파일 분리 작업의 최신 상태와 다음 순서는
`docs/REFACTOR_PROGRESS.md`를 먼저 확인한다. 해당 문서는 단계별 검증 결과와
다른 AI가 이어서 작업할 때 지켜야 할 호환성 원칙을 포함한다.

# AI 협업 방식

Claude Code(설계) → Cursor(구현) → Codex(독립 검증·수정·완료)의 역할과
인수인계 산출물 규칙은 `docs/AI_COLLABORATION.md`를 따른다.

가장 중요한 규칙은 최종 검증 기준이 설계 문서가 아니라 사용자의 원래 요구사항이라는
점이다. Codex는 원래 요구사항, `PLAN.md`, 실제 변경사항을 함께 비교해야 한다.

# 2026-07-26 최신 인수인계

- 브라우저 기본 `window.confirm`·`window.alert` 제거 완료.
- 공통 확인 UI는 `components/Toaster.tsx`의 `confirmDialog`, 오류 알림은 `toast` 사용.
- 적용 범위: 계약, 정책, 회원, 재고, 개발 도구, 로그인/가입.
- typecheck 및 7개 시뮬레이션/검증 스크립트 모두 PASS.
- 개발 서버는 포트 4004에서 유지 중이며 `/inventory` HTTP 200 확인.
- 서버 실행 중에는 `.next` 충돌 위험 때문에 production build를 실행하지 말 것.
- 현재 작업 트리는 의도된 미커밋 변경을 포함하므로 정리·reset하지 말 것.
- 공통 UI 분리 시작: `Drawer`, `Modal`은 `components/ui/overlays.tsx`로 이동 완료.
- `components/ui/index.tsx`는 782줄에서 731줄로 감소했으며 공개 import 경로는 그대로다.
- 다음 안전한 작업은 `ListRow`·`ListBox` 분리 후 폼 입력 묶음 분리다.
- `ListRow`, `ListBox`는 `components/ui/list.tsx`로 이동 완료.
- `components/ui/index.tsx`는 현재 706줄이며 다음은 기본 폼 입력 4종 분리가 안전하다.
- 기본 폼 입력 4종은 `components/ui/form-controls.tsx`로 이동 완료.
- `components/ui/index.tsx`는 현재 633줄이며 다음 후보는 버튼 3종 분리다.
- 버튼 3종은 `components/ui/buttons.tsx`로 이동 완료.
- `components/ui/index.tsx`는 현재 554줄이며 다음 후보는 레이아웃 원자 분리다.
- 레이아웃 원자 4종은 `components/ui/layout.tsx`로 이동 완료.
- `components/ui/index.tsx`는 현재 494줄로 500줄 미만이다.
- 다음 큰 작업은 `lib/domain/vehicle-master-match.ts`를 타입·표시 유틸부터 작은 단계로 분리하는 것이다.
- 차량 마스터 순수 타입 7종은 `lib/domain/vehicle-master-types.ts`로 이동 완료.
- 기존 타입 import 경로는 `vehicle-master-match.ts` 재수출로 호환된다.
- 매칭 실행 로직은 아직 이동하지 않았고 다음은 표시/정규화 유틸 경계를 검토한다.
- 표시·정규화 함수는 `lib/domain/vehicle-master-format.ts`로 이동 완료.
- 기존 함수 import 경로는 `vehicle-master-match.ts` 재수출로 호환된다.
- 매칭 본체는 현재 1,040줄이며 다음 후보는 스냅 추적·이력 묶음이다.
- 스냅 추적·원본·diff·이력은 `lib/domain/vehicle-master-snapshot.ts`로 이동 완료.
- `applySnap` 반영 정책은 본체에 남아 있고 기존 export 경로는 유지된다.
- 매칭 본체는 현재 1,001줄이며 다음 후보는 차량 필터·마스터 목록 탐색 묶음이다.
- 차량 필터·마스터 목록 탐색은 `lib/domain/vehicle-master-filter.ts`로 이동 완료.
- 매칭 본체는 현재 976줄이며 다음은 경로 감사·일괄 reconcile 의존성부터 분석한다.
- 차량 신호 수집은 `vehicle-master-signals.ts`, 선택 보조는 `vehicle-master-options.ts`로 이동 완료.
- 매칭 본체는 현재 915줄이며 모든 자동 검증과 서버 HTTP 200을 통과했다.
- 계속 진행 시 매칭 점수 핵심은 한 번에 옮기지 말고 정확 경로·감사 경계를 우선 분리한다.
- 정확 경로 엔진은 `vehicle-master-exact.ts`, 감사·일괄 변환은 `vehicle-master-operations.ts`로 분리 완료.
- 콜백 주입 구조라 순환 import가 없고 기존 공개 API도 유지된다.
- 매칭 본체는 현재 805줄이며 전체 자동 검증과 서버 HTTP 200을 통과했다.
- Finder 상품 우클릭 액션은 `features/finder/product-context.ts`로 이동 완료.
- `app/page.tsx`는 현재 644줄이며 다음은 상단 툴바 렌더링 분리가 안전하다.
- Finder 상단 툴바는 `features/finder/FinderToolbar.tsx`로 이동 완료.
- `app/page.tsx`는 현재 563줄이며 다음 후보는 결과 본문 렌더링 분리다.
- Finder 결과 본문은 `features/finder/FinderResults.tsx`로 이동 완료.
- `app/page.tsx`는 현재 511줄이며 결과 보기·Excel·페이징 동작은 검증 완료.
- 채팅 방 색인·표시 계산은 `features/chat/room-display.ts`로 이동 완료.
- `app/chat/page.tsx`는 435줄에서 372줄로 감소했고 `/chat` HTTP 200 검증 완료.
- 채팅 필터·정렬·미리보기 집계는 `features/chat/room-filter.ts`로 이동 완료.
- `app/chat/page.tsx`는 현재 347줄이며 자동 검증과 `/chat` HTTP 200 통과.
- 계약 필터·정렬·월 옵션은 `features/contract/contract-filter.ts`로 이동 완료.
- `app/contract/page.tsx`는 현재 355줄이며 `/contract` HTTP 200 검증 완료.
- 회원 필터·정렬·승인대기 집계는 `features/members/member-filter.ts`로 이동 완료.
- `app/members/page.tsx`는 현재 368줄이며 `/members` HTTP 200 검증 완료.
- UI/UX 통합 배치 완료: `ProductPreferences`, `MembersList`, `SettlementSummary`, `ChatRoomList`.
- 설정 302줄, 회원 353줄, 계약 337줄, 채팅 337줄.
- 네 페이지 HTTP 200, typecheck·전체 시뮬레이션·diff 검사 PASS.
- 다음은 UI와 분리해 `lib/firebase/rtdb-adapter.ts` 데이터 계층을 다룬다.
- RTDB 정리 완료: `rtdb-records.ts`, `rtdb-products.ts` 분리.
- `rtdb-adapter.ts`는 537줄에서 406줄로 감소.
- v3 읽기 전용·v4 오버레이 쓰기, 역할 스코프, 원가 마스킹 정책 유지.
- 남은 명시적 `any` 9건은 Firebase snapshot 동적 경계이며 무리한 캐스팅 제거는 보류.
- typecheck·전체 시뮬레이션·주요 화면 HTTP 200 통과.

## 2026-07-26 체크포인트 이후 작업

- 커밋 `6b1aa7f` (`refactor: split ERP feature and data modules`) 이후 작업이다.
- 공통 UI 내비게이션을 `components/ui/navigation.tsx`로 분리했다.
  - 이동: `NavBack`, `BottomNav`
  - 기존 `@/components/ui` import 경로와 props는 유지한다.
- 공통 피드백 UI를 `components/ui/feedback.tsx`로 분리했다.
  - 이동: `EmptyState`, `Loading`, `CenterNote`, `Message`
  - 기존 barrel export와 `MessageVariant` 타입 경로는 유지한다.
- `components/ui/index.tsx`는 내비게이션·피드백 구현을 직접 소유하지 않고 재수출한다.
- 검증: typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS, 홈·재고·계약·채팅·회원·설정 HTTP 200.
- 개발 서버는 포트 4004에서 유지 중이다. 서버가 켜진 동안 production build를 실행하지 않는다.
- 다음 안전한 UI 경계는 통계·요약 묶음(`Card`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`)이다.
- 차량 마스터 점수 계산은 핵심 정책이므로 UI 정리 이후 별도 커밋 단위로 다룬다.
- 공통 통계·요약 UI를 `components/ui/metrics.tsx`로 추가 분리했다.
  - 이동: `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`, `Step`
  - 공통 tone 색 계산은 모듈 내부 `toneColor`로 중복을 제거했다.
- `components/ui/index.tsx`는 393줄에서 309줄로 감소했다.
- 다음 안전한 경계는 칩·필터 UI(`PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`)다.
- 칩·필터 UI를 `components/ui/filters.tsx`로 분리했다.
  - 이동: `PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`, `ChipOpt`
  - 선택 햅틱, 모바일 제어 높이, disabled 상태, 카운트 표시를 유지한다.
- `FormGrid`는 순환 의존을 피하도록 leaf 모듈의 `ToggleChips`를 직접 import한다.
- `components/ui/index.tsx`는 309줄에서 191줄로 감소했다.
- 다음 후보는 `DetailShell`, `FormGrid`, `CopyBlock`의 각 책임별 분리다.
- 공통 UI 본체 최종 분리를 완료했다.
  - `components/ui/detail-shell.tsx`: `DetailShell`
  - `components/ui/form-grid.tsx`: `FormGrid`
  - `components/ui/copy-block.tsx`: `CopyBlock`
  - `components/ui/formatters.ts`: `won`, `fmtNumber`, `fmtPhone`
- `components/ui/index.tsx`는 191줄에서 32줄의 순수 barrel로 정리됐다.
- 기존 `@/components/ui` 공개 경로는 모두 유지되며 호출부 수정은 없다.
- 다음 큰 작업은 UI가 아니라 `vehicle-master-match.ts`의 신호 정규화와 점수 계산 경계를 별도 검증 단위로 다루는 것이다.

## 2026-07-26 차량 마스터 정규화 분리

- UI 분리 체크포인트 커밋: `b04e23b` (`refactor: split shared UI modules`).
- `unpackVehicleSignals` 구현을 `lib/domain/vehicle-master-normalize.ts`의
  `unpackVehicleSignalsEngine`으로 이동했다.
- 기존 `vehicle-master-match.ts`의 공개 함수는 의존성을 주입하는 호환 래퍼로 유지한다.
- 연식·배기 파서는 정규화 엔진 내부로 이동했고 본체의 중복 구현은 제거했다.
- `vehicle-master-match.ts`: 843줄 → 676줄.
- 새 정규화 엔진: 225줄.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- `/inventory` HTTP 200, 개발 서버 포트 4004 유지.
- 다음 안전한 경계는 모델·세대 후보 점수 계산이다. 매칭 결과 변화 없이 별도 엔진과 콜백 주입 구조로 다룬다.
- 모델 잠금·세대 후보 점수 계산을 `lib/domain/vehicle-master-score.ts`로 분리했다.
- 이동 정책: 제조사 그룹 잠금, 모델 유사도, 세대코드·서수, 연식 범위,
  연료, EV 전용 세대, 쿠페 불일치 패널티, 동점 정렬.
- `selectMasterEntry`는 선택 엔트리·점수·모델 유사도·잠긴 모델·제조사 풀·연식을 반환한다.
- variant·트림 선택과 최종 confidence 판정은 본체에 남겨 경계를 작게 유지했다.
- `vehicle-master-match.ts`: 676줄 → 625줄, 점수 엔진 148줄.
- typecheck·전체 시뮬레이션·마스터 전수 검증·diff 검사 PASS, `/inventory` HTTP 200.
- 다음 후보는 variant 점수 계산이다. 트림과 confidence는 아직 본체에 유지한다.
- variant 점수 계산을 `lib/domain/vehicle-master-variant.ts`로 분리했다.
- 이동 정책: 연료 일치·불일치, 배기량 거리, 구동, 가변 인승, 최빈 인승,
  터보 힌트, 마스터 variant 라벨 직접 일치.
- `modeSeat`, `modeSeatForModel`도 새 모듈로 이동하고 기존 공개 경로에서 재수출한다.
- `selectMasterVariant`는 선택 variant와 `seatMatters`를 반환한다.
- `vehicle-master-match.ts`: 625줄 → 574줄, variant 엔진 98줄.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- `/inventory` HTTP 200, 서버 포트 4004 유지.
- 다음 후보는 트림 선택과 trim conflict·confidence 판정이다.

## 2026-07-26 기능 완성도 전환: 계약·고객 조회 보안

- 구조 분리는 커밋 `0f5acc7`에서 종료하고 실제 권한 작업으로 전환했다.
- 어댑터의 `readContractsScoped`, `readCustomersScoped`는 이미 구현되어 있음을 재확인했다.
- `database.rules.json`의 v3 `contracts`, v4 `v4/contracts` 읽기를 역할별 쿼리로 강화했다.
  - 관리자: 전체
  - 공급사: `provider_company_code === 내 company_code`
  - 영업자: `agent_uid === auth.uid` 또는 `agent_channel_code === 내 채널`
- 고객은 기존 규칙과 어댑터 모두 `created_by === auth.uid`로 이미 스코프되어 변경하지 않았다.
- 정산 계약일자 조인은 `v4/contracts` 전체 get 대신 역할별 계약 병합 결과를 사용한다.
- 규칙 JSON 파싱·typecheck·전체 7개 시뮬레이션·diff 검사 PASS.
- 계약·채팅·정산 화면 HTTP 200.
- 중요: `database.rules.json` 변경은 아직 Firebase 콘솔/CLI에 게시하지 않았다.
  라이브 데이터 보호는 규칙 게시와 관리자·공급사·영업자 실계정 스모크 후 완료 판정한다.

## 2026-07-26 민감 매물 필드 분리 기반

- 계약 조회 보안 배치 커밋: `f285b66` (`security: scope contract reads by actor`).
- 비권한 상품 객체 마스킹을 `vehicle_price`에서 다음 필드까지 확대했다.
  - `vin`
  - `price.*.fee`
  - `price.*.commission`
  - `price.*.fee_memo`
- 월 대여료와 보증금 등 공개 가격 필드는 유지한다.
- `database.rules.json`에 `v4/products_private/{product}` 규칙 골격을 추가했다.
  - 관리자: 전체 읽기·쓰기
  - 공급사: `provider_company_code`가 자기 회사인 단건 읽기·쓰기
  - 영업자: 접근 불가
- `sim-agent.mts`에 원가·VIN·수수료 객체 마스킹 회귀 검사를 추가해 38/38 PASS.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- 홈·재고·계약 HTTP 200.
- 민감 필드 추출·공개 제거·권한 병합 helper를 구현했다.
- RTDB 신규 저장·수정·일괄 패치는 민감 필드를 `v4/products_private`로 분기한다.
- 관리자와 자기 회사 공급사는 private 레코드를 읽어 공개 상품에 병합하고, 영업자는 읽지 않는다.
- public/private 분리·병합 왕복 회귀 검사를 추가해 영업자 시뮬레이션 39/39 PASS.
- 기존 v3/v4 public 레코드의 민감 필드는 아직 마이그레이션하지 않았다.
  신규 write는 분리되지만 과거 네트워크 원본 보호는 마이그레이션·규칙 게시 후 완료된다.
- 다음 단계는 dry-run 가능한 민감 필드 마이그레이션 도구다. 자동 실행하거나 라이브 데이터를 삭제하지 말 것.

## 2026-07-26 민감 필드 마이그레이션 도구

- 이중 저장 배치 커밋: `843b07e` (`security: separate private product fields`).
- `lib/firebase/migrate-products-private.ts`를 추가했다.
- v3·v4 상품을 상품코드 기준으로 병합하고, 기간별 가격은 깊게 병합한다.
- 기존 private 값이 있으면 public 값보다 우선해 재실행 시 최신 private 데이터를 보존한다.
- private 쓰기 계획이 준비된 상품만 v3/v4 public 민감 경로 삭제 대상으로 만든다.
- 기본 API는 `migrateProductsPrivate(true)` dry-run이며 쓰기 0건이다.
- 관리자 `/dev`에 미리보기와 별도 위험 확인이 필요한 실행 버튼을 추가했다.
- 전용 순수 계획 시뮬레이션 `sim-product-private-migration.mts` 14/14 PASS.
- typecheck·기존 전체 7개 검증·규칙 JSON·diff 검사 PASS, `/dev`·`/inventory`·홈 HTTP 200.
- 현재 환경은 Firebase env가 없어 실제 dry-run조차 라이브에 실행하지 않았다.
- 다음 운영 순서: 규칙 게시 → 관리자 로그인 → `/dev` 미리보기 수치 저장 → 백업 → 실행 승인 → 적용 → 역할별 스모크.
- 공통 통계·요약 UI를 `components/ui/metrics.tsx`로 분리했다.
  - 이동: `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`
  - 공통 tone 색 계산을 모듈 내부 `toneColor`로 통합했다.
  - 기존 `Step` 타입과 `@/components/ui` 공개 API는 유지한다.
- 통계·요약 분리 후 typecheck·주요 6개 화면 HTTP 200·diff 검사 PASS.
- 다음 안전한 UI 경계는 선택·필터 묶음(`PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`)이다.

## 2026-07-26 전자서명 링크 생명주기

- 공개 전자서명 링크에 기본 7일 만료(`expires_at`)와 폐기(`revoked_at`) 상태를 추가했다.
- 발송된 링크가 유효하면 기존 토큰을 재사용하고, 만료·폐기된 링크는 새 토큰으로 재발급한다.
- 계약 화면에서 유효기간 확인, 재발송, 링크 폐기, 새 링크 발급을 할 수 있다.
- 익명 사용자는 유효한 발송 링크만 읽고 서명 제출할 수 있다. 만료·폐기 링크는 계약 소유자·채널 관리자·플랫폼 관리자만 조회할 수 있다.
- 기존 만료 필드가 없는 링크는 호환을 위해 읽을 수 있지만, 다음 인증 쓰기에서 만료 필드가 추가된다.
- 규칙 시뮬레이션은 23/23 PASS. Firebase 규칙은 아직 배포하지 않았다.
- 운영 적용 시 `database.rules.json` 게시 후 역할별로 유효·만료·폐기·재발급 흐름을 스모크 테스트해야 한다.

## 2026-07-26 전자서명 토큰·앱 경계 보강

- 신규 서명 토큰을 `Math.random()` 짧은 문자열에서 Web Crypto 기반 192비트 난수로 교체했다.
- 공개 슬롯의 `status === 'revoked'`도 폐기 시각 유무와 관계없이 비활성으로 판정한다.
- 앱의 공개 토큰 조회와 로컬 fallback 모두 만료·폐기 상태를 다시 검사한다.
- Rules가 허용하더라도 앱 경계가 비활성 링크를 계약 객체로 복원하지 않도록 이중 방어한다.
- 전자서명 시뮬레이션은 토큰 형식·100개 고유성·상태 폐기를 포함해 26/26 PASS.

## 2026-07-26 전자서명 승인 전이 잠금

- `approveSign`은 검토대기 상태, PNG 서명 데이터, 필수 동의 기록이 모두 있어야 실행된다.
- v4 계약의 `sign_status = 서명완료` 변경은 같은 계약의 공개 슬롯이 `pending_review`이고 서명·동의가 있을 때만 허용한다.
- 영업 측에서 `provider_agreement_sent`를 진행하려면 공개 슬롯까지 `signed` 상태여야 한다.
- UI 버튼을 우회해 계약 레코드를 직접 수정하더라도 제출 전 승인·약정발송 단계를 건너뛸 수 없도록 Rules와 도메인 양쪽에 조건을 둔다.
- 전자서명 상태 전이 시뮬레이션 33/33 PASS. Rules 실제 배포는 아직 하지 않았다.

## 2026-07-26 전자서명 필수 동의 증적

- 필수 동의 5개를 표시 문구가 아닌 안정적인 ID(`rental_terms,privacy,credit,gps,cms`)로 저장한다.
- 제출 시 ID를 고정 순서로 정규화하고 `sign_consent_version = v1`을 함께 기록한다.
- 동의 하나라도 빠지면 도메인 함수가 제출을 거부하며, 익명 RTDB 쓰기도 정확한 ID 집합과 버전을 요구한다.
- 기존 검토대기 건에 저장된 한글 동의 문자열은 승인 호환성을 유지한다.
- 약관 문구나 항목이 바뀌면 기존 `v1`을 덮어쓰지 말고 새 버전을 추가해야 한다.
- 전자서명 시뮬레이션 37/37 PASS. Rules 실제 배포는 아직 하지 않았다.

## 2026-07-26 전자서명 제출 데이터 검증

- 공개 제출 전 도메인에서 성명 1~40자, 국내 연락처 숫자 10~11자리, PNG 서명, 600KB 상한을 검사한다.
- RTDB Rules도 익명 `sign_signature`가 `data:image/png;base64,`로 시작하도록 제한한다.
- 익명 `sign_signed_at`은 서버 시각 기준 5분 전부터 5초 후까지만 허용한다.
- 개발자 도구나 직접 요청으로 SVG·임의 문자열 서명 또는 오래된 제출 시각을 주입할 수 없게 했다.
- 전자서명 시뮬레이션 43/43 PASS. Firebase Rules 실제 배포는 아직 하지 않았다.

## 2026-07-26 전자서명 증적 확정·공개 슬롯 정리

- Firebase 익명 제출은 계약 원본 쓰기가 거부되므로 증적이 먼저 `contract_sign` 공개 슬롯에만 저장된다.
- 계약 패널이 서명·동의 버전·제출 시각·본인확인 필드를 모두 병합하도록 수정했다.
- 승인 시 병합된 제출 증적을 v4 계약 원본에 먼저 저장한 뒤 공개 슬롯을 `signed`로 전환한다.
- 전환과 함께 공개 슬롯의 서명, 동의, 주민·면허·주소·비상연락처 등 제출 개인정보를 삭제한다.
- 공개 슬롯 정리에 실패하면 약정발송 단계로 진행하지 않고 오류를 반환해 증적 유실을 피한다.
- 전자서명 시뮬레이션 49/49 PASS. Firebase Rules 실제 배포·실데이터 검증은 미수행이다.

## 2026-07-26 전자서명 승인 중간 실패 복구

- 승인 함수는 `검토대기` 최초 승인뿐 아니라 증적이 보존된 `서명완료 + 약정발송 미반영` 상태를 멱등적으로 재개한다.
- 계약 패널이 이 상태를 감지하면 `약정 단계 복구` 버튼과 경고를 표시한다.
- 재개 시 계약 증적을 덮어쓰지 않고 공개 슬롯 `signed` 정리와 `provider_agreement_sent` 반영만 다시 수행한다.
- 서명 증적이 없거나 약정 단계가 이미 완료된 계약에는 복구 동작을 허용하지 않는다.
- 전자서명 시뮬레이션 52/52 PASS.

## 2026-07-26 전자서명 링크 해지 순서

- 링크 해지는 `contract_sign` 공개 슬롯을 먼저 `revoked`로 만든 뒤 계약 원본을 `미발송`으로 동기화한다.
- 공개 폐기가 실패하면 내부 상태를 변경하지 않아 사용자가 안전하게 재시도할 수 있다.
- 공개 폐기 후 내부 동기화가 실패해도 외부 링크는 이미 차단되어 보안상 열린 상태로 돌아가지 않는다.
- 폐기 패치의 상태·시각·기존 만료 보존 회귀 검사를 추가해 전자서명 시뮬레이션 55/55 PASS.

## 2026-07-26 전자서명 공개 개인정보 최소화

- 새 서명 링크를 만들 때 계약 원본의 고객 이름·전화번호를 공개 슬롯에 미리 복사하지 않는다.
- 서명 화면은 원래 해당 값을 자동 입력하지 않았으므로 사용자 흐름 변화 없이 링크 유출 시 노출 범위를 줄였다.
- 반려 후 공개 슬롯을 `sent`로 재개방할 때 이전 서명·동의·본인확인·주소·연락처·제출시각을 모두 삭제한다.
- 계약 원본의 내부 고객 정보와 승인 전 검토 흐름은 유지한다.
- 전자서명 시뮬레이션 57/57 PASS.

## 2026-07-27 회원·파트너 / 월별 정산 4프레임 통일

- 이 프로젝트에서 “4개 패널”은 카테고리 탭 4개가 아니라 데스크톱
  **`목록 1 + 업무 패널 3`**을 뜻한다. `WorkPage`의 `panes`를 3개 전달해 구성한다.
- `WorkPage`에 `listHeader`를 추가했다. 목록 종류나 월처럼 검색·정렬·필터보다
  상위인 제어를 목록 열 상단에 배치한다.
- `/members`
  - 사용자·파트너 전환을 역할/유형 필터 아래에서 목록 상단으로 이동했다.
  - 사용자: `기본정보 | 소속·권한 | 영업설정`
  - 파트너: `기본정보 | 정산·운영 | 데이터연동`
  - 기존 저장·승인·삭제·private 분리·백필 로직은 유지하고 필드 배치만 나눴다.
- `/settlement`
  - 별도 대시보드/전체 표 화면을 `월별 정산 목록 | 정산 상세 | 금액·지급 | 월 집계`로 교체했다.
  - 월 선택, 이전/다음 월, 검색, 상태 필터, 정렬 후 실제 정산 목록에서 건을 선택한다.
  - 월 집계는 검색 결과가 아닌 선택 월 전체를 기준으로 R1/R2·확정 순수익·환수를 계산한다.
  - 공급사별/영업채널별 소계, XLSX 이력 가져오기, 정산서 다운로드를 유지했다.
  - 기존 `AdminSettlementSheet`는 좁은 1/4 열에 넣지 않고 `DetailShell` 전체 오버레이로 연다.
- Chrome 실데이터 확인:
  - 사용자 151명, 파트너 38명과 각 3개 상세 패널 표시 PASS
  - 2026-07 정산 목록 1건 선택, 계약정보·R1/R2·월 집계 표시 PASS
  - VAT 정산서 진입/복귀 PASS
- `typecheck`, 폰트 검사, `scripts/sim-*.mts` 12개, 28개 라우트 production build PASS.
- 검증 빌드 산출물은 실행 중 `.next`와 분리한
  `tmp/verification-build/four-panel-20260727/`에 있다.
- 개발 서버는 재시작하지 않았고 포트 4004의 PID `30312`가 계속 실행 중이다.

## 2026-07-28 — 계약 목록 규격 복구 / 모바일 버튼 원칙

- 최우선 UI/UX 원칙은 **웹·모바일 업무 규격 통일**이다.
  정보 순서, 패널 의미, 상태, 버튼 기능과 순서는 같아야 하며 화면 폭에 따른 배치만 바꾼다.
- 데스크톱 `목록 1 + 업무 패널 3`은 모바일에서 `목록 → 상세`와 패널 전환으로 표현한다.
  모바일 전용 기능·요약·흐름을 임의로 만들거나 웹 기능을 임의로 누락하지 않는다.
- 별도 모바일 UX가 필요해 보이면 먼저 사용자에게 이유와 영향 범위를 보고하고,
  명시적인 지시가 있을 때만 추가한다.
- 과거 기록의 `SettlementSummary` 통합은 현재 설계에서 폐기됐다.
  계약 툴바 아래 `대기·완료·환수·순수익` 요약줄은 규격 외 UI라 제거했으며,
  같은 컴포넌트를 다시 연결하면 안 된다.
- 계약 화면의 고정 골격은 `계약 목록 1 + 업무 패널 3`이다.
  월별 정산·환수·순수익 집계는 `/settlement`가 담당한다.
- 모바일의 표면 액션 버튼은 공통 `Btn.mobileIcon` 또는 `IconBtn`으로 아이콘 전용 표시한다.
  `title`/`aria-label`은 필수이며 웹의 텍스트 버튼은 그대로 유지한다.
- 승인·삭제·계약 상태 변경도 모바일 표면에서는 아이콘으로 표시하되 기존 확인 절차를 유지한다.
  앱 내비게이션·카테고리 탭·상태 칩·확인 대화상자의 최종 선택은 텍스트를 유지한다.
- 모바일에서는 상품·계약·월정산의 엑셀/정산서/종합표 다운로드·내보내기를 노출하지 않는다.
- 회귀 방지는 `scripts/sim-phase12.mts`가 담당한다.
- typecheck·폰트 검사·전체 12개 시뮬레이션·28개 라우트 production build PASS.
- 아이콘 전용 표시는 `useIsMobile()` 분기에만 적용하며 데스크톱 텍스트 버튼은 그대로다.

## 2026-07-28 — 모바일 표면 액션 아이콘 전용 2차 통일

- `components/ui/buttons.tsx`의 `Btn.mobileIcon`을 공통 SSOT로 추가했다.
- 계약·전자서명·정산, 재고 편집·OCR·시트 연동·사진 메뉴, 채팅, 회원 승인,
  설정, 관심함, 목록 초기화·더보기·전체보기 액션을 모바일 아이콘 전용으로 전환했다.
- 웹에서는 기존 텍스트 버튼을 유지한다.
- 모바일 상품 엑셀, 계약 엑셀, 월정산 정산서, 재고 종합표 내보내기를 숨겼다.
- 선택 칩·탭과 확인 대화상자는 텍스트를 유지한다.
# UI 출시 검수 최신 진입점 (2026-08-03)

- 페이지별 버튼·입력·뱃지·필터·목록 정보의 존재 이유와 통일 결과는 `docs/UI_LAUNCH_AUDIT_2026-08-03.md`를 먼저 본다.
- UI 규격과 production build는 PASS다. 공개 출시는 최신 `docs/SECURITY_RELEASE_GATE_2026-08-03.md`의 법적 정보·운영 데이터·Rules 게이트 해제 전 NO-GO다.
- 새 UI 작업은 `npm run check:ui`를 포함해 type/fonts/tokens/build 게이트를 다시 실행한다.

## 2026-08-03 계약보호 충돌·브라우저 재검수

- Sheet 충돌의 계약보호 3행은 차량 `54나7852` / 계약 `TMP-260712-01` 한 건이다. 최신 Sheet는 RP021, 계약은 PT-0024를 가리킨다. 과거 6행 집계는 감사 스크립트의 v3/v4 child-key 거짓 중복이 포함된 값이다.
- 계약은 문의 체크 1개만 완료됐고 서명·채팅 메시지는 없지만 자동 만료 규칙이 없다. 운영자가 유지/취소를 결정하기 전 자동 동기화·병합·소유자 교체 금지다.
- Chrome `/contract` 재검수에서 `aria-expanded`가 텍스트로 노출되는 공통 `FilterGroup` 결함을 수정했다.
- `check:ui`가 동일 회귀를 정적으로 차단한다.

## 2026-08-03 Sheet 충돌 감사 병합 기준 정정

- 감사 스크립트가 v3/v4를 RTDB child key로 먼저 합쳐 `EXT_*` 원본과 `공급사_차번` overlay를 별도 활성 상품으로 계산하던 오류를 수정했다.
- 실제 앱·일일동기화처럼 정규화 후 `product_code` 논리키로 overlay 병합한다. 활성 중복 97건은 0건으로 정정됐다.
- RP021은 138행이 아니라 실제 충돌 24대다. 최신 Sheet 소유자는 전부 RP021이며 23대는 과거 PT-0024/PT-0026/엘씨렌트 상품과 소유 충돌, 1대는 진행계약까지 보호한다.
- 과거 공급사 키 22대에는 비공개 원가가 남아 있어 RP021로 복사 금지다. 기존 공개 상품만 tombstone하고 private·이력을 원래 키에 보존하는 정책은 사람/Claude 승인 전 실행 금지다.
- 중복 이관 도구가 `계약철회`를 종료로 보던 불일치를 수정해 미결 보호하도록 했고 시뮬레이션 26/26 PASS다.

## 2026-08-03 가격기간 충돌의 실제 사용자 영향

- 가격기간 누락 97대는 RP023 90대 + RP018 7대다. RP004의 54행은 삭제 재등장 작업량이므로 가격 충돌로 오해하지 않는다.
- `priceList` 기준 70대는 화면 기본가격 변경, 27대는 계약기간 자체 삭제다. 단순 키 이름 교체로 일괄 승인할 수 없다.
- RP023 `195주5304`는 진행계약 `TMP-260722-01`과 겹쳐 별도 운영 판단 전 자동수정 금지다.
- 관리자 시트 검증의 `상세 충돌 TSV`가 이제 `가격영향`과 `영향기간`을 포함한다. 이 TSV를 기준으로 공급사별 승인 여부를 결정한다.
- 승인 workflow 없이 hard block을 제거하거나 과거 가격키를 일괄 삭제하지 않는다. 가격·계약·데이터 정책 결정은 사람/Claude 게이트 대상이다.

## 2026-08-04 아이언렌트카 홈페이지 연동

- 사용자가 아이언렌트카 연동 동의를 받았다고 확인했다.
- 연동 뒤 `RP006`은 홈페이지가 단일 정본이며 기존 시트는 중지한다. 이중 writer 금지다.
- 전용 수집 어댑터·단일 정본 대조·관리자 preview API까지 구현했고 운영 write는 0건이다.
- 최신 논리키 실측은 홈페이지 49대, ERP 안전 매칭 21대, 신규 활성 3대, 웹 부재 차단 후보 4대, 실제 중복차번 0이다.
- 기존 시트와 홈페이지 가격은 같지 않다. 비교기간 50개 중 월대여료 동일 0개라 전환 시 홈페이지 가격 전체를 사용해야 한다.
- 최초 중복 3그룹은 v3 `EXT_*` child와 v4 canonical child를 별개로 센 오탐이었다. 공용 논리키 overlay 병합으로 수정했다.
- apply 경로는 구현됐지만 `IRONRENTCAR_SYNC_ENABLED` 기본 OFF라 운영 write는 0건이다. 후보 28건을 승인받기 전 플래그를 켜거나 호출하지 않는다.
- 구현 체크포인트는 `7f700a0`, Ready 상태의 Vercel Preview는 `dpl_ACpiQM8aFQ3BCP3yyW4Syvemgnt4`다. Production은 건드리지 않았다.

## 2026-08-04 최신 오픈 판정

- 현재는 NO-GO다. 과거 `LAUNCH_GONOGO.md`의 2026-07 GO 기록을 최신 판정으로 사용하지 않는다.
- 후보 Rules 정적 게이트의 유일한 코드 외 차단은 법적 운영자 정보 6개다.
- Vercel 서비스계정은 Preview에만 있고 Production에는 없다. 차량 claim 서버/클라이언트 플래그도 아직 없다.
- 운영 Rules는 후보가 게시되지 않아 현재 규칙 기준 보안 14건 FAIL이다. 백업·실데이터 확인·사람 게이트 없이 게시하지 않는다.
- 다음 순서는 운영자 정보 → Preview claim 플래그/5역할 smoke → 후보 Rules 게시/게시후 smoke → Production 서비스계정·플래그·재동의 → 최종 배포다.
- 아이언 적용/오픈 런북 구현은 `0b525e7`, Ready Preview는 `dpl_HJWJFvP7m4pSXXGCU93yA1Z4EZtZ`다. Production과 운영 데이터는 변경하지 않았다.

## 2026-08-04 아이언 연동 오픈 필수 전환

- 사용자가 아이언 홈페이지 연동을 포함해 오픈한다고 확정했다. 따라서 아이언은 출시 후 선택사항이 아니라 오픈 필수 게이트다.
- 관리자 재고 연동 화면에 read-only 미리보기와 명시 적용 UI를 추가했다. 홈페이지 전체/활성/판매완료/신차/중고, 수정·신규·부재차단 합계와 신규 3대·부재 4대 키를 적용 전에 표시한다.
- 재고관리 4프레임을 `목록 | 기본 | 운영 | 연동·반영`으로 명시했다. 플랫폼 관리자는 4번째 패널에서 전체 공급사를 원본별로 보고 신규·상태변경·정보수정 건수를 검증·반영하며, 공급사 역할은 자기 회사 원본과 재고만 다룬다.
- 사용자 정정에 따라 홈페이지·Google Sheet 같은 원본 종류는 내부 커넥터 차이로만 취급한다. 관리자 UI는 별도 아이언 카드 없이 한 공급사 상품 연동 목록에서 모두 `상품 검증 → 신규·상태변경·정보수정 확인 → 상품 반영`으로 동일하게 표현한다.
- 적용 요청은 화면의 확인 대화상자 뒤 preview revision과 수정·신규·부재차단 예상 건수, 서버 확인문구를 함께 보낸다. 서버는 카탈로그나 건수가 달라지면 전부 거부한다.
- 적용 버튼은 카탈로그 불완전·중복차번·차단 후보가 있으면 비활성이다. 적용 성공 뒤 roster와 재고를 갱신하며 RP006 Sheet 제외를 확인할 수 있다.
- `sim-ironrentcar-apply` 19/19, source 17/17, reconcile 17/17, sheet merge 129/129, type/fonts/tokens/UI PASS다.
- 남은 순서: 새 Preview 배포 → Preview에 `IRONRENTCAR_SYNC_ENABLED=true` → 관리자 로그인 미리보기 → 28건 명시 적용 → 활성 24대·RP006 시트 제외·감사로그 확인. Production과 운영 데이터는 아직 변경하지 않았다.
- 구현 커밋 `d295f60`을 Preview 브랜치에만 push했다. Preview 전용 `IRONRENTCAR_SYNC_ENABLED=true`를 추가해 재배포한 `dpl_FK3AaEaBcq1HqqCBzemeRYW6xgp7` / `https://freepasserp4-p3yv6tvbv-freepass-projects.vercel.app`가 Ready다. Production env·배포는 미변경이다.
- Preview 보호 통과 뒤 비인증 preview/apply는 모두 앱 403 `forbidden`, 브라우저 console error/warn 0이다. 새 Preview origin에 관리자 로그인 세션이 없어 실미리보기와 28건 적용은 실행하지 않았고 로그인 탭을 인계했다.
