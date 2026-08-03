# Claude 검수 — Codex 2026-08-03 작업분

대상: 워킹트리 **미커밋** 변경 67파일 `+5,495 / −1,010` (HEAD = `aa1f449`)
근거 문서: `VERIFICATION.md` 2026-08-03 절
방법: 게이트 재실행 + 5영역(CAS·시트·차명·감사·UI) 재현 기반 적대검증. 반증 실패한 지적은 뺐다.

판정: **머지 반대(No-Go).** 다만 **NO-GO 유지·운영 write 0건 판단은 옳았다.** 아래 결함은 코드 결함이지 판단 착오가 아니다.

> **2026-08-03 갱신 — 차단 5건 중 4건 종료.** B1·B2·B3 은 Claude 가 수정했고, B4 는 검수 도중
> Codex 가 `isLegacySheetOwnedBlock` 으로 스스로 고쳤다(16건 → 3건, 잔여 3건은 정당).
> **남은 차단은 B5(임시번호 재발급) 하나.** 상세는 각 항목 말미의 「종료」 표시를 볼 것.

---

## 0. 먼저, 이전 검수 초안의 오류 정정

초안에서 나는 "Codex 가 자기가 만들지 않은 규칙 변경을 전제한 테스트를 남겨 게이트가 깨진 채로 온다"고 썼다.
**틀렸다.** `VERIFICATION.md:25-33` 을 다시 읽으면 Codex 는 그 실패를 명시 보고했다:

> 로컬 `sim-*.mts` 25종 중 22종 PASS. 아래 Rules 전용 3종은 **의도한 출시 차단을 재현해 FAIL** 했다.
> `sim-contract-rules.mts` / `sim-contract-sign-rules.mts` / `sim-release-security-rules.mts` 0/13
> `npm run check:release`: FAIL — 차단 13개, 경고 2개

즉 미보고 실패가 아니라 **미해결 보안 격차를 자동 게이트로 박제한 것**이고, 이건 잘한 일이다.
`scripts/check-release.mts` 에 규칙 게이트 12개를 새로 세운 것도 같은 맥락이다 —
계약 PII·서명 제어필드·정산 금액 위조·v3 광역 write 같은 항목이 이제 눈에 보이는 빨간불로 남는다.

같은 이유로 "오토플러스 유입 0대"도 결함이 아니라 **의도된 fail-closed** 다.
`VERIFICATION.md` 가 `0매물 · 가격없음 103 · 보증금 규칙 미설정 · 올림0 안전차단` 을 그대로 적어 두었고,
`deposit_rule` 을 임의로 저장하지 않은 것은 "시트에 없는 보증금을 rent×배율로 날조" 사고를 반복하지 않은 옳은 선택이다.
(실측: 시트 연결 16곳 중 `deposit_rule` 설정은 RP012 하나뿐 → 나머지는 설계대로 막힌다.)

---

## 1. 잘한 것 — 되돌리지 말 것

1. **AutoPlus 보증금 규칙을 실측으로 확정.** 운영 Sheet ↔ `data/sheet-ingress/RP023-autoplus.json`(7/28 검증본)
   차번·기간 대조에서 `rent_multiple` 283/295 vs `months_per_year` 74/295. 어긋난 12개의 원인
   (제조사 칸이 빈 BMW 3대의 과거 국산×2 오분류)까지 규명했다. 그러고도 코드에 박지 않고
   `partner.deposit_rule` 명시 설정을 계속 요구한 것이 특히 옳다.
2. **계약 차량 스냅샷 10종 확장**(`lib/domain/deal.ts:196-205`). `/sign` 차명이 리터럴 `'차량'` 이던 문제를
   페이로드 땜질이 아니라 생성 시점에서 풀었다 — 옳은 자리다.
3. **미해결 보안 격차를 게이트로 박제**(위 §0). `check:release` 13 FAIL 은 이 코드의 흠이 아니라
   원래 있던 부채를 드러낸 것이다.
4. **strict 읽기 실패를 예외로 승격.** `merged(strict)` 가 조용한 빈 배열 대신 `health.complete=false` 로 올라가
   `sheet-merge.ts:206-208,247-249` 에서 throw 한다. "화면 폴백이 조용히 덮어 결손이 검수에 안 잡힘" 계열 차단.
5. **CAS 노드 선택이 맞다.** 계약 락은 `settlement-engine.ts:226 → store.update → dbUpdate(v4/products/{key})`
   로 같은 노드에 쓰므로 `runTransaction(v4/products/{key})` 이 서버 재시도에서 그 변경을 본다.
   `vehicle_status`·`locked_by_contract` 가 `DEFAULT_GUARD_FIELDS` 에 있어 **중복판매 경로는 실제로 abort 된다.**
6. **운영 write 0건 · 규칙 게시 0건 · 배포본에서 동기화 실행 금지 명시.**

---

## 2. 차단 — 재현 완료

### B1. 차명 조립이 트림 코드를 파괴한다 (Claude 직접 재현)

`lib/domain/vehicle-name.ts` `removeKnownPhrases` 가 경계 없는 부분일치로 지운다.

```
입력  maker=BMW · sub_model=BMW 3시리즈 G20 · variant=2.0 디젤 · trim_name=420d
출력  T2 = "BMW 3시리즈 G20 디젤 4 d"        ← 420d 가 4 d 로 파괴
```

`comparable('2.0')='20'` 이 `comparable('420d')='420d'` 안에 부분일치해 제거된다.
같은 방식으로 `2.5 프리미엄` → `프리미엄`(variant 와 중복 제거는 의도지만 결과가 원문과 달라짐).

**왜 차단인가**: 이 diff 가 같이 넣은 `deal.ts:196-205` 가 `trim_name_snapshot`·`vehicle_name_snapshot` 을
계약에 **굽는다**. 파괴된 문자열이 계약에 박제되고, `contract-sign-public.ts` → `app/sign/[token]/page.tsx:82`
경로로 **손님 서명 화면에 그대로 게시**된다. 그리고 그 스냅샷은 되돌릴 수단이 없다.

최소 조치: 토큰 경계를 강제한다(단어 단위 매칭) 또는 배기량·숫자 토큰을 제거 대상에서 제외한다.

### B2. 새 fresh 목록 2종이 원가·VIN 마스킹을 우회한다

`lib/firebase/rtdb-adapter.ts` 읽기 경로 7개 중 5개는 `canSeeProductCost/stripProductCost` 를 적용한다
(`:461 list` · `:490 listRaw` · `:499 listDeleted` · `:533 listFreshWithHealth` · `:547 get`).
**`:514 listAllFreshWithHealth` 와 `:518 listRawFreshWithHealth` 만 빠졌다** — 그리고 시트 저장 경로
(`sheet-merge.ts:203-209, 245-251`)가 쓰는 게 정확히 이 둘이다.

`merged()` 는 v3 `products` 를 회사 스코프 없이 전량 읽으므로, 공급사 세션에
**타 공급사 매입원가·VIN·수수료가 마스킹 없이 내려간다.**
같은 diff 에서 `listDeleted`(:499)에는 "영업자/타 공급사에 비공개 원가가 다시 노출된다"는 주석과 함께
마스킹을 **새로 추가**했다 — 옆에 같은 구멍을 새로 뚫었다.

### B3. 부분 커밋을 "저장 안 됨"으로 거짓 보고한다

`rtdb-adapter.ts:713-745` 는 공개(`v4/products`)와 비공개(`v4/products_private`)를 **별도 트랜잭션 2단**으로
순차 커밋한다. 비공개 단계에서 precondition 이 어긋나면 `conflicts.push; break` 하면서 `updated++` 를 건너뛴다.

결과: **공개 가격·스펙은 이미 서버에 반영되어 손님·영업자 화면에 게시**된 상태인데
`updated===0` 이라 `sheet-merge.ts:325-330` 이 "저장 중 변경됐습니다 — 데이터 검증을 다시 실행하세요" 로 throw 하고,
`lib/store.ts:615` 의 `_invalidate('product')` 도 실행되지 않아 **운영자 화면은 저장 전 값을 계속 보여준다.**
운영자는 미저장으로 판단하고 화면이 그 판단을 확증해준다. `plan.creates` 는 throw 로 통째 누락된다.

### B4. 자동차단된 매물이 영구 동결된다 (Claude 실측)

`lib/domain/sheet-merge.ts:45-48` `manualBlocked` 의 전제:
> 출처 표식 없는 출고불가는 수기 보류로 간주한다. 예전 데이터는 자동·수기를 구분할 근거가 없다.

**근거는 있다. `status_label` 이다.** 실측(v3 ∪ v4, 읽기 전용):

```
살아있는 매물 1,095 · 출고불가 17
  sheet_status_owner 있음 0 · locked_by_contract 있음 1  → manualBlocked 16
    시트에서 제거됨 14   ← 부재처리가 자동으로 내린 것 (source: external_sheet)
    일괄 출고불가    2   ← erp3 일괄 조작
```

표식이 없는 이유는 수기라서가 아니라 **그때 그 필드가 없었기 때문**이다.
14대는 시트에 다시 올라와도 영원히 복구되지 않는다.

**탈출구가 제품에 없다.** `allow_sheet_reactivate` 는 읽는 곳이 4군데
(`sheet-merge.ts:48,56` · `sheet-sync-all.ts:465,481`)인데 **`true` 로 쓰는 코드가 저장소에 없다.**
유일한 등장이 `features/inventory/useInventoryEditorLifecycle.ts:148` 의 `null` 삭제다.

같은 이유로 `sheet-sync-all.ts:458-467` `manualReactivations` 는 **항상 빈 배열**인 죽은 분기다.

### B5. 임시번호가 매 동기화마다 재발급되어 자기 자신과 충돌한다

`partner.pending_plates` / `pending_plate_seq` 가 시트 16곳 **전부 미저장**이다.
`createPlateAllocator(undefined, 0)` 의 첫 발급은 항상 `100신0001` 이라, 이미 그 번호를 쓰는 ERP 레코드와
충돌한다. 신설된 충돌 게이트가 전사 커밋을 막으므로 **동기화가 구조적으로 성공할 수 없다.**

---

## 3. 보류 — 확인 필요(차단은 아님)

- **`price[기간].fee` 소거 가능성.** `rtdb-adapter.ts:718-738` 비공개 트랜잭션이 얕은 스프레드
  (`{...current, ...privateRecord}`)라 `price` 객체를 통째로 교체한다는 지적. 실데이터에서 `fee` 를 가진
  매물이 있는지 세어 확인할 것.
- **`master_snap` 감사 유실.** 시트 유입이 `bulkPatch`(`:685-687` snapish 분기 → `buildMasterSnapBulkEntry`)에서
  `bulkPatchGuardedProduct`(`:746`, `guarded-bulk:N` 한 줄)로 바뀌어 차명 변환 증거가 사라진다는 지적.
  B1 과 같은 계열(차명 증거 유실)이라 함께 보면 좋다.
- **감사로그 마스킹의 방향 문제.** `PII_FIELDS` 에 범용 키(`name` `phone` `email` `business_number` `address`)가
  들어가 **파트너 상호·사업자번호 변경 이력이 `***` 로 소실**된다는 지적. 반대로 v3 레거시 정규화가
  기존에 화면에 안 나오던 평문 PII 를 새로 노출한다는 지적도 있다(실측 114행 주장). 둘 다 재확인 필요.
- **어댑터 3종의 트랜잭션 의미 차이.** Local 은 all-or-nothing preflight, RTDB/Firestore 는 부분 커밋.
  `sim-*` 는 전부 Local 경로라 **프로덕션에서만 나오는 반쪽 반영을 게이트가 재현할 수 없다.**
  "LocalAdapter·FirestoreAdapter 에도 같은 계약을 구현했다"는 `VERIFICATION.md` 진술은 정정 필요.

---

## 4. 오탐으로 판정 — 조치 불필요

- **`inferLeadingMaker` 가 제조사를 날조한다** → 반증됨. 주장 근거가 실데이터에 도달하지 않는 합성 입력이었다.
- **provider 세션에서 private 트랜잭션이 규칙에 막혀 죽는다** → 규칙 메커니즘 서술은 맞으나 조상 `.read` 관계
  판정이 틀려 실제로는 도달하지 않는다.
- **차명 조립 성능이 127ms → 6,944ms** → **과장.** Claude 실측 5,000회 285ms(건당 0.057ms) →
  5,647대 기준 약 320ms. 회귀는 있으나 주장 수치의 1/20 이다. 메모이제이션은 검토할 만하지만 차단이 아니다.
- **어댑터별 `null` vs 필드없음 불일치** → 저장계층 차이일 뿐 판정 결과가 같아 실피해 없음.

---

## 5. 총평

문제 선정은 정확했고 절차도 대체로 옳았다 — 실측으로 규칙을 확정하고, 미해결 부채를 게이트로 박제하고,
운영 데이터를 건드리지 않고 NO-GO 를 유지했다. **되돌릴 작업이 아니다.**

차단 5건의 성격은 둘로 갈린다.

- **B1·B2** 는 "고치는 김에 옆에 새로 뚫은 구멍"이다. B2 는 같은 diff 안에서 한쪽(`listDeleted`)은 막고
  다른 쪽(`listAllFresh*`)은 안 막았다 — **변경한 함수의 형제들을 같이 훑지 않았다.**
- **B3·B4·B5** 는 "전제를 데이터로 확인하지 않은 것"이다. B4 는 `status_label` 을 세어봤으면,
  B5 는 `pending_plates` 저장 여부를 조회했으면 그 자리에서 드러났다.

다음에 같은 종류를 줄이려면: ① 읽기/쓰기 경로를 바꿀 때 **같은 어댑터의 형제 메서드를 전수 대조**할 것,
② "구분할 근거가 없다"는 전제는 **실데이터를 세어 확인**할 것, ③ 새 필드(`allow_sheet_reactivate` 등)를
설계에 넣었으면 **그 값을 쓰는 경로까지 같은 커밋에 넣을 것**(읽기만 하는 플래그는 없는 것과 같다).

---

## 6. 조치 결과 (Claude, 2026-08-03)

| | 항목 | 상태 | 조치 |
|---|---|---|---|
| B1 | 차명이 트림 코드를 파괴 | **종료** | `vehicle-name.ts removeKnownPhrases` 에 영숫자 경계 lookaround 추가. 한글 경계는 열어 둬 `기아자동차`→`기아` 걷어내기는 유지. 재현 확인: `420d` 복원(`BMW 3시리즈 G20 디젤 420d`). |
| B2 | fresh 목록 2종이 원가·VIN 마스킹 우회 | **종료** | `rtdb-adapter.maskCost()` 신설 후 `listAllFreshWithHealth`·`listRawFreshWithHealth` 에 적용. 읽기 7경로 전부 마스킹 확인. |
| B3 | 부분 커밋을 "저장 안 됨"으로 거짓 보고 | **종료** | 비공개 트랜잭션 실패 시에도 `updated++`. 공개분이 이미 커밋된 사실을 올려 보내 캐시 무효화가 돌게 하고, 충돌은 `conflicts` 로 따로 알린다. |
| B4 | 자동차단 매물 영구 동결 | **종료(Codex)** | 검수 도중 Codex 가 `isLegacySheetOwnedBlock`(`status_label==='시트에서 제거됨'` + source sheet 계열)으로 스스로 수정. 실측 재확인: 출고불가 17 중 시트소유 인식 13 · **수기보류 잔여 3**(`일괄 출고불가` 2 = 관리자 일괄조작이라 정당 · 상태 불일치 1). |
| B5 | 임시번호가 매 동기화마다 재발급 | **미해결** | `partner.pending_plates`/`pending_plate_seq` 가 시트 16곳 전부 미저장. 코드 경로(`sheet-sync-all.ts:100,695`)는 이미 읽고 쓰게 돼 있으므로 **첫 성공 동기화 1회로 자연 해소**되나, 그 첫 회차가 충돌 게이트에 막히면 순환이 된다. 첫 동기화를 어떻게 통과시킬지는 운영 판단(공급사 1곳부터 순차 등) 필요. |

게이트 재실행: `tsc` PASS · `check:tokens` PASS · JSX 주석 PASS ·
`sim-sheet-merge` PASS · `sim-sheet-diff` PASS · `sim-work-list-semantics` 142/142 PASS.
`sim-contract-rules`·`sim-contract-sign-rules`·`sim-release-security-rules`·`check:release` 는
**Codex 가 의도한 대로 여전히 FAIL** — 규칙 미해결 부채를 드러내는 게이트이므로 정상이다.

### B4 잔여 3건에 대한 메모

`allow_sheet_reactivate` 는 여전히 **읽기 4곳 · 쓰기 0곳**이다(죽은 플래그).
B4 가 레거시 라벨 인식으로 대부분 해소돼 급하지는 않지만, 남은 3건을 화면에서 풀 수단이 없다는 사실은 그대로다.
플래그를 켜는 경로를 만들거나 플래그를 지우거나 — 둘 중 하나는 해야 한다.
