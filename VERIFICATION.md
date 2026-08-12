# 독립 검증 결과

## 2026-08-12 전자계약·운영 UI 배포 게이트

결과: **PASS — production build 33/33 / 계약·약관·정책 회귀 통과**

- `NEXT_DIST_DIR=.next-publish npm run build`로 개발 서버 산출물과 분리해 Next.js production build 33/33 페이지를 완료했다.
- `npx tsc --noEmit`, `check:fonts`, `check:tokens`, `check:ui`, 변경파일 `git diff --check`를 통과했다.
- 전자계약 약관 44/44, 계약유형 60/60, 착한거래 발행 37/37, 서명 완료 Snapshot, 공급사 허브 3/3을 통과했다.
- 공유 부속서식 `contract-individual.html`은 `출고 시 주행거리`, `초과주행 요금`, 자동이체 문구를 의도적으로 정제해 착한거래 저장소 사본과 3곳이 다르다. 프리패스 본계약서 `rental-contract.html` 정본에는 영향이 없다.
- `database.rules.json` 변경은 커밋 대상에 포함하되, 운영 Firebase Rules 실게시는 사람의 실데이터 검증 전까지 수행하지 않는다. 이번 배포 대상은 Vercel 애플리케이션이다.

---

## 2026-08-12 전자계약 ↔ 계약회사 정책 왕복

결과: **PASS — 정책 신규·수정 진입과 작성 중 계약값 복원 / 미확인 보험값 저장 없음**

- 전자계약에서 연결 정책이 없는 프리패스 계약회사를 선택하면 `/policy?new=1&provider=OP001`로 이동해 `프리패스`가 선택된 신규 정책의 보험 패널을 바로 연다.
- 연결 정책은 있으나 필수값이 부족하면 해당 정책 코드와 보험 패널을 직접 여는 링크를 제공한다.
- 정책 이동 전에 작성 중인 고객·연락처·차량·금액·계약서 선택값을 탭 단위 임시영역에 보관한다. 정책 저장 시 방금 저장한 정책을 선택해 복원하고, 취소 시 기존 선택 그대로 전자계약으로 돌아간다.
- 실제 로그인 브라우저에서 `왕복보존테스트` 고객명, `010-1234-5678` 연락처, `테스트 차량` 모델명과 프리패스 선택을 넣고 정책 화면에 진입한 뒤 취소했다. 네 값 모두 복원되고 주소가 `/esign`으로 정리되는 것을 확인했다.
- 실제 로그인 브라우저에서 `프리패스 [selected]`, 신규 정책, 보험 패널, `공급사 확인 필요 15개` 안내를 확인했다. 보험증권으로 확인되지 않은 회사별 값은 입력하거나 저장하지 않았다.
- `npx tsc --noEmit`, `check:fonts`, `check:ui`, 변경파일 `git diff --check` PASS.
- 전체 production build는 이번 변경 파일이 아니라 기존 `app/dev/page.tsx → SheetSync → google-sheet-visible.ts(server-only)` import 경계에서 중단됐다. 4004 개발 서버는 재기동 후 정책 딥링크 HTTP 200을 확인했다.

---

## 2026-08-11 프리패스 장기대여 약관 V11 원본대조

결과: **CONDITIONAL PASS — 공정위 자동차대여 표준약관형 28개 조문 흐름 유지 / 실제 고객 발송 전 렌터카회사·법률 최종 승인 필요**

- 공정위 자동차대여 표준약관의 계약신청→체결→인도→사용·관리→보험·사고→반환·정산 흐름을 유지하고, 확보한 `표준 장기렌트계약서_2024_12_30.hwp`와 `계약서양식/장기계약서.pdf`를 조항별로 대조했다.
- 실제 장기대여 원본에서 공통 확인되는 추가운전자 사전승인·자격확인, 제작사 보증수리·리콜 협조, 임차인 추가장착품 관리, 블랙박스 사고자료 보존, 등록명의자인 회사에 먼저 청구된 금액의 자료기반 정산, 사전 반납평가기준·독립기관 평가, 채권양도 시 사용권 보호·변경통지를 보강했다.
- 보증금 무조건 몰수, 무최고 자동해지·회수, 현장출동이 없다는 이유만으로 보험처리를 전면 배제하는 문구, 회사 지정법원 전속관할 등 일방적이거나 분쟁 위험이 큰 원본 문구는 반영하지 않았다.
- 약관 제목을 `자동차 장기대여 약관`, 문서 버전을 `rental-v11-2026-08-11`로 변경했다. 인쇄/PDF 본문과 전자계약 전송본은 28개 조문 전체가 동일하다.
- 약관 자동 페이지네이션은 전체 내용량 기준 최소 A4 쪽수로 다시 배치한 뒤 넘침 시 안전 배치로 복구하도록 보완했다. 약관 3쪽 6개 단 사용 높이는 `896.4~931.9px / 956.4px`, 넘침 0건이며 전체 9쪽 PDF를 PNG로 확인해 표·약관·서명 페이지의 겹침·잘림·깨진 글자가 없음을 확인했다.
- 검증: `npx tsc --noEmit`, `npm run check:fonts`, 약관 44/44, 계약유형 60/60, 조항 배지 27/27, PDF A4 배치 PASS.

---

## 2026-08-11 상품찾기 공급사 열 고정 노출

- 엑셀 보기에서 필터 패널을 열거나 닫아도 `공급사` 열이 항상 노출되도록 수정했다.
- 필터 화면의 셀 좌우 패딩과 세부모델·파워·트림 폭을 압축해 공급사 추가분을 흡수했다.
- 화면 폭이 부족할 때도 공급사보다 덜 중요한 선택 열을 먼저 숨기도록 열 축소 우선순위를 조정했다.
- 로그인된 실제 브라우저에서 필터를 연 상태로 `공급사` 노출, 가로 스크롤 없음, 기존에 빠지던 파워·옵션 열 재노출을 확인했다.
- `sim-excel-provider-column` 3/3, `tsc --noEmit`, `check:fonts` PASS.

## 2026-08-11 관리자 상담데스크

- 관리자 `/chat`을 목록 390px + 채팅 중심 화면으로 분리하고, 영업자·공급사의 기존 4패널 화면은 유지했다.
- 차량 요약은 대표사진·차량명·차번·상태·공급사·담당자만 표시하며, 사진·PDF 첨부 모아보기를 채팅 상단에 노출했다.
- 관리자 기본 진입은 `내 차례` + `오래 기다린 순`으로 설정하고 실제 운영 데이터에서 선택·첨부·입력 UI를 확인했다.
- `sim-admin-queue`, `sim-chat-attention`, `sim-chat-room-dedupe` PASS. `tsc --noEmit`, fonts, 변경파일 `git diff --check` PASS.

## 2026-08-11 전체메뉴 진입점 명확화

- 데스크톱 햄버거를 `전체메뉴`, 모바일 메뉴를 `더보기`로 명시하고 열림 상태는 `닫기`로 통일했다.
- 실제 로그인 화면에서 데스크톱 메뉴 열기와 모바일 390px 표기를 확인했다.
- `tsc --noEmit`, fonts, 변경파일 `git diff --check` PASS.

## 2026-08-11 전체 주행거리 원단위 표시

- 목록·카드·상품찾기 표·공유문구·상세페이지의 주행거리를 모두 실제 km로 표시한다. 예: `326km`, `12,450km`.
- `sim-agent` 회귀 테스트 45/45, `tsc --noEmit`, fonts, 변경파일 `git diff --check` PASS.

## 2026-08-10 프리패스 전자계약 발송센터 v1 완성

결과: **CONDITIONAL PASS — 기능 구현·정적/회귀 검증 완료 / 법률 승인과 운영 실계정 왕복만 배포 게이트로 남음**

### 사용자 원요구 충족

- `/esign` 첫 화면을 프리패스 자체 `전자계약` 발송센터로 교체했다. `Excel 계약서 넣기`를 주 진입점으로 두고 `직접 작성`, `ERP 계약에서`까지 세 경로를 제공한다.
- 세 경로는 별도 발송 로직을 만들지 않고 동일한 계약 레코드 → 검증 → 발행 Snapshot → 고객 링크 → 관리자 검토 → 봉인 PDF 엔진을 사용한다.
- 독립 경로는 `contract_source=excel|direct`를 명시하며 ERP의 `provider_agreement_done`을 가짜로 채우지 않는다. ERP 경로만 기존 약정 완료 게이트를 유지한다.
- 업체 대표자·주소·연락처·입금계좌는 파트너 고정값으로 한 번 저장하고, 계약마다 고객·차량·기간·대여료·보증금·정책과 예외값만 확정한다.
- 목록은 `발송대기 / 서명중 / 확인필요 / 완료` 네 상태와 고객·차량·렌터카사·대여료·기간·상태 6개 핵심값만 표시한다.
- 완료 계약은 재발행·링크 해지·초안 생성을 막고 읽기 전용으로 유지한다. 인도 확인, CMS, 연대보증은 본계약과 별도 후속 절차 및 별도 문서로 분리했다.

### 데이터·보안 경계

- 발행 시 계약·정책·업체·템플릿 값을 Snapshot으로 동결하고 이후 원본 변경으로 고객 화면이나 완료 PDF를 재조립하지 않는다.
- Excel 원본은 메모리에서만 읽고 저장하지 않는다. 주민등록번호·면허번호는 import 대상에서 제외하며 개인·개인사업자·법인 양식 인식 실패는 임의 추정하지 않고 차단한다.
- 고객 링크 원문은 256-bit 난수 토큰이며 서버에는 SHA-256 해시만 둔다. 신분증·셀카·서명·본인확인 입력은 공개 계약 노드가 아니라 서버 전용 `v4/esign_private`와 비공개 Storage에 저장한다.
- 고객 제출만으로 완료시키지 않고 관리자가 신분증·셀카·서명을 확인해 승인할 때 완료 PDF·문서 SHA-256·공개 검증 해시를 봉인한다.
- 신규 write는 `v4/`만 사용했고 `database.rules.json`은 수정·게시하지 않았다.

### 검증 결과

- `npx tsc --noEmit`, `npm run build`(Next.js 15.5.21, 33/33), `check:fonts`, `check:tokens`, `check:template-drift` PASS.
- source gate, Excel adapter, Snapshot 불변성, 본계약 문서 경계, 자체 전자계약 화면/경로, 발행 잠금, 업체 템플릿 프로필 PASS.
- 계약 유형 60/60, 약관 50/50, 필드맵 13/13, 템플릿 프로필 10/10, 발행 잠금 5/5 PASS.
- `http://localhost:4004/`, `/esign`, `/sign/not-a-valid-token` production 서버 HTTP 200. 최신 build로 4004를 재기동했다.
- `check:ui`는 이번 전자계약 파일 오류 0이며 기존 dirty worktree의 `ChatThread`·`ConsultPanel`·`DevRoleSwitch` 3건만 남는다. 해당 파일은 이번 범위에서 수정하지 않았다.

### 배포 전 사람/Claude 게이트

- 표준계약서 3벌은 여전히 `sample-v1`이므로 운영 발행은 코드에서 잠겨 있다. 법률·실무 승인본과 개인정보 보유·파기정책을 확정한 뒤 잠금을 열어야 한다.
- 관리자 실계정과 테스트 고객으로 3종 × 인수/반납의 `발행 → 모바일 본인확인/서명 → 관리자 승인 → 완료 PDF 다운로드/해시 검증` 왕복을 각 1건 수행해야 한다.
- 현재 본인확인은 외부 본인인증기관 자동 판정이 아니라 관리자의 신분증·셀카 수동 대조 방식이다.

---

## 2026-08-10 프리패스 자체 전자계약 MVP

결과: **CONDITIONAL PASS — 자체 발송·서명·관리자 확정·봉인 PDF 흐름 구현 / 실고객 발송 전 사람 게이트 필요**

- 계약서관리 ③을 `프리패스 전자계약 발송`, ④를 `전자계약 진행상황`으로 교체했다. ③에서 프리패스 계약 데이터와 표준계약서 3벌·인수/반납 조합을 검증해 고객 링크를 발행하고 A4 미리보기/PDF를 만든다. ④에서 열람·제출·반려·관리자 확정·완료 상태, 신분증·셀카·서명, 완료 PDF와 공개 봉인 해시를 확인한다.
- 고객 `/sign/[token]`은 계약 조건·전체 약관을 확인한 뒤 성명·연락처·신분증·셀카·필수동의·서명을 제출한다. 큰 휴대폰 사진은 브라우저에서 자동 압축하며, 신분증·셀카·서명·개인정보는 공개 계약 노드가 아니라 서버 전용 `v4/esign_private`와 비공개 Storage에 저장한다.
- 발송 링크는 원문이 DB 키가 되지 않는 256-bit 난수 토큰이고 서버에는 SHA-256 해시만 저장한다. 고객 제출만으로 계약완료가 되지 않으며 실제 플랫폼 관리자가 신분증·셀카를 검토해 승인할 때만 서명시각·봉인·검증 레코드를 확정한다. 신규 write는 모두 `v4/`이며 `database.rules.json`은 변경·게시하지 않았다.
- 완료본은 기존 A4 계약서 HTML에 동결 스냅샷과 서명을 주입해 PDF로 렌더링하고 SHA-256 문서 해시를 남긴다. 공개 `/verify/[sealHash]`는 개인정보 없이 계약번호·서명확정시각·봉인/문서 해시만 검증한다.
- 기본 `npm run dev`는 착한거래 서버를 기다리지 않고 프리패스 4004만 시작한다. 기존 외부 연동 실행은 `npm run dev:with-chakhandeal`로 보존했고, 과거 착한거래 발행 건은 읽기 호환만 유지한다.
- 검증: `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, production build 33/33, 자체 전자계약 보안 회귀, 계약유형 60/60, 필드맵 13/13, 약관 50/50 PASS. 무인증 API는 관리자 상태 401, 신분증/PDF 403, 잘못된 고객 토큰 404를 반환했고 재시작한 `http://localhost:4004/sign/not-a-valid-token`은 HTTP 200으로 정상 렌더링한다. `check:ui`는 이번 전자계약 파일 오류 0이며 기존 `ChatThread`·`ConsultPanel`·`DevRoleSwitch` 3건만 남는다.
- 실발송 전 필수: ① 법률·실무 승인된 표준계약서 3벌과 개인정보 보유·파기정책 확정 ② 관리자 실계정으로 3종×인수/반납 링크 발행→고객 제출→승인→완료 PDF 왕복 테스트 ③ 운영 PDF 런타임의 Chrome 제공 확인이다. 현재 본인확인은 외부 인증기관 자동 인증이 아니라 관리자의 신분증·셀카 수동 대조 방식이다.

---

## 2026-08-10 계약서 상세 `목록` 복귀 버튼

결과: **PASS — 긴 데이터 패널 상단에서 즉시 목록 복귀**

- 계약서관리 ② 프리패스 데이터의 기존 계약 상세과 신규 입력 헤더에 공용 `NavBack(kind=list)`을 추가했다.
- 웹은 `PaneHead` 우측, 모바일은 상세 패널 최상단 고정 영역에 표시한다. 기존 공통 하단독의 목록 동작도 유지한다.
- 기존 계약에서 `목록` 클릭 시 선택을 해제하고 계약 목록으로 복귀하며, 신규 입력에서는 입력 화면만 닫고 목록으로 복귀한다.
- 브라우저에서 기존 계약 상세·신규 입력 모두 `목록` 버튼 노출, 기존 계약 → 목록 복귀, 콘솔 오류 0건을 확인했다.
- `npx tsc --noEmit`, `npm run check:fonts` PASS.

---

## 2026-08-10 신규 계약서의 기존 계약 검색·불러오기

결과: **PASS — 진행중은 계약서 발송 / 완료는 인도일 관리**

- 신규 계약서 입력 상단에 전체 계약 원장을 대상으로 하는 `계약 진행중`·`계약완료` 탭과 차번·계약번호·고객명 검색을 추가했다.
- 계약진행중 선택은 계약서 발송 대상으로 원래 계약을 그대로 연다. 기간·금액 확정 전 계약도 전체 원장에서 검색할 수 있다.
- 계약완료 선택도 새 계약으로 복사하지 않고 원래 계약을 연다. 이미 발송된 계약의 착한거래 진행상황에서 인도일을 입력·확인하는 흐름이다.
- 완전히 새로운 계약만 신규 입력폼에서 별도 생성한다.
- 브라우저에서 신규 패널의 탭·검색·최근 8건 표시를 확인하고 `CT-TEST-01` 진행 계약을 검색해 기존 계약 상세로 이어지는 것을 확인했다. 검증 중 신규 계약 저장은 수행하지 않아 운영 데이터 write는 0건이다.
- `npx tsc --noEmit`, `npm run check:fonts`, 계약유형 60/60, 필드맵 13/13 PASS. 현재 로컬 원장에는 `contract_status=계약완료` 건이 없어 완료 탭은 빈 상태까지만 브라우저로 확인했다.

---

## 2026-08-10 계약서관리 ③·④ 사용자 원본대조

결과: **로컬 화면 교체 PASS / 운영 embed 인증 미구현으로 Production NO-GO**

- 착한거래 `ContractStudio` 본체에 `embedPanel=link|progress` 표시 모드를 추가하고, `/labs/contract-studio/embed/link|progress`에서 실제 ②·③ JSX/CSS만 렌더링한다.
- 프리패스 ③·④는 자체 `ChakhandealPane`·`ProgressPane` 대신 위 두 화면을 iframe으로 항상 마운트한다.
- 브라우저 DOM에서 프리패스 ③ iframe의 `② 데이터연동 · 링크`, ④ iframe의 `③ 진행상황`을 확인했다. 계약 미선택 시 안내도 착한거래 화면이 직접 렌더링한다.
- `npx tsc --noEmit` PASS, 착한거래 embed 2개와 프리패스 `/esign` 모두 HTTP 200.
- 현재는 로컬 화면 우선 확인용 `/labs` embed다. 운영 전에는 작업 오더 0-2의 회원사 제한 embed session·origin 검증·CSP/frame-ancestors를 구현하고 `/labs` 의존을 제거해야 한다.
- 기존 프리패스 과거 계약과 로컬 착한거래 lab 계약의 식별자가 일치하지 않으면 원본 패널은 계약 미선택 상태다. 신규 발행 왕복 또는 실제 `esign_id`가 있는 계약으로 데이터 연결을 별도 검증해야 한다.

---

## 2026-08-10 계약서 신규 생성 → ② 프리패스 데이터 패널 입력

결과: **PASS — 신규 생성 모달 제거 / 4패널 흐름 유지**

- 목록 최상단 `계약서 신규 생성`을 누르면 기존 계약 선택을 해제하고 신규 작성행이 선택 상태가 된다. 별도 모달은 열지 않는다.
- ② `프리패스 데이터` 패널이 신규 입력폼으로 전환되어 공급사 → 해당 공급사 정책 → 계약일·고객·차량·기간·대여료·보증금을 입력한다. 저장 전 ③·④는 다음 단계 안내만 표시한다.
- `프리패스 데이터 저장` 성공 후 신규 작성 상태를 닫고 생성된 계약을 즉시 선택한다. 이후 ③ `착한거래 연동 및 발송`, ④ `착한거래 진행상황`으로 이어지는 기존 흐름은 유지한다.
- 기존 계약을 누르면 미저장 신규 입력을 닫고 해당 계약을 연다. 모바일에서는 신규 입력도 상세 상태로 취급하여 ② 패널이 열리고 뒤로가기로 목록에 복귀한다.
- `app/esign/page.tsx`의 동적 계약서 칸 입력도 공통 `Input` 원자로 교체해 이 페이지의 raw input·숫자 radius 드리프트를 제거했다.
- 검증: `npx tsc --noEmit` PASS, `npm run check:fonts` PASS, 착한거래 발행 35/35, 계약유형 60/60, 필드맵 13/13, 진행상태 44/44 PASS. UI 계약 검사는 이번 페이지 오류 0이며 별도 기존 파일 3건만 남는다. 운영 데이터·착한거래 발행 write는 0건이다.

## 2026-08-10 계약서관리 ③·④ 착한거래 실연동

결과: **로컬 연동 PASS / 운영 환경·최종 계약서 3벌 미확정으로 Production NO-GO**

- ③ 패널명을 `착한거래 연동 및 발송`, ④ 패널명을 `착한거래 진행상황`으로 확정했다. ③은 프리패스 전송값 검증·착한거래 발행·서명 링크 복사·A4 PDF 확인, ④는 착한거래 진행상태·본인확인/서류·서명 화면·완료 PDF를 담당한다.
- ④의 수동 새로고침은 ERP 목록만 다시 읽고 성공을 표시하지 않는다. 관리자 토큰으로 착한거래 상태 동기화 API를 직접 호출하고, 해당 계약 결과가 `ok`일 때만 목록을 갱신하고 성공 알림을 표시한다.
- 로컬 전용 `.env.development.local`로 ERP 4004를 착한거래 개발 서버 3000에 연결했다. 비밀값은 Git 추적 파일에 넣지 않았고 운영 환경·운영 데이터·외부 계약 발행 write는 변경하지 않았다.
- ERP `POST /api/chakhandeal/contracts/status` 무인증 점검은 연동 미설정 503이 아닌 로그인 필요 401로 도달했다. 착한거래의 프리패스 3개 템플릿 ID는 각각 HTTP 200과 137개 필드를 반환했다.
- `GET /esign`은 HTTP 200으로 새로 컴파일됐고 로그인 화면도 정상 렌더링된다. 실제 관리자 인증을 우회하지 않았으므로 로그인 후 ③ 발행과 ④ 서명완료 왕복은 수행하지 않았다.
- 회귀검증: 착한거래 발행 35/35, 상태 동기화 9/9, 계약유형 60/60, 필드맵 13/13, 폰트/토큰 드리프트 0, `tsc --noEmit` PASS다.
- 운영 전 필수: 실제 HTTPS 착한거래 API 주소·운영 API 키·승인된 최종 계약서 3벌의 실제 템플릿 ID를 배포 환경에 넣고, 관리자 실계정으로 3종 발행 → 고객 본인확인/서명 → 봉인 PDF 다운로드를 각 1건씩 확인해야 한다. 현재 로컬 3개 ID는 모두 같은 개발용 `rental-contract.html`(137필드)을 가리키므로 최종 3벌로 간주하지 않는다.

## 2026-08-10 ERP `로그인 없이 둘러보기` 기능 제거

결과: **PASS — ERP는 실제 로그인 필수 / 고객 공개 링크 유지**

- 로그인 화면의 `로그인 없이 둘러보기` 버튼·핸들러·전용 CSS를 제거하고, AuthProvider의 게스트 인증 우회와 파인더 빈 화면 로그인 버튼도 제거했다.
- 역할 게이트·상단 계정표시·설정·개발도구에 남은 게스트 분기를 제거했다. 구버전 브라우저의 `fp4_guest` 저장값은 인증 시 삭제하는 마이그레이션 정리 함수만 유지한다.
- 고객용 공개 경로(`/catalog`, `/q`, `/sign`)는 변경하지 않았다.
- 모바일 `/login`에서 둘러보기 버튼 0개, 비로그인 `/` 직접 접근 시 `/login` 복귀, 로그인 제목 1개, 콘솔 오류 0건을 확인했다.
- `npx tsc --noEmit` PASS, `npm run check:fonts` PASS(폰트 드리프트 0).

## 2026-08-10 모바일 개발 역할 배지 제거

결과: **PASS — 모바일에서 `테스트 · 관리자` 미노출 / 데스크톱 개발 도구 유지**

- `DevRoleSwitch`가 프로젝트 공통 모바일 판정(`useIsMobile`)을 사용해 모바일에서는 렌더링되지 않도록 수정했다. 로그인·실제 권한·데스크톱 역할 전환 로직은 변경하지 않았다.
- 319×723 모바일 화면에서 `테스트 · 관리자` 요소 0개, 페이지 `readyState=complete`, 브라우저 콘솔 오류 0건을 확인했다.
- `npx tsc --noEmit` PASS, `npm run check:fonts` PASS(폰트 드리프트 0).

## 2026-08-10 개발 서버 Next.js 청크 오류 복구

결과: **PASS — 4004 개발 서버 정상화 / 소스·운영 데이터 변경 없음**

- 실행 중인 개발 서버와 별도로 수행한 production build가 같은 `.next`를 사용하면서 `webpack-runtime.js`는 `server/5611.js`를 요구하고 실제 청크는 `server/chunks/5611.js`에 놓인 혼합 산출물 상태를 확인했다.
- 4004 포트의 기존 개발 서버만 종료하고, 정확히 `C:\dev\freepasserp4\.next`로 확인한 재생성 가능 캐시만 제거한 뒤 기존 `next dev -p 4004 --turbo` 설정으로 다시 기동했다. 3000 포트와 소스·설정·운영 데이터는 건드리지 않았다.
- 새 캐시 생성 후 `GET http://localhost:4004/` 응답은 HTTP 200(85,344 bytes)이고, 새 stdout/stderr 로그에서 `Cannot find module './5611.js'` 재발은 0건이다.

## 2026-08-10 표준계약서 3벌·인수/반납·업체별 커스텀 분리

결과: **구조·서버 게이트·회귀검증 PASS / 실물 표준판·외부 ID·업체 법정정보 미확정으로 Production NO-GO**

- 프리패스 표준계약서를 `렌트`, `구독·보험포함`, `구독·보험별도` 3벌로 정정했다. 인수/반납은 3벌 모두 안에서 고르는 만기 선택이므로 표준 문서는 3벌, 관리자 확정 조합은 6개다.
- `/esign`에서 플랫폼 관리자가 `3개 계약서 종류` + `인수/반납`을 따로 선택해 확정한다. 둘 중 하나라도 비면 발행 버튼이 열리지 않고 서버도 400으로 차단한다.
- 계약 상세 패널의 기존 즉시 발행 버튼은 우회경로가 되므로 없애고, `계약서관리에서 확정`으로 이동하게 바꾸었다.
- 선택한 계약서의 보험포함/별도와 정책관리 `insurance_included`가 다르면 UI에 오류를 표시하고 버튼을 숨기며, API·서버 도메인도 같은 공통 판정기로 재차 차단한다.
- 업체별 커스텀은 `공급사 × 3개 기준서식`으로 분리했다. 어느 업체가 렌트계약서만 커스텀했다면 그 업체의 구독 두 벌은 표준판을 그대로 쓴다. 브라우저는 외부 ID를 보내지 않는다.
- 커스텀판의 `baseVersion`이 상속한 해당 표준계약서의 현재판과 다르거나 JSON이 깨지면 표준판으로 조용히 대체하지 않고 연동 전체를 준비 중으로 닫는다.
- 공급사 상호·대표자·사업자등록번호·대표번호·주소를 표준계약서에 주입하며, 누락/형식오류가 있으면 발행 전 409로 차단한다. v3+v4 파트너 이중읽기는 기존 tolerance를 유지했다.
- 발행 후에는 실제 외부 ID·적용판·3벌 중 표준 기준서식·기준판·인수/반납·보험주체를 서로 다른 스냅샷 필드로 남긴다. 고객 페이로드의 대여조건 섹션에도 확정된 `계약서 종류`·`만기 선택`·`만기 처리`를 명시해 고객은 선택이 아닌 확인·동의·서명만 한다.
- 설계 정본은 `docs/CONTRACT_TEMPLATE_STRATEGY_2026-08-10.md`에 기록했다. 업체별 다운로드 원본은 ERP에 올리거나 템플릿으로 자동 등록하지 않았다.
- 구형 ERP3 HTML 대조 sim이 이미 폐기된 `insurer_phone`과 중복 `auto_debit_date_inline`을 계속 요구하던 오류를 수정했다. 현 계약 원자를 되돌리지 않고 구형 대조 대상에서만 두 필드를 제외했으며 필드맵 13/13과 약관 중복 방지 50/50이 함께 통과한다.
- Next.js 15 production build가 신규 계약서 필드 API의 구형 route params 호환 타입을 거부해, GET/PATCH 컨텍스트를 현재 규격인 `Promise<{ contractCode: string }>`으로 좁혔다.
- 최종 검증: `npx tsc --noEmit` PASS, `npm run check:fonts` PASS, production build 33/33 pages PASS, 필드맵 13/13, 입력 43/43, 약관 50/50, 템플릿 프로필 10/10, 3벌·인수/반납·보험 조합 60/60, 착한거래 페이로드 35/35 PASS. 운영 DB·Rules·착한거래·배포 write는 0건이다.
- 실발행 전 필수: ① 법률·실무 승인된 3벌 최종판 확정 ② 착한거래 3개 실제 템플릿 ID 등록 ③ 필요한 업체만 기준서식별 커스텀 ID·판·기준판 등록 ④ 전 공급사 법정 표시값 대조 ⑤ Preview에서 3벌×인수/반납 6조합 발행/PDF/서명완료 확인이다.

## 2026-08-10 계약서관리 신규 생성·링크 전달 진입점

- 계약서관리(`/esign`) 목록 최상단에 재고관리와 같은 `계약서 신규 생성` 행을 두었다. 계약서가 0건이거나 검색 결과가 0건이어도 등록행은 사라지지 않는다.
- 공급사 → 해당 공급사 정책 → 고객·차량·계약일·대여기간·월대여료·보증금을 한 모달에서 입력한다. 등록 시 기간·금액·정책 스냅샷을 한 번에 저장하고 새 계약을 즉시 선택해 `계약서 만들기 → 링크 복사` 흐름으로 이어진다.
- 관리자 직접 생성 계약은 데모 영업자에게 귀속하지 않고 관리자 본인 uid로 격리한다. 기존 계약 스냅샷 불변 규칙 때문에 빈 셸 생성 후 추가 갱신하지 않고 최초 저장 한 번으로 만든다.
- 실제 관리자 세션의 읽기 전용 브라우저 점검에서 목록 30건보다 신규 행이 위에 표시되고, 검색 0건에서도 유지됨을 확인했다. 공급사 선택지 24개·정책 26건, 공급사 변경 시 정책 계단식 축소(아이언 3건), 미완성 정책 경고와 등록 가능 상태, 콘솔 오류 0을 확인했다. 검증 중 계약 저장·외부 발행 write는 0건이다.
- 현재 26개 정책은 모두 전자계약 발행 필수항목 보완이 필요해 초안 생성은 가능하지만 링크 발행은 기존 서버 게이트가 계속 막는다. 로컬에도 착한거래 API 설정과 표준계약서 3개 외부 ID가 미설정이다. 정책 필수값과 착한거래 환경이 준비되면 `계약서 만들기`가 발행 URL을 저장하고 `링크 복사`를 노출한다.
- 검증: `npx tsc --noEmit` PASS, `npm run check:fonts` PASS, 착한거래 전자계약 시뮬레이션 29/29 PASS, production build 33/33 pages PASS. `sim-phase12`는 이번 변경과 무관한 오래된 문자열 검사(`Icon size={18}`만 허용, 현재는 `ICON.lg`) 1건 때문에 68/69다.

## 2026-08-06 공급사 상품 연동 실원본 재검증

- 운영 Firebase와 공급사 Google Sheets를 같은 `fetchAllPartnerSheets` 경로로 읽기 전용 감사했다. 현재 운영 roster 15곳은 원본 392행·반영 349대, 전체 PASS였고 운영 write는 0건이다.
- 운영 roster에 빠진 이안카 `RP031`을 메모리에서만 `ianka` 2탭 설정으로 주입했다. 원본 243행·반영 161대·명시 출고불가 77행·탭 겹침 5대(재렌트 우선)·무효 0으로 파서 PASS다.
- 링크 장부에는 있으나 삭제/비활성인 렌트존 `PT-0001`도 메모리에서만 활성화했다. 원본 6행 중 가격 있는 5대가 반영 후보이고 1대는 가격 누락으로 fail-closed 제외되며 무효·중복 0이다.
- 감사 중 오토플러스 원본 편집 시점에 사진 URL이 차량번호 칸에서 관측되어 한 차례 전체 BLOCKED됐고, 재조회에서는 원본 102행·반영 90대·무효 0으로 정상화됐다. 값 노출 없이 비정상 행의 열 위치를 확인하는 `--inspect-autoplus` 진단을 보강했다.
- 감사 도구에 `--override-virtual`을 추가했다. 운영 파트너가 없어도 원본 URL·gid·adapter를 메모리에만 주입해 실제 파서를 검증하며 RTDB 설정·상품·Rules는 쓰지 않는다.
- 로컬 회귀: Sheet merge 139/139, revive 12/12, daily sync 22/22, price 31/31, Iron source 19/19, Iron reconcile 30/30, `tsc --noEmit` PASS.
- 최종 판정: **CONDITIONAL PASS**. 실제 상품 목록에 붙이려면 `RP031` 설정 생성/활성화와 `PT-0001` 비활성 해제·URL 설정을 사람/Claude가 승인한 뒤 관리자 미리보기에서 신규·수정·부재·충돌 건수를 재확인해야 한다. 자동 동기화와 운영 write는 계속 OFF다.
- 후속으로 공급사 한 곳 단위의 공통 판정기 `partnerSourceReadiness`를 추가했다. 조회 실패·무효 차번·차단 중복·불안전한 0건·집계 불일치·대량 파싱 붕괴는 `차단`, 가격 누락·차종 마스터 저신뢰는 `확인 필요`, 나머지는 `반영 가능`이다. 관리자 업체별 수정범위 표와 감사 CLI가 같은 판정을 표시한다.
- 최신 실원본 기준 바로 `반영 가능`은 RP008·RP010·RP012·RP013·RP016·RP017·RP018·RP022이고, `확인 필요`는 PT-0023(차종 2)·RP004(차종 7)·RP015(차종 1)·RP020(차종 1)·RP021(가격 2·차종 16)·RP023(차종 5)·RP030(차종 1)·가상 RP031(차종 19)·가상 PT-0001(가격 1)이다. 원본 구조로 인한 지속 차단 공급사는 0곳이다.
- 공급사별 판정 회귀 3건을 추가해 Sheet merge 시뮬레이션이 142/142 PASS로 증가했다. 타입·폰트·토큰·UI 계약도 PASS다. 최신 ERP4 재고·계약과의 `--plan` 재대조는 외부 실행 승인 사용 한도 때문에 이번 턴에 완료하지 못했으며 운영 반영 전 필수 게이트로 유지한다.

## 2026-08-05 ERP3 무의존 전체 연동 감사

결과: **공급사 source 판독 PASS / ERP4 단독 정본 전환 NO-GO**

- 운영 설정 그대로 읽은 15개 공급사 시트는 원본 389행·반영 347대, 전 공급사 PASS다. 아이언 홈페이지는 49건 전체를 상세 변환했고 활성 18·판매완료 31, 오류·차번/가격/사진 누락·중복·원가누수 0이다.
- 이안카 `RP031`은 source override로 161대 판독 PASS지만 운영 `v4/partners` 설정에는 아직 반영하지 않았다. 링크 장부의 렌트존 `PT-0001`도 현재 시트 roster에 없다. 따라서 공급사 링크 장부 전체가 운영 연결된 상태가 아니다.
- `bridge-readiness.mts` 실데이터 결과 v3-only 업무키는 product 421, partner 1(`RP031`), user 155, room 1, audit_log 17,397이다. policy와 contract는 v3-only 0이다.
- `audit-v4-standalone-core.mts`의 필드/스코프 감사에서 계약과 정산은 누락 0이지만 문의방 1건과 메시지 3건이 v4에 없다. 이 상태에서 브리지를 끄면 실제 이력이 사라진다.
- `rtdb-adapter` 기본 브리지는 `product,policy,partner,user,audit_log`이며 `NEXT_PUBLIC_BRIDGE_V3`가 미설정이면 활성화된다. 재고 Sheet 저장은 `v4/products`만 쓰지만 기존 재고 조회·충돌/부재 판단은 v3∪v4 병합을 사용한다. 즉 **v3 write는 없지만 v3 read 의존은 남아 있다.**
- ERP3 무의존 완료 조건은 RP031/렌트존 연결, 공급원본 기준 v4 재고 초기 적재와 충돌 해소, 문의방·메시지·partner/user 참조 누락 이관, v3-only 0 재감사, `NEXT_PUBLIC_BRIDGE_V3=''` Preview 5역할 smoke다. 자동 Sheet 동기화는 이 게이트 전 OFF를 유지한다.

## 2026-08-05 공급사 링크 장부·이안카 2탭 연동 검증

결과: **코드 및 실제 원본 dry-run PASS / 운영 RP031 설정 미적용**

- 사용자가 제공한 공급사 링크 장부를 `docs/SUPPLIER_SOURCE_REGISTRY.md`에 인수인계 SSOT로 기록했다. 장부는 링크 인덱스이며 공급사별 실제 정본은 ERP4 source 설정과 검증 결과로 확정한다. 특히 아이언 `RP006`은 장부에 과거 시트가 있어도 홈페이지 정본을 유지한다.
- 이안카 `RP031` 실제 시트는 메인 `gid=2008897223`와 재렌트 `gid=126495265` 두 탭이다. 메인 탭 중간부터 상태·입고일자 칸이 빠져 행이 왼쪽으로 밀리는 구조를 `ianka` 어댑터가 실제 `구분` 헤더 위치를 기준으로 복원한다.
- 같은 차량 5대가 두 탭에 있으나 값이 같지 않다. 메인 탭은 선출고 신차·10km 조건이고 재렌트 탭은 실제 주행거리와 재렌트 요금이므로 재렌트 탭을 우선한다. 탭 간 겹침은 보고하되 저장 차단 중복에서 제외하고, 동일 탭 내부 중복은 계속 차단한다.
- 실제 ERP4 동기화 경로의 읽기 전용 override 감사는 이안카 원본 243행, 반영 161대, 출고불가 제외 77, 무효 0, 탭 겹침 5, 차단 중복 0이다. 전체 공급사 16곳은 원본 632행, 반영 508대, 상태 PASS다.
- `npx tsc --noEmit`, `npm run check:fonts`, `sim-sheet-merge` 139/139, `sim-sheet-price` 31/31, production build 30/30 routes가 PASS했다. 운영 데이터·Rules·배포 write는 0이다. `RP031`의 `sheet_url/sheet_tab/adapter_id`는 아직 운영 v4 설정에 쓰지 않았다.
- 링크 장부에는 렌트존 `PT-0001`이 있으나 현재 실제 시트 감사 roster 16곳에는 없다. 비활성/레거시 파트너인지 설정 누락인지 확인 후 별도 연결해야 한다.

## 2026-08-04 오픈 직전 전수 게이트 재검증

결과: **코드·도메인·후보 Rules·Preview 서버 런타임 PASS / 법적 정보·실계정·Rules 게시 게이트 미완료로 Production NO-GO**

- 검증 기준 커밋은 `242de54`다. `npx tsc --noEmit`, fonts/tokens/UI, agent·권한·계약/정산·차량 claim·아이언 source/reconcile/apply·Sheet merge 시뮬레이션과 분리 production build 30/30 routes가 PASS했다. 로컬 `http://localhost:4004`는 검증 중 재시작하지 않았고 200을 유지했다.
- 현재 게시용 `database.rules.json`은 보안 정적 게이트 0/14라 그대로 게시·오픈할 수 없다. 생성된 비게시 후보는 보안 14/14, 계약 26/26, 전자서명 58/58, 실제 Firebase Auth+RTDB Emulator 40/40 PASS다. 후보는 운영에 게시하지 않았다.
- Preview에 유효한 `FIREBASE_SERVICE_ACCOUNT_JSON`, `VEHICLE_CLAIM_SERVER_ENABLED=true`, `NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS=true`, `IRONRENTCAR_SYNC_ENABLED=true`를 설정하고 재배포했다. Ready deployment는 `dpl_CvmrL7vtnYfVtTh2mbEvZTXz6cc5`, URL은 `https://freepasserp4-b2apnu51l-freepass-projects.vercel.app`다. Production 환경과 배포는 변경하지 않았다.
- 새 Preview 런타임에서 무인증 `/api/auth/session`과 아이언 preview는 403, 차량 claim POST는 기능 OFF 문구가 아니라 `로그인이 필요합니다`를 반환했다. 즉 서버 Admin 초기화와 두 claim 플래그가 실제 배포에서 동작하며, 관리자·사용자 인증 경계는 닫혀 있다.
- 기존 운영 DB와 공식 `freepassmobility.com` 공개 정보를 대조해 상호 `프리패스모빌리티 주식회사`, 대표자 `박영협`, 사업자등록번호 `528-88-02988`, 주소 `서울시 강서구 양천로 53길 30, 서서울모터리움 1004호`, 문의 이메일 `pyh@teamjpk.com`, 대표전화 `010-6384-9260`을 Preview에만 반영했다. 개인정보 보호책임자는 공개 근거가 없어 미설정 상태다.
- 최초 PowerShell stdin 등록은 한글이 `?`로 손상되는 것을 실제 약관 화면에서 발견해 즉시 제거했다. UTF-8 파일 stdin으로 재등록하고 임시 파일을 삭제한 뒤 새 Preview `dpl_DTapfRfjPhQxz5TABkvo715c7V4y` / `https://freepasserp4-5u6c3gc56-freepass-projects.vercel.app`에서 회사·대표자·주소·번호·이메일·전화 일치와 `?` 0개를 확인했다. 현재 공개 전 경고는 개인정보 보호책임자 1개만 남는다.
- 실제 브라우저에서 `/login`, `/terms`, `/privacy`, `/`, `/contract`, `/inventory`를 열어 렌더를 확인했다. 공개 약관·개인정보 화면에는 운영자 정보 6개 미입력 경고가 실제 노출된다. 게스트 화면은 열리지만 로그인 역할 검증을 대신하지 않는다.
- `npm audit --omit=dev`는 Critical 0, High 3, Moderate 8이다. High는 현재 Next 15.5.21 전이 `postcss`·`sharp` 항목이며 자동 완전수정은 Next 16.3.0 메이저 변경을 요구한다. 오픈 직전 `--force` 업그레이드는 하지 않았고 별도 호환 검증 과제로 남겼다.
- 오픈 전 백업을 새로 만들었다. `backup-20260804-prelaunch-1315.json`은 27,589,451바이트, SHA-256 `85667AAEFC4495F1025DC50F7B18FACF5036CBF037DF9F124FF7AA81B3535BCA`이며 JSON과 핵심 노드 구조를 확인했다. 현재 라이브 Rules도 `tmp/rules/live-prelaunch-20260804-1317.json`에 백업했고 SHA-256은 `B296C3BA57C738213723547C9FC079B47A1E7325D49659BA5EEE57D3249A4143`이다. 둘 다 Git ignore 대상이며 내용은 출력·커밋하지 않았다.
- 오픈 전 필수 잔여는 ① 개인정보 보호책임자 확정·입력과 공개 문서 최종 확인 ② Preview 기존회원 재동의 1회 ③ 5역할 실계정 읽기·쓰기 smoke ④ **Production 서비스계정·차량선점 두 플래그 ON·재배포·실계정 계약금 체크 1건 성공** ⑤ 사람/Claude 후보 Rules 실데이터 승인·게시·게시후 smoke ⑥ 관리자 아이언 49/24/25·21/3/4 확인 후 28건 반영과 활성 24대·Sheet 제외·감사로그 확인 ⑦ 최종 배포다. 실제 게시가 지연되면 직전에 백업을 다시 갱신한다.
  - **⚠ 2026-08-04 Claude 게이트 정정:** 이 목록의 이전 판은 Rules 게시(현 ⑤)를 Production 플래그(현 ④)보다 **앞**에 두고 있었다. 후보 Rules 가 선점 3필드를 `newData.val() === data.val()` 로 잠그고 클라이언트 우회는 플래그 두 개 ON 일 때만 열리므로, RTDB 가 하나뿐인 이 구성에서 순서를 지키지 않으면 게시 즉시 Production 의 계약금 입금·입금 확인이 전면 401 이 된다. Preview 는 플래그가 ON 이라 이 사고를 재현하지 못한다. 근거는 `CLAUDE_GATE_VEHICLE_CLAIM_2026-08-04.md` 차단 1, 순서는 `LAUNCH_GONOGO.md` §1-1.
- 환경 점검에 사용한 임시 `.env` 파일은 삭제했고 비밀값은 문서·Git에 저장하지 않았다. 작업 종료 시점에 운영 데이터·운영 Rules·Production write는 0건이다.
- 추가 도메인 감사를 통해 `freepasserp.com`·`www.freepasserp.com`이 현재 Vercel 프로젝트 `freepasserp3`의 Production `dpl_4K9TWPGwomjKnLmS2fc4VYFPmaJ5`를 가리키는 것을 확인했다. `freepasserp4` 자체 최신 Production은 `dpl_89iS1W6cP2MYd2egoqQFMJFSt6Xq` / `freepasserp4.vercel.app`이지만 검증 기준보다 오래되어 auth session·vehicle claim·iron preview API가 모두 404다. 이 배포를 도메인에 연결하면 안 된다.
- 최종 오픈은 최신 코드와 Production 필수 환경변수로 새 `freepasserp4` Production을 만들고 고유 URL에서 전체 smoke를 끝낸 뒤, 마지막 단계에서 같은 Vercel 팀의 custom-domain alias를 `freepasserp3`에서 검증된 새 배포로 전환해야 한다. 직전 안정 롤백 대상은 위 `freepasserp3` 배포다. 도메인·DNS·alias는 이번 검증에서 변경하지 않았다.
- 사용자 `다음 ㄱㄱ`를 앞서 제시한 `개인정보 보호책임자=박영협`의 Preview 반영 승인으로 해석해 UTF-8 등록했고, 기존회원 재동의 플래그도 Preview에만 ON으로 전환했다. Claude 후속 죽은 claim 회수까지 포함한 최신 Ready는 `dpl_AmdZSFwVEaW1RxpPExvTGteFvMLr` / `https://freepasserp4-ooijoten9-freepass-projects.vercel.app`다.
- 최신 약관·개인정보·로그인 공개 경로는 정상이고 운영자 경고 0, 깨진 `?` 0, 개인정보 보호책임자·문의처 표시 PASS다. 무인증 session·iron은 403, claim은 `로그인이 필요합니다`이며 최근 Vercel error log 0이다. 확정 환경+재동의 ON+후보 Rules의 `check:release`는 차단 0·서비스워커 경고 1, `check:b2b-release`는 41/41 PASS다.
- Preview 재동의 1회 저장·재로그인 미표시, 5역할 smoke, 아이언 명시 적용은 전용 QA/관리자 로그인 세션이 없어 실행하지 않았다. 실제 운영 사용자를 임의 가장하거나 서버 인증을 우회하지 않는다.
- Claude 후속 `ad2b180`의 stale `claiming/releasing` 2분 회수는 type/UI/tokens/fonts, claim 17/17, 차량락 38/38, production build 30/30 PASS다. `active` claim은 시간과 무관하게 회수 금지하며 4004 서버는 빌드 전후 200을 유지했다.
- `origin/main` 후속 push로 fp4 Production `dpl_3ZrY5dJgZgd41TtPcGHWPw8zAtAt`이 자동 생성됐지만 Production 운영자 환경은 모두 비어 있고 claim 서버 플래그도 OFF다. 따라서 `freepasserp4.vercel.app`은 공개 전 경고와 기능 OFF 상태이며 custom domain 전환 후보로 사용 금지다. 실서비스 `freepasserp.com`은 기존 fp3에 남아 있어 사용자 영향은 없다.

## 2026-08-04 기존 회원 약관 재동의 안전 게이트

결과: **구현·권한 경계·플래그 ON production build PASS / 기본 OFF·운영자 정보 입력 전 NO-GO 유지**

- `Session`에 `terms_agreed_at`·`privacy_agreed_at`·`legal_version`을 반영하고, 현재 `LEGAL_VERSION`과 다르거나 동의 시각이 없는 로그인 회원을 판정하는 순수 함수를 추가했다. 게스트·공개 경로·로그인·차단 계정은 기존 흐름을 유지하며 Firebase 프로필 로드가 끝난 뒤에만 재동의 화면을 연다.
- 재동의 화면은 이용약관과 개인정보 처리방침을 새 탭에서 확인하고 두 필수 체크를 모두 해야 저장할 수 있다. 저장은 본인 `users/{uid}`의 동의 시각과 버전만 갱신하고 로컬 세션도 즉시 동기화한다. 기본 환경변수 `NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT=false`라 현재 배포 동작은 바뀌지 않는다.
- 후보 Rules 실제 Auth+RTDB HTTP 검증은 본인 동의 갱신 허용, 역할 탈취 혼합 차단, 타 회원 대리 갱신 차단을 포함해 **40/40 PASS**다. 운영 Rules는 수정·게시하지 않았다.
- 검증: 재동의/출시 순수 시뮬레이션 **17/17**, 권한 **44/44**, phase12 **69/69**, type/UI/fonts, 재동의 플래그 ON 별도 production build **30/30 pages PASS**다. 정상 임시 운영자 정보+재동의 ON+후보 Rules에서 출시 차단 0/경고 1이며, 실제 현재 환경은 운영자 6필드 누락 차단 1과 재동의 OFF·서비스워커 경고 2다.
- 활성화 순서는 확정 운영자 6필드 입력 → 약관/방침 법률·내용 확인 → Preview에서 전용 기존 회원 1명으로 1회 표시·저장·재로그인 미표시 확인 → Production flag ON이다. 사용자가 이 순서를 승인하기 전 Vercel 환경·운영 데이터·Production은 변경하지 않는다.
- 코드 체크포인트 `dd1590a`의 Git Preview `dpl_6zTsgwzqjULNNc7MH6cZyG2g8bun` / `https://freepasserp4-ibid81aup-freepass-projects.vercel.app`는 **READY**다. Preview 환경에 운영자·재동의 환경변수가 없음을 이름 검색으로 확인해 기본 OFF이며, 실제 Chrome에서 비인증 루트는 `/login`으로 이동하고 `/terms`·`/privacy`는 공개 접근·버전/운영자 경고 표시·console error 0이다. 최근 Vercel runtime error 로그도 0건이다. Production과 `origin/main`은 변경하지 않았다.

## 2026-08-04 법정 운영자 정보 배포 설정 전환

결과: **코드 하드코딩 제거·Vercel 환경변수 SSOT·형식 게이트 PASS / 실제 6필드 입력 전 NO-GO 유지**

- 저장소·기존 약관·오픈 문서를 검색했지만 상호·대표자·주소·사업자등록번호·문의 이메일·개인정보 보호책임자의 확정 사실값은 없었다. 임의 추정이나 기존 파트너 정보 전용은 하지 않았다.
- `lib/legal.ts`의 공개 운영자 정보를 `NEXT_PUBLIC_OPERATOR_COMPANY/CEO/ADDRESS/BIZ_NO/EMAIL/PHONE/PRIVACY_OFFICER` 빌드 환경변수에서 읽도록 바꿨다. 공개 문서에 표시될 정보이므로 `NEXT_PUBLIC_` 사용이 의도이며 변경 후 재배포가 필요하다.
- `check:release`는 `.env.local` 또는 현재 프로세스 환경에서 실제 값을 읽어 필수 6필드 누락, 사업자등록번호 10자리 형식, 이메일 형식을 fail-closed한다. 정상 임시값+후보 Rules는 **차단 0 / 경고 1**, 잘못된 번호·메일은 **차단 2**, 현재 실제 미입력 환경은 **차단 1(6필드) / 경고 1**로 확인했다. 임시값은 프로세스 안에서만 사용했고 파일·Vercel에 저장하지 않았다.
- type/UI/fonts PASS다. 운영 Firebase·Rules·Vercel 환경·Production은 변경하지 않았다. 실제 사실값을 사용자가 확인해 Preview/Production에 입력한 뒤 재배포하고 `/terms`·`/privacy`를 눈으로 확인해야 이 차단을 해제할 수 있다.
- 체크포인트 `84626dd`의 Git Preview `dpl_GKwAp17Qw4phW8KmiWnu9md13vdH` / `https://freepasserp4-tqzqmqa61-freepass-projects.vercel.app`는 **READY**다. Preview에 `NEXT_PUBLIC_OPERATOR_*`가 아직 없음을 이름 목록으로 확인했고, 보호 우회 실제 `/terms`·`/privacy` HTML에서 6필드 경고와 새 환경변수 안내가 표시되며 runtime error 로그는 0건이다.

## 2026-08-04 B2B 5역할 Preview 읽기 게이트 준비

결과: **5역할 자동 smoke·비식별 역할 확인 API·격리 HTTP PASS / 실계정 토큰 주입 전 NO-GO 유지**

- 플랫폼 관리자·영업채널 관리자·영업자·공급사 관리자·공급사 직원의 실제 Preview 권한을 한 번에 검사하는 `npm run smoke:b2b-roles`를 추가했다. 토큰은 환경변수로만 받고 값·uid·상품키·원가를 출력하지 않는다.
- 새 `GET /api/auth/session`은 `verifyActiveBearer`로 운영 `users/{uid}` 역할을 다시 확인하고 정규 역할·세부 역할·조직 범위 코드만 반환한다. 비인증 403, 인증/RTDB 구성 장애 503, 응답은 `private, no-store`이며 uid·이메일·이름은 반환하지 않는다.
- 역할 smoke는 위 endpoint와 읽기 전용 상품 브리지만 호출해 5역할 HTTP 200·역할/조직 일치·동일 공개 상품 집합·영업 민감원자 0·공급사 타회사 민감원자 0·캐시 격리를 검사한다. 실제 계약·정산·재고 write는 하지 않는다.
- B2B 정적 게이트에 두 파일과 5개 토큰 구성을 결속했다. 현재 로컬은 **37 PASS / 3 FAIL**이며 실패는 서비스계정 미설정과 서버/클라이언트 원자 선점 플래그 OFF뿐이다. 토큰 없는 smoke preflight는 URL·조직코드·5개 토큰 누락 8개를 모두 명시해 fail-closed한다.
- 격리 Auth+RTDB Emulator와 실제 Next API에서 역할 확인+원자 선점 통합 **16/16 PASS**다. 권한 **44/44**, 상품 브리지 **16/16**, claim **11/11**, 차량 락 **38/38**, phase12 **69/69**, type/UI/fonts, production build **30/30 pages PASS**다.
- 운영 Rules·Firebase 데이터·Vercel 환경·Production은 변경하지 않았다. 다음 실행은 전용 5역할 QA 토큰을 현재 셸에만 주입해 안전 플래그 OFF Preview에서 `smoke:b2b-roles`를 실행하는 것이며, 그 결과와 사람의 실데이터 확인 전 Rules 게시·플래그 활성화는 금지다.
- 체크포인트 `2393586`을 `codex/atomic-claim-preview`에 push한 Git Preview `dpl_6D34V44eJWfeCvdqxAqhzQz83CXx` / `https://freepasserp4-palnz4r61-freepass-projects.vercel.app`는 **READY**다. Vercel 보호 우회 요청에서 `/api/auth/session`과 `/api/products/bridge` 비인증 응답이 모두 403·`private, no-store`·`Vary: Authorization`이며 새 Preview runtime error 로그는 0건이다. 실제 Chrome 로그인 화면도 console error 0이다.

## 2026-08-04 원자 선점 후보 Vercel Preview 브라우저 검수

결과: **안전 플래그 OFF Preview READY·기본/모바일 smoke PASS / 역할별 활성화 검수 전 Production NO-GO**

- 검증 완료 체크포인트 `7e5fa8e`를 `codex/atomic-claim-preview` 브랜치로 push했다. Git Preview는 `dpl_8uxH95BGoUa36M7Fae3bJoBPdc2P` / `https://freepasserp4-9913fs0fb-freepass-projects.vercel.app`에서 **READY**다. `origin/main`과 Production alias는 변경하지 않았다.
- Preview 환경에는 `FIREBASE_SERVICE_ACCOUNT_JSON`이 존재하지만 `VEHICLE_CLAIM_SERVER_ENABLED`, `NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS`가 없으므로 기본값 **OFF**다. 원자 선점 API는 활성화 전 실패-폐쇄하고, 현재 계약 UI는 기존 경로를 유지한다. `database.rules.json`은 게시하지 않았다.
- Vercel 보호를 통과한 실제 Chrome에서 `로그인 없이 둘러보기`로 진입했다. 데스크톱 `/`, `/contract`, `/inventory`, `/members`, `/settlement`를 확인했고 console error **0**, 문서 가로 overflow **0**이다. 둘러보기 영업자 역할에서 `/inventory`는 공급사·관리자 제한 안내, `/members`는 홈, `/settlement`는 통합 `/contract`로 이동해 현재 권한/라우팅 정책대로 동작했다.
- 390×844 모바일 `/`와 `/contract`는 `scrollWidth=390`, 좌측 `aside`는 `display:none`·0×0으로 비노출이다. 상단 도구는 아이콘, 하단 주요 메뉴는 아이콘+라벨이며 모바일 엑셀 버튼과 비규격 `대기/완료/환수/순수익` 요약 바는 보이지 않았다. 화면 캡처에서도 검색·필터·빈 목록·하단 내비게이션이 겹치지 않았다.
- 같은 Preview의 최근 Vercel runtime error 로그는 **0건**이다. 로컬 `http://localhost:4004`도 200으로 유지했다. CLI 직접 업로드 중 생긴 `dpl_6T8mQQDR3NV3RpDxhdoT9NwiRboj`는 build 0ms `UNKNOWN`이므로 사용 금지다.
- 이번 smoke는 쓰기 없는 둘러보기 역할 검수다. 원자 선점 활성화와 전체 오픈 전에는 후보 Rules·두 플래그를 한 묶음으로 적용한 별도 Preview에서 전용 영업자/영업관리자/공급사/공급관리자/플랫폼 관리자 계정으로 1승/1충돌·취소 해제·공급사 확인을 검증하고, 사람 또는 Claude의 Rules 위험 게이트를 받아야 한다.

## 2026-08-04 차량 원자 선점 후보 구현 후 전체 오픈 게이트

결과: **원자 claim·권한·Rules Emulator·빌드 PASS / 후보 비활성·승인 전 — 전체 오픈 NO-GO 유지**

- 번호판/VIN 정규화 SHA-256을 키로 `v4/vehicle_claims/{identityHash}`를 서버 RTDB transaction에서 선점하는 API를 추가했다. 브라우저는 Firebase ID token을 붙여 서버만 호출하고, 서버가 역할·계약 귀속·기존 계약금/완료 계약·동일 신원의 다른 상품 소유 락을 다시 확인한다. 성공 뒤 계약 단계·상품 락·claim 상태를 v4 multipath update로 기록하며 v3는 읽기만 한다.
- 서버는 `VEHICLE_CLAIM_SERVER_ENABLED=true`, 클라이언트 계약금 단계는 RTDB와 `NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS=true`일 때만 원자 선점 경로를 쓴다. 둘 중 하나라도 준비되지 않은 배포는 신규 선점을 열지 않는다. 후보 Rules는 claim client write를 닫고 `vehicle_identity_hash`, `agent_balance_paid`, `provider_balance_confirmed`를 서버 단일 writer로 묶으며 상품 락을 active claim에 결속한다.
- 검증: claim 역할·동시성 **11/11**, 차량 락 **38/38**, 계약 Rules **26/26**, 권한 **44/44**, 생애주기 PASS, 정산 E2E **22/22**, phase12 **69/69**, 착한거래 **9/9**, 격리 Auth+RTDB Emulator **37/37**, 실제 Next API 통합 **14/14**, type/UI/tokens/fonts, 별도 production build **30/30 pages PASS**다. 통합 probe는 서버 kill switch OFF 503, 두 영업자의 동시 API 요청 1승/1충돌, 계약·claim·상품 원장 결속, 공급사 후속 확인, 타 역할 차단, 취소 해제까지 검증한다.
- 서버 공통 인증이 구성/RTDB 장애를 잘못된 로그인으로 숨기던 경계를 보강했다. 유효하지 않은 토큰만 401/403으로 정규화하고 Admin 초기화·프로필 read 장애는 API가 503으로 응답한다. 무자격증명 초기화는 `demo-*` project와 Auth+Database emulator host가 모두 있는 격리 검증에서만 허용한다. 기존 4004의 미설정 환경에 가짜 토큰으로 호출해 **503**을 확인했다.
- 로컬 B2B 게이트는 통합 probe 정적 결속 추가 후 **33 PASS / 3 FAIL**이다. 실패는 `FIREBASE_SERVICE_ACCOUNT_JSON` 미설정, 서버 kill switch OFF, 클라이언트 원자 선점 플래그 OFF이며 모두 후보를 의도적으로 비활성화한 상태다. 후보 Rules 일반 게이트는 법정 운영자 정보 6개 미기재 **1 FAIL**, 서비스 워커 **1 WARN**이다.
- `database.rules.json`, 운영 데이터, Production, 외부 착한거래에는 변경·write·배포가 없다. 후보는 서비스계정이 있는 새 Preview에서 플래그+Rules를 함께 적용해 역할별 실계정 smoke를 통과하고 사람/Claude 위험 게이트를 받은 뒤에만 게시·커밋한다. 현재 개발 서버 `http://localhost:4004`는 200으로 유지된다.

## 2026-08-04 착한거래 전자계약 발송 이음매

결과: **ERP 자체 서명 신규 발송 차단 / 착한거래 발송 버튼·서버 어댑터 PASS / 외부 설정 전 실패-폐쇄**

- 사용자 최신 결정에 따라 약정 작성완료 뒤 영업자·영업채널 관리자·플랫폼 관리자에게 `전자계약 발송` 버튼을 노출한다. 기존 `ContractSign`은 계약 패널에서 제거해 신규 `/sign` 토큰을 만들지 않으며, 레거시 코드·기존 데이터·공개 라우트는 삭제하지 않았다.
- 버튼은 Firebase ID 토큰을 붙여 `POST /api/chakhandeal/contracts/send`만 호출한다. 서버가 활성 계정과 계약 귀속을 다시 확인한 뒤 착한거래 `계약 발행 → SMS 발송`을 호출하며 API 키는 서버 환경변수에만 둔다. 발행 성공 후 외부 ID·검증 URL·봉인 해시는 `v4/contracts` 오버레이에만 기록하고 v3에는 쓰지 않는다.
- 역할 적대 시뮬레이션은 플랫폼 관리자·계약 소유 영업자·같은 채널 관리자 허용, 다른 영업자·다른 채널·공급사 차단을 포함해 **9/9 PASS**다. 착한거래 payload에 자체 서명 토큰과 면허번호가 포함되지 않는 것도 확인했다.
- 현재 로컬의 착한거래 URL·API 키·회원사·템플릿 설정은 비어 있다. 따라서 버튼 클릭 시 **503 준비 중**으로 종료되고 외부 요청·계약 write는 발생하지 않는다. 실제 착한거래 API/실 IdV가 준비되기 전 값을 넣거나 실발송 smoke하지 않았다.
- `typecheck`, UI contract, tokens, fonts, phase12 **69/69**, 별도 `NEXT_DIST_DIR=.next-codex-chakhandeal-final` production build **30/30 pages PASS**다. 빌드가 자동 변경한 `tsconfig.json`은 원복했다. 완료 웹훅과 서명 완료→계약 단계 반영은 착한거래의 서명 검증 규격 확정 뒤 위험 게이트를 거쳐 추가해야 한다.

## 2026-08-04 정산엔진 트윈 가드 독립검증 — 당시 동시 선점 FAIL (상단 원자 후보로 해소)

결과(당시): **순차 트윈·재완료 방어 PASS / 실제 동시 선점 2건 모두 성공 — 이후 상단 서버 원자 claim 후보에서 38/38 PASS**

- 로컬 UI 체크포인트 커밋 직후 다른 작업자가 `lib/domain/settlement-engine.ts`에 같은 실차의 복수 `product_code`를 번호판/VIN으로 묶어 선점·중복완료를 차단하는 변경을 추가했고 커밋 `4f9d64b`로 반영했다. 잔여 원자성 위험은 후속 문서 커밋 `8df5c9c`에 기록됐다.
- 기존 `sim-vehicle-lock` fixture가 모든 테스트 차량에 같은 번호판을 써 새 트윈 판정에서 테스트 간 오염되던 문제를 고쳤다. 같은 번호판의 다른 코드 선점 차단, 번호 미정 차량 비병합, 취소된 5/5 계약의 재완료 금지, 완료처리 재시도의 트윈 중복완료 차단을 추가했다. 순차 시나리오는 **36/36 PASS**다.
- 적대 동시 실행을 추가하자 같은 차량의 두 `applyStepCheck(..., 'agent_balance_paid', 'yes')`가 모두 fulfilled됐다. 두 계약 모두 `agent_balance_paid=yes`이고 상품 `locked_by_contract`만 마지막 계약으로 덮여 **36/38 FAIL**이다. 사전 fresh read는 stale cache를 줄일 뿐 read→계약 update→상품 update 사이의 경쟁을 원자화하지 못한다.
- 비게시 후보 Rules의 `agent_balance_paid`·`provider_balance_confirmed` validation은 역할만 확인하고 단일 차량 신원 락/CAS를 요구하지 않는다. 현재 product lock Rules도 각 `product_code`와 계약 결속만 검사하므로 같은 코드 동시선점과 트윈 코드 경쟁을 한 번에 직렬화하지 못한다.
- 관련 회귀는 typecheck, 정산 E2E **22/22**, 생애주기 PASS, private 정산 **8/8 PASS**다. 즉 일반 순차 흐름은 유지되지만 실제 다중 사용자 경쟁 안전성은 미충족이다.
- 안전한 해결에는 서버/RTDB의 원자적 차량 신원 claim SSOT가 필요하다. 권장안은 번호판/VIN 정규화 해시를 불변 계약 스냅샷으로 두고 서버 transaction으로 `v4/vehicle_claims/{identityHash}`를 선점한 뒤 계약·상품 전이를 수행하며, Rules가 claim 소유 계약과 일치하지 않는 계약금/완료 write를 거부하는 구조다. 클라이언트 메모리 mutex는 브라우저 간 경쟁을 막지 못하므로 금지한다. 데이터 계약·Rules·정산엔진 위험영역이므로 사용자 승인과 사람/Claude 게이트 전 구현·게시·커밋하지 않는다.

## 2026-08-04 비게시 Rules 후보 재생성·실데이터 읽기 전용 게이트

결과: **후보 정적·Emulator PASS / 현재 재고 브리지 유지 가능 / 실계정 smoke·운영자 정보 전 게시·전체 오픈 NO-GO**

- `scripts/ruleprobe/build-release-candidate.mjs`로 현재 `database.rules.json`에서 비게시 후보를 다시 생성했다. 재생성 전후 SHA-256은 `DEA7B53BC345142BD0425419EE0AB59F3AAE8F798537BDAC6ADCDB19C9FD7DFE`로 같아 생성기·후보 드리프트가 없다. 운영 Rules는 수정·게시하지 않았다.
- 후보 정적검사는 보안 **14/14**, 계약 **26/26**, 전자서명 **58/58**, 채팅 **43/43 PASS**다. 기존 9099/9000 에뮬레이터와 개발 서버를 종료하지 않고 9199/9100 격리 포트에서 Firebase Auth+RTDB 실제 HTTP 허용·차단 **32/32 PASS**를 확인했다. 임시 포트 설정은 검증 후 삭제했다.
- Firebase CLI와 공급사 Sheet를 사용한 최신 읽기 전용 대조는 공급사 16곳·올림 388대, v3-only **292건/288대**, 서버 브리지 응답 후보 **740건**이다. 진행계약 보호 4대, 승인 후 Sheet overlay 후보 236대, 시트 없음·참조 보존 브리지 유지 5대, 시트·참조 없음 공급사 확인 43대이며 운영 write는 0건이다. 따라서 후보 게시 전후에도 product 브리지와 `NEXT_PUBLIC_BRIDGE_V3` 기본 유지가 필수다.
- 로컬 B2B 게이트는 코드·클라이언트 환경·후보·브리지 항목 **21 PASS**이고 현재 셸에 `FIREBASE_SERVICE_ACCOUNT_JSON`이 없어 **1 FAIL**이다. 일반 출시 게이트는 실제 법적 운영자 정보 6개 미기재로 **1 FAIL**, 서비스 워커 미구현 **1 WARN**이다. 비밀값이나 실제 사용자 토큰을 임의 생성·출력하지 않았다.
- 후보 자체에서 새 수정 필요 항목은 발견되지 않았다. 게시 전 남은 필수조건은 서비스계정이 있는 새 Preview에서 전용 영업자·공급사 QA 토큰으로 브리지 200·목록수·원가/VIN 격리 smoke, 사람/Claude의 실데이터 Rules 승인, 백업·롤백 준비다. 게시 후에는 관리자·영업자·영업관리자·공급사·공급관리자와 정상/제출완료/폐기 서명 토큰 read/write smoke가 필요하다.

## 2026-08-04 공개 전자서명 모바일 UI·Rules 재검수

결과: **모바일 UI PASS / 비게시 Rules 후보 58/58 PASS / 현재 추적 Rules 보안 게이트 FAIL — 전체 오픈 NO-GO 유지**

- `/sign/[token]`의 한글 원문은 정상 UTF-8이며 앞서 보인 깨진 글자는 PowerShell 기본 표시 인코딩 문제였다. 서명 지우기와 제출을 공통 아이콘+텍스트 규격으로 바꾸고 제출 CTA를 전폭으로 맞췄다. 비상연락 필드는 좁은 폭에서 한 열로 자연스럽게 접히며, 카드·서명판·펜 색상은 디자인 토큰을 사용한다. 서명 canvas에는 접근성 이름을 추가했다.
- 390×844 로컬 브라우저에서 `/sign/not-a-real-token`을 직접 열어 `유효하지 않은 링크`와 만료·오류 안내가 깨짐 없이 표시되고 가로 넘침이 없는 것을 확인했다. 실서명 토큰을 생성하거나 계약 데이터를 쓰지 않았으므로 정상 토큰의 제출 E2E는 수행하지 않았다.
- `typecheck`, UI contract, fonts, phase12 **67/67**, 별도 `NEXT_DIST_DIR=.next-codex-public-sign` production build **30/30 routes PASS**다. 빌드가 자동 변경한 `tsconfig.json`은 원복했다.
- 독립 보안검사에서 현재 `database.rules.json`의 익명 `contract_sign/$token` read가 만료·폐기만 확인하고 `status === 'sent'`를 요구하지 않아 마지막 게이트에서 실패했다. 이미 존재하는 비게시 `scripts/ruleprobe/release-candidate.rules.json`은 해당 제한을 포함하며 같은 전자서명 Rules 검사 **58/58 PASS**다.
- 작업원칙에 따라 `database.rules.json`을 수정·게시하지 않았다. 사람/Claude가 비게시 후보를 실데이터로 승인하고 게시한 뒤 정상·제출완료·폐기 토큰 read/write smoke를 통과하기 전 공개 전자서명 포함 전체 오픈은 금지한다. 계약 write·정산 엔진·RTDB 어댑터·운영 데이터·배포 변경은 없다.

## 2026-08-04 모바일 재고·정책 조회/편집 모드 분리

결과: **조회 정보행 전환 PASS / 수정 입력폼 복원 PASS / 조회 중 편집 컨트롤 0 PASS**

- 모바일 재고·정책 상세가 조회 중에도 비활성 input/select를 길게 나열해 값보다 폼처럼 보이고, 재고 대여료 input은 CSS `pointer-events`에만 기대어 키보드 포커스 여지도 남아 있었다. 공통 `FormReadList`를 추가해 스키마 필드를 `ListGroup + DetailRow` 정보행으로 표시하고 빈 값은 `—`, 숫자·전화·선택 라벨·칩을 조회 형식으로 정규화했다.
- 정책은 모바일 조회일 때만 정보행, 신규/수정 또는 데스크톱은 기존 `FormGrid`를 유지한다. 재고는 차종 마스터·신원·공급사·제원·운영상태·정책·주행 정보를 조회 정보행으로 바꾸고, 등록증 업로드·초기화·복사·붙여넣기는 수정 진입 전 숨긴다.
- 대여료 표는 `readOnly`에서 input·기간추가·삭제를 제거하고 실제 금액이 있는 기간만 숫자 텍스트로 표시한다. 사진도 조회 중 추가·꾹 편집·확대 편집푸터는 숨기되 탭 확대는 유지한다.
- 390×844 실제 관리자 세션에서 재고 조회 input 0/select 0/사진추가 0, 정책 조회 input 0, 문서폭 390/390을 확인했다. `수정` 진입 시 재고 29개·셀렉트 6개, 정책 39개 편집 컨트롤과 아이콘+텍스트 취소/저장이 다시 표시됐으며 값을 바꾸거나 저장하지 않고 취소했다.
- `typecheck`, UI contract, fonts, phase12 **64/64**, 별도 `NEXT_DIST_DIR=.next-codex-mobile-read` production build **30/30 routes PASS**다. 저장 핸들러·도메인 데이터·Rules·RTDB 어댑터·계약/정산 엔진·write·배포는 변경하지 않았다.

## 2026-08-04 모바일 비계약 실행 버튼 전수 보강

결과: **회원·설정·문의·재고 보조액션 아이콘 규격 PASS / 모바일 문의 전송 icon-only PASS / 가로 overflow 0 PASS**

- 계약 외 모바일 사용자 경로를 소스와 390×844 실제 관리자 세션으로 다시 검사했다. 회원 상세의 `승인 취소(대기로)`가 텍스트-only였고 설정의 저장·비밀번호·로그아웃·링크복사·관심목록 정리, 상품 검수 요청, 재고 편집 초기화·복사·붙여넣기에도 같은 잔여 드리프트가 있었다.
- 위 결정적 실행은 공통 `ButtonLabel`의 아이콘+텍스트로 통일했다. 간단문의 입력행은 입력폭 우선 예외에 맞춰 모바일에서 전송 아이콘-only, 웹에서는 전송 아이콘+텍스트를 유지하고 전체 대화 이동은 아이콘+텍스트로 표시한다.
- 실제 회원 상세에서 승인취소·목록·수정·삭제 버튼 모두 SVG 1개를 확인했다. 실제 설정에서 내 정보 저장·비밀번호 변경·로그아웃·카탈로그 복사·최근/찜 비우기 모두 SVG 1개, 문서폭 390/390, 엑셀·다운로드 노출 0을 확인했다.
- 회원 승인·민감정보·재고 저장 등의 핸들러와 도메인 로직은 바꾸지 않았다. 운영 데이터·Rules·RTDB 어댑터·계약/정산 엔진·write·배포 변경도 없다.
- `typecheck`, UI contract, fonts, phase12 **59/59**, 계약 업무목록 **142/142**, 별도 `NEXT_DIST_DIR=.next-codex-mobile-actions2` production build **30/30 routes PASS**다. 빌드가 자동 변경한 `tsconfig.json`은 원복했고 로컬 서버를 유지했다.

## 2026-08-04 모바일 상세 실행 버튼 아이콘 규격 검수

결과: **결정적 실행 버튼 아이콘+텍스트 통일 PASS / 선택 버튼 텍스트 유지 PASS / 모바일 엑셀 미노출 PASS**

- 모바일 규격을 다시 대조해 모든 버튼을 무조건 아이콘-only로 바꾸지 않았다. 뒤로·닫기·검색·필터 같은 탐색/도구만 아이콘-only이고, 저장·삭제·승인·정산확정·문의 같은 결정적 실행은 아이콘+텍스트, 가능·협의·불가 및 승인·부결 같은 선택지는 텍스트를 유지하는 SSOT다.
- 390×844 실제 관리자 세션에서 계약 상세를 열어 계약취소·출고 문의·완료 표시 등 결정적 버튼이 텍스트-only인 상태를 확인했다. 공통 `ButtonLabel`을 추가하고 계약 진행, 전자서명, 메모 저장, 첨부 삭제, 금액 저장, 정산 상태 변경에 같은 아이콘+텍스트 조합을 적용했다.
- 수정 후 실제 DOM에서 계약 취소·출고 문의하기·완료로 표시 버튼 각각 SVG 1개를 확인했다. 가능·협의·불가 선택지는 SVG 0개로 유지했고, 하단 목록·진행·서류·정산 탭은 각각 아이콘 1개와 라벨이 함께 표시됐다. 모바일 엑셀 다운로드는 노출되지 않았다.
- 표현 계층만 수정했다. 계약 엔진, 정산 엔진, RTDB 어댑터, Rules, 운영 데이터, write, 배포는 변경하지 않았다.
- `typecheck`, UI contract, fonts, phase12 **53/53**, 계약 업무목록 **142/142**, 별도 `NEXT_DIST_DIR=.next-codex-mobile-actions` production build **30/30 routes PASS**다. 빌드가 자동 변경한 `tsconfig.json`은 원복했고 로컬 개발 서버는 유지했다.

## 2026-08-04 모바일 계약 목록 첫 페인트·표시명 보강

결과: **문의→계약 전환 skeleton 재등장 제거 / 정산 read 비차단 / 공급사 내부코드 깜빡임 제거 PASS**

- 모바일 cold 직접 진입을 다시 계측하니 재고 실데이터는 약 2초, 계약은 약 9초에 도착해 이전 20~27초가 항상 재현되지는 않았다. 네트워크·개발 서버 변동과 별개로, 문의에서 이미 읽은 계약 캐시가 있어도 `/contract`가 `rows=null`로 시작하고 정산 read까지 기다린 뒤 행을 그리는 확정 병목을 수정했다.
- 계약 화면은 같은 인증 세션에서 권한 스코프로 읽은 `peekList('contract')`를 첫 렌더에 사용하고 곧바로 live read로 갱신한다. 인증 변경 시 전역 store cache가 비워지는 기존 안전장치는 유지했다.
- 계약 행은 계약 read 완료 즉시 표시하고, 목록에 필요 없는 정산 목록은 백그라운드 선조회로 분리했다. 상세 선택은 같은 pending/cache Promise를 재사용하므로 정산 기능·단일 writer·금액 로직은 변경하지 않았다.
- 공급사 파트너 목록을 대용량 상품·삭제이력 보강보다 먼저 독립 조회하고 `providerNameMap`을 목록 인덱스에 합쳤다. 캐시 계약이 먼저 보일 때 `RP018` 같은 내부코드가 잠시 노출되지 않고 첫 계약 프레임부터 `스타` 등 실제 표시명이 나온다.
- 390×844 실제 하단 독에서 `/chat` 176행을 읽은 뒤 `계약진행`을 클릭했다. `/contract` 첫 관찰 프레임에 실제 43행·공급사명·상태 배지가 함께 표시됐고 skeleton 0, 좌측 inset 0, 문서 폭 390/390이었다.
- UI 계약 게이트에 계약 캐시 첫 페인트와 `setRows`가 정산 완료보다 앞서야 한다는 조건을 추가했다. `typecheck`, UI contract, fonts, 계약 업무목록 142/142, 별도 production build 30/30 routes PASS다. 운영 데이터·Rules·계약/정산 write·배포는 변경하지 않았다.

## 2026-08-04 모바일 목록 좌측 바·반응형 정밀 검수

결과: **좌측 상태 바 제거 PASS / 모바일 단일 목록·가로 overflow 0 PASS / 실데이터 주요 목록 표시 PASS**

- 실제 390×844 로컬 관리자 세션에서 `/chat`을 확인해 미확인·진행 행에 남아 있던 주황/파랑 좌측 inset 바를 재현했다. `FeedListRow`의 `accent` API와 `ChatRoomRow` 전달을 제거해 상태는 썸네일 아이콘·배지·안읽음 숫자로만, 선택은 `C.selected` 배경으로만 표현하도록 공통 SSOT를 고정했다.
- 같은 검수에서 데스크톱으로 진입한 뒤 폭을 390px로 바꾸면 4패널이 좁은 화면에 압축되는 결함을 발견했다. `data-fp-m`이 부트 이후에도 live viewport보다 우선하던 것이 원인이며, 마운트 후 모바일 판정은 `window.innerWidth`를 단일 기준으로 사용하도록 수정했다. 초기 SSR 힌트·쿠키 동기화는 그대로 유지한다.
- 수정 후 `/chat` 실제 176행에서 좌측 inset 0, `/contract` 43행, `/inventory` 101행, `/members` 101행, `/settlement` 11행, `/policy` 26행을 순회했다. 전 화면 `innerWidth=scrollWidth=390`, 공통 목록 좌측 inset 0이며 데스크톱 다중 패널 대신 모바일 단일 목록·하단 독으로 표시됐다.
- 회원·파트너의 긴 UID/회사 정보는 행 내부에서 잘리고 문서 가로 스크롤은 생기지 않았다. 계약·재고·회원·정산·정책의 3줄 정보 구조와 상태 아이콘·배지 표현은 유지됐다.
- `check-ui-contract.mts`에 좌측 `accent` 재도입 금지와 live viewport 판정 계약을 추가했다. `typecheck`, UI contract, fonts, 재고 표시 28/28, 회원 표시 10/10, 정산 표시 30/30, 별도 `NEXT_DIST_DIR=.next-codex-mobile-list` production build 30/30 routes가 PASS다. 빌드가 자동 변경한 `tsconfig.json`은 원복했다.
- 관찰사항: 로컬 cold 직접 진입에서 계약·재고 실데이터 도착이 약 20~27초까지 걸린 사례가 있었다. 무한 로딩은 아니었고 데이터 도착 후 정상 표시됐지만, 새 Preview에서 역할별 실계정으로 초기 read 시간을 다시 계측해야 한다. 운영 데이터·Rules·배포·write는 변경하지 않았다.

## 2026-08-04 공급사 Sheet exact patch/CAS dry-run 2단계

결과: **후보별 exact 공개 v4 patch·CAS 생성 PASS / private 유입·참조이관 fail-closed / 실제 적용·운영 write 0건**

- `lib/domain/sheet-decision-patch-dry-run.ts`를 추가했다. 1단계 적용계획의 검토 후보를 `Sheet 유입 제외 원장 create-if-absent`, `동일 삭제키 복구 update`, `신규 상품 create-if-absent`, `승인된 신원 원자 update`의 정확한 경로·patch·CAS 기대값으로 변환한다.
- 삭제 복구는 기존 `softMergeProduct`·`changedPatch`를 재사용한다. 빈 Sheet 값은 수기값을 지우지 않고, `_deleted/deletedAt/deletedReason/legacy status=deleted` 해제만 명시하며 현재 공개상품을 `productPatchPreconditionMatches`와 같은 필드 집합으로 CAS 대조한다.
- 신규 상품은 현재 Sheet 공개 필드만 사용하고 회사·생성/수정자·결정 지문을 기록하는 create-if-absent 후보를 만든다. 신원 갱신은 관리자가 승인한 제조사·모델·세부모델·트림·내외장색·연식·연료·최초 신원서명 원자만 기존키에 patch하며 상태·가격은 따라오지 않는다.
- Sheet 입력이나 기존 CAS 출력에 원가·VIN·계좌·기간별 fee/commission/fee_memo가 섞이지 않는다. 신규/복구 Sheet 행에 private 값이 있으면 patch 0건으로 fail-closed한다. 검토 JSON에도 private 값과 원본 충돌 raw는 포함하지 않는다.
- 공급사 대표키 변경은 계약·채팅·견적·private의 역사 참조 처리 정책이 확정되지 않았으므로 `blocked_reference_migration`으로 유지한다. 상위 적용계획에서 계약보호·원장불일치·키 중복 등으로 차단된 행도 patch 후보로 승격하지 않는다.
- 관리자 `데이터 검증`에 `patch dry-run JSON` 버튼을 연결했다. 정확한 공개 patch와 최소 CAS 기대값을 복사하지만 저장 API·적용 버튼·동기화 차단 해제는 없다. 모든 행은 `applyAllowed=false`, 요약은 `executableOperations=0`이다.
- 신규 patch dry-run 적대검증 **21/21 PASS**. 적용계획 **20/20**, Sheet merge **128/128**, 일일동기화 **21/21**, 가격승인 **10/10**, 소유권결정 **15/15**, 결정 dry-run **16/16**, 신원검토 **17/17**, 신원결정 **15/15**, 차량잠금 **23/23** — 관련 회귀 합계 **286/286 PASS**다.
- `typecheck`, fonts, UI contract, 별도 `NEXT_DIST_DIR=.next-codex-sheet-patch` production build **30/30 routes** PASS다. Next가 자동 추가한 임시 dist include는 `tsconfig.json`에서 원복했다. 운영 데이터·Rules·환경변수는 변경하지 않았다.
- 다음 게이트: 운영/Preview 실제 판단 원장으로 이 JSON을 생성해 사람/Claude가 공급사 대표키 참조 정책과 각 후보 patch를 승인한다. 그 전에는 적용 API를 만들거나 `planDailySheetSync`가 제외 원장을 소비하게 해서는 안 되며 `SHEET_DAILY_SYNC_ENABLED=false`를 유지한다.

## 2026-08-04 공급사 Sheet 판단 원장 적용계획 1단계

결과: **판단 원장 → 차량별 비파괴 적용계획 PASS / 실제 patch·동기화 차단 해제·운영 write 0건**

- `lib/domain/sheet-decision-application-plan.ts`를 추가했다. 현재 검증 스냅샷과 소유권·삭제 결정 원장, 신원 결정 원장을 함께 읽어 `Sheet 유입 제외`, `삭제키 복구`, `신규 상품 생성`, `공급사 대표키·참조 이관`, `동일차 신원 원자 갱신` 후보로 분류한다.
- 공급사 변경 후보는 상품의 `v4/products`만 바꾸지 않는다. `v4/products_private`와 계약·채팅방·견적의 상품 참조 건수를 계산하고 `requires_reference_migration`으로 분리한다. 실제 참조 patch는 생성·실행하지 않는다.
- 계약보호, 공급사·기존키·Sheet키 다중/누락, 병합 별칭 tombstone, 현재 데이터와 원장 불일치, 신규키 기존 존재, 서로 다른 판단의 동일 상품키 중복, 현재 충돌에 없는 stale 원장을 모두 fail-closed한다.
- 모든 계획 행은 `applyAllowed=false`, 전체 요약은 `executableOperations=0`으로 고정했다. 후보 경로·필드·참조 수는 다음 단계의 검토 근거일 뿐 저장 payload가 아니다.
- 관리자 재고 `데이터 검증`은 기존 계약과 함께 채팅방·견적을 병렬 read하고, `적용 계획 TSV`에서 후보작업·상태·계약/채팅/견적 참조 수·후보경로·다음조치를 복사할 수 있다. 버튼은 저장이나 동기화 차단 해제를 수행하지 않는다.
- 신규 적대 시뮬레이션 **20/20 PASS**. 기존 Sheet merge **128/128**, 일일 동기화 **21/21**, 가격승인 **10/10**, 소유권·삭제 결정 **15/15**, 결정 dry-run **16/16**, 신원검토 **17/17**, 신원결정 **15/15**도 재통과했다.
- `typecheck`, fonts, UI contract, 별도 `NEXT_DIST_DIR=.next-codex-sheet-application` production build **30/30 routes** PASS다. 빌드가 dev 산출물을 덮지 않아 `http://localhost:4004/login` HTTP 200, PID 49616을 유지했다.
- 중요: 이 계획기는 아직 `planDailySheetSync`나 `commitFetchedPartnerSheets`가 소비하지 않는다. `SHEET_DAILY_SYNC_ENABLED`는 계속 false여야 한다. 다음 게이트는 후보별 정확한 v4 patch/CAS payload를 **무저장으로만** 생성하고 사람/Claude가 참조 이관·복구 정책을 승인하는 것이다.

## 2026-08-04 버벅임·먹통 오픈 최종점검

결과: **성능·응답성 게이트 PASS / 전체 오픈은 법적 정보·수정본 Preview·실계정·Rules 승인 전 NO-GO**

- 정상 Ready Preview `dpl_9H8TtHymfPhUcocr1gbvpnim66FQ`에서 직접 경로 전환을 데스크톱 24회, 모바일 15회 반복했다. 총 **39회 중 실패·먹통 0**, 데스크톱 평균 606ms/최대 1,590ms, 모바일 평균 677ms/최대 1,565ms였다. 가로 overflow와 console error/warning도 0건이다.
- 최초 진입은 로그인 1,762ms, 공개 상품찾기 1,542ms, 공급사 재고 1.4~1.6초가 상대적으로 느렸고 나머지 주요 업무 화면은 약 0.35~0.7초였다. 2초를 넘은 직접 경로 전환은 0건이다.
- 모바일 계약 필터는 실제 dialog가 정상 열리고 닫혔다. 자동화 locator가 한 차례 3초 timeout을 냈지만 화면·DOM은 계속 응답했고 재시도는 289ms였다. 닫기 후 220ms exit animation 때문에 자동화 시간이 길게 잡힐 수 있으나 실제 고정 overlay나 먹통은 재현되지 않았다.
- 로컬 관리자 실데이터 355대 기준 재고 hard reload는 shell 표시 약 **0.50초**, 전체 행 도착 약 **4.75초**였다. 빈 화면은 아니지만 네트워크/브리지 최초 read가 가장 큰 체감 지연이다. warm 재진입은 즉시 수준이다.
- `features/inventory/useInventoryData.ts`에서 권한 확인 직후 4패널 shell을 먼저 표시하고 정책·상품(내부 파트너 보강 포함) read를 병렬화했다. 기존 정책 → 상품 → 파트너 순차 대기를 제거했으며 write·v3·Rules·정산 엔진은 건드리지 않았다.
- 공통 `Loading`은 12초 이상 지속되면 지연 안내와 `새로고침` 복구 버튼을 표시한다. 관리·공개 상세 페이지의 미종료 통신도 더 이상 설명 없는 무한 스피너로만 남지 않는다.
- 수정 후 `npm run typecheck`, `npm run check:fonts`, `npm run check:ui`, 재고 표시 **28/28**, `git diff --check`, Next production build **30/30 routes**가 PASS다. production build와 dev가 같은 `.next`를 사용해 기존 dev가 500이 된 것을 즉시 발견했고, 서버를 재기동해 `http://localhost:4004/login` HTTP 200을 재확인했다. 현재 포트 4004 listener는 PID 49616이다.
- 이 최적화와 장시간 로딩 복구 UI는 현재 로컬 소스에만 있으며 위 Ready Preview에는 포함되지 않았다. 새 정상 Preview 배포 후 355대 실계정 재고 hard reload와 역할별 화면을 다시 확인해야 한다. Production 별칭·데이터·Rules는 변경하지 않았다.
- 전체 오픈 차단은 성능 문제가 아니라 기존의 약관/개인정보 운영자 사실값 6개, 영업자·공급사 QA 토큰 smoke, 사람/Claude의 후보 Rules·실데이터 승인이다.

## 2026-08-03 Chrome 초정밀 오픈 전 검수

결과: **화면·기능·빌드·비게시 Rules 후보 PASS / 법적 운영자 정보·운영 Rules 승인·역할별 실계정 smoke 전 전체 오픈 NO-GO**

- Chrome에서 Ready Preview `dpl_9H8TtHymfPhUcocr1gbvpnim66FQ` (`freepasserp4-48ikovxat-freepass-projects.vercel.app`)를 직접 검수했다. 로그인·회원가입·비밀번호 재설정·둘러보기·상품찾기·FAQ·약관·개인정보, 영업자 `/chat`·`/contract`, 공급사 `/inventory`·`/policy`·`/chat`·`/contract`, 권한 제한 경로를 실제 탐색했고 console error/warning은 0건이다.
- 데스크톱 1920×889에서 재고·정책·채팅·계약의 4패널, 검색·정렬·필터, 빈 상태, 공급사 상품등록 폼 진입·취소를 확인했다. 저장·업로드·삭제 등 운영 write는 실행하지 않았다.
- 모바일 390×844에서 가로 overflow 0, 접근성 이름 없는 버튼 0, 엑셀 버튼 미노출, 계약 화면의 비규격 `대기·완료·환수·순수익` 지표 미노출을 확인했다. 계약 필터 dialog와 공급사 재고 하단탭·아이콘 툴바도 실제 클릭/시각 검수했다.
- 직접 URL 검수에서 관리자 전용 `/data-check`·회원·감사 화면이 권한 판정보다 `seedIfEmpty`를 먼저 기다리고, `/diag`가 비로그인에도 RTDB 노드 진단 UI를 노출하는 문제를 발견했다. `app/data-check/page.tsx`, `app/members/page.tsx`, `app/audit/page.tsx`, `app/dev/page.tsx`는 권한 확인을 초기화보다 앞으로 옮겼고 `app/diag/page.tsx`에는 관리자 게이트를 추가했다.
- 수정 후 `tsc --noEmit`, fonts, tokens, UI contract, Next production build(정적 페이지 30/30)가 PASS다. 전체 `sim-*.mts` 38개 중 기능 시뮬 35개가 PASS했고, 운영 `database.rules.json`을 일부러 검사한 보안 3개는 기존 운영 Rules 미게시 상태 때문에 예상대로 실패했다.
- 같은 3개 검사를 비게시 `scripts/ruleprobe/release-candidate.rules.json`에 적용하면 보안 **14/14**, 계약 **26/26**, 전자서명 **58/58** PASS다. 기존 9000/9099 서버를 끄지 않고 9100/9199 격리 포트에서 Firebase Emulator **32/32 PASS**를 재확인했다. 운영 `database.rules.json`은 수정·게시하지 않았다.
- `check-release --rules=...release-candidate...`의 유일한 차단은 약관·개인정보의 **상호, 대표자, 주소, 사업자등록번호, 문의 이메일, 개인정보 보호책임자** 6필드 누락이다. 192/512 PNG 아이콘과 서비스워커는 PWA 범위 경고 2건이다.
- UI 권한 수정본 새 Preview 업로드를 시도해 `dpl_6MUEdmNbgKp5Ng5oEL9cffn98r8S`가 생겼지만 Vercel CLI 업로드가 완료되지 않아 status `UNKNOWN`, build 0ms다. 이 배포는 검수·사용 금지이며 정상 Preview는 위 Ready 배포다. Production 환경·별칭·데이터는 변경하지 않았다.
- 로컬 개발 서버는 `http://localhost:4004`에 숨김 백그라운드로 다시 기동해 유지했다. 로컬 Chrome에는 기존 관리자 세션이 있어 사용자 세션을 지우는 비로그인 재현은 하지 않았고, 수정본 런타임 배포 재확인은 다음 정상 Preview에서 수행한다.
- 전체 오픈 조건: 법적 6필드 입력 → 새 Ready Preview에서 비로그인 `/data-check`·`/diag` 홈 전환 재확인 → 전용 영업자·공급사 QA 토큰 bridge 200/private 격리 smoke → 사람/Claude의 Rules·실데이터 승인 → 운영 Rules 게시 및 역할별 write/read smoke.

## 2026-08-03 영업자·공급사 B2B 운영 오픈 재판정

결과: **기능·화면·비게시 후보 Rules·Preview 비인증 스모크 PASS / Preview 역할별 실계정 smoke·사람 Rules 승인 전 B2B 오픈 NO-GO / 손님 공개 페이지·법적 고지는 후속 범위**

- 오픈 범위를 실로그인 영업자·공급사의 상품조회, 계약문의, 계약진행, 공급사 재고·정책, 계약별 정산조회로 한정해 다시 검증했다. 관리자 월별정산은 운영 지원 기능으로 포함하고 손님 공유/서명 화면 정비는 다음 범위로 분리했다.
- 영업자 전체 여정 **44/44**, 공통 문의·계약 **48/48**, 역할·소유권 **44/44**, 채팅 Rules **43/43**, 계약 업무목록 **142/142**, 재고표시 **28/28**, 회원표시 **10/10**, 정산표시 **30/30**, 차량 생애주기 PASS, 차량잠금 **23/23**, 3자 계약→정산 **22/22**, 삭제상품 보안 **10/10**, 정산 private write **8/8**을 통과했다.
- `sheet-merge.ts`에서 Sheet 가격 soft-merge에 따라오던 `fee/commission/fee_memo`와 원가·VIN·계좌 원자를 CAS 패치 전에 제거했다. Sheet는 공개 재고·대여조건만 갱신하고 private 원자는 건드리지 않으므로, 공개 가격만 먼저 저장된 뒤 화면이 실패로 보고하는 부분 성공 경로를 제거했다. Sheet merge는 **128/128 PASS**다.
- 브라우저에서 영업자 `/chat`·`/contract`, 공급사 `/inventory`·`/policy`·`/contract`를 직접 렌더했다. 역할을 공급사로 바꿔도 상단 계정명이 `박영업`으로 남던 결함을 `TopBar`의 `fp:role` 구독으로 수정했고, `둘러보기·제일오토렌탈` 즉시 반영과 콘솔 error 0을 확인했다.
- type/fonts/tokens/UI contract와 production build 정적 페이지 **30/30 PASS**다. 로컬/기본 설정에서 `SHEET_DAILY_SYNC_ENABLED`는 true가 아니므로, 미결 Sheet 충돌이 있는 자동 저장은 활성화되지 않는다.
- 현재 운영 `database.rules.json`은 B2B 보안 차단 12개가 남는다. v3 원문 광역 read/write, v4 소유권, 계약 스냅샷·고객 PII·전자서명·메모, 공급사 취소, settlement/private 금액 위조가 운영 규칙에서 아직 닫히지 않았다. 실제 `sim-contract-rules`도 계약 차량 스냅샷 불변에서 실패한다.
- 비게시 후보에서 기존 검사가 놓친 `v4/products` read 계정상태 우회를 발견했다. 후보 생성기에 활성·배정 역할 제한을 추가하고 승인대기·비활성·삭제·반려·미배정 역할의 실제 Emulator read 차단을 보강했다. 현재 후보는 보안 **14/14**, 계약 **26/26**, 전자서명 **58/58**, 격리 Emulator **32/32 PASS**다. 운영 `database.rules.json`은 수정·게시하지 않았고 이 후보는 사람/Claude 실데이터 게이트 전 머지·게시 금지다.
- 최신 운영 read-only 대조는 공급사 Sheet 16곳·389대, v3-only **292건/288대**를 확인했다. 이 가운데 현재 Sheet 연결 239대(참조보호 31대 포함), 참조만 7대, Sheet·참조 없음 42대다. 따라서 후보 Rules만 먼저 게시하면 영업자·공급사 화면에서 정당한 레거시 재고가 사라지는 것이 확정됐다.
- 데이터 강제이관 대신 `/api/products/bridge` 읽기 전용 호환층을 추가했다. 서버가 ID token과 현재 `users/{uid}`의 역할·승인·활성 상태를 매 요청 재검증하고, 영업자·타 공급사 매물에서는 원가·VIN·계좌·기간별 내부 수수료를 제거한다. 공급사는 자기 회사 원문만, 관리자는 운영 원문을 받는다. 클라이언트는 이 API를 먼저 사용하고 현재 Rules/로컬 서버 미설정 때만 기존 직접 read로 복구한다. v3/v4 write 경로는 바꾸지 않았다.
- 서버 응답은 활성 재고와 계약·문의가 실제 참조하는 삭제 이력만 선별한다. 최신 운영 read-only 계산은 원시 약 5,700건 중 **740건**으로 응답 상한 2,000건 안이다. 상품 서버 브리지 적대검증 **16/16 PASS**, 비인증 API HTTP **403**, typecheck 및 production build 정적 페이지 **30/30 PASS**다. 브라우저에서 영업자·공급사 역할 전환과 `/catalog`·`/chat`·`/contract`·`/inventory`·`/policy`를 재검수했고 콘솔 로그 0건이다. 둘러보기에는 실계정 토큰이 없어 인증 성공 API E2E는 운영 전 smoke gate로 남겼다.
- Vercel Preview에만 서버 전용 `FIREBASE_SERVICE_ACCOUNT_JSON`을 Sensitive로 등록하고 격리 소스 스냅샷을 배포했다. 첫 Preview에서 `firebase-admin@14.2.0 → jwks-rsa@4 → jose@6`의 CJS/ESM 충돌로 Admin SDK 사용 API가 500이 되는 것을 실런타임 로그로 확인했다. `firebase-admin`을 마지막 13.x인 `13.10.0`으로 고정해 `jwks-rsa@3.2.2 / jose@4.15.9`로 복구했다.
- Next 자체 고위험 Server Actions/SSRF 패치를 위해 `next@15.5.21`을 고정했다. 이어 서버 `not-found`가 client UI 배럴의 `FW/C` 객체 속성을 접근해 `/login` 로그에 남기던 React 직렬화 오류를 리프 import로 수정하고 UI 계약 게이트에 재발 검사를 추가했다. SheetJS 보안 교체까지 포함한 최종 Preview `dpl_9H8TtHymfPhUcocr1gbvpnim66FQ` (`freepasserp4-48ikovxat-freepass-projects.vercel.app`)는 Ready이며 로그인 200, 존재하지 않는 경로 404, Admin API 3종 비인증 403, 요청 후 Vercel error 로그 0건이다.
- 중단된 npm `xlsx@0.18.5`는 SheetJS 공식 설치 지침에 따라 보안 수정본 `0.20.3` 공식 CDN tarball로 고정했다. 메모리 workbook write/read roundtrip, 정산표시 30/30, 정산 E2E 22/22, private 8/8, Phase12 48/48, Sheet merge 128/128 PASS다. production 의존성 감사는 critical 0, high 3, moderate 8로 감소했고 남은 high는 Next가 아직 고정한 `postcss/sharp` 전이 항목과 그 집계다. Next upstream 호환 전 무검증 override·강제 major 수정은 하지 않는다.
- 수정 Preview에서 `/login` GET은 200, `/api/products/bridge`·`/api/inventory/duplicate-plan`·`/api/sheet/sync-status` 비인증 요청은 모두 500 없이 403으로 fail-closed했다. Production 환경변수와 별칭은 변경하지 않았으며 공개 Production `/api/products/bridge`는 계속 404다.
- `npm run check:b2b-release`는 Vercel Node 함수와 호환되지 않는 Admin SDK 하위 의존성 조합도 차단한다. 서비스계정을 현재 프로세스에만 주입한 실제 결과는 **23 PASS / 0 FAIL**이고, 비밀값은 저장소·명령 출력에 남기지 않았다.
- `smoke-b2b-product-bridge.mts`는 배포 URL과 환경변수로 받은 영업자·공급사 ID token을 사용해 비인증 403, 양 역할 200, 상품 집합·count, 영업자 private 0, 공급사 타회사 private 0, 공개내용 일치를 검사한다. 전용 QA 토큰 2개가 없어 인증 성공 부분은 아직 미실행이며 실제 운영 사용자를 임의로 가장하지 않았다.
- 최종 조건: 전용 영업자·공급사 QA 토큰으로 Preview 브리지 목록·원가 격리 smoke → 사람/Claude가 보강된 후보 Rules와 실데이터 호환성 승인 → 운영 Rules 게시 → 문의·계약 단계 write·정산 read smoke. 서버 브리지보다 Rules를 먼저 게시하면 안 된다.

## 2026-08-03 신원·미확정 충돌 차량별 결정 원장

결과: **남은 16대 관리자 판단 기록 PASS / 계약보호·원문변경·대상모호 fail-closed / 복구·신규·재번호·유입제외 실행 0건 / 운영 동기화 NO-GO 유지**

- `lib/domain/sheet-identity-decision.ts`에 세 충돌 유형별 선택지를 분리했다. 미확정 삭제는 동일차 복구/귀속 검토·다른차 신규 검토·Sheet 오류, 번호미정 식별변경은 기존/신규 임시번호 유지·Sheet 오류, 임시번호 신원불일치는 원자 수정 수용·신규 임시번호 발급·Sheet 오류만 기록할 수 있다.
- 판단 지문은 `충돌 유형 + 원본 충돌 문자열`에 결속된다. 원문이 바뀌면 과거 판단은 매칭되지 않는다. 공급사·기존 상품키·현재 Sheet 키가 각각 하나로 특정되지 않으면 화면에서 선택할 수 없다.
- `/api/sheet/identity-decisions` GET/POST/DELETE는 admin Bearer와 서버의 현재 v3+v4 상품·계약 재검증을 요구한다. 계약락·계약중·진행계약 및 원문에서 차량번호를 해석할 수 없는 건은 409/fail-closed다.
- 원장은 `v4/sheet_identity_decisions`, 감사는 `v4/audit_logs`에만 저장한다. 원본 충돌 문자열과 차량번호는 저장하지 않는다. 운영 원장을 Firebase CLI로 값 없이 read-only 집계한 결과 **total 0 / recorded 0 / revoked 0**이며 운영 write는 없었다.
- 관리자 `신원·미확정 충돌 검토` 모달에서 변경 원자·기존키·Sheet키·계약보호와 함께 결정/철회를 수행한다. 기록 대상키가 현재 검토행과 달라지면 불일치로 표시한다. 화면과 확인문은 결정이 재고 복구·신규 생성·번호 변경·유입 제외를 실행하지 않고 동기화 차단도 유지함을 명시한다.
- 이 원장은 `planDailySheetSync`와 `commitFetchedPartnerSheets`가 소비하지 않는다. 결정값별 실제 적용 정책과 v4 patch/참조 계획은 사람·Claude 게이트 이후 별도 구현해야 한다.
- 검증: 신원 결정 **15/15**, 신원 원자 검토 **17/17**, 소유권·삭제 결정 **15/15**, 결정 dry-run **16/16**, 가격승인 **10/10**, 가격행렬 **29/29**, 일일 동기화 **21/21**, Sheet merge **126/126**, type/fonts/tokens/UI contract, production build 정적 페이지 **30/30 PASS**.
- 브라우저에서 `/inventory` 권한 제한 화면을 직접 렌더하고 콘솔 error 0을 확인했다. 로컬 브라우저에 관리자 인증이 없어 새 모달의 실데이터 선택·POST/DELETE E2E는 preview 관리자 게이트로 남겼다. 전체 공개 출시는 기존 법적 정보·v3 절연·운영 Rules 게이트 때문에 계속 NO-GO다.

## 2026-08-03 공급사 미확정 삭제·임시번호 신원 원자 검토

결과: **남은 16대 차단군 원자 분해·관리자 검토 화면 PASS / 자동 동일차 판정·복구·번호재배정 0건 / 운영 동기화 계속 NO-GO**

- 최신 16개 공급사 Sheet 388대와 ERP 삭제/활성 재고·계약을 다시 read-only 대조했다. 공급사 미확정 삭제 8대, 번호미정 식별변경 1대, 같은 임시번호 신원서명 불일치 7대가 그대로 재현됐다.
- 공급사 미확정 삭제 8대는 모두 `공급사 없는 삭제 1건 ↔ 현재 단일 Sheet 행 1건` 연결 후보이며 대상모호 0건이다. 이는 자동복구 허용이 아니라 실소유 공급사와 삭제 유지/복구 결정을 시작할 수 있는 단일 후보라는 뜻이다.
- 임시번호 8대는 같은 차량의 셀 수정과 다른 실물 차량 교체를 자동 구분할 수 없다. 한 건은 계약보호로 자동수정 금지이며, 전체 16대의 실행작업은 0건이다.
- 신원 원자는 제조사·모델·세부모델·트림·외장색·내장색·최초등록/연식·연료로 분해했다. 공급사 미확정 삭제 8대에서는 최초등록/연식 8, 세부모델 6, 외장색 5, 내장색 4, 제조사 1건이 달랐다.
- 번호미정 식별변경 1대는 트림·외장색·내장색·연료·최초등록/연식이 모두 달랐다. 임시번호 신원불일치 7대는 트림·외장색·내장색·연료 각 7, 최초등록/연식 6, 제조사·모델·세부모델 각 3건이 달랐다. 단순 오탈자 일괄승인으로 처리할 수 없는 범위다.
- `sheet-identity-conflict-review.ts`는 계약락·계약중·진행계약을 우선 보호하고, 병합 별칭 tombstone·다중 삭제·복수 Sheet 공급사를 모호 대상으로 차단한다. 모든 행은 `applyAllowed=false`, `executableOperations=0`이다.
- 관리자 Sheet 검증 화면에 `신원·미확정 검토 (16)` 모달을 추가했다. 차량별 기존 상품키, 현재 Sheet 키, Sheet 공급사, 변경 원자, 계약보호/판단근거, 다음 확인을 같은 행에 표시하며 적용 버튼은 없다. TSV도 동일 근거만 제공한다.
- 운영 감사 도구에도 PII 값을 출력하지 않는 전체·유형별 신원 원자 집계를 추가했다. 운영 Firebase/Google Sheet write, v3/Rules 변경은 0건이다.
- 검증: 신규 신원 검토 시뮬레이션 **17/17**, 결정 원장 **15/15**, 결정 dry-run **16/16**, 가격승인 **10/10**, 일일 동기화 **21/21**, Sheet merge **126/126**, type/fonts/tokens/UI contract, production build **30/30 routes PASS**.
- 브라우저에서 로컬 권한 제한 재고 화면과 콘솔 오류 0을 확인했다. 관리자 인증이 없어 새 모달의 실데이터 렌더는 preview 관리자 E2E로 남았다. 다음 게이트는 미확정 삭제 8대의 공급사·삭제의도 확정과 임시번호 8대의 원본 Sheet 행별 실물 동일성 확인이다.

## 2026-08-03 Sheet 소유권·삭제 결정 무저장 dry-run

결과: **결정-현재데이터 정합성·후속 작업 분류 PASS / 운영 결정 원장 0건 / 실행 가능한 작업 0건 / 자동 적용 NO-GO**

- 관리자 검증 스냅샷의 소유권·삭제 대상, 현재 Sheet 공급사, ERP 공급사, 상품키, 계약보호, 병합 별칭, v4 결정 원장을 한 번에 대조하는 순수 dry-run을 추가했다.
- 같은 원본 충돌의 상세 리포트가 여러 상품 행으로 펼쳐져도 차량별 한 건으로 묶는다. 상품키·ERP 공급사·Sheet 공급사가 각각 정확히 1개가 아니면 `target_ambiguous`로 차단한다.
- 결정 당시 공급사·상품키가 현재 대상과 다르거나 충돌 유형과 결정값 조합이 손상된 경우 `ledger_mismatch`, 현재 충돌에 더 이상 없는 기록은 `stale_ledger`로 분리한다. 원본 변경을 과거 결정으로 통과시키지 않는다.
- `기존 공급사 유지`와 `삭제 유지`는 v4 재고 patch가 아니라 해당 Sheet 유입을 제외하는 정책 후보로 분류한다. 현재 동기화 계획은 아직 결정 원장을 소비하지 않으므로 둘 다 hard block을 유지한다.
- `현재 Sheet 공급사로 변경`은 단순 `provider_company_code` 수정으로 처리하지 않는다. 상품키 정체성과 계약·채팅·견적·비공개 원가 참조가 함께 바뀌므로 별도 대표키·참조 이관계획 대상으로 분류한다.
- `동일 상품키 복구`만 `v4/products/{상품키}` overlay 후보 경로와 삭제 해제/Sheet soft-merge 후보 필드를 보고한다. 병합 별칭 `_merged_into` tombstone은 원본 상품 복구 금지다. 후보에도 `applyAllowed=false`가 고정된다.
- 관리자 모달에 미결정·계약보호·대상모호·기존귀속 유지·참조이관·삭제유지·복구후보 수와 `실행작업 0`을 표시하고 `결정 dry-run TSV`를 추가했다. TSV는 후보 경로와 다음 조치를 보여주지만 실행 patch 값은 만들지 않는다.
- Firebase CLI로 운영 `v4/sheet_conflict_decisions`를 값/차번 출력 없이 read-only 집계한 결과 **전체 0, recorded 0, revoked 0**이다. 최신 감사의 96대는 따라서 비계약 94대 미결정과 계약보호 2대 차단으로 시작하며 자동 적용 후보는 0대다.
- 검증: 신규 dry-run 적대 시뮬레이션 **16/16**, 결정 원장 **15/15**, 가격승인 **10/10**, 일일 동기화 **21/21**, Sheet merge **126/126**, type/fonts/tokens/UI contract, production build **30/30 routes PASS**.
- 브라우저에서 로컬 로그인 상태·권한 제한 재고 화면과 콘솔 오류 0을 확인했다. 관리자 인증이 없어 새 모달의 실데이터 표시·TSV 버튼은 preview 관리자 E2E로 남았다. 운영 Firebase write, v3/Rules 변경, 동기화 차단 해제는 0건이다.

## 2026-08-03 Sheet 소유권·삭제 충돌 건별 판단 원장

결과: **관리자 건별 검토 화면·비작동 결정 원장 구현 PASS / 결정 기록만으로 재고 변경·차단 해제 0건 / 실제 적용기는 사람·Claude 게이트 전 NO-GO**

- 최신 read-only 감사의 소유권 39대와 삭제 재등장 57대를 원본 충돌 단위로 묶는 `소유권·삭제 결정 검토` 화면을 추가했다. 동일 충돌이 상세 TSV에서 여러 상품 행으로 펼쳐져도 차량별 한 행으로 표시한다.
- 소유권은 `기존 공급사 유지` 또는 `현재 Sheet 공급사로 변경`, 삭제 재등장은 `삭제 유지` 또는 `동일 상품키 복구`만 선택할 수 있다. 현재 ERP 공급사, 현재 Sheet 공급사, 상품키, 계약보호/추가확인 사유를 같은 행에 보여준다.
- 관련 상품키가 정확히 1개가 아니거나 소유권 충돌의 현재 Sheet 공급사가 정확히 1곳이 아니면 선택을 막는다. 최신 감사 기준 비계약 소유권 38대와 동일 상품키 삭제 56대가 검토 가능 후보이고 계약보호 각 1대는 선택 불가다.
- 결정 API `/api/sheet/conflict-decisions`는 활성 admin Bearer를 요구하고, 서버에서 현재 v3+v4 상품·계약을 다시 읽어 계약락·계약중·진행계약을 409로 차단한다. 공급사·상품키가 비어 있는 결정도 거부한다.
- 결정 지문은 `충돌 유형 + 원본 충돌 문자열` 전체에 묶여 있다. 원본 공급사·차량·충돌 내용이 바뀌면 과거 결정과 일치하지 않는다.
- 원장은 `v4/sheet_conflict_decisions`, 감사는 `v4/audit_logs`에만 기록한다. 차번과 원본 충돌 문자열은 저장하지 않고 지문·결정·공급사·상품키·관리자·시각만 남긴다. v3와 운영 Rules는 변경하지 않았다.
- 이 원장은 의도적으로 `planDailySheetSync`, `commitFetchedPartnerSheets`, 수동 커밋에 전달되지 않는다. 기록/철회 후에도 화면 문구와 실제 계획 모두 hard block을 유지하며 재고·tombstone·공급사 귀속 write는 발생하지 않는다.
- 검증: `sim-sheet-conflict-decision` **15/15**, 기존 가격승인 **10/10**, 일일 동기화 **21/21**, Sheet merge **126/126**, type/fonts/tokens/UI contract, production build **30/30 routes PASS**. 로컬 브라우저에서 로그인·게스트 재고 렌더와 콘솔 오류 0을 확인했으나 관리자 세션이 없어 검토 모달 실데이터 E2E와 POST/DELETE는 실행하지 않았다.
- 다음 게이트는 94대의 실제 관리자 판단 수집 → 현재 Sheet·ERP·계약 재조회 dry-run → 공급사 귀속/참조 이관 또는 tombstone 복구의 차량별 v4 patch 계획 → 사람·Claude 승인이다. 그 전에는 자동연동 활성화와 전체 공개 출시가 계속 NO-GO다.

## 2026-08-03 Sheet 가격기간 충돌 관리자 승인 게이트

결과: **비계약 차량의 `기존 가격기간 누락`만 기존 가격 유지 승인으로 해제 가능 / 계약·소유권·삭제·임시신원 충돌은 계속 차단 / 운영 write 0건 / 전체 공개 출시는 기존 Rules·법적 정보 게이트로 NO-GO**

- 시트 원문에서 기존 가격기간이 빠진 경우 soft-merge가 ERP의 과거 가격을 보존한다는 기존 규칙에 맞춰, 관리자가 `기존 가격 유지`를 명시 승인한 건만 수동·매일 자동 동기화 preflight에서 해제한다.
- 승인 지문은 `충돌 유형 + 원문 충돌 문자열` 전체로 결정한다. 기간·공급사·차량 원문이 조금이라도 바뀌면 과거 승인이 일치하지 않아 자동 무효다.
- 승인 API는 Firebase ID token과 활성 admin 역할을 서버에서 다시 확인한다. 서버가 현재 v3+v4 상품·계약을 재조회해 `locked_by_contract`, `계약중`, 진행계약 차량을 409로 차단한다.
- 승인 원장은 `v4/sheet_conflict_resolutions`, 감사는 `v4/audit_logs`에만 기록한다. 차번이 포함된 원문은 둘 다 저장하지 않고 지문·공급사·상품키·승인자·시각만 남긴다. 철회도 별도 감사기록을 남긴다.
- 검증 화면은 승인대기·적용·계약보호 건수를 분리하고, 공급사와 사용자 영향별 승인 버튼·`가격 유지 승인 철회`·전체 충돌 TSV를 같은 검증 영역에 배치한다. 계약보호 건은 승인 후보에서 제외한다. 서로 다른 가격변경 유형 95건을 한 번에 승인하는 전역 버튼은 제거했다.
- 수동 커밋은 확인 전, 확인 직후, 도메인 커밋 경계에서 재고 revision·공급사 roster·계약·승인 원장을 다시 확인한다. 매일 자동 동기화도 최초 계획, write 직전, write 후 검증에서 같은 승인과 계약보호 규칙을 적용한다.
- 공급사 소유권 충돌, 삭제 재등장, 미확정 삭제, 임시번호 식별변경·서명 불일치는 이 원장으로 해제할 수 없다. 참조 이관 또는 운영 판단 전 계속 fail-closed다.
- 최신 운영 읽기 전용 재감사에서 16개 시트·388대 수집은 전부 PASS했다. 가격 충돌은 RP023 90대·RP018 6대이며, 시트 단독 기준 기본가격 변경 70대·기간 누락 26대로 분류됐다. soft-merge는 누락기간을 삭제하지 않고 ERP 값을 유지하지만 새 표준가격이 있으면 화면 기본가가 달라질 수 있다.
- 계약보호 1대를 제외한 실제 승인 묶음은 `RP023 · 새 기본가격 적용 확인` 69대, `RP023 · 누락기간 기존가 유지` 20대, `RP018 · 누락기간 기존가 유지` 6대다. 다른 충돌과 중첩된 2대는 가격 승인 후에도 해당 hard-block이 남는다.
- 위 95건을 모두 승인했다고 가정한 순수 계획도 **BLOCKED**다. 잔여는 소유권 39, 삭제 재등장 57, 미확정 삭제 8, 번호미정 변경 1, 임시번호 서명 7, 계약보호 가격 1건이다. 승인·운영 write 없이 도메인 계획으로 재현했다.
- 잔여 소유권 39대는 `현재 단일 공급사 Sheet vs 기존 다른 공급사` 38대와 계약보호 1대다. 복수 Sheet가 동시에 같은 차를 주장하는 단순 원본 중복은 0대지만, 현재 Sheet를 곧바로 정본으로 삼으면 공급사 귀속·권한·정산 주체가 바뀌므로 자동승인하지 않는다.
- 삭제 재등장 57대는 동일 상품키 삭제이력 56대와 계약보호 1대다. 연결된 삭제 레코드는 77건이며 모두 삭제사유·처리자 표식이 없어 복구와 신규등록을 자동 구분할 수 없다. 미확정 소유 삭제이력 8건도 별도 hard-block이다.
- 따라서 소유권·삭제 충돌에는 안전한 자동처리 후보가 **0건**이다. 사람/Claude가 실소유 공급사와 삭제 의도를 확정하기 전 승인 원장이나 자동 복구 로직을 추가하지 않는다.
- 검증: `sim-sheet-conflict-resolution` **10/10**, `sim-sheet-daily-sync` **21/21**, `sim-sheet-merge` **126/126**, `tsc`, fonts, tokens, UI contract, production build **30/30 routes PASS**.
- 브라우저에서 별도 로컬 서버의 로그인·둘러보기·재고 화면 렌더를 확인했다. 로컬 브라우저에 관리자 인증이 없어 새 관리자 전용 승인 버튼의 실데이터 화면·POST/DELETE는 실행하지 않았다. preview 배포 후 관리자 세션으로 세 승인 묶음·확인창·적용/철회·재검증을 확인하는 것이 남은 운영 UI 게이트다.
- `database.rules.json`과 운영 Firebase 데이터는 변경하지 않았다. `check:release`는 운영 Rules 기준 기존 차단 13·경고 2로 동일하다.

## 2026-08-03 출시 보안 Rules 후보·실제 에뮬레이터 검증

결과: **운영 Rules 미변경 / 보안 후보 정적 13/13·실제 Emulator 26/26 PASS / 완료계약 관리자 전용 취소 22/22 PASS / 법적 정보·v3→v4 절연 전 공개 출시 NO-GO**

- `database.rules.json`은 수정·게시하지 않았다. 별도 생성기와 `release-candidate.rules.json`만 검증했다.
- 후보는 v3 raw write/read, v4 master 소유권, 공개서명 익명 수명, 계약 스냅샷·PII·서명·메모, 차량 잠금, settlement/R1/R2 금액 위조를 계약 레코드에 결속한다.
- 정적 보안 13/13, 계약 Rules 26/26, 전자서명 58/58, Firebase Auth+RTDB Emulator HTTP 적대·정상 26/26 PASS다.
- 정산 public/private 원자 update를 유지하며 private R1/R2에 `contract_code`를 넣어 계약 동결 금액·율과 Rules에서 직접 대조한다.
- 후보 기준 정적 출시 게이트의 코드 차단은 사실값이 필요한 법적 운영자 정보 6개만 남는다.
- 배포본 `/diag`의 원시 수는 v3 products 5,712, v4 products 5,649다. 63건 건수 차이는 v3-only 수로 단정할 수 없으므로 키·필드 전수대조와 이관 없이 v3 read를 닫지 않는다.
- 관리자 SDK 읽기 전용 전수대조에서 삭제 제외 v3 443건·v4 644건, 차량번호 v3-only 288개, 판매 가능 v3-only **289대**를 확인했다. child key 공통은 1개뿐이고 overlay 합산 기준 v3-only 재고가 계약 5건·채팅방 40건과 연결돼 있어 단순 복사·브리지 폐쇄는 NO-GO다.
- 공통 1:1 차량 59대도 트림 57, 연식 51, 배기량·카탈로그 각 50, 연료 37, 공개 가격 13대가 달랐다. v3 공개 노드에는 원가/VIN/계좌 계열 레코드 387건이 남아 있고 v4 공개 노드는 0건이다.
- 엔티티별로 `policy`, `partner`만 v3-only 업무키 0이며 `product`, `user`, `room`, `contract`, `audit_log`는 브리지 유지가 필요하다. 운영 write·브리지 설정 변경은 하지 않았다.
- child-key 기준 관리자 `v3→v4 복사 실행`은 대량 중복 위험 때문에 UI에서 제거하고 엔진도 비-dry-run 호출을 차단했다. 전용 write gate와 정적 출시 게이트 PASS다.
- 동일 공급사 코드의 시트 없는 레거시 partner가 활성 Sheet 실행목록에 재유입되던 결함을 수정했다. 활성 `sheet_url` 레코드만 실행하며 Sheet merge 회귀 **124/124 PASS**다.
- 사용자 승인으로 운영 `v4/partners/RP023.deposit_rule=rent_multiple`을 CAS 저장하고 감사로그 `AL-1785729521849-rp023-deposit-rule`·재조회 일치를 확인했다. v3·재고 write는 없다.
- 최신 운영 설정으로 16개 공급사·388대 수집은 전부 PASS한다. v3-only 292건/288대는 Sheet 현재 238대, 참조만 7대, Sheet·참조 없음 47건/43대다.
- v3 절연 dry-run은 진행계약 보호 4대, 시트 충돌 104대, 승인 후 동일 legacy key overlay 후보 132대, 시트 없음·이력참조 브리지 유지 5대, 시트·참조 없음 공급사 확인 43대로 분류했다.
- 실제 서버와 같은 product_code overlay 병합 기준으로 활성 중복은 0건이다. 저장 계획은 공급사 소유 충돌 39·삭제 재등장 57·미확정 삭제 8·번호미정 변경 1·서명 불일치 7·가격기간 누락 96건으로 정상 차단됐다. 운영 write는 0건이다.
- 상세 작업량은 가격기간 96행·공급사 소유 90행·삭제 재등장 77행·미확정 삭제 8행·임시번호 서명 7행·번호미정 변경 1행이며 계약보호 4행은 자동수정 금지다. RP021은 실제 24대다.
- `audit-v3-only-sheet-coverage.mts --firebase-cli` 읽기 전용 모드를 추가해 서비스계정 없이 로그인된 Firebase CLI `database:get`으로 최신 감사를 재현했다. 원본 값·PII 출력과 운영 write는 없다.
- `npx tsc --noEmit`, `sim-sheet-merge` 126/126 PASS다.
- 완료 전 계약은 영업자 취소를 유지하고 완료 계약은 관리자만 취소·환수하도록 UI와 엔진을 함께 차단했다. 영업자 차단 시 계약·차량·정산 무변경, 관리자 취소 시 차량 해제와 private R1 기준 환수대기를 정산 E2E **22/22 PASS**로 확인했다.
- 상세 게이트와 재현 명령: `docs/SECURITY_RELEASE_GATE_2026-08-03.md`.

## 2026-08-03 UI·UX 전수 규격 통합

결과: **업무 화면 UI 규격 GO / 공개 정식 출시는 법적 운영자 정보와 운영 데이터·Rules 게이트 때문에 NO-GO**

- 배포본 핵심 화면을 브라우저로 확인하고 버튼·드롭다운·폰트·뱃지·필터·목록 아이콘·빈 상태를 현재 코드의 역할별 표시 로직과 대조했다.
- 문의 기본 `문의` 뱃지는 제거된 상태를 확인했다. 좌측 아이콘은 빠른 상태 스캔, 상태 뱃지는 오판 방지용 명시 텍스트로 역할을 분리했다.
- 차량명 제조사·모델·트림 복원, 공급사 실제명 우선, 역할별 상대방, 빈값 사이 고아 구분점 방지를 142개 업무 목록 시뮬레이션으로 확인했다.
- `WebListTools`를 추가해 WorkPage와 일반 Page의 데스크톱 검색·정렬·필터 순서를 하나로 통일했다. FAQ 데스크톱 검색 누락과 감사 페이지 별도 구현을 해결했다.
- 필터의 숨은 가짜 건수 접근성 노출, input/select 패딩, 오류·404 버튼, FAQ·설정·엑셀필터·스켈레톤의 토큰 드리프트를 수정했다.
- `check:ui`를 추가해 새 raw 컨트롤과 숫자 radius를 차단하고 기능상 필수 예외만 이유·개수로 고정했다.
- 표시 시뮬레이션 209건, type/fonts/tokens/UI 계약, production build 30 routes는 PASS다.
- 상세 근거와 페이지별 존재 이유: `docs/UI_LAUNCH_AUDIT_2026-08-03.md`.

## 2026-08-03 중복 재고 v4 patch dry-run

결과: **참조 이관·데이터 병합·별칭 tombstone의 무저장 dry-run과 기존 링크 복원 PASS / 운영 데이터 적용후보 0그룹으로 실제 병합은 NO-GO**

### 운영 데이터 최종 dry-run

- 앞 단계에서 참조 기준 추가 차단사유가 없던 62그룹을 공개 상품값과 비공개 원가까지 다시 대조했다.
- 엄격한 최종 결과는 **적용후보 0그룹, 생성 가능한 작업 0건**이다. 차단된 그룹에는 가상의 patch 경로도 내보내지 않아 TSV를 실행목록으로 오인할 수 없게 했다.
- 비어 있지 않은 상품값 충돌은 81그룹이다. 주요 충돌은 연식 69, 연료 55, 배기량 47, 트림 27, 카탈로그 26, 파워트레인 25, 세부모델 13, 가격 8, 차량상태 7그룹이다.
- 레거시 상품 account_number가 파트너 bank_account와 일치하지 않는 그룹은 **124개**, 동일한 중복값으로 확인된 그룹은 0개다. 값은 보고서·로그에 출력하지 않았다. 이 필드는 상품 스키마에 없고 민감정보 감사대상이므로 임의 복사·폐기하지 않는다.
- 데이터충돌과 계좌 불일치, 공급사 소유권, 대표키 불명확, 차번전용 참조는 서로 겹칠 수 있다.

### dry-run 규칙

1. 대표키의 빈 필드는 명시한 상품 allowlist 안에서만 채움 후보로 만든다. 미분류 필드는 자동 복사하지 않고 차단한다.
2. 레거시 공개 노드의 VIN·차량원가·수수료는 먼저 공개/비공개로 분리해 값이 TSV에 노출되거나 공개 상품으로 복사되지 않게 한다.
3. 계약은 snapshot을 유지하고 정확히 예전 상품키인 참조 필드만 v4 overlay 후보로 낸다. 채팅방은 방 ID와 messages 경로를 유지한다.
4. 중복 상품 제거 후보에는 _merged_into를 함께 기록하도록 계획한다. 예전 상품 URL·로컬 찜 코드는 상품 단건 조회가 이 별칭을 따라 대표 상품으로 복원하며, 순환 별칭은 fail-closed다.
5. 별칭 tombstone과 비공개 노드 삭제는 파괴적 작업으로 표시하고 Claude 게이트를 요구한다. 현재는 모든 그룹이 차단되어 해당 작업을 0건 생성했다.

### 구현·검증

- lib/domain/product-duplicate-dry-run.ts에 단계별 무저장 patch 계획과 값 없는 TSV를 추가했다.
- lib/domain/product-alias.ts와 rtdb-adapter 상품 단건 조회에 _merged_into 복원을 추가했다.
- 기존 관리자 GET /api/inventory/duplicate-plan 응답에 dryRunTsv와 적용후보·충돌·계좌 판정을 추가하고, 재고 화면에 중복 patch dry-run 버튼을 추가했다.
- scripts/sim-product-duplicate-migration.mts: **25/25 PASS**.
- scripts/sim-sheet-merge.mts: **123/123 PASS**.
- type, fonts, tokens, production build: PASS.
- 운영 Firebase write·삭제·병합 0건, 배포·커밋 0건이다.

### 다음 해제 순서

1. 상품 account_number의 실제 의미와 정본 위치를 확인하고 파트너 계좌 또는 별도 보안 노드로 이관할지, 레거시 잔재로 폐기할지 사람·Claude가 결정한다.
2. 연식·연료·배기량·트림·카탈로그·가격·상태 충돌 81그룹을 최신 공급사 Sheet와 차량마스터 기준으로 건별 확정한다.
3. dry-run 적용후보가 생겨도 계약·채팅·비공개 원가 참조, 별칭 URL, 사후조회까지 preview에서 검증한 뒤 별도 승인한다.

## 2026-08-03 중복 재고 대표키·참조 이관계획

결과: **계약·채팅방·견적·비공개 원가 전수 참조 감사와 관리자용 TSV 계획 PASS / 62그룹도 자동삭제가 아니라 대표키 검토 후 이관 후보이며 실제 정리는 NO-GO**

### 운영 데이터 읽기 전용 결과

- 동일 공급사 안의 중복 하위그룹은 **148그룹·300레코드**다. 앞선 84그룹은 차번 전체가 한 공급사인 경우만 센 수치이고, 이번 148그룹은 공급사 간 소유 충돌 차번 안에 있는 동일 공급사 중복 하위그룹도 빠짐없이 포함해 더 크다.
- 대표키 후보는 **114그룹**이다. 공급사_차번 표준키 109그룹, 정확 참조가 유일하게 가장 많은 기존키 5그룹이다.
- 공급사 간 소유권, 대표키 불명확, 차번전용 참조, 다중 계약보호가 없는 그룹은 **62그룹**이다. 이는 삭제 승인 수가 아니라 참조 이관계획을 검토할 수 있는 후보 수다.
- 정확 상품키 참조는 계약 4건, 채팅방 34건, 견적 0건이며 비공개 원가 레코드는 106건이다.
- 상품키 없이 차번만 있는 참조는 **13그룹·17건**이다. 어느 중복키의 관계인지 자동 판단할 수 없으므로 수동 확인 대상으로 차단했다.
- 대표키 자동 후보가 없는 그룹 34개, 둘 이상의 상품키가 진행계약으로 보호된 그룹 1개, 공급사 소유권 충돌이 걸린 동일 공급사 하위그룹 63개다. 각 차단 사유는 서로 겹칠 수 있다.

### 선정·보호 규칙

1. 진행 계약 또는 locked_by_contract가 정확히 가리키는 상품키가 하나면 그 키를 최우선 보존 후보로 한다.
2. 계약보호 키가 없으면 공급사_차번 표준키를 후보로 한다.
3. 표준키도 없을 때만 계약·채팅·견적·비공개 원가의 정확 참조가 유일하게 많은 키를 후보로 한다.
4. 둘 이상의 키가 진행계약으로 보호되거나 공급사 간 소유 충돌이 있거나 차번전용 참조가 있으면 실행 금지다.
5. 계약·채팅방·견적·비공개 원가 중 하나라도 스캔하지 못하면 fail-closed로 실행 금지다.

### 구현

- lib/domain/product-duplicate-migration.ts에 대표키 후보, 후보 근거, 그룹 차단사유, 상품별 계약·방·견적·비공개 원가 참조, 권장조치를 만드는 순수 계획 로직과 TSV 출력을 추가했다.
- lib/server/product-duplicate-audit.ts는 Firebase v3+v4를 읽기 전용으로 합쳐 위 네 참조 표면을 전수 확인한다. VIN·금액 같은 비공개 값은 반환하지 않고 비공개 레코드 존재 여부만 보고한다.
- 관리자 Bearer 인증 전용 GET /api/inventory/duplicate-plan과 재고의 중복 이관계획 TSV 버튼을 추가했다. endpoint에는 update/set/delete 경로가 없다.
- 자동연동 상태 새로고침이 dailyStatusLoading 대신 공용 busy를 잘못 해제하던 UI 상태 결함도 바로잡았다.

### 검증

- scripts/sim-product-duplicate-migration.mts: **13/13 PASS**.
- scripts/sim-sheet-merge.mts: **123/123 PASS**.
- npx.cmd tsc --noEmit, fonts, tokens: PASS.
- production build: GET /api/inventory/duplicate-plan 포함 전체 route PASS.
- 운영 Firebase 감사와 로컬 검증 모두 write·삭제·병합 0건이다. 배포·커밋도 수행하지 않았다.

## 2026-08-03 재고 중복·공급사 귀속 충돌 전수 분류

결과: **실데이터 읽기 전용 전수분류와 상세 충돌 보고서 구현 PASS / 참조 이관·중복 정리·공급사 소유권 확정은 사람·Claude 승인 전 NO-GO**

### 실데이터 판정

- 현재 Firebase의 활성 재고 **1,095대**를 계약·공급사와 함께 읽어 차번 충돌을 전수 대조했다. 실제 데이터 write, 삭제, 병합은 수행하지 않았다.
- 활성 중복 차번은 **129개 그룹·326개 레코드**다. 이 중 같은 공급사 안에서 대표키를 정한 뒤 정리할 수 있는 후보가 **84개 그룹**, 실제 소유 공급사를 정해야 하는 충돌이 **43개 그룹**, 계약 보호 때문에 자동수정하면 안 되는 충돌이 **2개 그룹**이다.
- 상세 레코드 기준 분류는 서로 겹칠 수 있으며 대표키·참조 이관 후 중복 정리 246행, 계약보호·자동수정 금지 8행, 실소유 공급사 확인 139행이다.
- 2026-07-31 Sheet 캐시와 현재 Firebase를 합친 전체 동기화 preflight는 활성 중복 124그룹, 공급사 간 충돌 39그룹, 삭제 재등장 1건, 임시번호 신원변경 2건, 신원서명 충돌 4건, 가격기간 누락 6건을 재현했다.
- 공급사 원본 조회 게이트도 남아 있다. RP004는 캐시 없음, RP016은 1행 전부 제외, RP023은 107행 중 13행 제외·94행 가격 없음으로 가져올 정상 행이 0이었다.

### 이번 수정

- lib/domain/sheet-conflict-report.ts에 충돌 유형, 판단, 권장조치, 차번, 공급사, 상품키, 차량상태, 출처, 계약보호 여부, 원본 충돌을 한 행씩 만드는 순수 보고서 로직을 추가했다.
- 관리자 Sheet 검증 화면의 단순 2열 충돌 복사를 **상세 충돌 TSV 복사**로 교체했다. 계약 목록도 읽어 locked_by_contract 또는 진행 중 계약이 있는 재고는 계약보호 · 자동수정 금지로 표시한다.
- 보고서는 자동삭제 명령이 아니다. 대표 상품키를 선택하고 계약·문의·정산 등 참조를 먼저 이관한 뒤, 별도 승인된 레코드만 정리해야 한다.

### 처리 순서

1. 계약보호 8행을 먼저 사람·Claude가 대조해 유지할 대표키와 계약 참조를 확정한다.
2. 같은 공급사 84그룹은 대표키를 정하고 모든 참조 이관 검증 후에만 중복 레코드 정리를 승인한다.
3. 공급사 소유권 충돌 43그룹은 원본 Sheet·실차 소유 증빙으로 한 공급사를 확정한다.
4. 삭제 재등장·임시번호·신원서명·가격기간과 RP004/RP016/RP023 원본 문제를 해결한다.
5. 읽기 전용 preflight를 다시 실행해 충돌 0, 연속 2회 중 두 번째 diff 0을 확인한 뒤 일일 동기화 활성화를 검토한다.

### 자동 검증

- scripts/sim-sheet-merge.mts: **123/123 PASS** — 중복 레코드별 상세행, 계약보호 자동수정 금지, TSV 판단·상품키 열 포함.
- scripts/sim-sheet-daily-sync.mts: **18/18 PASS**.
- scripts/sim-inventory-display.mts: **27/27 PASS**.
- fonts, tokens, production build: PASS.

## 2026-08-03 매일 Google Sheet → 자체 재고 동기화

결과: **일일 수집·자체 재고 영속화·변경 병합·내부 수정 우선 로직과 production build PASS / 운영 자동 실행은 충돌 정리와 사람·Claude 게이트 전까지 비활성 NO-GO**

### 확정한 동작

- Vercel Cron이 매일 **02:00 KST**(`0 17 * * *`, UTC)에 `GET /api/sheet/sync-daily`를 호출한다.
- Cron API는 `Authorization: Bearer ${CRON_SECRET}`과 `SHEET_DAILY_SYNC_ENABLED=true`가 모두 있어야 실행된다. 기본 예시는 `false`이며 인증 없는 요청은 401, 비활성 요청은 503으로 차단된다.
- 서버가 공급사 설정과 Google Sheet를 새로 읽고 전체 공급사가 정상일 때만 계획한다. 조회 실패, 0행/급감, 중복·무효 차번, 공급사 소유 충돌, 삭제이력 재등장, 임시번호 신원 변경, 가격기간 누락은 전체 저장을 중단한다.
- 신규 행은 v3가 아닌 **`v4/products` 자체 재고**로 생성한다. 이후 일반 재고 화면에서 조회·수정할 수 있다.
- 기존 행은 같은 상품키 또는 같은 공급사+실차번으로 찾아 비어 있지 않은 변경분만 병합한다. 시트 빈칸은 내부 값을 지우지 않는다.
- 재고 화면에서 사람이 고친 시트 유입 상품 필드는 `_sheet_manual_fields`에 기록한다. 이후 매일 연동은 해당 필드의 내부 값을 우선하고, 사람이 건드리지 않은 필드와 신규 필드만 계속 갱신한다.
- 시트에서 빠진 차량은 삭제하지 않는다. 시트 소유 provenance를 남긴 `출고불가`로 전환하고, 계약락·수기 보류는 건드리지 않는다. 시트 자동차단 차량이 다시 나타나면 자동 복원한다.
- 같은 시트를 다시 실행해도 신규·수정·부재 patch가 생기지 않는 멱등 계획이다.

### 저장 안전장치

- 저장 직전에 활성·삭제 재고를 다시 읽어 계획한다.
- 모든 상품 patch/create는 **`v4/products` 단일 RTDB transaction**에서 기존값 CAS와 신규키 중복을 먼저 전부 검증한다. 한 건이라도 달라졌으면 부분 재고 저장 없이 전체를 취소한다.
- 성공 후 공급사 checkpoint와 요약 감사로그를 `v4` multi-location update로 기록하고, 결과를 다시 읽어 남은 create/patch가 0인지 사후검증한다.
- 동시 실행은 `v4/system_locks/sheet_daily_sync`의 20분 lease로 막고 실행 결과는 `v4/sheet_sync_runs`에 기록한다.
- Firebase Admin 런타임 의존성을 production dependency로 옮겼다. Admin은 Rules를 우회하므로 endpoint 비밀키·feature flag가 보안 경계이며, 서비스 계정 JSON은 로그에 남기지 않는다.
- `database.rules.json`과 v3 운영 노드는 수정·게시하지 않았다. 실제 Sheet/ERP 데이터 write도 수행하지 않았다.

### 운영 설정

- `CRON_SECRET`: 충분히 긴 무작위 값. Vercel Cron 요청 인증에 사용.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: `project_id`, `client_email`, `private_key`를 포함한 서버 전용 JSON.
- `SHEET_SYNC_COMPANY_ID=freepass`
- `SHEET_DAILY_SYNC_ENABLED=false`: 아래 실데이터 게이트가 끝난 뒤에만 `true`로 변경.
- `?dry_run=1`은 상품 재고를 바꾸지 않지만 lease와 실행 결과 로그는 기록한다.

### 관리자 운영 가시성

- 배포본 `/inventory`를 브라우저로 다시 확인했다. 현재 화면은 여전히 `관리자가 버튼으로 실행(자동 아님)`이라고 표시하고 공급사별 과거 연동시각만 보여, 자동 실행의 전체 성공·차단·실패를 판별할 수 없었다.
- 로컬 후보에는 관리자 전용 `GET /api/sheet/sync-status`를 추가했다. Firebase ID token을 서버에서 검증하고 `users/{uid}.role=admin`이면서 활성 계정일 때만 상태를 반환한다.
- 일일 실행은 `v4/system_status/sheet_daily_sync`에 `running/completed/dry_run/blocked/failed`, 최근 시각, 건수, 차단 사유를 기록한다. 관리자 재고 화면은 이를 `자동연동 정상/실행 중/시험 완료/차단/실패/비활성`으로 표시한다.
- 상태 API 무인증 요청은 403, 실행 API 무인증 요청은 401을 로컬 production server에서 확인했다. 상태 조회는 운영 데이터를 변경하지 않는다.

### 자동 검증

- `scripts/sim-sheet-daily-sync.mts`: **18/18 PASS** — 신규 자체재고, 기존 patch, 빈값 보존, 부재 soft-block, 수기 상태 보존, 내부 수정 필드 우선, 재등장 복원, 계약락, 조회실패·중복 hard block, 멱등성, Cron·인증·런타임 wiring.
- `scripts/sim-sheet-merge.mts`: **123/123 PASS**.
- `scripts/sim-sheet-price.mts`: **29/29 PASS**.
- `scripts/sim-inventory-display.mts`: **27/27 PASS**.
- `scripts/sim-work-list-semantics.mts`: **142/142 PASS**.
- `npx.cmd tsc --noEmit`, fonts, tokens: PASS.
- production build: `/api/sheet/sync-daily`, `/api/sheet/sync-status` 포함 전체 route PASS.
- 로컬 production server에서 실행 API 무인증 **401**, 상태 API 무인증 **403**, 올바른 테스트 Cron Bearer + 비활성 flag **503**를 확인했다.

### 운영 활성화 전 NO-GO

1. 2026-07-31 Sheet 캐시+현재 Firebase 읽기 전용 preflight는 공급사 조회/설정 3곳과 활성 중복차번 124건, 공급사 간 차번충돌 39건, 삭제충돌 1건, 번호미정 drift 2건, 신원서명 충돌 4건, 가격기간 누락 6건 때문에 전체 저장을 차단했다.
2. preview 환경에서 `SHEET_DAILY_SYNC_ENABLED=false`로 배포 후 `dry_run=1` 결과와 공급사별 diff를 사람·Claude가 승인해야 한다.
3. 위 충돌을 정리하고 연속 2회 dry-run에서 두 번째 create/update/absent가 0인 것을 확인한 뒤에만 운영 flag를 켠다.
4. `check:release`의 보안·약관 차단 13개와 경고 2개는 별도 최종 출시 NO-GO로 그대로 남아 있다.

## 2026-08-03 Claude 후속 검토 반영·레거시 시트 자동차단 수정

결과: **코드로 해결 가능한 상태 오판은 수정·회귀검증 PASS / Rules와 배포본 대량 동기화 위험 때문에 최종 출시는 NO-GO**

### Claude 잔여 검토 대조

- `CLAUDE_REVIEW_2026-08-03.md`와 Claude의 읽기 전용 probe를 원 요구사항·운영 데이터 기준으로 다시 대조했다.
- Claude가 지적한 `출고불가` 17대 중 계약락 1대를 제외한 16대는 현재 코드에서 수기 보류로 분류됐다. 그중 14대는 `status_label=시트에서 제거됨`, `source=external_sheet`인 과거 시트 부재 자동차단이고, 2대는 `일괄 출고불가`였다.
- `일괄 출고불가`는 운영자가 의도적으로 묶어서 막았을 가능성을 배제할 수 없으므로 자동 해제하지 않는다. 실데이터 backfill도 승인 없이 수행하지 않았다.
- 계약 차량 snapshot 10종의 불변 Rules 누락과 공개서명 익명 읽기 범위 문제는 실제 출시 차단이다. 작업원칙상 `database.rules.json`은 수정·게시하지 않았고 사람/Claude의 레거시 실데이터 게이트로 넘긴다.

### 이번 수정

- `lib/domain/sheet-merge.ts`에 시트 자동차단·수기 보류 판정을 공통 함수로 만들었다.
- 현재 provenance(`sheet_status_owner=sheet`, `sheet_block_reason=missing_or_excluded`)뿐 아니라 **정확히** `출고불가 + 시트에서 제거됨 + source=external_sheet|sheet`인 행만 레거시 자동차단으로 인정한다.
- 위 레거시 행이 시트에 정상 재등장하면 상태를 복원하고 낡은 `status_label`을 제거한다. 출처 없는 같은 라벨, `일괄 출고불가`, 계약락·레거시 계약중은 계속 보존한다.
- `lib/domain/sheet-sync-all.ts`의 수기 해제 후보·수기 보류 보고도 같은 SSOT 판정을 사용해 화면과 실제 병합 결과가 어긋나지 않게 했다.
- 사람이 재고 화면에서 상태를 변경하면 현재 provenance와 레거시 자동차단 라벨을 함께 끝내 이후 수기 보류가 자동 해제로 오인되지 않게 했다.

### 자동 게이트

- `scripts/sim-sheet-merge.mts`: **120/120 PASS** — 레거시 시트 제거 복원, 낡은 라벨 제거, 일괄 차단 보존, 출처 위조 방어, 충돌 보고 일치 포함.
- `npx.cmd tsc --noEmit`, `npm.cmd run check:fonts`, `npm.cmd run check:tokens`: PASS.
- `scripts/sim-work-list-semantics.mts`: **142/142 PASS**.
- `scripts/sim-sheet-price.mts`: **29/29 PASS**.
- 로컬 `sim-*.mts` 25종 중 기능·표시·정산·채팅·시트 등 **22종 PASS**. 아래 Rules 전용 3종은 의도한 출시 차단을 재현해 FAIL했다.
  - `sim-contract-rules.mts`: 계약 차량 snapshot 생성 후 변경 허용.
  - `sim-contract-sign-rules.mts`: 제출 후 `pending_review`의 익명 재읽기 허용.
  - `sim-release-security-rules.mts`: **0/13 PASS** — v3 광역 read/write, v4 소유권 결속, 계약 PII·서명·취소·정산 금액 규칙 누락.
- `npm.cmd run check:release`: **FAIL — 차단 13개, 경고 2개**. 법정 운영자 정보 6종도 미기재 상태다.
- `npm.cmd run build`: production build 및 **30개 route PASS**.

### 출시 후보 브라우저 실검증

- Chrome 로그인 세션으로 `https://freepasserp4.vercel.app/inventory`를 열어 재고 350대와 공급사 시트 16개를 확인했다.
- 오전 09:43:03 읽기 전용 `데이터 검증` 결과는 원문 439행 → 올림 406대, 출고불가 제외 33, 가격없음 9, 신규 104, 상태변경 68, 내용수정 234, 부재→출고불가 15다.
- 오토플러스는 본 95+프로모 12, 재고 96, 올림 107, 가격없음 7로 표시됐다.
- 배포본은 `동기화 (16) · 406대`를 활성 상태로 표시했다. 그러나 위 변경량이 크고 이번 레거시 자동차단 수정은 로컬 dirty 변경이므로 **현재 배포본에서 동기화를 실행하면 안 된다.** 동기화·저장·운영 설정 write는 0건이다.

### 최종 해제 조건

1. Rules 후보에서 계약 snapshot 불변, 공개서명 제출 후 익명 read 차단, v3/v4 권한·PII·정산 결속을 구현하고 레거시 실데이터로 사람/Claude 게이트를 통과한다.
2. 이번 로컬 변경을 preview에 반영한 뒤 같은 16개 시트 preflight를 다시 실행한다.
3. `시트에서 제거됨` 14대만 자동 복원 후보가 되고 `일괄 출고불가` 2대와 계약락은 유지되는지 건별 diff로 확인한다.
4. 신규 104·상태 68·내용 234·부재 15를 공급사별로 승인하기 전까지 운영 동기화는 금지한다.

## 2026-08-03 Claude Code 위험영역 독립 게이트

결과: **APPROVE WITH CONDITIONS / 최종 출시는 NO-GO**

### 실행·범위

- 로컬 Claude Code `2.1.220`에 파일 수정·테스트·commit·push·deploy·실데이터 write를 금지하고 read-only 검토를 요청했다.
- 첫 Opus 검토는 dirty diff 전체 탐색 중 244초 타임아웃되어 판정으로 사용하지 않았다. 두 번째 Sonnet high 검토는 금액 판정, AutoPlus import, Sheet commit gate, 상품 CAS, RTDB v3/v4 경계, 관련 시뮬레이션과 최신 검증 문서로 범위를 제한해 정상 완료했다.
- Claude가 수정한 파일과 운영 write는 0건이다.

### Claude 승인 사항

- `rent_multiple`이 RP023 운영 이력과 맞고, `months_per_year`은 맞지 않는다는 근거를 승인했다.
- 원문 모델의 명시 브랜드, 차종마스터 origin 합의, 동명 국산·수입 fail-closed가 결정적이며 배열 순서에 의존하지 않는다고 판정했다.
- `sim-sheet-price`의 29개 항목이 위 실제 코드 경로를 실행하고, 미확정 origin에서 금액을 만들지 않는다고 확인했다.
- 정산엔진 계약락과 시트 CAS가 동일한 `v4/products/{key}` 경로를 사용하므로 transaction 재시도에서 늦은 계약락을 감지한다는 주장을 코드로 확인했다.
- v3 write가 없고 `database.rules.json`을 건드리지 않았으므로 **현재 로컬 rtdb-adapter 변경의 머지는 조건부 승인**했다. Rules 게시 승인은 이번 범위가 아니며 별도 사람/Claude 게이트 대상이다.

### Claude 발견 조건부 결함

- `lib/firebase/rtdb-adapter.ts`의 `bulkPatchGuardedProduct`는 public 상품과 private 상품을 별도 transaction으로 순차 저장한다. 향후 patch에 `vin`, `vehicle_price`, `price.*.fee/commission/fee_memo`가 포함되면 public 성공 후 private CAS 실패 시 public만 부분 반영될 수 있다.
- 현재 Sheet import mapping에는 위 private 필드가 없으므로 이번 시트 병합 경로에서는 `privateRecord === null`이고 재현 불가능하다. `vehicle_status`와 `locked_by_contract`도 public 경로이므로 현재 계약락 보호는 영향받지 않는다.
- 따라서 이번 로컬 머지를 막지는 않되, **이 guarded API를 private 필드 writer에 재사용하거나 Sheet mapping에 private 필드를 추가하기 전에** 단일 원자 경계 또는 명시적 부분커밋/보상 설계를 먼저 구현해야 한다. 이 조건을 지키지 않은 확장은 NO-GO다.

### Claude가 재확인한 운영 조건

1. `RP023.deposit_rule = rent_multiple` 저장과 BMW 3대 ×2→×3 금액 변경은 운영자 승인 후 수행한다.
2. 원본 대여료 공란 7대는 원본 수정 전까지 제외한다.
3. 기존 데이터 충돌 29/39/52/8/1/4/7과 `database.rules.json` 공개범위 문제는 별도 해소·게이트가 필요하다.

## 2026-08-03 AutoPlus 보증금 규칙·Google Sheet 실데이터 대조

결과: **규칙과 제조국 판정 결함은 로컬 수정·검증 PASS / 운영 설정 미저장과 기존 충돌 때문에 최종 출시는 계속 NO-GO**

### 규칙 판정 근거

- 운영 Google Sheet `RP023`을 쓰기 없이 `rent_multiple(국산×2·수입×3)`과 `months_per_year(기간/12 배수)`로 각각 파싱하고, 2026-07-28에 가격 108/108로 검증된 `data/sheet-ingress/RP023-autoplus.json`과 차량번호·기간별로 대조했다.
- 과거와 현재의 월대여료가 같은 295개 셀 중 `rent_multiple`은 보증금 283개가 동일했다. 나머지 12개는 제조사 칸이 비었던 실제 BMW 3대×4기간이 과거에 국산×2로 잘못 분류된 흔적이며, 현재 원문 `BMW 120i/220i`에 따라 수입×3으로 교정된다.
- `months_per_year`은 같은 월대여료 295개 중 보증금 일치가 74개뿐이었다. BMW X1도 과거 `101만원→303만원`인데 이 후보는 12개월 `101만원`, 24개월 `184만원`, 48개월 `324만원`이 되어 운영 이력과 맞지 않는다.
- 따라서 RP023의 입증된 규칙은 **국산 월대여료×2 / 수입 월대여료×3**이다. 임의 기본값으로 박지 않고 여전히 `partner.deposit_rule` 명시 설정을 요구한다.

### 파서·화면 수정

- AutoPlus처럼 제조사 칸 없이 모델 칸에 `BMW X1`을 적는 행은 스냅된 저신뢰 제조사를 쓰지 않고 **원문 maker/model/sub_model의 명시 브랜드**로 제조국을 판정한다.
- 원문에 제조사명이 없는 `K5 HEV`형 행은 스냅된 정식 모델과 정확히 같은 차종마스터 후보 전체가 한 제조국으로 합의할 때만 배율을 허용한다. 동명 모델이 국산·수입에 함께 있으면 마스터 배열 순서와 무관하게 계속 fail-closed한다.
- 관리자 일괄 검증 메시지에 `보증금 규칙 미설정(국산 2·수입 3개월치 설정 필요)`를 표시한다.
- `/members`에서 레거시 RP023처럼 `adapter_id`가 비어도 실제 적용값을 `오토플러스식 · 자동`으로 표시하고, 보증금 규칙 미설정 시 동기화가 차단된다는 설명과 정확한 선택지를 보여준다.
- 재현 가능한 읽기 전용 점검 도구 `scripts/audit-autoplus-deposit.mts`를 추가했다. Sheet/Firebase/로컬 데이터 write는 없다.

### 최신 실측·자동 게이트

- 현재 Sheet + 수정 파서: **96대 정상 파싱**, 제조국 미판별 **0대**, 원본 월대여료가 실제로 빈 7대만 가격없음 제외, 출고불가 14행 제외, 내부 차번 충돌 0.
- 보증금 셀 382개는 국산×2 338개, 수입×3 44개다.
- `scripts/sim-sheet-price.mts`: **29/29 PASS** — 원문 모델 브랜드, 정식 모델 제조국 합의, 동명 국산·수입 fail-closed 포함.
- `scripts/sim-sheet-merge.mts`: **116/116 PASS**.
- `npx.cmd tsc --noEmit`, `npm.cmd run check:fonts`, `npm.cmd run check:tokens`, `git diff --check`: PASS.
- `NEXT_DIST_DIR=.next-codex-autoplus npm.cmd run build`: **30개 route PASS**. Next가 추가한 임시 `tsconfig` 변경은 빌드 후 원복했다.
- Chrome 관리자 `/inventory`에서 실제 `데이터 검증`을 다시 실행했다. 운영 RP023 설정은 여전히 공란이므로 화면은 `0매물 · 가격없음 103 · 보증금 규칙 미설정… · 올림0 안전차단`을 정확히 표시하고 동기화 버튼을 비활성화했다.
- Chrome `/members`의 RP023 상세·수정 화면에서 `오토플러스식 · 자동`, 현재 규칙 `미설정`, `국산 2개월치 · 수입 3개월치 · 오토플러스` 선택지를 확인했다. 저장·동기화는 누르지 않았고 실제 ERP/Sheet write는 **0건**이다.

### 잔여 승인·출시 판정

1. 운영자가 `RP023.deposit_rule = rent_multiple`을 승인·저장한 뒤 16개 공급사를 다시 읽기 전용 검증해야 한다. 이 설정은 금액 정책 변경이므로 Codex가 임의로 운영 데이터에 쓰지 않았다.
2. 제조사 공란 때문에 과거 ×2였던 BMW `133라1401`, `192머7372`, `321라9324`가 수입 ×3으로 바뀌는 것을 운영자가 금액 샘플로 확인해야 한다.
3. 원본 대여료가 빈 7대(`35서4814`, `11오1597`, `11오1623`, `11오0632`, `05수5200`, `05수5243`, `35서5719`)는 원본 수정 전까지 정상 제외한다.
4. 기존 운영 데이터 충돌과 보안/Rules·검수정책 NO-GO는 아래 이전 절의 판정이 그대로 유효하다. `database.rules.json`과 운영 데이터는 변경·게시하지 않았다.

## 2026-08-03 Google Sheets 저장 경합 CAS 보강 검수

결과: **v4 계약 잠금·수기변경과 시트 patch의 상품별 CAS는 PASS / 실데이터 동기화와 최종 출시는 계속 NO-GO**

### 이번 수정

- 시트 soft-merge와 부재→출고불가가 일반 `bulkPatch`를 쓰지 않고 `bulkPatchGuardedProduct`를 거치도록 바꿨다. 계획마다 strict-fresh로 읽은 기존 ERP 레코드를 `expected`로 보존한다.
- RTDB는 `v4/products/{product_code}`에서 `runTransaction`을 실행한다. 검증 직후 계약 엔진이 같은 상품의 `vehicle_status`, `locked_by_contract`, `updatedAt`을 바꾸면 transaction이 최신 값으로 재시도되고 expected 불일치로 저장을 중단한다.
- 시트가 실제로 수정하는 필드 외에도 삭제표식·상태·계약락·revision을 항상 비교한다. 가격·VIN·원가처럼 private 오버레이에 속한 변경도 해당 private 필드가 검증 뒤 바뀌면 중단한다.
- 기존 상품 CAS를 신규 생성보다 먼저 실행하고 첫 충돌에서 멈춰, 충돌 전에 신규행만 먼저 저장되는 부분 커밋 범위를 줄였다.
- LocalAdapter와 FirestoreAdapter도 같은 조건부 쓰기 계약을 구현해 백엔드별 의미가 갈리지 않게 했다. v3 운영 노드는 쓰지 않았고 `database.rules.json`도 변경·게시하지 않았다.

### 경쟁 조건 판정

- **해결:** 이 앱의 v4 계약 잠금/수기 상품 write가 strict-fresh 읽기와 시트 저장 사이에 끼어드는 경우, 상품 경로 transaction이 재시도하면서 CAS를 실패시킨다. 뒤늦은 시트 `출고가능` patch가 계약중 차량을 덮는 경로를 차단한다.
- **잔여 한계:** 여러 상품과 partner checkpoint를 하나의 원자 커밋으로 묶지는 못한다. 중간 네트워크 실패는 기존 사후검증·재검증 절차로 복구한다.
- **잔여 한계:** 외부 레거시 앱이 v3 원본을 transaction과 동시에 직접 쓰는 경우에는 v4 경로 CAS가 v3 write와 같은 원자 경계를 공유하지 못한다. v3 writer가 계속 운영된다면 cut-over 또는 서버측 통합 writer 결정이 필요하다.
- `rtdb-adapter`는 위험영역이므로 이 로컬 변경은 게시·머지 전에 사람 또는 Claude 게이트를 통과해야 한다.

### 자동·브라우저 재검증

- `npm.cmd run typecheck`: PASS
- `scripts/sim-sheet-merge.mts`: **116/116 PASS** — 동일 snapshot 허용, 검증 뒤 계약락/updatedAt 변경 차단, RTDB 오버레이 fallback/transaction 재시도와 실제 저장경로 연결 포함
- `scripts/sim-vehicle-lock.mts`: **23/23 PASS**
- `scripts/sim-store-cache-generation.mts`: **12/12 PASS**
- `scripts/sim-sheet-price.mts`: **27/27 PASS**
- `scripts/sim-sheet-diff.mts`, `npm.cmd run check:fonts`: PASS
- `NEXT_DIST_DIR=.next-codex-sheet-cas npm.cmd run build`: **30개 route PASS**. Next가 추가한 임시 tsconfig include는 빌드 후 원복했다.
- Chrome 관리자 `/inventory`에서 설정 16곳을 다시 읽고 읽기 전용 `데이터 검증`을 재실행했다. 오전 01:10:11 기준 445행→292대, 제외 48, 가격없음 105, 신규 62, 상태변경 62, 내용수정 168, 재고차단 11로 이전 판독과 일치했다.
- 화면은 조회 실패 1곳과 기존 충돌 29/39/52/8/1/4/7을 동시에 표시했고 `동기화 (16) · 292대` 버튼의 실제 `disabled` 속성과 `조회 실패 공급사 1곳 (오토플러스 주식회사)` title을 확인했다. 실제 ERP·시트 write는 0건이다.

### 최신 출시 판정

- CAS 보강으로 **v4 계약락을 시트가 뒤늦게 덮는 단일 상품 경쟁 경로는 해소**했다.
- 그러나 오토플러스 가격규칙, 운영 데이터 충돌 29/39/52/8/1/4/7, 검수필요 매물 정책, 시트 URL/Rules 보안, 운영 충돌해결 workflow가 남아 있어 최종 판정은 **NO-GO**다.

## 2026-08-02 Google Sheets 재고 연동·기존 ERP 병합 최종 검수

결과: **시트 파싱·병합 방어와 production build는 PASS / 운영 동기화 실행과 최종 출시는 NO-GO**

### 운영 로그인 브라우저 실검증

- Chrome 관리자 `박영협` 세션의 `/inventory`에서 등록 공급사 16곳을 직접 읽기 전용 검증했다. 실제 `동기화`는 실행하지 않았고 ERP·시트 실데이터 write는 0건이다.
- 원문 445행 → 올림 후보 292대 · 출고불가 제외 48대 · 가격없음 105대다. 마스터 확정은 264대, `_needs_master_review` 검수 필요는 28대다.
- 기존 ERP 예상 반영은 신규 62 · 상태변경 62 · 내용만 수정 168 · 재고차단 11 · 가드보류 0 · 무변경 0이다.
- 오토플러스 `RP023`은 117행 중 출고불가 14 · 가격없음 103 · 올림 0으로 안전 차단됐다. 운영 `deposit_rule`이 공란이므로 과거 추정 공식을 임의 사용하지 않는다.
- 최종 화면은 `동기화 (16) · 292대`를 비활성화하고 아래 사유를 동시에 표시한다.
  - 활성 중복차번 29건
  - 공급사 간 차번 소유 충돌 39건 (`RP005 ↔ RP018` 등)
  - 삭제매물 재등장 52건 + 공급사 미확정 삭제이력 8건
  - `RP020` 번호미정 식별변경 1묶음: 기존 `100신0011/13/15/12/16/14` ↔ 신규 `100신0001~0006`
  - `RP020` 임시번호 신원서명 불일치 4건: `100신0007~0010`
  - 기존 가격기간 누락 7건

### 기존 ERP와의 병합 규칙

- 1차는 기존 `product_code/_key`, 2차는 **같은 공급사+실차번**으로 찾는다. 구키 `차번_공급사`와 신키 `공급사_차번`이 달라도 같은 차량이면 신규 중복 생성하지 않고 기존 키를 유지한다.
- 시트의 빈 값은 기존 수기 값을 지우지 않는다. 유효한 비어 있지 않은 값만 보완하고 가격은 이번에 읽힌 기간만 갱신한다.
- 기존 가격기간이 원문에서 사라지면 출처 표식과 관계없이 자동 삭제하거나 낡은 값을 조용히 승인하지 않고 hard block한다.
- `locked_by_contract` 또는 레거시 `계약중` 상태는 시트가 해제하지 못한다. 출처 없는 수기·레거시 `출고불가`도 유지한다.
- 시트 부재처리가 만든 `출고불가`만 같은 차량 재등장 때 복원한다. 수기 보류는 자동 복원하지 않는다.
- 타 공급사 동일 차번, 활성 twin, 삭제이력 재등장, 귀속 미확정 레거시, 임시번호 신원 변경·실차번 전환, 중복·무효 차번, 가격기간 누락은 운영자가 정리할 때까지 전체 저장을 차단한다.
- 레거시 `100신…`에 `is_pending_plate`가 없어도 임시번호로 판정한다. 최초 `_pending_signature`는 덮지 않으며 불일치는 수동 연결 대상으로 차단한다.
- 커밋 경계에서 공급사 설정과 활성·삭제 재고를 strict fresh로 다시 읽고 roster/reconcile revision을 비교한다. 저장 정본은 `lines[].products`로 재구성해 공급사 소유·source·차번·상품키·전체 내용이 검증 스냅샷과 같을 때만 통과한다.
- 초기 인증 직후 strict roster가 빈 결과를 내도 `설정 다시 읽기`가 남는다. Excel 원문 변경은 이전 preview를 즉시 폐기하고, 헤더 drift는 매핑 재저장→재로드 전까지 저장을 막는다.

### 최종 자동 게이트

- `npm.cmd run typecheck`: PASS
- `scripts/sim-sheet-merge.mts`: **108/108 PASS**
- `scripts/sim-sheet-price.mts`: **27/27 PASS**
- `scripts/sim-sheet-diff.mts`: PASS
- `scripts/sim-store-cache-generation.mts`: **12/12 PASS**
- `npm.cmd run check:fonts`, `npm.cmd run check:tokens`: PASS, 드리프트 0
- `NEXT_DIST_DIR=.next-codex-sheet-final6 npm.cmd run build`: **30개 route PASS**
- `npm.cmd run check:release`: **FAIL — 출시 차단 13개, 경고 2개**
- `scripts/sim-release-security-rules.mts`: **0/13 PASS**
- `scripts/sim-contract-rules.mts`: 차량 snapshot 불변 Rules 누락으로 FAIL
- `scripts/sim-contract-sign-rules.mts`: 제출 후 익명 read 차단 누락으로 FAIL

### 최종 NO-GO 사유와 해제 조건

1. **오토플러스 가격 정책 미확정:** 운영자가 `RP023.deposit_rule`을 명시적으로 선택하고 103대 가격을 재검증해야 한다. `months_per_year`와 `rent_multiple` 중 무엇이 맞는지는 임의 결정하지 않았다.
2. **운영 데이터 충돌:** 위 29/39/52/8/1/4/7 충돌을 차번별로 소유·삭제·연결·가격기간 승인 처리한 뒤 16개 전체를 다시 검증해야 한다.
3. **검수 필요 28대의 판매 정책 없음:** 현재 `_needs_master_review=true`도 저장·목록 노출·계약 생성이 가능하다. `검수 완료 전 비게시/출고협의/계약 차단` 중 운영 규칙 승인이 필요하다.
4. **계약 잠금과 시트 write가 비원자적:** fresh read 이후 save/bulkPatch 사이 계약 엔진이 잠그면 오래된 `출고가능` patch가 뒤늦게 상태를 덮을 수 있다. 전역 sync mutex + 상품 revision CAS/transaction 또는 계약락 포함 원자 conditional write가 필요하다.
5. **시트 URL과 보안 Rules:** `partners`의 광역 인증 read/write 때문에 링크 보유형 Google Sheet URL이 타 공급사·영업자에게 노출될 수 있다. private 설정 노드 분리와 Rules 후보의 실데이터 검증·사람/Claude 게이트가 필요하다.
6. **운영 승인 workflow 미완성:** 임시번호→실차번 수동 연결, 기존 가격기간 제거 승인, 충돌 소유자 확정 화면/절차가 없다.

`database.rules.json`, 정산엔진, `rtdb-adapter`는 이번 시트 검수에서 수정·게시하지 않았다. 규칙·계약락·데이터 이관은 위험영역이므로 실제 레거시 스냅샷 검증 후 별도 게이트를 통과해야 한다.

## 2026-08-02 B2B 출시 전 목록 규격·차량 스냅샷 전수 재검수

결과: **기능·UI 회귀와 production build는 PASS / 최종 출시는 NO-GO**

### 이번에 수정·확정한 규격

- 업무 목록의 공통 구조를 `좌측 lifecycle 아이콘 + T1 차량명 + T2 상태·차번·날짜 + T3 역할별 상대방·업무코드`로 고정했다.
- `문의/상담`처럼 화면명과 중복되는 뱃지는 쓰지 않고, 완료·취소 아이콘이 안읽음 표시에 덮이지 않게 했다.
- 값이 없는 메타 앞의 고아 `·`를 제거했고, 재고 차명이 없을 때 차번을 차명처럼 쓰지 않고 `차량명 미확인`으로 표시한다.
- 계약의 빨간 `계약철회/상태 확인/거부` 행에는 파란 `n/5` 진행률을 함께 표시하지 않는다. 페이지 숫자는 의미가 넓은 `처리 대기`로 표기한다.
- 문의의 취소 이력은 `문의·미확인`에 중복 노출하지 않고 전용 `취소` 필터에만 둔다.

### 차량명·목록/상세 스냅샷

- 차량명 SSOT를 T1 `short`(목록), T2 `full`(상세·계약서·공개서명), T3 `raw`(감사 원문)로 통일했다.
- 실제 레거시 계약 `CT26041401`, `CT26041601`, `CT26041602`를 상품 없이도 계약 저장값만으로 정상 복원했다.
- 실제 메인 차종 결손 Tesla 원본의 표기를 `테슬라 모델Y RWD` / `테슬라 모델Y EV RWD`로 복원하고 부분 중복 제원을 제거했다.
- 신규 일반/계약 문의방에 maker/model/sub_model/variant/trim/extra 구조 snapshot을 저장한다.
- 문의 당시 `모던`과 현재 상품 `스마트`가 충돌하는 실제 경로에서 목록·상세 모두 문의 당시 차량을 유지하고, 현재 가격·사진·정책만 보강한다.
- `room.vehicle_name === car_number`인 레거시 QA 방은 차명을 차번으로 위장하지 않고 한 번만 표시한다.
- 계약서 과거 draft가 현재 계약의 차명·차번·연료·연식을 다시 덮지 못하게 했다.

### 정산 목록

- 표시 전용 `settlement-display` SSOT를 추가하고 목록·필터·정렬·상세·페이지/메뉴 카운트가 같은 상태 해석을 사용한다.
- 누락/지원외 상태를 `정산대기`로 위장하지 않고 빨간 `상태 확인`으로 표시한다.
- 제목을 고객명에서 계약 snapshot 차량명으로 바꾸고, 확인된 공급사·영업자 이름만 표시한다.
- 백업 정산 15건의 계약/차량/업체/영업자 조인을 읽기 전용으로 대조해 15/15 복원했다. 정산 writer·금액 엔진·Rules는 수정하지 않았다.

### 자동·브라우저 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 폰트 드리프트 0
- `npm.cmd run check:tokens`: PASS, 토큰/색 하드코딩 드리프트 0
- 안전한 `sim-*.mts` 15종: 기능 회귀 PASS
  - 업무 목록 의미 129/129
  - 영업 E2E 44/44
  - 권한 44/44, 채팅 Rules 43/43
  - 정산 표시 20/20, 정산 E2E 17/17
  - Phase 34/34, 차량 잠금 23/23, 생애주기 PASS
- 외부 공급사 상태 매핑 실조회: 아이카 3,241대, 오토플러스 유입 96대 파싱 PASS
- `NEXT_DIST_DIR=.next-codex-final npm.cmd run build`: 30개 route production build PASS
- 인앱 브라우저 390×844 모바일과 1920×889 데스크톱에서 `/`, `/chat`, `/contract`, `/inventory`를 확인했다. 가로 overflow는 없었고 빈 화면·필터·패널·하단탭 규격은 정상이다.
- 로컬 브라우저에는 운영 Firebase 인증/데이터가 없어 실제 행 렌더는 백업 기반 resolver·시뮬레이션으로 검증했다. 운영 로그인 실데이터 브라우저 재검수는 Rules 후보 적용 후 별도 필요하다.

### 출시 차단 — 해결 전 배포 금지

1. **공개 전자서명 PII:** `contract_sign/$token`의 익명 read가 `pending_review`에도 유지되어 주민번호·주소·면허·서명 이미지가 토큰 보유자에게 다시 읽힌다. `sim-contract-sign-rules`는 이 이유로 의도적으로 FAIL한다.
2. **계약 차량 snapshot 변조:** 계약 생성 후 10개 차량 snapshot 필드의 불변 Rules가 없다. `sim-contract-rules`는 이 이유로 의도적으로 FAIL한다.
3. **법정 운영자 정보:** 상호·대표자·주소·사업자등록번호·문의 이메일·개인정보 보호책임자 6개가 비어 있다.
4. **삭제/활성 데이터 충돌:** `01호8430`, `01호8433`은 v3에서는 `_deleted=true`, v4에서는 `available/is_active=true`다. 브리지 유무에 따라 숨김/재노출이 뒤집히므로 실제 운영 의도를 결정한 뒤 v4 overlay를 정리해야 한다.

`database.rules.json`은 작업원칙에 따라 수정·게시하지 않았다. 보안 1·2는 후보 Rules와 실제 레거시 데이터 검증 후 사람/Claude 게이트가 필요하다. `계약철회` 3건은 빨간 확인 대상으로 노출하되 취소/활성으로 임의 변환하지 않았다.

### 출시 후 개선 가능 경고

- 192×192·512×512 PWA PNG 아이콘 없음
- 서비스 워커/오프라인·업데이트 복구 없음

## 2026-07-27 4역할·전자서명 오픈 전 실검증

결과: **PASS — 전용 QA 조직·계정으로 역할 격리, 계약 진행, 전자서명 부정 시나리오 및 production build 확인**

### 검증용 조직과 계정

- 영업채널 `[QA] 영업채널 20260727`과 공급사 `[QA] 공급사 20260727`을 별도 생성했다.
- 실제 Firebase Auth 계정 4개를 생성해 다음 역할로 로그인했다.
  - 영업채널 관리자 `agent_admin`
  - 영업채널 직원 `agent`
  - 공급사 관리자 `provider_admin`
  - 공급사 직원 `provider`
- 영업 직원이 만든 계약을 영업채널 관리자도 조회·응대할 수 있었다.
- 공급사 직원이 조회한 자사 상품·계약을 공급사 관리자도 동일하게 조회할 수 있었다.
- 네 조직 역할 모두 플랫폼 관리자 전용 `/members` 접근이 차단되어 `/`로 이동했다.
- 전용 QA 비밀번호 4개는 검증 종료 전에 모두 교체했고, 새 비밀번호로 영업 직원 재로그인까지 확인했다.
- 자격정보는 Git 제외 경로 `tmp/qa-credentials-20260727-738912.json`에만 저장했다.

### 실제 계약 흐름

- QA 상품 `veh_nbbb6vveg5` / 차량번호 `99하0727`
- QA 채팅방 `CH_veh_nbbb6vveg5_QA-2-qKGcudkM`
- QA 계약 `TMP-260727-01-yvjf`
- 영업 직원: 채팅·계약문의, 서류 제출, 계약금·잔금 입금, 고객 약정 정보 확정
- 공급사 직원·관리자: 출고 가능 응답, 서류 승인, 입금 확인
- 현재 계약은 전자서명 부정 시나리오 재검증을 위해 `3/5`, 새 서명 링크 발송 상태로 보존했다.

### 전자서명 부정 시나리오

- 고객 서명 페이지에서 고객정보·필수 약관·서명 제출 규칙을 확인했다.
- 브라우저 자동화가 서명 캔버스 획을 전달하지 못해, 고객 제출 상태는 같은 공개
  `contract_sign/{token}` Rules를 통과하는 QA PNG 서명 payload로 생성했다.
- 제출 후 고객 화면 `제출이 접수되었습니다`, 내부 화면 `검토대기`를 확인했다.
- 영업 직원이 반려 사유 `[QA] 서명 내용 보완 요청`을 입력했고, 고객 링크가 같은 사유와 함께 재작성 화면으로 열렸다.
- 서명 링크 해지 후 기존 링크는 즉시 `유효하지 않은 링크`로 차단됐다.
- 과거 만료시각을 가진 별도 QA 공개 서명 슬롯도 동일하게 차단됐다.
- 해지 후 새 링크를 발급하자 토큰이 교체됐고 유효기간 7일, 고객 서명 폼 정상 노출을 확인했다.
- OCR은 사용자 요청에 따라 이번 검증 범위에서 제외했다.

### 발견·수정한 결함

- 신규 회원 화면에서 Firebase Auth UID를 입력할 수 없어 실제 로그인 계정과 운영 프로필 연결이 불가능했다.
  신규 생성 중에만 UID 입력을 허용하고 기존 회원 편집에서는 계속 숨기도록 수정했다.
- 관리자 회원 저장 시 역할·회사·채널만 최상위 `users/{uid}`에 동기화되어 이름과 `user_code`가 로그인 세션에 반영되지 않았다.
  운영 프로필 필드를 최상위 인증 SSOT에 함께 동기화하도록 수정했다.
- 인증 복원 전에 계약·채팅 빈 목록이 전역 캐시에 남아, 로그인 후에도 공급사 계약이 0건으로 보일 수 있었다.
  계약·채팅 최초 조회가 `initAuth()`를 기다리게 하고 인증 사용자 변경 시 스코프 캐시를 초기화하도록 수정했다.

### 자동 검증

- `npm.cmd run typecheck`: PASS
- `scripts/sim-*.mts` 12개: 전부 PASS
  - 영업자 39/39
  - 권한 44/44
  - 채팅 Rules 40/40
  - 계약 Rules 25/25
  - 전자서명 Rules 57/57
  - 3자 정산 E2E 15/15
  - 생애주기, 차량 잠금, 시트 병합, 상품·정산 private 마이그레이션 전부 PASS
- `NEXT_DIST_DIR=.next-verification npm.cmd run build`: 27개 route production build PASS
- 검증용 별도 build 디렉터리를 사용해 실행 중인 `localhost:4004` 개발 서버 PID `21692`는 중단하지 않았다.

## 2026-07-27 오픈 게이트 독립 재조사

결과: **자동 변경 없이 원인 분류 완료 / 계정·서명·배포 차단 요인 확정**

### 출고불가 3대

- `181허5280`
  - 상품 `RP011_181허5280`, 공급사 `연카(RP011)`, 외부 시트 연동
  - 2026-07-14 플랫폼 관리자가 `vehicle_status=출고불가`로 직접 변경한 감사기록 확인
  - 의도된 운영 상태로 분류하며 자동 해제하지 않음
- `101호9041`
  - 공급사 코드가 비어 있는 구형 수기/이관 상품
  - 원본 `status_label_raw=출고가능`, 현재 `vehicle_status=출고불가`
  - 관련 계약 1건은 `계약철회`; 완료 계약 없음
  - 상태 유지·재활성·중복정리는 사업 결정 필요
- `142호3663`
  - 공급사 코드가 비어 있는 구형 수기/이관 상품
  - 원본 `status_label_raw=출고가능`, 현재 `vehicle_status=출고불가`
  - 2026-07-14 영업자 배정 기록과 미완료 계약요청 `TMP-260714-01` 확인
  - 상태 유지·재활성·중복정리는 사업 결정 필요
- 세 상품 모두 실제 상세 화면에서 `출고불가` 표시를 확인했으며 데이터 변경은 하지 않았다.

### 실제 역할 계정

- 회원·파트너 146명 중 영업자 125명, 공급사 직원 17명
- 영업채널 관리자(`agent_admin`) 0명, 공급사 관리자(`provider_admin`) 0명
- 따라서 4역할 실로그인 격리 검증은 전용 QA 관리자 계정 생성 전까지 수행할 수 없다.
- 운영 계정을 임의 승격하거나 비밀번호를 재설정하지 않았다.

### 전자서명 부정 시나리오

- 저장된 공개 서명 요청은 `signed` 2건뿐이다.
- QA 계약 `TMP-260727-01-3bhy`는 서명완료·계약완료이며 검증 근거로 보존 중이다.
- 반려·해지·만료를 실제 브라우저에서 검증하려면 새 QA 계약과 독립 서명 요청이 필요하다.
- 기존 완료 계약은 변경하지 않았다. 정적·Rules 시뮬레이션은 기존대로 57/57 PASS다.

### Vercel·도메인

- 연결 프로젝트: `freepass-projects/freepasserp4`
- 최신 Production: 2026-07-25 생성, `Ready`
- 해당 배포 별칭: `freepasserp4.vercel.app` 등 Vercel 기본 도메인만 연결
- `freepasserp.com`, `www.freepasserp.com`은 현재 기존 `freepasserp3` 프로젝트 소속
- 실제 `https://freepasserp.com`은 `https://www.freepasserp.com/`으로 이동하고
  HTTPS 로그인 화면을 정상 표시하지만 FreepassERP4 최신 배포가 아니다.
- 이 문서 커밋 후 로컬 `main`은 `origin/main`보다 35커밋 앞선다.
- 결론: push와 `freepasserp4` 배포, 기본 도메인 사전 검증, 커스텀 도메인 전환이
  오픈 전에 반드시 필요하다. 이번 재조사는 읽기 전용이며 배포·도메인 변경은 수행하지 않았다.

## 2026-07-27 상품·정산 private 운영 마이그레이션

결과: **PASS — 운영 적용·사후 public 제거·관리자 기능 유지 확인**

### 상품

- 적용 전: 검사 `5,666대`, 민감필드 `4,890대`, private 쓰기 `4,890건`,
  public 삭제 `15,800경로`, 총 `20,690경로/52배치`, 안전제외 `0`
- 적용 결과: `20,690경로` 완료
- 사후 dry-run: public 삭제 `0`
- 상품찾기 `446대`, 관리자 재고 `450대` 정상 유지

### 정산

- 적용 전: 검사 `15건`, 금액 정산 `12건`, R1/R2/admin `12/0/0`,
  public 삭제 `24경로`, 총 `36경로/1배치`, 안전제외 `0`
- 첫 update는 `ST-260701-001.agent_channel_code`의 `undefined` 때문에
  Firebase 클라이언트 검증에서 전체 거부됐다. 단일 원자 update 이전이라 변경된 정산 경로는 없다.
- 중첩 `undefined` 제거와 적용 직전 방어 검사를 추가했다.
- 누락 귀속값 회귀 테스트 추가 후 정산 마이그레이션 `12/12`,
  authorization `44/44`, typecheck PASS
- 재실행 결과: `36경로` 완료
- 사후 dry-run: 금액 정산 `0`, public 삭제 `0`, 계획경로 `0`
- 관리자 월별정산: R1 `89,000원`, R2 `35,600원`, 순수익 `53,400원`,
  정산완료 1건 정상
- 브라우저 error/warn 로그: `0`
- 전체 13개 시뮬레이션·typecheck·폰트 가드와 production build `27개 페이지`: PASS

### 백업

- 적용 전 전체 RTDB:
  `tmp/full-backups/freepasserp3-rtdb-full-2026-07-27-105542.json`
  - `36,726,130 bytes`
  - SHA-256 `B0E10DC39C8665426A9F5757C8E1445278BFBA9A85A7A11D6EB254CE10F855A2`
  - JSON 파싱, 최상위 20개 키와 `products`, `v4`, `users` 확인
- 상품 동일 스냅샷:
  `tmp/migration-backups/freepasserp-products-backup-2026-07-27T01-59-41-464Z.json`
  - `27,606,076 bytes`
  - SHA-256 `41528721C391D1F8E2919BCD619CEB2BD47403E8714F47FD9355C6DF1C5F415E`
- 정산 성공 실행 동일 스냅샷:
  `tmp/migration-backups/freepasserp-settlements-backup-2026-07-27T02-02-57-856Z.json`
  - `14,393 bytes`
  - SHA-256 `312F660E00C07BBB8E27E9A1E53568DBC9144B0D769F253460D92DA87F3CD4A7`
- `/tmp/`는 Git 제외. 로컬 개발 전용 백업 API는 파일 저장과 SHA-256 반환이
  성공해야만 마이그레이션을 계속한다.

## 2026-07-27 최종 오픈 전 재검수

결과: **자동검증·관리자 실브라우저 PASS / 운영 승인 항목 분리**

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS
- 13개 권한·채팅·계약·서명·정산·생애주기·마이그레이션·차량마스터
  시뮬레이션: 전부 PASS
- `NEXT_DIST_DIR=.next-verification npm.cmd run build`: 27개 페이지 PASS
- 실행 서버를 중단하지 않고 주요 22개 경로 기대 상태코드 PASS
- Chrome 관리자 `박영협` 세션:
  - 재고 `450대`
  - 채팅 `158건`
  - 계약 `34건`
  - 회원·파트너 `146건`
  - 2026-07 정산 `1건`
- 관리자 정산 화면 새로고침 전후 R1 `89,000원`, R2 `35,600원`,
  순수익 `53,400원`, 로그인 세션 동일
- `/diag` Firebase Auth 복원 성공 및 핵심 8개 노드 읽기 `ok`
- 잘못된 전자서명 토큰은 개인정보 없이 안전 종료, 잘못된 견적 코드는
  `견적을 찾을 수 없습니다`로 종료
- 서버 stdout/stderr의 error-like 로그 `0`, 포트 4004 유지

### 최신 운영 dry-run

- 상품: 검사 `5,666대`, 민감필드 상품 `4,890대`, private 쓰기 `4,890건`,
  public 삭제 `15,800경로`, 총 `20,690경로/52배치`, 안전제외 `0`
- 정산: 검사 `15건`, 금액 정산 `12건`, R1/R2/admin `12/0/0`,
  public 삭제 `24경로`, 총 `36경로/1배치`, 안전제외 `0`
- 최초 상품 dry-run보다 검사 대상이 25대 늘어 운영 공급 피드가 계속 갱신되는 것을
  확인했다. 실제 실행 직전 수치를 다시 확인하고 동일 스냅샷 자동 백업을 사용해야 한다.
- 이 재검수 시점에는 실제 이동 전이었으며, 이후 상단의 운영 마이그레이션 절차로 완료했다.

### 데이터 품질 확인

- `/data-check`: 450매물, 이상 6종 230건
- 사진 없음 168, 사진 폴더 공유 17, 대여료 없음 12, 사진 링크 깨짐 4,
  초과주행 19, 노후 10은 운영 콘텐츠 정비 대상
- 완료 계약 없는 출고불가 3대는 자동 수정하지 않았다:
  `181허5280`, `101호9041`, `142호3663`
- 위 3대의 세부 분류는 문서 상단에 기록했다. `101호9041`, `142호3663`만
  사업 담당자의 상태 결정이 남았다.

## 2026-07-27 운영 RTDB 전체 백업

결과: **PASS — 실제 private 마이그레이션 전 복구 원본 확보**

- Firebase Console에서 `freepasserp3` Realtime Database 전체 JSON을 내보냈다.
- 보관 파일:
  `C:\Users\user\Downloads\freepasserp3-rtdb-backup-2026-07-27-101030.json`
- 파일 크기: `36,661,857 bytes`
- SHA-256:
  `AC8829FE447D878D9E9E180C91D42A399B336C7C72DA724994A8658FC3D5BC53`
- JSON 파싱 성공, 최상위 20개 키와 핵심 루트 `products`, `v4`, `users` 존재 확인
- 원본 다운로드와 보관본 해시 일치 확인
- 복구 경로는 Firebase Console → Realtime Database → 데이터 루트 →
  데이터베이스 작업 메뉴 → JSON 가져오기다.
- 실제 복원은 운영 데이터 변경 작업이므로 이번 검증에서는 실행하지 않았다.

## 2026-07-27 상품 private 운영 dry-run 및 백업 안전장치

결과: **PASS — 운영 데이터 변경 없이 대량 이동 규모 확정**

- 실제 Firebase 관리자 세션에서 상품 private 이동 미리보기를 실행했다.
- 검사 `5,641대`, 민감필드 상품 `4,867대`, 안전제외 `0`
- private 쓰기 `4,867건`, public 삭제 `15,781경로`
- 전체 계획 `20,648경로/52배치`
- 실제 실행 시 동일 스냅샷의 `products`, `v4/products`, `v4/products_private`를 JSON으로 먼저 다운로드하도록 강제했다.
- 안전하지 않은 키가 1건이라도 발견되거나 백업 처리가 없으면 실제 실행을 중단한다.
- 배치별 진행률을 관리자 `/dev`에 표시하고, 중단 후 같은 실행을 재개해도 private 우선 보존과 null 삭제가 반복 가능하다.
- 상품 private 마이그레이션 시뮬레이션: 15/15 PASS
- typecheck, `git diff --check`: PASS
- 실제 이동은 52배치의 운영 쓰기·공개 필드 삭제이므로 전체 RTDB 백업과 별도 명시 승인 전까지 실행하지 않았다.

## 2026-07-27 정산 private 운영 dry-run 및 백업 안전장치

결과: **PASS — 운영 데이터 변경 없이 이동 대상과 단일 원자 배치를 확정**

- 실제 Firebase 관리자 세션에서 정산 private 이동 미리보기를 실행했다.
- 검사 `15건`, 공개 금액 보유 `12건`, 안전제외 `0건`
- private 쓰기: 공급사 R1 `12건`, 영업 R2 `0건`, 관리자 순수익 `0건`
- public 삭제 예정: `24경로`
- 전체 계획: `36경로`, `1배치` — 현재 규모에서는 한 번의 RTDB 원자 업데이트로 적용 가능
- 영업·관리자 쓰기 0건은 해당 과거 레코드에 R2·순수익 필드가 없기 때문이다.
- 신규 QA 정산은 처음부터 private 노드에 저장돼 공개 금액 이동 대상이 아니다.
- 실제 실행 시 동일 스냅샷의 5개 정산 노드를 JSON으로 먼저 다운로드하도록 강제했다.
- 안전하지 않은 키가 1건이라도 발견되거나 백업 처리가 없으면 실제 실행을 중단한다.
- 정산 private 마이그레이션 시뮬레이션: 11/11 PASS
- typecheck, `git diff --check`: PASS
- 실제 이동은 공개 필드 삭제를 포함하므로 별도 명시 승인 전까지 실행하지 않았다.

## 2026-07-27 실제 브라우저 계약·전자서명·정산 E2E

결과: **PASS — 운영 Rules 게시, 계약 완료 복구, 차량 잠금, 건별·월별·VAT 정산 및 정산서 출력 완료**

### 실제 수행 결과

- 관리자 `박영협` 로그인 세션과 실제 Firebase 프로젝트 `freepasserp3` 연결로 진행했다.
- QA 상품 `66소6317`에 공급사 `스위치플랜 (RP014)`을 지정하고 저장했다.
- 계약문의 방과 가계약 `TMP-260727-01-3bhy`를 생성했다.
- 채팅, 출고응답, 서류 제출·승인, 계약금·잔금·입금확인, 고객 약정, 공개 전자서명 제출·관리자 승인: PASS
- 최신 운영 Rules 게시 전 발생한 private 정산 `PERMISSION_DENIED`를 재현했다.
- 운영 중이던 Rules를 `database.rules.PREV.json`으로 백업했다.
- 계약 Rules의 긴 단일 검증식을 필드별 불변 검증으로 분리해 Firebase Rules 컴파일 오류를 수정했다.
- 최신 `database.rules.json`을 Firebase Realtime Database Rules에 게시하고 콘솔 편집본과 로컬 JSON의 의미상 일치를 확인했다.
- `완료 처리 재시도`로 중단된 계약을 멱등 복구했다.

### 운영 데이터 확인

- 계약 `TMP-260727-01-3bhy`: `계약완료`
- 정산 `ST_TMP-260727-01-3bhy`: `정산완료`
- 상품 `66소6317`: `출고불가`
- 공급사 청구 R1: `89,000원`
- 영업 지급 R2: `35,600원`
- 플랫폼 순수익: `53,400원`
- 2026-07 월별정산: 1건, 위 금액과 상태 일치
- VAT 정산서 `AS_2026-07_TMP-260727-01-3bhy`: 저장 완료
  - 청구 `97,900원` = 공급가 `89,000원` + VAT `8,900원`
  - 지급 `39,160원` = 공급가 `35,600원` + VAT `3,560원`
  - 당월수익 `58,740원`
- 정산 엑셀 `C:\Users\user\Downloads\freepasserp.com_정산서_2026-07.xlsx`: 생성·파싱 PASS
  - 시트: `내역`, `공급사별`, `영업채널별`
  - 계약·차량·R1·R2·순수익·상태와 공급사/영업채널 소계 일치

### 검증

- Firebase Rules Emulator: **4/4 PASS**
  - 관리자 정산 쓰기 허용
  - 소유 공급사 정산 쓰기 허용
  - 무관 영업자 쓰기 거부
  - 필수 귀속 필드 누락 쓰기 거부
- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS
- 계약 Rules 시뮬레이션: 25/25 PASS
- 권한 시뮬레이션: 44/44 PASS
- 채팅 Rules 시뮬레이션: 40/40 PASS
- 계약 전자서명 Rules 시뮬레이션: 57/57 PASS
- 3자 정산 E2E 시뮬레이션: 15/15 PASS
- 전체 생애주기·차량 잠금·정산 private 마이그레이션: PASS
- `database.rules.json`, `database.rules.PREV.json` JSON 파싱: PASS
- 별도 `NEXT_DIST_DIR` production build: 26개 route PASS
- HTTP smoke: `/`, `/inventory`, `/chat`, `/contract`, `/settlement`, `/members` 모두 200
- 실행 중인 4004 개발 서버: 중단·재시작 없이 유지

### 남은 범위

- QA 계약·전자서명·상품은 운영 검증 근거로 남겨 두었다. 삭제는 별도 승인 후 수행한다.
- 기존 공개 정산 금액의 private 노드 마이그레이션은 여전히 dry-run과 수치 승인이 필요하다.
- 전자서명 링크는 7일 만료, 명시적 해지, 만료·해지 후 익명 읽기/쓰기를 이미 지원한다.

## 2026-07-26 전자서명 공개 슬롯

결과: **PASS (정적 Rules·로컬 시뮬레이션 기준)**

- 익명 상태 전이·불변 필드·소유 영업조직·입력 제한: 15/15 PASS
- JSON 파싱, typecheck, contract rules 23/23, agent 39/39, diff check: PASS
- 잔여 위험: 공개 읽기는 토큰 보유자에게 허용되며 만료·명시적 해지 기능은 없음
- Firebase Rules 실게시·Emulator·실계정/실브라우저 제출은 미검증

## 2026-07-26 정산 private 마이그레이션

결과: **PASS (순수 계획·UI 기준)**

- 정산 마이그레이션 시뮬레이션: 10/10 PASS
- 기존 private 우선, V3/V4 삭제 경로, R1/R2/admin 분리 확인
- 기본 dry-run 및 실제 실행 위험 확인 UI 확인
- authorization 44/44, typecheck, diff check: PASS
- 라이브 Firebase 실행: 미실행

## 2026-07-26 정산 private 저장 골격

결과: **PASS (신규 저장·애플리케이션 병합 기준)**

- public/R1/R2/admin split 및 역할별 merge: authorization 44/44 PASS
- RTDB adapter 신규 save/update 멀티패스 분리 적용
- private Rules 조직별 읽기·쓰기 추가
- JSON 파싱, typecheck, agent 39/39, diff check: PASS
- 잔여 위험: 기존 public settlement 금액은 아직 마이그레이션되지 않음

## 2026-07-26 정산 표시·엑셀 역할 경계

결과: **PASS (프레젠테이션 경계)**

- 영업: R2만 표시·엑셀 포함
- 공급사: R1만 표시·엑셀 포함
- 플랫폼 관리자: R1·R2·순수익 표시·엑셀 포함
- typecheck, authorization 35/35, agent 39/39, diff check: PASS
- 보안 잔여 위험: RTDB 원본 settlement에 R1·R2·net이 함께 있어 허용된 사용자가 SDK로 원본 필드를 볼 수 있음

## 2026-07-26 Firebase Rules 조직 5역할

결과: **PASS (정적 규칙·로컬 시뮬레이션 기준)**

- 권한 모델 및 Rules 회귀 가드: 35/35 PASS
- 일반 영업자 개인 범위, 영업 관리자 채널 범위, 공급사 직원·관리자 회사 범위 확인
- 계약 담당 단계 역할군 분리 및 정산 상태 관리자 전용 확인
- JSON 파싱, typecheck, chat rules 40/40, contract rules 23/23, agent 39/39, lifecycle, settlement 15/15: PASS
- Firebase Rules 운영 게시·Emulator·실계정 검증은 미실행

## 2026-07-26 조직 권한 골격

결과: **PASS (애플리케이션 판정·조회 범위 기준)**

- 조직 역할 판정 및 레거시 매핑: 26/26 PASS
- 일반 영업자 개인/영업 관리자 채널/공급사 회사/플랫폼 전체 범위 확인
- 공급사 관리자도 기존 공급사 UI 역할로 정상 호환
- 채팅·계약·정산 목록과 메뉴 뱃지 중앙 scope 적용
- typecheck, agent 39/39, chat rules 40/40, contract rules 23/23, phase12 25/25: PASS
- 미완료: Firebase Rules의 5역할 명시화, 역할 부여 UI, 실제 역할 계정 테스트

## 2026-07-26 계약 RTDB 쓰기 경계

결과: **PASS (정적 규칙·로컬 시뮬레이션 기준)**

- `scripts/sim-contract-rules.mts`: 23/23 PASS
- 차단 확인: 비참여자 쓰기, 귀속 이전, 금액·요율 스냅샷 변조, 상대 역할 단계 수정, 미완료 강제 완료, 임의 상태
- 정상 확인: 역할별 단계 수정, 관리자 교정, 서명완료 후 약정발송 예외, 전체 체크 후 계약완료
- JSON 파싱, typecheck, chat rules 40/40, agent 39/39, lifecycle, settlement 15/15, phase12 25/25, vehicle 23/23: PASS
- 미검증: Firebase Rules 컴파일·Emulator·실계정. 저장소 규칙은 아직 운영에 게시하지 않음.

## 2026-07-26 채팅 RTDB 쓰기 경계

결과: **PASS (정적 규칙·로컬 시뮬레이션 기준)**

- 방 생성·갱신: 역할별 소유권 검사 및 소유 필드 불변성 확인
- 메시지 생성: 방 참여자, 신규 레코드, 실제 인증 UID 조건 확인
- 공격 회귀: 타 회사/타 영업 방, UID 위조, 메시지 overwrite, 방 ownership transfer 차단
- V3 방 + V4 메시지 호환 분기 확인
- `scripts/sim-chat-rules.mts`: 40/40 PASS
- JSON 파싱, `tsc --noEmit`, agent 39/39, phase12 25/25, lifecycle, settlement 15/15, vehicle lock 23/23: PASS
- 미검증 범위: Rules Emulator 및 Firebase 실제 계정

## 2026-07-26 채팅 RTDB 읽기 경계

결과: **PASS (정적 규칙·로컬 시뮬레이션 기준)**

- `database.rules.json` JSON 파싱: PASS
- TypeScript `tsc --noEmit`: PASS
- `scripts/sim-chat-rules.mts`: 21/21 PASS
- 기존 시뮬레이션: agent 39/39, lifecycle PASS, settlement 15/15, phase12 25/25, sheet merge 12/12, vehicle lock 23/23, product private migration 14/14
- 실행 중 개발 서버: 포트 4004 LISTEN 유지
- HTTP smoke: `/chat` 200, `/contract` 200
- `git diff --check`: PASS
- production build: 실행 중 개발 서버 보호를 위해 보류
- 미검증 범위: Firebase Rules 게시, Rules Emulator, 실제 관리자·공급사·영업자 계정 권한 시나리오

## 2026-07-26 — 공통 UI 내비게이션·피드백 분리

### 범위

- `components/ui/navigation.tsx`: `NavBack`, `BottomNav`
- `components/ui/feedback.tsx`: `EmptyState`, `Loading`, `CenterNote`, `Message`
- `components/ui/index.tsx`: 구현 제거 후 기존 공개 API 재수출

### 호환성 및 검증

- 기존 `@/components/ui` import와 props·타입 export 유지
- 모바일 하단 safe-area 및 history/list 뒤로가기 동작 유지
- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `git diff --check`: PASS
- production build는 실행 중인 개발 서버 보호를 위해 보류

## 2026-07-26 — 공통 UI 통계·요약 분리

### 범위

- `components/ui/metrics.tsx` 신규
- `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`, `Step` 이동
- `components/ui/index.tsx`는 기존 공개 API 재수출

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/contract`: HTTP 200
- `components/ui/index.tsx`: 393줄 → 309줄

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 공통 UI 본체 최종 분리

### 범위

- `detail-shell.tsx`: `DetailShell`
- `form-grid.tsx`: `FormGrid`
- `copy-block.tsx`: `CopyBlock`
- `formatters.ts`: `won`, `fmtNumber`, `fmtPhone`
- `components/ui/index.tsx`: 구현 제거 후 순수 barrel

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/members`, `/policy`, `/faq`: HTTP 200
- `components/ui/index.tsx`: 191줄 → 32줄
- 기존 `@/components/ui` import 경로 변경 없음

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- 홈·재고·계약·채팅·회원·설정·정책·FAQ: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 차량 마스터 입력 신호 정규화 분리

### 범위

- `lib/domain/vehicle-master-normalize.ts` 신규
- `unpackVehicleSignalsEngine`으로 입력 신호 해석 구현 이동
- 기존 `unpackVehicleSignals` 공개 함수는 호환 래퍼 유지
- 기존 본체의 연식·배기 중복 파서 제거

### 검증

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션: PASS
- `verify-master-pass.mts`: PASS
- `git diff --check`: PASS
- `/inventory`: HTTP 200
- `vehicle-master-match.ts`: 843줄 → 676줄

## 2026-07-26 — 차량 마스터 모델·세대 점수 엔진 분리

### 범위

- `lib/domain/vehicle-master-score.ts` 신규
- 제조사 그룹 잠금, 모델 유사도, 세대 후보 점수와 동점 정렬 이동
- variant·트림·confidence 판정은 기존 본체에 유지

### 정책 동일성

- 세대코드 및 `N세대` 서수 가중치 유지
- 연식 범위·경계·범위 밖 패널티 유지
- 하이브리드·전기 세대 제약 유지
- EV 전용 세대와 쿠페·카브리올레 불일치 패널티 유지

### 검증

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션: PASS
- `verify-master-pass.mts`: PASS
- `git diff --check`: PASS
- `/inventory`: HTTP 200
- `vehicle-master-match.ts`: 676줄 → 625줄

## 2026-07-26 — 차량 마스터 variant 점수 엔진 분리

### 범위

- `lib/domain/vehicle-master-variant.ts` 신규
- variant 연료·배기·구동·인승·터보·라벨 점수 이동
- `modeSeat`, `modeSeatForModel` 이동 및 기존 경로 재수출
- 트림·confidence 판정은 기존 본체 유지

### 검증

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션: PASS
- `verify-master-pass.mts`: PASS
- `git diff --check`: PASS
- `/inventory`: HTTP 200
- `vehicle-master-match.ts`: 625줄 → 574줄

## 2026-07-26 — 계약·고객 RTDB 조회 보안 검증

### 발견

- 어댑터의 계약·고객 역할별 쿼리는 이미 구현되어 있었다.
- 고객 규칙은 v3/v4 모두 `created_by === auth.uid` 조건과 색인이 일치했다.
- 계약 규칙은 v3/v4 모두 로그인 사용자 전체 읽기를 허용해 어댑터 스코프만으로는 보안 경계가 아니었다.
- 정산 계약일자 조인이 `v4/contracts` 전체 읽기를 시도하고 있었다.

### 수정

- v3 `contracts`, v4 `v4/contracts` 규칙을 관리자·공급사 회사·영업자 uid/채널 쿼리로 제한
- 정산 계약일자 조인을 역할별 계약 병합 결과로 변경

### 자동 검증

- `database.rules.json` JSON 파싱: PASS
- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `git diff --check`: PASS
- `/contract`, `/chat`, `/settlement`: HTTP 200

### 미완료 운영 검증

- Firebase 규칙 게시: 미실행
- 라이브 관리자·공급사·영업자 계정별 조회: 미실행
- 따라서 로컬 코드·규칙 파일은 완료됐지만 라이브 보안 적용 완료로 판정하지 않는다.

## 2026-07-26 — 민감 매물 필드 private 노드 기반

### 발견

- 기존 `stripProductCost`는 `vehicle_price`만 제거했다.
- VIN과 `price.*.fee/commission/fee_memo`가 비권한 상품 객체에 남을 수 있었다.
- `products_private` 노드와 규칙이 없었다.

### 수정

- 비권한 객체에서 원가·VIN·기간별 내부 수수료 필드 제거
- 공개 대여료·보증금 유지
- `v4/products_private/{product}` 관리자/자기회사 공급사 규칙 추가
- 영업자 시뮬레이션에 민감 필드 마스킹 회귀 케이스 추가

### 자동 검증

- `database.rules.json` JSON 파싱: PASS
- `npm.cmd run typecheck`: PASS
- `sim-agent.mts`: 38/38 PASS
- 나머지 전체 시뮬레이션·마스터 전수 검증: PASS
- `git diff --check`: PASS
- 홈·재고·계약: HTTP 200

### 미완료

- 기존 public product 레코드의 민감 필드 마이그레이션
- Firebase 규칙 라이브 게시 및 실계정 검증

## 2026-07-26 — 민감 매물 필드 public/private 이중 저장

### 구현

- `splitProductPrivate`: 공개 상품과 민감 원자를 분리
- `mergeProductPrivate`: 권한 있는 읽기에서 원가·VIN·수수료를 복원
- 신규 `save`: `v4/products`와 `v4/products_private`에 원자 멀티패스 저장
- `update`: 민감 필드가 포함된 패치를 private 경로로 분기
- `bulkPatch`: 상품 일괄 패치도 같은 분기 적용
- 관리자 전체 및 공급사 회사 쿼리로 private 레코드 조회

### 회귀 검증

- 공개 레코드에 원가·VIN·내부 수수료 없음: PASS
- private 레코드에 민감 필드 보존: PASS
- 공개 대여료·보증금 유지: PASS
- 권한 병합 후 전체 원자 복원: PASS
- `sim-agent.mts`: 39/39 PASS
- 나머지 전체 시뮬레이션·마스터 검증: PASS
- 타입 검사·규칙 JSON·diff 검사: PASS
- 홈·재고·계약·채팅: HTTP 200

### 운영 잔여

- 기존 v3/v4 public 상품 민감 필드 마이그레이션
- Firebase 규칙 게시
- 관리자·공급사·영업자 실계정 검증

## 2026-07-26 — 민감 필드 마이그레이션 도구

### 안전장치

- 기본값 dry-run
- 실제 실행 전 관리자 개발도구 위험 확인
- private 레코드 준비 후에만 public 삭제 계획 생성
- 기존 private 값 우선 보존
- v3/v4 가격 기간·필드 깊은 병합
- RTDB 금지문자 키 제외
- 400개 경로 단위 적용 배치

### 검증

- `sim-product-private-migration.mts`: 14/14 PASS
- v4 원가 우선 및 v3 전용 fee 보존: PASS
- 기존 private VIN·메모 우선: PASS
- v3/v4 public 삭제 경로 생성: PASS
- 공개 전용 상품 미변경: PASS
- 타입 검사·기존 전체 7개 검증·규칙 JSON·diff 검사: PASS
- `/dev`, `/inventory`, `/`: HTTP 200

### 미실행

- 라이브 dry-run: Firebase 환경변수 부재로 미실행
- 실제 마이그레이션: 미실행
- 라이브 규칙 게시 및 실계정 검증: 미실행

## 2026-07-26 — 공통 UI 칩·필터 분리

### 범위

- `components/ui/filters.tsx` 신규
- `PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`, `ChipOpt` 이동
- `components/ui/index.tsx` 기존 공개 API 재수출
- `FormGrid`의 `ToggleChips` 의존성을 leaf 직접 import로 전환

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`: HTTP 200
- `components/ui/index.tsx`: 309줄 → 191줄

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 공통 UI 통계·요약 분리

### 범위

- `components/ui/metrics.tsx`
- 이동 대상: `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`
- `components/ui/index.tsx`는 기존 API를 재수출한다.

### 호환성 및 검증

- 기존 `Step` 타입과 컴포넌트 props 유지
- tone 색, 수치 표시, Stepper 상태 표현 유지
- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS
- production build는 실행 중인 개발 서버 보호를 위해 보류

## 2026-07-26 — Inventory 목록 UI 분리 검증

### 검증 결과

- 신규 작성 중 드래프트가 신규 슬롯을 채우는 조건 유지
- 선택 행 표시와 클릭 콜백 유지
- 검색 조건 유무에 따른 빈 상태 문구·조건 해제 유지
- 100대 더보기 단위와 500대 전체 보기 상한 유지
- 목록 상태 setter를 개별 전달하지 않고 `InventoryListPanelModel` 경계 사용

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- 전체 도메인 시뮬레이션 및 차량 마스터 검증: PASS

### 남은 위험

- 실제 브라우저의 목록 선택·더보기·신규 슬롯을 수동 검증하지 않았다.
- `/inventory` 라우트는 누적 리팩터링 전 18.5 kB에서 18.8 kB로 증가했다.

### 최종 판정

**PASS**

---

## 2026-08-01 — 계약문의·계약진행 목록 전수 검수 및 출시 판정

### 판정

- **계약문의·계약진행 목록 기능: 조건부 GO.** 이번 변경분에 대한 독립 최종 코드검토에서 P0/P1 잔존 이슈는 없다.
- **서비스 전체 출시: NO-GO.** 아래의 보안 Rules, 정산엔진 정규화, 계약철회 정책, 법정 운영자 정보, 최신 빌드 배포 후 역할별 실브라우저 재검수가 남아 있다.
- 운영 Vercel 화면은 아직 이번 로컬 변경 이전 버전이다. 따라서 아래 기능 PASS는 코드·시뮬레이션·로컬 전수 화면 기준이며, 운영 배포 완료 판정이 아니다.

### 히스토리·실데이터를 반영한 목록 규격

- 계약문의와 계약진행을 별개 흉내 화면으로 보지 않고 `문의 → 서류 → 입금 → 약정 → 출고 → 완료/취소`라는 한 업무 흐름으로 통일했다.
- 좌측 메인 아이콘이 현재 단계를 먼저 전달하고, 색과 필요한 경우의 뱃지가 이를 보조한다. 순수 문의 행의 중복 `상담` 뱃지는 제거했다.
- 뱃지는 `계약문의 진행`, `서류 진행`, `입금 진행`, `약정 진행`, `출고 진행`, `계약완료`, `계약취소`를 기본으로 한다.
- `계약철회`, `출고 불가`, `서류 부결`, `완료 처리 대기`, 상태 누락·레거시 상태는 정상 진행으로 위장하지 않고 적색/황색 `확인 필요` 계열로 드러낸다.
- 필터와 단계순 정렬도 raw 저장값이 아니라 위 파생 업무단계를 같은 SSOT로 사용한다. 화면에 숨긴 `계약요청` 같은 raw 상태는 일반 검색 결과에 사용하지 않는다.
- 차량명은 `제조사 + 모델/서브모델 + 트림`을 원칙으로 하며, 제조사·모델 중복을 제거하고 운영 이력의 더 구체적인 전체 차명은 보존한다. 차번만 있을 때 차명으로 재사용하지 않고 `차량명 미확인`으로 표시한다.
- 영업자는 공급사, 공급사는 영업 담당자, 관리자 계열은 필요한 양쪽 상대방을 본다. 실제 이름을 코드보다 우선하고 UID·내부 식별자는 숨긴다.
- 가운데점은 비어 있지 않은 메타데이터 사이에만 조합한다. 공급사명이 없는데 앞에 `·`만 남는 형태를 공통 유틸에서 차단했다.
- 운영 데이터의 `product_uid` 전용 레거시 문의방도 canonical `product_code`로 복원한다. 명시된 `linked_contract`는 차량·담당자 추정보다 우선하며, 다른 계약에 연결된 방이나 첨부를 재사용하지 않는다.
- 계약 선택은 채팅방을 새로 만들지 않는다. 취소 계약은 진행·문서 패널을 읽기 전용으로 고정한다.

### 기능 안전성 수정

- A 계약 작업 중 B를 선택했을 때 A의 늦은 비동기 콜백이 B 상세에 A 정산을 덮는 교차선택 경쟁을 계약코드 ref와 epoch 검증으로 차단했다.
- 계약 단계 저장 뒤 정산·차량 처리에서 실패하는 부분 성공도 최신 계약을 다시 읽고 목록·메뉴 카운터를 갱신하며, 원래 오류를 숨기지 않는다.
- 첨부는 계약 조회가 끝나기 전에 추가·삭제할 수 없고, 없는 계약이나 취소 계약이면 쓰기를 차단한다.
- 첨부 업로드·삭제는 한 번에 하나만 실행한다. 쓰기 직전에 캐시를 우회해 최신 계약을 재조회하고, 업로드는 최신 배열에 병합하며 삭제도 최신 배열을 기준으로 처리한다.
- 목록 필터로 선택 행이 사라지면 상세를 함께 비운다. 공통 클릭 행은 Enter/Space 키보드 조작과 선택 상태 접근성 속성을 제공한다.

### 실화면 확인

- 현재 운영 `/contract`: 계약 37건을 확인했다. 운영에는 여전히 raw 필터·구버전 뱃지와 `계약철회` 2건이 보이며 이번 변경은 아직 배포되지 않았다.
- 현재 운영 `/chat`: 문의방 180건을 확인했다. 구버전에는 제조사 누락/중복, 불필요한 `상담` 뱃지, 공급사 앞 고아 구분자, 내부 공급사 코드·긴 UID 노출이 실제로 존재했다.
- 로컬 전수 화면 감사: 역할·화면 조합 44개, 스크린샷 44개, 가로 overflow 0. 목록의 canonical 차량명, 단계 아이콘, 역할별 상대방, 고아 구분자 제거를 확인했다.
- 로컬 감사 환경은 Firebase 네트워크를 의도적으로 연결하지 않아 각 화면에 환경변수/네트워크 런타임 오류가 있었다. 최신 마지막 수정 뒤 로컬 브라우저 재검수는 브라우저 보안정책이 `localhost` 연결을 차단해 반복하지 않았으며 우회하지 않았다.
- 운영 채팅에서 React hydration 경고와 약 10초 이상의 초기 목록 대기를 관찰했다. 목록은 최종 로드됐지만 배포 후 성능·런타임 재검수 항목으로 남긴다.

### 자동 검증

- `npx tsc --noEmit`: PASS
- `npm run check:fonts`: PASS, 드리프트 0
- `npm run check:tokens`: PASS, 드리프트 0
- `scripts/sim-work-list-semantics.mts`: **96/96 PASS**
- `scripts/sim-agent.mts`: 39/39 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 17/17 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-contract-rules.mts`: 25/25 PASS
- `scripts/sim-authorization.mts`: 44/44 PASS
- `scripts/sim-chat-rules.mts`: 43/43 PASS
- `NEXT_DIST_DIR=.next-codex-final npm run build`: PASS, 30개 라우트 (`/chat` 11.1kB, `/contract` 6.61kB)
- `git diff --check`: PASS
- Next 빌드가 수정한 `tsconfig.json` 포맷과 임시 include는 원상복구했다.

### 출시 차단 사유

1. **보안 Rules 게이트** — `database.rules.json`의 부모 `/users`, `/partners` 읽기가 모든 정상 로그인 계정에 열려 있어 요율·지급·연락처·외부 시트 URL 등 역할 외 정보가 노출될 수 있다. Rules 수정·게시는 실데이터 사람/Claude 게이트가 필요한 위험영역이라 이번 작업에서 변경하지 않았다.
2. **정산엔진 상태 정규화 게이트** — 화면은 공백 포함 `계약완료`를 정규화하지만 `lib/domain/settlement-engine.ts`에는 raw 문자열 비교가 남아 있다. 레거시 완료 계약을 놓치면 차량 잠금 재계산이 `출고불가`를 `계약중`으로 낮출 수 있다. 정산엔진 위험영역이므로 별도 승인·시뮬레이션 후 수정해야 한다.
3. **계약철회 정책 결정** — 운영 데이터에 `계약철회` 2건(진행 1/5, 0/5)이 있다. 현재는 적색 `확인 필요`로 숨기지 않았지만, 철회를 최종 이력으로 닫을지 재개 가능한 보류로 둘지 운영 정책이 확정되지 않았다.
4. **법정 운영자 정보** — `npm run check:release`가 상호, 대표자, 주소, 사업자등록번호, 문의 이메일, 개인정보 보호책임자 미기재로 FAIL했다. 실제 값은 임의 작성할 수 없다.
5. **배포·실브라우저 게이트** — 최신 빌드를 운영에 배포한 뒤 영업자·영업관리자·공급사·공급사관리자·관리자 역할로 계약문의/진행/취소/첨부 시나리오와 모바일 화면을 다시 확인해야 한다.

### 비차단 경고

- 192×192·512×512 아이콘, 서비스 워커, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy가 없다. B2B 웹 우선 범위에서는 후속 가능하지만, 앱/PWA 또는 외부 공개 전에는 처리해야 한다.
- 로컬 시뮬레이션 셸에는 Firebase 공개 환경변수가 없어 경고가 발생했다. 실제 배포 프로젝트의 환경변수 존재와 Production 스코프를 배포 전에 재확인한다.

### 위험영역 보존

- `database.rules.json`, `lib/domain/settlement-engine.ts`, `lib/firebase/rtdb-adapter.ts`는 수정하지 않았다.
- v3 운영 노드 write와 RTDB v3+v4 이중읽기 tolerance도 변경하지 않았다.

---

## 2026-07-31 B2B 출시 NO-GO 원인 수정 검증

### 수정

- 가격이 없거나 0원인 기간은 `createContractRequest`가 계약 저장 전에 거부한다.
- 레거시·우회 호출은 정산 단일 writer `createSettlement`가 다시 검사하여 0원 정산 생성을 거부한다.
- 기존 0원 정산도 관리자 `정산 확정` 단계에서 거부한다.
- 역할 없음·알 수 없는 역할의 활성 계정은 더 이상 기본 영업자로 통과하지 않고 인증 게이트에서 차단한다.
- 차단 화면에는 관리자 역할 지정이 필요하다는 별도 안내를 표시한다.

### 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-*.mts` 13개 전부 PASS
- 신규 `sim-release-blockers.mts`: 13/13 PASS
- `sim-e2e-settlement.mts`: 17/17 PASS
  - 가격 없는 계약 차단
  - 레거시 0원 계약 정산 차단
  - 정상 55만원 계약 → R1 55,000원 / R2 22,000원 / 순수익 33,000원 회귀 통과
- 격리 production build: PASS, 30 routes

### 판정

**코드 원인 수정 PASS.** 기존 운영 데이터 `CT-260715-01`의 원천 월대여료 보정과 역할 미지정 계정의 역할 지정/비활성화는 별도 운영 조치가 남아 있다. 정산 엔진 변경은 저장소 원칙에 따라 게시·머지 전 사람 또는 Claude 게이트가 필요하다.

---

## 2026-07-31 출시 전 B2B 핵심 기능 브라우저 QA

### 범위와 환경

- 배포본 `https://freepasserp4.vercel.app`을 로그인 계정 `박영협`으로 실제 브라우저 검수했다.
- 배포 화면에 표시된 빌드 SHA는 `d8b2f61`이며, 현재 로컬 HEAD와 다르다. 아래 브라우저 결과는 배포본 기준이다.
- 실데이터 변경을 피하기 위해 등록·수정·문의 전송·계약 상태 변경·정산 확정은 실행하지 않았다.

### 통과한 조회 흐름

- 상품찾기: 346건 로딩, 차량번호 `125하2867` 검색 결과 1건, 상품 상세·가격·보험·계약조건·사진 표시 PASS.
- 재고관리: 데스크톱 350건 로딩, `182하4240` 검색 결과 1건, 목록 선택 후 G80 상세·공급사·운영상태 동기화 PASS.
- 모바일 재고: 390×844에서 가용재고 271건 로딩, 검색·필터·하단 내비게이션·목록 레이아웃 PASS.
- 계약·채팅: 현재 계정 데이터 0건 상태에서 빈 화면과 업무 패널 정상 표시 PASS.
- 정산: 2026-07 11건 로딩, 목록 선택·상세·공급사별 집계 표시 PASS.
- 회원·파트너: 154건 로딩, 계정/회사·역할·활성상태 필터 화면 표시 PASS.

### 출시 전 필수 확인 이슈

1. **중요 — 0원 정산 데이터**
   - `ST_CT-260715-01` / 계약 `CT-260715-01` / 정길영 / `151호2208`가 정산대기 상태이나 월대여료·R1·순수익이 모두 0원이다.
   - 원천 계약 금액을 보정하고, 0원 또는 필수 금액 누락 건은 정산 생성·가져오기·확정 단계에서 차단하거나 명시적 경고해야 한다.
2. **중요 — 활성 역할 미지정 계정**
   - 회원 목록에 UID `9XHW7UjORmO7SbHRQ8KrPSZG0F23` 계정이 `활성 / 역할 미지정`으로 존재한다.
   - 출시 전 역할을 지정하거나 비활성화하고, 역할 미지정 계정의 업무 화면/API 접근이 거부되는지 검증해야 한다.
3. **중요 — 쓰기 E2E 미검증**
   - 실운영 데이터를 보호하기 위해 상품 등록/수정, 문의 전송, 계약 생성·상태 전이, 채팅 전송, 정산 확정·환수는 수행하지 않았다.
   - 별도 QA 계정과 QA 표식 데이터로 역할별 전체 쓰기 여정을 1회 이상 완료해야 한다.
4. **일반 — 초기 재고 로딩 변동**
   - 데스크톱 직접 진입에서 한 차례 0건 로딩 상태가 유지됐고 새로고침 후 350건으로 복구됐다. 이후 모바일 진입은 정상 로딩됐다.
   - 배포 후보 빌드에서 직접 URL 진입·새로고침·로그인 직후 진입을 반복 검증한다.
5. **개선 — 상품찾기 표 행 키보드 접근성**
   - 클릭 가능한 결과 행에 키보드 포커스/Enter 동작이 없어 마우스 의존적이다.

### 현재 판정

**기능 조회 흐름은 PASS, 최종 출시는 조건부 NO-GO.**

0원 정산과 역할 미지정 활성 계정을 정리하고, 배포 후보 SHA로 역할별 쓰기 E2E 및 정산 금액 정합성 검증을 통과한 뒤 GO 판정한다.

---

## 2026-07-31 UI·UX 페이지 규격 통합 검수

### 브라우저 비교 범위

- 배포본 데스크톱: 상품찾기, 재고관리, 계약진행, 계약문의, 월별정산, 회원·파트너, 정책관리, 설정, 감사·휴지통, 데이터점검.
- 모바일 390×844: 상품찾기, 계약문의, 계약진행, 재고관리, 설정, 월별정산, 회원·파트너.
- 공통 SSOT: `NAV_LABEL`, `WorkPage`, `MobilePageShell`, `PageToolBar`, `BottomNav`, UI tokens.

### 확인 결과

- 주요 B2B 업무 화면은 상단 상태창 → 검색/정렬/필터 → 목록 → 상세 패널 구조를 공통 `WorkPage`로 사용한다.
- 모바일 핵심 5탭은 상품찾기·계약문의·계약진행·재고관리·설정으로 통일되어 있다.
- 월별정산·회원 목록의 390px 화면에서 가로 넘침 없이 금액·상태·코드가 축약 표시된다.
- 색·폰트·컨트롤 토큰 검사에서 하드코딩 드리프트가 발견되지 않았다.

### 직접 수정

- 재고·계약·채팅·정책 화면에서 데이터 로딩 중 `0대/0건`을 먼저 표시하지 않도록 count를 미표시 처리했다.
- 상품찾기 엑셀형 결과 행에 키보드 포커스와 Enter/Space 상세 진입, 접근성 라벨을 추가했다.

### 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS
- `npm.cmd run check:tokens`: PASS
- `scripts/sim-phase12.mts`: 34/34 PASS

### 잔여 범위

- 브라우저 보안 정책으로 최신 로컬 `localhost:4004` 화면을 직접 열지 못해 시각 비교는 배포 SHA `d8b2f61` 기준이다.
- 수정 사항을 포함한 최종 배포 후보에서 데스크톱·390px 화면을 한 차례 재검수해야 한다.
- `감사·휴지통`, `데이터점검`은 실제 데이터 로딩 완료 화면과 오류/빈 상태를 최종 배포 후보에서 추가 확인한다.

### 판정

**공통 규격과 주요 페이지 UI는 CONDITIONAL PASS.** 최종 배포 후보 재검수 전까지 UI·UX 전체 GO로 확정하지 않는다.

---

## 2026-07-31 B2B 기능·UI 최종 릴리스 후보 판정

### 최종 보완

- 재고·계약·채팅·정책 화면은 로딩 중 잘못된 `0대/0건`을 노출하지 않는다.
- 상품찾기 엑셀 행은 마우스뿐 아니라 키보드 Enter/Space로 상세 진입할 수 있다.
- 0원 정산은 생성·확정이 차단되며 월별정산 목록과 상세에 `금액 확인` 경고가 표시된다.
- 공급사율 미확정 정산은 `요율 확인` 경고가 표시된다.
- 역할 미지정·알 수 없는 역할 계정은 인증 게이트에서 차단된다.

### 최종 게이트

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS
- `npm.cmd run check:tokens`: PASS
- `scripts/sim-*.mts` 13개 전부 PASS
- 정산 E2E: 17/17 PASS
- 출시 차단 회귀: 13/13 PASS
- Phase 1·2 UI/기능 회귀: 34/34 PASS
- production build: PASS, 30 routes
- `git diff --check`: PASS

### 판정

**B2B 기능·UI 릴리스 후보 GO.**

이 판정은 현재 소스의 기능·권한·정산 안전장치·공통 UI 규격과 빌드 가능성에 대한 것이다. 실제 공개 배포 후에는 배포 SHA 확인과 데스크톱/390px 스모크 테스트를 수행해야 최종 운영 GO가 닫힌다. `database.rules.json` 게시와 운영 데이터 직접 수정은 이 판정에 포함하지 않는다.

---

## 2026-07-31 배포 후 최종 운영 스모크

### 배포·CI

- UI 규격 마감 `5497a50`, CI 복구 `5a475c9`, 감사 표시 보정 `9630df7`을 `origin/main`에 푸시했다.
- GitHub Actions CI `30632586337`, `30632813325`: PASS.
- CI 게이트: 타입, 폰트, 디자인 토큰, 시트 병합, 차량 락, 정산 E2E, 출시 차단 회귀, production build 전부 PASS.
- Vercel 운영 URL에서 엑셀 결과 행 접근성 라벨과 감사 로그 대체 문구를 확인하여 최신 앱 코드 반영을 검증했다.

### 배포본 브라우저 스모크

- 데스크톱: 상품찾기, 재고관리, 계약문의, 계약진행, 월별정산, 회원·파트너, 정책관리, 감사·휴지통, 데이터점검, 설정 로딩 완료.
- 모바일 390×844: 상품찾기, 재고관리, 계약진행, 월별정산, 회원·파트너 로딩 완료.
- 모바일 핵심 화면에서 로딩 중 `0대/0건` 오표시 없음.
- 월별정산의 기존 0원 건에 `금액 확인` 경고 표시 확인.
- 감사 로그 구형 레코드의 `undefined` 노출이 `기록 대상 미기록`으로 변경됨을 확인.
- 상품찾기 엑셀 행이 접근성 트리에서 `상품 상세` 링크로 노출됨을 확인.

### 최종 판정

**B2B 웹 기능·UI 운영 GO.**

`database.rules.json` 신규 게시, 기존 0원 원천계약의 실제 금액 보정, 역할 미지정 계정의 운영 데이터 정리는 별도 사람 승인 작업이며 이번 배포에서 실행하지 않았다. 애플리케이션은 해당 비정상 상태의 신규 생성·접근·정산 확정을 차단하고 관리자 경고를 표시한다.

---

## 2026-07-31 — 출시 전 통합 QA 및 런칭 준비도 재검증

### 최종 판정

**FAIL (출시 차단)** — 코드·시뮬레이션 게이트는 통과했지만 `/terms`와 `/privacy`의 운영자 필수 정보가
전부 미기재 상태다. 상호·대표자·주소·사업자등록번호·문의 이메일·개인정보 보호책임자를 실제 정보로
입력하고 `npm run check:release`를 통과하기 전에는 정식 출시하면 안 된다.
또한 iOS·Android 네이티브 앱, 앱스토어 심사정보, 실결제·환불 사업자 연동, 실기기 호환성,
부하·장애복구 및 운영 모니터링은 이 저장소와 현재 검증 환경에서 증명할 수 없어 출시 담당자의 별도 확인이 필요하다.

### 발견 이슈 및 조치

| 심각도 | 플랫폼·화면 | 재현 및 실제 결과 | 기대 결과 | 조치·재검수 |
|---|---|---|---|---|
| 중요 | Web · 회원 승인/권한 변경 | 인증 모듈의 신원 변경 감사 로그가 운영 루트 `audit_logs`에 기록됨 | 운영 v3 노드는 쓰지 않고 `v4/` 오버레이에만 기록 | `lib/firebase/auth.ts`를 `v4/audit_logs`로 변경, 채팅·Rules 시뮬레이션 43/43 PASS |
| 일반 | 테스트 · 모바일 공통 UI | `sim-phase12`가 폐기된 IconBtn 전용 구현 문자열을 요구해 5건 실패 | 현재 SSOT인 IconSeg·PageActions·BottomNav·아이콘+라벨 구조 검증 | 회귀 가드를 현행 공통 컴포넌트 계약으로 갱신, 34/34 PASS |
| 일반 | 테스트 · 공급사 시트 | 헤더 자동탐지가 최소 3개 라벨을 요구하지만 fixture는 2개 라벨이라 실패 | 실제 표 형태와 동일한 유효 헤더를 사용 | fixture 보강, 시트 병합 20/20 PASS |

담당은 코드·테스트 모두 개발팀, 수정일과 재검수일은 2026-07-31이다. 운영자 정보 입력은 운영 책임자 확인이 필요하다.

### 요구사항별 결과

- UI·UX/디자인 시스템: 폰트 및 토큰 드리프트 0, 공통 모바일 패널·CRUD·툴바·목록복귀 회귀 가드 PASS.
- 핵심 사용자 시나리오: 영업자 39/39, 계약 Rules 25/25, 전자서명 57/57, 생애주기 PASS.
- 권한·보안·개인정보: 권한 44/44, 채팅 Rules 43/43, 공개/비공개 상품 분리 15/15,
  정산 private 분리 12/12, 감사 로그 v4 격리 PASS.
- 정산·데이터 정합성: 3자 정산 E2E 15/15, 차량 잠금 23/23, 시트 diff·병합·상태 매핑 PASS.
- 빌드·디자인 게이트: `typecheck`, `check:fonts`, `check:tokens`, 격리 production build 30개 route PASS.
- 웹 실화면: 로그인된 로컬 상품찾기에서 실데이터 346대 로딩, 접근성 이름 누락 0,
  1920px 화면 가로 오버플로 없음, 콘솔 warning/error 없음 확인.

### 웹·앱 규격 불일치 및 미검증 범위

- 이 저장소에서 확인되는 배포물은 Next.js 웹/PWA이며 별도 iOS·Android 네이티브 프로젝트는 확인되지 않았다.
  따라서 웹·iOS·Android 간 화면·푸시·백그라운드·업데이트 동작의 동등성은 판정하지 않았다.
- 실제 앱스토어·플레이스토어 메타데이터 및 심사 계정, 실결제·취소·환불 사업자 응답,
  대규모 동시접속, 네트워크 단절 복구, 장애 알림·롤백 훈련은 별도 운영 증빙이 필요하다.
- `database.rules.json`은 이번 검증에서 수정하거나 게시하지 않았다. 실제 게시 전에는 사람 또는 Claude가
  실데이터 역할별 write를 다시 확인해야 한다.

### 실행 근거

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS — 드리프트 0
- `npm.cmd run check:tokens`: PASS — 드리프트 0
- `scripts/sim-*.mts`: 전체 PASS
- `NEXT_DIST_DIR=.next-codex-final npm.cmd run build`: PASS — 30개 route
- `npm.cmd run check:release`: FAIL — 약관·개인정보 운영자 필수정보 6개 미기재
- 빌드가 임시로 변경한 `tsconfig.json`은 원상복구했다.

### 출시 전 필수 수동 게이트

1. `lib/legal.ts`의 운영자 필수정보 6개를 실제 정보로 입력하고 `npm run check:release`를 통과한다.
2. 현재 변경분을 검토·배포한 뒤 배포 SHA와 화면 버전이 일치하는지 확인한다.
3. 관리자·공급사·영업자 계정으로 회원 승인 변경 후 `v4/audit_logs` 생성 여부를 실데이터에서 확인한다.
4. Firebase Rules는 자동 게시하지 말고 역할별 정상 write/차단 시나리오를 실데이터로 확인한다.
5. 네이티브 앱이 별도 존재한다면 iOS·Android 실기기, 스토어 심사, 푸시·백그라운드 항목을 별도 완료한다.

---

## 2026-07-27 4역할 실계정·채팅 갱신·정산 격리 검증

### 판정

**PASS — 역할별 실제 금액 화면만 QA 정산 생성 후 최종 확인**

- 별도 QA 조직의 활성 계정 4종(영업채널 관리자·직원, 공급사 관리자·직원)으로 실제 Firebase Auth 로그인했다.
- 메뉴와 데이터 범위:
  - 영업채널 관리자는 채널 계약·채팅, 영업채널 직원은 본인 계약·채팅만 조회했다.
  - 공급사 관리자·직원은 자기 회사 재고·계약·채팅을 조회했다.
  - 반대 조직 코드 쿼리와 권한 밖 경로는 운영 RTDB Rules가 HTTP 401로 차단했다.
- QA 계약 `TMP-260727-01-yvjf`, 차량 `99하0727`, QA 문의방을 네 역할에서 확인했다.
- 공급사 직원→영업자, 영업자→공급사 메시지 송수신을 확인했다.
- 채팅 메시지 로딩 전 빈 대화 안내가 잠깐 보이던 상태를 로딩 상태로 분리했다.
- 방별 메시지 성공 결과를 영구 캐시하지 않고 동시 요청만 합치도록 변경했다.
- 열린 대화는 5초 주기·창 포커스·`fp:unread` 이벤트에 새 메시지를 다시 읽는다.
- 공급사 토큰으로 새 QA 메시지를 넣은 뒤 페이지 새로고침 없이 영업자 화면에 나타나는 것을 확인했다.
- 감사로그 쓰기/조회 경로를 운영 Rules가 허용하는 루트 `audit_logs`로 통일했고, 채팅 전송 시 새 `permission_denied` 경고 0건을 확인했다.
- 설정 페이지는 hydration 전에 localStorage 기반 `actor()`를 호출하지 않도록 바꿨고, 로그인 세션 이름 불일치 오류가 재발하지 않았다.

### 정산 private 운영 매트릭스

- 영업 직원의 자기 `settlements_agent_private` 쿼리: HTTP 200
- 영업채널 관리자의 자기 채널 `settlements_agent_private` 쿼리: HTTP 200
- 공급사 직원·관리자의 자기 회사 `settlements_provider_private` 쿼리: HTTP 200
- 영업→공급사 private, 공급사→영업 private, 네 역할→관리자 private: HTTP 401
- 전용 QA 정산 데이터는 아직 0건이므로 R1/R2 실제 숫자 화면 표시는 오픈 체크리스트에 잔여로 유지했다.

### 자동 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 폰트 드리프트 0
- `scripts/sim-*.mts` 12개: 전부 PASS
- `NEXT_DIST_DIR=tmp/verification-build/chat-live-20260727 npm.cmd run build`: PASS
  - 28개 라우트
- 개발 서버 PID `30312`, 포트 4004 유지 및 HTTP 200

---

## 2026-07-26 — Inventory 목록 계산 훅 검증

### 검증 결과

- 180ms 디바운스 검색 계약 유지
- 상태·상품구분 필터 의미 유지
- 상태 미등록 값의 후순위 처리 유지
- 상태 동률 시 차명 정렬 유지
- 차명·차번·코드 정렬 유지
- 모바일 드래프트는 즉시 검색어를 사용해 미리보기 건수 계산 유지

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- 전체 도메인 시뮬레이션 및 차량 마스터 검증: PASS

### 남은 위험

- Inventory 전용 UI 상호작용을 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트 크기가 18.5 kB에서 18.7 kB로 0.2 kB 증가했다.

### 최종 판정

**PASS**

---

## 2026-07-26 — Finder 결과 계산 훅 검증

### 검증 결과

- 기존 `useDeferredValue` 기반 무거운 필터 지연 유지
- 숨김 코드 제외와 패스 상품 후순위 배치 유지
- 최근·관심 합집합 필터 유지
- 명시 정렬과 기본 혜택 점수 정렬 유지
- 필터 드래프트 미리보기 건수 계산 유지
- 인기차종·카탈로그 노출 총계 유지
- 엑셀 열 필터와 숫자 정렬 유지

`app/page.tsx`는 최초 1,459줄에서 724줄로 줄었으며, 결과 계산은
`useFinderResults.ts` 183줄에 모였다.

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS
- git diff --check: PASS

### 남은 위험

- 실제 브라우저에서 빠른 연속 필터 조작과 엑셀 팝오버를 수동 검증하지 않았다.
- `/` 라우트 크기는 리팩터링 전 16.4 kB에서 현재 17.1 kB로 소폭 증가했다.
  기능 모듈 경계와 타입 안정성을 얻은 대가지만, 추후 번들 분석 대상이다.

### 최종 판정

**PASS**

Finder 대형 파일의 우선 분리 목표는 달성했다. 추가 분리는 페이지 상태 훅까지
확장할 수 있으나, 현재 724줄에서 위험 대비 효율을 다시 판단하는 것이 적절하다.

---

## 2026-07-26 — Finder 데이터 로딩 훅 검증

### 검증 결과

- `peekList` 기반 동기 초기값 유지
- Firebase 사용 시 `authReady` 이후 조회 유지
- 로그인 사용자 변경 시 재조회 유지
- 상품·공급사 병렬 조회 및 공급사명 결합 유지
- 15초 타임아웃과 실패 시 빈 목록 처리 유지
- 숨김·패스 목록의 초기 로드와 구독 해제 유지
- 보기 설정 복원을 데이터 조회와 분리해 인증 재조회 시 반복 부작용 제거

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS

### 최종 판정

**PASS**

다음 단계는 검색·필터·정렬 파생 계산을 `useFinderResults`로 이동하는 작업이다.

---

## 2026-07-26 — Finder 필터 패널 분리 검증

### 요구사항

- Finder의 대형 인라인 필터 패널을 독립 컴포넌트로 이동한다.
- UI, 필터 의미, 드래프트 적용·취소, 모바일 동작을 변경하지 않는다.
- props 전달 자체가 새로운 복잡도가 되지 않도록 명확한 경계를 만든다.

### 검증 결과

| 항목 | 결과 |
|---|---|
| 필터 패널 독립 컴포넌트 이동 | PASS |
| 페이지의 필터 상태 소유권 유지 | PASS |
| 드래프트/라이브 `bump()` 계약 유지 | PASS |
| 최근·관심 목록과 필터 스냅 동기화 유지 | PASS |
| 데스크톱·모바일 공통 패널 유지 | PASS |
| 정렬 라벨·기본 열림·초기화 동작 유지 | PASS |

`FinderFilterPanelModel` 하나가 패널의 표시 모델과 명령을 묶으며, 페이지 내부 상태
setter를 개별적으로 노출하지 않는다. `app/page.tsx`는 1,042줄에서 858줄로 줄었다.

### 전체 자동 검증

- typecheck: PASS
- build: PASS, 26개 페이지 생성
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS
- git diff --check: PASS

### 남은 위험

- 실제 브라우저에서 필터 패널의 접힘·스크롤·모바일 하단시트를 수동 시각 검증하지 않았다.
- 다음 구조 작업은 데이터 로딩과 검색·필터 결과 계산 훅 분리다.

### 최종 판정

**PASS**

---

## 2026-07-26 — Cursor 엑셀 결과 테이블 분리 검증

### 검증 기준

원래 사용자 요구사항:

- `app/page.tsx`의 대형 단일 파일을 기능 변경 없이 단계적으로 분리한다.
- 엑셀 결과 테이블을 `features/finder` 아래 독립 컴포넌트로 이동한다.
- UI, 필터 의미, 정렬, 열 너비, 모바일 동작을 유지한다.
- 다른 AI가 이어받을 수 있도록 구현·검증 문서를 갱신한다.

별도 `PLAN.md`는 없으므로 원래 요구사항, `docs/REFACTOR_PROGRESS.md`,
`IMPLEMENTATION_LOG.md`, 실제 diff를 함께 비교했다.

### 구현 대조 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 엑셀 테이블 분리 | PASS | `ExcelResultsTable.tsx`로 테이블·헤더·팝오버 조립 이동 |
| 필터 의미 유지 | PASS | 표시 행과 팝오버 후보 행을 기존처럼 `rows`/`list`로 분리 |
| 정렬 유지 | PASS | 가격·연식·주행거리 숫자 정렬 함수 유지 |
| 열 순서·너비 유지 | PASS | 기존 `EXCEL_*`, `colLock*`, `excel*Chars` 계산 그대로 이동 |
| 행 동작 유지 | PASS | 상세 이동·컨텍스트 메뉴를 기존 페이지 콜백에 위임 |
| 모바일 동작 유지 | PASS | 기존 `useIsMobile()` 기반 `is-fit` 조건 유지 |
| 인수인계 문서 | PASS | 구현 로그와 리팩터링 진행 문서 갱신 |

`app/page.tsx`는 최초 1,459줄에서 현재 1,042줄로 축소됐다.

### 독립 검증 중 발견·수정한 문제

`scripts/sim-vehicle-lock.mts`가 공급사 전용 단계를 영업자 역할로 호출해 전체
시뮬레이션 중 1건이 실패했다. 제품 엔진의 역할 차단은 올바르며 테스트 하네스가
현재 권한 정책을 반영하지 못한 문제였다.

수정 내용:

- 테스트용 `asRole()` 헬퍼 추가
- `provider_balance_confirmed`, `provider_delivery_response` 실행 시 공급사 역할 적용
- 실행 후 이전 역할을 항상 복원

제품 코드나 권한 정책은 완화하지 않았다.

### 전체 검증 결과

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, 26개 페이지 생성
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS, 마스터 ID 1,800개 검증
- `git diff --check`: PASS

---

## 2026-07-26 — 4개 업무 화면 UI/UX 배치 검증

### 판정

**PASS**

- 설정 관심·숨김 관리, 회원 목록, 계약 정산 요약, 채팅 방 목록을 feature 컴포넌트로 분리했다.
- 기존 역할별 표시, 빈 상태, 복구·초기화 액션, 정산 R1/R2 표시 규칙을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 설정·회원·계약·채팅: 모두 HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — RTDB 어댑터 데이터 계층 분리 검증

### 판정

**PASS**

- 레코드 변환과 상품 보안·중복 정책을 네트워크 어댑터에서 분리했다.
- 첨부 URL 이름 복원, 엔티티 자연키, 정책·계약 조인 결과를 유지했다.
- 공급 원가는 관리자 또는 본인 소유 공급사에만 보이는 정책을 유지했다.
- 카슝 제외 및 차량번호/VIN 실차 중복 제거 우선순위를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 주요 6개 화면: 모두 HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 회원 관리 필터·정렬 분리 검증

### 판정

**PASS**

- 사용자·파트너 목록 필터와 정렬을 순수 모듈로 이동했다.
- 승인대기는 정렬 선택과 관계없이 최상단에 놓이는 규칙을 유지했다.
- 승인 상태와 운영 활성 상태를 별도 필드로 판정하는 규칙을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/members`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 계약 목록 필터·정렬 분리 검증

### 판정

**PASS**

- 계약 필터·정렬·월 옵션을 순수 모듈로 이동했다.
- 진행 기본값의 완료 포함·취소 제외 규칙과 진행률 동률 시 최근 계약 우선을 유지했다.
- 누락된 월 라벨 공개 연결 1건을 타입 검사에서 발견해 수정했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/contract`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 채팅 목록 필터·정렬 분리 검증

### 판정

**PASS**

- 역할별 미확인·문의·완료·취소 판정과 정렬을 순수 모듈로 이동했다.
- 안읽음 동률 시 최근 메시지 우선과 드래프트 미리보기 집계를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/chat`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 채팅 방 색인·표시 분리 검증

### 판정

**PASS**

- 진행 계약과 취소 계약 색인을 분리한 기존 first-wins 규칙을 유지했다.
- product_code, product_uid, product_id, 차량번호 탐색과 삭제 차량 fallback을 유지했다.
- 관리자·공급사·영업 역할별 헤더 계산 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/chat`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 결과 본문 분리 검증

### 판정

**PASS**

- 빈 상태, 카드·상세·엑셀 결과와 페이징 UI를 `FinderResults`로 이동했다.
- 상품 열기·우클릭, Excel 필터/정렬 상태, 500대 표시 상한 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 상단 툴바 분리 검증

### 판정

**PASS**

- 모바일·웹 툴바를 `FinderToolbar`로 이동했다.
- 검색, 정렬, 필터 뱃지, 관심함, 엑셀 다운로드, 보기 전환 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 상품 컨텍스트 분리 검증

### 판정

**PASS**

- 상품 우클릭 액션 구성을 Finder 페이지에서 독립 모듈로 이동했다.
- 역할별 계약문의·공유 노출, 링크·내용 복사, 상세 이동을 유지했다.
- 복사 실패 fallback은 공통 오류 알림으로 현대화했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 정확 경로·감사·일괄 변환 분리 검증

### 판정

**PASS**

- 정확 경로 엔진과 운영 감사·일괄 변환 엔진을 별도 모듈로 이동했다.
- 기존 API는 얇은 호환 진입점으로 유지했다.
- 의존성 주입으로 매칭 본체와 운영 모듈 사이 순환 import가 없다.
- exact 경로, confidence 집계, 샘플 제한, auto/all 정책을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 신호·선택 보조 분리 검증

### 판정

**PASS**

- 원본 차량 신호 수집과 재스냅 입력 복원을 독립 모듈로 이동했다.
- 파워트레인 라벨·인승 분기·실트림 판정을 독립 모듈로 이동했다.
- 기존 export 호환과 매칭 알고리즘 결과를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 필터·탐색 분리 검증

### 판정

**PASS**

- 차량 5단 필터와 마스터 제조사·모델·세부모델 탐색을 leaf 모듈로 이동했다.
- 르노 표기 호환, 국산 우선 그룹, 한글 정렬, 기존 공개 import 경로를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 스냅 추적 분리 검증

### 판정

**PASS**

- 추적 키·라벨, 원본 캡처, 필드 diff, 이력 생성을 leaf 모듈로 이동했다.
- 최초 원본 유지, 변경 필드만 기록, 최근 10건 제한을 보존했다.
- `applySnap`의 업무 반영 정책과 기존 공개 import 경로는 변경하지 않았다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 표시·정규화 분리 검증

### 판정

**PASS**

- 연식·연료·제조사 표시와 연료 배기량 추출을 독립 모듈로 이동했다.
- 기존 공개 import 경로와 반환 규칙을 유지했다.
- 매칭 본체의 연료 정규화도 동일 leaf 모듈을 사용해 규칙 중복이 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 클립보드 공통화 검증

**PASS**

- `copyText`가 최신 Clipboard API 실패 시 호환 fallback을 수행한다.
- 임시 textarea는 성공·실패 모두 제거된다.
- 계약 링크와 재고 TSV 복사 실패가 오류로 표시된다.
- typecheck·전체 시뮬레이션 PASS
- 개발 서버 `/inventory`: HTTP 200
- 2차 적용 후 앱·컴포넌트의 직접 Clipboard API 호출 0건
- 실패 시 기존 prompt 또는 오류 toast fallback 유지

---

## 2026-07-26 — Cursor 가격·혜택 원자 분리 독립 검증

### 판정

**PASS (BOM 수정 후)**

- `product-card-pricing.tsx`: 가격 컨텍스트·기간·요금 UI 319줄
- `product-card-perks.tsx`: 혜택·이벤트·조건 UI 158줄
- `product-card-atoms.tsx`: 725줄 → 271줄
- pricing → perks → badges 단방향이며 barrel 역참조가 없어 순환 의존성 없음
- 기존 `product-card-atoms` export 경로 유지

### 발견 및 수정

- Cursor 저장 과정에서 `product-card-atoms.tsx` 시작에 UTF-8 BOM이 추가됨
- BOM 제거 완료

### 검증

- typecheck: PASS
- 전체 시뮬레이션·차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — 공통 확인창·알림 전환 검증

### 판정

**PASS**

- 계약, 정책, 회원, 재고, 개발 도구의 파괴적/중요 작업이 공통 `confirmDialog`를 사용한다.
- 로그인/가입 오류는 브라우저 기본 alert 대신 공통 error toast를 사용한다.
- `app`, `components`, `features` 범위에 직접 `window.confirm`·`window.alert` 호출이 남지 않았다.

### 실행 결과

- `npm run typecheck`: PASS
- `sim-agent`, `sim-lifecycle`, `sim-e2e-settlement`, `sim-vehicle-lock`, `sim-sheet-merge`, `sim-phase12`, `verify-master-pass`: 모두 PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버의 `.next` 충돌 방지를 위해 보류

로컬 시뮬레이션 중 Firebase 환경변수 누락 메시지는 기존 예상 경고이며 실패가 아니다.

---

## 2026-07-26 — 공통 UI 오버레이 분리 검증

### 판정

**PASS**

- `Drawer`, `Modal`을 `components/ui/overlays.tsx`로 이동했다.
- 기존 `@/components/ui` import 경로와 컴포넌트 API를 유지했다.
- 오버레이의 키보드 이동, 닫기, 모바일 풀스크린 표현 로직을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 차량 마스터 타입 분리 검증

### 판정

**PASS**

- 순수 도메인 타입 7종을 별도 파일로 이동했다.
- 기존 `vehicle-master-match.ts`의 type re-export를 유지해 모든 소비자와 스크립트가 호환된다.
- 실행 로직과 데이터 변환 결과에는 변화가 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 공통 UI 레이아웃 분리 검증

### 판정

**PASS**

- 레이아웃 원자 4종을 `components/ui/layout.tsx`로 이동했다.
- 공개 API, 스타일 토큰, 모바일 규격, VSplit 이벤트 정리·localStorage 동작을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 버튼 분리 검증

### 판정

**PASS**

- `Btn`, `IconBtn`, `IconSeg`를 `components/ui/buttons.tsx`로 이동했다.
- 기존 공개 API, 모바일 높이·패딩, disabled·접근성 속성, 스타일 오버라이드를 유지했다.
- leaf 버튼 모듈은 tokens와 모바일 훅만 참조하며 barrel 순환 의존성이 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 폼 입력 분리 검증

### 판정

**PASS**

- 기본 폼 입력 4종을 `components/ui/form-controls.tsx`로 이동했다.
- 공개 API와 모바일 입력 규격, 키보드·포커스 동작을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 리스트 분리 검증

### 판정

**PASS**

- `ListRow`, `ListBox`를 `components/ui/list.tsx`로 이동했다.
- 기존 공개 import 경로, props, 스타일 토큰 사용을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

Firebase 환경변수 누락 메시지는 localStorage 시뮬레이션에서 발생하는 기존 경고이며
검증 실패가 아니다.

### 남은 위험

- 실제 브라우저에서 엑셀 헤더 팝오버 위치와 가로 스크롤을 수동 시각 검증하지 않았다.
- `app/page.tsx`는 여전히 1,042줄이므로 필터 패널과 결과 계산 훅 분리가 남아 있다.
- `.claude/`는 이번 검증에서 생성·수정하지 않은 별도 미추적 디렉터리다.

### 최종 판정

**PASS**

Cursor의 엑셀 결과 테이블 분리는 원래 요구사항과 일치한다. 독립 검증에서 발견한
테스트 하네스 불일치도 수정했으며, 전체 자동 검증이 통과한다.

---

## 2026-07-26 — Finder 구조 분리

### 검증 기준

원래 사용자 요구사항:

- 대형 단일 파일을 분리한다.
- 다른 AI가 이어받을 수 있도록 진행 내용을 문서화한다.
- 기존 기능과 사용자 동작을 깨뜨리지 않는다.

별도의 Claude Code `PLAN.md`는 없었다. 따라서 사용자의 원래 요구사항,
`docs/REFACTOR_PROGRESS.md`, 실제 변경사항을 기준으로 검증했다.

### 요구사항 충족 여부

| 요구사항 | 결과 | 근거 |
|---|---|---|
| 대형 Finder 파일 분리 | PASS | 1,459줄에서 1,213줄로 축소, 3개 모듈로 책임 이동 |
| 인수인계 문서화 | PASS | 협업 규칙, 진행 메모, 구현 로그, 검증 문서 추가 |
| 동작 호환성 유지 | PASS | 타입 검사, 빌드, 핵심 시뮬레이션 통과 |

### 실제 변경

- `features/finder/filter-state.ts`
- `features/finder/excel-columns.ts`
- `features/finder/ExcelFilterPopover.tsx`
- `app/page.tsx`에서 위 책임 제거 및 import로 교체
- `docs/AI_COLLABORATION.md`
- `docs/REFACTOR_PROGRESS.md`
- `IMPLEMENTATION_LOG.md`
- `HANDOFF.md`

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, 26개 페이지 생성
- `npx.cmd tsx scripts/sim-agent.mts`: 37/37 PASS
- `npx.cmd tsx scripts/sim-phase12.mts`: 25/25 PASS
- `git diff --check`: PASS

### 회귀·보안·데이터 호환성

- Firebase 데이터 경로와 보안 규칙은 변경하지 않았다.
- `FilterBag` 필드와 sessionStorage 키를 유지했다.
- 엑셀 필터 다중값 OR 의미와 숫자 정렬 방식을 유지했다.
- 팝오버의 검색, 선택, 초기화, 정렬, 닫기 동작을 유지했다.
- 프로덕션 번들의 `/` 크기는 변경 전과 동일한 16.4 kB다.

### 남은 위험

- 브라우저에서 실제 팝오버 위치와 클릭 동작을 수동 시각 검증하지 않았다.
- `app/page.tsx`는 여전히 1,213줄이므로 추가 분리가 필요하다.
- Firebase 환경변수가 없는 localStorage 시뮬레이션에서는 기존 경고가 출력된다.
- 당시 `scripts/sim-vehicle-lock.mts` 역할 기대 불일치가 남아 있었으나, 위의 최신
  검증 단계에서 테스트 역할 설정을 수정해 23/23 통과로 해소했다.

### 최종 판정

**PASS**

현재 단계의 구조 분리는 원래 요구사항을 충족하며, 자동 검증 범위에서 회귀가 없다.

---

## 2026-07-26 — Inventory 편집 패널 분리 독립 검증

### 판정

**PASS**

`app/inventory/page.tsx`의 기본정보·운영정보 UI를
`features/inventory/InventoryEditorPanes.tsx`로 이동했다. 페이지에는 저장, OCR,
차종 마스터 적용과 같은 도메인 조정 로직을 남겨 UI 분리로 동작 계약이 바뀌지 않게 했다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 정적 페이지 26개 생성

### 독립 확인 사항

- 선택 여부, 신규/수정 모드, dirty 상태가 모델을 통해 그대로 전달된다.
- 마스터 선택 결과의 `applySnap(..., source: 'picker')` 처리는 페이지에 보존됐다.
- 가격·사진 변경은 기존처럼 폼 갱신과 dirty 설정을 함께 수행한다.
- 관리자 전용 필드와 공급사 정책 범위 필터가 유지됐다.
- Firebase 환경변수 누락 문구는 localStorage 시뮬레이션의 기존 경고다.

### 남은 위험

- 실제 브라우저에서 OCR 파일 선택, 사진 길게 누르기, 마스터 피커를 수동 검증하지 않았다.
- `/inventory` 라우트 크기가 18.8 kB에서 19.1 kB로 0.3 kB 증가했다.
  구조 분리 결과이며, 동적 로딩을 포함한 번들 최적화는 별도 후속 작업으로 남긴다.

---

## 2026-07-26 — Inventory OCR·차종 마스터 훅 분리 검증

### 판정

**PASS**

OCR와 차량 마스터 처리 책임을 `useInventoryVehicleTools.ts`로 이동했고,
`app/inventory/page.tsx`는 643줄에서 496줄로 축소됐다.

### 회귀 확인

- 선택 generation 가드 유지: 늦게 끝난 이전 선택 작업이 현재 폼을 덮지 않는다.
- exact 경로 및 high/medium 신뢰도 조건을 만족할 때만 자동 DB 패치한다.
- 색상 패치와 마스터 패치 모두 목록 캐시를 함께 갱신한다.
- 사용자 재매칭은 `source: 'manual'`, 피커 선택은 `source: 'picker'`를 유지한다.
- OCR는 `/api/ocr/extract` 계약과 빈 칸 우선 병합을 유지한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- OCR와 마스터 피커의 실제 브라우저 파일·클릭 흐름은 수동 검증하지 않았다.
- `/inventory` 라우트는 19.2 kB로 직전보다 0.1 kB 증가했다.

---

## 2026-07-26 — Inventory 편집 수명주기 분리 검증

### 판정

**PASS**

저장·삭제·편집 상태 전환을 `useInventoryEditorLifecycle.ts`로 분리했다.
페이지는 496줄에서 386줄로 축소됐다.

### 독립 확인 사항

- 공급사 소유권 검증과 귀속 코드 강제가 유지됐다.
- 차량번호 중복 검사에서 공백 제거 및 자기 상품 제외 조건이 유지됐다.
- `vehicleLockedBy` 결과가 저장 폼 상태보다 우선하며 계약 코드도 함께 각인된다.
- 삭제 전 `blockingContractFor`로 진행 계약 전체를 검사한다.
- 저장 실패 시 dirty 상태를 해제하지 않는다.
- 신규 취소는 선택 해제, 기존 수정 취소는 목록 원본 복원으로 동작한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- 저장 확인 알림과 삭제 확인창은 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트가 19.5 kB로 직전 대비 0.3 kB 증가했다.

---

## 2026-07-26 — Inventory 데이터·권한 초기화 분리 검증

### 판정

**PASS**

상품 로딩과 접근 제어 이벤트를 `useInventoryData.ts`로 이동했다.
`app/inventory/page.tsx`는 386줄에서 342줄로 축소됐다.

### 독립 확인 사항

- 상품과 파트너를 병렬 조회한 후 공급사 이름을 결합하는 순서를 유지했다.
- 공급사 역할의 `provider_company_code` 범위 제한을 유지했다.
- 최초 진입에서 시드·권한·정책·상품 순으로 준비한다.
- 마스터 로딩과 데스크톱 첫 상품 선택은 비동기로 실행한다.
- 역할 이벤트 리스너는 최신 선택 콜백을 ref로 참조해 불필요한 재등록을 방지한다.
- 모바일 역할 전환에서는 첫 상품을 자동 선택하지 않는다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- 역할 변경과 모바일/데스크톱 첫 선택 차이는 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트가 19.7 kB로 직전 대비 0.2 kB 증가했다.

---

## 2026-07-26 — Inventory 런타임·번들 후속 검증

### 판정

**자동 검증 PASS / 브라우저 수동 검증 보류**

### 확인 내용

- 실행 중인 로컬 서버의 `http://localhost:4004/inventory`: HTTP 200
- 응답 본문: 19,887 bytes
- production build의 `/inventory`: 19.7 kB, First Load JS 272 kB
- route 전용 JavaScript 파일: 51,983 bytes
- 공급사 시트와 차량 마스터 로더의 기존 지연 로딩 유지

### 번들 판단

구조 분리 과정의 소폭 증가는 새 대형 라이브러리 유입으로 확인되지 않았다.
현재 크기만 줄이기 위해 훅을 다시 합치지 않는다. 이후 최적화는 실제 사용자 성능 측정이나
명확한 예산 기준이 생겼을 때 동적 패널 로딩 등으로 별도 진행한다.

### 보류 사유

브라우저 제어를 연결하려 했으나 사용 가능한 브라우저 세션이 없었다. 따라서 다음 항목은
수동 확인이 남아 있다.

- 데스크톱 첫 상품 자동 선택
- 모바일 목록 우선 진입
- OCR 파일 선택 및 완료 표시
- 마스터 피커와 재매칭
- 사진 탭·길게 누르기
- 역할 변경 시 권한 게이트와 선택 초기화

---

## 2026-07-26 — Product card 옵션 원자 분리 검증

### 판정

**PASS**

옵션 파싱과 칩 UI를 `product-card-options.tsx`로 이동했다. 기존 barrel 역할을 하는
`product-card-atoms.tsx`에서 같은 이름을 재수출하므로 소비자 import 계약은 바뀌지 않았다.

### 확인 사항

- 빈 옵션의 `옵션미입력` 표시 유지
- 기본 카드의 최대 2개 표시와 말줄임 유지
- 엑셀 결과의 2줄 높이·간격 상수 유지
- 상세 화면의 전체 wrap 표시 유지
- ResizeObserver 해제 처리 유지

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `npm.cmd run build`: PASS, 26개 페이지
- `/`, `/inventory` 번들 표기 변화 없음

### 남은 작업

`product-card-atoms.tsx`는 1,037줄이다. 다음 안전한 경계는 가격 컨텍스트·기간 칩·요금
표시 묶음이다.

---

## 2026-07-26 — Product card 뱃지 원자 분리 검증

### 판정

**PASS**

뱃지 계산과 렌더링을 `product-card-badges.tsx`로 이동했다. 기존 파일은 내부 사용을
명시적으로 import하고 동일 이름을 재수출하므로 순환 의존성과 소비자 변경이 없다.

### 확인 사항

- 고객 화면에 차량 상태가 노출되지 않는 audience 게이트 유지
- 상태·상품·심사 순서 및 tone 유지
- 계약중 pulse와 solid variant 유지
- 축약 라벨 역변환을 포함한 tooltip 유지
- 혜택별 설명과 연령 숫자 설명 유지

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `npm.cmd run build`: PASS, 26개 페이지
- 주요 route 번들 표기 변화 없음

### 다음 경계

`product-card-atoms.tsx`는 929줄이다. 가격 컨텍스트와 기간·요금 표시 묶음을 다음
분리 대상으로 유지한다.

---

## 2026-07-26 — Product card 기간별 요금 분리 검증

### 판정

**자동 검증 PASS / production build 보류**

`PriceMini`와 `PriceFare` 묶음을 `product-card-fares.tsx`로 이동했고 기존 공개 경로를
재수출로 유지했다. `product-card-atoms.tsx`는 929줄에서 843줄로 축소됐다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 실행하지 않음

### 빌드 보류 이유

Next 개발 서버와 production build가 같은 `.next`를 사용하면 실행 중 서버가 500으로
깨질 수 있다. 사용자의 서버 유지 요청에 따라 작업 중에는 build를 실행하지 않고,
서버를 내려도 되는 시점에 최종 build를 수행한다.

---

## 2026-07-26 — Product card 차량 신원·제원 분리 검증

### 판정

**자동 검증 PASS / 서버 유지**

- `idParts`, `idMobile`, `cardTitle`, `specLine`, `specLineCard`를
  `product-card-identity.ts`로 이동했다.
- 제조사 표준 표시, 무트림 라벨 제외, 연료 내장 배기량 fallback을 유지했다.
- 카드 고정 슬롯의 누락값 `-` 표시를 유지했다.
- 기존 `product-card-atoms` import 경로를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — Product card 뱃지 UI 분리

**PASS**

- 상품구분 뱃지와 상태·상품·심사 레일을 `product-card-badge-view.tsx`로 이동
- audience 게이트, 표시 순서, pulse, dense 폭 유지
- typecheck·전체 시뮬레이션 PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Product card 신원 UI 분리 검증

### 판정

**PASS**

- `Plate`, `CardTitle`을 `product-card-identity-view.tsx`로 이동했다.
- 폰트, 말줄임, tooltip, 차량번호 monospace 표현을 유지했다.
- 순수 문자열 모듈이 UI 컴포넌트를 import하지 않는 방향을 유지했다.
- 기존 공개 import 경로는 재수출로 호환된다.

### 실행 결과

- typecheck: PASS
- 전체 시뮬레이션·차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — 전자서명 링크 만료·폐기 검증

### 판정

**자동 검증 PASS / Firebase 배포 검증 보류**

- 새 링크는 기본 7일 만료 시각을 가진다.
- 유효 링크 재발송은 토큰을 유지하고, 만료·폐기 링크 재발급은 새 토큰을 만든다.
- 익명 읽기·서명 제출은 유효한 발송 링크에만 허용된다.
- 계약 소유자·채널 관리자·플랫폼 관리자는 만료·폐기 링크 상태를 확인할 수 있다.
- 만료 시각은 생성 시각 이후, 최대 30일 이내이며 생성 후 임의 변경할 수 없다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 23/23 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

### 남은 운영 검증

- 현재 환경에는 Firebase 설정이 없어 실제 Rules 배포·에뮬레이터 검증을 수행하지 않았다.
- 규칙 게시 후 익명 서명자, 계약 소유 영업자, 채널 관리자, 플랫폼 관리자 계정으로 역할별 스모크가 필요하다.

---

## 2026-07-26 — 전자서명 토큰·비활성 링크 앱 경계

### 판정

**PASS**

- Web Crypto로 192비트 난수 토큰을 생성한다.
- 폐기 상태만 있고 폐기 시각이 없는 불완전 레코드도 비활성 처리한다.
- Firebase 공개 조회와 로컬 저장소 fallback 모두 만료·폐기 링크를 반환하지 않는다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 26/26 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 승인 상태 전이

### 판정

**자동 검증 PASS / Firebase 배포 검증 보류**

- 발송 상태 또는 서명·동의가 빠진 검토대기는 도메인 승인 조건에서 거부된다.
- v4 계약 Rules는 공개 슬롯의 계약코드, 검토대기 상태, 서명, 동의를 승인 근거로 확인한다.
- 영업자가 약정발송 단계를 진행할 때 공개 슬롯의 최종 `signed` 상태를 요구한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 33/33 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 필수 동의 증적

### 판정

**자동 검증 PASS / Firebase 배포 검증 보류**

- 필수 동의 5개가 고정 ID와 순서로 정규화된다.
- 하나라도 누락된 동의 배열은 제출 전에 거부된다.
- 익명 쓰기는 정확한 동의 문자열과 `v1` 버전을 모두 요구한다.
- 기존 한글 동의 증적은 승인 단계에서 계속 인정된다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 37/37 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 공개 제출 데이터 검증

### 판정

**자동 검증 PASS / Firebase 배포 검증 보류**

- 정상 성명·연락처·PNG 서명·필수 동의 제출은 허용된다.
- 짧은 연락처, SVG 서명, 600KB 초과 서명은 도메인에서 거부된다.
- Rules는 PNG data URL 접두사와 최근 제출 시각을 요구한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 43/43 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 증적 확정·공개 개인정보 정리

### 판정

**자동 검증 PASS / Firebase 통합 검증 보류**

- 공개 슬롯의 서명·동의·본인확인 필드가 관리자 검토 객체에 모두 병합된다.
- 승인된 계약 원본에는 서명·동의·신원 증적이 보존된다.
- 서명 완료 공개 슬롯에서는 제출 개인정보와 서명 데이터가 삭제된다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 49/49 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

### 남은 검증

- Firebase 환경에서 익명 제출 → 영업자 승인 → 계약 원본 증적 확인 → 공개 슬롯 개인정보 삭제를 실제 계정으로 확인해야 한다.

---

## 2026-07-26 — 전자서명 승인 중간 실패 복구

### 판정

**PASS**

- 서명완료이지만 약정발송이 누락되고 유효 증적이 남은 상태만 복구 대상으로 판정한다.
- 이미 완료된 계약과 증적이 없는 계약은 복구 대상에서 제외된다.
- 복구 실행은 계약 증적 저장을 반복하지 않고 후속 단계만 재시도한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 52/52 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 링크 해지 실패 안전성

### 판정

**PASS**

- 공개 슬롯을 계약 원본보다 먼저 폐기한다.
- 폐기 패치는 `revoked` 상태, 폐기 시각, 기존 만료 시각을 보존한다.
- 두 단계 사이 실패 시에도 공개 링크가 활성 상태로 남는 방향을 피한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 55/55 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 공개 개인정보 최소화

### 판정

**PASS**

- 신규 공개 슬롯에 계약 원본의 고객 이름과 전화번호가 포함되지 않는다.
- 반려 후 재서명 공개 슬롯에서 이전 제출 개인정보와 서명 증적이 제거된다.
- 계약 원본과 관리자 검토 데이터는 삭제하지 않는다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 57/57 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 오픈 준비 로컬 릴리스 게이트

### 판정

**로컬 코드 게이트 PASS / 운영 Firebase 게이트 대기**

- 개발 서버를 잠시 종료하고 `npm.cmd run build` 성공: 26개 페이지
- 빌드 후 포트 4004 개발 서버 복구
- typecheck·폰트 검사·전체 시뮬레이션·차량 마스터 전수검증 PASS
- 실행 서버 주요 22개 경로 HTTP 200
- 로컬 Firebase 필수 환경변수 6종 설정 확인
- Vercel Production·Preview Firebase 환경변수 8종 설정 확인
- 자차 면책 비율형·정액형 표시 변경은 build와 전체 회귀검사를 통과

### 남은 오픈 차단 항목

- 완료 계약 없는 출고불가 3대의 의도된 상태 확인
- 관리자 외 4역할 실제 계정 권한 테스트
- 전자서명 반려·해지·만료 실브라우저 테스트
- Vercel production 배포

단일 실행 문서는 `OPENING_CHECKLIST.md`를 따른다. 추가 리팩터링은 오픈 후 범위로 동결한다.

---

## 2026-07-26 — Cursor 오픈 전 실사용 QA 독립 검증

### 판정

**PASS / 실제 브라우저 연타 검증만 수동 잔여**

- 채팅 전송·첨부, 계약 단계, 서명 제출, 회원 저장·승인, 재고 저장, 비밀번호 메일에 중복 실행 방지와 오류 피드백 적용
- 설정 연락처 포맷 통일
- 회원 private 요율 저장 후 enrich된 행으로 상세 폼 재주입
- Firebase Rules·스키마·마이그레이션·전자서명 상태기계 변경 없음

### 실행 결과

- typecheck·폰트 검사: PASS
- 전체 권한·채팅·계약·서명·정산·생애주기·차량잠금 시뮬레이션: PASS
- 상품·정산 private 마이그레이션 계획 시뮬레이션: PASS
- 차량 마스터 전수검증: PASS
- production build: PASS, 26개 페이지
- 서버 복구 후 `/`, `/inventory`, `/chat`, `/contract`, `/settlement`, `/members`, `/settings`, `/sign/invalid-test-token`: HTTP 200
- `git diff --check`: PASS

### Chrome 실브라우저 후속 검증

- localhost ERP4 탭 연결 및 화면 제어 성공
- 상단 사용자 표시: `박영협`
- 390×844 모바일 뷰포트에서 `/inventory`, `/chat`, `/contract`, `/settlement`, `/settings` 가로 넘침 없음
- DevTools JavaScript error 없음
- `products_private`, `settlement private` 조회의 `Permission denied` 경고 반복
- 설정 화면에 프로필 입력란 없이 `로그인` 버튼이 표시되어 Firebase 인증 세션은 확인되지 않음

### 잔여 수동 검증

- 실제 쓰기를 만드는 빠른 연타·Enter 반복은 운영 데이터 부작용을 피하기 위해 실행하지 않았다.
- Firebase Rules 게시 후 실제 5역할 계정으로 private 조회와 쓰기 중복 방지를 확인한다.

---

## 2026-07-26 — 연결 브라우저 운영형 E2E 추가 검증

### 실제 확인

- 관리자 계정(`박영협`, 플랫폼 관리자)으로 회원·파트너 화면 진입: PASS
- 회원 146명, 승인대기 1명 및 역할 관리 화면 표시: PASS
- 재고 428대 로딩, 상품 신규 등록·취소 시 미저장 초안이 남지 않음: PASS
- G: 드라이브의 실제 자동차등록증 PDF 원본 존재 확인: PASS
- OCR 결과가 정상 추출됐다고 가정하고 다음 QA 상품을 실제 저장:
  - 차량번호 `66소6317`
  - 기아 카니발 KA4, 디젤 2.2, 9인승, 2,151cc
  - 출고가능 / 중고렌트
  - 12개월 월 890,000원 / 보증금 3,000,000원
  - 메모 `[QA 20260726] OCR 정상 추출 가정 E2E 시뮬레이션`
- 저장 후 `66소6317` 검색 결과 1건 및 입력값 재표시: PASS

### 분리된 검증 항목

- OCR 정확도와 파일 업로드는 사용자 직접 검증 항목으로 분리했다.
- 원본 등록증 PDF는 수정·이동·삭제하지 않았다.

### 발견한 차단 문제

- `/contract` 직접 진입 시 Next.js 개발 서버에서
  `Invariant: Expected clientReferenceManifest to be defined` 런타임 오류가 재현됐다.
- 오류 후 `/inventory`, `/members`는 HTTP 200을 반환하지만 연결 브라우저에서
  인증 컨텍스트가 `불러오는 중…` 상태로 복구되지 않았다.
- 실행 중인 4004 서버는 중단하거나 재시작하지 않았다.
- 따라서 이번 연결 세션에서는 상담·계약·서명·정산 실제 쓰기와 QA 상품 삭제를
  이어서 수행하지 못했다. 관리자 인증 재연결 후 동일 상품으로 계속 검증한다.

### 개발 서버 번들 장애 및 복구

- 증상: 로그인 직후 홈 화면 CSS 미적용, `/members` 백지 화면.
- 확인: 기존 4004 HTML이 참조한 `layout.css`와 App Router 페이지 청크가 404를 반환했다.
- 원인: OCR 확인용 보조 Next 개발 서버가 기존 4004 서버와 같은 `.next` 디렉터리를
  사용해 디스크 번들과 기존 프로세스의 메모리 상태가 어긋난 것으로 판단했다.
- 조치: `NEXT_DIST_DIR`로 보조 서버의 빌드 디렉터리를 분리할 수 있도록 설정하고,
  Next 설정 변경 감지에 의한 자체 재기동으로 4004를 복구했다.
- 복구 확인:
  - 홈 CSS 및 상품 395대 표시: PASS
  - 관리자 `박영협` 인증 유지: PASS
  - 회원·파트너 146건 표시: PASS
  - `/contract` HTTP 200, 참조 정적 자산 10개 전부 HTTP 200: PASS

### 2026-07-27 재검토

- `/`, `/inventory`, `/members`, `/chat`, `/contract`, `/settlement`: HTTP 200
- `git diff --check`: PASS
- TypeScript `tsc --noEmit`: PASS
- 폰트 토큰 드리프트: 0
- 권한 시뮬레이션: 44/44 PASS
- 채팅 Rules 시뮬레이션: 40/40 PASS
- 계약 Rules 시뮬레이션: 23/23 PASS
- 계약 전자서명 Rules 시뮬레이션: 57/57 PASS
- 3자 정산 E2E 시뮬레이션: 15/15 PASS
- 전체 생애주기 시뮬레이션: PASS
- 차량 잠금·중복계약 방지 시뮬레이션: 23/23 PASS

자동 검증은 통과했지만 실제 역할별 계정으로 회원가입·승인·배정·채팅·계약·서명·
정산서 출력까지 수행하는 브라우저 운영 E2E는 아직 완료되지 않았다. 이 항목을
오픈 전 최종 잔여 검증으로 유지한다.
## 2026-07-27 — Firebase Storage 원본 + Google Drive 백업 독립 검증

### 판정

**Storage 운영 활성화 PASS / Drive OAuth·실제 helper 업로드 PASS**

- 신규 상품 사진·계약 서류·채팅 파일은 RTDB data URL 대신 Firebase Storage를 사용한다.
- 상품·계약은 Drive 백업을 시도하고 채팅은 Storage에만 저장한다.
- Drive 설정 누락·백업 실패가 Storage 원본을 제거하거나 업무 저장을 취소하지 않는다.
- 계약·채팅 레코드 저장 실패 시 직전 Storage 업로드를 정리한다.
- 상품 편집 취소 시 신규 업로드를, 저장 성공 시 제거된 기존 사진을 정리한다.
- ERP 삭제는 Storage 원본만 삭제하고 Drive 사본은 복구용으로 보존한다.
- 레거시 data URL은 계속 표시한다.

### 자동 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-*.mts` 12개: 전부 PASS
  - 영업자 39/39, 권한 44/44, 채팅 Rules 40/40
  - 계약 Rules 25/25, 전자서명 57/57, 3자 정산 15/15
  - 생애주기, Phase 1·2 25/25, private 마이그레이션 15/15·12/12
  - 시트 병합 12/12, 차량 잠금 23/23
- `NEXT_DIST_DIR=.next-storage-verification npm.cmd run build`: PASS
  - 28개 라우트, `/api/drive-backup` 포함
- Firebase Storage Emulator 15.24.0: `storage.rules` 로드·컴파일 PASS
- 공유 버킷의 V3 `product-images`, `contract-files`, `notice-images`, `user-docs`,
  `contract-signed`, `contract-unsigned`, `chat-files` 규칙을 원본과 대조해 보존
- 실행 서버: `/`, `/inventory`, `/chat`, `/contract` HTTP 200
- `/api/drive-backup`: 서버 재시작 후 HTTP 200, `{"enabled":true}` 확인
- `git diff --check`: PASS

### 운영 적용 결과

- `freepasserp3.firebasestorage.app`에 V3 호환 + V4 `/erp` Rules 게시 완료.
- 운영 Rules release ruleset:
  `projects/freepasserp3/rulesets/9a8cdcea-56e9-48f5-bcd9-445a63d0ebb2`
- 게시 전 V3 Rules는 `storage.rules.PREV`에 보존했다.
- Google Drive API를 `freepasserp3` 프로젝트에서 활성화했다.
- `drive.file` 최소 권한으로 앱이 직접 만든 Drive 루트 `FreepassERP4 자동백업`
  (`1KT0jDkm3yYFpcYWnv6-kJQutIhZwEum3`)을 로컬 환경변수에 설정했다.
- OAuth 앱 정책 동의, 테스트 사용자, 데스크톱 클라이언트, 오프라인 refresh token 발급을 완료했다.
- Vercel Production·Preview에 Drive 환경변수 4종이 모두 암호화 상태임을 확인했다.
- refresh token으로 새 access token을 발급한 뒤 확인 파일 업로드에 성공했다.
- 실제 서버 helper `uploadDriveBackup`으로
  `상품/DRIVE-CONNECTION-TEST/2026-07-27T04-01-50-914Z_connection-check.txt`를
  생성해 폴더 탐색·생성·multipart 업로드까지 확인했다.
- 관리자·영업자·공급사 계정별 실제 사진·계약서 업로드와 ERP 삭제 후
  Storage 원본 삭제·Drive 사본 보존·수동 복구는 최종 운영 E2E 항목으로 남긴다.
- Storage download URL은 capability URL이다. RTDB 업무 범위가 URL 발견을 제한하지만
  URL 자체의 외부 전달까지 막지는 못한다. 계약 개인정보의 강한 차단은 인증 다운로드 프록시가 후속 과제다.

### 개발 서버 복구 기록

- 별도 production 빌드는 성공했으나 ignored 산출물 정리 명령이 실행 중 `.next` 캐시까지 정리해
  기존 서버가 일시적으로 500을 반환했다.
- 소스와 Firebase 운영 데이터는 변경되지 않았다.
- 손상 캐시는 `tmp/server-recovery/`로 보존하고 4004 개발 서버를 재기동했다.
- Drive 환경변수 반영을 위해 4004 서버만 짧게 재시작했다.
- 최종 리스너 PID는 `30312`이며 `/api/drive-backup` HTTP 200과 `enabled:true`를 확인했다.

## 2026-07-27 — 회원·파트너 목록 규격 통일 검증

### 판정

**PASS**

- 회원·파트너 목록을 재고와 같은 아이콘 + 3줄 피드 행, 첫 행 신규 등록,
  검색 결과 조건 해제, 100명 단위 더보기 규격으로 통일했다.
- 사용자 151명에서 첫 100명과 `더보기 · 51명`, 승인대기 1명, 역할·활성 표시를 확인했다.
- 파트너 38명에서 V3 `provider`·`sales_channel`이 공급사·영업채널로 표시되는지 확인했다.
- 공급사 필터에서 V3 `provider` 항목은 남고 영업채널 항목은 제외되는지 확인했다.
- 기존 좌측 목록/우측 상세, 모바일 목록→상세 전환, 저장·승인·삭제 동작은 변경하지 않았다.
- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-*.mts` 12개: 전부 PASS
- `NEXT_DIST_DIR=.next-verification-20260727-members npm.cmd run build`: PASS
  - 28개 라우트, `/members` 8.76kB, `/api/drive-backup` 포함
- 실행 중인 `.next`와 분리한 빌드 산출물은 `tmp/verification-build/members-20260727/`에 보존했다.

---

## 2026-07-27 — 회원·파트너 및 월별 정산 4프레임 검증

### 판정

**PASS**

- 공통 화면 정의를 `목록 1 + 업무 패널 3 = 데스크톱 4프레임`으로 확정했다.
- 회원·파트너 전환을 검색·역할/유형 필터보다 상위인 목록 헤더로 이동했다.
- 회원·파트너 상세를 기본정보, 권한/정산, 영업/연동의 3개 독립 패널로 분리했다.
- 월별 정산을 월 선택 가능한 실제 정산 목록과 3개 상세 패널로 재구성했다.
- 월 집계는 검색·상태 필터와 무관하게 선택 월 전체 레코드를 기준으로 유지했다.
- 기존 정산 XLSX 가져오기, 정산서 다운로드, VAT 정산서 편집 기능을 보존했다.

### Chrome 실데이터 상호작용

- `/members` 사용자 목록: 151명, 사용자/파트너 탭이 역할 필터 위에 표시됨
- 사용자 선택: `기본정보 | 소속·권한 | 영업설정` 표시, 승인대기 동작 노출
- `/members` 파트너 전환: 38명, `기본정보 | 정산·운영 | 데이터연동` 표시
- `/settlement`: `월별정산 | 정산 상세 | 금액·지급 | 2026-07 집계` 4열 표시
- 2026-07 정산 1건 선택:
  - 계약번호·계약일·계약자·차량·공급사·영업자·영업채널 표시
  - 월대여료 890,000 / R1 89,000 / R2 35,600 / 순수익 53,400 표시
  - 월 집계와 공급사별 소계 표시
- VAT 정산서 오버레이 진입 및 월별 정산 화면 복귀 PASS
- `/members`, `/settlement` HTTP 200

### 자동 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-*.mts` 12개: 전부 PASS
  - 영업자 39/39, 권한 44/44, 채팅 Rules 40/40
  - 계약 Rules 25/25, 전자서명 57/57, 3자 정산 15/15
  - 생애주기 PASS, Phase 1·2 25/25
  - 상품 private 15/15, 정산 private 12/12
  - 시트 병합 12/12, 차량 잠금 23/23
- `NEXT_DIST_DIR=tmp/verification-build/four-panel-20260727 npm.cmd run build`: PASS
  - 28개 라우트
  - `/members` 9.03kB
  - `/settlement` 10.1kB
- Next 빌드가 추가한 임시 `tsconfig.json` include/포맷 변경은 원상복구했다.
- 실행 중 개발 서버의 `.next`는 건드리지 않았고 PID `30312` 유지.

---

## 2026-07-28 — 계약 규격 복구 및 모바일 아이콘 버튼 통일

### 변경

- 계약 목록 위에 임의로 추가됐던 `대기·완료·환수·순수익` 요약줄과
  `features/contract/SettlementSummary.tsx`를 제거했다.
- 계약 화면은 다시 `목록 1 + 업무 패널 3`만 표시하며, 정산 집계는 월별 정산 화면에서 담당한다.
- 공통 뒤로가기, 검색 초기화, 패널 전환, 하단 CRUD, 채팅 전송 버튼을 모바일에서
  아이콘 전용으로 표시하고 모든 버튼에 접근성 이름을 유지했다.
- 계약 승인·상태 변경처럼 오동작 위험이 있는 업무 버튼, 앱 하단 내비게이션,
  카테고리·상태 선택은 의미 전달을 위해 텍스트 라벨을 유지했다.
- `scripts/sim-phase12.mts`에 계약 요약줄 재삽입 방지와 공통 모바일 아이콘 규격 검사를 추가했다.

### 확인

- 브라우저 `/contract`: 규격 외 요약줄 미표시, 계약 목록과 3개 업무 패널 정상 표시
- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-phase12.mts`: 30/30 PASS
- `scripts/sim-*.mts` 12개: 전부 PASS
- `NEXT_DIST_DIR=tmp/verification-build/mobile-icons-20260728 npm.cmd run build`: PASS
  - 28개 라우트
  - `/contract` 4.68kB, `/chat` 8.45kB, `/settlement` 10.5kB
- production build가 추가한 임시 `tsconfig.json` include/포맷 변경은 원상복구했다.
- 모바일 아이콘 분기는 `useIsMobile()` 내부에 한정하고 데스크톱 텍스트 버튼은 유지했다.

---

## 2026-07-28 — 모바일 표면 액션 아이콘 전용 2차 통일

### 변경

- 위 절의 “계약 승인·상태 변경은 모바일 텍스트 유지” 판단은 사용자 지시에 따라 폐기했다.
- 공통 `Btn.mobileIcon`으로 모바일은 아이콘, 웹은 기존 텍스트를 렌더링한다.
- 계약·전자서명·정산, 재고·OCR·시트 연동·사진, 채팅, 회원 승인, 설정,
  관심함, 목록 초기화·더보기·전체보기 액션을 모바일 아이콘 전용으로 통일했다.
- 모바일 상품·계약 엑셀, 월정산 정산서, 재고 종합표 내보내기를 노출하지 않는다.
- 선택 칩·탭·확인 대화상자는 텍스트를 유지한다.

### 확인

- 브라우저 `/contract`: 웹 계약 액션 텍스트와 4프레임 유지
- 브라우저 `/settings`: 웹 저장·비밀번호 변경 텍스트 유지
- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-phase12.mts`: 33/33 PASS
- `scripts/sim-*.mts` 12개: 전부 PASS
- `NEXT_DIST_DIR=tmp/verification-build/mobile-icon-actions-20260728 npm.cmd run build`: PASS
  - 28개 라우트
  - `/contract` 4.73kB, `/inventory` 22.6kB, `/members` 9.22kB
- production build가 추가한 임시 `tsconfig.json` include/포맷 변경은 원상복구했다.
- 실행 중 개발 서버는 재시작하지 않았다.

---

## 2026-08-03 — 계약보호 충돌 및 계약 필터 브라우저 재검수

### 계약·재고 정합성

- `scripts/audit-v3-only-sheet-coverage.mts --show-protected`를 운영 Firebase·Google Sheet 읽기 전용으로 실행했다. 운영 write는 0건이다.
- 계약보호 3행은 차량 `54나7852` / 계약 `TMP-260712-01` 한 사건의 반복 확장이다. 직전 6행은 감사 스크립트가 v3/v4 overlay를 중복으로 센 거짓 양성이었다.
- 최신 Sheet 소유자 `RP021`과 진행 계약 공급사 `PT-0024`가 충돌한다.
- 계약은 2026-07-12 생성, 2026-07-13 마지막 갱신, `계약요청`, `agent_delivery_inquiry`만 완료, 서명 없음, 연결 방 3개 메시지 0건이다.
- 자동 만료 정책이 없으므로 계약 취소·공급사 변경·재고 병합은 수행하지 않았다. 운영 확인 전 해당 차량은 동기화 자동수정 금지다.

### 브라우저 UI

- Chrome의 최신 로컬 앱 `/contract`를 영업자·공급사 둘러보기 역할로 직접 검수했다.
- 계약월·업무단계 `FilterGroup`에서 `aria-expanded`가 JSX 텍스트로 노출되는 결함을 발견하고 실제 버튼 속성으로 수정했다.
- 수정 후 브라우저 접근성 이름은 `계약월`, `업무단계`로 정상화됐고 접기 동작 후 `aria-expanded=false`를 확인했다.
- `check:ui`에 JSX 텍스트 `aria-*=` 회귀 차단을 추가했다.
- `npx tsc --noEmit`: PASS.
- `npm run check:ui`, `check:fonts`, `check:tokens`: PASS.
- `scripts/sim-work-list-semantics.mts`: 142/142 PASS.
- `NEXT_DIST_DIR=tmp/verification-build/launch-ui-a11y-20260803 npm run build`: 30 routes PASS.
- 후보 Rules 기준 `check:release`: 법적 운영자 정보 6필드만 차단, PWA 2개 경고.

## 2026-08-03 — Sheet 충돌 감사 거짓 양성 제거

- `scripts/audit-v3-only-sheet-coverage.mts`의 재고 입력을 실제 앱·일일동기화와 같은 `product_code` 논리키 overlay 병합으로 수정했다.
- 기존 활성 중복 97건/195행은 `v3 EXT_*`와 `v4 공급사_차번`을 별도 상품으로 센 감사 도구 오류였으며 최신 기준 0건이다. 운영 데이터 삭제는 필요하지 않다.
- 최신 실제 차단은 공급사 소유 39, 삭제 재등장 58, 미확정 삭제 8, 번호미정 변경 1, 임시번호 서명 7, 가격기간 누락 97건이다.
- `--show-conflicts=RP021`은 충돌을 차량 단위로 묶고 Sheet 소유자, 실제 저장키, 계약·채팅·견적 참조, private 존재 여부만 출력한다. 값과 PII는 출력하지 않는다.
- RP021 24대 중 22대는 과거 공급사 private 보존 필요, 1대는 기존 채팅 이력, 1대는 진행계약 보호다. 최신 Sheet 소유자는 모두 RP021이다.
- 과거 공급사 공개 상품의 v4 tombstone과 private·이력 원키 보존은 타당한 후보지만 데이터 정책 승인 전 실행하지 않았다.
- 중복 이관 판정에서 `계약철회`를 종료 상태에서 제거해 미결 계약 보호로 통일했다. `sim-product-duplicate-migration` 26/26 PASS, `sim-sheet-merge` 125/125 PASS, typecheck PASS.

## 2026-08-03 — 가격기간 차단 97건 사용자 영향 분해

- 운영 Firebase와 16개 공급사 Sheet를 다시 읽기 전용 대조했다. 운영 write는 0건이다.
- 가격기간 누락 97대는 RP023 90대, RP018 7대다. RP004 54행은 가격 문제가 아니라 삭제 재등장 상세 작업량이다.
- RP023은 과거 `12_3만`, `18_2만`, `24_2만`, `36_2만` 등 주행거리 변형키가 현재 오토플러스 표준키와 일부 변형키 조합으로 바뀌었다. 과거 키를 단순 보존하면 현재 가격과 섞일 수 있다.
- 실제 `priceList` 사용자 선택 규칙으로 비교한 결과 70대는 기본가격이 달라지고 27대는 계약기간 자체가 하나 이상 사라진다. 삭제 기간 집계는 18개월 20대, 12개월 16대, 24개월 9대이며 한 차량이 여러 기간에 포함될 수 있다.
- 진행계약과 겹치는 가격 충돌은 RP023 `195주5304` / `TMP-260722-01` 1대다. 운영자가 계약과 새 가격 적용을 결정하기 전 자동수정 금지다.
- 관리자 `상세 충돌 TSV`에 `가격영향`과 `영향기간`을 추가했다. 자동 승인·기간 삭제·운영 동기화는 추가하지 않았다.
- `sheet-conflict-report`가 가격 충돌을 공급사·기존 상품키·실제 RTDB 저장키·계약보호와 연결하도록 수정했다.
- `npx tsc --noEmit`, `check-ui-contract`, `sim-sheet-merge` 126/126 PASS.
- `check:fonts`, `check:tokens` PASS. 분리 production build 30 routes PASS.
- 후보 Rules 기준 `check:release`는 법적 운영자 정보 6필드만 FAIL, PWA 2건 WARN이다. 운영 Rules는 게시·변경하지 않았다.

## 2026-08-03 — 데이터 원자·계보 전수감사

- `scripts/audit-data-atoms.mts`를 추가해 ENTITIES 선언, 코드 소비처, 운영 v3+v4 필드 존재 건수를 값 미출력 방식으로 대조했다.
- P0 판단 대상은 메시지 `sender_email` 잔존, 상품 `account_number`의 잘못된 소유, 역할별 사업자번호 alias, 계약·고객 개인정보의 소비 단절, 구형·신형 감사로그 이중 구조다.
- 합쳐야 할 원자는 사진 alias, 조직명 alias, 사업자번호 alias, 첨부 alias다. 쪼개야 할 원자는 차량 표시명, 인도 권역/주소, 조직 링크/표시 snapshot, 역할별 읽음상태, 계약 단계값/변경주체/시각이다.
- `quote`와 `report`의 실제 RTDB node 이름 및 v3 nested/v4 flat 메시지 구조를 감사 스크립트에 반영했다.
- 운영 재조회가 무기한 대기하지 않도록 RTDB read timeout 20초를 추가했다.
- 상세 판정과 실행 순서는 `docs/DATA_ATOM_AUDIT_2026-08-03.md`에 기록했다.
- Chrome 운영 탭은 확인했지만 제어권 연결이 두 차례 응답하지 않아 DOM·스크린샷 대조는 미완료로 명시했다.
- 운영 write·삭제·마이그레이션·Rules 변경은 0건이다.

## 2026-08-03 — 데이터 원자 신규 유입 차단 1차

- OCR 응답은 `ENTITIES`에서 OCR 대상으로 선언한 canonical 원자만 폼에 반영한다. 현재 Python 반환키(`year`, `engine_cc`, `usage`)와 과거 alias(`car_year_month`, `displacement`, `usage_type`)를 경계에서 정규화하고 임의 키는 버린다.
- 상품 `account_number`는 삭제하거나 파트너 계좌로 자동이관하지 않았다. 레거시 상품이 재저장될 때 public에 승계되지 않도록 `products_private`에 격리하고 영업자·고객 조회에서는 제거한다.
- 감사로그 민감 필드에 `sender_email`, `business_no`, 고객 생년월일·사업자번호, 면허·계약첨부·계좌 alias를 추가하고 중첩 객체도 재귀 마스킹한다.
- 기존 감사로그용 `scrub-audit-pii.mts`도 신규 감사와 같은 민감 필드 목록을 사용한다. 운영 `--apply`는 실행하지 않았다.
- `sim-audit-display` 10/10, `sim-ocr-mapping` 5/5, `sim-agent` 44/44 PASS.
- 상품 private 이관 15/15, 중복상품 이관계획 26/26 PASS.
- `npx tsc --noEmit`, fonts, tokens, UI 계약 PASS.
- 분리 production build 30 routes PASS. build가 자동 수정한 `tsconfig.json`은 원상복구했다.
- 운영 데이터 write·삭제·마이그레이션·Rules 변경은 0건이다.

## 2026-08-03 — 데이터 원자 alias 읽기 통일 2차

- partner/user/customer/contract의 사업자등록번호를 역할별 기존 정본 우선 + legacy alias fallback으로 읽는 `business-identity` 경계를 추가했다. 저장 스키마와 운영 값은 변경하지 않았다.
- 로그인 매칭, 가입 승인 신원 파생, 회원 중복 확인·상세 표시, 계약서 공급사 정보 주입을 공통 reader로 통일했다.
- 포맷만 다른 동일 번호와 실제 alias 충돌을 구분하며, 충돌 시 기존 정본을 우선할 뿐 자동 수정·이관·권한 차단은 하지 않는다.
- 값과 식별자를 노출하지 않는 읽기 전용 운영 감사기 `scripts/audit-business-identity.mts`를 추가했다. 현재 환경은 Firebase 관리자 자격증명이 없어 실데이터 건수 집계 미실행이며 출시 전 잔여 게이트다.
- `sim-business-identity` 7/7, `sim-agent` 44/44 PASS.
- `npx tsc --noEmit`, fonts, tokens, UI 계약 PASS.
- 분리 production build 30 routes PASS. build가 자동 수정한 `tsconfig.json`은 원상복구했다.
- 운영 데이터 write·삭제·마이그레이션·Rules 변경은 0건이다.
- 기존 Claude 비게시 Rules 후보를 현재 운영 Rules에서 재생성해 보안 13/13, 계약 26/26, 전자서명 58/58 PASS를 재확인했다. 후보 기준 출시 게이트 잔여 차단은 법적 운영자 정보 6필드 1건이며 PWA 2건은 경고다. 후보를 운영에 게시하지 않았다.
- 같은 후보를 Firebase Auth+RTDB Emulator에 실제 로드해 정상·적대 HTTP 시나리오 26/26 PASS를 재확인했다. 테스트 종료 후 Emulator는 정상 종료했으며 운영 프로젝트에는 접근하거나 쓰지 않았다.

## 2026-08-04 — 아이언렌트카 홈페이지 단일 정본 연동 1차

- 사용자 확인에 따라 연동 활성화 후 `RP006`은 기존 Google Sheet를 중지하고 아이언렌트카 홈페이지를 단일 정본으로 사용한다.
- 신차·중고 누적 목록과 상세를 읽는 전용 서버 어댑터, 단일 정본 대조 플래너, 관리자 전용 read-only preview API를 추가했다.
- 실측 홈페이지 49대(활성 24·판매완료 25, 신차 20·중고 29)를 49/49 변환했다. 오류·차번/가격/사진 누락·중복차번·공개원가 누수는 0이다.
- 운영 v3+v4 논리키 읽기 대조: 안전 매칭 21, 신규 활성 3, 판매완료 신규 제외 25, 웹 부재 차단 후보 4, 실제 중복차번 0, 계약보호 0, 실행 0건이다.
- 기존 ERP 시트 가격과 홈페이지 가격은 동일하지 않다. 비교기간 50개에서 월대여료 동일 0, 보증금 동일 45, 쌍 동일 0, 웹 전용 기간 13, ERP 전용 기간 2다.
- 단일 정본 규칙에 따라 후보 patch는 홈페이지 가격 전체를 사용하며 과거 시트 전용 기간을 혼합 보존하지 않는다. 기존 계약 금액 snapshot은 건드리지 않는다.
- `sim-ironrentcar-source` 17/17, `sim-ironrentcar-reconcile` 15/15, `sim-sheet-merge` 128/128, `sim-phase12` 69/69 PASS.
- typecheck, fonts, UI 계약, 분리 production build 30/30 PASS. 새 preview route 포함을 확인했고 build의 `tsconfig.json` 자동 변경은 복구했다.
- 비인증 preview 요청은 403, 실행 중 4004 루트는 200이며 서버를 재시작하지 않았다.
- 운영 데이터·Rules·외부 사이트 write는 0건이다. 적용은 후보 28건 승인 후 서버 기능 플래그를 켜야 한다.
- 상세 결정과 활성화 순서는 `docs/IRONRENTCAR_WEB_INTEGRATION_2026-08-04.md`를 따른다.
- 체크포인트 `7f700a0`을 `codex/atomic-claim-preview`에만 push했다. Vercel Preview `dpl_ACpiQM8aFQ3BCP3yyW4Syvemgnt4`는 Ready이며 Production은 변경하지 않았다.
- Preview 보호를 통과한 `vercel curl` 비인증 호출은 앱의 `{\"error\":\"forbidden\"}`을 반환해 관리자 인증 경계를 재확인했다.
- `npm audit --omit=dev`는 기존 기준선과 같은 Critical 0, High 3, Moderate 8이다. 이번 의존성 추가로 건수가 늘지 않았다.

## 2026-08-04 — 아이언 논리키 정정 및 적용 경로

- 최초 보고의 중복 3그룹은 v3 `EXT_*` 저장키와 v4 canonical child를 별개로 병합한 감사 오탐이었다. 앱의 `product_code` 논리키 병합으로 재검증해 실제 중복 0으로 정정했다.
- 공용 `mergeV3V4Records()`를 추가하고 아이언 preview와 중복상품 감사 서버가 이 경계를 쓰게 했다.
- 최신 후보는 기존 21대 보강, 신규 3대, 웹 부재 4대 차단으로 총 28건이다. 홈페이지 판매완료만 있는 25대는 생성하지 않는다.
- 관리자 POST apply 경로를 추가했다. `IRONRENTCAR_SYNC_ENABLED` 기본 OFF, 명시 확인문구·revision·예상 건수 일치가 필수다.
- 적용 시 진행 중 Sheet sync를 차단하고 `RP006.inventory_source=ironrentcar_web`으로 바꾼다. 실패 시 source를 복구하며 성공 후 Sheet roster에서 RP006을 제외한다.
- 공개 상품 28건은 `v4/products` 부모 transaction 하나에서 CAS 검증 후 전부 적용하거나 전부 중단한다. v3·Rules·private 차량가는 쓰지 않는다.
- `sim-ironrentcar-apply` 15/15, `sim-ironrentcar-reconcile` 17/17, `sim-sheet-merge` 129/129, 상품 중복 이관 26/26, Phase1·2 69/69 PASS. 운영 write는 0건이다.
- 분리 production build 30/30 PASS이며 `/api/inventory/ironrentcar/apply`·`preview` 두 route를 확인했다. build가 자동 변경한 `tsconfig.json`은 복구했고 4004 서버는 재시작하지 않았다.

## 2026-08-04 — 오픈 게이트 재판정

- 운영 `database.rules.json` 기준 `check:release`는 보안 14건 FAIL이라 그대로 오픈 금지다.
- 최신 후보 Rules 기준 `check:release`는 법적 운영자 정보 6개만 FAIL, 기존회원 재동의 OFF와 서비스워커 부재 2건 WARN이다.
- `check:b2b-release`는 로컬 기준 서비스계정·차량 claim 서버 플래그·클라이언트 플래그 3건 FAIL이다.
- Vercel 환경 이름을 값 미출력으로 확인했다. `FIREBASE_SERVICE_ACCOUNT_JSON`은 Preview에만 있고 Production에는 없으며, 두 claim 플래그와 법적 운영자 변수는 등록되지 않았다.
- 현재 판정은 NO-GO다. 운영자 정보 입력, Preview claim smoke, Production 서비스계정, 후보 Rules 사람 검증·게시·5역할 smoke가 필수다.
- `LAUNCH_GONOGO.md` 상단을 2026-08-04 기준으로 갱신해 과거 2026-07 GO 판정을 최신 판정으로 오인하지 않게 했다.
- 구현 체크포인트 `0b525e7`을 Preview 브랜치에만 push했다. Vercel Preview `dpl_HJWJFvP7m4pSXXGCU93yA1Z4EZtZ`는 Ready이고 Production은 변경하지 않았다.
- Preview 보호를 통과한 비인증 preview/apply 호출은 모두 앱의 `forbidden`을 반환했다. 아이언 기능 플래그·공급사 source·상품 운영 write는 0건이다.

## 2026-08-04 — 아이언 연동 오픈 필수 전환 및 관리자 적용 UI

결과: **관리자 preview→명시 적용 UI·회귀검증 PASS / Preview 실관리자 적용·24대 확인 전 전체 오픈 NO-GO**

- 사용자가 아이언 홈페이지 연동을 포함해 오픈한다고 확정해 `LAUNCH_GONOGO.md`의 필수 게이트를 4개에서 5개로 변경했다.
- `SheetSync` 관리자 화면에 홈페이지 전체/활성/판매완료/신차/중고, 수정·신규·부재차단·판매완료 무시·중복과 revision을 표시하는 read-only 미리보기를 추가했다.
- 재고관리의 4번째 패널을 `연동·반영`으로 고정했다. 관리자 표에는 아이언 홈페이지와 전체 Sheet 공급사를 함께 나열하고 검증 전/후 신규·상태변경·정보수정을 표시한다. 공급사 역할 화면은 기존 actor 회사 범위를 유지한다.
- 후속 사용자 정정으로 원본별 UI 명칭을 통일했다. 홈페이지/Sheet는 `연동 방식` 보조열에만 표시하고, 별도 아이언 연동 카드·미리보기/동기화 용어 대신 모든 공급사에 `상품 검증`과 `상품 반영` 업무명을 사용한다. 서버 확인문구는 기존 apply API 호환을 위해 내부값으로만 유지한다.
- 신규 3대와 홈페이지 부재 4대의 키를 직접 노출한다. 불완전 카탈로그·중복차번·차단 후보가 있으면 적용 버튼을 비활성화한다.
- 적용은 확인 대화상자 뒤 미리보기 revision과 세 종류 예상 건수, 정확한 서버 확인문구를 POST한다. 서버가 재수집한 revision/건수와 다르면 409로 전체 거부한다.
- 적용 성공 뒤 공급사 roster와 재고 화면을 새로고침한다. 기능 플래그 OFF 응답은 Preview 설정 확인 안내로 표시한다.
- `sim-ironrentcar-apply` 19/19, source 17/17, reconcile 17/17, sheet merge 129/129, `tsc --noEmit`, fonts, tokens, UI 계약 PASS다.
- UI 회귀검증 시점에는 `IRONRENTCAR_SYNC_ENABLED`를 켜거나 apply를 호출하지 않아 운영 write가 0건이었다. 새 Ready Preview에서 관리자 미리보기 49/24/25·21/3/4 확인 → 명시 적용 28건 → 활성 24대·RP006 Sheet 제외·감사로그 확인이 남았다.
- 이후 Preview 환경에만 `IRONRENTCAR_SYNC_ENABLED=true`를 추가하고 동일 커밋을 재배포했다. Ready deployment는 `dpl_FK3AaEaBcq1HqqCBzemeRYW6xgp7`, URL은 `https://freepasserp4-p3yv6tvbv-freepass-projects.vercel.app`다. Production 환경변수와 배포는 변경하지 않았다.
- Preview 보호를 통과한 비인증 GET preview와 POST apply는 모두 403 `forbidden`이며 브라우저 console error/warn 0이다. 새 Preview origin에 관리자 세션이 없어 실미리보기/apply는 실행하지 않았고 운영 write는 계속 0건이다.

## 2026-08-05 — 포맷 소실분 Codex 세션 로그 복구 검증

- `C:\Users\user\.codex\sessions`의 성공한 `patch_apply_end` 원문을 현재 복구 커밋 `d69efdf`에 재생하고, 이후 Claude 커밋과 충돌하는 과거 패치는 제외했다. `.env.local`·서비스계정·Firebase 디버그 로그는 복구 대상에 포함하지 않았다.
- 복원 범위는 아이언 검증/반영/원자 롤백, Google Sheets 가시 행 판독, 오토플러스 연속 블록, 이안카 다중 탭 우선순위, 공급사 원본 감사, ERP4 상품 단독 정본, 상품 사진 공용 대체 UI다.
- `npx tsc --noEmit`, `check:fonts`, `check:tokens`, `check:ui`, `git diff --check` PASS.
- Iron source 19/19, reconcile 30/30, apply 25/25, rollback 28/28 PASS.
- Sheet merge 139/139, revive 12/12, daily sync 22/22, price 31/31 PASS.
- 분리 `NEXT_DIST_DIR=.next-codex-recovery` production build가 정적 30페이지와 신규 `/api/inventory/ironrentcar/rollback`을 포함해 PASS했다. Next가 자동 변경한 `tsconfig.json`은 빌드 전 해시 `68b2e974...`로 복구했다.
- 운영 RTDB·Google Sheet·아이언 홈페이지 write, Rules 게시, Production 배포는 실행하지 않았다. 기존 미추적 `tmp-install.log`도 보존했다.

## 2026-08-09 착한거래 전자계약 운영 릴리스 게이트

결과: **Preview E2E PASS / Production NO-GO**

- 검증 브랜치: `codex/esign-production-gate`, 전자계약 릴리스 커밋 `93a64d5`.
- Freepass Preview: `https://freepasserp4-5atfmrx7h-freepass-projects.vercel.app` Ready.
- Chakhandeal Preview: `https://chakhandeal-f2ugpyn17-freepass-projects.vercel.app` Ready.
- 두 Preview 브랜치에만 새 QA 전용 API 키를 동기화했다. Production 환경변수와 배포는 변경하지 않았다.
- 비인증 발행·상태·PDF API는 각각 의도한 `401 로그인 필요`를 반환했다. 착한거래 Preview의 빈 발행 요청은 앱 검증 단계의 `400 EXTERNAL_REF_REQUIRED`를 반환해 서버 간 통신도 확인했다.
- QA 전용 `v4/policies/QA-ESIGN-POLICY-*`와 `v4/contracts/QA-ESIGN-*`를 생성해 실제 발행 → 고객 본인확인/동의/필수서류/서명 → ERP 상태 동기화 → 완료 PDF 다운로드를 검증했다.
- 실제 결과: Freepass `발행` → Chakhandeal `signed` → Freepass `서명완료`. ERP PDF 2,950,163 bytes, `%PDF-` 헤더 정상, Chakhandeal SHA-256과 ERP 프록시 응답 SHA-256 일치.
- QA Freepass 계약·정책은 검증 직후 삭제했다. 생성한 Chakhandeal QA 계약 2건은 모두 `purged` 처리해 서명·신분·문서 파일과 개인정보를 제거했다.
- 정적 게이트: `sim-chakhandeal-esign` 29/29, `sim-chakhandeal-sync` PASS, `sim-esign-inputs` 43/43, `sim-esign-progress` 44/44, 정책→계약 및 초과주행거리 분리 검증 PASS, `tsc --noEmit`, fonts, tokens, production build PASS.
- Production 차단 사유 1: 전자계약 서식 메타데이터가 아직 `sample-v1`, `STANDARD_IS_SAMPLE=true`다. 법무/대표 승인 없이 실제 고객 계약에 사용하면 안 된다.
- Production 차단 사유 2: 현재 정책 54/54건이 모두 `product` 단계라 실제 ERP 전자계약 발행 가능 정책이 0건이다. 공급사별 실제 계약조건을 확인해 `contract` 단계 필수값을 채운 정책만 발행 대상으로 열어야 한다.
- 최종 판정: 기능과 연동 자체는 Preview에서 끝까지 정상이다. 표준계약서 문안 승인과 실제 계약정책 1건 이상 확정 전에는 Production 배포·키 등록 금지.

### 2026-08-10 최종 코드 통합 게이트

- `isEsignTemplateAllowed()`를 추가해 Preview에서는 샘플 문안 E2E를 허용하되, Vercel Production에서는 `STANDARD_IS_SAMPLE=true`인 동안 발행 API가 `503 표준계약서 최종 승인 전`으로 fail-closed 되게 했다.
- 전자계약 약관 39/39, 발행 매핑 29/29, 상태 동기화 PASS, 고객입력 43/43, 진행상태 44/44, `tsc --noEmit --incremental false`, fonts, tokens PASS.
- 분리 `NEXT_DIST_DIR=.next-codex-esign-final` production build가 33개 정적 페이지와 발행·상태·PDF API 3개를 포함해 PASS했다. 빌드가 자동 수정한 `tsconfig.json`은 원본 해시로 복구했다.
- Preview `dpl_2cuPnpBSnQ7KpuZEqQinhdaJsSaB` Ready. 발행·상태·PDF API 비인증 smoke는 모두 `401 로그인 필요`를 반환했다.
- 판정: **운영 코드 배포 GO / 실제 고객 발행 NO-GO**. 코드와 관리화면은 통합 가능하지만 Production API 키 등록과 계약 발행 개방은 최종 계약서·실제 계약정책 승인 후 별도 게이트다.

## 2026-08-10 — 프리패스 기본정책 패키지

- 패키지 식별자 `freepass-standard-2026-08-10-v1`, 기본값 30개를 `lib/domain/policy-defaults.ts`에 단일 정의했다.
- 미입력 정책은 `계약서 작성=프리패스가 작성`을 포함한 기본 패키지를 사용한다. 공급사가 명시한 작성 주체·요율·조건은 덮어쓰지 않는다.
- 신규/기존 정책 화면, 상품 조인, 공개 카탈로그, 계약 payload와 착한거래 발행 서버가 동일한 `applyPolicyDefaults()`를 사용한다.
- 빈 객체만으로 전자계약 정책 게이트 통과, 명시값 우선, 정책→계약 전달, 국산 200원/수입 400원 분리, fonts, `tsc --noEmit`, `git diff --check` PASS.
- 운영 RTDB 일괄 갱신·Rules 게시·배포는 실행하지 않았다. 계약 조건 변경이므로 실제 고객 발행 전 사람/Claude 게이트는 계속 필요하다.

## 2026-08-10 — 계약문의 최근순·미확인·미회신

- 계약문의 기본값을 `전체 + 최근순`으로 변경했다. 상단 목록 숫자는 현재 보이는 전체 문의 수이고, `미확인`과 `미회신`은 별도 KPI·필터로 표시한다.
- 상대 메시지를 아직 읽지 않았으면 경고 아이콘과 안읽은 메시지 숫자 뱃지를 표시한다.
- 메시지는 읽었지만 상대 메시지가 마지막이면 빨간 경고 아이콘과 `미회신` 배지를 표시한다. 응답 필요 표시는 계약 진행상태 아이콘보다 우선한다.
- `sim-chat-attention` 8/8, fonts, 변경파일 `diff --check` PASS.
- 전체 `tsc --noEmit`은 동시 작업 중인 `app/api/freepass-esign/contracts/[contractCode]/document/route.ts`의 `Uint8Array` 응답 타입 오류 1건으로 차단됐다. `sim-work-list-semantics`의 기존 발신자 표시 D18·D19도 142/144로 남았으며 이번 변경 범위와 무관하다.

## 2026-08-10 — 전 메뉴 정렬 기본값 정합성 전수검사

- 의미 없는 공통 `기본` 정렬을 제거하고 실제 기본 정렬을 명시했다: 상품찾기=대여료 낮은순, 계약문의=최근순, 계약진행=최근순, 재고관리=상태순, 회원관리=이름순, 정책관리=이름순, 정산관리=계약일 최신순.
- 웹·모바일 모두 선택값, 실제 정렬, 초기화 복귀값, 필터 활성 건수와 적용조건 문구가 같은 `defaultValue`를 사용한다. 기본 정렬은 활성 필터로 세지 않는다.
- 전수검사 중 발견한 계약문의 발신자 표기도 수정했다. 실명이 있으면 내부코드보다 실명을 우선하고, 이름 없는 이관 메시지는 내부코드 대신 역할명을 표시한다.
- `check-menu-sort-defaults` 10/10, `sim-chat-attention` 8/8, `sim-work-list-semantics` 144/144, `tsc --noEmit`, fonts, 변경파일 `diff --check` PASS.

## 2026-08-10 공급사 허브·주행거리 원본 복구
- 공급사 허브 18행과 ERP 설정을 시트 ID 기준으로 대조했다. RP004가 허브 원본이 아닌 과거 프리패스 종합시트를 가리켜 전체 파싱이 0건 차단되고 주행거리도 갱신되지 않던 원인을 확인했다.
- RP004 v4 설정을 허브 원본 `아이카종합`(gid 965600926)으로 복구했다. 실제 파서 미리보기는 원본 1,877행, 출고불가 1,825행, 반영 후보 50대, 무효 0, 중복 2였다.
- 매 동기화 직전 허브 URL을 메모리 설정에 덮어쓰고, 워크북이 바뀌면 과거 파일 전용 gid를 폐기하도록 방어했다. RP006은 홈페이지 단일 정본 예외를 유지한다. 서버 작업에서도 허브 CSV를 직접 읽도록 상대 `/api/sheet` 오류를 제거했다.
- 전체 재감사는 RP004 50대 정상 판독을 확인했으나 빌린카 3탭의 일시적 조회 timeout 때문에 fail-closed 되었다. 따라서 상품 일괄 쓰기는 실행하지 않았다.
- `sim-sheet-merge` 150/150, `tsc --noEmit`, fonts PASS.

## 2026-08-10 공급사 필수제원 미입력 감사·배기량 보충
- 공급사 시트 17곳 395대를 원자별 전수 집계했다: 배기량 368/395, 현재주행 393/395, 외장색 394/395, 내장색 281/395였다.
- 원본에는 있으나 ERP에만 빠진 배기량 11건(RP004 1대, RP031 10대)을 공급사코드+차번으로 재검증하고 v4 빈 필드만 보충했다. 사후 대조에서 두 공급사 모두 ERP 구멍 0건을 확인했다.
- 빈칸 보충 도구의 차번 단독 매칭을 공급사코드+차번으로 강화하고, 쓰기 직전 최신 v4 레코드를 다시 읽어 빈 필드만 ETag 조건부 PUT하도록 바꿨다. 다른 공급사의 같은 차번 및 동시수정을 덮어쓰지 않는다.
- 남은 배기량 16대·현재주행 2대·외장색 1대·내장색 114대는 공급사 원본 자체가 비어 있어 화면에는 `미입력`으로 표시하고 공급사 보완 대상에 포함해야 한다.
- `tsc --noEmit`은 동시 작업 파일 `app/api/freepass-esign/contracts/[contractCode]/handover/route.ts`의 actor nullable 오류 2건으로 차단됐다(이번 변경 범위 밖).

## 2026-08-10 공급사 입력 반영 다중 재검수
- 공급사 입력 우선 병합, 관리자 메모 보호, 계약잠금 상태 보호를 회귀검증했다. `sim-sheet-merge` 152/152 PASS.
- 시트 셀 링크 메타데이터가 빈칸 보충 경로에서 누락되던 문제를 수정하고 손오공 22대의 `photo_link`를 공급사코드+차번 CAS 방식으로 보충했다. 사후 RP012 원본→ERP 구멍 0건.
- 공급사 시트 판독 규격(숨김 행/탭, 복수 gid, 밀린 헤더, 탭 부분실패) `sim-supplier-sheet-read` 14/14 PASS.
- 최종 전 공급사 원본→ERP 원자 대조에서 차량제원·사진 구멍은 0건. 남은 28건은 RP023 14대의 주행거리별 가격기간+보증금으로, 기존 가격기간 변경 승인 게이트 대상이라 강제 반영하지 않았다.
- `tsc --noEmit`, fonts, 변경파일 `git diff --check` PASS.

## 2026-08-10 `연동하기` 1클릭 반영
- 공급사별/전체 `연동하기`가 사전 검증 버튼을 요구하지 않고 fresh 허브·시트 읽기 → 내부 검수 → 반영까지 한 번에 수행하도록 연결했다. 검수 버튼은 쓰기 없는 미리보기 용도로 유지한다.
- 충돌이 없으면 신규·수정·부재처리를 포함한 기존 전체 커밋 경로를 사용한다. 가격·삭제·신원 충돌이 있으면 버튼을 막지 않고, 활성 ERP에서 공급사코드+실차번이 정확히 한 대와 일치하는 기존 차량의 제원·주행거리·색상·옵션·사진만 CAS 반영한다.
- 안전 부분연동은 가격·신규·삭제·상태를 건드리지 않으며 검증 뒤 ERP revision 또는 공급사 roster가 바뀌면 재검증을 요구한다.
- `tsc --noEmit`, `sim-sheet-merge` 152/152, 변경파일 `git diff --check` PASS.

## 2026-08-10 `연동하기` 적대 경계 재검수
- 안전 부분연동의 대상 선정을 순수 계획 함수로 분리해 실제 저장 없이 공급사·차번 경계를 직접 검증할 수 있게 했다.
- 공급사+실차번 단일 일치만 기존 ERP 저장키로 반영하고, 신규 차량·타 공급사 동일 차번·ERP 중복차량·임시번호는 모두 제외됨을 확인했다.
- 공급사 원본에 가격·차량상태·관리자 메모가 들어 있어도 안전 부분연동에서는 우회 변경되지 않음을 확인했다.
- 원본 배열 자체에 같은 공급사+차번이 중복된 경우도 이중 반영하지 않고 전체 제외하도록 추가 방어했다.
- `sim-sheet-merge` 161/161, `tsc --noEmit`, fonts, 변경파일 `git diff --check` PASS.

## 2026-08-10 단건 `연동하기` 규격·반응 재검수
- 단건 버튼이 선택 공급사 revision과 전체 공급사 revision을 비교해 정상 데이터도 설정변경으로 오판하던 범위 불일치를 수정했다. 단건은 해당 공급사만, 전체는 전체 공급사를 같은 범위로 재검증한다.
- 선택하지 않은 다른 공급사 설정이 바뀌어도 단건 연동은 거짓 차단되지 않고, 선택 공급사 설정 변경은 계속 정확히 차단한다.
- 검증과 연동 진행 상태를 분리했다. 단건 연동 시 선택 행만 `연동 중…`으로 표시하고, 상단에는 ERP 규격 변환·저장·사후검증 진행을 표시한다.
- `sim-sheet-merge` 164/164, `tsc --noEmit`, fonts, 변경파일 `git diff --check` PASS.
- 로컬 화면 자동 확인은 브라우저 보안 확장에 의해 localhost 접근이 차단되어 클릭까지 수행하지 못했다. 코드 경로·상태 전이·규격 회귀는 자동 테스트로 확인했다.

## 2026-08-10 실제 브라우저 단건 연동 검수
- 로컬 개발 서버를 복구하고 Chrome에서 `/dev` 공급사 상품 연동 화면을 직접 열어 손오공(RP012) 단건 `연동하기`를 실행했다.
- 최초 화면에서 인증 준비 전에 roster 조회가 한 번 실패한 뒤 영구 고정되는 문제를 발견했다. `useAuthReady()` 이후 roster·자동연동 상태를 조회하도록 연결해 공급사 17곳과 버튼이 정상 활성화됨을 확인했다.
- 클릭 직후 선택 행만 `연동 중…`, 상단은 `RP012 연동 중… ERP 규격 변환·저장·사후검증`으로 표시됨을 실제 DOM에서 확인했다.
- 최초 실행은 동일 가격 객체의 `rent/deposit` 키 순서 차이를 변경으로 오판해 31대 사후검증 실패. 구조 비교를 객체 키 순서와 무관하게 수정하고 회귀 테스트를 추가했다.
- 수정 후 같은 버튼을 다시 실행해 실제 완료 알림 `연동 완료 · 신규 0대 · 수정 0대`를 확인했다. 재고 화면에서 `손오공` 검색 결과 31대와 배기량·색상·미입력 표기가 정상 노출됨을 확인했다.
- `sim-sheet-merge` 165/165, `tsc --noEmit`, 변경파일 `git diff --check` PASS.

## 2026-08-10 실제 변경 1건·재검증 수렴 검수
- 무변경 완료와 다른 방향으로 경진렌트카(RP015)를 먼저 읽기 전용 검증했다. 화면 표에서 `신규 0 · 상태변경 0 · 정보수정 1`, 원본 올림 1대를 확인했다.
- 같은 행의 단건 `연동하기`를 실제 실행해 완료 알림 `연동 완료 · 신규 0대 · 수정 1대`를 확인했다.
- 즉시 같은 공급사를 다시 데이터 검증한 결과 `신규 0 · 상태변경 0 · 정보수정 0`으로 수렴했고, 최근 반영 시각도 `8. 10. 오후 09:11`로 갱신됐다.
- 따라서 검증 예상 1건 → 실제 수정 1건 → 재검증 잔여 0건의 숫자 정합과 단건 연동 멱등성을 실제 브라우저·운영 v4 경로에서 확인했다.

## 2026-08-11 프리패스 표준 렌터카 계약서·약관 책임 분리

- 계약서에는 계약별 숫자·선택값(연간 약정주행거리, 1km당 초과주행 요금, 월 납부일 등)을 두고, 약관에는 계산식·정산시점·제외거리·증빙방법을 두도록 역할을 분리했다.
- 초과주행 요금은 `반납 주행거리 - 출고 주행거리 - 사용기간 약정거리 - 객관적으로 확인된 제외거리`의 0 초과분에 계약서의 1km당 요금을 곱하도록 제16조에 명시했다. 일할 약정거리와 계기판 이상 시 객관자료 기준도 함께 규정했다.
- 자동이체는 선택 부속서류로 분리하고 계약 본문은 `월 납부일`로 통일했다. 직접 작성 화면에서는 고객 주소와 월 납부일을 발송 전 필수 확인한다.
- 보험·자차·사고 문구를 실제 손해와 가입 보험·공제 처리결과 중심으로 정리하고, 수리비 산정근거 제공·동일 손해 중복청구 금지·회사 귀책 인도불능/하자 조치·적법한 대리운전 예외를 보강했다.
- 약관을 `계약 성립·기본조건 → 차량 인도·운행 → 사고·연체·회수 → 계약 종료·반납·정산 → 기타 사항`의 5개 장으로 재배열하고, 보험·사고·전손·반납재산 등 중복을 합쳐 23개 항목을 21개 조문으로 정리했다.
- 중고차 조건부 항을 제7조에 두어 모든 계약이 같은 21개 약관 정본을 사용하게 했다. `중고차량인 경우`에만 경년변화·통상 사용흔적 확인이 적용되며, 미고지 중대하자·안전운행 결함·통상점검으로 확인하기 어려운 하자는 인정 대상에서 제외한다. 계약서 앞면·최종 확인란의 중고차 요약만 차량 구분에 따라 표시한다.
- 약관 제목을 `자동차 렌탈(대여) 약관`으로 고정해 인수형·반납형·렌탈·구독 구분에 따라 약관 정본이 달라지지 않게 했다. 약관 3쪽의 6개 단을 전체 균형 배치해 마지막 쪽에만 큰 빈공간이 몰리던 현상을 제거했다.
- 계약서 폰트를 `Pretendard` 400·500·600·700·800으로 통일하고 공식 v1.3.9 WOFF2와 SIL 라이선스를 로컬 자산으로 보관했다. PDF 생성기는 폰트를 데이터로 직접 임베드하고 `document.fonts.ready`와 모든 Pretendard FontFace 로딩 상태를 확인하며, 실패 시 맑은 고딕 등 대체 폰트로 PDF를 발행하지 않는다.
- 약관 본문을 10px(약 7.5pt)로 조정하고, 폰트 로딩 후 6개 A4 단을 다시 분할한 뒤 마지막 단의 긴 문단을 앞 단 여유 공간으로 역방향 보정하게 했다. 최종 6개 단은 사용 가능 높이의 93% 이상을 사용하고 넘침은 0이며, 90% 미만 사용·단간 높이 차 80px 초과·A4 넘침 시 PDF 생성을 실패시키는 게이트를 추가했다.
- 검토용 PDF를 A4 9쪽으로 재생성하고 전 페이지를 이미지로 렌더링했다. 약관은 4쪽에서 3쪽으로 줄이고 마지막 약관 쪽의 두 단을 균형 배치해 큰 빈 단을 제거했으며, 보험 경고문·제16조·마지막 동의·서명란에 잘림이 없음을 확인했다.
- 약관 번호 체계를 `제N조(제목) → ① 항 → 1. 호 → 가. 목`으로 통일하고, 조문 교차참조는 `제11조제2항제10호`, `제11조 및 제14조`처럼 완전한 법령식 표기로 정리했다. 축약 참조와 제목 띄어쓰기의 재유입을 막는 자동 검사를 추가했다.
- 프로덕션 `npm run build`, `tsc --noEmit`, fonts, 계약서↔전송약관 일치 50/50, 문서경계, 계약유형 60/60, source gate, template profile 10/10, snapshot, 고객화면 필드 54/54, 정책입력 검사를 통과했다.
- 이번 흐름·번호 수정 후 계약서↔전송약관 일치 및 번호 규격 52/52, 계약유형 60/60, 전자계약 준법구조 23/23, 착한거래 발행매핑 35/35, 문서경계 검사를 재통과했다. 약관 5~7쪽을 다시 렌더링해 조문 순서와 페이지 채움이 정상임을 확인했다.
- 최종 판정: **CONDITIONAL PASS**. 검토본·코드 반영은 완료했으나 계약 조건 변경이므로 실제 고객 발행·배포 전 렌터카회사와 사람/Claude의 최종 승인이 필요하다.

## 2026-08-11 계약서 표 선 단일 규격 재검수

- 본문 키값 표와 일반 표에 섞여 있던 내부 가로선 0.35pt·세로선 0.3pt·상하 마감선 0.8pt 구분을 제거하고, 모든 표선을 같은 색의 0.45pt 단일선으로 통일했다.
- 좌우가 열린 문서형 표는 유지하되 마지막 셀의 하단선과 외곽 하단선이 겹쳐 굵어지지 않도록 외곽 하단선을 제거했다.
- 검토용 PDF를 재생성하고 계약자·차량·대여조건·보험 보장·자차 표가 있는 1~2쪽을 144dpi PNG로 렌더링해 상하단과 내부선의 시각적 무게가 동일하고 글자·표 잘림이 없음을 확인했다.
- 약관 6개 단은 넘침 0, 채움률 90% 이상을 유지했다. `tsc --noEmit`, `npm run check:fonts`, `sim-esign-agreement` 57/57 PASS.

## 2026-08-11 계약서 섹션 간격 재검수

- 번호형 섹션 제목과 바로 아래 표의 간격을 3mm에서 1.5mm로 줄이고, 섹션 종료 후 다음 섹션까지의 간격을 5mm에서 7mm로 늘려 제목과 해당 내용의 묶음이 명확하게 보이도록 조정했다.
- 표 내부 소제목도 앞 내용과의 간격은 늘리고 뒤 내용과의 간격은 1.5mm로 줄였다. 조밀한 페이지와 보험 페이지는 페이지별 보정값을 같은 방향으로 적용했다.
- 계약 본문·보험 페이지를 144dpi PNG로 재렌더링해 섹션 구분, 표 정렬, 하단 잘림이 없음을 확인했다. 약관 6개 단 넘침 0, `tsc --noEmit`, fonts, `sim-esign-agreement` 57/57, 샘플 페이지 HTTP 200 PASS.

## 2026-08-11 약관 장 제목 제거 재검수

- 21개 조문 규모에서 반복되던 `제1장~제3장` 장 제목과 장식선을 제거하고 `제1조~제21조`만 순서대로 이어지게 했다. 조문 본문·번호·교차참조는 변경하지 않았다.
- 인쇄용 문장 분할 단위를 조정해 장 제목 제거 후에도 약관 6개 단의 채움률을 91% 이상으로 유지했다. 3개 약관 페이지를 144dpi PNG로 재렌더링해 빈 단·고아 조 제목·잘림이 없음을 확인했다.
- `tsc --noEmit`, fonts, 인쇄/PDF 약관과 전송 약관 원문 일치 및 장 제목 부재 검사 포함 `sim-esign-agreement` 58/58 PASS.

## 2026-08-11 금지행위 목록·번호 간격 재검수

- 제9조 금지행위 11개 호를 무단 양도·전대, 운전자 위반, 은닉·반환거부, 장치·서류 조작, 불법목적 사용, 제3자 권리, 무단개조, 기타 중대침해의 8개 범주로 통합했다. 기존 보호 범위는 삭제하지 않고 관련 항목 안에 병합했다.
- 목록에 적용되던 양쪽 맞춤을 해제하고 번호 뒤 한 칸, 둘째 줄부터 본문 시작 위치에 맞는 내어쓰기로 통일했다.
- 제9조가 포함된 약관 페이지를 180dpi PNG로 재렌더링해 번호 간격·줄맞춤·단 배치·잘림을 확인했다. `tsc --noEmit`, fonts, 인쇄/PDF와 전송 약관 원문 일치 및 금지행위 8개 호 검사 포함 `sim-esign-agreement` 59/59, 샘플 페이지 HTTP 200 PASS.

## 2026-08-11 약관 항 번호 간격 전수 수정

- 약관 일반 문단의 `text-align: justify`를 제거하고 왼쪽 맞춤과 고정 단어 간격을 적용했다. 이에 따라 `①` 등 항 번호 뒤 단어 간격이 줄 길이에 따라 강제로 벌어지지 않는다.
- 사용자가 지적한 제15조와 제9조가 포함된 약관 2~3쪽을 180dpi PNG로 재렌더링해 항 번호 뒤 한 칸, 문단 줄바꿈, 단 배치와 잘림을 확인했다.
- 양쪽 맞춤 재유입 방지 검사까지 추가했다. `tsc --noEmit`, fonts, `sim-esign-agreement` 60/60, 샘플 페이지 HTTP 200 PASS.

## 2026-08-11 약관 한글 글자 경계 줄바꿈 재검수

- 전역 `word-break: keep-all`을 약관 문단에서만 해제하고 `word-break: normal`, `line-break: strict`를 적용했다. 한글은 칸 끝의 글자 경계에서 자연스럽게 줄바꿈되고 영문·숫자는 가능한 한 단어 단위로 유지된다.
- 약관 2~3쪽을 180dpi PNG로 재렌더링해 오른쪽 큰 빈칸 감소, 항 번호 간격, 조문 제목과 본문 줄바꿈, 잘림이 없음을 확인했다. 약관 6개 단 채움률 90% 이상과 넘침 0을 유지했다.
- 왼쪽 맞춤·한글 글자 경계 줄바꿈 고정 검사 포함 `tsc --noEmit`, fonts, `sim-esign-agreement` 60/60, 샘플 페이지 HTTP 200 PASS.

## 2026-08-11 단독 항 번호 제거 재검수

- 제9조 금지행위는 항이 하나뿐이므로 단독 `①`을 제거하고 안내문 뒤에 1~8호가 바로 이어지게 했다. 조문 내용과 8개 금지행위 범주는 변경하지 않았다.
- 전체 21개 조문을 확인한 결과 다른 조문은 모두 `②` 이상이 이어지는 정상 다항 구조였다. 제9조 페이지를 180dpi PNG로 재렌더링해 제목·안내문·호 목록 흐름과 잘림이 없음을 확인했다.
- 단독 항 번호 재유입 방지 검사 포함 `tsc --noEmit`, fonts, `sim-esign-agreement` 61/61, 샘플 페이지 HTTP 200 PASS.

## 2026-08-11 차량 사용 제한 문안 재검수

- 제9조 제목을 추상적인 `금지행위`에서 `차량 사용 제한`으로 바꾸고, 안내문의 `다음 각 호` 표현을 제거했다.
- 8개 보호 범위는 유지하면서 각 호 앞에 `무단 양도·대여`, `위험·부적격 운전`, `은닉·무단반출`, `장치·기록 훼손`, `목적 외 사용`, `제3자 권리 발생`, `임의 변경·훼손`, `그 밖의 중대한 침해`라는 짧은 분류명을 붙였다.
- 인쇄 약관과 전송 약관 정본을 함께 수정하고 제목·생애주기·8개 호 검사를 새 문안에 맞게 갱신했다.
- `sim-esign-agreement` 61/61, `tsc --noEmit`, fonts PASS. 로컬 서버를 재기동하고 PDF 7쪽을 직접 열어 2단 배치와 페이지 넘침이 없음을 확인했다.
## 2026-08-11 공급사 표준 헤더·사진 연동 정합성 재검증

- 실제 공급사 Sheets Grid를 쓰기 없이 전수 조회했다. 표준양식의 `배차상태→상태`, `차종→차명(트림)` 변경과 선택 `비고` 열 제거 때문에 저장된 과거 매핑 프로필이 일반 공급사 대부분을 차단하던 회귀를 확인했다.
- 공식 별칭이 현재 헤더에서 정확히 하나로 해석될 때만 저장 매핑을 재결합하고, 중복·미확인 핵심 헤더는 계속 fail-closed로 유지했다. 선택 메모 열만 안전하게 누락 허용했다.
- 회귀 시뮬레이션을 추가했고 `scripts/sim-sheet-merge.mts` **166/166 PASS**.
- 실제 시트 사진 링크는 **205/356대** 확인. 사진 0건 공급사는 셀 링크 자체가 0건이며 ERP 전달 누락이 아니다.
- 검증기의 v3/v4 파트너 노드 중복 출력은 공급사 코드 기준으로 제거했다. 운영 허브의 중복 코드는 0건이다.
- `npx tsc --noEmit`, `check:tokens`, `check:ui` PASS. 디자인 토큰·UI 계약 드리프트 0건.

## 2026-08-11 프리패스 표준 렌탈 약관 V8 구조·방어력 보완

- 기존 21개 조문과 렌터카 계약의 핵심 보호범위를 유지하면서 약관 흐름을 계약 성립 → 대여·정산 → 운전자격·보험 → 인도·관리 → 사고 → 해지·회수 → 통지 → 반납·정산 → 개인정보·분쟁 순서로 정리했다.
- 운전자격은 계약서뿐 아니라 실제 보험·공제의 연령·면허·경력·운전자 범위를 함께 따르게 했고, 사고 미통지에 따른 보상 제한은 해당 위반과 상당인과관계가 있는 범위로 명확히 했다.
- 사고 수리의 예상비용 사전고지와 실제 견적서·정비명세서·영수증 제공, 미납 통지의 발송기록, 안전하게 정차된 차량에 대한 보호조치, 평온한 회수 원칙을 명시했다.
- 회사 귀책 해지 시 미사용 대여료와 반환 대상 보증금의 반환 방향, 확정 인수가격의 사고·시세만을 이유로 한 증액·거절 금지, 특별손해의 예견가능성, 주민등록번호의 구체적 법령 근거 요건을 보완했다.
- 계약 유형과 공급사에 관계없이 약관 정본은 하나로 유지하고, 회사별 보험·공제·정비·가격 정책은 개별계약서와 실제 첨부자료에서 확정하도록 했다. 문서 버전은 `rental-v8-2026-08-11`이다.
- 약관 글자 크기 10px와 Pretendard를 유지한 채 조문·항 사이 여백과 자동 단 배치를 조정했다. 마지막 재배치가 A4 높이를 넘는 경우 안전한 1차 배치로 복귀해 글자 축소·잘림 없이 3쪽 6단을 유지한다.
- A4 9쪽 PDF를 재생성하고 약관 3쪽 및 동의·서명 페이지를 PNG로 렌더링해 겹침·잘림·고아 제목·빈 페이지가 없음을 확인했다. 6개 단의 사용 높이는 875.1~940.6px / 956.4px, 넘침 0건이다.
- `sim-esign-agreement` **70/70**, `sim-esign-contract-kind` **60/60**, `sim-esign-template-profile` **10/10**, `sim-esign-document-boundary`, `npx tsc --noEmit`, `npm run check:fonts` PASS.
- 최종 판정: **CONDITIONAL PASS**. 샘플·코드 반영은 완료했지만 약관·보험·회수 조건 변경이므로 실제 고객 발송 전 각 렌터카회사와 사람/법률 검토자의 최종 승인이 필요하다.
## 2026-08-11 새 공급사 허브 이전 검증

- 새 허브 `1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w`의 `공급사연동!A1:L100`을 실데이터로 확인했다.
- F열 `시트 열기`는 CSV에서 표시문구만 남으므로 J열 `그 주소(복사용)`을 원본 URL SSOT로 사용한다.
- ERP 기본 허브를 새 시트로 교체하고, 서버는 서비스 계정, 브라우저는 관리자 인증 API를 통해 비공개 허브를 읽도록 연결했다.
- 서비스 계정 실측: 공급사 17행, RP004·RP023·RP031·RP021 URL 정확 추출.
- 로그인 HTML 오인 차단 및 새 허브 파서 시뮬레이션 **3/3 PASS**. TypeScript·토큰·UI 계약 PASS.

## 2026-08-11 프리패스 표준 렌탈 약관 V9 전면 구조개편

- 기존 조문을 부분 수정하는 수준이 아니라 실제 계약 생애주기 순서로 21개 조문을 전면 재배치했다: 계약문서·체결 → 차량 인도·운전자 → 사용·관리 → 보험·위치정보 → 지급·보증금 → 사고·전손 → 연체·해지 → 반납·중도해지·주행거리·만기인수 → 정산·통지·분쟁.
- 기존 제9조 `차량 사용 제한`은 제5조 `차량 사용 원칙 및 제한`으로 이동·정리했고, 새 제9조는 `대여료 지급과 연체이자`로 구성했다. 사고 접수·수리와 전손·도난, 연체 차량보호조치와 계약 해지·차량회수를 각각 별도 조문으로 분리했다.
- 연대보증은 별도 후반 조문에서 계약문서·적용순서를 설명하는 제1조로 통합했다. 계약서 본문, 전송 약관, 중요조항 배지, 동의문서, 정책 메타데이터, 입력 도움말과 시뮬레이션의 모든 교차참조를 V9 번호로 동기화했다.
- 문서 버전은 `rental-v9-2026-08-11`이다. Pretendard 10px를 유지한 채 조문 간격과 줄높이만 조정해 약관 3쪽 6개 단을 유지했다. 단 사용 높이는 910.8~938.7px / 956.4px, 넘침 0건이며 렌더 이미지에서 겹침·잘림·고아 제목이 없음을 확인했다.
- `sim-esign-agreement` **75/75**, `sim-esign-contract-kind` **60/60**, `sim-esign-template-profile` **10/10**, `sim-chakhandeal-esign` **37/37**, `sim-esign-document-boundary`, 조문 배지 **27/27**, `npx tsc --noEmit`, `npm run check:fonts`, `git diff --check` PASS. 구형 V8 조문명·주요 교차참조 잔존 검색 0건.
- 로컬 4004 개발 서버를 정상 재시작하고 브라우저 PDF에서 V9 첫 약관 페이지와 2단 A4 배치를 직접 확인했다.
- 최종 판정: **CONDITIONAL PASS**. 구조·표현·기술 검증은 완료했지만 실제 고객 발송 전 렌터카회사와 사람/법률 검토자의 최종 승인이 필요하다.

## 2026-08-11 프리패스 버튼·하단바 업무동선 보완

- 검증 요구사항: 프리패스 ERP의 버튼 위치와 하단바가 실제 업무 순서를 따르고, 모바일에서도 이전·보조 행동·핵심 실행이 겹치지 않아야 한다.
- 공통 `BottomNav`에 실행바 식별자를 추가하고 `이전(왼쪽) → 보조 행동 → 핵심 실행(오른쪽)` 순서와 폭을 통일했다.
- 상품 상세 모바일에서 검수요청·공유는 아이콘형 보조 행동으로 줄이고, 계약문의는 우측의 넓은 핵심 버튼으로 유지했다. PC에서는 검수요청 옆 사진 전체받기와 기존 텍스트 라벨을 유지한다.
- 일반 상세 `DetailShell`은 모바일에서 상단 실행/하단 이전으로 갈라지던 구조를 제거하고 이전과 실행을 동일 하단바에 배치했다. 안전영역만큼 본문 하단 여백도 함께 확보했다.
- `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `git diff --check` PASS. 로컬 `http://localhost:4004/` HTTP 200 확인.
- 저장소에는 `test` 스크립트가 없어 `npm test`는 실행 대상이 아니었다.
- 최종 판정: **PASS**.

## 2026-08-11 프리패스 표준 렌탈 약관 V10 — 공정위 표준약관형 재구성

- 공정거래위원회 자동차대여 표준약관의 28개 조문 흐름을 뼈대로 삼아 장기 월렌트에 맞게 전면 재구성했다. 목적·계약신청·체결·대체차량·요금·보험·인도·관리·금지행위·사고·반납·정산·분쟁 순서를 유지하되 단기 예약금·시간대별 환불 규정은 장기렌트의 월 대여료·보증금·중도해지·초과주행·만기인수 기준으로 치환했다.
- 프리패스 핵심 조건인 만 21세 이상 운전자, 사고일 기준 직전 1년 내 과실 50% 이상 사고 총 3회, 회사별 보험·공제 조건, 자차 자기부담액의 실제 수리비 상한, 중고차 통상 사용흔적과 미고지 중대하자 구분, GPS 차량보호조치, 초과주행 및 만기인수를 28개 조문에 통합했다.
- 인쇄 템플릿, 전자계약 전송 약관, 중요조문 강조, 동의화면 조항 배지, 공급사 정책 입력표와 도움말의 교차참조를 V10 번호로 동기화했다. 사고다발 횟수는 정책별 임의값이 아니라 프리패스 표준 3회로 고정했다.
- 문서 버전은 `rental-v10-2026-08-11`이다. Pretendard를 유지하고 약관 본문 10.1px·2단 자동 페이지네이션을 조정해 약관 3쪽 6개 단을 858.0~921.7px / 956.4px로 채웠으며 넘침 0건이다. 전체 9쪽 PDF를 PNG로 재렌더링해 표, 약관, 동의·서명 페이지의 겹침·잘림·깨진 글자와 고아 제목이 없음을 확인했다.
- `sim-esign-agreement` **39/39**, `sim-esign-contract-kind` **60/60**, `sim-chakhandeal-esign` **37/37**, `sim-esign-template-profile` **10/10**, `sim-esign-document-boundary`, 조문 배지 **27/27**, `npx tsc --noEmit`, `npm run check:fonts` PASS.
- 최종 판정: **CONDITIONAL PASS**. 공정위 표준약관의 구조를 참고해 만든 프리패스 장기렌트 약관이며 공정위 승인 표준약관 자체는 아니다. 실제 고객 발송 전 각 렌터카회사와 사람/법률 검토자의 최종 승인이 필요하다.

## 2026-08-11 프리패스 공통 상·하단 작업바 2차 통합

- `TopBar`가 별도로 그리던 모바일 이전 바를 공통 `BottomNav`로 교체해 탭바 간격, 안전영역, 높이, 그림자와 뒤로가기 동작을 한 규격으로 맞췄다.
- 일반 목록의 `MobileListDock`도 `fp-action-dock` 계층을 사용하도록 연결하고 액션을 직접 배치해 보조 버튼은 작게, solid 결정 버튼은 남는 폭을 쓰도록 통일했다.
- 모바일 상단 제목은 `min-width: 0`으로 정상 말줄임하고 우측 액션은 잘라 숨기지 않도록 유지했다. React 검수에서 새 훅, 비직렬화 경계, 비동기 waterfall 또는 접근성 회귀는 발견되지 않았다.
- `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `git diff --check` PASS. 로컬 `http://localhost:4004/login`을 394px 폭에서 직접 새로고침해 렌더링과 콘솔 오류 0건을 확인했다.
- 최종 판정: **PASS**.

## 2026-08-11 상품찾기 데스크톱 툴바 반응형 보완

- 필터가 열렸을 때의 실제 상품 목록 폭을 기준으로 반응하도록 `FinderToolbar`에 CSS 컨테이너 쿼리를 적용했다. 화면 전체 폭이 같아도 필터 열림·닫힘에 맞춰 툴바가 자체적으로 재배치된다.
- 목록 폭이 좁아지면 결과 설명, 최근·관심·문의 라벨, 간단·상세·엑셀 라벨 순서로만 축약하고 검색창·정렬·필터·보기 전환 기능은 유지한다. 비활성 구글시트 예약 슬롯은 가장 좁은 구간에서만 해제한다.
- 검색 입력의 인라인 최소 폭을 제거하고 그룹 단위 최소 폭으로 관리해 필터를 열어도 공급사 검색어와 핵심 액션이 잘리지 않도록 했다. 기본 정렬은 기존 `FINDER_DEFAULT_SORT='asc'`와 실제 옵션을 유지했다.
- `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `git diff --check`, 로컬 로그인 경로 HTTP 200 PASS.
- 최종 판정: **PASS**.

## 2026-08-11 전 메뉴 정렬 기본값·작업면 비율 보완

- 공통 웹 목록 정렬기가 `기본`이라는 임의 옵션을 생성하던 경로를 제거했다. `defaultValue`가 있으면 빈 선택지를 노출하지 않고, 없으면 중립적인 `정렬` 안내만 노출한다.
- 공통 모바일 정렬 시트도 `기본` 문구를 제거했다. 초기화 버튼은 메뉴가 지정한 실제 기본 옵션명(상담데스크는 `최근순`)을 표시하고 해당 값으로 복원한다.
- `WorkPage`는 작업 패널이 하나일 때 목록 1 : 작업면 3을 기본으로 사용한다. 패널이 여러 개면 목록과 각 업무 패널을 동일 비율로 유지해 계약·재고·회원의 4분할 구조는 바뀌지 않는다.
- 공통 컴포넌트에서 남은 사용자 노출용 `기본` 정렬 문구 0건을 확인했다. `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `git diff --check`, 로컬 로그인 경로 HTTP 200 PASS.
- 최종 판정: **PASS**.

## 2026-08-12 관리자 상담데스크 처리 신호 강화

- 상담 목록의 기존 상태 판정은 유지하면서 `미확인` 행에는 amber, 읽었지만 답하지 않은 `미회신` 행에는 red 처리선을 행 전체 왼쪽에 표시하도록 공통 `FeedListRow`에 선택적 강조 톤을 추가했다.
- 미확인은 숫자 뱃지와 황색 경고 아이콘, 미회신은 빨간 아이콘·`미회신` solid 뱃지·적색 처리선으로 서로 다른 상태를 유지한다. 선택 행 배경은 인라인 우선순위로 보존되어 현재 선택과 처리 상태가 섞이지 않는다.
- `sim-chat-attention`에서 미확인·미회신·회신완료 판정, 전체 기본 필터, 최근순 기본 정렬, 최근 메시지 정렬, 미회신 필터를 모두 통과했다.
- 이전 정렬 UI 구조 변경에 맞춰 `check-menu-sort-defaults`를 갱신했고 웹·모바일에서 이름 없는 `기본` 옵션이 다시 생기지 않는 검사까지 포함해 모두 PASS.
- `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `git diff --check` PASS. 시뮬레이션의 Firebase 환경변수 경고는 로컬 셸에 운영 환경변수를 주입하지 않은 안내이며 순수 상태 판정은 통과했다.
- 최종 판정: **PASS**.

## 2026-08-12 프리패스 전자계약 실제 발송동선·보험정책 안전 게이트

- 관리자 전자계약에서 `프리패스모빌리티 주식회사`를 실제 선택해 공급사 전용 정책만 조회되는 동선을 확인했다. 현재 프리패스 공급사에는 연결 정책이 없어 임의 조건으로 계약을 만들지 않고 발송을 차단한다.
- 정책관리의 공급사코드 직접입력을 계약회사명 드롭다운으로 바꿨다. 보험사·공제조합은 다른 담보와 같은 보험 패널에서 입력하며, 대인Ⅰ·대물 2천만원·자손/무보험/자차 미가입처럼 실제 증권에 존재할 수 있는 명시값을 선택할 수 있다.
- 프리패스 기본정책에서 보험사, 보상한도, 면책금, 자차 자기부담률·하한·상한, 긴급출동의 임의 기본값을 제거했다. 보험포함 계약은 담보가 없더라도 `미가입`·`없음`으로 명시해야 하며 빈칸이면 초안 검토와 링크 발행을 막는다.
- 고객 확인 화면은 차량번호·모델명만 표시하고, 만기 조건은 `만기 처리` 한 줄로 통합했다. 렌트 문서 제목은 `자동차 장기대여 계약서`로 통일했다.
- `npx tsc --noEmit`, `npm run check:fonts`, `sim-freepass-esign`, `sim-esign-contract-kind` **60/60**, `sim-esign-agreement` **44/44**, `sim-esign-issue-gate` **5/5**, `sim-esign-snapshot` PASS. Chrome 관리자 세션에서 `/esign` 공급사 연동 차단과 `/policy` 계약회사 드롭다운·보험 입력항목을 직접 확인했다.
- 최종 판정: **CONDITIONAL PASS**. 전자계약 시스템 동선과 안전 게이트는 준비됐지만, 프리패스 명의 또는 실제 계약 렌터카사의 가입증권·자차면책 규정으로 정책을 확정하기 전에는 고객 링크를 발행하면 안 된다.

## 2026-08-12 전자계약 직원입력·고객 본인확인 완료본 연결

- Google Drive의 `프리패스모빌리티계약현황.xlsx`와 실제 자동차보험 가입증명서 3건을 대조했다. 계약현황에는 여러 렌터카사·보험사가 함께 있고, 같은 스위치플랜 안에서도 차량별 운전자 연령과 자차 가입 여부가 달랐다. 공탁보증보험 증권은 자동차보험 근거에서 제외했다.
- 계약회사 선택지에 연결 정책 수 또는 `정책 필요`를 표시하고, 선택한 회사의 정책만 드롭다운에 노출한다. 정책명과 함께 보험사·연령·자차·발송 가능 상태를 표시하며, 정책 없음/미완성은 정책관리 이동과 함께 차단한다.
- 직원 직접입력은 계약일·고객명·연락처, 차량번호·모델명·옵션, 대여기간·월 대여료·보증금 중심으로 축소했다. 사업자·인수형·건별 특약은 접어서 해당 계약에서만 입력한다. 월 납부일은 회사별 정책값(`payment_due_date`)으로 자동 적용한다.
- 고객 링크에서 주민등록번호 13자리와 주소를 필수 확인하고 운전면허증·셀카를 첨부한다. 면허번호 별도 입력은 제거했다. 주민번호·주소는 공개 계약 노드나 발행 세션에 복제하지 않고, 관리자 승인 시 완료 PDF 스냅샷에만 합성한다.
- `npx tsc --noEmit`, `npm run check:fonts`, `sim-esign-signed-snapshot`, `sim-freepass-esign`, `sim-esign-agreement` **44/44**, `sim-esign-issue-gate` **5/5**, `git diff --check` PASS. Chrome `/esign`에서 핵심 입력 축소, 회사별 정책 개수, 프리패스 정책 없음 차단, 정책 상세 라벨을 직접 확인했다.
- 최종 판정: **CONDITIONAL PASS**. 입력·본인확인·완료본 연결은 준비됐다. 고객 링크 발행은 실제 계약회사의 차량/보험 프로필 정책이 등록되고 계약회사 사업자·대여업 등록정보가 채워진 뒤에만 가능하다.

## 2026-08-12 정책등록 프리패스 기본 패키지 추적

- `정책 등록`을 누르면 `freepass-standard-2026-08-12-v3` 패키지의 확정 기본값 44개가 즉시 입력되고, 적용 버전이 `policy_default_pack`에 함께 저장되도록 검증했다.
- 보험사·보상한도·면책금·긴급출동·탁송비 등 공급사별 실제 증권과 조건이 필요한 15개는 임의값을 만들지 않고 `공급사 확인 필요` 안내로 분리했다. 이 중 전자계약 필수 14개가 비어 있으면 발송 게이트가 계속 차단한다.
- 패키지는 정책에 최초 한 번만 적용한다. 적용 뒤 공급사가 항목을 삭제하거나 미사용으로 비워 저장하면 재조회·상품 조인·계약 payload 생성 과정에서 기본값이 되살아나지 않도록 패키지 스탬프를 기준으로 보존한다. 공급사의 명시 입력값도 덮어쓰지 않는다.
- `preview-policy-defaults`에서 기본값 44개, 공급사 확인 15개, 전자계약 미충족 14개, 패키지 스탬프, 명시값 우선, 삭제·미사용 보존을 모두 확인했다.
- `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `git diff --check` PASS.
- 최종 판정: **CONDITIONAL PASS**. 자동입력·삭제 보존·발송 차단 구조는 통과했다. 실제 보험·면책·탁송 값 확정 및 운영 게시 전에는 공급사/사람의 최종 승인이 필요하다.

## 2026-08-12 소속 없는 영업자 자가가입 즉시 이용

- 기존 가입은 `status=pending`으로 저장되어 화면과 RTDB 모두 관리자 승인 전까지 차단했다. 사용자 요구에 맞춰 신규 계정은 회사·채널 권한 없이 `role=agent`, `status=active`로 생성하고 상품찾기·본인 상담·본인 계약을 즉시 이용하도록 변경했다.
- 자가가입 `user_code`는 충돌 가능한 순번이나 공유 `SP999`가 아니라 Firebase UID로 고정했다. Rules도 최초 `agent + active + user_code=auth.uid` 조합만 허용하고 회사·채널 자가 입력과 user_code 사후 변경을 금지한다. 관리자는 이후 실제 소속 확인 뒤 별도 재배정할 수 있다.
- 가입 화면에서 회사명·활동유형·사업자번호는 선택 정보로 내리고 즉시 이용·후속 소속 연결을 명확히 안내했다. 이름은 실제 상담방 생성에 필요하므로 명시적 필수 검증을 추가했다. 개인정보처리방침도 실제 필수/선택 수집 항목에 맞춰 `2026-08-12` 버전으로 갱신했다.
- `check-self-serve-signup` 12항목, `sim-release-blockers` **17/17**, `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `git diff --check` PASS.
- 인앱 브라우저 `http://localhost:4004/login`에서 가입 폼을 직접 열어 즉시 이용 문구, 선택 소속 필드, 필수 4필드, 콘솔 오류 0건을 확인했다. 390×844에서도 가로 넘침·잘린 컨트롤 0건이며 하단 가입 버튼까지 정상 스크롤된다.
- 최종 판정: **CONDITIONAL PASS**. 앱·로컬 Rules 정합성은 통과했다. `database.rules.json`과 개인정보 문서가 포함되므로 사람/Claude의 실데이터·법률 게이트 전에는 Rules 게시 및 운영 배포 금지다.

## 2026-08-12 계약문의 빈 방 자동생성 차단

- 상품 상세 진입 시 `ensureRoom()`을 실행하던 흐름을 읽기 전용 `findExistingRoom()`으로 교체했다. 방이 없으면 채팅 대신 `계약문의 시작`을 표시하고, 사용자가 시작 버튼이나 실제 출고문의를 눌렀을 때만 방을 생성한다.
- 출고문의로 생성한 계약은 같은 방에 즉시 연결하고 `fp:unread`로 상세·계약문의 목록을 갱신한다. 상품코드나 영업자 코드가 없으면 `CH_undefined_*` 형태의 고아 방 키를 만들지 않는다.
- 계약 연결·메시지 메타·안읽음이 전혀 없는 빈 방 셸은 계약문의 일반 목록과 숫자, 상품의 `문의중`, 공급사·관리자 상세 문의 목록에서 제외한다. `전체`·`미확인`·`미회신`·`내 차례`와 햄버거/탭 뱃지가 모두 같은 활동 방 집합을 쓰도록 `activeChatRooms()`로 통일했다.
- 명시적인 `?room=` 딥링크는 빈 방도 작업면 선택을 유지해 첫 메시지를 작성할 수 있게 하고, 일반 검색·필터에서 사라진 선택만 닫는다. 계약 인덱스로 복원되는 레거시 방도 보존한다.
- `sim-chat-attention` **19/19**, `sim-chat-room-dedupe` **37/37**, `sim-release-blockers` **17/17**, `sim-test-contract` **6/6**, `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `git diff --check` PASS.
- React 검수에서 상세 방 조회 effect는 상품코드·역할의 원시값 의존성만 사용하고 이벤트 리스너를 cleanup하며, 명시 액션은 버튼 핸들러에 유지했다. 로컬 `http://localhost:4004/`는 로그인 화면으로 정상 리디렉션됐고 앱 콘솔 오류는 없었다. 인증 세션이 없어 상품 상세의 실클릭 검증은 순수 상태 시뮬레이션으로 대체했다.
- 최종 판정: **PASS**. 기존 빈 방 레코드는 삭제하지 않고 표시만 제외하므로 데이터 파괴나 Rules 게시이 없다.

## 2026-08-12 테스트 역할 제거·상품 보기 전환 재검수

- 루트 레이아웃의 좌측 하단 `테스트 역할` 스위치와 전용 컴포넌트·도메인을 제거했다. 버튼만 숨기지 않고 `getRole()`의 `fp4_dev_role` 덮어쓰기도 제거해 브라우저에 남은 과거 값이 실제 세션 역할 화면을 조용히 바꾸지 못하게 했다.
- 상품찾기의 `간단·상세·엑셀`은 서로 다른 업무 액션이 아니라 같은 상품 목록의 표시 방식 선택기다. 단일 세그먼트와 선택 강조는 유지하고 `상품 보기 방식` 접근성 그룹을 부여했다.
- 저장된 보기 값은 `card | list | excel`만 복원하도록 검증해 손상되거나 구버전 값 때문에 실제 엑셀 표와 선택 표시·카운트가 어긋나는 경우를 차단했다. 기본 보기 `excel`, 모바일 `card` 규칙은 그대로다.
- `npx tsc --noEmit`, `npm run check:fonts`, `npm run check:tokens`, `npm run check:ui`, `sim-release-blockers` **17/17**, `git diff --check` PASS. React 검수에서 추가 비동기 요청·전역 이벤트·리렌더 구독은 없고, 보기 변경은 기존 사용자 이벤트 핸들러와 `useDeferredValue` 경계를 유지했다.
- 인앱 브라우저 `http://localhost:4004/login`을 새로고침해 `테스트 역할` 표시 0건과 콘솔 오류 0건을 확인했다. 인증 세션이 없는 브라우저라 상품목록 실클릭은 소스·타입·UI 계약 검증으로 확인했다.
- 최종 판정: **PASS**.
