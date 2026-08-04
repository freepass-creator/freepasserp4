# 출시 보안·데이터 게이트 — 2026-08-03

## 현재 판정

**운영 Rules 게시·공개 출시 NO-GO.**

영업자·공급사만 쓰는 B2B 제한 오픈도 아직 NO-GO다. 비게시 후보에서 발견한 `v4/products .read` 계정상태 우회는 후보 생성기에 활성·배정 역할 제한을 추가해 닫았고 정적·Emulator 검증을 통과했다. Preview 자격증명·배포·비인증 fail-closed까지 통과했지만 운영본은 미변경이며 역할별 전용 QA 계정 smoke·사람/Claude 실데이터 Rules 승인이 남아 있어 제한 오픈할 수 없다.

- 운영 `database.rules.json`은 수정하거나 게시하지 않았다.
- 비게시 후보는 정적 보안 **14/14 PASS**, 계약 Rules **26/26 PASS**, 전자서명 **58/58 PASS**다.
- 별도 포트의 Firebase Auth+RTDB Emulator 적대·정상 요청은 계정상태 6건을 추가해 **32/32 PASS**다.
- 후보 Rules를 적용한 출시 정적 게이트의 코드 차단은 실제 법적 운영자 정보다. B2B 배포 게이트는 Preview 서비스계정을 현재 프로세스에 주입해 **23/23 PASS**했고, 남은 배포 검증은 역할별 전용 QA token smoke다.
- 완료 전 계약은 영업자가 취소할 수 있고, 완료 계약의 취소·환수는 관리자로 제한했다. 정산 E2E **22/22 PASS**다.
- `/diag` 원시 노드는 v3 products 5,712건, v4 products 5,649건이지만, 관리자 SDK로 삭제 제외 활성 레코드를 다시 대조한 결과 v3 443건·v4 644건이다. 차량번호 기준 v3-only 판매 가능 재고가 **289대**이므로 v3 read를 닫으면 안 된다.
- 최신 공급사 Sheet read-only 대조는 16곳·389대이며 v3-only는 **292건/288대**다. 현재 Sheet 연결 239대(참조보호 31대 포함), 참조만 7대, Sheet·참조 없음 42대라 데이터 이관 없이 후보 Rules부터 게시할 수 없다.
- `/api/products/bridge`는 활성 실계정의 토큰과 현재 사용자 프로필을 서버에서 재검증한 뒤 v3 상품을 역할별 투영한다. 영업자·타 공급사 매물의 원가·VIN·계좌·기간별 내부 수수료를 제거하고, 공급사 자기 회사와 관리자만 허용 범위의 원문을 받는다. 활성 재고와 계약·문의 참조 삭제 이력만 선별한 최신 응답 후보는 원시 약 5,700건 중 **740건**으로 상한 2,000건 안이다. 비인증 요청은 403이며 적대검증은 16/16 PASS다.
- 이 호환층은 read-only이고 v3/v4 데이터나 Rules를 수정하지 않는다. 먼저 서버 자격증명과 실계정 역할별 응답을 확인한 뒤 후보 Rules를 게시해야 한다. 역순 배포는 재고 공백을 만든다.
- Vercel Preview에만 `FIREBASE_SERVICE_ACCOUNT_JSON`을 Sensitive로 등록했다. 첫 실배포에서 `firebase-admin@14.2.0 → jwks-rsa@4 → jose@6`의 CJS/ESM 런타임 충돌로 Admin API 500을 발견했고 `firebase-admin@13.10.0` 고정으로 해소했다. `next@15.5.21`, 서버 `not-found` 경계 수정, SheetJS 0.20.3까지 반영한 최종 Preview `dpl_9H8TtHymfPhUcocr1gbvpnim66FQ`에서 로그인 200·없는 경로 404·상품 브리지/기존 Admin API 비인증 403·error 로그 0을 확인했다. Production은 미변경이며 새 API는 계속 404다. 전용 QA 역할별 200·원가격리 smoke 전에는 Rules 게시와 오픈을 금지한다.
- 중단된 npm `xlsx@0.18.5`는 SheetJS 공식 보안 수정본 `0.20.3` CDN tarball로 고정하고 write/read roundtrip 및 정산·Sheet 회귀를 통과했다. production `npm audit`는 critical 0 / high 3 / moderate 8이며 남은 high는 Next 내부 `postcss/sharp` 전이 항목과 그 집계다. Next upstream 호환 전 무검증 강제 override는 하지 않는다.
- 가격기간 누락 95건은 비계약 차량에 한해 `기존 가격 유지` 관리자 승인 원장을 추가했다. 계약보호 1건을 제외한 승인가능 묶음은 RP023 새 기본가격 확인 69, RP023 누락기간 유지 19, RP018 누락기간 유지 6건이다. 94건 승인 가정 후에도 소유권 39·삭제 재등장 56·미확정 삭제 8·임시신원 8·계약보호 가격 1건으로 계속 BLOCKED다.
- 소유권은 현재 단일 Sheet vs 기존 타공급사 38대와 계약보호 1대다. 삭제 재등장은 동일 상품키 55대와 계약보호 1대이며 연결 tombstone 76건 모두 삭제 사유·처리자 표식이 없다. 두 영역의 자동처리 후보는 0건이다.
- 위 95대의 관리자 건별 판단 화면과 비작동 원장을 추가했다. 비계약·단일 대상 93대만 결정을 기록할 수 있고 계약보호 2대는 서버에서도 409로 차단한다. 결정은 v4 원장에 PII 없이 남지만 아직 Sheet 계획/커밋이 소비하지 않으므로 재고·tombstone write와 차단 해제는 0건이다.
- 결정 dry-run은 현재 대상과 공급사·상품키·계약보호·병합별칭·원장 지문을 재대조하고 모든 후보를 `applyAllowed=false`, 실행작업 0으로 고정한다. 운영 원장 read-only 집계는 total 0 / recorded 0 / revoked 0이므로 현재 93대 미결정·2대 계약보호다. Sheet 공급사 변경은 참조 이관, 동일키 복구는 별도 v4 overlay 검증 없이는 실행할 수 없다.
- 남은 공급사 미확정 삭제 8대는 모두 삭제 1건↔현재 단일 Sheet 행 연결 후보지만 삭제 레코드와 현재 Sheet 사이에 5개 신원 원자군의 차이가 존재해 자동복구하지 않는다. 임시번호 8대도 트림·색상·연료·등록/연식 등이 광범위하게 달라 실제 동일차 확인 전 번호 유지/재발급을 자동 결정하지 않는다. 전체 16대 중 계약보호 1대, 실행작업 0이다.
- 위 16대의 유형별 차량 판단 원장과 관리자 결정/철회 UI를 추가했다. admin Bearer, 현재 v3+v4 계약보호 재검증, 원문 지문, 단일 공급사·기존키·Sheet키를 요구하며 raw·차번은 저장하지 않는다. 운영 `v4/sheet_identity_decisions` read-only 집계는 total 0 / recorded 0 / revoked 0이다. 원장은 동기화 계획이 소비하지 않으므로 복구·신규·재번호·유입제외와 차단 해제는 계속 0건이다.

## 만든 검증 자산

- `scripts/ruleprobe/build-release-candidate.mjs`
  - 운영 Rules를 읽어 `release-candidate.rules.json`을 생성한다.
  - 생성물은 **DO NOT PUBLISH** 후보이며 운영 파일을 덮어쓰지 않는다.
- `scripts/ruleprobe/release-probe.mjs`
  - v3 원본 폐쇄, v4 소유권, 공개서명 수명, 계약 불변·역할 격리, 차량 잠금 결속, 정산 금액 결속을 실제 HTTP 200/401로 검증한다.
- `scripts/check-release.mts --rules=<path>` 및 Rules 시뮬레이션 3종
  - 운영본과 후보본을 같은 게이트로 비교할 수 있다.
- `scripts/check-b2b-release.mts`
  - Firebase 환경 이름·서비스계정 구조와 project_id 일치, Vercel Admin SDK 하위 의존성 호환, Sheet OFF, product v3 브리지, 후보 Rules, 브리지 API read-only·private 제거를 값 노출 없이 판정한다.
- `scripts/smoke-b2b-product-bridge.mts`
  - 배포 후 영업자·공급사 ID token으로 403/200, 상품 집합·count, 영업자 private 0, 공급사 타회사 private 0을 확인하며 토큰·상품키·금액은 출력하지 않는다.
- `lib/firebase/rtdb-settlements.ts`
  - public/private 정산을 한 번의 multi-location update로 유지하면서 private R1/R2가 신뢰 계약과 대조되도록 `contract_code`를 공통 메타에 포함한다.

## 후보에서 확인한 보안 표면

1. v3 products raw write 폐쇄
2. v3 partners provider 광역 write 폐쇄
3. v3 policies provider 광역 write 폐쇄
4. v3 products 원가·VIN raw read 관리자 한정
5. v4 차량상태·잠금 쓰기를 계약·차량·당사자·상태에 결속
6. v4 partners/policies를 자기 공급사 레코드에 결속
7. 공개서명 익명 read를 제출 전 `sent`에만 허용
8. 계약 차량 스냅샷 생성 후 불변
9. `contract_date` 생성 후 불변
10. 고객 PII와 전자서명 제어필드의 공급사 변경 차단
11. 계약취소를 영업조직/관리자 또는 공급사 거부사유에 결속
12. 역할별 계약 메모 격리
13. settlement와 private R1/R2 최초 금액을 완료 게이트·계약코드·귀속·동결 금액/율에 결속
14. v4 공개 products read를 활성·배정 역할로 제한

## 아직 출시를 막는 항목

### 1. 법적 운영자 정보 6개

실제 사실값이 필요하므로 임의 작성 금지다.

- 상호
- 대표자
- 주소
- 사업자등록번호
- 문의 이메일
- 개인정보 보호책임자

### 2. 완료 계약 취소·환수 정책 — 해결

사용자 승인에 따라 **관리자 전용**으로 확정했다.

- 완료 전 계약은 기존대로 영업자가 취소할 수 있다.
- 완료 계약은 영업자 화면에서 취소 버튼을 숨기고, 엔진에서도 write 전에 차단한다.
- 관리자는 완료 계약을 취소하면 계약취소 → 차량 잠금 해제 → private R1 기준 환수대기로 처리한다.
- `scripts/sim-e2e-settlement.mts`에서 영업자 차단·무변경, 관리자 허용·차량 해제·환수대기까지 **22/22 PASS**했다.

이 항목은 출시 정적 게이트에서 해제됐다. 향후 영업자에게 완료계약 취소 요청 기능을 제공하려면 서버 원자처리를 별도 설계해야 한다.

### 3. v3→v4 재고 절연 또는 안전 서버 투영 증거

후보는 v3 products 원문을 관리자만 직접 읽게 한다. 비관리자는 인증된 서버 투영을 먼저 배포·검증해야 하며, 장기적으로 v4 이관이 끝나면 이 호환층을 제거한다.

#### 2026-08-03 운영 읽기 전용 전수대조

- child key는 공통 1개, v3-only 442개, v4-only 643개다. 단순 child key 복사는 정본 이관이 아니다.
- 차량번호는 공통 100개, v3-only 288개, v4-only 38개다. 중복은 v3 43그룹·98건, v4 16그룹·32건이다.
- v3-only 레코드는 292건이며 이 중 판매 가능 상태가 **289대**다: 출고가능 228, 출고협의 50, 즉시출고 11. 나머지는 출고불가 3대다.
- v3/v4 overlay를 같은 키로 합친 최신 참조 대조에서 v3-only 재고는 계약 정확키 4건·차량번호만 1건, 채팅방 정확키 34건·차량번호만 6건과 연결된다. 참조 이관 없이 복사·삭제하면 안 된다.
- 공통 차량번호 중 1:1인 59대를 공개필드로 비교하면 트림 57, 연식 51, 배기량 50, 카탈로그 50, 연료 37, 파워트레인 17, 공개 가격 13대에서 차이가 있다. 최신 시트·차량마스터 기준 정본 판단이 필요하다.
- 공개 v3 노드에는 원가/VIN/계좌 계열 값이 있는 레코드가 387건 남아 있다. 공개 v4에는 0건이고 `v4/products_private`에는 4,890건이 있다. 값은 보고서에 출력하지 않았다.
- 엔티티 업무키 대조 결과 `policy`, `partner`는 v3-only 0으로 단계적 브리지 해제 후보지만, `product`·`user`·`room`·`contract`·`audit_log`는 유지가 필요하다. `.env.local`의 `NEXT_PUBLIC_BRIDGE_V3`는 미설정이라 현재 기본 브리지가 유지된다.
- 재현 도구는 `scripts/product-gap.mts`와 `scripts/bridge-readiness.mts`이며 둘 다 읽기 전용이다.
- 기존 관리자 개발 화면의 child-key 기준 `v3→v4 복사 실행`은 제거했고 엔진도 비-dry-run 호출을 즉시 차단한다. `scripts/sim-migrate-products-write-gate.mts`와 출시 정적 게이트가 재노출을 막는다.

#### 최신 공급사 Sheet 교차검증

- 시트 없는 레거시 partner 껍데기가 같은 `partner_code`의 활성 시트 레코드와 함께 실행돼 16개 roster가 17줄이 되던 결함을 수정했다. 활성 `sheet_url` 레코드만 실행하며 `sim-sheet-merge` **124/124 PASS**다.
- 사용자 승인에 따라 운영 `v4/partners/RP023.deposit_rule`을 `rent_multiple`로 설정했다. v3·재고 write는 없고 감사로그 `AL-1785729521849-rp023-deposit-rule`과 재조회 일치를 확인했다.
- 읽기 전용 비교에서 `rent_multiple`은 과거 보증금 325개 공통 셀 중 282개가 일치했고, `months_per_year`은 74개만 일치했다.
- 최신 실제 운영 설정 dry-run은 16개 공급사·389대 수집이 모두 PASS했다. v3-only 292건 중 현재 Sheet에 존재하는 것은 239건(참조보호 31 포함), Sheet에는 없지만 참조가 있는 것은 7건, Sheet·참조 모두 없는 것은 46건/42대다.
- 실제 앱·일일동기화와 같은 `product_code` overlay 병합으로 재검증한 저장 계획은 **공급사 간 소유 충돌 39건, 삭제매물 재등장 56건, 공급사 미확정 삭제이력 8건, 번호미정 식별자 변경 1건, 임시번호 신원서명 불일치 7건, 기존 가격기간 누락 95건**으로 정상 차단됐다.
- 상세 레코드 작업량은 가격기간 누락 95행, 공급사 소유 충돌 90행, 삭제이력 재등장 76행, 미확정 삭제 8행, 임시번호 신원불일치 7행, 번호미정 변경 1행이다. 계약보호 4행은 자동수정 금지다.
- 최신 v3-only 288대의 절연 분류는 진행계약 보호 4대, 시트 충돌 102대, 승인 후 동일 legacy key overlay 후보 135대, 시트 없음·이력참조 브리지 유지 5대, 시트·참조 없음 공급사 확인 42대다. 전체 커밋이 차단되어 운영 write는 0건이다.
- 충돌 집중 공급사는 RP023 94행, RP004 54행, PT-0026·RP021 각 24행, RP018 22행, RP005 16행, PT-0024 12행이다. 가격기간 → 삭제 재등장 → 공급사 소유 → 임시번호 순으로 정책을 확정한다.
- `scripts/audit-v3-only-sheet-coverage.mts`는 Firebase·Sheet·로컬 파일 write 없이 현재 운영 설정 기준 분류를 재현한다.

1. 서버 `FIREBASE_SERVICE_ACCOUNT_JSON`과 `/api/products/bridge` 배포 확인
2. 영업자·공급사 실계정으로 전체 목록 수와 역할별 원가/VIN 격리 확인
3. 후보 Rules 게시 뒤 v3 direct read 차단과 서버 투영 목록 유지 동시 확인
4. 장기적으로 공개/비공개 필드 분리 후 v3-only 정당 재고를 v4로 이관
5. 이관 전후 활성 재고 수와 계약·채팅·정산 참조 정합성 일치
6. `NEXT_PUBLIC_BRIDGE_V3` 단계적 비활성 및 서버 투영 제거·롤백 검증

## 게시 전 순서

1. B2B 서버 환경에 Firebase Admin 자격증명 확인
2. 영업자·공급사 실계정으로 서버 투영 재고 수·원가격리 smoke
3. 후보 Rules를 최신 운영 스냅샷으로 Emulator 재실행
4. 사람 또는 Claude가 돈·계약·데이터·Rules 최종 게이트 승인
5. 백업·롤백 절차를 준비한 뒤 Rules 게시
6. 관리자·영업자·영업관리자·공급사·공급관리자 전용 QA 계정 write/read smoke

## 재현 명령

```powershell
npm run check:b2b-release
# Preview 배포 후 토큰은 파일·명령행이 아니라 현재 셸에만 주입한다.
$env:B2B_BASE_URL='https://<preview-host>'
$env:B2B_PLATFORM_ADMIN_ID_TOKEN='<플랫폼 관리자 QA 토큰>'
$env:B2B_AGENT_ADMIN_ID_TOKEN='<영업채널 관리자 QA 토큰>'
$env:B2B_AGENT_ID_TOKEN='<영업자 QA 토큰>'
$env:B2B_PROVIDER_ADMIN_ID_TOKEN='<공급사 관리자 QA 토큰>'
$env:B2B_PROVIDER_ID_TOKEN='<공급사 직원 QA 토큰>'
$env:B2B_AGENT_CHANNEL_CODE='<두 영업 QA 계정의 동일 채널 코드>'
$env:B2B_PROVIDER_COMPANY_CODE='<QA 공급사 코드>'
npm run smoke:b2b-roles
node scripts/ruleprobe/build-release-candidate.mjs
npx tsx scripts/check-release.mts --rules=scripts/ruleprobe/release-candidate.rules.json
npx tsx scripts/sim-release-security-rules.mts --rules=scripts/ruleprobe/release-candidate.rules.json
npx tsx scripts/sim-contract-rules.mts --rules=scripts/ruleprobe/release-candidate.rules.json
npx tsx scripts/sim-contract-sign-rules.mts --rules=scripts/ruleprobe/release-candidate.rules.json
cd scripts/ruleprobe
npx firebase-tools@13 emulators:exec --config firebase.release.json --project demo-freepasserp4 --only auth,database "node release-probe.mjs"
```

`smoke:b2b-roles`는 `GET /api/auth/session`과 `GET /api/products/bridge`만 호출한다. uid·토큰·상품키·원가를
출력하지 않고, 5역할의 세부 역할/조직 범위, 브리지 200, 공개 상품 집합, 영업 민감값 0,
공급사 타회사 민감값 0, `private/no-store` 헤더를 검사한다. 검증 뒤 위 토큰 환경변수를 모두 제거한다.

## 계약보호 재고 충돌 1건 확인

- 계약보호로 집계된 3행은 서로 다른 3대가 아니라 차량 `54나7852`, 계약 `TMP-260712-01` 한 건이 소유 충돌 레코드로 확장된 것이다. 과거 6행은 v3/v4 overlay 거짓 중복을 포함했다.
- 최신 Sheet 소유자는 `RP021`이지만 계약 원본은 `PT-0024_54나7852`와 공급사 `PT-0024`를 명시한다.
- 계약은 2026-07-12 생성, 2026-07-13 마지막 갱신, 상태 `계약요청`, 완료 체크는 `agent_delivery_inquiry` 1개, 서명 없음이다.
- 연결된 방 3개는 메시지 0건이다. 활동은 오래됐지만 현재 규칙에는 자동 만료가 없으므로 임의 취소·소유자 교체·대표키 병합을 하지 않았다.
- 운영자가 실제 진행 여부를 확인해 기존 계약을 명시적으로 취소하거나 유지해야 한다. 그 결정 전에는 해당 차량만 자동 동기화·중복 정리에서 계속 보호한다.

## v3/v4 충돌 감사 기준 정정

- 감사 도구가 RTDB child key 기준으로 `EXT_*`와 `공급사_차번` overlay를 별도 활성 차량으로 세던 오류를 수정했다.
- 실제 서버처럼 정규화 후 `product_code`로 병합하자 활성 중복 97건은 0건이 됐다. 이 항목 때문에 데이터 삭제를 해서는 안 된다.
- RP021의 실제 충돌은 24대다. 최신 Sheet 소유자는 모두 RP021이며 23대는 과거 공급사 상품과 소유 충돌, 1대는 진행계약 보호다.
- 과거 공급사 키 22대에는 private 원가가 남아 있고 1대는 과거 채팅 참조가 있다. private을 RP021로 복사하지 않고 기존 키에 보존한 채 공개 상품만 tombstone하는 안은 사람/Claude 데이터 게이트 전 실행 금지다.

## 가격기간 충돌 97대 — 운영 승인 전 자동연동 NO-GO

- 실제 분포는 RP023 90대, RP018 7대다.
- 사용자 가격 선택 규칙으로 비교하면 70대는 기본가격 변경, 27대는 계약기간 자체 삭제다. RP023의 과거 주행거리 변형키와 현재 오토플러스 표준키를 단순 동등 처리할 수 없다.
- RP023 `195주5304`는 진행계약 `TMP-260722-01`과 가격 변경이 겹친다.
- 상세 충돌 TSV에 가격영향·영향기간을 표시하도록 보강했지만 자동 승인/삭제는 구현하지 않았다.
- 공급사 확인 또는 운영자 기간별 승인 없이 `missingPricePeriods` hard block을 우회하거나 운영 일일동기화를 활성화하면 안 된다.
