# RTDB 막아둔 스크립트 — 판정표 (읽기 전용 조사 · 2026-09-10)

> 사장님 2026-09-10 「**RTDB 를 왜 못 지우는지** … 답답해 죽겠다」

코덱스 가지(`codex/rtdb-cutover-current`)가 RTDB 를 쓰는 스크립트를 **지우지 않고** 첫 줄에
빗장을 얹어 막아 두었다.

```
throw new Error('RTDB_REMOVED: 폐기된 RTDB 경로를 사용하는 스크립트입니다.');
import { getDatabase } from './lib/disabled-rtdb.mts';
```

**「제거」가 아니라 「비활성화」다.** 본문의 RTDB 코드는 그대로 남아 있어 grep 하면 계속 나온다.
이 문서는 막힌 것을 셋으로 갈라 **무엇을 지우고 · 무엇을 갈아끼우고 · 무엇을 남길지**를 정한다.

**이 문서는 조사 결과다. 코드는 손대지 않았다.**

---

## 0. 한 줄

```
코덱스 가지에서 빗장이 걸린 파일            293개
  우리 가지(feat/spring-atom-monitor)에서 이미 지운 것   168개  ← 죽은 스크립트 173개 정리분과 겹침
  우리 가지에 «아직 살아 있는» 것                        125개  ← 이 표가 다루는 것

그 125개를 셋으로 가르면
  옮긴다   80    지금도 쓰는데 막혀서 못 돈다
  남긴다   21    RTDB 를 보는 것이 일 자체다
  지운다   22    아무도 안 부르는 옛 일회성
  모르겠다  2    근거가 반반이라 못 정했다
```

⚠ **125 는 실측이다.** 오더에 적힌 「112」와 다르다 — 그 사이에 우리 가지가 죽은 스크립트를 더 지웠거나
셈의 기준이 달랐던 것으로 보인다. 아래 표가 실제로 센 것이다.

세는 법(재현):

```sh
git grep -l -E "RTDB_REMOVED|disabled-rtdb" codex/rtdb-cutover-current   # 293
git ls-tree -r --name-only HEAD -- scripts                               # 우리 가지에 남은 것과 교집합 → 125
```

---

## 1. ★★먼저 볼 것 — 「옮긴다」 80개

**「RTDB 를 «쓰는» 것」과 「RTDB 를 «재는» 것」은 다르다.**
재는 도구를 막으면 이관이 제대로 됐는지 확인할 길이 없어진다. 실제로 코덱스가
**이관 검증기와 진척 카운터를 둘 다 막았다.**

### 1-1. 빗장 «한 줄만» 지우면 되는 것 — RTDB 코드가 아예 없다 (3)

가장 급하다. 이 셋은 RTDB 를 **단 한 줄도 안 판다.** 순전한 부수피해다.

| 파일 | 무엇을 하나 | 근거 |
|---|---|---|
| `scripts/check-rtdb-cutover.mts` | ★**「RTDB 폐기가 얼마나 남았나」를 숫자로 세는 진척 카운터.** `npm run check:rtdb-cutover` | 본문이 `readFileSync` + `execSync grep` 뿐. `getDatabase`·`db.ref` 실사용 **0**. 「답답한 까닭은 끝이 안 보여서다」라고 스스로 적어 놓은 그 도구를 막았다 |
| `scripts/check-release.mts` | 릴리스 전 정적·환경 게이트. `npm run check:release` | 본문이 `fs` 읽기뿐. RTDB 접속 흔적 **0** |
| `scripts/deploy/_ctx.mts` | 배포 스크립트 공통 상수(프로젝트·서비스계정 경로) | 상수 모듈인데 최상단에서 던진다. **이걸 import 하는 5개가 같이 죽는다** — `deploy/rtdb-rules`(=`npm run rules:status`)·`deploy/rtdb-backup`·`deploy/vercel-env`·`migrate-freepass-legacy-sign-urls`·그 sim판. 그중 `vercel-env` 는 RTDB 와 무관하다 |

### 1-2. 「재는」 도구 — 이관이 제대로 됐는지 보는 눈 (6)

RTDB 를 읽기는 하지만 **읽는 목적이 「대조」**다. 막으면 이관 진행을 못 잰다.
대부분 REST(`fetch`)로 읽어 심(shim)과 무관하므로 **빗장만 풀면 지금 그대로 돈다.**

| 파일 | 무엇을 하나 | 근거 |
|---|---|---|
| `scripts/audit-firestore-parity.mts` | ★**파이어스토어 ↔ RTDB 대조 — 어디까지 옮겨졌고 무엇이 다른지 한 표.** `npm run audit:firestore-parity` | 오더가 지목한 그 이관 검증기. 읽기 전용. 「정책 81=81, 끊긴 건 상품 policy_code」를 이걸로 가려냈다(2026-09-05) |
| `scripts/check-settlement-parity.mts` | 정산 원장이 RTDB·파이어스토어에서 **같은 말을 하는지** 잰다. `npm run check:parity` | 「이중 쓰기의 값은 둘이 같다는 데 있다」 — 읽기를 옮기는 날 조용히 틀린 숫자로 갈아타는 것을 막는 유일한 검사 |
| `scripts/check-settlement-drift.mts` | 두 저장소가 «둘 다 살아 있는» 동안의 표류 검사. `npm run settlement:drift` | `issue-settlement-invoices` 가 부른다 |
| `scripts/verify-settlement-view.mts` | 정산 뷰의 노출 범위(누가 무엇을 보나)를 실측 | 보안 빗장 검증. 시트 API + RTDB REST |
| `scripts/check-confirm-readiness.mts` | 「확인대기」가 길이 없어서인지 사람이 안 눌러서인지 가른다 | `lib/domain/settlement-manual.ts` 가 이름을 대고 있다 |
| `scripts/audit-business-identity.mts` | 사업자등록번호 별칭 충돌 건수 감사(읽기 전용) | **`CLAUDE.md` 가 이름을 대고 있다** — 「충돌 건수를 먼저 확인한다」의 그 도구 |

### 1-3. 정산 회차·npm 이 지금 부르는 것 (27)

`npm run settlement:*` / `run-settlement-month` 회차가 부른다. **막힌 채로는 정산이 안 돈다.**
RTDB 를 `db.ref('v4/…')` 로 파는 곳은 심(`lib/server/firestore-ref-shim` `firestoreAdminRef()`)으로
**`const db = …` 한 줄**만 바꾸면 된다(`check-rtdb-cutover` 문서 참조).

| 파일 | 무엇을 하나 | 근거 |
|---|---|---|
| `scripts/atomize-settlement-month.mts` | 정산 한 달을 원자로 만든다 | `npm run settlement:atomize` · 회차 ① |
| `scripts/build-invoice-from-atoms.mts` | 원자로 청구서를 짠다 | `npm run settlement:calc` |
| `scripts/issue-settlement-invoices.mts` | 청구서 발행 | `npm run settlement:invoices` · 회차 |
| `scripts/publish-settlement-month.mts` | 그 달 정산 시트 발행 | `npm run settlement:publish` · 회차 |
| `scripts/publish-channel-settlement.mts` | 채널(영업사) 정산 시트 | 회차 · `lib/server/channel-sheet-tabs.ts` |
| `scripts/publish-supplier-settlement.mts` | 공급사 시트에 월별 정산서 붙이기 | 회차 |
| `scripts/check-fee-consistency.mts` | 수수료 정합 검사 | `npm run settlement:feecheck` · 회차 |
| `scripts/check-intake-gap.mts` | 입고 크로스체크 | `npm run check:intake` · 회차 |
| `scripts/check-clawback-pairs.mts` | 환수 짝 맞추기 | 회차 |
| `scripts/check-settlement-sync.mts` | 시트↔원장 반영 확인 | 회차 |
| `scripts/check-settlement-month.mts` | 그 달 정산 점검 | `npm run settlement:check` |
| `scripts/check-double-claim.mts` | 이중청구 검사 | `npm run check:double` |
| `scripts/check-party-code.mts` | 거래처 코드 정합 | `npm run check:party-code` |
| `scripts/backfill-party-code.mts` | 거래처 코드 채우기 | `npm run settlement:codes` · `app/api/settlement/statement` 가 이름을 댄다 |
| `scripts/build-billing-parties.mts` | 청구 거래처 표 만들기 | `npm run settlement:parties` |
| `scripts/build-progress-tab.mts` | 정산 진척 탭 | `npm run settlement:progress` |
| `scripts/fill-agent-from-rooms.mts` | 담당자 채우기 | `npm run settlement:agents` |
| `scripts/harvest-settlement-state.mts` | 정산 상태 걷기 | `npm run settlement:state` |
| `scripts/import-settlement-from-sheet.mts` | 직원이 시트에 넣은 것 들여오기 | `npm run settlement:import` |
| `scripts/learn-settlement-fees.mts` | 수수료 학습 | `npm run settlement:fees` |
| `scripts/settlement-worklist.mts` | 정산 할 일 목록 | `npm run settlement:worklist` |
| `scripts/review-sheet-edits.mts` | ★**「덮지 않는다」** — 상대가 고친 칸을 사람이 보고 정한다 | `docs/정산시트-매뉴얼.md` 확정 규격. `lib/server/sheet-edits.ts` 가 이름을 댄다 |
| `scripts/check-settlement-erp-store.mts` | 정산이 ERP 원장을 보는지 | `docs/CODEX-검증-정산-2026-08-28.md` |
| `scripts/check-confirm-reach.mts` | 확인 길이 닿는지 | `docs/정산서-매뉴얼.md` |
| `scripts/import-channel-history.mts` | 채널 지난 정산 들여오기 | `check-settlement-locked` 가 부른다 |
| `scripts/build-plate-registry.mts` | 차번 등록부 만들기 | `run-settlement-sheet` 회차 |
| `scripts/publish-plate-registry-tab.mts` | 차번 등록부 탭 발행 | `run-settlement-sheet` 회차 |

### 1-4. 자동동기 회차(hourly-sync)가 부르는 것 (6)

**막힌 채로는 매시간 회차가 통째로 멈춘다.**

| 파일 | 무엇을 하나 |
|---|---|
| `scripts/audit-atom-vs-erp.mts` | 원자 ↔ ERP 대조 |
| `scripts/audit-sales-vs-erp.mts` | 판매시트 ↔ ERP 대조 (「시트 512 · ERP 482, 왜 안 맞냐」의 그 도구) |
| `scripts/audit-status-drift.mts` | 상태가 원본→정제→판매→ERP 4층 중 어디서 갈렸나 |
| `scripts/mirror-sales-absent.mts` | 시트에서 빠진 차를 ERP 에 비추기 |
| `scripts/mirror-sales-photos.mts` | 사진 바뀐 것 ERP 반영 |
| `scripts/mirror-sales-vehicle-name.mts` | 차명 ERP 반영 |

### 1-5. npm 게이트·감시판 (7)

| 파일 | 무엇을 하나 | 근거 |
|---|---|---|
| `scripts/check-atoms.mts` | 원자 규격 게이트 — 불변이 안 움직이는지 | `npm run check:atoms` |
| `scripts/audit-passthrough.mts` | 「있는 걸 그대로 갖고 오는가」 감사 | `npm run audit:passthrough` |
| `scripts/audit-axis-coverage.mts` | 축 커버리지 | `npm run audit:axis-coverage` |
| `scripts/audit-policy-rules.mts` | 지금 무슨 정책 규칙을 쓰나 | `npm run audit:policy-rules` |
| `scripts/audit-policy-sheet-vs-erp.mts` | 정책 시트 ↔ ERP 대조 | `npm run policy:sheet-audit` |
| `scripts/audit-erp5-codes.mts` | ERP5 코드 현황 분류(읽기 전용) | `npm run audit:erp5-codes` · `docs/건물도면.md` |
| `scripts/cache-photo-urls.mts` | 사진 주소 캐시 | `npm run cache:photos` · `lib/domain/public-catalog.ts` |

추가로 `scripts/deploy/ops-watch.mts`(`npm run ops:watch`, 오픈 당일 관측판)와
`scripts/check-b2b-release.mts`(`npm run check:b2b-release`, 제한 오픈 게이트)도 같은 자리다.

### 1-6. 공급사·판매시트 파이프라인 (17)

`docs/영업자시트-매뉴얼.md` · `docs/정산시트-매뉴얼.md` 가 이름을 대고 있는 살아 있는 도구들이다.
「기억으로 하지 마라, 매번 틀어져서 매뉴얼로 박아 둔 것」의 그 도구들.

| 파일 | 무엇을 하나 |
|---|---|
| `scripts/create-supplier-sheet.mts` | 「<공급사> 프리패스 재고」 파일·탭 생성기 (표준 서식 정본) |
| `scripts/build-supplier-sheet-set.mts` | 공급사에게 나눠 줄 시트 한 벌 만들기 |
| `scripts/switch-supplier-sheet.mts` | 공급사가 확인·수정한 시트로 갈아 끼우기 |
| `scripts/restyle-supplier-sheets.mts` | 공급사 사본에 서식만 다시 입히기 |
| `scripts/prefill-supplier-sheets.mts` | 빈 양식 대신 ERP 값으로 미리 채워 주기 |
| `scripts/publish-supplier-hub.mts` | 공급사 허브 발행 |
| `scripts/publish-partner-tabs.mts` | 파트너 탭 그대로 갖고 오기 |
| `scripts/publish-jonghap-tab.mts` | 영업자가 보는 종합표 (표는 이것 하나뿐) |
| `scripts/peek-supplier-sheet.mts` | 공급사 시트 헤더·표본행 실측 |
| `scripts/scan-supplier-sheets.mts` | 공급사 시트 전수 스캔(읽기 전용) |
| `scripts/audit-inventory-sources.mts` | 공급사 시트 전수 read-only 감사 |
| `scripts/diagnose-sync-blocks.mts` | 「검증 차단 — …」 한 줄이 어느 공급사·어느 칸인지 |
| `scripts/fix-partner-sheet-url.mts` | 영업자 시트 주소 바로잡기 |
| `scripts/build-policies-from-sheets.mts` | 시트에서 정책 만들기 |
| `scripts/clear-legacy-variant.mts` | 정제칸 이전의 파워트레인 잔재 정리 |
| `scripts/build-photo-map.mts` | 차번 → 대표사진 지도 |
| `scripts/audit-deposit-vs-sheet.mts` | 보증금 시트 대조 |

### 1-7. 재고·차명 감사 (9)

| 파일 | 무엇을 하나 |
|---|---|
| `scripts/audit-master-gap.mts` | 차종마스터에 없는 값 찾기 |
| `scripts/fill-master-gap.mts` | 그 구멍을 마스터에 채우기 |
| `scripts/audit-master-review-backlog.mts` | 「공급사가 올렸는데 ERP 에 안 보인다」의 정체 |
| `scripts/audit-offerable-count.mts` | 「판매가능 몇 대인가」를 코드 판정으로 센다 |
| `scripts/audit-unconfirmed-vehicles.mts` | 「차종 미확정」이 실제로 무엇인가 |
| `scripts/audit-photo-gap.mts` | 사진이 오는 길 셋 중 어디가 끊겼나 |
| `scripts/audit-detail-codes.mts` | 상세페이지에 코드가 새어 나가는 자리 |
| `scripts/audit-vehicle-name-tiers.mts` | 차명이 화면마다 어떻게 조립되는지 |
| `scripts/audit-data-atoms.mts` | 선언 × 소비처 × 운영 필드 존재 감사 |

### 1-8. 그 밖 (5)

| 파일 | 무엇을 하나 | 근거 |
|---|---|---|
| `scripts/lib/db-snapshot.mts` | 스냅샷 1회 받아 파일 캐시 — **PC 가 멈추는 것을 막으려고 만든 공용 헬퍼** | `audit-sheet-live-status`·`inventory-ops`·`sheet-vs-live` 셋이 import 한다. 막으면 그 셋도 죽는다 |
| `scripts/backup-products.mts` | 재스냅 전 전량 백업 | 부르는 것은 `apply-remsnap-backlog`(→지운다) 하나뿐이라 근거가 약하다. **되돌릴 수 없는 일 앞의 백업**이라 남겨 둔다 — 이관 중에 이게 없으면 사고를 못 되돌린다 |
| `scripts/set-user-claims.mts` | Firebase Auth 커스텀 클레임 세팅 | **Firestore 규칙(myCompany·role)이 이걸 요구한다** — 파이어스토어 쪽 일인데 막혔다 |
| `scripts/deploy/ops-watch.mts` | 오픈 당일 관측판 | `npm run ops:watch` |
| `scripts/check-b2b-release.mts` | 제한 오픈 전 게이트 | `npm run check:b2b-release` |

---

## 2. 「남긴다」 21개 — RTDB 를 보는 것이 «일 자체»

앱 이관이 끝나 RTDB 를 **실제로 지우는 날** 같이 지운다. 지금 지우면 되돌릴 길이 없어진다.

⚠ **남긴다 ≠ 막아 둔 채로 둔다.** 아래 ★ 표시는 **지금 도는 회차가 부르므로 빗장을 풀어야 하는 것**이다.

| 파일 | 왜 남기나 |
|---|---|
| `scripts/migrate-rtdb-to-firestore-full.mts` | RTDB → Firestore **전량 복사 본체**. 이관 다리 그 자체 |
| ★ `scripts/mirror-to-firestore.mts` | RTDB `v4/products` → Firestore 미러(정본 미러). **`hourly-sync`·`run-daily` 가 부른다** |
| `scripts/shadow-copy-products-to-firestore.mts` | 이관 1단계 그림자 복사 |
| `scripts/refine-atoms-to-firestore.mts` | RTDB 원문을 정제해 Firestore 원자로 (유효보존·무효치유) |
| `scripts/sync-refined-identity-to-rtdb.mts` | Firestore 정제신원 → RTDB 보강. **앱이 RTDB 를 보는 동안만** 필요 |
| `scripts/sync-settlement-to-firestore.mts` | RTDB(정본) 기준으로 Firestore 정산을 맞춘다 |
| `scripts/capture-erp-first-seen.mts` | RTDB 에만 있는 「처음 본 날」을 **한 번 옮겨 담는다.** 이게 끝나야 `fill-intake-date` 가 RTDB 를 안 본다 |
| `scripts/check-erp3-sync-stopped.mts` | 옛 erp3(v3)가 아직 공급사 시트를 읽는지 — **v3 를 봐야만 판정된다** |
| `scripts/scrub-audit-pii.mts` | v3 `audit_logs` 평문 PII 마스킹. **erp3 가 아직 쓰는 노드**다 |
| `scripts/product-gap.mts` | 브리지를 끄면 목록에서 사라질 차 — v3 살아있는 매물 대조 |
| `scripts/bridge-readiness.mts` | 「v3 없이도 화면이 채워지는가」 엔티티별 준비도 |
| `scripts/audit-v3-only-sheet-coverage.mts` | v3-only 재고 대조(읽기 전용) |
| `scripts/audit-v4-standalone-core.mts` | v4 홀로서기 가능한지 |
| ★ `scripts/deploy/rules-probe.mts` | 보안규칙 **실사격** — 「막힌다고 적어 놓은 것이 정말 막히는가」. `npm run rules:probe` |
| `scripts/ruleprobe/probe.mjs` 외 5 (`probe2`·`probe-inactive`·`release-probe`·`step1`·`vehicle-claim-api-probe`) | RTDB 에뮬레이터 보안규칙 검사. 이중판매 가드·계정 봉합 규칙의 증거물 |
| `scripts/emulator-settlement-rules.mjs` | 정산 노드 규칙 에뮬레이터 하네스 |

---

## 3. 「지운다」 22개 — 아무도 안 부른다

전부 **저장소 어디에서도 코드가 부르지 않고**, 나오는 곳은 지난 기록(`*.md`)뿐이다.

| 파일 | 근거 |
|---|---|
| `scripts/apply-v4-migration.mts` | v3 → v4 이관 ② 적용. 그 이관은 끝났다. 참조 = `MIGRATION_PLAN.md`·`CURSOR-TASKS.md` 뿐 |
| `scripts/verify-v4-migration.mts` | 같은 이관의 ③ 검증 |
| `scripts/preflight-migration.mts` | 같은 이관의 직전 점검. 참조 = `MIGRATION_PLAN.md` 뿐 |
| `scripts/backfill-v4-core-fields.mts` | 같은 이관의 뒷정리(양쪽에 있는 키 메우기) |
| `scripts/migrate-photo-links-to-v4.mts` | v3 `photo_link` → v4 일회성 이관 |
| `scripts/apply-sheet-sync.mts` | 시트 동기화 일회성 반영. 지금은 `hourly-sync` 몫 |
| `scripts/preview-sheet-sync.mts` | 위의 미리보기 |
| `scripts/apply-remsnap-backlog.mts` | 검토대기 적체 재스냅 일회성 반영 |
| `scripts/sim-remsnap-backlog.mts` | 위의 시뮬 |
| `scripts/sim-offerable-rules.mts` | 「판매가능」 기준 A/B/C 시뮬 (일회성 · `INVENTORY_SPEC.md` 만 언급) |
| `scripts/sim-onecell-match.mts` | 「한 칸에 다 넣기」 2차 검증 (2026-08-08 핸드오프 문서만 언급) |
| `scripts/sim-trim-extract.mts` | 트림 추출 시뮬 (같은 문서) |
| `scripts/sim-vehicle-name.mts` | 차명 조립 시뮬 (같은 문서) |
| `scripts/assign-agent-codes.mts` | 영업자 코드 일회성 부여. **참조 0** |
| `scripts/build-vehicle-master-from-sheet.mts` | 시트 → RTDB `vehicle_master` 구축. **그 노드는 2026-09-08 삭제됐다.** 참조 0 |
| `scripts/publish-master-to-rtdb.mts` | **스스로 「⛔ 폐기(2026-09-08) · 실행 금지」라고 적어 놓았다.** 정본 = Firestore |
| `scripts/rtdb-rules.mts` | RTDB 규칙 get/put. **`scripts/deploy/rtdb-rules.mts`(백업→대조→게시→되돌리기)가 대체했고 `npm run rules:status` 는 그쪽을 부른다** |
| `scripts/export-products-to-sheet.mts` | **스스로 「일반 운영 경로가 아니다」**. 지금은 영업자 시트가 입력 정본 |
| `scripts/learn-sheet-mapping.mts` | 시트 매핑 「한 번 학습해서 박는다」. 박았다. 참조 = `IMPLEMENTATION_LOG.md` 뿐 |
| `scripts/migrate-supplier-sheet.mts` | 공급사 시트 표준양식 이관 일회성. 참조 = 2026-08-08 핸드오프 문서뿐 |
| `scripts/seed-sample-supplier.mts` | 샘플 공급사 심기(개발용). 참조 = `IMPLEMENTATION_LOG.md` 뿐 |
| `scripts/make-test-contract.mts` | 전자계약 눌러 보려고 계약 하나 만들기(개발용) |

---

## 4. 「모르겠다」 2개 — 근거가 반반이다

**지어내지 않는다.** 이 둘은 사장님·담당 세션에 물어서 정할 것.

| 파일 | 왜 애매한가 |
|---|---|
| `scripts/apply-sheet-to-erp.mts` | 「영업자 시트를 ERP 로 되읽는다」 — 사장님 2026-08-13 지시가 문서에 박혀 있어 **규격상 살아 있는 일**이다. 그런데 지금 시트→ERP 는 `hourly-sync` 가 한다(CLAUDE.md 「시트→ERP 반영은 매시간 자동동기의 몫」). **둘이 같은 일을 하는지, 이 스크립트가 회차에 흡수됐는지**를 확인해야 갈린다. 부르는 곳은 `publish-handover-tab.mts` 주석 하나 |
| `scripts/migrate-settlement-to-erp.mts` | 정산 시트 → ERP 원장 이관. 「정산 원자 경계 = 2026-08부터」라 **한 번 하고 끝난 일**로 보이는데, `lib/domain/settlement-manual.ts` 와 살아 있는 스크립트 셋(`check-settlement-drift`·`import-settlement-from-sheet`·`issue-settlement-invoices`)이 이름을 대고 있어 **달마다 다시 도는지**를 알 수 없다 |

---

## 5. 이 조사에서 나온 것 — 「막는 것」과 「지우는 것」은 다르다

1. **막힌 125개 중 80개(64%)가 «지금도 쓰는 것»이다.** 정산 회차 27개 · 자동동기 6개 · npm 게이트 10개가
   포함돼 있다. 그대로 머지하면 **정산과 매시간 회차가 둘 다 선다.**
2. **RTDB 를 한 줄도 안 파는 파일 셋이 막혔다** — 그중 하나가 하필
   **「RTDB 폐기가 얼마나 남았나」를 세는 진척 카운터**(`check-rtdb-cutover`)다.
   ★사장님이 답답해하신 까닭이 「끝이 안 보여서」인데, **끝을 보여 주는 도구를 막았다.**
3. **상수 모듈(`deploy/_ctx.mts`)에 빗장을 걸면 그걸 import 하는 것이 전부 죽는다** — RTDB 와 무관한
   `vercel-env` 까지 같이 죽는다. 빗장은 **진입점**에만 건다.
4. **재는 도구는 마지막에 지운다.** 이관을 다 끝내고 나서 「제대로 됐나」를 물으면
   답할 도구가 없다.

### 빗장을 푸는 순서 (제안)

```
① RTDB 를 안 파는 셋       빗장 줄만 지운다              check-rtdb-cutover · check-release · deploy/_ctx
② 재는 도구 여섯           빗장 줄만 지운다(REST 라 그대로 돈다)
③ 회차가 부르는 것 33개    const db = … → firestoreAdminRef() 한 줄
④ 나머지 «옮긴다» 38개     같은 방식으로 차례차례
⑤ 「지운다」 22개          지운다
⑥ 「남긴다」 21개          RTDB 를 실제로 지우는 날 같이 지운다
```

★ **③ 의 한 줄 교체가 되는 근거**는 `check-rtdb-cutover.mts` 문서에 있다 —
「심(`lib/server/firestore-ref-shim`)이 `db.ref()` 를 그대로 흉내 내므로 `const db = …` 한 줄만 바꾸면 된다.
남은 것은 «큰 결단»이 아니라 **배선**이다.」
