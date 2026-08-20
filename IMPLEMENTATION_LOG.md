# 구현 로그

## 2026-08-20 — ⛔보증금 있는 계약을 아예 못 만들던 버그 + 전자계약 테스트용 샘플 공급사 (Claude)

- **버그(배포본에 있던 것)**: 저장 전 초안 검증이 «화면에서 고른 값»을 못 봤다. 화면은 `draft.depositInstallment` 에 담고 검증기는 계약 레코드와 같은 자리(`contract_draft`)에서 읽는데, `draftInputRecord` 가 그 다리를 안 놓았다 → **보증금 > 0 인 계약은 회차를 골라도 「일시납 또는 분납 회차를 선택해 주세요」가 안 사라지고 「계약서 만들기」가 영원히 비활성**. 저장된 계약은 정상이라(`draftTemplateFields` → `contract_draft`) 발송 게이트 측정에서도 안 잡혔고, 샘플 공급사로 화면을 끝까지 눌러 보다 드러났다.
  - 고침: `draftInputRecord` 가 저장 때와 **같은 모양**으로 `contract_draft` 를 싣는다. 재발 방지 `scripts/sim-esign-draft-gate.mts`(회차 미선택 차단 · 고르면 해제 · 정책 밖 회차 차단 · 무보증 예외 · 다리 자체 검사) — 고치기 전 코드에서 실제로 실패함을 확인.
- **샘플 공급사 한 벌**(`scripts/seed-sample-supplier.mts`): 「[샘플] 프리패스테스트렌터카」(SAMPLE01) + 정책 POL-SAMPLE(시트 57/65항목·미기재 0) + 가상 차량 2대(00가0001 아반떼 · 00가0002 K5, 24/36/48개월). 임대인 정보·정책이 다 채워져 있어 전자계약을 끝까지 돌려볼 수 있다. dry-run 기본 · `--apply` 로 생성 · `--remove` 로 삭제 · **만들기 전에 발송 게이트를 스스로 확인**하고 막히면 반영하지 않는다. ⚠ 출고가능이라 영업자 상품찾기에도 보이므로 이름을 전부 「[샘플]」로.

---

## 2026-08-20 — 전자계약 작성 순서 4단(회사→차량(정책)→기간별 대여료→조건) (Claude)

사장님: 「회사 선택 - 차량선택(정책없으면 정책까지 선택) - 기간별대여료선택 - 조건(운전연령, 주행거리 등) 선택」. 정본 `docs/ESIGN_SEND_CENTER_REDESIGN_2026-08-19.md §2-4-1`.

- 카드 재배치: 1 회사(공급사만) · 2 차량 + 계약정책 · 3 기간별 대여료(기간·대여료·보증금·납부·회차) · 4 조건(운전자 연령·약정주행거리·운전자 범위·정비상품·특약). 게이트/스크롤 앵커도 4단(`draftBaseReady → draftVehicleReady → draftRentReady → draftReachedReview`).
- **계약서 종류 select 폐지** — 차량 상품구분 × 정책 보험조건으로 `templateForKindAndInsurance()` 가 정하고 카드 2에 뱃지로 표시. `draftTemplate` 은 파생값, `draft.standardTemplateId` 는 effect 로 동기화.
- **차량이 정책을 데려온다** `resolveVehiclePolicy()`(신설): 차량 정책코드 → 「(프리패스 기본)」/미존재면 그 상품구분의 공급사 정책이 하나뿐일 때만 → 아니면 미정(카드 2에서 선택). 실측: 출고가능 276대 중 ERP 정책으로 이어지는 건 135대(49%), 114대가 시트 라벨 「(프리패스 기본)」, 21대가 없는 코드 `RP006_WEB`.
- 차량 검색은 회사만으로 열린다(`searchContractVehicles` 의 template 이 선택 인자로). 접힘의 중복 칸(약정주행거리·운전자 범위·정비상품) 제거 — 카드 4로 이관.
- 「정책관리에서 바로 수정」 → **「파트너사관리에서 정책 수정」**(`partnerPolicyManageUrl` → `/members?tab=partner&partner=…&policy=…`) — 정책관리 페이지는 메뉴에서 뺐으므로.
- 검증: tsc ✓ · sim 20종 ✓(vehicle sim 에 차량→정책 승계 4갈래 박제, esign sim 을 4단 순서로 갱신) · check:ui 는 다른 세션 AppTabBar 1건만 · Playwright 실측(회사→차량→대여료→조건 왕복, 콘솔 오류 0).
- **정비 드롭다운 5갈래**(사장님 2026-08-20 「미제공 / 연1회오일 / 연2회오일 / 제공 / 협의 · 프리패스 표준은 미제공」): 정비는 «있다/없다»가 아니라 «어디까지»다 — 오일교환만 해 주는 곳이 많다. `policy-value-spec` 정본 갱신(옛 「포함」→제공 · 「불포함」→미제공 동의어로 접어 읽음) → 21곳 시트 재적용 + `normalize --apply`(정비 20칸 고침·검토 0) → 매뉴얼 재생성. ERP 정책관리 선택지는 `sheetOpts('정비')` 라 따라옴.
- **프리패스 표준 심사조건 = 무심사**(사장님 2026-08-20): `POLICY_PREFILL.심사조건 = '무심사'`(ERP 표준값 POLICY_DEFAULTS 는 이미 무심사). 이미 가로 규격인 시트는 값을 다시 안 쓰던 탓에 기본줄이 비어 있었다 → `transpose` 에 **기본줄 빈칸만 PREFILL 로 채우는** 단계 추가(채운 칸·공급사 줄은 안 건드린다). 21곳 전부 1칸씩 채움.
- **⑩ 제출서류에 「필요서류 1~4」 직접 입력칸**(사장님 2026-08-20 「정책칸에 필요서류 1 2 3 4 추가로 직접 입력하게 · 공급사시트 전체로」): 자유 입력 「기타서류」 한 칸 → 네 칸(불가조건 1~4 와 같은 모양). 체크 6 + 필요서류 4 가 함께 `esign_required_documents` 하나로 접힌다. 옛 「기타서류」 값은 `POLICY_FIELD_RENAMES` 로 「필요서류 1」에 이어 읽는다. 시트 **61열**로 21곳 재적용 · 파트너사관리 인라인 편집기도 같은 네 칸(폼=시트 대조 sim 통과).
- **발송 게이트가 「즉시출고」를 막던 버그**(2026-08-20 실측에서 잡음): 차량 목록은 `isContractAvailableVehicle`(즉시출고=출고가능)로 뽑는데 게이트(`esignProductAvailabilityBlocker`)는 「출고가능」만 통과시켜, 고를 수는 있는데 못 보내는 차가 있었다 → 같은 규칙으로 맞추고 sim 에 박제.
- **막는 이유를 «그 단계»에서 바로**(사장님 2026-08-20 「전자계약 돌릴 거면 거기서 뭐 없어서 안 된다 이런 표시 해주지?」): 공급사 목록 라벨에 「⚠ 회사정보 N개 필요」 · 회사를 고르면 카드 1 에 「○○ — 계약서를 만들 수 없습니다」+빠진 항목+「파트너사관리에서 ○○ 정보 입력」 · 정책을 고르면 카드 2 에 「이 정책에 빠진 값」+정책 편집 버튼. 임대인 검사는 `esignPartnerChecks(partner)` 로 뽑아 계약 검증과 같은 함수를 쓴다(이유를 두 곳에 안 적는다). 예전엔 4장을 다 채워야 알았다.
- **「손님 화면 따라보기」 오버레이**(사장님 2026-08-20 「손님한테 날아가는 화면을 팝업으로, 다음 다음 다음 자동으로 되게끔 관리자가 보면서 말해줄 수 있게」): `components/EsignCustomerWalkthrough.tsx` — 폰 프레임 iframe(고객 링크 `?preview=1`, 열람·제출 기록 없음) + 이전/다음/자동 넘김(4초) + 「3/12 · 본인확인」 단계 표시. 조종은 **postMessage**(`fp-esign-preview`), 고객 화면은 미리보기일 때만 받는다(실제 손님 화면은 바깥에서 못 건드린다). ⚠ 링크에 박힌 host 가 지금 창과 다르면(localhost vs 127.0.0.1·배포 도메인 여럿) 다른 출처가 되어 조종이 통째로 막힌다 → 경로만 떼어 현재 출처로 띄운다(실측에서 잡음). 칸 4 「모바일 미리보기」(새 탭)를 대체.
- **직원용 ERP 조작 안내**(사장님 2026-08-20 「직원이 직접 쓰더라도 어떻게 입력해서 계약서를 보낸다가 있을 거 아냐」): 업무안내·QNA(/faq)에 「전자계약 보내기 — ERP 계약서관리」 절 신설(정본 `lib/domain/faq.ts` GUIDE). 위 「계약 진행 절차」는 일의 순서, 이건 «화면에서 뭘 누르나» — 카드 1~4 + 링크 전달 + 최종 승인, 막혔을 때 어디로 가는지, 「손님 화면 따라보기」 쓰는 법. 계약서관리 빈 화면 문구도 4단계로.
- **⑪ 기타사항 1~4**(사장님 2026-08-20 「맨 마지막에 없는 내용을 별도로 적게 · 불가조건과 동일하게 · 근데 그게 계약서에 들어가는 항목만 있으면 되는 거잖아」): 표에 없는 계약조건을 적는 자유 입력 4칸. 불가조건과 같은 모양이되 **계약서에 실린다** — `policy_extra_terms`(신설, exposure=계약서) → A4 「특약 사항」 칸에 이 계약의 특약보다 **먼저** 줄 단위로. 자유 입력 3종을 문서에 갈라 적음(불가조건=내부 상담 · 특이사항=영업 안내 · 기타사항=계약서).
- **정책 탭이 여럿인 시트도 전부 처리**: 법인이 둘인 곳(빌린카/엘씨 · 경진카/경진렌트 · 스타/스카이)은 「○○운영정책」 두 벌인데 `policyTabTitle` 이 정확히 「운영정책/정책」만 찾아 **6개 탭이 통째로 안 돌고 있었다**(2026-08-20 실측, 빌린카는 출고가능 44대). `transpose` 를 정책 탭마다 돌게 고치고(「○○운영정책」은 이름을 안 바꾼다 — 바꾸면 어느 법인 것인지 사라진다), 시트 **24개 탭** 전부 65열로 반영.
- **고치고 돌아와 바로 발송**(사장님 2026-08-20 「뭐가 없어서 그걸 수정하고 바로 반영해서 전자계약을 날리는 거지」): 「파트너사관리에서 ○○ 정보 입력」이 **작성 중이던 초안을 세션에 담고** 그 공급사가 열린 채로 이동(`?partner=코드&return=esign`), 파트너사관리 위에 「전자계약 작성 중입니다 — ← 작성 중이던 전자계약으로」 줄, 누르면 `/esign?resume=policy` 로 돌아와 초안 복원 + 고친 값 반영. 예전엔 주소 한 칸 고치러 가면 네 칸을 처음부터 다시 채워야 했다. 실측 왕복 확인(공급사 값 RP030 복원).
- 부수: 소스 문자열 sim 의 `read()` 를 CRLF 정규화(`core.autocrlf=true` 라 체크아웃하면 CRLF 로 깔려 `\n` 기준 단언이 깨졌다).

---

## 2026-08-19 — 상품찾기 차종 퀵필터는 제조사·모델만 (Cursor)

사장님: 「퀵필터는 제조사·모델만. 세부모델은 나오면 안 됨. 제조사만 찍으면 그 제조사 세부모델이 나왔다」.

- `VehicleMasterFilter` 파인더 차종 = **제조사 → 모델**만. 세부모델·파워·트림 단 숨김
- 제조사/모델 선택 시 아래 축은 비움(숨은 세부모델 조건이 안 남게)
- 패널 제목 `차종(제조사, 모델)`

---

## 2026-08-19 — 운영정책 시트 추가 3(심사조건·불가조건·제출서류 체크) + ERP 원자 확보 (Claude)

사장님: 「운영정책 맨 앞에 심사조건(무심사·소득확인·신용조회) · 불가조건은 뒤쪽에 1 2 3 4 로(한 칸 하나, 3년 이내 음주이력) · 제출서류는 체크하게(6종+기타, 마지막) · erp에 정책 반영하는 곳도 반영 — 원자 확보」. 정본 `docs/POLICY_ITEMS_FINAL_2026-08-19.md §8·§8-3`.

- 시트: `policy-sheet-layout.ts` 58열(⑩ 서류 파트 신설·체크 kind · ⑨ 불가조건 1~4) · `transpose-policy-tab --apply` 21곳 · 체크박스 BOOLEAN 이 빈칸을 FALSE 로 채우는 함정 → 정책 줄+10줄만, 읽기는 FALSE=빈칸(`supplier-policy-read.policyRowLive/policyCellValue`) · 매뉴얼 재생성.
- ERP: `entities.ts` 정책 선택지 = 시트 규격(`sheetOpts`) · 신설 원자(불가조건·sales_notes·파트너 회사정보 5) · `policy-money-rate.ts`(정액·정률·개월분 한 곳) → 연령 하향 가산·추가운전 라벨·계약서 A4 승계수수료/위약금(글) ·발송 게이트 · 심사 뱃지 셋.
- 들여오기: `audit-policy-sheet-vs-erp.mts` v2(가로 읽기·`policy-sheet-to-erp.ts`·접기 대조·`--apply`/`--overwrite`·회사정보→파트너). --apply 는 운영 RTDB 쓰기 → 사용자 실행.
- **정책관리 메뉴 제거 → 파트너사관리 안에서 공급사별 등록·수정·삭제**(사장님 「메뉴에 정책관리 버튼 이제 필요 없고, 파트너사관리에서 공급사별로」): TopBar 에서 /policy 항목 삭제 · 파트너사관리 › 계약·정책 = 그 공급사 정책 목록(발송가능/입력 부족 뱃지 · 수정 · 삭제(휴지통) · 정책 추가 · 정책 전체 열기) · /policy 는 `?provider=코드&return=partner` 스코프 편집 화면(제목 「○○ 정책관리」·그 회사 정책만·등록도 그 회사로·「← 파트너사관리로」) · `/members?tab=partner&partner=코드` 로 돌아오면 그 공급사 열림. 빌더 `policy-navigation.partnerPolicyUrl/partnerManageUrl`. 공급사(provider) 역할도 메뉴에서 빠짐 — 공급사 정책 입력은 제공시트 「운영정책」.
- **파트너사관리 4패널·규격 통일**(사장님 「목록·기본정보·운영정책·수수료정책 4가지로, 각 패널 규격 맞춰」): 파트너 탭 패널 = 기본정보(회사·담당자·계약서 회사정보·소속 회원) / 운영정책(전자계약·계약정책 N개 등록·수정·삭제·재고 시트 연결+매핑 초기화) / 수수료정책(공급사 수수료율·정산 기준 / 영업채널은 소속 영업자 지급율 요약). 규격 = 패널마다 FormCard(제목·힌트) 묶음, 읽기 DetailRow·편집 같은 카드 안 FormGrid, 모드 배너는 기본정보에만. 회원 탭 3패널은 그대로.
- **정책 등록·수정 = 파트너사관리 안 인라인 편집기**(사장님 「정책관리 페이지 없어졌으니 파트너사관리 안에서, 그 패널에서 아래로 열리게 · 우리가 준비한 시트 내용을 반영」): `components/PartnerPolicyEditor.tsx` — 운영정책 패널의 줄 「수정」은 그 줄 아래로, 「정책 추가」는 목록 아래로 열린다. 폼 = 공급사 운영정책 시트(v2)와 **같은 파트·같은 차례·같은 열 이름·같은 드롭다운**(POLICY_SHEET_FIELDS × POLICY_COLUMN_FIELDS × entities.sheetOpts). 불가조건 1~4→disqualification_conditions 하나, 제출서류 체크 6+기타→esign_required_documents. 저장 규칙은 정책관리 페이지와 동일. `?partner=코드&policy=코드`로 바로 열림. `/policy` 링크는 파트너사관리에서 전부 제거(라우트는 계약서관리 「정책관리에서 바로 수정」 왕복용으로만 남음).
- 운영정책 패널 「재고 시트 연결」 → **「시트 · 홈페이지」**(사장님 「여기는 시트 주소·홈페이지 주소만, 연동은 우리가」): 구글시트 URL + 홈페이지 주소(파트너 원자 `website` 신설)만. 탭 gid·헤더 행·어댑터·보증금 규칙·시트 매핑 초기화는 화면에서 뺌(원자는 남고 스크립트가 맞춘다).
- POLICY_DEFAULTS 숫자값(26·70·100000·50000·1000000·0.3·0.2·1) → 시트 규격 글자(「만 26세 이상」「10만원」「30%」「1인까지」…) — select 원자에 숫자가 들어가 «옵션 중복 key» 경고가 났었다.
- 계약서관리 차량 선택 시 **차량에 등록된 정책(product.policy_code)으로 자동 맞춤**(같은 공급사·같은 계약서 종류일 때, 토스트로 알림) — 사장님 「전자계약이 정책이랑 연결 · 등록된 차량을 출고가능한 것 중에서」. 차량 후보는 원래대로 공급사 × 계약서 종류 × 즉시출고/출고가능(계약 잠금 없음) × 재고.
- **「엑셀 운영정책이랑 동일한가」를 기계로 증명**: `scripts/sim-partner-policy-form.mts` — 폼(`lib/domain/partner-policy-form.ts` 정본) 열 58개 차례 == 시트 머리글 · 드롭다운 46칸 목록 == 시트 드롭다운 · 파트 10 == 시트 파트 · 프리패스 기본값 전부 선택지 안의 글자. 이를 위해 마지막 숫자 원자 6(초과주행 2·보증금 반환기한·시동제어·차량회수·사고다발)도 select(sheetOpts)로, 소비처는 `policyNumber()`로 「7일」「200원」에서 숫자를 읽는다(계약서 「연체 3일째」·「반납 후 7일 이내」·초과주행 1km당). 기본값 문구도 시트 규격으로(승계 가능여부 차례·심사 무심사·운전자범위 「본인+직계가족」「임직원」·보험료 포함·무보험보상 없음·자차보상한도 차량가액·긴급출동 「연간 5회」).
- **등록 규격 = 계약서관리 「새 계약 만들기」**(사장님 「파트너 생성하면 왜 그래 되지」): 등록 중 목록 맨 위 「파트너사 등록」 행이 선택됨으로 남는다(생성 코드 sup_… 유령 행 제거) · 신규 중엔 코드 줄 숨김 · 정책 등록은 저장 뒤(안내).
- 검증: tsc ✓ · 관련 sim 38종 ✓(스냅샷 sim 위약금 문구·esign sim 파트너 패널 단언 갱신) · check:ui 는 다른 세션 AppTabBar 1건만 · Playwright 실측(손오공 4패널 읽기/편집 · 영업채널 · 등록 · 스코프 정책 화면·복귀).

---

## 2026-08-19 — 가입 승인 = 바로 개인영업자 (Cursor)

사장님: 「그냥 바로 승인하면 그냥 개인영업자로 등록이 되어야 하는데 그게 안되네」.

- 가입 승인(재매칭 아님)은 파트너 매칭을 하지 않고 즉시 개인영업자(agent / SP999 / 개인 채널).
- 게이트 `users/{uid}` 와 목록 오버레이 `v4/users/{uid}` 둘 다 쓰고, 목록 캐시도 같은 값으로 패치. 저장도 SP999를 공유 채널로 쓰지 않음.
- 목록 뱃지·소속 선택에 개인영업자 표시.

---

## 2026-08-19 — 미등록 사업자번호 가입승인 = 개인영업자 (Cursor)

사장님: 「미등록사업자면 개인영업자로 승인하기로 했었는데」.

- 원인: `approveUser`가 신청유형 공급/영업 + 파트너 미매칭이면 승인을 막음.
- 결정대로 미매칭은 개인영업자(agent / SP999 / 개인 채널)로 승인. 등록된 파트너가 있으면 그 소속.
- 매칭을 v3∪v4 파트너로 맞춤(회원관리에서 만든 회사도 찾음).
- 승인 후 폼 재로드. 개인 배정이면 토스트에 표시.

---

## 2026-08-19 — 회원관리 페이지 정리 (Cursor)

사장님: 「그리고 회원관리 페이지 정리좀 하자」.

- 회원 탭 4패널을 CURSOR.md 축으로 재배열: **목록 | 기본정보(이름·회원번호) | 소속·권한 | 영업설정**. 소속이 기본정보에 있고 영업설정에 다시 나오던 중복 제거. 공급사 직원은 영업설정에 지급율이 없음을 안내.
- 조회/수정 배열을 재고·정책과 맞춤: 웹=FormGrid, 모바일 조회=`FormReadList`. 승인대기는 `Message` 원자.
- 빈 패널에 있던 관리 도구 이동: 개인채널 백필 → `/dev` 데이터 점검, 회원 email·공급사 수수료율 이관 → `/dev` 민감 필드 분리. 회원관리 빈 화면은 선택 안내만.
- 파트너사 탭 필드 그룹은 손대지 않음(4패널 설계 오더는 별도).
- sim-phase12 백필 위치 갱신.

---

## 2026-08-19 — 상품찾기 총대수·검색대수 (Cursor)

사장님: 「필터 안 하면 총 000대, 필터 하면 총 000중 000검색」.

- 표현 SSOT = 기존 PageStatus: **상품찾기 N대** / **상품찾기 N대 · 검색 M대**
- 상단바 `FinderStatus`에 총대수·검색대수 배선(로딩 중에는 숫자 숨김)
- 세부 패널 헤드「총 N대」도 조건 있으면 「· 검색 M대」 병기

---

## 2026-08-19 — 매물 상세 섹션 순서·카드 배열 (Cursor)

사장님: 「사진 · 차량스펙(제조사기준) · 대여료조건 · 보험조건 · 계약조건 · 기타사항 순으로 보기 좋게」.

- `detailSections` 제목·힌트·순서 고정(보험 → 계약 → 기타)
- `ProductDetail` 섹션을 `FormCard`(title+hint)로 배열 — 선만 그은 평문 제목 제거
- sim `sim-product-detail-priority` 기대값 갱신 · `tsc` · `check:fonts` PASS

---

## 2026-08-19 — 햄버거 메뉴에 파트너사관리·회원관리 복구 (관리자 전용) (Claude Code)

사장님: 「파트너사관리랑 회원관리 메뉴가 있어야함. 페이지는 있는데 메뉴에서 없앴어. 관리자만 볼 수 있는 거야」.

- 원인: `components/TopBar.tsx` 메뉴가 `GROUPS` → 4항목 `SIMPLE_GROUPS`(상품찾기·계약진행·정산확인·재고관리)로 바뀌면서 `/members` 진입점이 사라짐(페이지·`NAV_LABEL`은 그대로).
- `SIMPLE_GROUPS`에 **파트너사관리 `/members?tab=partner` · 회원관리 `/members?tab=user`** 추가, `roles: ['admin']` — 영업자·공급사 메뉴엔 안 뜸(페이지 자체도 `isAdminUiAllowed()` 게이트 유지).
- 메뉴 활성표시·같은 페이지 탭 새로고침이 쿼리 있는 href 를 못 가르던 것 → `isActive()`(pathname + `useSearchParams`) 로 통일. 같은 `/members` 라도 탭이 다른 항목은 켜지지 않는다.
- 확인: `tsc` PASS · 브라우저(Chrome, dev 4004): admin=6항목·agent=2·provider=3, `/members?tab=partner`/`?tab=user` 각각 해당 항목만 활성. QA 스크립트 `tmp/qa/menu-check.mjs`(캐시 세션 + firebase auth 청크 무동작 패치, gitignore).

### 같은 날 2차 — 계약서관리는 관리자 메뉴로 · 계약진행은 «준비중» (사장님 결정)
사장님: 「계약서관리는 관리자쪽으로 빼고 회원관리 위쪽. 계약진행은 별도로 만들어서 일단 준비중으로, 매물만 볼 수 있게」.
- `lib/tabbar.tsx`: `NAV_LABEL.esign` '전자계약'→**'계약서관리'**(사장님 호칭·ContractPanel 「계약서관리에서 확정」과 일치) · `AppTab.soon` 추가 · `appTabsFor` = 상품찾기·계약진행(soon) + 관리자 정산확인 + 공급사/관리자 재고관리(영업자 하단탭에서 /esign 제거) · `isTabRoute('/esign')` 관리자만.
- `components/TopBar.tsx` SIMPLE_GROUPS: 계약진행 `soon`(회색 «준비중», 링크 아님) · 관리 그룹 = **계약서관리(/esign)** · 파트너사관리 · 회원관리(사장님 정정: 계약서관리가 파트너사관리 위).
- `components/AppTabBar.tsx`: soon 탭은 버튼(이동 없음, 탭하면 «준비중입니다» 토스트).
- `components/EsignSendCenter.tsx`: /esign 페이지 제목을 `NAV_LABEL.esign` 으로(메뉴와 같은 이름).
- `scripts/sim-primary-navigation.mts` 기대값 갱신 · PASS. `tsc` PASS.
- 브라우저 실측: 웹 admin=상품찾기·계약진행(준비중)·정산확인·재고관리 | 계약서관리·파트너사관리·회원관리 / agent=상품찾기·계약진행(준비중) / provider=+재고관리. 모바일 하단탭 agent=상품찾기·계약진행(준비중 버튼), admin=+정산확인·재고관리.
- 설계 인계: `PLAN.md` 「계약진행 별도 화면 — 계약서관리와 축 분리」(골격 + 열린 질문 3).

### 같은 날 3차 — 계약진행 = 목록 + 진행상황 (사장님: 「목록이랑 그 계약이 어디까지 진행중인지 볼 수 있는 페이지면 되는데」)
- 커밋본(HEAD) `app/contract/page.tsx` 를 그대로 복원 — 목록(검색·정렬·계약월·업무단계 필터) | 계약 진행상황(5단계 ContractPanel, /chat 과 같은 SSOT) | 첨부 서류 | 정산상태. 작업트리의 3줄 래퍼(`<EsignSendCenter workspace="contract">`)는 `tmp/qa/contract-worktree-sendcenter.tsx` 에 보관.
- 메뉴·하단탭의 계약진행 «준비중» 해제(`lib/tabbar.tsx` · `components/TopBar.tsx` · sim 기대값). `AppTab.soon` 인프라는 남김.
- 확인: `tsc` PASS · sim-primary-navigation PASS · 브라우저(4014 QA 서버, 4004 가 내려가 있어 `NEXT_DIST_DIR=.next-qa` 로 별도 기동): 웹 admin/agent = 4프레임 렌더·콘솔 에러 0, 모바일 agent 하단탭 = 상품찾기·계약진행. tsconfig.json include 에 `.next-qa/types` 한 줄이 자동 추가됨(이미 .next-dev·.next-erp5 등 같은 패턴으로 더러워져 있던 파일).
- 남은 결정 4건은 PLAN.md 「계약진행 = 목록 + 진행상황 화면」 §남은 것 — 특히 엑셀/직접 계약서가 목록에서 「출고문의 진행」으로 보이는 문제(커밋본과 같은 동작, `contractStage` SSOT 라 로컬 땜질 금지).

### 같은 날 4차 — 빌드 깨짐 복구(`esignCenterBucket` 삭제 여파)
- 원인: 다른 세션의 「계약서관리 화면 재편」(`docs/ESIGN_SEND_CENTER_REDESIGN_2026-08-19.md`) 도메인 반쪽만 반영 — `lib/domain/esign-center.ts` 에서 `esignCenterBucket`/`EsignCenterBucket` 삭제 → 5단계 `esignCenterStage`+`esignCenterFlags`. 화면(`components/EsignSendCenter.tsx`, Cursor 담당)은 옛 이름 import 그대로라 turbopack 빌드 에러.
- 조치: `EsignSendCenter.tsx` sendBucketMap 에 **임시 어댑터**(stage+flags → 옛 4버킷) 2줄. 화면 재편 때 걷어낼 것(주석 표기). `tsc` PASS · 4004 `/esign` 200.

### 같은 날 5차 — 회원·파트너사 모델 확인 + 정책관리 메뉴 복구
사장님: 「회원가입은 직접하고 파트너사는 우리가 생성. 파트너사는 공급사(렌트사)·영업채널이 있고, 공급사는 정책등록을 여기서 할 수 있어야 해」.
- 대조(`app/members/page.tsx` · `lib/intake/entities.ts` partner): 회원 탭 = 신규 생성이 아니라 «기존 가입회원 연결»(가입계정 UID) + 승인대기 필터·가입 승인 ✔ / 파트너사 탭 = «신규 파트너사» 관리자 생성 ✔ / `partner_type` 공급사·영업채널(select·필터칩) ✔ / 공급사 상세 「계약·정책」 패널에 연결 정책 목록 + 「정책 추가」(`/policy?new=1&provider=코드`) ✔.
- 빠진 것: 정책관리(`/policy`) 메뉴 진입점 없음(4항목 단순화 때 빠짐) → 공급사가 자기 정책을 등록하러 갈 길이 없었다. `components/TopBar.tsx` SIMPLE_GROUPS 재고관리 아래에 **정책관리**(provider·admin) 추가. `/policy` 는 역할을 안다(공급사=자기 것만·`provider_company_code` 고정, 관리자=전체).
- 실측: admin=상품찾기·계약진행·정산확인·재고관리·정책관리 | 계약서관리·파트너사관리·회원관리 / provider=상품찾기·계약진행·재고관리·정책관리 / agent=상품찾기·계약진행. `tsc` PASS.

### 같은 날 6차 — 파트너사관리 4패널 설계(사장님: 목록 | 기본정보 | 계약정책 | 수수료정책)
- 실측: 현재 목록|기본정보|계약·정책|소속·운영 — 정책 «입력»은 /policy 로 튀고, 수수료율은 시트 연동 설정 사이에 묻힘, 관리 도구가 패널에 섞임. 사장님 「대충 구성한 느낌」의 실체.
- 설계 오더 `docs/PLAN-파트너사관리-4패널-2026-08-19.md`(Cursor 구현): 계약정책 패널 안에서 그 회사 정책 목록+편집(`PolicyForm` 추출, /policy 와 공용) · 수수료정책 패널(R1 요율·환수·예시계산) · 시트 연동 입력은 재고관리로 일원화 · 결정 필요 4건.

### 아직 안 한 것
- 파트너사관리 4패널 구현(Cursor) — 사장님 결정 4건(환수 조건 위치·영업채널 기본 지급율·시트 입력 제거·계약서 회사정보 위치) 뒤.
- 위 남은 결정 4건(엑셀/직접 계약서 표기 · 상세→계약서 보내기 버튼 · ContractSendWorkspace 정리 · /esign 게이트).
- `EsignSendCenter` 임시 버킷 어댑터 제거 — Cursor 재편 오더에 포함.

---

## 2026-08-18 — 그랜저 GN11 세부모델 표기 교정 (Cursor)

사장님: 「더뉴 그랜저 GN11 이렇게 안하기로 했는데」.

- `더 뉴 그랜저 GN11` → **`그랜저 GN11`** (GN7 표기와 정렬 · 더 뉴+개발코드 중첩 제거)
- 시트 18행 · registry/artifact 재생성 · 키감사 0
- 상품마스터 적용값 재동기화(`sync-product-master-applied-from-trim`)
- sim: `sim-grandeur-2026-contract` 기대값 갱신

### 아직 안 한 것
- 같은 패턴 잔여(예: `더 뉴 쏘렌토 MQ4` 등 ~370행) 전수 스윕 — 방향 확인 후

---

## 2026-08-18 — 매칭 차종코드 → 상품마스터 적용값 동기화 (Cursor)

사장님: 「상품차종 매칭된거를 상품시트로 갖고갈수 있게」.

- CODE 결정 64건은 이미 상품마스터에 반영됨(추가 패치 0)
- 규격 승격 후 이름만 낡은 행 **143**대 → `차종마스터 적용값`만 artifact 이름으로 갱신
- `lib/domain/product-master-applied-name-sync.ts` + `scripts/sync-product-master-applied-from-trim.mts`
- confirm `SYNC_PRODUCT_MASTER_APPLIED_FROM_TRIM_V1` · approval `boss-sync-applied-from-trim-20260818`
- 미해결 1대: `162허2357` 코드 `mf-002.md-002.sm-yg::v02::t03` (keep-reviewed 원장에 없음)
- plan 스크립트: 삭제된 `candidate_key`(TRIPLE 힌트)가 CODE 반영을 막지 않게 완화
- sim: `sim-product-master-applied-name-sync` PASS · `tsc` PASS

---

## 2026-08-18 — 규격채택 키만 차종마스터 유지 (Cursor)

사장님: 「규격검토한 애들 차종마스터로 승격」 → 이미 칸 반영된 뒤, 채택 키만 남기고 나머지 원장 정리.

- `scripts/apply-vehicle-master-keep-reviewed-only.mts`
- 유지: 「차종마스터_규격채택」 중 `규격구조채택*` **2,086**행 (검토유지 제외)
- 제외: **3,248**행 → 전체 이전본은 숨김탭 「차종마스터_보관」에 보관
- registry/artifact **2,086** · 키감사 0
- approval `boss-keep-reviewed-only-20260818`
- 스냅샷 `tmp/vehicle-master-keep-reviewed-only-snapshot-1787022806331.json`

### 아직 안 한 것
- 규격검토/규격채택/상품차종매칭 탭 숨김·개명 · FL/`더 뉴` 이름 스윕 · 상품커버리지-only 성장 정책

---

## 2026-08-18 — 차종마스터 「파워트레인」 합침열 삭제 (Cursor)

- 직전 승격 apply 때 `--skip-column-drop` 으로 열이 남아 있었음 → 사장님 지적 후 열 삭제 apply
- `apply-vehicle-master-adoption-into-master.mts --apply` (패치 0 · 열만 삭제)
- registry schemaVersion **3** · artifact prior 라벨 보존 · 키감사 0
- 유지: `파워트레인순번` · 연료/배기/터보/구동/배터리 원자축 · 트림행키

---

## 2026-08-18 — 규격검토(채택) 내용을 차종마스터 양식에 반영 (Cursor)

사장님: 「차종마스터 양식에 맞게 규격검토한 내용 박아줘」.

- 입력: 「차종마스터_규격채택」(규격검토 키드 정본) → 운영 「차종마스터」 셀 패치
- 적용: 이름 609셀 + 원자축 1,723셀 · 키/순번/파워트레인열 **유지** (`--skip-column-drop --include-atomic`)
- 대상 키 2,086(채택) · registry schemaVersion 2 재등록 · artifact 재생성 · 키감사 0
- 스냅샷 `tmp/vehicle-master-adoption-into-master-snapshot-1787022014860.json`
- approval `boss-stamp-review-into-master-20260818` · plan SHA `e6447574…9d48`

### 아직 안 한 것 (이후 keep-reviewed-only / PT열 삭제로 일부 완료)
- 규격검토 숨김 · 탭 개명 · FL 이름 스윕

---

## 2026-08-18 — 차종마스터 규격 승격 + 파워트레인 열 제거 (Cursor)

사장님: 규격검토(채택본)을 운영 `차종마스터`에 옮기고 양식에서 파워트레인 합침열 제거.

### 구현(쓰기 없음 / dry-run)
- `lib/domain/vehicle-powertrain-label.ts` — 시트칸 → prior artifact → 원자축 합성
- `lib/domain/vehicle-master-adoption-into-master.ts` — 이름4축 패치 vs 원자축 semantic_drift 분리 · 열 제거 헤더 계약
- `scripts/plan-vehicle-master-adoption-into-master.mts` → `tmp/vehicle-master-adoption-into-master-plan.json`
- `scripts/apply-vehicle-master-adoption-into-master.mts` — 기본 dry-run · `--apply`는 confirm+plan SHA+승인참조 필수 · `--hide-review-tab` · `--include-atomic` 기본 off
- artifact/키계약: `파워트레인` 열 선택 · `TRIM_KEY_SEMANTIC_HEADERS_V3` · registry schemaVersion 3 지원
- `product-vehicle-normalization` — `preferMasterNames`(승격 후 원장 1순위)
- sim: `sim-vehicle-master-adoption-into-master` · trim-master/key-contract 보강
- 매뉴얼·`VEHICLE_MASTER_KEY_CONTRACT.md` 반영

### 게이트 후 할 일(Claude/사람)
- plan 라이브 실행 → 손대조 → `--apply --confirm=APPLY_VEHICLE_MASTER_ADOPTION_INTO_MASTER_V1 … --hide-review-tab`
- 원자축 drift는 별도 승인 목록 없으면 쓰지 않음
- apply 후 발행/ERP에 `preferMasterNames: true`

### 하지 않은 것
- 라이브 `--apply` / registry 재등록 실반영 / 판매 dump 재발행

---

## 2026-08-18 — 상품시트 ↔ ERP 연동 A·B·C (Cursor 오더)

PLAN.md 「상품시트 ↔ ERP 연동 — 상품마스터 허브 일일갱신 · 정합 감사 · 표시 통일」.

### 오더 A — 상품마스터 live 일일 갱신
- 신규 `lib/domain/product-master-live-sync.ts` (칸 계획·금액원자·부재/신규 행)
- 신규 `scripts/sync-product-master-live.mts` — `readSupplierSheet`+`importSheetTable` → live 칸만
- `.github/workflows/sheet-sync.yml` 에 **상품리스트 발행 직전** 단계 삽입
- 기본 dry-run · `--apply` · 스냅샷 · CAS(`최종갱신`) · 공급사 20% 축소 중단 · 매뉴얼 자동반영 금지=진단만
- **미 `--apply`** (Codex 손대조·사장님/Claude 확인 후)

### 오더 B — 판매시트↔ERP↔상품마스터 정합
- 신규 `scripts/audit-sales-sheet-vs-erp.mts` (읽기 전용, 돈 diff→exit 1)
- 워크플로 ④에 추가 · `audit-sales-sheet-sync.mts` 헤더에 레거시 표기

### 오더 C — ERP 표시명 = 규격채택·3축 결정
- `product-master-import` `trimIdentity` → `normalizedNameForKey`(채택 우선, artifact fallback)
- 코드 없는 차: `_review_identity`(TRIPLE/PARTIAL), `_product_master_identity_authoritative=false`
- `fetchProductMasterSheet` 가 「차종마스터_규격채택」+ decisions 로드
- `vehicle-name.partsOfRecord` 가 `_review_identity` 표시
- `sim-product-master-import` 3케이스 추가

### 게이트
- `tsc` · `sim-product-master-import` · `sim-sheet-daily-sync` · `sim-supplier-sheet-read` · `check:manual` · `check:fonts` PASS
- D(발행기 입력→상품마스터)는 사장님 결정 보류

### 하지 않은 것
- A `--apply` / ERP·RTDB 직접 쓰기 / 잠금칸·차종 재매칭 / 새 파서

---

## 2026-08-18 — 상품 차종 3축 검토 마무리 잔여 102 (Cursor 오더 1·2·3)

PLAN.md 「상품 차종 3축 검토 마무리 — 잔여 102대 · 마스터 보강」.

### 오더1 — 잔여 102 3축 판정
- append `data/product-vehicle-review-decisions.json` (+102, 총 176, 기존 74 미수정)
- 보조: `scripts/_dump-unreviewed-102.mts`, `_propose-unreviewed-102.mts`, `_append-unreviewed-102-decisions.mts`
- 판정 요약(102): CODE 55 · TRIPLE 2 · PARTIAL 41 · HOLD 4
- HOLD 잔여: 204나2940(카니발) · 257구2888(캐스퍼) · 36머9150(C200 세대미상) · 161허1699(아반떼 J2 배기량 충돌)
- 주요 교정: E클래스 6세대 W213→W214 · AD 후보 CN7 오염 시 현재 AD 유지 · K8 3.5 4WD 노블레스 ADD_ROW · Tesla/Golf 표기충돌 ALIAS 유지
- 게이트: `plan-product-vehicle-review-decisions.mts` PASS · patch 후보 18대(미 `--apply`) · `tsc` PASS · `check:fonts` 드리프트 0
- `audit-product-vehicle-resolution-backlog.mts` → **unreviewed 0** (reviewed 173; 커버리지 재감사 후 unresolved 집합 173)

### 오더2 — 마스터 보강 후보표
- `scripts/_build-vehicle-master-backfill-candidates.mts` → `tmp/vehicle-master-backfill-candidates.json`
- counts: ALIAS 15 · PERIOD_FIX 2 · UNBLOCK 11 · ADD_ROW 11 + 규격검토 오기 2(코나 SX2 생산시작 · QM6 LPe 누락)
- 원장/registry **미수정**. 공식 URL은 후보에 있으면 옮기고 없으면 `근거 없음`

### 오더3 — 「상품 차종매칭」 조회
- `lib/domain/product-vehicle-match-view.ts` + `scripts/publish-product-vehicle-match-view-v2.mts`: 결정 파일 읽어 `차종코드 상태`를 3축확정/트림미확정/원천확인으로 표시, 검토 사유·차종 범위에 3축 결정 반영
- 고정 13열 계약·dimensionWrites=0 이라 새 열 추가는 보류(상태·사유 열에 흡수)
- dry-run plan: `tmp/product-vehicle-match-view-publish-plan.json` (sha `c4bba33d…799731`) — **시트 --apply는 승인 문구 대기**

### 하지 않은 것
- `apply-product-master-vehicle-coverage.mts --apply` (사장님/Claude 확인 후)
- 조회탭 Sheets 실게시 `--apply`
- 차종마스터 원장·registry 수정

---

## 2026-08-16 — 실제 상품 587대 차종 커버리지 종결 게이트 (Cursor 오더)

PLAN.md 「실제 상품 587대 차종 커버리지 종결 게이트」 Cursor 구현 오더.

### 실제 변경 파일
- 신규 `scripts/audit-product-vehicle-trim-coverage.mts` (읽기 전용 감사 엔진 + CLI)
- 신규 `scripts/sim-audit-product-vehicle-trim-coverage.mts` (판정 축 fixture sim)
- 본 로그 append only. 기존 파일 수정 없음.

### 구현 요지
- 헤더 50열 exact 검증 fail-closed. 행/차량번호 판정은 관대해 고유 차번마다
  `AUTO_UNIQUE | MANUAL_UNIQUE | EVIDENCE_BLOCKED` 정확히 하나.
- 부축 `NO_CANDIDATE / MULTI_CANDIDATE / BLOCKED_KEY_REFERENCE / CODE_CONFLICT` 합계 =
  `EVIDENCE_BLOCKED` (불변식 보고).
- `blocked` 후보는 배정 집합 제외. `manual` 유일은 절대 `AUTO_UNIQUE` 불가.
- 제조사·세대/기간·연료·구동·인승 모순은 감점이 아니라 탈락. 공란은 모순 아님.
- 기존 차종코드는 역검증. 신규키·별칭·제원·기간 추정 생성 없음.
- 입력 기본: `tmp/product-master-values.json` 스냅샷. `--live` 또는 스냅샷 없을 때만
  Sheets **readonly** GET. `--out`은 미존재 경로만(덮어쓰기 금지).
- `lib/server` / Firebase / registry / ERP / v3·v4 / rules / engine / getStore 미사용.

### 실행 명령과 결과
```
npx tsx scripts/sim-audit-product-vehicle-trim-coverage.mts
→ PASS sim-audit-product-vehicle-trim-coverage

npx tsx scripts/sim-product-master-import.mts
→ PASS: 상품마스터 → ERP 파서 3공급사 · 상태/가격/차종코드 · 실패차단
  (환경 경고: 필수 Firebase 환경변수 누락 — 본 sim 통과와 무관)

npx tsc --noEmit
→ PASS (exit 0)

git -c safe.directory=/mnt/c/dev/freepasserp4 diff --check -- \
  scripts/audit-product-vehicle-trim-coverage.mts \
  scripts/sim-audit-product-vehicle-trim-coverage.mts
→ PASS (exit 0)

npx tsx scripts/audit-product-vehicle-trim-coverage.mts --live
→ FAIL: The caller does not have permission

npx tsx scripts/audit-product-vehicle-trim-coverage.mts
→ FAIL exit 1: 기본 스냅샷(tmp/product-master-values.json) 없고 라이브 GET도 불가
  (동일 permission)

CLI 스모크(임시 1행 스냅샷, 실행 후 삭제):
  --snapshot → JSON totals + ---CSV--- PASS
  --out 신규 경로 기록 PASS / 동일 경로 재지정 시 덮어쓰기 금지 PASS
```

### 제한(우회하지 않음)
- 라이브 587대 전수 감사는 이번 환경에서 미실행.
  원인: `tmp/product-master-values.json` 없음 + Sheets readonly GET permission 거부.
- 587대 수치·공급사/제조사/모델 묶음 실측 보고는 스냅샷 확보 또는 자격증명 권한
  복구 후 동일 스크립트로 재실행 필요. Codex 라이브 재조회 오더 범위.

### 계획 이탈
- 없음. 쓰기 범위·읽기 전용·추정 생성 금지 준수. commit/push/deploy/Sheet write 없음.

---

## 2026-08-16 — 차종마스터 manual/blocked 반복 감사 도구 (Cursor 역할)

- `scripts/audit-vehicle-trim-operational-backlog.mts`를 추가했다.
- 로컬 산출물만 읽으며 Google Sheet·영구키 레지스트리·차종 데이터를 수정하지 않는다.
- manual은 정책 실패 사유 조합과 제조사/모델별 건수를 출력한다.
- blocked는 상태 조합, 상태 관문을 가려도 필수 정책 필드가 부족한 행, 정책 필드는 완결됐지만
  기존 `제외` 사유를 사람/Claude가 다시 확인해야 하는 행을 분리한다.
- `제외`를 승격 권고로 해석하지 않는다. 영구키 의미 충돌이 근거메모에 기록된 행일 수 있기 때문이다.

실데이터 읽기 전용 감사 결과:

- 전체 5,293 · automatic 3,207 · manual 138 · blocked 1,948
- manual 즉시 승격 가능 0
- manual 주요 차단: `market_period` 단독 109, 전기제원·공식호스트·공식메모 복합 10,
  `electric_spec` 단독 9, `required_spec` 단독 3
- blocked 1,948은 모두 `제외|1차확인`; 상태 관문을 가려도 1,748개는 정책 필드가 미완결
- 나머지 200개는 정책 필드만 완결된 상태이며, 기존 제외 사유의 의미 충돌 여부를 개별 검토하기 전 승격 금지

검증:

- `npx tsx scripts/audit-vehicle-trim-operational-backlog.mts`: PASS
- `npx tsx scripts/promote-vehicle-trim-operational.mts` (dry-run): selected 0 · rejected 138

---

## 2026-08-10 — `/esign` ③·④ 빈 골격 항상 표시 (화면 우선)

오더 갱신: 계약 미선택·미발행에도 ③·④를 중앙 안내문 한 줄로 두지 않음.

- `app/esign/page.tsx` — ③·④를 `sel` 없이 항상 마운트
- ③ 기본: `연결됨 · 계약 미선택` + 연동값 검증(—) · 계약서 저장(비활성) · 서명 링크(발행 전) · 연동 데이터 구역 골격
- ④ 기본: `발행 전 · 0/8` + 8단계 · 본인확인 · 서류 · 보완(비활성) · PDF(없음)
- 계약 선택·발행 시 같은 골격에 데이터만 채움

검증: `npx tsc --noEmit` PASS

---

## 2026-08-10 — 착한거래 ②·③ → 프리패스 ③·④ 패널 이식

오더: `docs/CURSOR_ORDER_CHAKHANDEAL_PANELS_2026-08-10.md`

### 착한거래 (`C:\dev\chakhandeal`)

- `toMemberStatus`: `templateFields` · `supplements` · `supplementActive` 공개 필드 추가
- `openSupplement`: 서명 후 허용 키를 **이력 저장 전** 검증
- `POST /api/v1/contract/{id}/supplement` (ApiKey, 자기 회원사만)
- `GET /api/v1/contract/{id}/preview?save=0|1` — 서명 전 A4 초안, 툴바 «서명 전 초안 · 서명 없음»
- `GET /api/v1/templates/{id}/fields` — `sections`(RENTAL_SECTIONS) 추가
- `renderDraftPreview` / chrome draft 모드

검증: `npm test` PASS · `npm run build` PASS · `tests/member-preview-supplement.test.js` 7 PASS

### 프리패스 (`C:\dev\freepasserp4`)

- `lib/server/chakhandeal-esign.ts` — preview HTML · supplement POST · template fields/sections · 상태 정규화
- `lib/domain/chakhandeal-esign-sync.ts` — `esign_supplements` · `esign_supplement_active` (templateFields는 RTDB 미복제)
- `GET …/preview` · `POST …/supplement` 관리자 프록시 (`esign_id`만 사용)
- `template-fields` GET — 발행 후 읽기 전용 스냅샷 + sections
- `app/esign/page.tsx` ③ 초안저장·미리보기·서명링크·연동데이터 / ④ 보완링크·이력·완료PDF

검증:
- `npx tsc --noEmit` PASS
- `npm run check:fonts` PASS
- `npx tsx scripts/sim-chakhandeal-sync.mts` PASS (보완 투영 포함)
- `npx tsx scripts/sim-chakhandeal-esign.mts` 35/35
- `npx tsx scripts/sim-esign-contract-kind.mts` 60/60
- `npx tsx scripts/sim-esign-field-map.mts` 13/13
- `check:ui --changed` 기존 타 파일 드리프트만 보고(이번 변경 파일 신규 0)

---

## 2026-08-08 — 시트 차명 원자화 · defaults ↔ snap · SyncPreview 원자 보기

### 완료한 작업

- `vehicle-defaults.snapDefaultHints`를 `snapToMaster`에 연결: 마스터 선택지 축이 있을 때만 빈 인승·구동을 힌트로 채운 뒤 `selectMasterVariant` 점수에 쓴다.
- 인승 기본 = `modeSeat`(카니발 → 9), 구동 기본 = 2WD(구동 축 있을 때만). 차체유형 문자열 분기 없음.
- `applySnap`은 스펙 원자를 마스터 노드만 쓰고, 힌트 여부는 `_snap_defaults` 메타로만 남긴다. 매칭 실패로 sync apply를 막지 않음(`_needs_master_review` 유지).
- `SyncPreview`에 원자 보기(원문차명·세부모델·파워트레인·트림·연료/배기/인승/구동`(기본)`·확정/검수/미매칭) 추가. ExcelResultsTable 미변경.
- `sim-atom-pipeline`에 카니발·그랜저 기본값 케이스 추가.

### 검증

- `npx tsx scripts/sim-atom-pipeline.mts`: **29/29 PASS**
- `npx tsc --noEmit`: PASS
- `npm run check:fonts`: PASS

---

## 2026-08-04 — 아이언 홈페이지 연동 서버 원장·안전 롤백

### 완료한 작업

- `v4/inventory_sync_runs/ironrentcar/{runId}` 서버 원장과
  `v4/inventory_sync_control/ironrentcar` 최신 적용 포인터를 추가했다.
- 적용 전에 patch/create/absent 대상 키를 합집합·정렬하고, 중복 또는 counts 합 불일치를 차단한다.
- 적용 전후 affected `v4/products` 전체 객체, RP006 overlay, sync control을 snapshot하고
  SHA-256 before/after digest, revision, counts, actor, 감사 ID와 함께 `prepared` 상태로 보존한다.
- affected 상품·RP006·control의 exact before가 유지될 때만 `v4` 서버 transaction으로
  상품·파트너·control·run=`applied`·완료 감사를 함께 확정한다. 무관 상품은 그대로 보존한다.
- 상품·RP006에 run ID·revision·적용시각 진단필드를 기록한다.
- 관리자 전용 `POST /api/inventory/ironrentcar/rollback`을 추가했다.
  - 확인문·runId·revision·after digest·사유 필수
  - 최신 적용 run, exact after, 계약 lock 없음일 때만 before 복원
  - 생성 상품은 v4 child 삭제, v3-only 상품도 v4 child 삭제, 기존 v4 상품은 전체 preimage 복원
  - 상품 복원 후 파트너 복원 실패 시 `rollback_products_restored`에서 안전하게 재개
  - 성공 시 RP006와 control을 이전 snapshot으로 복원하고 run=`rolled_back`
- 적용·롤백 감사에는 run/revision/digest/reason/actor만 결속하고 상품 원문·차번·가격은 넣지 않았다.
- UI, v3, Rules, 정산엔진, RTDB adapter, `products_private`, 배포, 운영 데이터는 변경하지 않았다.

### Codex 독립검토 후 보완

- 실백업 v4 크기(10,805,856 bytes)와 Firebase single write 한계 사이에 여유를 두고,
  적용 1곳·롤백 2단계의 proposed `v4` root가 UTF-8 **14MB를 초과하면 409로 차단**한다.
- 적용 원장 저장 후 CAS 충돌·예외가 나면 원장이 여전히 `prepared`일 때만
  `apply_failed`·실패시각·비민감 실패코드를 기록하고 별도 실패 감사를 남긴다.
  이미 `applied`인 run은 실패로 덮지 않는다.
- rollback preflight와 두 transaction 모두 최신 run ID/revision뿐 아니라
  저장된 `control_after` 전체 snapshot의 exact 일치도 요구한다.

### 검증

- `npx tsc --noEmit`: PASS
- `npm run check:fonts`: PASS
- `npm run check:tokens`: PASS
- `npm run check:ui`: PASS
- `npx tsx scripts/sim-ironrentcar-apply.mts`: **22/22 PASS**
- `npx tsx scripts/sim-ironrentcar-rollback.mts`: **28/28 PASS**

---

## 2026-08-04 — Production 오픈 환경 게이트 보완

### 완료한 작업

- 실제 `app`·`lib`의 `process.env` 참조와 `check-release`·`check-b2b-release`를 기계적으로 대조했다.
- `check-b2b-release`가 다음 오배포를 명시적으로 NO-GO 처리하도록 보완했다.
  - `NEXT_PUBLIC_DATA_BACKEND=rtdb`가 아닌 로컬 시드 오픈
  - Firebase Storage 버킷 미설정으로 상품 사진·계약 서류 업로드 불능
  - 법적 운영자 필수 6필드 또는 기존 회원 재동의 게이트 누락
  - Google Drive 백업 4개 서버 환경변수 누락
  - 오픈 필수로 확정된 아이언 홈페이지 재고 연동 플래그 OFF
- 기존 차량 claim 서버·클라이언트 플래그, 서비스계정, product v3 브리지, Sheet 자동동기화 OFF 검사는 유지했다.
- 대표전화는 기존 법적 SSOT대로 선택값이라 강제하지 않았고, 착한거래는 오픈 후 실 API 준비 사항이라 강제하지 않았다.
- Rules·정산엔진·RTDB adapter·배포·운영 데이터는 변경하지 않았다.

### 검증

- 확정 환경 모형 + 비게시 Rules 후보: `check-b2b-release` **55/55 PASS**
- 누락 음성대조(Storage·RTDB backend·법적 상호·재동의·Drive·아이언): **6/6 차단 PASS**
- `npx tsc --noEmit`: PASS

---

## 2026-07-28 — 오토플러스 2탭 병합·가격 라벨·diff 미리보기 배선

### 완료한 작업

- `lib/domain/sheet-autoplus.ts` — main(gid=284963459)+프로모션(2018553731) 병합 · 재고(출고가능+보류) 집계
- `sheet-adapters` autoplus.prepareTable — col6/7/11~14 → 최초등록·주행·12/24/36/48개월 라벨 · 헤더 자동탐지
- `sheet-sync-all` — 오토플러스 2탭 `importAutoplusMerged` · `commitFetchedPartnerSheets`로 fetch/저장 분리
- `SheetSync` — 저장 전 `summarizeSheetDiff`/`formatSheetDiffBanner` 배너 · 일괄은 fetch→diff confirm→commit
- `sheet-diff` — 전이 그룹핑·배너 포맷 헬퍼(commit/merge/absent 미변경)

### 검증

- `npx tsc --noEmit` PASS
- `npm run check:fonts` PASS
- `npx tsx scripts/sim-sheet-diff.mts` PASS (배너 포함)
- `npx tsx scripts/count-autoplus-ingress.mts` — 2탭 108대·가격 108/108 · 재고(출고가능+보류) **실측 ~100** (실무 목표 99와 근사 — 시트 라이브 변동)

---

## 2026-07-28 — 모바일 데스크탑 도구 추가 숨김

### 완료한 작업

- 월정산 모바일: xlsx `가져오기`·정산서·VAT 툴바 전부 미노출 (`actions = undefined`, file input도 `!mobile`)
- 재고 업로드 패널 모바일: `SheetSync`/종합표 대신 웹 안내 `CenterNote`
- 파인더 주석: 모바일 엑셀 다운로드 미제공으로 정정
- `sim-phase12` 회귀 가드 갱신

### 검증

- typecheck PASS · sim-phase12 재실행 · `/settlement` `/inventory` HTTP 200 · `:4004` 유지

---

## 2026-07-28 — 모바일 아이콘·규격 잔여 정리

### 완료한 작업

- 표면 액션 `mobileIcon` 잔여: `/m` 손님공유·계약문의, FilterGroup 해제, Finder 최근/관심 비우기, CopyBlock, FAQ/정책 홈으로, 서명 전체동의·지우기, TopBar 모바일 뒤로(`IconBtn`)
- 모바일 VAT 정산서 툴바 숨김 (`app/settlement/page.tsx`) — 웹 텍스트 버튼 유지
- 토큰·원자: 로그인 submit 16px, ProductDetail 캐러셀 `IconBtn`, ProductMoreMenu `ctrlH`, PhotoUpload 시트 메뉴 텍스트 복구(시트에서 `mobileIcon` 제거)

### 검증

- `npm run typecheck`: PASS
- `npx tsx scripts/sim-phase12.mts`: 33/33 PASS
- HTTP 스모크 `:4004` 주요 경로 200
- production build: 미실행
- `:4004` 유지

---

## 2026-07-26 — 매물 카드 가격·혜택 원자 분리

### 완료한 작업

- 추가: `components/product-card-perks.tsx`
  - `MetaIcon` · `CardBenefits` · `CardEvents` · `CardPerkLine`
  - 가격 모듈(`PeriodPerkBand`)이 `CardPerkLine`을 쓰므로 순환 import 방지용 공통 분리
- 추가: `components/product-card-pricing.tsx`
  - `PricePeekRoot` · `PriceMonth` · `PriceRentDep` · `PriceAmounts`
  - `PeriodRange` · `PeriodChips` · `PeriodPerkBand` · `PriceHero`
  - `CardPerkLine`은 perks에서 import
- 수정: `components/product-card-atoms.tsx`
  - 위 심볼을 re-export 유지 (`@/components/product-card-atoms` 경로 불변)
  - 로컬 잔존: `CardSpecs` · `CardFacts` · `CardThumb` 등

### 변화

- 기능·스타일·문구 변경 없음 (구조 이동만)
- 기존 소비자(`ProductCard` · `ProductRowCard` · `ProductDetail` · `list-rows`) import 경로 유지

### 검증

- `npm run typecheck`: PASS
- `npm run build`: 미실행 (요청)
- dev `:4004`: 유지 확인 (200)

---

## 2026-07-26 — Inventory 목록 UI 분리

### 완료한 작업

- 추가: `features/inventory/InventoryListPanel.tsx`
  - 신규 등록 슬롯과 작성 중 드래프트 행
  - 검색 결과 없음·상품 없음 상태
  - 선택 행 목록
  - 더보기·전체 보기와 500대 안전 상한
- 수정: `app/inventory/page.tsx`
  - 인라인 `listEl` 구현 제거
  - `InventoryListPanelModel`로 목록 상태와 명령 전달

### 변화

- `app/inventory/page.tsx`: 789줄 → 749줄

### 검증

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

---

## 2026-07-26 — Inventory 목록 계산 훅 분리

### 완료한 작업

- 추가: `features/inventory/useInventoryResults.ts`
  - 검색어·상태·상품구분 필터
  - 상태·차명·차번·코드 정렬
  - 모바일 필터 드래프트 미리보기 건수
- 수정: `app/inventory/page.tsx`
  - 목록 파생 계산 제거
  - `useInventoryResults` 결과 사용

### 변화

- `app/inventory/page.tsx`: 802줄 → 789줄

### 검증

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

---

## 2026-07-26 — Finder 결과 계산 훅 분리

### 완료한 작업

- 추가: `features/finder/useFinderResults.ts`
  - 필터 상태 지연 적용
  - 동적 필터·기간·현재 선택지 집계
  - 차량 마스터 연쇄 필터 모수
  - 인기차종 계산
  - 숨김·관심·패스 반영 목록과 정렬
  - 모바일 필터 드래프트 미리보기 건수
  - 카탈로그 노출 총계
  - 엑셀 헤더 필터·정렬 결과
- 수정: `app/page.tsx`
  - 위 파생 계산 제거
  - 필터 입력을 훅에 전달하고 계산 결과만 렌더링에 사용
  - 사용하지 않는 도메인 import 정리

### 변화

- `app/page.tsx`: 832줄 → 724줄
- `useFinderResults.ts`: 신규 183줄

### 검증

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

---

## 2026-07-26 — Finder 데이터 로딩 훅 분리

### 완료한 작업

- 추가: `features/finder/useFinderData.ts`
  - 캐시된 매물 초기값
  - Firebase 인증 준비 후 상품·공급사 조회
  - 15초 로드 타임아웃과 실패 시 빈 목록 처리
  - 공급사명 결합
  - 숨김·패스 코드 초기화 및 변경 구독
- 수정: `app/page.tsx`
  - 데이터 조회와 로컬 목록 구독 effect 제거
  - `useFinderData` 결과만 소비
  - 보기 모드·필터 패널 표시 설정 복원은 데이터 로딩과 분리

### 변화

- `app/page.tsx`: 858줄 → 832줄
- `useFinderData.ts`: 신규 64줄

### 검증

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

---

## 2026-07-26 — Finder 필터 패널 분리

### 완료한 작업

- 추가: `features/finder/FinderFilterPanel.tsx`
  - 데스크톱 사이드바와 모바일 필터 시트의 공통 패널 UI
  - 최근·관심, 정렬, 인기차종, 기간, 가격, 차량, 동적 조건, 공급사 필터
- 수정: `app/page.tsx`
  - `renderSidebar()` 인라인 구현 제거
  - 필터 상태·파생값·콜백을 `FinderFilterPanelModel` 하나로 전달
  - 최근·관심 목록 초기화의 페이지 상태 동기화는 페이지에 유지

### 주요 결정

- 필터 상태의 소유권은 페이지에 유지했다.
- 수십 개 개별 props 대신 명시적인 패널 모델 하나로 경계를 만들었다.
- 드래프트와 라이브 필터를 나누는 기존 `bump()` 계약을 유지했다.
- 데스크톱과 모바일이 같은 패널을 공유하는 기존 동작을 유지했다.
- 정렬 라벨, 기본 열림 조건, 초기화 햅틱과 토스트 문구를 기존과 동일하게 유지했다.

### 변화

- `app/page.tsx`: 1,042줄 → 858줄
- `FinderFilterPanel.tsx`: 186줄

### 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS

---

## 2026-07-26 — Codex 독립 검증 및 테스트 하네스 수정

### 검증 결과

- Cursor의 `ExcelResultsTable` 분리는 기존 열 순서·폭·필터·정렬·행 동작을 유지함
- 타입 검사와 프로덕션 빌드 통과
- 전체 시뮬레이션 실행 중 기존 차량 잠금 테스트 역할 불일치 1건 발견

### 직접 수정

- `scripts/sim-vehicle-lock.mts`
  - 공급사 전용 단계 실행 시 `asRole('provider', ...)` 적용
  - 실행 후 이전 역할 복원
  - 제품 권한 정책은 변경하지 않음

### 최종 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS

---

## 2026-07-26 — Finder 엑셀 결과 테이블 분리

### 원래 요구사항

- `docs/REFACTOR_PROGRESS.md` 다음 단계: 엑셀 결과 테이블을 `features/finder` 독립 컴포넌트로 분리
- UI, 필터 의미, 정렬, 열 너비, 모바일 동작은 변경하지 않는다
- `IMPLEMENTATION_LOG.md` 갱신
- `npm.cmd run typecheck` 실행
- 커밋하지 않는다

### 완료한 계획 단계

- Finder 단계 분리 2번: 엑셀 결과 테이블 컴포넌트 이동

### 실제 변경 파일

- 추가: `features/finder/ExcelResultsTable.tsx`
  - 시트·테이블·헤더 필터 팝(`ExcelFilterPopover`) 렌더
  - 열 모드(`excelColMode` 등)·칸 폭·`hdrTh` 헤더 클릭 포함
- 수정: `app/page.tsx`
  - 엑셀 뷰 본문을 `<ExcelResultsTable … />` 호출로 대체
  - `excelRows`·`months`·`colFilter`/`colSort`/`openCol` 상태와 행 클릭·컨텍스트 메뉴는 페이지에 유지
- 수정: `IMPLEMENTATION_LOG.md` (본 문서)
- 수정: `docs/REFACTOR_PROGRESS.md`

### 주요 구현 결정

- 데이터 계산(`excelRows`, `months`)은 페이지에 남겨 다운로드·스크롤바 폭 계산과 계약을 유지했다.
- 팝오버용 `list`(사이드 match 결과)와 표시용 `rows`(헤더 필터·정렬 반영)를 props로 분리해 기존 OR/필터 의미를 그대로 둠.
- `openCol`은 페이지 `reset()`이 닫을 수 있도록 페이지 상태에 유지했다.
- 디자인·도메인 의미 변경 없음. `useIsMobile()` 분기는 컴포넌트 내부에서 기존과 동일하게 유지.

### 실행한 테스트와 결과

- `npm.cmd run typecheck`: PASS

### 계획과 달라진 부분

- 없음. UI/필터/정렬/열너비/모바일 동작 변경 없이 구조만 분리.
- build·sim 재실행은 이번 요청 범위 밖(typecheck만 요청).

### 알려진 문제와 미완료 항목

- Finder 필터 패널 분리, `useFinderData`/`useFinderResults` 훅 분리는 다음 단계
- build / sim-agent / sim-phase12는 이번 단계에서 미실행

### 작업 트리 상태

커밋하지 않음.

- 추가: `features/finder/ExcelResultsTable.tsx`
- 수정: `app/page.tsx` (1,213줄 → 1,042줄)
- 수정: `IMPLEMENTATION_LOG.md`, `docs/REFACTOR_PROGRESS.md`
- 기존 1차 분리 파일(`filter-state.ts`, `excel-columns.ts`, `ExcelFilterPopover.tsx`)은 유지

---

## 2026-07-26 — Finder 대형 파일 단계 분리

### 원래 요구사항

- `app/page.tsx` 같은 대형 단일 파일을 안전하게 분리한다.
- 다른 AI가 작업 상황을 이어받을 수 있도록 인수인계 문서를 계속 갱신한다.
- 기능과 화면 동작은 변경하지 않는다.

### 완료한 작업

1. Finder 필터 상태와 sessionStorage 직렬화 로직 분리
   - `features/finder/filter-state.ts`
2. 엑셀 열 표시값·필터·정렬 순수 로직 분리
   - `features/finder/excel-columns.ts`
3. 엑셀 열 필터 팝오버 UI 분리
   - `features/finder/ExcelFilterPopover.tsx`
4. 협업 및 장기 진행 문서 추가
   - `docs/AI_COLLABORATION.md`
   - `docs/REFACTOR_PROGRESS.md`
   - `HANDOFF.md` 진입 링크 갱신

### 실제 변화

- `app/page.tsx`: 1,459줄 → 1,213줄
- 필터 상태 구조, 저장 키, 엑셀 필터 의미, 정렬 방식 유지
- `FilterPop` 호출은 `ExcelFilterPopover`로 대체

### 계획과 달라진 부분

- 이번 연속 작업에는 별도의 Claude Code `PLAN.md`가 없었다.
- 사용자가 이미 승인한 Finder 구조 분리 범위와
  `docs/REFACTOR_PROGRESS.md`의 다음 작업 순서를 기준으로 진행했다.
- 중요한 아키텍처 또는 데이터 계약 변경은 수행하지 않았다.

### 검증

- 1차 분리 후:
  - `npm.cmd run typecheck`: PASS
  - `npm.cmd run build`: PASS
  - `npx.cmd tsx scripts/sim-agent.mts`: 37/37 PASS
  - `npx.cmd tsx scripts/sim-phase12.mts`: 25/25 PASS
- `ExcelFilterPopover` 분리 직후:
  - `npm.cmd run typecheck`: PASS
  - `npm.cmd run build`: PASS
  - `npx.cmd tsx scripts/sim-agent.mts`: 37/37 PASS
  - `npx.cmd tsx scripts/sim-phase12.mts`: 25/25 PASS

### 다음 작업

1. 현재 변경의 프로덕션 빌드 및 핵심 시뮬레이션 재검증
2. 엑셀 결과 테이블 컴포넌트 분리
3. Finder 필터 패널 분리
4. 데이터 로딩·검색 결과 계산 훅 분리

### 작업 트리

현재 변경은 커밋하지 않았다. 기존 사용자 변경을 삭제하거나 재정렬하지 않았다.

---

## 2026-07-26 — Inventory 3차 분리 (편집 패널 UI)

### 완료한 작업

- `features/inventory/InventoryEditorPanes.tsx` 추가
  - 기본정보 패널의 등록증 입력, 차종 마스터, 스펙 필드 UI 이동
  - 운영정보 패널의 정책, 가격, 사진, 공급사 사진 UI 이동
  - 편집 화면 의존성을 `InventoryEditorModel` 하나로 명시
- `app/inventory/page.tsx`
  - 편집 패널 JSX와 필드 메타데이터 조합 책임 제거
  - 저장, OCR 처리, 마스터 적용, 상태 변경 로직은 페이지에 유지
  - 749줄에서 643줄로 축소

### 유지한 계약

- 신규/수정/읽기 모드와 미저장 표시
- 관리자 전용 원가·이력 필드
- 공급사별 정책 필터링
- OCR 파일 입력, 마스터 선택과 재매칭
- 가격·사진·실내사진 변경 시 dirty 처리

### 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, 26개 페이지 생성
- 전체 도메인 시뮬레이션: PASS
- 차량 마스터 검증: PASS

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — 공통 UI 오버레이 1차 분리

### 완료한 작업

- `components/ui/overlays.tsx` 추가
- 공통 `Drawer`, `Modal` 구현을 `components/ui/index.tsx`에서 이동
- 기존 `@/components/ui` 공개 import 경로는 barrel 재수출로 유지
- `components/ui/index.tsx`: 782줄 → 731줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — Firebase RTDB 데이터 계층 정리 배치

### 분리한 모듈

- `lib/firebase/rtdb-records.ts`
  - v3 첨부파일 정규화
  - 엔티티별 v3→v4 레코드 변환
  - 외부 입력 타입은 `unknown` 기반 경계로 제한
- `lib/firebase/rtdb-products.ts`
  - 카슝 상품 제외
  - 역할·소유사별 원가 마스킹
  - 실차 신원 기준 중복 제거

### 결과

- `rtdb-adapter.ts`: 537줄 → 406줄
- 공개 `RtdbAdapter`/`StoreAdapter` API 유지
- v3 읽기 전용·v4 오버레이 쓰기 정책 유지
- 계약·메시지·정산·고객 역할 스코프 조회 유지
- 남은 명시적 `any` 9건은 Firebase snapshot 동적 경계에 한정

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 홈·재고·계약·채팅·회원·설정: 모두 HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 설정·회원·계약·채팅 UI/UX 통합 배치

### 분리한 컴포넌트

- `features/settings/ProductPreferences.tsx`
  - 관심함·관심없음·숨김 상품 관리 UI 통합
- `features/members/MembersList.tsx`
  - 사용자·파트너 탭, 빈 상태, 목록행·역할 뱃지
- `features/contract/SettlementSummary.tsx`
  - 역할별 정산 대기·완료·환수·순수익 요약
- `features/chat/ChatRoomList.tsx`
  - 역할별 빈 상태, 조건 해제, 채팅 방 목록행

### 페이지 축소

- 설정: 379줄 → 302줄
- 회원: 368줄 → 353줄
- 계약: 355줄 → 337줄
- 채팅: 347줄 → 337줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `/settings`, `/members`, `/contract`, `/chat`: 모두 HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 회원 관리 1차 분리 (필터·정렬)

- `features/members/member-filter.ts` 추가
- 사용자·파트너 필터 옵션과 역할 SSOT 파생 이동
- 활성·비활성·승인대기·역할·파트너유형 필터 이동
- 이름·역할·코드 정렬과 승인대기 최상단 규칙 이동
- `app/members/page.tsx`: 409줄 → 368줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/members`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 계약 페이지 1차 분리 (필터·정렬)

- `features/contract/contract-filter.ts` 추가
- 진행·전체·계약상태 필터와 월 필터 이동
- 상태순·진행순·계약자순·최근순 정렬 이동
- 월 옵션과 표시 라벨 계산 이동
- 기본 진행 필터가 취소만 제외하고 완료를 포함하는 규칙 유지
- `app/contract/page.tsx`: 393줄 → 355줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/contract`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 채팅 페이지 2차 분리 (목록 필터·정렬)

- `features/chat/room-filter.ts` 추가
- 미확인·문의·전체·완료·취소 필터 이동
- 안읽음 우선·최근순 보조·차명순 정렬 이동
- 드래프트 필터 결과 미리보기 집계 이동
- `app/chat/page.tsx`: 372줄 → 347줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/chat`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 채팅 페이지 1차 분리 (방 색인·표시)

- `features/chat/room-display.ts` 추가
- 진행/취소 계약 first-wins 색인 분리
- 상품·삭제상품의 코드·키·차량번호 lookup 이동
- 방 제목, 삭제 차량 fallback, 공급사 표시 계산 이동
- `app/chat/page.tsx`: 435줄 → 372줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/chat`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — Finder 4차 축소 (결과 본문)

- `features/finder/FinderResults.tsx` 추가
- 빈 결과, 카드·상세·엑셀 보기, 더보기·전체 보기 UI 이동
- Excel 필터·정렬·팝오버 상태 연결과 상품 컨텍스트 메뉴 유지
- `app/page.tsx`: 563줄 → 511줄
- ref 타입 호환 문제 1건 발견 후 수정
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — Finder 3차 축소 (상단 툴바)

- `features/finder/FinderToolbar.tsx` 추가
- 모바일 검색·필터 버튼과 웹 검색·정렬·관심함·다운로드·보기 전환 이동
- 정렬·보기 옵션 SSOT도 툴바 모듈로 이동
- 기존 Finder 상태와 콜백 API 유지
- `app/page.tsx`: 644줄 → 563줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — Finder 2차 축소 (상품 컨텍스트 액션)

- `features/finder/product-context.ts` 추가
- 계약문의, 손님공유, 상품 내용 복사, 상세 이동 메뉴 구성 이동
- 페이지에는 컨텍스트 메뉴 열기와 라우팅 연결만 유지
- 복사 실패 시 구형 prompt 대신 공통 error toast 사용
- `app/page.tsx`: 690줄 → 644줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 차량 마스터 정확 경로·운영 작업 분리

### 완료한 작업

- `lib/domain/vehicle-master-exact.ts` 추가
  - 추정 없는 마스터 실경로 판정 엔진 이동
  - 동 gen_code 후보의 제조사·모델·세부모델 축소 규칙 유지
- `lib/domain/vehicle-master-operations.ts` 추가
  - 마스터 경로 집합·적합 판정
  - 일괄 reconcile과 전수 audit 엔진 이동
- 매칭 함수와 스냅 적용 함수는 인자로 주입해 순환 의존성 방지
- 기존 `resolveExactMasterPath`, `reconcileToMaster`, `auditMasterFit` API 유지
- `vehicle-master-match.ts`: 915줄 → 805줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 안전한 분리 후보는 공통 리스트(`ListRow`, `ListBox`)와 폼 입력 묶음이다.

---

## 2026-07-26 — 공통 UI 리스트 2차 분리

### 완료한 작업

- `components/ui/list.tsx` 추가
- 보조 공통 리스트 `ListRow`, `ListBox` 이동
- 기존 `@/components/ui` 공개 import 경로는 barrel 재수출로 유지
- `components/ui/index.tsx`: 731줄 → 706줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 작업은 `Select`, `Input`, `Textarea`, `SearchInput` 폼 입력 묶음 분리다.

---

## 2026-07-26 — 공통 UI 폼 입력 3차 분리

### 완료한 작업

- `components/ui/form-controls.tsx` 추가
- `Select`, `Input`, `Textarea`, `SearchInput` 이동
- 기존 `@/components/ui` 공개 import 경로와 props 유지
- 모바일 입력 글꼴·높이, Enter 처리, 검색 초기화·포커스 로직 보존
- `components/ui/index.tsx`: 706줄 → 633줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 후보는 버튼 묶음(`Btn`, `IconBtn`, `IconSeg`) 또는 레이아웃 묶음이다.

---

## 2026-07-26 — 공통 UI 버튼 4차 분리

### 완료한 작업

- `components/ui/buttons.tsx` 추가
- `Btn`, `IconBtn`, `IconSeg` 이동
- `components/ui/index.tsx` 내부 사용은 leaf 모듈 직접 import로 연결
- 기존 `@/components/ui` 공개 import 경로와 props 유지
- `components/ui/index.tsx`: 633줄 → 554줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 후보는 `PaneHead`, `PaneBody`, `CardGrid`, `VSplit` 등 레이아웃 원자다.

---

## 2026-07-26 — 공통 UI 레이아웃 5차 분리

### 완료한 작업

- `components/ui/layout.tsx` 추가
- `PaneHead`, `PaneBody`, `CardGrid`, `VSplit` 이동
- 기존 `@/components/ui` 공개 import 경로와 props 유지
- 패널 스크롤, 모바일 헤더 높이, VSplit 드래그·비율 저장 로직 보존
- `components/ui/index.tsx`: 554줄 → 494줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

공통 UI 본체가 500줄 아래로 내려왔다. 다음에는 핵심 차량 매칭 파일을 타입·표시 유틸부터 단계적으로 분리한다.

---

## 2026-07-26 — 차량 마스터 매칭 1차 분리 (순수 타입)

### 완료한 작업

- `lib/domain/vehicle-master-types.ts` 추가
- `MasterVariant`, `MasterEntry`, `SnapResult`, `ExactMasterPath`, `VehicleFilter`, `MasterFitBucket`, `MasterFitRow` 이동
- 기존 `vehicle-master-match.ts` 타입 import 경로는 재수출로 호환 유지
- 매칭·스냅·감사 실행 로직은 변경하지 않음

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음은 표시 전용 함수(`yearDisplay`, `fuelDisplay`, `makerDisplay`)와 그 정규화 보조 함수의 의존성을 조사한 뒤 한 묶음으로 분리한다.

---

## 2026-07-26 — 차량 마스터 매칭 2차 분리 (표시·정규화)

### 완료한 작업

- `lib/domain/vehicle-master-format.ts` 추가
- `parseYear`, `yearDisplay`, `normFuel`, `fuelDisplay`, `makerDisplay`, `fuelEmbeddedCc` 이동
- 연료 별칭 `FUEL_ALIAS`도 동일 모듈에서 관리
- 기존 `vehicle-master-match.ts` 함수 export 경로는 재수출로 유지
- 매칭 본체는 leaf 포맷 모듈을 직접 참조
- `vehicle-master-match.ts`: 1,068줄 → 1,040줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 후보는 스냅 추적·이력(`SNAP_TRACK_*`, raw capture, diff, history) 묶음이다.

---

## 2026-07-26 — 차량 마스터 매칭 3차 분리 (스냅 추적·이력)

### 완료한 작업

- `lib/domain/vehicle-master-snapshot.ts` 추가
- 추적 필드·라벨, 원본 캡처, 필드 diff, 변경 이력 생성 이동
- `applySnap`의 실제 반영 정책은 매칭 본체에 유지
- 최근 이력 10건 유지와 최초 `_raw_vehicle` 보존 규칙 유지
- 기존 `vehicle-master-match.ts` 공개 export 경로 유지
- `vehicle-master-match.ts`: 1,040줄 → 1,001줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 후보는 필터·마스터 탐색(`VehicleFilter`, maker/model/sub 목록) 묶음이다.

---

## 2026-07-26 — 차량 마스터 매칭 4차 분리 (필터·목록 탐색)

### 완료한 작업

- `lib/domain/vehicle-master-filter.ts` 추가
- 빈 필터, 활성 필터 수, 매물 필터 판정 이동
- 제조사 그룹·모델·세부모델 목록 탐색 이동
- 르노 계열 표기 호환과 국산 우선 정렬 유지
- 기존 `vehicle-master-match.ts` 공개 export 경로 유지
- `vehicle-master-match.ts`: 1,001줄 → 976줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음은 마스터 경로 검사·감사와 일괄 reconcile의 의존성을 분리 가능한 단위로 정리한다.

---

## 2026-07-26 — 차량 마스터 매칭 5~6차 분리

### 차량 신호 수집

- `lib/domain/vehicle-master-signals.ts` 추가
- 신호 키, 원본 우선 수집, blob 생성, 재스냅 입력 복원 이동

### 파워트레인·트림 선택 보조

- `lib/domain/vehicle-master-options.ts` 추가
- 마스터 라벨, 인승 분기, 옵션 라벨, 미선택 트림 판정 이동

### 결과

- 기존 `vehicle-master-match.ts` 공개 export 경로 유지
- 매칭 점수·스냅 반영 알고리즘 변경 없음
- `vehicle-master-match.ts`: 976줄 → 915줄
- typecheck: PASS
- 전체 7개 시뮬레이션·차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 브라우저 기본 확인창·알림 현대화

### 완료한 작업

- 기존 `window.confirm`을 공통 `confirmDialog`로 교체
  - 계약 취소
  - 정책 삭제
  - 회원 편집 이탈·비공개 전환·회원 삭제
  - 재고 상품 삭제
  - 개발 도구의 V3 마이그레이션
- 로그인/가입 오류의 `window.alert`를 공통 `toast`로 교체
- `app`, `components`, `features` 아래 직접 `window.confirm`·`window.alert` 호출 제거

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — 클립보드 호환 처리 1차 통합

- `lib/clipboard.ts` 추가
- Clipboard API 우선, 비보안·구형 환경 textarea fallback 통합
- `CopyBlock`, 계약서 링크, 재고 종합표 복사 적용
- 실패를 성공으로 표시하던 조용한 catch를 명시적 오류 알림으로 개선
- Cursor의 product card 가격 파일은 수정하지 않음
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

### 2차 적용

- Finder 손님공유·상품 내용 복사
- 상품 상세 손님공유
- 카드 더보기 손님공유
- 설정의 영업자 공유 링크
- 직접 `navigator.clipboard` 호출은 `lib/clipboard.ts` 내부로 일원화

---

## 2026-07-26 — Cursor 가격·혜택 원자 분리 검증 완료

- 추가: `components/product-card-pricing.tsx`
- 추가: `components/product-card-perks.tsx`
- `components/product-card-atoms.tsx`: 725줄 → 271줄
- 기존 공개 export 경로 유지
- 순환 의존성 없음
- 독립 검증에서 UTF-8 BOM 제거
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

---

## 2026-07-26 — Product card atoms 6차 분리 (뱃지 UI)

- `components/product-card-badge-view.tsx` 추가
- `CardKind`, `CardRailBadges` 이동
- 뱃지 계산 모듈과 카드 배치 UI 경계 분리
- `components/product-card-atoms.tsx`: 764줄 → 725줄
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

---

## 2026-07-26 — Product card atoms 5차 분리 (신원 UI)

- `components/product-card-identity-view.tsx` 추가
  - 차량번호 원자 `Plate`
  - 말줄임 차량 제목 `CardTitle`
- `product-card-identity.ts`의 순수 문자열 조합과 UI 표현을 분리
- 기존 `product-card-atoms` 공개 경로 재수출 유지
- `components/product-card-atoms.tsx`: 789줄 → 764줄

### 검증

- typecheck와 전체 시뮬레이션: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — Product card atoms 4차 분리 (차량 신원·제원)

- `components/product-card-identity.ts` 추가
  - 데스크톱·모바일 차량 제목 조합
  - 상세 제원 문자열
  - 카드 고정 제원 문자열
- 기존 `product-card-atoms` 경로에서 동일 이름 재수출
- `components/product-card-atoms.tsx`: 843줄 → 789줄

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 서버 유지 요청에 따라 보류

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Product card atoms 3차 분리 (기간별 요금)

### 완료한 작업

- `components/product-card-fares.tsx` 추가
  - `PriceMini`
  - compact 기간별 요금 카드
  - `PriceFare`
- `components/product-card-atoms.tsx`
  - 기간별 요금 구현 제거 및 기존 경로 재수출
  - 929줄 → 843줄

### 서버 유지 방식

- 4004 개발 서버를 재시작해 `/inventory` HTTP 200 복구
- 개발 서버와 `.next` 충돌을 피하기 위해 이번 단계부터 작업 중 `next build` 미실행
- typecheck와 전체 시뮬레이션 후에도 서버 HTTP 200 확인

### 검증

- `npm.cmd run typecheck`: PASS
- 전체 시뮬레이션·차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 서버 유지 요청에 따라 보류

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Product card atoms 2차 분리 (뱃지)

### 완료한 작업

- `components/product-card-badges.tsx` 추가
  - 차량 상태·상품 구분·심사 뱃지 스펙
  - 축약 라벨, hover 설명, 혜택 설명
  - 사진 마크, 모바일 뱃지 클립, 차량 placeholder glyph
- `components/product-card-atoms.tsx`
  - 뱃지 구현 제거 후 내부 import·외부 재수출
  - 1,037줄 → 929줄

### 보존한 계약

- 표기 순서: 차량상태 → 상품분류 → 심사기준
- customer audience에서 차량 상태 숨김
- 계약중 solid/pulse 표시
- 사진 마크는 상태·심사만 노출
- 기존 import 경로 및 export 이름 유지

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증, production build: PASS
- 주요 route 번들 크기 변화 없음

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Product card atoms 1차 분리 (옵션)

### 완료한 작업

- `components/product-card-options.tsx` 추가
  - 옵션 문자열 파싱
  - 카드·상세·엑셀 옵션 칩
  - ResizeObserver 기반 오버플로 표시
- `components/product-card-atoms.tsx`
  - 옵션 구현 제거
  - 기존 공개 import 경로를 위한 재수출 유지
  - 1,151줄 → 1,037줄

### 호환성

- `ProductCard`, `ProductRowCard`, `ProductDetail`, Finder는 기존
  `@/components/product-card-atoms` import를 그대로 사용한다.
- 옵션 2개+말줄임, 엑셀 2줄, 상세 전체 펼침 동작을 유지한다.

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증, production build: PASS
- 주요 route 번들 크기 변화 없음

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Inventory 런타임 스모크·번들 분석

### 확인 결과

- 로컬 `/inventory`: HTTP 200, 응답 본문 19,887 bytes
- production route 표기: 19.7 kB / First Load JS 272 kB
- route 전용 chunk: 51,983 bytes (비압축 파일 크기)
- `SheetSync`는 별도 동적 chunk 유지
- `vehicle-master-load`는 동적 import 유지

### 판단

최근 단계별 0.1~0.3 kB 증가는 대형 의존성이 새로 초기 번들에 들어온 것이 아니라
모듈과 훅 경계 추가에 따른 작은 래퍼 비용으로 판단한다. 이를 줄이기 위해 책임을 다시
페이지에 합치는 것은 이번 리팩터링 목표와 맞지 않아 코드 변경을 하지 않았다.

### 브라우저 검증

연결 가능한 인앱 브라우저나 Chrome 세션이 없어 실제 클릭·반응형 수동 검증은 보류했다.
HTTP 스모크, 전체 자동 시뮬레이션과 production build는 통과한 상태다.

---

## 2026-07-26 — Inventory 6차 분리 (데이터·권한 초기화)

### 완료한 작업

- `features/inventory/useInventoryData.ts` 추가
  - 상품·공급사 병렬 로딩과 공급사 소유 상품 범위 적용
  - 정책, 권한 게이트, 오류 메시지 상태 관리
  - 최초 진입, 역할 변경, 작업 목록 재진입 이벤트 처리
- `app/inventory/page.tsx`: 386줄 → 342줄

### 보존한 동작

- 관리자·공급사만 재고관리 접근 가능
- 공급사 역할은 자기 회사 상품만 조회
- 초기 정책 목록 선로딩
- 모바일은 목록부터, 데스크톱은 첫 상품 자동 선택
- 마스터 데이터는 첫 화면을 막지 않고 백그라운드 로딩
- 역할 변경과 재고 메뉴 재진입 시 선택 상태 초기화

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증, production build: PASS
- `/inventory`: 19.7 kB

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Inventory 5차 분리 (편집 수명주기)

### 완료한 작업

- `features/inventory/useInventoryEditorLifecycle.ts` 추가
  - 신규 생성, 필드 변경, 초기화, 복사·붙여넣기
  - 저장, 수정 취소, 편집 시작
  - 계약 보호를 포함한 소프트 삭제
- `app/inventory/page.tsx`: 496줄 → 386줄

### 보존한 업무 규칙

- 공급사는 자기 회사 상품만 저장·삭제 가능
- 차량번호 공백 정규화 후 중복 등록 차단
- 계약 엔진 잠금 상태가 폼의 차량 상태보다 우선
- 진행 중인 계약이 있으면 상품 삭제 차단
- 저장 직전 이벤트 태그와 외·내장색 정규화
- 초기화 시 식별·귀속·상태 필드 유지
- 복사 시 차번·VIN·상품코드·사진 제외

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증, production build: PASS
- `/inventory`: 19.5 kB

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Inventory 4차 분리 (OCR·차종 마스터 훅)

### 완료한 작업

- `features/inventory/useInventoryVehicleTools.ts` 추가
  - 차종 마스터 지연 로딩과 캐시
  - 상품 선택 시 exact 경로 확인 및 안전한 자동보정
  - 색상 규격 자동보정과 해당 목록·캐시 패치
  - 사용자 요청 재매칭과 마스터 피커 결과 적용
  - 등록증 OCR 요청과 빈 필드 병합
- `app/inventory/page.tsx`
  - 위 비동기 처리와 관련 상태·ref 제거
  - 643줄에서 496줄로 축소

### 보존한 안전장치

- 빠른 상품 선택 시 이전 비동기 응답 무시
- exact 경로이며 high/medium 신뢰도일 때만 DB 자동반영
- low 신뢰도 결과는 검토용 폼에만 적용
- OCR 결과는 기존 값이 비어 있는 필드만 채움
- 자동저장 실패 시 사용자 알림 및 원본 유지

### 검증

- typecheck, 7개 시뮬레이션/검증 스크립트, production build: PASS
- `/inventory`: 19.2 kB

현재 변경은 커밋하지 않았다.
## 2026-07-27 — Firebase Storage 원본 + Google Drive 백업

- `lib/firebase/storage-files.ts`: 파일 경로·크기 제한·Storage 업로드/삭제·선택적 Drive 백업을 통합했다.
- `app/api/drive-backup/route.ts`, `lib/server/drive-backup.ts`: Firebase 로그인 확인 후
  OAuth refresh token으로 Drive 폴더 생성과 multipart 백업을 수행한다.
- 상품 사진과 계약 서류는 Storage 저장 후 Drive 백업을 시도하고, 채팅 첨부는 Storage만 사용한다.
- 계약·채팅의 업무 레코드 저장 실패 시 이미 업로드한 Storage 원본을 정리한다.
- 레거시 data URL은 마이그레이션 없이 계속 읽는다.
- `storage.rules`, `firebase.json`, `.env.example`과 운영 문서를 추가했다.
- 공유 버킷을 계속 쓰는 V3의 기존 7개 Storage 경로 규칙을 병합해 V4 게시가 V3를 막지 않게 했다.
- Drive 사본은 복구용이므로 ERP 삭제와 연동해 삭제하지 않는다.
- 2026-07-27 운영 버킷 `freepasserp3.firebasestorage.app`에 병합 Rules 게시 완료.
- 게시 전 V3 Rules는 `storage.rules.PREV`에 보존했다.
- Google Drive API 활성화 및 `FreepassERP4 백업` 루트 폴더 생성 완료.
- OAuth 앱 정책 동의와 클라이언트/refresh token 발급은 계정 소유자 확인 대기다.

## 2026-07-28 — 계약 요약 컴포넌트 폐기 / 모바일 버튼 규격

- 2026-07-26 기록의 `SettlementSummary`는 이후 화면 규격 재검토에서 폐기했다.
- 계약 툴바 아래 `대기·완료·환수·순수익` 요약줄과 컴포넌트를 제거했다.
- 모바일 공통 유틸리티 버튼은 접근성 이름이 있는 아이콘 버튼으로 통일했다.
- 위험하거나 의미가 모호한 업무 버튼과 내비게이션·선택 칩은 텍스트를 유지한다.

## 2026-07-28 — 모바일 표면 액션 아이콘 전용 2차 통일

- `Btn.mobileIcon`으로 모바일은 아이콘, 웹은 기존 텍스트를 렌더링한다.
- 핵심 업무 화면의 표면 액션을 공통 규격으로 전환했다.
- 모바일 엑셀·정산서·종합표 다운로드/내보내기 액션을 제거했다.
- 선택 칩·탭·확인 대화상자는 오조작 방지를 위해 텍스트를 유지한다.

## 2026-08-04 — 공급사 시트 매핑 고정 (Claude)

### 한 일

- `scripts/learn-sheet-mapping.mts` 로 16곳 중 **15곳에 `mapping_profile`·`mapping_header_signature` 저장**.
- 오토플러스는 제외 — 본탭 20열 / 프로모션탭 18열로 헤더가 실제로 다르다.
  하나로 고정하면 나머지 탭이 드리프트로 막히므로 전용 어댑터에 맡긴다.

### 왜

저장된 프로파일이 **0/16** 이라 동기화할 때마다 헤더 행·컬럼 매핑·어댑터를 매번 다시 추측했다.
유입 사고(손오공·웰릭스 0대, 오토플러스 18대, 아이카 종합시트)가 반복된 근원이다.

저장하면 `sheet-import.ts:537-555` 의 **fail-closed 드리프트 감지**가 켜진다 —
공급사가 열을 옮기거나 이름을 바꾸면 조용히 잘못 읽는 대신 던진다.
그 보호가 지금까지 한 곳도 안 걸려 있었다.

### 검증 (`tmp/verify-pinned-mapping.mts`)

고정 매핑과 자동추측으로 **각각 실제 유입을 돌려 대수를 대조**했다. 고정이 결과를 바꾸면 안 된다.

```
RP030 7=7 · PT-0023 30=30 · RP004 74=74 · RP006 28=28 · RP008 3=3 · RP010 11=11
RP012 32=32 · RP013 17=17 · RP015 1=1 · RP016 0=0 · RP017 2=2 · RP018 20=20
RP020 19=19 · RP021 45=45 · RP022 1=1
✓ 전부 일치 — 고정해도 유입 결과 동일
```

### 남은 것

- 공급사가 시트 열을 바꾸면 이제 동기화가 **막힌다**(조용한 오유입 대신). 그때 재학습:
  `npx tsx scripts/learn-sheet-mapping.mts --only=<코드> --apply`
- 오토플러스는 전용 어댑터 유지.
# 2026-08-16 상품마스터 587대 차종 커버리지 재감사 (Cursor)

- `scripts/audit-product-master-vehicle-coverage.mts` 추가: 상품마스터 `A:AX`를 GET-only로 읽고 차량번호별 현재 영구키 실재/운영 tier와 미매칭·차단키의 후속 후보를 전수 산출한다. 상세에는 차번, 기존키, 후보키, 단일/다중/무후보 원인을 남기며 저장 위치는 추적 제외 영역인 `tmp/product-master-vehicle-coverage.json`이다.
- OAuth와 Sheet GET에 각각 30초 timeout을 추가했다. 네트워크 실패 시 직전 라이브 보고서만 재분류하며 `source.mode`에 fallback임을 명시해 라이브 결과로 오인하지 않게 했다.
- 연식은 `parseYear`를 사용하고 `연식/모델연도/MY`를 최초등록과 교차검증한다. 배기량 2,000이 연식 2000으로 복제된 공급사 오염은 최초등록과 2년 넘게 충돌하면 최초등록 연도를 사용한다.
- 후보는 generation뿐 아니라 연료·배기량(표기 반올림 ±50cc)·구동·인승·트림으로 재협소화한다. 공급사 표시문에서 HEV/LPG/디젤/EV/가솔린, 2WD/4WD/AWD/RWD/FWD, 인승을 보조 원자로 읽는다.
- 원문 표시의 리터 배기량과 구조화 배기량이 150cc 넘게 충돌하면 `CONFLICT`로 분리한다(실측 팰리세이드 3.8/2,500 2대). 단일 후보는 최소 셀 compare-and-set용 `expected_current_code`, `expected_verification`, `replacement_code`를 보고서에만 산출했다. Sheet/registry/RTDB write는 0건이다.
- 1차 라이브 실측(정교화 전): 전체 587, 정상 268, 미코드 단일자동 54, 다중자동 89, 무후보 56, 수동후보 1. 차단키 참조 119는 단일 후속 4, 다중 후속 24, 안전후보 없음 91로 분류됐다. 최종 구동·인승 보조원자 협소화 수치는 Codex 재검증 대상으로 인계한다.
- 최종 라이브 실측(구동·인승·월 생산기간 포함): 정상 268, 미코드 단일 64, 다중 79, 무후보 56, 수동 1; 차단키 119는 단일 후속 5, 다중 후속 23, 무후보 91. 단일 총 69 중 원문 내부 배기 충돌 2를 제외해 guarded patch 후보는 67대다.
- `scripts/apply-product-master-vehicle-coverage.mts` 추가: 기본 dry-run이며 `--apply`에서만 동작한다. 라이브 차량번호·현재 차종코드·검증상태 3항 CAS, replacement automatic/확정 재검증, 적용값 생성 확인 뒤 `차종마스터 적용값·검증상태·검수사유·관리상태·차종코드` 5개 개별 셀만 batchUpdate한다. 적용 전 snapshot과 적용 후 재조회 검증을 강제한다.
- dry-run 실측: SAFE 67대, 계획 셀 335개, Sheet write 0. 실제 `--apply`는 실행하지 않았다.

# 2026-08-17 상품 차종매칭 운영판정/계층후보 분리

- 직전 `상품 차종매칭` 조회가 4계층 표시 후보 565대를 `정상/매칭완료`로 표시했지만, 같은 상품 snapshot의 엄격 영구키 감사에서 실제 확정은 459대뿐임을 재감사했다.
- 교차 집계상 계층 후보는 있으나 영구키가 미확정인 106대는 다중 자동후보 72, 안전 후보 없음 31, 수동후보 1, 원천 입력 충돌 1, 확정코드 명시축 불일치 1이다.
- `lib/domain/product-vehicle-match-view.ts`를 추가해 운영 확정은 엄격 감사의 `확정 코드 정상` + 현재 코드 존재 + 명시축 무충돌일 때만 허용한다. 계층 추론은 `참고 계층 후보(미확정 가능)`로만 분리한다.
- `scripts/publish-product-vehicle-match-view-v2.mts`는 `운영 확정 459 / 확인 필요 128`과 `계층 후보 있음 565 / 미해결 22`를 별도 집계한다. blocked/nonexistent key, 원본 fingerprint, 규격검토 artifact SHA-256, 계층 회귀 게이트가 어긋나면 게시를 거부한다.
- `scripts/sim-product-vehicle-match-view.mts` 9/9 PASS. 라이브 원본 GET-only dry-run은 459/128 및 565/22를 재현했다.
- 라이브 `상품 차종매칭` 탭은 아직 수정하지 않았다. 정본 셀 변경은 사용자 직전 승인 후 `--apply`와 post-read를 실행한다.

## 2026-08-18 — 규격검토 keyed 채택본 게시 준비

- `차종마스터_규격검토`를 기존 5,334키 원장과 교체하지 않고, 영구키별 companion 정본 `차종마스터_규격채택!A1:AD2107`로 채택하는 plan/apply/sim 경로를 추가했다.
- 검토 2,097그룹은 2,106 영구키 행으로 전개된다. 구조채택 예정 2,086행은 선택질문 없음 601 + 선택질문 유지 1,485이고, 검토유지 20행은 채택하지 않는다. 운영등급·기존 원장·registry·artifact 변경 계획은 0건이다.
- writer는 승인 plan SHA·실행계정·문서/탭 ID·원본 전체값·영구키·로컬 artifact/registry·구현 파일 해시를 write 전후 CAS한다. 새 사전지정 sheetId의 숨김 staging만 쓰고, 전체 보호·서식·metadata·값을 재읽은 뒤 최종 이름으로 공개한다.
- add/rename/re-hide 응답 유실과 SIGKILL을 위한 단일 실행 lock, 원자적 이중 journal, nonce/provenance 소유권, 190초 결과불명확 fence, known-add rollback과 3회 부재 확인을 추가했다.
- 최신 라이브 read-only 계획 SHA-256은 `c9080a1859bc718c1da093d627b871c762804a624e06ead8962addd4f9d6e640`; 대상 탭은 아직 없고 `humanApprovalRecorded=false`, Sheet write 0이다.
- 이 companion 탭은 규격 채택 기록 정본이며 현재 앱·상품매칭 consumer는 아직 연결되지 않았다. 운영 consumer 전환은 게시 후 별도 단계다.

## 2026-08-18 — 차종 3축 검토 재개 · 규격채택 게시 · 판매시트 차량번호 정본 발행 (Claude Code, 코덱스 인계분)

사장님 확정: 검토 범위는 **모델·세부모델·세부트림 3축**. 코덱스가 쿼터 소진으로 멈춘 자리부터 이었다.

### 원천대장 서식(사장님 지시 3건)
- `scripts/format-vehicle-master-sheet.mts` + `lib/domain/vehicle-master-sheet-format.ts`: 「ERP4 차종마스터 원천대장」 12탭 전부 Noto Sans KR **9pt**(판매시트 SIZE 와 동일), 표 탭 행 **22px**(rowPx), 안내 탭은 행 자동맞춤.
  `차종마스터_규격검토`에 구분 열 글자색 조건부서식 75규칙(제조국·제조사·연료·과급·구동·구동시스템·차종분류·차체형태·검증상태). 차종마스터(42)·상품마스터(15)·규격채택(3)의 기존 조건부서식은 건드리지 않았다.
- `publish-hyundai-three-model-review.mts` 도 같은 표준을 쓰게 고쳐 재발행해도 9pt·22px·구분색이 유지된다.

### 규격채택(정규화) 게시
- 라이브 규격검토가 로컬 고정본과 2셀 달랐다(4행 세부모델에 EV 이름, 5행 세부모델 공란 — 셀 끌기 실수 형태). 두 셀만 원래 값으로 되돌린 뒤 계획을 다시 뽑았다(plan SHA `435ca252…a05f`).
- `apply-vehicle-master-review-adoption.mts --apply` → 「차종마스터_규격채택」 sheetId 1783925145, A1:AD2107, 2,106키(채택 601 + 채택·선택질문유지 1,485 + 검토유지 20). 차종마스터·registry·artifact 변경 0.

### 3축 검토 결정(정본 신설)
- `data/product-vehicle-review-decisions.json` + `lib/domain/product-vehicle-review-decisions.ts`. 마스터키/별칭 44건을 사람 판정(CODE 9 · TRIPLE 23 · PARTIAL 7 · HOLD 5), 자동후보가 모두 같은 3축인 30건은 `[자동합의]` TRIPLE 로 추가 → 74건 검토완료.
- `scripts/plan-product-vehicle-review-decisions.mts`(읽기 전용) → guarded writer `apply-product-master-vehicle-coverage.mts` 로 CODE 9대 반영(45셀, CAS·재조회 9/9). writer 는 v2 보고서(`…_v2_supplier_direct_evidence`)의 SAFE_CANDIDATE 도 받게 해 감사기 승인대기 3대(109호2979·109호4100·52부9200)도 반영(15셀, 3/3).
- `audit-product-vehicle-resolution-backlog.mts` 가 결정을 읽어 `REVIEWED_*` 로 분류: 176 = 검토완료 74 + 미검토 102. `apply-product-vehicle-resolution-queue.mts` 라벨도 추가.

### 판매시트 발행 — 차량번호 정본이 이긴다
- `lib/domain/product-vehicle-normalization.ts`: 상품마스터 차종코드 → 규격채택 이름(없으면 artifact 이름) / 코드 없는 차는 3축 결정 → 차량번호별 제조사·모델·세부모델·파워트레인·세부트림.
- `publish-origin-tab.mts` 가 그 정본을 정제칸·스냅보다 먼저 쓴다(못 읽으면 기존 길로만 돌고 경고). old/new dump 비교: **돈 칸 diff 0**, 차명 칸 307 변경(파워트레인 120·세부트림 98·세부모델 83·모델 5·제조사 1), 이전에 있던 값이 빈 칸 0.
- `--apply` → 「상품리스트 08.18 09:31 · 397대」, 정본으로 올린 차 338/397.
- 제공시트 20곳 「AI 인계」 탭 재발행(이력 보존), `share-supplier-sheets --anyone` 은 20곳 모두 이미 공유돼 변경 0.

### 남긴 것
- 잔여 102대 3축 판정 · 마스터 보강 후보표 · 조회탭 갱신은 PLAN.md 「상품 차종 3축 검토 마무리」 Cursor 오더로.
- 상품시트↔ERP 연동(사장님 지시)은 PLAN.md 「상품시트 ↔ ERP 연동」 Cursor 오더로 — 실측: 상품마스터 live 칸(상태·돈)을 공급사 시트에서 다시 읽는 일일 갱신기가 없어 판매시트(공급사 직행)와 ERP(상품마스터 경유)가 갈린다. 오더 A 갱신기 · B 3방향 정합 감사기 · C ERP 표시 이름 통일(규격채택·3축 결정) · D 발행기 입력 전환은 사장님 결정.
- 아이카 규격화시트 3일째 동기화 안 됨(발행기 경고) — `sync-mirror-sheet` 별도.
- 커밋·푸시 안 함.

## 2026-08-18 — Cursor 오더 「상품 차종 3축 검토 마무리」 결과 검수 (Claude Code)

Cursor 산출(09:57~10:07, 로그 미기재라 여기 적음): `scripts/_dump-unreviewed-102.mts` · `_propose-unreviewed-102.mts` · `_append-unreviewed-102-decisions.mts` · `_build-vehicle-master-backfill-candidates.mts`(일회성, 밑줄 접두), `data/product-vehicle-review-decisions.json` +102, `lib/domain/product-vehicle-match-view.ts`·`publish-product-vehicle-match-view-v2.mts`(3축 결정 상태 반영).

### 오더 1 — 잔여 102대 판정: 완료(검수 후 정정 2)
- 추가 102 = CODE 55(현재 코드 유지 37 · 교체 12 · 신규 6) · PARTIAL 41 · HOLD 4 · TRIPLE 2. 코드 실재·automatic·3축=키 전건 검증 통과, 차량번호 중복 0.
- 교체 12는 근거가 맞다(E클래스 6세대·2024~25 등록 7대 W213→W214, 쏘렌토 HEV 노블레스, K9 베스트셀렉션Ⅰ, 카니발 9인승 HEV 시그니처, 카니발 3.5T 2023-12 → 더 뉴 KA4, 그랜저 IG 2.5 PREMIUM→프리미엄). 신규 6도 맞다(GV80 FL 2.5T AWD 5인승 기본형, The 2027 Morning 트렌디 2, 1시리즈 F40 120i Sport 2, 더 뉴 투싼 NX4 HEV 프리미엄).
- 정정: 215거1381·161하3805 GV80 「기본형/(세부등급 없음)」은 3축 범위에서 인승이 식별 축이 아니므로 PARTIAL→TRIPLE(세부트림 기본형, candidate_keys 5/6/7인승). K8 3.5 4WD 노블레스 2대(109호1870·231라7599)는 현재 코드(플래티넘)가 세부트림 오류라 `overrides_current_code`(신규 필드) — 정규화에서 결정 3축이 코드를 이긴다.
- 반영: `plan-product-vehicle-review-decisions` → guarded writer 18대(90셀, CAS·재조회 18/18). 오늘 누계 30대. 라이브 커버리지 확정 코드 정상 411→432, 백로그 155 = 전부 검토완료(REVIEWED_CODE 43 · TRIPLE 57 · PARTIAL 46 · HOLD 9), **미검토 0**.

### 오더 2 — 마스터 보강 후보표: 골격만
- `tmp/vehicle-master-backfill-candidates.json` 39건(ALIAS 15 · UNBLOCK 11 · ADD_ROW 11 · PERIOD_FIX 2 + 규격검토 오기 2). draft 의 연료·배기량·생산기간·공식근거 URL 은 전부 빈칸(`evidence_status=후보만`). 공식 근거 조사는 안 됐다 → 재오더 필요.

### 오더 3 — 조회탭 갱신: 완료(색 버그 1 고침)
- Cursor 가 `3축확정/트림미확정/원천확인` 상태·`[3축 결정(사람검토)]` 사유를 넣었으나 색을 0.05 같은 비8비트 값으로 적어 게시 post-read 가 `conditional_formats` 불일치로 실패 종료(값·규칙은 이미 들어간 상태, rollback 안 됨). 8비트 hex 로 고쳐 재계획·재게시 → `applied` receipt `tmp/product-vehicle-match-view-publish-receipt-f8a7a8b4da1a.json`(587행, 규칙 32). 9pt·22px 재적용.
- `sim-product-vehicle-match-regressions.mts` 가 특정 시점 수치(411/48·row188 승인대기·summary 411/176)를 못 박고 있어 코드 반영 뒤 깨졌다 → 합계·불변식 검사로 완화. `sim-product-vehicle-match-view` 11/11 PASS.

### 판매시트
- 결정 102건 반영 후 old/new dump: 돈 diff 0, 차명 37칸 갱신(세부모델 25·세부트림 8·파워트레인 3·모델 1). `--apply` → 「상품리스트 08.18 10:21 · 397대」, 정본 373/397(코드 478 + 결정 3축 57 + 부분 46 중 실린 것).

### 안 된 것
- PLAN.md 「상품시트 ↔ ERP 연동」 오더 A·B·C — 손대지 않음(`sync-product-master-live` · `audit-sales-sheet-vs-erp` · ERP 표시 통일 없음).
- 오더 2 공식근거 조사, `tsc` PASS.

## 2026-08-18 — 판매시트 「파워트레인」 열 제거 (사장님 확정, Claude Code)

- 왜: 차종은 모델·세부모델·세부트림 3축만 싣는다. 연료·배기량 열이 따로 있어 파워트레인은 겹친다.
- 정본: `lib/domain/sales-sheet-mapping.ts` 에서 줄을 빼고 `SALES_RETIRED_COLUMNS = ['파워트레인']` 신설.
  ⚠ 줄만 지우면 인계탭 발행기가 시트 @매핑의 그 줄을 «시트에만 있는 줄»로 보고 **맨 뒤에 되살린다** — 그래서 뺀 열 목록이 필요하다.
  `publish-handover-tab`(되살리지 않음) · `publish-origin-tab`(시트 @매핑에 남아 있어도 안 세움) · `publish-sonogong-tab`(열 제거) · `sales-sheet-format.LEFT_COLUMNS` 반영.
- 반영: 「AI 인계」 재발행(@매핑 63줄 + 시트 추가 3줄 유지, 파워트레인 줄 제거 확인) → 상품리스트 dump 전후 **열 67→66, 나머지 셀 diff 0** → 「상품리스트 08.18 10:49 · 397대」 · 「손오공구독 08.18 10:50 · 41대」(24→23열).
- 매뉴얼 0장·7장·8장 갱신, `check-manual-drift` 22/22.
- 남는 것: `audit-vehicle-spec` 의 연료↔파워트레인↔배기량 모순 검사는 판매시트에 파워트레인이 없어 빈 결과가 된다(제공시트 정제칸을 읽게 바꾸거나 폐기 — 후속).

## 2026-08-18 — 상품리스트 옵션 뒤 정책칸: 정책은 우리 제공시트에서 읽는다 (Claude Code)

- 사장님 「옵션 다음으로 각 가지고 와야 하는 것들 아직 안 가지고 온 거지?」 → 실측: 정책 43칸이 8곳(렌트존·SA·리더스·손오공·스타·우리캐피탈·오플·이안카)에서 비어 나갔다.
  원인은 발행기가 «문패가 가리키는 시트»의 「정책」 탭만 읽어서 — 그 8곳은 문패가 공급사 자체 시트/규격화시트라 「정책」이 없다. 우리 「○○ 프리패스 재고」 20곳 중 19곳(오플 제외)에는 정책이 적혀 있었다.
- `publish-origin-tab`: 드라이브에서 「프리패스 재고」 시트를 이름으로 찾아(`supplierNameKeys`, drive 스코프 files.list 만) 문패 시트에 정책이 없으면 우리 제공시트 정책 탭을 읽는다. 요약에 「정책 출처: 문패시트/우리 제공시트/없음」.
- dump 전후: 돈·차명 칸 diff 0, 있던 값 덮음 0, 정책칸 **3,490칸 채움**(이안카 2,050 · SA 450 · 우리캐피탈 285 · 스타 240 · 손오공 225 · 렌트존 150 · 리더스 90). `--apply` → 「상품리스트 08.18 11:21 · 397대」. 정책 못 읽은 공급사 0.
- 남는 빈칸은 ① 정책 탭 항목 자체가 빈 것(공급사별 66% 수준 = 38항목 중 25 채움) ② 정책코드 없는 차 55대(프리패스 기본으로 떨어짐, 빌린카 다수). 매뉴얼 1장에 기록.

## 2026-08-18 — 정책 탭 표기 규격 통일 · 작성 매뉴얼 (사장님 지시, Claude Code)

- 지시: 「규격 통일 좀 하고 매뉴얼 만들면 되잖아」 · 「어디는 70만 달랑이고」 · 「어떤 건 만21세 어떤 건 만71세 이상」 · 「추가운전자 … 추가운전이라고 하고 가능 여부만 · 요금은 1인까지 / 1인당 얼마로」.
- 실측(20곳 정책 탭): 같은 뜻이 서너 표기로 갈림 — 기본주행 「연 20,000km」×22·「연간 2만Km」×8, 연령인하 「만21세」×8, 최대연령 「70」×7, 연령 하향 요금 「100000」×7, 위약금 「0.3」×7, 초과주행 「200」×7, 승계수수료 「1,000,000」… 뿌리는 드롭다운 목록과 머리글 메모가 서로 다른 표기를 권한 것.
- 정본 신설 `lib/domain/policy-value-spec.ts`: 항목별 표기 규격·허용값(드롭다운)·동의어·정규화(`normalizePolicyValue`, 뜻이 하나일 때만 고침). 드롭다운(`POLICY_VALUE_LISTS`)·머리글 메모·매뉴얼이 여기서 나온다.
- 항목 이름 변경: 「추가운전자」→「추가운전」(가능/불가/협의) · 「추가운전자 요금」→「추가운전 요금」(「N인까지 · 1인당 월 M만원」). 옛 두 칸은 합쳐서 만든다(`composeDriverFee`). 판매시트 열도 같은 이름(옛 이름 SALES_RETIRED_COLUMNS). ERP 필드(additional_driver_*)는 그대로.
- `scripts/normalize-policy-values.mts --apply`: 20곳 머리글 40 · 값 333칸 정규화 · 검토 2(스타 탁송비 「무료 (제주 제외)」, J&J 추가주행 「10%」). 백업 tmp/policy-normalize-backup-*.json. 재실행 0칸(멱등).
- 매뉴얼: `lib/domain/policy-guide.ts` → `docs/SUPPLIER_POLICY_SHEET_MANUAL.md` + 20곳 「정책 작성법」 탭(`scripts/publish-policy-guide.mts --apply`, 148줄: 원칙 10 · 항목표 44 · 자주 틀리는 표기). 제공시트 「AI 인계」에 안내 한 줄.
- 판매시트: `supplier-policy-read` 운전자범위 묶기 정규식이 「본인+직계가족」을 «본인만»으로 잘못 묶던 것 수정. 재발행 「상품리스트 08.18 11:51 · 397대」 — 정책 파생칸 3,7xx칸이 규격 표기로 바뀜(돈·차명 diff 0). 매뉴얼 1장 갱신, check-manual-drift 22/22, tsc PASS.

## 2026-08-18 — 금액 표기 한글 단위로 · 판매시트 다운로드 차단 해제 (Claude Code)

- 사장님 「표기를 1억5천만원 이렇게 해야지 · 50만원 · 5천만원 · 100만원」 → `policy-value-spec.formatWon/parseWon` 을 한글 단위로(「1억5천만원」·「5천만원」·「1천5백만원」·「100만원」, 만원 아래만 「200원」·「1,000원」). 허용값·원칙·매뉴얼 동기 갱신. 20곳 정책 탭 13칸 추가 통일(자손보상 12·대물 1), 「정책 작성법」 탭·AI 인계 재발행, 판매시트 「상품리스트 08.18 12:07 · 397대」(자손·대물 표기 142칸).
- 긴급: 영업자 판매시트 다운로드 불가 → 드라이브 `copyRequiresWriterPermission=true`(뷰어 다운로드·인쇄·복사 중지)가 원인. `false` 로 해제(viewersCanCopyContent=true), 다른 downloadRestrictions 없음. 발행 스크립트는 이 플래그를 만지지 않는다.

## 2026-08-18 — 연료·배기량을 차종마스터 탭에서 (사장님 「차종마스터 탭 활용하면 되고」, Claude Code)

- `product-vehicle-normalization` 에 차종마스터 행의 `fuel`·`engine_cc` 를 실어, 코드가 있는 차는 판매시트 연료·배기량을 마스터 값으로 낸다(전기·수소는 배기량 빈칸, 마스터에 없으면 기존 길). 발행 「상품리스트 08.18 12:28 · 397대」 — 연료 57칸(휘발유→가솔린 29·HEV 1.6→하이브리드 13…)·배기량 162칸(빈칸 80 채움·쉼표/반올림 표기 통일).
- `audit-vehicle-spec` ②를 파워트레인 열 대신 «상품마스터 차종코드 → 차종마스터 행(연료·정확배기량)»과 견주게 다시 짰다. 실측: 마스터 행 있는 차 298/397, 코드 없는 차 98(견줄 기준 없음 → 3축 검토 큐), 연료 불일치 1(손오공 116하2305 — 공급사 열 「가솔린」 vs 코드 LPG, 이미 검토됨), 배기량 불일치 0.
- ⚠ 사장님이 차종마스터는 Gemini와 진행하기로 함(2026-08-18) — 이후 차종마스터 원장은 손대지 않는다. 판매시트 발행기·감사기는 「차종마스터」 탭을 **읽기만** 한다(트림행키·연료·정확배기량(cc)·세부모델·세부트림 머리글과 「차종마스터_규격채택」 탭에 의존).

## 2026-08-18 — 「공급사 시트 다 안 맞는다」 점검 (Claude Code)

- 양식(`audit-supplier-schema`): 20곳 중 재고탭 기준과 같은 곳 14, 다른 곳 7 — 빌린카·센트로(열 차례, 알려진 어긋남)·손오공(렌트/구독 탭·차종 열)·오플(18개월)·이안카·J&J(6개월↔기타기간①). 전부 8/14 이전부터 있던 공급사별 변형이지 오늘 생긴 것 아님.
- **실제 안 맞던 것 = 낡은 것**: 아이카 규격화시트가 3일째 동기화 안 됨(원본 153대 vs 우리 122대 → 새 차 44·사라진 차 13) · 판매시트 오플구독/오플프로모션 탭이 08.14 22:43 판. 원인은 **일일 자동화(`.github/workflows/sheet-sync.yml`)가 main 에 없어 한 번도 돈 적이 없음**(feat/sales-sheet-manual 에만 있고 GitHub 스케줄은 기본 브랜치에서만 돈다) → 전부 사람이 손으로 돌릴 때만 갱신됐다.
- 조치: `sync-mirror-sheet` 아이카 반영(새 줄 44·출고불가 13) → `fill-supplier-ai-columns --who=아이카` → 상품리스트 재발행 「08.18 13:27 · 441대」 → `publish-partner-tabs` 오플 두 탭 「08.18 13:28」. `audit-sheet-vs-sales`: 양쪽 있는 441대 중 돈 견준 430대 100% 일치·어긋난 칸 0.
- 「정책 작성법」 탭이 재고표 후보로 잡혀 「못 읽는 탭」으로 찍히던 것 → `OUR_NON_INVENTORY_TABS` 에 등록.
- ⚠ 남은 결정(사장님): 일일 자동화를 살리려면 feat/sales-sheet-manual 를 main 에 반영(또는 기본 브랜치 변경)하고 GitHub Secrets `GOOGLE_SA_JSON` 이 있는지 확인해야 한다. 그 전까지는 매일 사람이 ①mirror sync ②정제칸 ③상품리스트 ④손오공구독 ⑤오플 탭 을 돌려야 갱신된다.

## 2026-08-18 — 공급사 제공시트 통일(웰릭스 표준) · 최신화 · 권한 (사장님 지시, Claude Code)

- 「정책 작성법」 탭 20곳 삭제(사장님 「필요가 없지」). 매뉴얼은 리포 문서만(`publish-policy-guide` 는 `--tabs` 없이는 문서만).
- **열 차례 통일**(「웰릭스가 표준 · 차명 옵션 외부색상 내부색상 연식 주행거리 연료 배기량 대여료 구간」): `FRONT_COLUMNS` 재정렬 → `scripts/unify-supplier-columns.mts --apply` 20곳 재고탭 이동 110회(moveDimension, 값·서식·드롭다운 동반, 백업 tmp/unify-columns-backup-*). 오플 빈 「18개월」 삭제, 이안카·빌린카 「6개월」을 기타기간① 자리로, 손오공 렌트재고 중복 「차종」 열 삭제. `audit-supplier-schema` 20/20 같음(예비칸 N개월 제목은 규격 안).
- 기간 대여료·보증금 칸 배경을 판매시트 `COL_BG` 와 같은 색으로(`scripts/paint-supplier-period-columns.mts`, 163열).
- 최신화: 자체시트 공급사 → 우리 제공시트 mirror sync(스타 88칸·리더스 12·우리캐피탈 15·이안카 5+새 줄 15·렌트존 0·에스에이 0). 손오공(렌트/구독 탭)·오플은 미러 도구가 재고 탭명 기준이라 미실행. 판매시트 dump 대조: 돈 diff 0.
- 권한: teamjpk.com 도메인 편집을 우리 시트 23곳(제공시트 20 + 판매시트 + 원천대장 + 문패)에 추가. 공급사 시트 「누구나 보기」는 현재 「누구나 수정」이라 미변경(사장님 확인 대기 — 공급사가 링크로 편집 중).
- 매뉴얼 4장 열 차례·통일 기록 갱신, 판매시트 AI 인계 28열 문구 갱신. `check-manual-drift` 22/22 · tsc PASS.
- 미완: 공급사 시트 「작성 안내」 탭(사장님 「작성 매뉴얼 다 박아」) · 문패를 우리 시트로 넘기기(「이제 공급사만 만지는 거로」 — 공급사 통지 뒤) · 손오공/오플 미러 최신화.
- (추가) 손오공 「구독재고」를 표준 양식(앞 14칸 동일 + 인수형 6·반납형 6 + 뒤칸 + 정제칸)으로 재구성(45줄, 원본 백업 tmp/sonogong-sub-backup-*). 20곳에 「작성 안내」 탭(재고 칸 설명·정제칸·탭 규칙·정책 표기 원칙·항목표·권한) 발행 `publish-supplier-guide-tab.mts`.
- (추가) 손오공 「구독재고」 서식을 렌트재고와 같은 생성기로 재적용(`scripts/format-sonogong-subscription-tab.mts`: 표·칩·줄무늬·숫자서식·열너비·대여료 배경). 원인은 옛 병합 셀이 머리글을 먹은 것 + 서식 미적용.
- (추가) 우리캐피탈 「재고」 19대: 「1개월」 칸에 적혀 있던 조건 문장(공동임차인 등재 또는 소득증빙조건 : 보증금 N만원)을 **장기보증 셀 메모**로 옮기고 1개월 칸은 비움(사장님 「12개월탭에 쓴 거 메모로」 — 실제 위치는 1개월 열). ⚠ 문패가 아직 우리캐피탈 자체 시트라 mirror sync 를 다시 돌리면 1개월 문장이 되살아난다 — 문패 전환 뒤엔 문제 없음.
- (추가) 글꼴 Roboto 통일(사장님 2026-08-18): `sales-sheet-format.FONT_DEFAULT`·`lib/server/google-sheets.SHEET_FONT`·매뉴얼 발행기 2곳 Roboto 로. `scripts/apply-font-all-sheets.mts --apply` — 시트 24(판매시트·원천대장·문패·차량정제·제공시트 20)·탭 124 글꼴만 교체(크기·굵기·색 유지).
- (추가) 공급사 시트 20/20 최종 실측(재고 열 차례·정책 머리행·작성 안내 탭·글꼴 Roboto). 원천대장 첫 탭에 「시트 지도」(어떤 시트가 정본·매일 흐름·증상별 고치는 곳·권한·규격) 게시 + `docs/SHEET_MAP.md` (`scripts/publish-sheet-map-tab.mts`).

## 2026-08-18 (오후) — 정제시트 4곳(아이카·오토플러스·이안카·아이언) + 실시간 연동 준비
사장님 — 「오토플러스거 정제된 탭 하나 만들자 우리거 규격으로」 · 「아이카·오토플러스·아이언·이안카 정제시트 만들어서 실시간 연동시켜놓을게」 · 「상품마스터로 올 때는 어찌됐든 정제시트 통해서 상품마스터로 연동되는 거로」.
- 답(「외부시트도 우리거로 정제해서 갖고오는 거지?」): 아니었다 — 12곳은 우리 시트, 8곳은 문패가 자기 시트라 발행기·상품마스터가 원본을 직접 읽었고 아이언은 시트 자체가 없어 판매시트에서 빠져 있었다. 오늘 넷을 정제시트 경유로 바꿨다.
- `lib/domain/mirror-sheet-mapping.ts`(별칭 대응·차명 조합·상태/분류/연료/날짜 규격) · `mirror-iron-source.ts`(ironrentcar.com → 규격 줄) · `mirror-sources.ts`(연결표) · `supplier-row-policy.ts`(줄별 조건 → 정책, build-policies-from-sheets 해석기 공유).
- `sync-mirror-sheet.mts`: 열 이름 달라도 옮김(projectSourceRow) · `--source=iron` · 우리 비재고 탭 제외 · 버린 원본 열 표시. `sync-mirror-policies.mts`(정책 탭+정책코드) · `sync-mirror-all.mts`(일괄) · `rebuild-mirror-tab-layout.mts`(대여료 블록만 공급사 구조로).
- 오토플러스 정제시트 재고 탭 = 앞 14 + 장기보증·12/18/24/36개월×2만/3만 + 뒤 3 + 정제칸 12(98줄 값 보존, 표·칩·줄무늬·배경). 아이언 시트 신설(create-supplier-sheet --blank → 정제칸 붙임 → 정책 탭 가로 전환 → RP006_WEB 정책 → 미러 24대, 예비칸 72·84개월). 아이카·이안카 미러 재적용 + 정책 미러(RP004 3벌·RP031 2벌, ERP 코드 재사용) + 정제칸 채움.
- `readSupplierSheet`: 「프리패스 재고」 문서는 언제나 generic 어댑터(오플 어댑터의 6·7열 고정이 정제시트를 어긋나게 읽음). `NOT_SHEET_BACKED` 비움(아이언도 시트). `audit-ours-vs-hub` 비재고 탭 제외(작성 안내가 92대로 세이던 버그).
- 제공시트 코드 표준을 살아 있는 20곳과 다시 맞춤: SHORT/LONG_PERIODS 6기간(08-15 10기간 확장이 코드 32열 vs 시트 28열 드리프트, 「작성 안내」에 없는 칸이 실렸음) → 「작성 안내」 21곳 재게시.
- 문패 전환 RP023/RP031/RP006 → 정제시트(되돌릴 주소 tmp/hub-switch-log.txt). 발행 dry-run 474→475대(아이언 34 낡은 시트→24 실차, 이안카 82→92 우리 시트) → 「상품리스트 08.18 15:38 · 475대」 발행 · 돈 대조 0칸 어긋남. 공급사연동표·인계 탭·시트 지도 재게시. Roboto 25시트.
- 워크플로: `.github/workflows/mirror-sync.yml`(30분) 신설, `sheet-sync.yml` ①단계를 sync-mirror-all 로. **둘 다 main 에 있어야 돈다 — 미반영.** 이 PC 작업 스케줄러 등록은 권한 게이트에 막혀 안 함(사장님 판단).
- 남김: create-supplier-sheet --blank 가 옛 세로 정책 탭·정제칸 없이 만든다(가로 표준·정제칸 12 로 고칠 것) · ERP 아이언 홈페이지 직접 반영 UI(/api/inventory/ironrentcar)와 정제시트→상품마스터 길이 겹침(내리거나 검증 전용) · 오플 판매시트 탭(오플구독·오플프로모션 원본 통째 복사)을 정제시트 기반 한 탭으로 바꿀지 사장님 확인 · 아이카 원본이 낮 동안 계속 바뀜(숨김행 44→57→…) — 미러가 그대로 따른다.
- (추가 16:xx) 「정제시트 안내」 탭 4곳(publish-mirror-guide-tab — 칸별 정본·여기서/원본에서 고칠 것·공급사 특이사항·정책·권한), 그 4곳의 「작성 안내」 삭제 + publish-supplier-guide-tab 이 정제시트를 건너뜀. `OUR_NON_INVENTORY_TABS` 에 「정제시트 안내」. 원천대장 「공급사연동」 탭을 허브와 같은 표로 다시 찍음(publish-supplier-hub 가 두 곳에 씀, 정제시트는 「정제시트 ← …(30분 미러)」로 표시·해야 할 일에 원본 링크), 「공급사 데이터 매뉴얼」 4줄 정본·연동방식 칸에 정제시트 링크. 발견: 「상품마스터」 탭 머리행이 코드 규격과 달라 sync-product-master-live 즉사(→ PLAN 오더 E). 발행 dry-run 한 번 아이카 27대로 튄 뒤 3회 연속 166대(원인 미상, 필터·숨김행 없음 — 기록만).

- (추가 17:10) 사장님 「공급사 전체 시트 정제칸 모델·세부모델·파워트레인·세부트림에서 파워트레인 없애」 → `AI_TAIL_COLUMNS`·`AI_AXES` 에서 뺌, `scripts/drop-supplier-column.mts --name=파워트레인 --apply` 로 21곳 22탭 열 삭제(값 백업 tmp/drop-column-파워트레인-*.json). 발행기 «정제됨» 표식을 파워트레인→세부모델/모델로(check-manual-drift 갱신), fill-supplier-ai-columns 는 더 안 채우고 EV 배기량 판정은 연료(정제)로. 「작성 안내」·「정제시트 안내」·「AI 인계」 재게시. 발행 dry-run 변화 없음(389/475 · 정본 406).
- (추가) 정제시트 4곳에 「정제시트 안내」 탭(publish-mirror-guide-tab — 칸별 정본·여기서/원본에서 고칠 것·공급사 특이사항·정책 탭·주기), 그 4곳의 「작성 안내」는 삭제(직접 입력 시트만 유지, publish-supplier-guide-tab 이 정제시트를 건너뜀). `OUR_NON_INVENTORY_TABS` 에 「정제시트 안내」 추가.
- (추가 17:40) 사장님 「실시간 연동은 내가 걸어 둘게(제미나이+구글시트 기능) — 매뉴얼만 잘 만들어 놔, 탭에 숨겨서」 · 「연동 매뉴얼에 원본시트·정제시트」 · 「정제시트 따로 표기 — 제공/정제, 앞에 배포 날짜 0818」 · 「실제 원본·정제시트 구분 명확하게」.
  - 「정제시트 안내」 4곳을 **숨김 탭**·연동 매뉴얼로 확장: 원본시트(주소·읽는 탭·gid·머리행 번호)/정제시트/지금 연동 · **원본 열 글자→정제시트 열 대응표(실측, sourceColumnsFor)** · 값 규격화 규칙(상태 판정표·분류·연료·날짜) · 칸별 정본 · 여기서/원본에서 고칠 것 · 특이사항 · 정책 · **구글시트 수식(IMPORTRANGE)으로 걸 때 함정 6**(숨긴 줄 못 가름·정제칸 행 밀림→차량번호 키 별도 탭·규격화는 수식이 안 함·머리행 이름 유지·칩 경고/액세스 허용·코드 미러와 동시 금지) · 권한. 아이언은 홈페이지 필드 대응표.
  - 시트 이름 규격 `supplierSheetName(label,{kind,date})` = 「MMDD 공급사 프리패스 재고 [제공|정제]」, `supplierSheetLabel` 이 날짜·표식을 벗김(옛 이름 호환), `supplierSheetNameParts`. `rename-supplier-sheets.mts` 다시 씀 → 21곳 반영(제공 17 = createdTime 0810/0812, 정제 4 = 0818, 로그 tmp/rename-supplier-sheets-log.txt). 이름 파싱하던 9개 스크립트를 supplierSheetLabel 로 통일, create-supplier-sheet 는 라벨로 기존 시트를 찾는다(중복 생성 방지).
  - 허브·원천대장 「공급사연동」 표에 「원본(공급사가 적는 곳)」·「정제시트(우리 규격·문패)」 열 신설(제공시트는 「= 정제시트」로 표시), 「시트 지도」에 원본 vs 정제시트 규칙 줄.
  - 병행 세션이 정제칸 「파워트레인」을 21곳에서 뺐다(로그 17:10) — 정제시트도 39열(오플 37열)로 맞춰짐, 문서 대응 완료.

- (추가 17:30 · 이 세션) **사고 대응** — 16:51~16:58 병행 세션의 `reformat-supplier-stock-tabs --apply` 가 표(Table) deleteTable 로 21곳 22탭 재고 A~L(차량번호~연료) 값을 지웠다(구글 deleteTable 은 표 안 값까지 지움). 그 사이 16:53 발행이 60대 빠진 「415대」를 실었다(경진·경진카·빌린카·센트로·손오공 렌트 — 20% 가드 아래라 통과).
  - 발행기에 **공급사별 0대 가드**·**시트 통째 못 읽음 가드** 추가(직전 표의 공급사 칸을 세어 «있던 곳이 0»이면 발행 안 함, `--force-shrink` 로만 지나감).
  - 복구: 병행 세션이 버전기록 CSV 로 17곳 되살림(17:09~17:11), 나는 `restore-stock-rows-by-index.mts`(줄 번호로 맞추고 남은 칸으로 검증, 1판의 복제 줄 감지)로 확인·보완, 아이언은 revision export 불가라 사진링크(상세 URL)로 홈페이지 원본과 맞춰 23줄 재기입 + 사이트에서 사라진 1대(151호2305)는 판매시트 대조로 차번 복구·출고불가. 미러 4곳 재적용(정책코드 116+82줄 재기입). 발행 dry-run 389/475 복귀 → 「상품리스트 08.18 17:25 · 475대」 재발행 · 돈 대조 0칸.
  - 교훈: ①deleteTable 금지 — 표를 다시 씌우려면 값을 먼저 읽어 두고, 지운 뒤 다시 쓴다(또는 updateTable). ②같은 시트에 두 세션이 동시에 쓰지 않는다 — 발행 중 다른 쓰기가 끼면 «조용히 줄어든 표»가 나간다. ③발행 가드는 총량이 아니라 공급사 단위.
- (추가 18:30) **사고와 복구** — 사장님 「글꼴 좀 맞추자 / 칸·드롭다운 / 아이카 정제시트 규격 다르다·제조사 칩 없다 / 제공·정제 규격 같아야」 → `reformat-supplier-stock-tabs.mts`(표준 생성기 재적용)를 22탭에 돌림. **`deleteTable` 이 표 안 값을 지운다** → 22개 재고 탭 본문 전멸(17:52). 복구: `restore-stock-tabs-from-revision.mts` — 드라이브 revision export(CSV, HTML 오류 재시도)로 «차량번호가 있는 마지막 revision»(17:09~17:21 KST)에서 값 되살림(열 이름 대응, 빈 머리행 표준으로 메움, 빌린카 6개월·정제칸 머리 손보정) → 2차 병합 패스 → 정제시트 4곳은 `sync-mirror-all` 재적용 + 정제칸 채움 + 오플 기본값(분류 중고렌트·제조사←제조사(정제), mirror-sources.defaults) → 우리캐피탈 장기보증 메모 재생성. 검증: `audit-sheet-vs-sales` 어긋난 칸 0(15:38 발행본과 일치), 발행 483대. reformat 은 값 스냅샷→되쓰기→검수로 고침, format-sonogong 은 표 있으면 거부. 잃은 것: 17:21 이후 공급사 편집(손오공 익명 16:52 편집분 등 소량 가능), 셀 링크(차량번호 사진 링크)·메모 일부.
- 머리행 색 — 렌트사 칸 남색 / 프리패스·AI 칸(정제칸+정책코드) 보라(`buildHeaderOwnerColors`, `paint-supplier-header-owners.mts` 22탭). 사장님 「손오공은 원본, 자기 시트 없다 · 자기 시트는 4곳뿐, 나머지는 버전 차이」 → 허브 표기(옛 우리 시트(구버전)) 고치고 우리캐피탈 1회 동기 후 6곳(손오공·리더스·스타·렌트존·우리캐피탈·SA) 문패 → [제공] 시트 전환. 발행 「상품리스트 08.18 17:34 · 483대」 — 21곳 전부 우리 시트.
- (추가 18:40) 사장님 「너는 우리 제공 시트만 맡아」 → 정제시트 4곳은 사장님·제미나이 관리. 유지보수 도구 11개(글꼴·배경·머리색·서식·열 정리·정책 표기·정책 안내·열 삭제·정제칸 붙임/채움·작성 안내)가 기본으로 정제시트를 제외(`excludeMirrorSheets`, `--include-mirror`). 미러(sync-mirror-all)·30분 워크플로는 지시 없이 안 돌림.

- (추가 17:45 · 정제시트 담당 마무리 — 사장님 「너는 정제시트만 맡아」) 4곳 상태 실측: 아이카 166줄(차번 166·정책코드 116·출고협의 116/출고불가 50, 차명 없는 출고불가 27줄은 원본에서 사라진 옛 줄) · 오토플러스 100줄(37열 오플 대여료 블록·출고가능 88·기본값 분류=중고렌트/제조사=정제칸) · 이안카 92줄(정책코드 82·RP031_S01/S03) · 아이언 24줄(복구 때 붙은 복제 26행 삭제·151호2305 출고불가·RP006_WEB). `sync-mirror-all` 미리보기 4곳 0변경(멱등). 정제시트 3곳 링크 권한 anyone writer→reader(공급사가 여기 적을 일 없음, 아이언은 이미 reader). 「정제시트 안내」(숨김 연동 매뉴얼) 4곳 재게시.
- (추가 18:10 · 정제시트) 사장님 「빈 칸 다 보라고 · 아이카 분류 빠짐 · 제조사는 르노·KGM 매뉴얼에 박아 모든 시트 통일」 →
  - `lib/domain/maker-display.ts`(표기 규격 SSOT = 드롭다운 이름, 별칭표) → 미러 제조사·정제칸 채우기 제조사(정제)·발행기 제조사 모두 같은 함수. `unify-maker-names.mts --apply` 21곳 234칸(르노(삼성)/르노삼성/르노코리아→르노, KG모빌리티(쌍용)→KGM, 쉐보레(대우)→쉐보레 + 제조사(정제) 빈칸 166 채움). 판매시트 「AI 정제」 @제조사 치환값 2줄. 「작성 안내」·「정제시트 안내」·영업자시트 매뉴얼에 규격 문장.
  - 아이카 차명 없는 출고불가 27줄 = 원본 숨긴 줄 → 숨긴 줄 포함 원본에서 once 칸 200개 채움(분류·차명·색·연식·차량가격·최초등록). 미러 규칙 추가: 연식←최초등록일 연도(원본에 연식 없을 때) · 앞칸 제조사·배기량·연료 비면 정제칸 값 · 새 줄 입고일자=우리 시트에 처음 선 날 · 오플 분류=중고렌트/정책코드=(프리패스 기본) 기본값. 4곳 재적용(아이카 7+7·오플 74+90·아이언 23칸).
  - 남은 빈 칸은 원본이 안 주는 것(입고일자 옛 줄·주행거리 신차·오플 내부색상/차량가격/보증금·아이언 최초등록일)과 정제칸(차종코드·모델·세부트림 = 3축 검토 몫).
- (추가 19:10) 사장님 「[제공] 확실하게 통일 · 빈 곳 봐라 · 기존시트 확실하게 반영 · 제조사 르노/KGM 매뉴얼 · 정책코드를 차종코드 앞으로 + 앞에 구분선 · 정제시트도 규격 같아야(대여료만 다를 수 있음) · 매뉴얼은 내 담당」.
  - 구버전 흡수 `absorb-legacy-sheet.mts`(빈 칸만 채움·없는 차 추가·다른 값 목록, `--prefer-old-tabs`): 6곳 반영 — 손오공 렌트재고 15줄은 새 시트가 자리 밀린 값이라 옛 값으로 덮음(45칸), 구독재고는 새 시트 유지, 우리캐피탈 1개월 문장 재유입 19칸 되지움(메모로 있음). 옛 시트는 이제 안 읽는다.
  - 표준 변경: `TEMPLATE_COLUMNS` = … 최초등록일 | 사진링크 | **│(구분선, ours, 6px 보라)** | 정책코드 | 정제칸 11. `insert-divider-column.mts` 로 21곳 22탭 반영(insert+move, 값 보전). 규격 감사 21/21(연카 빈 시트 열 복구).
  - 빈 칸: `audit-stock-gaps.mts`(칸별 집계 + 파생 채움 144칸: 정제칸→앞칸·연식←등록연도·상태 빈칸→출고협의·분류 탭 단일값) + 정제칸 채움(제공 17, 473칸). 남는 빈 곳(사진링크 236·정책코드 153·차량가격 189·옵션 67·정제칸 못 알아본 차 …)은 렌트사/사람 몫 — 보고 tmp/stock-gaps-report.txt.
  - 제조사 표기: 병행 세션의 `maker-display`·`unify-maker-names` 를 그대로 씀(이미 21곳 통일, 포드 1건 규격 밖). 매뉴얼: `lib/domain/ai-touch-rules.ts` = AI가 적고 만지는 칸·규칙(구분선·정제칸·정책코드·제조사·상태·빈 칸 채움·표기·줄열·서식) — 「작성 안내」 17 + 「정제시트 안내」 4 에 같은 글로 실림.
  - 발행 「상품리스트 08.18 18:04 · 483대」 · 돈 대조 0.
- (추가 19:40) 사장님 「이제 차종마스터에 상품마스터 채울 수 있겠어?」 → 실측: 「상품마스터」 탭(1357902468)은 옛 상품 차종매칭 뷰였고 코드 규격 정본(587줄)은 「상품마스터_구버전」(679088240)에 있었다(이름이 뒤바뀜 → ERP 일일 동기·live 갱신 즉사 원인). 이름 되돌림(1357902468→「상품 차종매칭」, 679088240→「상품마스터」). `sync-product-master-live` 의 @제외를 «재고 아닌 탭 규칙만»으로 고침(오플 98·손오공 구독 45가 부재→출고불가 될 뻔) → 첫 --apply(--force-shrink: 스타 12대는 옛 시트 숨김=판매완료): 21곳 627대 → 상품마스터 650줄(중복 0), 새 63·상태 171·요금 94·부재 23. sim-product-master-import PASS · sim-sheet-daily-sync 40/40 PASS. 오더 E 는 이것으로 해소(Cursor 는 확인만).
- (추가 19:55) 사장님 「오플 구독 탭 없애고 상품리스트에 흡수, 손오공 구독은 별도 — 반납형은 상품리스트에, 손오공인수형구독 탭 별도」 → SALES_EXCLUDE 비움(RP023·RP012:구독 제거, AI 인계 @제외 줄 지움), @매핑 12개월←12개월3만·24/36개월←2만 별칭(코드+시트), 오플 탭 2장 삭제(remove-partner-tabs, publish-partner-tabs 폐기), publish-sonogong-tab = 「손오공인수형구독」 인수형만 24대(옛 손오공구독 탭 삭제), OUR_NON_INVENTORY_TABS 에 공지사항. 발행 「상품리스트 08.18 18:46 · 628대」(오플 100·손오공 60 포함) · 돈 대조 0 · 공급사시트에만/판매리스트에만 0.
- (추가 20:05) 사장님 「출고협의 주황 옆에 중고구독 주황 — 색깔 비슷하면 안 되지」 → 판매시트 GUBUN_INK 중고구독 보라(7B3FE4)·신차구독 청록(0F9D9D)(배차상태 파랑·주황·회색과 안 겹침), 공급사 시트 TYPE_TONE 신차렌트 마젠타·중고렌트 청록·중고구독 보라·신차구독 회색(상태 green/amber/blue/orange/red 와 안 겹침, `repaint-type-chip-colors` 22탭). 상품리스트 19:01·손오공인수형구독 19:01 재발행.
- (추가 20:35) 사장님 「출고불가 빼고 해줘야지」 → 판매시트(상품리스트·손오공인수형구독) 발행기가 출고불가 줄을 안 싣는다(공급사 시트·상품마스터엔 그대로). 「상품리스트 08.18 19:32 · 512대」(출고불가 116 제외, 스위치플랜 8대 전부 출고불가라 --force-shrink).
- 사장님 「차종마스터를 안 거치고 왔어?? 정제칸 모델·세부모델·세부트림 미리 정제해 놓고 갖다 쓰기로 — 375어8056 카니발 II 가 왜 나오냐」 → 실측: fill-supplier-ai-columns 가 글자 스냅만 써서(공급사 배기량 빈칸이라 세대 검산 꺼짐) 카니발→카니발 II KV-II 를 박고 코드는 비움. 상품마스터엔 KA4·프레스티지 확정 코드가 있었다. 고침: **상품마스터 확정 차종코드(차량번호 정본)를 먼저** 쓰고 뒤 칸은 코드에서(옛 값 바로잡음). 21곳 재적용 — 확정 코드로 정한 차 511대, 시트 코드와 달라 바로잡음 92(손오공 렌트재고는 옛 값 흡수로 공급사 칸이 바뀐 뒤 정제칸이 어긋나 있던 것도 포함).
- 「인수형 구독에 차량 링크가 왜 없어」 → 인수형 탭 발행기가 차량번호 칸 링크만 보고 「사진링크」 열을 안 봤다(복원 때 칸 링크가 사라짐). 사진링크 열도 보게 고쳐 23대 중 22대 링크(19:33).
- (추가 20:50) 사장님 「정제칸부터 정확하게 대조해서 채워」 → fill-supplier-ai-columns 를 발행기와 같은 **차량번호 정본**(상품마스터 코드→규격채택 이름 + 3축 결정 578대)으로 대조해 채우게 고침: 정본 있으면 차종코드·제조사(정제)·모델·세부모델·세부트림·연료·배기량 전부 정본으로(옛 값 바로잡음), 정본 없으면 스냅 확신 high+배기량 검산 통과일 때만 이름을 쓰고 아니면 비움. 21곳 적용: 정본으로 정한 차 648 · 코드 바로잡음 92 · high 스냅으로 바로잡음 441 · 확신 낮아 비움 1549(대부분 아이카 숨김 옛 탭). 팔 수 있는 차 513대 정제칸: 코드 424 · 코드 없이 이름만 77(high 스냅) · 빈 12(검토 큐). 손오공 375어8056 = 카니발 KA4·프레스티지 확인. 인수형 탭 19:48 재발행.
- (추가 21:15) 사장님 「정제칸 채워줘 — 한 번만 차종마스터 맞춰 두면 되잖아」 → `resolve-unmatched-vehicles.mts`: 정본(코드·결정) 없는 팔 수 있는 차 25대를 차종마스터와 대조(세대코드→세부모델·연료/배기량(±7%, 배기량 없으면 차명 리터 ±10%)·등록연도↔연식시작/종료·「더 뉴」 표기·트림 글자는 차명에서만) → 결정 파일에 CODE 2(테슬라 모델 3 롱레인지 → automatic 키 아니라 TRIPLE로 · 아르카나 아이코닉 상품마스터 코드 반영) · PARTIAL 22(세부모델까지, 트림 미정) · 못 정함 1(미니 쿠퍼 4세대 F66 마스터에 없음). 정제칸 재채움 → 팔 수 있는 513대 = 코드 427 · 이름 82 · 빈 4. 상품리스트 20:09 재발행(정본으로 올린 차 579/512 포함). 초기 버전 오류 2건(옵션 글자로 트림 매칭 → 「기본형·스마트」, 영어 단어 LONG 을 세대코드로 → 모델 3→모델 Y) 실측 후 고침.
- (추가 21:25) 사장님 「손오공 구독은 그대로네 — 상품리스트는 맞는데 손오공인수형구독에만 잘못 · 규칙을 상품리스트와 동일하게, 대여료만 다르게」 → `publish-sonogong-tab` 을 다시 씀: 제공시트를 따로 읽어 스냅하던 길(「스포티지 NQ5」→「New 스포티지 KM」 사고)을 버리고 **발행된 상품리스트 탭의 손오공 구독 줄을 그대로 가져와** 대여료 블록(단기보증·1개월·12개월·장기보증·24~60개월)만 인수형(보증금 인수형·36/48/60개월 인수형)으로 갈아 끼움. 사진 링크도 상품리스트 링크(+구독재고 사진링크). 「손오공인수형구독 08.18 20:18 · 23대」(사진 22).
- (추가 21:35) 사장님 「숫자 없는 곳은 「-」로 — 대여료 없음·운영 안 함, 불가도 필요 없다」 → 상품리스트·손오공인수형구독 발행기: 대여료 칸(단기보증·1개월·12개월·장기보증·24~60개월 / 인수형 블록)이 빈칸·불가·x 면 「-」(2,329칸). 머리글 메모에 「-」 뜻. 금액 빠진 차 셈은 숫자 유무로. 상품리스트 20:26 · 인수형 20:26 재발행, 돈 대조 0.
- (추가 21:45) 사장님 「매뉴얼 제대로 박아 — 차종마스터·상품마스터 매칭 → 정제시트에 박음 → 상품시트로, 이거지?」 → 맞다. `lib/domain/vehicle-refine-flow.ts`(5단계: 사전=차종마스터 · 차량번호 정본=상품마스터+결정 · 정제칸에 박음(정본이 이김/마스터 대조/빈칸) · 상품시트로(정본→정제칸→원문, 출고불가 제외, 「-」, 인수형 탭) · 새 차) — 원천대장 「시트 지도」 2-1, 「작성 안내」 17곳·「정제시트 안내」 4곳 2-2, docs/영업자시트-매뉴얼.md 에 같은 글. AI 규칙 표 첫 줄에 한 줄 요약.
- (추가 22:00) 사장님 「이제 잘못 박힌 차종마스터 없는 거지?」 → `audit-vehicle-refine.mts`(읽기 전용 전수 대조: 코드↔마스터 존재·정제칸↔코드값·상품마스터 코드·공급사 배기량/연료/등록연도/세대코드/제조사). 513대: 정제칸≠코드값 1 · 상품마스터 코드 불일치 0 · 마스터 탭에 없는 코드 15(차종마스터 탭에서 빠진 코드 — 원장 쪽) · 이름만·마스터에 없는 세부모델 9(보강 후보) · 근거 충돌 53(배기량 21·연도 24·제조사 4·세대코드 3·연료 1 — 공급사 칸 자체가 엉터리(등록 2000·카니발 2900cc)이거나 파워트레인 변형 의심). 오플 배기량/연료 칸은 원본에 없어 내가 정제칸에서 채운 것 → 정본으로 되맞춤(165). 목록은 원천대장 「정제칸 대조」 탭(78줄, 사람 판단 칸).
- (추가 22:20) 사장님 「매뉴얼 확실하게 — 어떤 AI가 와도 이렇게 작업되게, 각 시트에 다 박아」 → `lib/domain/ai-operating-manual.ts`(정본: 0 이 문서 · 1 시트 지도 · 2 정본 서열 · 3 차명 정제 흐름 · 4 AI 칸 규칙 · 5 매일 순서(명령) · 6 금지 · 7 고치는 곳 · 8 규격 · 9 오늘의 교훈) → `publish-ai-manual-tab.mts` 로 25곳(원천대장·문패·허브 보임 / 판매시트·공급사 21곳 숨김)에 「AI 운영 매뉴얼」 탭 + docs/AI_OPERATING_MANUAL.md. OUR_NON_INVENTORY_TABS 에 등록, 시트 지도 첫 줄에서 링크.
- (추가 22:35) 사장님 「어떻게 오더하면 공급사가 변경한 거에 일괄 반영·적용될까?」 → `scripts/run-daily.mts` — 한 방: 정제칸 채움 → 못 정한 차 결정(새 결정 있으면 다시 채움) → 상품리스트·인수형 발행 → 상품마스터 갱신 → 검수(돈·정제칸·빈 칸). 단계 실패 시 중단. 실측 --apply --force-shrink 472초 전 단계 ✓(돈 대조 0). AI 운영 매뉴얼 5장·시트 지도에 「★한 방 오더」로 실음(v2, 25곳 재게시). publish-origin-tab hasMoney 선언 순서 버그 고침.

- (추가 22:50) 사장님 「ERP 에서 상품시트를 당겨가면 되나, 상품마스터를 당겨가면 되나?」 → 상품마스터(ERP 입력 정본) · 「상품마스터를 당겨가서 상품시트와 ERP 랑 정확하게 일치해야 해 — 그렇게 구현해 줘」 → 실측: 같은 21곳을 발행기와 상품마스터 갱신기가 따로 읽어 갈렸다(아이카 1개월 15대 빈칸 · 렌트존/SA/아이카 장기보증 128대 빈칸 · 리더스 36개월 「-」인데 옛 560,000 유지 · 손오공 구독 보증금 글자↔계산값). `scripts/sync-product-master-from-sales.mts` — **발행된 상품리스트 값을 정본**으로 상품마스터의 차량상태·1·12·24·36·48·60개월 대여료·보증금을 덮는다(「-」→비움, 보증금은 숫자일 때만 덮음 — 손오공 「연수×대여료」 글자면 상품마스터 계산값 유지(ERP 규칙) · 6·18·72개월/변형/코드/차명은 안 건드림 · 상품리스트에 없는 차는 안 건드림) → 되읽기 0 어긋남, `--audit-only` 게이트(칸 어긋남·실번호 차 누락·상품마스터에만 팔 수 있는 차 → exit 1 / 번호미정은 경고만: 상품마스터·ERP 는 차량번호가 있어야 실림, 번호 나오면 자동 합류 — 지금 빌린카 「미정」 카니발 1대). 첫 --apply 106칸(34줄) → 되읽기 일치 · audit-only ✓ 일치. run-daily ⑤′ + ⑥ 게이트, sheet-sync.yml ③.5 + 게이트, AI 운영 매뉴얼 v3(25곳 재게시)·시트 지도. ERP 가 실제로 밤마다 당기려면 main 반영 + Vercel env(SHEET_DAILY_SYNC_ENABLED/CRON_SECRET) — 사장님 결정.
- (추가 23:00) ⑤′ 보강: ERP 는 «대여료·보증금 쌍»이 있어야 그 기간을 싣는다(product-master-import priceMap) → 판매시트 「무보증」은 상품마스터에 **0**으로 박음(리더스 34호9160·9182 12/24개월 4칸 — 비어 있어 ERP 가 빼던 것). 대여료만 있고 보증금 없는 기간 38칸(웰릭스 12개월 16 · 아이카 1개월 15 · 오플 12/24/36 6 · 스타 12개월 1)은 ERP 가 뺀다 — ⑤′가 경고로 세어 보여 준다(공급사가 단기보증/장기보증을 채워야 같아짐, 매뉴얼 7장에 고치는 법). run-daily 미리보기 전 구간 ✓(276초, ⑤′ 포함). AI 운영 매뉴얼 v3 25곳 재게시.
- (추가 23:30) 사장님 「공급사가 입력 안 한 건 어쩔 수 없고 이제 ERP 오픈할 거야」 → 오픈 전 내 범위(시트→ERP) 점검:
  - **ERP 일일 동기 dry-run(운영 RTDB, 상품 안 건드림)** — 첫 시도 **전체 실패**: 「상품마스터 438행 존재하지 않는 차종코드(mf-002.md-002.sm-yg::v02::t03)」. 162허2357(웰릭스 K7 프리미어 YG LPG 3.0 LPI 프레스티지) — 차종마스터 원장에서 t03(프레스티지) 행이 사라졌는데(artifact 08-15 도 없음, live 탭도 없음: t01 트렌디·t02 스탠다드·t05 노블레스만) 상품마스터엔 확정 코드가 남아 있어 fail-closed 로 649대가 같이 죽었다. → 438행 차종코드·적용값 비움 + 검증상태 「검수필요」 + 검수사유(원장 t03 복구되면 coverage apply 로 다시). 재시도 ✓ dry_run: 650줄 → 20곳 planned, 새로 20 · 갱신 623 · 그대로 7 · 가격 없음 48(출고불가·스위치플랜) · 확정 478 · 검수 172 · 부재 차단 0. 연카는 0대라 목록에 없음.
  - `check:release` PASS(차단 0 · 경고 2) · tsc 0 · sim-product-master-import/-sheet/-sheet-daily-sync 40/40/-sheet-merge 171/171/-applied-name-sync PASS · `rules:status` 게시 안 된 변경 2(users/$uid/user_code·status .validate) · 백업 매일 19:30 자동(최근 08-17 31.4MB).
  - ⚠ `check:vehicle-trim-master`(artifact 재생성) **차단** — 차종마스터 원장 REGISTERED_SEMANTIC_DRIFT 18키(mf-001.md-004.sm-gn11__the-new-grandeur v01~v05: 같은 코드의 의미가 바뀜). ERP 는 코드에 실린 08-15 artifact 를 쓰므로 오픈은 안 막히지만, 원장 변경이 ERP 에 못 간다(원장 = Gemini 몫).
  - 배포 실측: 운영 = Vercel CLI 배포(08-15 20:51, dudguq, git 소스 없음 = 그때 작업트리 969497e) — main(fcda386)이 아니다. 상품마스터→ERP 경로 파일(lib/domain/product-master-*.ts · lib/server/product-master-sheet.ts · decisions·artifact)은 **아직 커밋된 적 없음**(untracked). 오픈 시 CLI 재배포 + env `SHEET_DAILY_SYNC_ENABLED=true`·`CRON_SECRET` 필요. 첫 화면은 「점검 중」 안내(app/page.tsx, 파인더는 /finder).
- (추가 23:55) 사장님 「ui 샘플(Gemini DriveDirect PRO) 반영해 볼 수 있나 → 다크는 참고용 → 적당히 만들어봐, 화면만 좀 보게」 + 「ERP 점검 중이라고 되어 있는데 이제 점검 끝났음 보여주면 돼」 → **1차(라이트·우리 토큰, 정보구조만)** 로컬 구현·캡처(PLAN.md 오더 H 설계표):
  - 첫 화면 `app/page.tsx`: 「점검이 끝났습니다 · 정상 운영 중」 + 1순위 「ERP 들어가기」(/finder → 비로그인 /login) · 상품시트는 2순위 링크 · `HomeMemberRedirect`(세션 있으면 바로 /finder) · '/' 를 public 경로에 추가(손님·로그아웃은 안내면) · 워드마크/배지 토큰화(BRAND_TYPO·PILL_R — check:ui/tokens 0).
  - 상품찾기 `FinderLineupBar`(툴바 아래 · 웹/모바일): 전체·신차렌트·중고렌트·중고구독·신차구독·**인수형(만기 인수)** 칩+대수. 상품구분(ptype) 축 재사용 — `ACQUISITION_PTYPE` 가상값(product-filters: 집계·predicate) → 사이드·저장·프리셋·배지 공짜. CSS `.fp-lineup-bar`, `.fp-finder-main` grid rows 4.
  - 인수형 노출: `acquisitionPriceList/hasAcquisitionPlan`(product.ts) + `ProductPriceTable` 「인수형 · 만기 인수」 표(/m·/q 공용). **`priceList` 에서 `_인수형` 키 제외** — 예전엔 「그 밖」 순위로 남아 반납형 없는 기간(60개월 등)에 인수형 대여료가 표준가처럼 찍혔다. sim-sheet-price 34/34 · sales-inventory · product-master-import/sheet · sheet-merge 171/171 PASS.
  - /m 「손님 화면」(웹) `CustomerPreviewModal`: /q?a=귀속 을 폰 프레임 iframe + 링크 복사(body 포털 — 독 안에선 fixed 가 갇힘).
  - 로컬 seed 에 인수형 표본 veh_1007(SEED_VERSION v7). QA: 로컬 모드 dev(4104, NEXT_PUBLIC_DATA_BACKEND=local·Firebase env 비움) + Playwright(설치 Chrome) 캡처 → 아티팩트 「ERP 1차 화면 반영」. ⚠ dev 서버 둘이 `.next-dev` 를 공유하면 청크 404/500 — 두 번째는 `NEXT_DIST_DIR=` 로 분리할 것(4004 재기동함).
  - 안 한 것(2차·결정): AG 마진(손님가에 얹기)·카톡 알림톡·제안 내역·대시보드. tsc 0 · check:ui/tokens/fonts 0.
- (추가 00:15 · 08-19) 사장님 「그냥 원래대로 로그인 화면 나오게 하고 개통하자 · 상품마스터랑 상품시트랑 동일하게 연동해 주고」 → `app/page.tsx` = `redirect('/login')`(로그인은 세션 있으면 /finder 로 넘김), 안내면·HomeMemberRedirect·'/' public 제거. `next build` 로컬 성공(exit 0). **운영 배포(`vercel --prod`)·운영 시크릿 등록(`vercel env add`)은 권한 게이트가 막음** → tmp/OPEN_RUNBOOK.md(사람이 치는 3줄 + 확인 2줄), CRON_SECRET 값 tmp/cron-secret.txt. 상품마스터↔상품시트 일치는 ⑤′(sync-product-master-from-sales)로 이미 0 어긋남 · ERP 반영은 배포 후 sync-daily(dry-run→실행)로.
- (추가 01:00 · 08-19) **개통.** 사장님 「너한테 권한 줄게」 → `vercel --prod --yes --archive=tgz`(15,037 파일이라 archive 필수) 3회: ① 로그인 첫 화면·1차 UI(00:20) → ② 이안카 twin-key 고침 → ③ 라인업 한 줄+세부필터 토글·구글시트 링크 고침(00:50). `freepasserp.com/` → 307 /login ✓. Vercel env `SHEET_DAILY_SYNC_ENABLED=true`·`CRON_SECRET`(tmp/cron-secret.txt) 등록 → redeploy → **ERP 일일 동기 첫 실행**: dry-run ok(650줄·20곳) → 실행 1차 19곳 완료·이안카 실패(「동기화 중 재고 변경(1건)」) → 원인 = 이안카 30대가 **쌍둥이 레코드**(라이브 `EXT_…` child + 08-11 soft-delete 톰스톤 `RP031_…` child, 같은 product_code) 인데 `planProductUpsert` 가 patch 를 논리키로 박아 transaction 이 톰스톤을 봄(RP031_133호5531 status_label_raw 재고확인≠출고협의) → `sheet-merge.ts` patch key = `prev._rtdb_key || key`(revive 와 같은 규칙) → 재배포 → 재실행 **20/20 completed**(이안카 신규 13·갱신 79 · 전체 unchanged 558). 이후 매일 02:00 KST 크론.
  - 「구글시트 열기」가 옛 내보내기 시트(1G0tPyFI…)를 열던 것 → `lib/product-sheet.ts` 판매시트 1Y1Mx1Ec… 상품리스트 탭(gid 668539469)으로.
  - 사장님 「라인업 필터 필요 없고 · 세부 필터 버튼 없애고 · 모델~심사조건 퀵필터 드롭다운이 기본 · 초기화 버튼 · 필터 잡힘 표시」 → **화면 수정은 Cursor**(사장님 지시) — PLAN.md 오더 I 로 넘김. 내 UI 1차(라인업 줄·세부필터 토글)는 배포된 상태로 두고 Cursor 가 걷는다.
  - 남은 것: 340+ 파일 미커밋(배포는 작업트리) — 커밋 지시 대기 · rules:status 게시 안 된 변경 2건 · 차종마스터 원장 semantic drift(artifact 재생성 차단) · 번호미정 1대·보증금 없는 38칸(공급사 몫).

## 2026-08-19 (오전) — 상품시트 동기화(일일 반영 + ERP 동기) 1회 수동 실행 (사장님 「프리패스erp 상품시트 동기화 할거야」, Claude Code)
- `run-daily` 미리보기(252초) 전 구간 ✓ → `--apply`(462초) 전 구간 ✓: ② 정제칸 채울 칸 11 · ③ 못 정한 차 1(미니 쿠퍼 F66, 마스터에 없음 — 그대로) · ④ 「상품리스트 08.19 08:56 · 512대」·「손오공인수형구독 08.19 08:56 · 23대」(발행 가드 안 걸림) · ⑤ 상품마스터 실변경 = 리더스 34호9160·34호9182 12개월 580,000→560,000 · 24개월 560,000→540,000(공급사 시트 값) · ⑤′ 어긋남 0 · ⑥ 돈 대조 0 · ERP 일치 게이트 ✓. 정제칸 대조 76대·빈 칸 목록은 08-18 과 같음(공급사/원장 몫).
- ⑤ 진단: 렌트존(PT-0001)·스위치플랜(RP014)은 `sync-product-master-live` 「매뉴얼 자동반영 금지 — 진단만」 규칙으로 차단(15대), 스타는 shrink 가드(16/28) — 둘 다 ⑤′가 상품리스트 값으로 상태·대여료·보증금을 맞추므로 ERP 값은 같다.
- ERP 일일 동기(운영): 이전 마지막 실행은 08-19 07:46 KST completed(개통 때, 02:00 크론은 배포 전이라 안 돎). 이번 수동 `sync-daily?dry_run=1` → 650줄 갱신 2·그대로 648 → 실행 `run_5tdh37duxp` **20/20 completed**(갱신 2 = 리더스). 다음은 매일 02:00 KST 크론.
- 로그: tmp/run-daily-preview-0819.log · tmp/run-daily-apply-0819.log · tmp/erp-sync-{dry,run}-0819.json · RTDB 상태 읽기 tmp/read-sync-status.mts.
- (추가 09:40) 사장님 「지금 각 공급사시트는 사람들이 수정하고 있나??」 → 드라이브 revision 실측(tmp/who-edits-supplier-sheets.mts · who-edits-2 · who-edits-legacy): [제공] 17곳 중 사람 손 = 리더스(익명 5회, 08-19 08:43 = 오늘 대여료 변경) · 손오공(익명 5회) · 웰릭스(08-18) · 스타(08-14) · 에스에이(08-13), **나머지 12곳은 만든 뒤 사람 수정 0**. 링크 권한 [제공] anyone:writer(익명 편집) · [정제] reader. **옛 우리 시트 15곳(tbag4783 소유)엔 문패 전환 직전까지 공급사가 적고 있었다**(손오공 08-18 17:15 jangjh1798 · 우리캐피탈 17:11 charles1229 · 렌트존 15:31 uej0415, 전환 17:31 뒤 0) → 옛 시트로 돌아갈 위험 실재.
- (추가 09:45~) 사장님 「현재 쓰고 있는 시트를 알아볼 수 있게 표기 · 연동중 이런식으로 · 구버전 우리 거는 폐기/구버전이라고 안 쓴다고 · 외부시트는 원본만 알면 되고 · 시트마다 구성/바라보는 곳/주는 곳 매뉴얼화」 → 한 번에 설계·반영:
  - 이름 규칙 SSOT(`supplierSheetName`)에 상태 표식 `[연동중]` 추가(`supplierSheetLabel`·`supplierSheetNameParts` 가 벗김) → `rename-supplier-sheets --apply` 21곳 「MMDD 공급사 프리패스 재고 [제공|정제] [연동중]」. 옛 이름 파싱하던 스크립트 5개(prefill/share/switch/handover/report-policy-todo)는 `supplierSheetLabel` 로 통일.
  - 옛 우리 시트 명부 `lib/domain/legacy-sheets.ts`(옛 제공시트 15 + 옛 문패 1rjRptCm + 옛 판매시트 1G0tPyFI(현 판매시트와 이름 같았음) + 옛 공급사 상품리스트 1BcHvwidH = 18 · 외부 옛 원본 아이카 1AVW 는 이름 안 건드림) → `retire-legacy-sheets --apply`: 이름 앞 「[구버전·폐기] 」 + 첫 탭 「⚠ 구버전 — 안 씀」(빨간 탭, 지금 쓰는 시트 링크·왜·문의 + 이 시트는). 15곳 반영, **3곳은 pyh 편집권한 없음(센트로 옛·렌트존 옛·프리패스 공급사 상품리스트) → 사장님이 권한 주거나 직접**. 되돌리기 `--restore`, 로그 tmp/retire-legacy-sheets-log.txt. 「프리패스 재고」 글자는 옛 이름에 안 넣는다(검색 도구에 잡힘).
  - 시트별 매뉴얼 정본 `lib/domain/sheet-identity.ts`(상태·이 시트는·소유/편집·구성(탭·열 실측)·바라보는 곳·주는 곳·주기·틀리면·하지 말 것·옛 시트·더 보기; 종류별 글: 제공/정제/문패/허브/판매시트/원천대장/외부 원본/구버전) → `publish-sheet-identity-tab --apply` 25곳 「이 시트는」 탭(공급사 21 보임 맨 뒤 · 문패·허브·원천대장 보임 · 판매시트 숨김). `OUR_NON_INVENTORY_TABS` 에 「이 시트는」·「⚠ 구버전 — 안 씀」 등록. 발행 dry-run 512대 그대로 · 양식 감사 20/22(오플·손오공 구독 예외 그대로) · check-manual-drift 22/0.
  - 원천대장 「시트 지도」 맨 위 「0. 시트 명부」 47줄(정본 4 · 연동중 21 · 외부 원본 4 · 구버전 18: 상태 · 시트/종류/코드/소유 · 입력→출력 · 링크/비고) + docs/SHEET_MAP.md · AI 운영 매뉴얼 v4(§1 상태 표기 줄 · §5 「당분간 ERP 연동은 AI 가 맡는다」 · §9 교훈 「옛 시트에 표기가 없으면 공급사는 옛 시트로 돌아간다」) 25곳 재게시 · 허브 정리표 재발행.
- 사장님 「당분간 ERP 연동하는 것도 AI 가 알아서 연동해 주는 걸로」 → 자동화(sheet-sync.yml main 반영·작업 스케줄러·수식 연동)를 켜기 전까지 오더 「상품시트 동기화/일일 반영」 = AI 가 run-daily(미리보기→--apply) + ERP sync-daily(dry_run→실행) + 결과 보고를 한 번에. ERP 02:00 크론은 별도로 돈다. (매뉴얼 §5·메모리에 박음.)

## 2026-08-19 — 계약서관리(전자계약) 화면 재편 · 사장님 «4칸» 배치

- 원인 실측 10건(정본 `docs/ESIGN_SEND_CENTER_REDESIGN_2026-08-19.md` §1) → 단계 SSOT 5개·플래그 분리·용어 통일·4칸(목록 | 계약 진행 2·3 | 계약서·링크 4)
- `lib/domain/esign-center.ts` — `EsignCenterStage`·`esignCenterStage`·`esignCenterFlags`(완료엔 플래그 없음)·`EsignCenterQueueFilter`, 옛 버킷 제거
- `components/FreepassEsignPanes.tsx` — `useFreepassEsign`(상태 1회+폴링) · `FreepassEsignStagePane`(스테퍼·발송 전 확인·단계 카드·요약·이력) · `FreepassEsignDocumentPane`(A4·링크·PDF) · 「고객 진행」=실제 여정(`session.progress`+`snapshot.consentPages`)
- `components/EsignSendCenter.tsx` — 초안 카드 1~4 가로폭 전체·세로, 필터 칩 6, BLOCK 이면 「계약서 만들기」 비활성, 정책 화면 다녀오기 초안 세션 저장(`ESIGN_POLICY_DRAFT_SESSION_KEY` — 예전엔 아무도 안 썼음)
- 미리보기 오염 방지 — `esign/preview` iframe `?preview=1` → 서명 페이지 `?peek=1` GET(서버 무쓰기, 진행 POST 가 openedAt 보충) · 뒤로가기 `back` 파라미터
- 삭제 `components/ContractSendWorkspace.tsx` · `check-ui-contract` /contract 단언 HEAD 원복 · sim 갱신(`sim-freepass-esign`·`sim-esign-document-boundary`)
- 앞서: 화면 쪽 `validateEsignCenterContract` `product` 미전달 → 차량 고르면 상시 BLOCK 버그 수정 · TopBar SIMPLE_GROUPS 2그룹(구분선)
- 검증: tsc 0 · `sim-freepass-esign` ✓ · esign sim 전부 ✓ · `check:tokens` ✓ · 로컬 4004 캡처(1440·390)
- (추가 10:30) 사장님 「차종마스터 공급사연동 탭 손봤어 — 우리가 제공하고 그걸 원본으로 쓰는 사람들은 그게 수정하는 곳, 정제시트가 곧 그들한테는 원본시트라 복사해 놨고 · 손오공 줄을 아이언 밑으로」 → 실측: 허브 쪽 같은 칸은 **#ERROR!**(코드가 「= 정제시트(…)」 글자를 USER_ENTERED 로 써 수식으로 읽힘) → 사장님이 원천대장에서 [제공] 17줄 「원본」 칸을 제공시트 링크로 손수 고침(그 밖 편집 없음, 허브와 셀 대조). `publish-supplier-hub`: [제공] 원본 칸 = 제공시트 링크(「제공시트 열기」) · 정렬 = 정제시트 묶음 먼저 → 제공시트(각각 ERP 재고순) · 콘솔 열 인덱스 버그. 재발행 → 원천대장·허브 두 표 다른 칸 0.
- (추가 10:45) 사장님 「시트는 512대고 ERP 는 482대인데 왜 안 맞지??? 시트랑 맞아야 하는데」 → `audit-sales-vs-erp`(신규, 판매시트 차량번호 ↔ ERP isListableProduct): ERP 목록 477 · 시트에만 36 = **ERP 만 출고불가 30**(손오공 27·오플 2·아이카 1; status_label_raw 는 출고가능인데 vehicle_status 출고불가) + 유효가격 0 5 + 번호미정 1. 원인 = `sheet-merge.isManualSheetHold`: 표식(sheet_status_owner) 없는 출고불가를 «운영자 수기 보류»로 보고 시트 재등장에도 안 되살림(sync-all 은 해제 후보를 hard-block 사유로) — 옛 경로 잔재가 영구 고착. **고침**: 상품마스터 유입(`_product_master_identity_authoritative` 키 있음)은 표식 없는 출고불가를 덮는다(엔진 락 locked_by_contract/계약중은 예외; 보류는 상품마스터 관리상태 「중지」) + sync-all 의 manualReactivations/manualHoldsPreserved 는 product_master 경로 제외. sim-sheet-merge 173/173(신규 2) · sim-sheet-daily-sync 40/40. **배포는 보류**(작업트리에 다른 창 esign 작업 중 tsc 오류) → 즉시 복구는 배포된 코드의 1회 허용 플래그 `allow_sheet_reactivate=true` 28대(tmp/allow-reactivate-from-master.mts, 계약중 2대는 정상 제외) → sync-daily dry 28 → 실행 `run_bj8x6qpbu6` 20/20 갱신 28 → 플래그 잔존 0 · **ERP 목록 504**. 남는 512−504: 대여료 없음 3(손오공 161허1170·68로3345·281노9792 「-」) · 대여료 있는데 보증금 없음 2(아이카 57호9876 1개월 · 오플 48나1876) · 원본 수식 깨짐 1(이안카 133호5338 「No data matching criteria」) · 시트 계약중→ERP 출고불가 투영 2(손오공 308너3464·159무8252, 정상) · 번호미정 1 / ERP 에만 1(SA 109호4374 ERP 계약락). AI 운영 매뉴얼 v5(§5 ⑦ · §7 · §9) 25곳 재게시.
- (추가 11:20) 사장님 「복구하자 시트 원래대로 — 판매시트 탭 3개로 회귀: 상품리스트 · 손오공구독(반납형이랑 인수형 붙여서 한 탭) · 오플구독(정제된 거로)」 → 「우리 공통 기간별 대여료는 없애도 되고, 손오공이랑 오플은 그들의 기간별 대여료 · 손오공 반납형은 보증금(연수×대여료)이랑 기간별 대여료만 · 오플은 12개월 3만Km 이렇게」:
  - `publish-origin-tab` 에 `--only=코드[:탭] --tab=… --at=N`(갈래 탭 발행, @제외 무시) → 같은 발행기·같은 정본 차명으로 「손오공구독」(RP012 구독재고 43대)·「오플구독」(RP023 정제시트 88대). `SALES_EXCLUDE` 에 RP023·RP012:구독 복원 + AI 인계 @제외 → 「상품리스트 08.19 10:32 · 381대」(--force-shrink, 26%↓ 예상). 512 = 381+43+88.
  - `publish-sonogong-tab` 다시 씀: 갈래 탭에서 **공통 대여료 블록(단기보증·1개월·12개월·장기보증·24~60) 8칸을 걷어 내고 그 자리에 공급사 기간별 대여료** — 손오공: 보증금 반납형(「연수×대여료」)·12~60개월 반납형·보증금 인수형·36/48/60개월 인수형(10칸) · 오플: 12개월 2만km·12개월 3만km·18…36개월 3만km(8칸, 「12개월3만」→표시 「12개월 3만km」, 장기보증은 100대 전부 빈칸이라 안 둠). `--keep-standard` 옵션. 옛 「손오공인수형구독」 탭 삭제. 탭 순서 상품리스트·손오공구독·오플구독(숨김 뒤로).
  - 정본 `lib/domain/sales-published-tabs.ts`: 발행 탭 3접두·NATIVE_MONEY_BLOCK(기본값)·nativeMoneyLabel·SALES_TAB_MONEY_ALIASES(표준 칸 별칭: 12개월←12개월 반납형 / 12개월 3만km …)·standardMoneyIndex. ⑤′ `sync-product-master-from-sales`·`audit-sheet-vs-sales`·`audit-sales-vs-erp` 가 세 탭 합을 읽고 별칭으로 표준 칸을 되찾는다 → ⑤′ 512대 어긋남 0 ✓ · 돈 대조 0 · ERP 대조 504(남는 8 = 전과 같음).
  - run-daily ④ = origin(main) → origin --only=RP012:구독 → sonogong → origin --only=RP023 → sonogong --tab=오플구독. AI 운영 매뉴얼 v7·시트 지도·「이 시트는」(판매시트)·허브·영업자시트 매뉴얼 갱신.
- (추가 11:30) 사장님 「ㅇㅋ 이제 이게 기본 세팅이야」 → 매뉴얼 §1·메모리에 «기본 세팅» 박음. 이어 「규격 통일 — 대여료·보증금·금액은 우측 정렬·두껍게·기간별 · 오플엔 보증금 칸이 없는데 그 칸에 대여료 산출방식을 코멘트로 · 상품리스트와 손오공/오플 탭 색 약간 다르게」:
  - `sales-sheet-format.ts`: 금액 판정을 이름 목록 → 머리글 모양(`isRentColumn` /^N개월/ · `isDepositColumn` /보증/ − 카드·결제·여부·가능·보험 · `isMoneyColumn` +가격/금액)으로. 금액 = 우측+굵게(보증금도 굵게 — 08-14 「보증금은 안 굵게」 규칙을 사장님 지시로 바꿈), 기간 배경 `colBgFor`(개월 수·인수형으로 색, 18개월 등 새 칸도), 탭 색 `SALES_TAB_COLORS`(상품리스트 4A86E8·손오공구독 8E7CC3·오플구독 6AA84F), `FormatInput.tabTitle/extraNotes`. 첫 판에 「보증금 카드결제」가 금액으로 잡혀 우측·굵게·배경이 들어감 → 예외 넣고 재발행.
  - 오플구독 「보증금」 칸: NATIVE_MONEY_BLOCK.lead(값 = `autoplusDepositRuleText` 국산「월 대여료×2」/수입「12개월 ×3 · 18개월↑ ×6」, 계산값 아님) + SALES_NOTES.보증금(오플 공지사항 보증금표 — 국산 ×2·수입 12개월 ×3/18개월↑ ×6, 카드결제 불가; 오플 공지사항 「2) 보증금액」은 이미지라 글자 없음, 규칙은 코드 `autoplusDeposit` 와 같음). 갈래 탭 원본 요금 칸 머리글 메모(반납형/인수형/2만·3만) 추가.
  - 세 탭 재발행(상품리스트 11:24 · 손오공구독/오플구독 11:19 재서식). 검증: 금액 칸 RIGHT/bold/기간 배경 ✓ · 탭 색 ✓ · ⑤′ 어긋남 0.
- (추가 11:35) 사장님 제보 「125호1238 리더스 K8 3.5 LPG — 실차 트렌디 등급, 시트엔 프레스티지」 → 추적: 리더스 제공시트 차명(트림) 「K8 GL3 LPG 3.5 2WD 프레스티지」(옛 원문은 「K8 GL3 21-」 트림 없음 → 첫 트림 t01 이 붙음) · 상품마스터 코드 v01::t01(프레스티지) 확정 · 정제칸·상품리스트 프레스티지. 차종마스터 K8 GL3 v01(LPG 3470) = t01 프레스티지·t02 노블레스·t03 트렌디·t04 스탠다드 → 결정 파일 CODE(v01::t03, basis 제보) → plan → apply-product-master-vehicle-coverage --apply(5칸, verified) → fill-supplier-ai-columns(리더스: 코드·세부트림 바로잡음 1) → 재발행 상품리스트 「K8 / K8 GL3 / 트렌디」 ✓. 공급사 칸 차명(트림) 글자는 리더스가 고쳐야(기계가 안 덮음). 매뉴얼 §7 「★제보가 왔다 — 처리 순서」 추가(v8, 25곳).
- (추가 11:40) 사장님 「오플 구독 대여료 왜 저기로 갔냐 — 주행거리 뒤로 가야지」 → publish-sonogong-tab 재실행 때 공통 블록이 이미 없어 끼울 자리를 잃고 맨 뒤(23세 뒤)에 붙던 멱등 버그 → 자리 규칙 = **Km 바로 뒤 고정**(없으면 걷어 낸 칸 자리 → 맨 뒤). 두 탭 재발행 ✓.
- (추가 11:45) 사장님 「상품시트에 주행거리 앞에 차종구분 하나 넣어 주라(준중형 SUV) — 상품시트에만, 공급사 시트에는 자동처리로 차종마스터 연동해서」 → `AdoptedSpecName` 에 규격_차종분류·규격_차체형태 → `adoptedVehicleClassText`(「준중형 SUV」·「준대형 세단」·「대형 MPV」); `fill-supplier-ai-columns` 가 코드/결정 있는 차의 정제칸 「차종분류」를 규격채택 값으로(코드가 이김 목록에 포함), 없는 차는 classifyVehicleClass 그대로 → 21곳 반영(예: 「준대형」→「준대형 세단」). @매핑 `차종구분 ← 차종분류` 를 연식·Km 사이에(SALES_MAPPING+AI 인계 190줄), 머리글 메모. 세 탭 재발행(11:35~36) → 11열 차종구분 · 12열 Km · 13열~ 요금 블록. ⑤′ 일치 ✓. 작성 안내(정제칸 차종분류 문구)·AI 운영 매뉴얼 v9·이 시트는·영업자시트 매뉴얼 갱신.
- (추가 12:20) 사장님 「이런 상황 예방해 보자 · 트림 없는 거는 그냥 트림 비우는 거로 했잖아 · 차종구분은 주행거리 다음 · 제조사 색 · 세단/SUV 색(→ 「과하네」 취소) · 연료 색 · 차량 색상 정제(우유니화이트→화이트) 텍스트 색 · 규격 밖은 기타 · 색상마스터 탭 만들어 운용?」:
  - **트림 예방**: `audit-trim-evidence.mts`(확정 코드 478대: 근거 있음 374 · 근거 있음(결정) 66 · 유일 트림 10 · 다른 트림 2 · **근거 없음 26**(팔 수 있는 차 23, 첫 트림 t01 추정 유형 — 125호2615 리더스 K8 등)) → `--demote --apply`: 상품마스터 26줄 코드·적용값 비움+검수필요+사유(스냅샷 tmp/trim-demote-snapshot-*.json), 결정 파일 PARTIAL 26, 정제칸 세부트림 25칸 비움, 원천대장 「트림 근거 대조」 탭. `fill-supplier-ai-columns`: 정본이 코드 없음이면 옛 시트 코드도 비움 · 정본에 트림 없으면 공급사 원문(원문보존·결정 supplier_text)에 있는 트림만 남기고 근거 없는 스냅 트림은 비움(빌린카 「비즈니스」는 근거 있어 유지). 근거 = 우리가 미리 채운 시트 차명(트림)이 아니라 상품마스터 원문·결정 텍스트(순환 방지). run-daily ⑥에 트림 근거 대조 추가. ERP 동기 27 갱신(run_3vv6s9zvpa).
  - **색상**: color-master 별칭 보강(우유니·세레니티·클라우드·미색·쥐색·진회색·연두·청록…) · `snapColorOrEtc`(규격 밖 → 기타) · `COLOR_INK` 글자색 · `registerColorAliases`(런타임 덧대기) · `lib/domain/color-master-sheet.ts` + `publish-color-master-tab.mts` → 원천대장 「색상마스터」(@규격 12 · @별칭 53(코드)+사람 · @미매칭 1종 「토프」 9건) — fill/publish 가 @별칭을 얹음. 정제칸 색 채움 21곳(기타 포함) → 판매시트 외장 화이트 238·블랙 86·… 원문 새는 것 0. ERP: product-master-import 에 applyColors(규격색+원문 보존) — 배포 필요(sim PASS). 상품마스터에 색 열은 안 더함(헤더 엄격 검사 → 배포 전 추가하면 ERP 동기 즉사).
  - **글자색**: 제조사(category-colors.ts = 규격검토 색표, 순환 import 피해 분리) · 연료 · 외장/내장(규격색별) 조건부서식; 차종구분 색은 넣었다가 뺌. 차종구분 위치 Km 다음(요금 블록은 그 뒤 고정). 세 탭 재발행 12:14. AI 운영 매뉴얼 v10(§7 예방 규칙·§8) · 영업자시트 매뉴얼.
- (추가 12:35) 사장님 「외장색상 엔카 기준 학습해 봐(똑같이 따라할 필요는 없음) · 내부색상 학습만」 → color-master: `ENCAR_EXTERIOR`(30: 검정색·검정투톤·쥐색·은색·은회색·은색투톤·흰색·진주색·흰색투톤·진주투톤·은하색·명은색·갈대색·연금색·갈색·갈색투톤·금색·금색투톤·청색·하늘색·담녹색·녹색·연두색·청옥색·빨간색·주황색·자주색·보라색·분홍색·노란색)·`ENCAR_INTERIOR`(10 계열) → 우리 12/10색 대응(투톤=바탕색 · 계열=그 색 · 금색/갈대색/연금색=베이지 · 은하/명은=실버 · 은회/쥐색=그레이 · 담녹/연두/청옥=민트 · 하늘=블루 · 노랑/주황/자주/보라/분홍=기타). snapColor: 「투톤」·「계열」 접미 벗김, 내장 파랑 계열은 네이비로 접음. 대응 검증 40/40. 색상마스터 탭에 「@참고 엔카 기준」 표(별칭 반영 여부 표시) 추가·재게시. 우리 규격(12/10색+기타)은 그대로 — 엔카 30색 세분(투톤·명은/은하 등)은 렌트 재고엔 과하고 사장님 확정 팔레트를 유지.
