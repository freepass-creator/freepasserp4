# 규격통일 핸드오프 (Claude ↔ Cursor)

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
