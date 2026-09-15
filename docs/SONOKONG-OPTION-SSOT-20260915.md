# 손오공 옵션 SSOT 반영 기록 — 2026-09-15

운영 기준: [픽업구독 원천·옵션 SSOT 매뉴얼](픽업구독-원천-옵션-SSOT-매뉴얼.md). 사용자 요청으로 재고/요금=손오공, 옵션 확인=티카를 명문화했다. 매뉴얼 SHA256 `5F75431C5295C903286B666C69B049DD4A45FF5C2B8C9F4021AB5BA084DC8ADE`. Codex 코드·원천 경로 대조 OK, Cursor 독립 검토 명시적 OK(원천 구분·빈 목록 의미·미구현 표시 동의). Claude 주간한도, Gemini 신뢰설정 거부로 검토 불가. Cursor 추가 검토의 원천/결과물 혼동 우려를 반영해 표를 분리하고 미구현 고지를 첫 절로 옮겼으며 수정본 명시적 OK를 확보했다. 문서 연결 변경에 대한 diff 검사 통과. 문서 작성은 추가옵션 복구·운영 배포 완료가 아니다.

## 픽업구독 재검사 — 기존 완전성 판정 정정

- 사용자 재검사 요청으로 F01 픽업구독 `09.15 09:40` C/AB열을 실조회: 차량238대, 옵션값184대, 빈칸54대.
- 빈칸54대 재조회: 동일 현재번호판 티카 상세46대 HTTP200, 상세 미확보8대. 46대 모두 `paidOptList=[]`이나 `formData.carOptList`에는 장착옵션18~63개가 있다. 빈 유료목록은 차량 옵션 없음의 증거가 아니다.
- 46대 판매자 설명 `formData.carInfo.memo`를 추가 대조: 추가옵션 표제9대 중 2대는 기본장비/트림 혼재로 모호하다. 나머지7대는 명시적인 추가옵션 설명이 있는데 시트는 빈칸이다. 출고사양 독립확인이 아닌 판매자 원문 근거이며, 구조화 유료목록과 다른 출처다.
- 확인된 누락: AB126 KRELL프리미엄사운드, AB135 AWD, AB191 파노라마선루프, AB193 주차보조시스템2·현대스마트센스1, AB200 듀얼선루프, AB234 빌트인캠, AB238 트윈스윙 도어.
- carId374317 실제 브라우저에서 현재번호판 및 `추가옵션 / KRELL프리미엄사운드` 표시를 확인했다.
- 따라서 아래 과거 PASS는 당시 제한된 필드 사이의 일치만 의미한다. 옵션 수집 완전성 PASS가 아니며, `paidOptList=[]`에 근거한 선택옵션 없음 해석은 철회한다. 전체 누락 없음은 HOLD다.
- 이번 재검사는 DB/시트 쓰기 없이 수행했다. 근거: `tmp/son-options-20260915/pickup-blanks.json`, `pickup-recheck-results.json`, `pickup-detail-<row>.json`, 재현스크립트 `recheck-pickup.mjs`.
- 교차검토 v2: 네 역할 요청. Codex 원문/시트/브라우저 대조 OK, Cursor 명시적 OK: 누락 정정과 출처 분리 동의, 판매자 설명을 출고사양 검증으로 승격하지 말 것. Claude 주간한도, Gemini 폴더 신뢰 거부는 실제 요청 실패로 통과에 포함하지 않는다. 이 OK는 읽기 전용 재검사 결론에 한정한다.

## 현재 최종 결과 — 2026-09-15 오전

**Firestore 129문서 적용 / 검증250대 재대조 same250·changes0 / 미확인41대 HOLD 보존. F01 62셀·F86 21셀 반영 및 재조회 PASS.**

- 소스 통합 커밋: `3007cd5a`.
- 운영 main 반영 커밋: `e0770d67` (`fix: keep verified Sonokong options in hourly sync`). 통합 실행 작업이 운영 반영을 보고했고, 이 문서 갱신 시 로컬에서 해당 커밋 존재를 확인했다. 배포 실행 주체와 이 세션의 독립 DB/시트 검증을 구분한다.
- 최종 표시 재조회: F01 손오공구독 옵션10건·픽업구독 옵션184건, F86 비어 있지 않은 옵션 셀258건. F86 수에는 보존된 미확인 기존값도 포함되므로 원천검증 차량 수로 해석하지 않는다.
- Cursor 최종 통합 범위 OK. Claude는 주간 사용량 한도, Gemini는 신뢰 설정 거부로 검토 불가였으며 통과로 세지 않았다.

아래 최초 결과의 169대/122대 미확인은 후속 조사로 갱신됐다.

- 원인: 티카 HTML의 첫 `plateNumber`를 읽던 코드가 검사자료의 과거 번호판을 현재 번호판으로 오인했다. 현재 차량정보 `formData.carInfo`를 우선하고 검사자료 정규식 fallback을 제거했다.
- 티카 직접 검증 169→240대, 누락 71대 복구. 이 중 선택옵션 값 있음 58대, 확인된 빈 목록 13대. 티카 옵션 있음은 총194대.
- 다른 동시 SSOT 작업과 단일 DB writer로 조율했다. 그 작업이 추가로 확인한 손오공 `carOptionNote` 10대는 티카와 별도 출처로 저장했다. 통합 검증250대, 원천미확인41대 보존.
- DB 통합 적용129문서(실제 options 변경75, 나머지 근거 보강). 이 세션의 복구71대가 전부 포함됨을 적용 전 대조했고, 적용 후 실Firestore71대의 옵션과 근거 일치/차이0을 독립 검증했다.
- 이어 이 세션이 F01 옵션62칸(빈칸→값), F86 옵션21칸(검증빈목록11·문구교체10)을 직접 반영했다. 총83칸이며 최초 작업28칸과는 별도다.
- 최종 재조회: F01 검증대상240행, F86 검증대상223행의 옵션 불일치0. 차량번호·변경칸 서식·validation 유지. 나머지 옵션 셀은 보존했다. 전체 원천의 완전성이나 미확인41대까지 통과했다는 의미가 아니다.
- 코드 통합 커밋 `3007cd5a` (`fix: recover verified Sonokong selected options`) 확인. 현재번호판 회귀18/18, 실제 원천 샘플2개 재현, TypeScript 검사 PASS.
- 독립 Cursor는 현재번호판 수정 OK 및 최종 통합 범위(manifest `8dad5f4c5336563c5372cea4b5da6a4f1333cffd2e34bc85234370d82e4c536b`) OK. Claude 주간한도/Gemini 신뢰거부는 이번에도 실제 요청 실패로 기록하며 통과로 세지 않았다.
- 미실행 개별 writer 초안의 source ID OR 조건에 대한 Cursor 반대는 실제3대 대조로 처리했다. 모두 과거/현재 원천의 차량번호가 같았고 통합 writer는 현재 source row를 우선하며 과거원문을 보존한다. 개별 writer 초안은 실행하지 않고 tmp로 이동했다.

후속 증거:

- `tmp/son-options-20260915/recovered-71-independent-readback.json`: 이 세션의 실DB 독립 재조회.
- `tmp/son-options-20260915/receipt-1789434394100.json`: 통합 DB writer129문서 영수증.
- `tmp/son-options-20260915/recovery-sheets-final-prewrite.json`: 두 시트 직전 셀·서식 스냅샷과 정확한83개 요청.
- `tmp/son-options-20260915/recovery-sheets-final-receipt.json`: Google 응답 및 최종 셀·차량번호·서식 재조회.
- `tmp/son-options-20260915/unfiltered-results.json`: 남은51대 공개검색 재조회. 다른 작업의 손오공 원문10대 추가 확인 후 최종 미확인은41대다.

## 최초 작업 기록 (후속 복구 이전)

### 당시 결과

상태: 검증된 범위 반영 완료 / 전체 일치 HOLD.

- 정본 연결: `freepasserp5` Firestore `(default)/products`, `provider_company_code=RP012`.
- 실행 코드 기준: `codex/source-registry-current`, HEAD `51579168fc7a716e7a7b36581fc7a01110ae548f`.
- 손오공 수집기에서 티카 직접 상세와 차량번호를 재검증했다. 최신 목록 291대 중 검증된 169대(옵션 있음 136, 확인된 빈 목록 33)의 옵션·근거는 Firestore와 전부 동일했다. DB 변경은 0건.
- 나머지 최신 원천 122대는 직접 유료옵션 근거 미확인이다. 없음으로 확정하거나 빈 값으로 DB를 덮지 않았다.
- F01 상품리스트에서 손오공 293행의 옵션 표시가 Firestore와 일치했다. F01 변경 0건.
- F86 손오공 탭의 옛 옵션 표시 176칸 중 최신 티카 원문이 빈 배열이고 Firestore PASS인 28칸만 비웠다. 수정 후 28칸 값·차량번호·서식 재검증 PASS. 그 외 옵션 칸 보존 확인.
- F86의 나머지 148칸(HOLD 134 / 근거 상태 없음 14)은 보존했다. 이 모집단은 최신 원천 122대와 다르므로 합산하지 않는다.

### 당시 출력 시트

- [F01 프리패스 상품리스트](https://docs.google.com/spreadsheets/d/1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs/edit): 손오공구독, 픽업구독, 상품리스트의 RP012 행만 대조.
- [F86 하허호 상품시트](https://docs.google.com/spreadsheets/d/1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg/edit#gid=1505044382): `손오공 09.11 16:44:05 · 297대`, P열 옵션(원문), 정확한 28개 셀만 수정.

### 당시 검증과 보존

- `sonokong/scripts/test-option-normalizer.mjs`: 옵션 규격 5/5, 상세 원문·번호판 매칭 9/9 PASS.
- `sonokong/scripts/audit-tcar-paid-options.mjs`: 직접 원문·동일 번호판 조건 PASS. 이 PASS는 122대의 근거 공백 해소를 뜻하지 않는다.
- `scripts/audit-sonokong-option-ssot.mts`: 읽기 전용. 프로젝트 고정, 중복/식별자/원천시각 확인, 옵션 원문과 실제 Firestore 대조. 객체 키 순서 차이는 데이터 차이로 세지 않는다. 외부 쓰기 모드 없음.
- `tmp/son-options-20260915/source-before.json`: 수집 전 로컬 원본 보존.
- `tmp/son-options-20260915/sheet-before-and-plan.json`: 수정 전 셀·Firestore 비교와 최초 차이 목록.
- `tmp/son-options-20260915/approved-scope-plan.json`: 최종 28칸 범위. 파일명은 실행 범위 기록이며 추가 사용자 승인 기록을 의미하지 않는다.
- `tmp/son-options-20260915/sheet-write-receipt-and-readback.json`: Google batch 응답 28건과 재조회 결과. 값 외 서식 변경 없음.
- 전체 발행, 가격·상태·차량 생성·삭제, RTDB, 배포, 예약작업 변경 없음. 현재 예약 발행의 지속 실행까지 검증한 것은 아니다.

### 당시 독립 검토

최종 동일 범위: SON-OPTIONS-20260915-v3.

- Codex: 최신 원천→Firestore→F01/F86 직접 대조, 변경 직전 DB·셀 재조회 및 변경 후 검증 OK.
- Cursor Agent: 176칸 일괄 정리를 HOLD로 판단. 근거 없는 빈 값을 없음으로 단정할 위험을 반영해 28칸으로 축소했고 최종 범위 명시적 OK 확보.
- Claude Code: 최종 범위 요청 실제 시도, 주간 사용량 한도로 실패(1pm Asia/Seoul 재설정 안내). 검토 OK로 세지 않음.
- Gemini CLI: 최종 범위 요청 실제 시도, 작업 폴더 신뢰 거부로 실행 실패. 기존 `c:/ DO_NOT_TRUST` 설정을 우회하지 않음. 검토 OK로 세지 않음.
- 네 역할 요청, 두 역할 명시적 OK는 28칸 반영에 한정한다. 148칸 미확인은 계속 HOLD.

### 당시 남은 일 (현재 상태는 문서 맨 위 기준)

148칸은 각 차량의 직접 제조사 선택옵션 원문과 현재 차량번호를 확인해 옵션 값을 확정한 뒤 Firestore→시트로 반영한다. 확인되지 않은 기존 시트 글자를 정본으로 승격하거나, 빈 Firestore만으로 지우지 않는다. 최신 수집 경로는 이 작업 폴더의 `sonokong/lib/option-normalizer.mjs`와 `sonokong/scripts/손오공.mjs`이며, 과거 ERP4 작업 폴더의 구형 수집기를 실행하지 않는다.
