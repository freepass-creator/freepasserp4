# 출시 보안·데이터 게이트 — 2026-08-03

## 현재 판정

**운영 Rules 게시·공개 출시 NO-GO.**

- 운영 `database.rules.json`은 수정하거나 게시하지 않았다.
- 비게시 후보는 정적 보안 검사 **13/13 PASS**, 계약 Rules **26/26 PASS**, 전자서명 **58/58 PASS**다.
- 실제 Firebase Auth+RTDB Emulator 적대·정상 요청은 **26/26 PASS**다.
- 후보 Rules를 적용한 출시 정적 게이트의 코드 차단은 실제 법적 운영자 정보 6개만 남는다.
- 완료 전 계약은 영업자가 취소할 수 있고, 완료 계약의 취소·환수는 관리자로 제한했다. 정산 E2E **22/22 PASS**다.
- `/diag` 원시 노드는 v3 products 5,712건, v4 products 5,649건이지만, 관리자 SDK로 삭제 제외 활성 레코드를 다시 대조한 결과 v3 443건·v4 644건이다. 차량번호 기준 v3-only 판매 가능 재고가 **289대**이므로 v3 read를 닫으면 안 된다.
- 가격기간 누락 96건은 비계약 차량에 한해 `기존 가격 유지` 관리자 승인 원장을 추가했다. 계약보호 1건을 제외한 승인가능 묶음은 RP023 새 기본가격 확인 69, RP023 누락기간 유지 20, RP018 누락기간 유지 6건이다. 95건 승인 가정 후에도 소유권 39·삭제 재등장 57·미확정 삭제 8·임시신원 8·계약보호 가격 1건으로 계속 BLOCKED다.
- 소유권은 현재 단일 Sheet vs 기존 타공급사 38대와 계약보호 1대다. 삭제 재등장은 동일 상품키 56대와 계약보호 1대이며 연결 tombstone 77건 모두 삭제 사유·처리자 표식이 없다. 두 영역의 자동처리 후보는 0건이다.
- 위 96대의 관리자 건별 판단 화면과 비작동 원장을 추가했다. 비계약·단일 대상 94대만 결정을 기록할 수 있고 계약보호 2대는 서버에서도 409로 차단한다. 결정은 v4 원장에 PII 없이 남지만 아직 Sheet 계획/커밋이 소비하지 않으므로 재고·tombstone write와 차단 해제는 0건이다.
- 결정 dry-run은 현재 대상과 공급사·상품키·계약보호·병합별칭·원장 지문을 재대조하고 모든 후보를 `applyAllowed=false`, 실행작업 0으로 고정한다. 운영 원장 read-only 집계는 total 0 / recorded 0 / revoked 0이므로 현재 94대 미결정·2대 계약보호다. Sheet 공급사 변경은 참조 이관, 동일키 복구는 별도 v4 overlay 검증 없이는 실행할 수 없다.
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
- `lib/firebase/rtdb-settlements.ts`
  - public/private 정산을 한 번의 multi-location update로 유지하면서 private R1/R2가 신뢰 계약과 대조되도록 `contract_code`를 공통 메타에 포함한다.

## 후보에서 닫힌 13개 보안 표면

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

### 3. v3→v4 재고 절연 증거

후보는 v3 products 원문을 관리자만 읽게 한다. 게시 전에 다음을 모두 만족해야 한다.

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
- 최신 실제 운영 설정 dry-run은 16개 공급사·390대 수집이 모두 PASS했다. v3-only 292건 중 현재 Sheet에 존재하는 것은 240건(참조보호 29 포함), Sheet에는 없지만 참조가 있는 것은 7건, Sheet·참조 모두 없는 것은 45건/41대다.
- 실제 앱·일일동기화와 같은 `product_code` overlay 병합으로 재검증한 저장 계획은 **공급사 간 소유 충돌 39건, 삭제매물 재등장 57건, 공급사 미확정 삭제이력 8건, 번호미정 식별자 변경 1건, 임시번호 신원서명 불일치 7건, 기존 가격기간 누락 96건**으로 정상 차단됐다. 활성 중복은 0건이다.
- 상세 레코드 작업량은 가격기간 누락 96행, 공급사 소유 충돌 90행, 삭제이력 재등장 77행, 미확정 삭제 8행, 임시번호 신원불일치 7행, 번호미정 변경 1행이다. 계약보호 4행은 자동수정 금지다.
- 최신 v3-only 288대의 절연 분류는 진행계약 보호 4대, 시트 충돌 104대, 승인 후 동일 legacy key overlay 후보 132대, 시트 없음·이력참조 브리지 유지 5대, 시트·참조 없음 공급사 확인 43대다. 전체 커밋이 차단되어 운영 write는 0건이다.
- 충돌 집중 공급사는 RP004 54행, PT-0026·RP021 각 24행, RP018 17행, RP005 16행, PT-0024 12행이다. 가격기간 → 삭제 재등장 → 공급사 소유 → 임시번호 순으로 정책을 확정한다.
- `scripts/audit-v3-only-sheet-coverage.mts`는 Firebase·Sheet·로컬 파일 write 없이 현재 운영 설정 기준 분류를 재현한다.

1. v3/v4 자연키와 실제 child key 전수 대조
2. v3-only, v4-only, 공통키 필드차이 목록 생성
3. 공개/비공개 필드 분리 후 v3-only 정당 재고를 v4로 이관
4. 역할별 v4-only 목록·상세·검색·시트동기화 E2E
5. 이관 전후 활성 재고 수와 계약·채팅·정산 참조 정합성 일치
6. `NEXT_PUBLIC_BRIDGE_V3` 단계적 비활성 및 롤백 검증

## 게시 전 순서

1. 법적 운영자 정보 입력
2. v3/v4 키·필드 gap 전수 감사와 필요한 이관 dry-run
3. 후보 Rules를 최신 운영 스냅샷으로 Emulator 재실행
4. 관리자·영업자·영업관리자·공급사·공급관리자 전용 QA 계정 E2E
5. 사람 또는 Claude가 돈·계약·데이터·Rules 최종 게이트 승인
6. 백업·롤백 절차를 준비한 뒤에만 Rules 게시

## 재현 명령

```powershell
node scripts/ruleprobe/build-release-candidate.mjs
npx tsx scripts/check-release.mts --rules=scripts/ruleprobe/release-candidate.rules.json
npx tsx scripts/sim-release-security-rules.mts --rules=scripts/ruleprobe/release-candidate.rules.json
npx tsx scripts/sim-contract-rules.mts --rules=scripts/ruleprobe/release-candidate.rules.json
npx tsx scripts/sim-contract-sign-rules.mts --rules=scripts/ruleprobe/release-candidate.rules.json
cd scripts/ruleprobe
npx firebase-tools@13 emulators:exec --config firebase.release.json --project demo-freepasserp4 --only auth,database "node release-probe.mjs"
```

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
