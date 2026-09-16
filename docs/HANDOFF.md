# HANDOFF — freepasserp4

CLI 연결 여부와 무관하게 이 저장소를 여는 누구나 여기부터 읽으면 이어받을 수 있다. 이 파일은 저장소 전체 현황이 아니라 **이번 AI Core 통합 세션(2026-09-15/16)에서 실제로 확인한 것만** 담는다 — 날짜 붙은 기존 `docs/HANDOFF-*.md`들은 각자의 사건 기록으로 별도 유지한다.

## 현재 revision

`4d962b2db293a8cc193a106008b0270265dcd30d` (branch `feat/spring-atom-monitor`, default branch 아님, 2026-09-16 확인)

## 현재 작업

없음(이번 세션은 워크트리 인벤토리·미병합 브랜치 후보 조사만 함, 코드 변경 없음).

## 완료된 것

- 없음(이 저장소 자체는)

## 미완료 / 이번 세션이 찾은 것

**워크트리가 50개 이상 흩어져 있다** — `C:\dev\freepasserp4-*`, `.wt-*`, `_wt-*`, `worktrees\*`, `fp-*`, `C:\tmp\*`, Codex 전용 worktree 등. `git worktree list`로 전수 확인 가능. `aiops/docs/저장소지도.md`가 이미 이 문제를 알고 "C:/dev/_worktrees/<repo>/<작업번호>로 모은다"는 재배치안을 세워뒀으나 미실행.

**정정(2026-09-16, 3-way diff 실행 완료)**: 처음엔 `fix/sonokong-rent-plate-classification`이 ERP5 publication-gate 계열의 최신 흡수 지점이라고 가정했으나 틀렸다 — 그 브랜치는 main과 완전히 갈라져 있다(main에 없는 커밋 482개, sonokong에 없는 커밋 402개). **main 기준으로 다시 비교해야 진짜 결론이 나온다.**

**실제로 main에 안 흡수된 것으로 확인된 작업 3개**(main에 해당 파일 없음 확인됨):
- `codex/freepass-inventory-contract` — 사진/시트링크 분리, `lib/domain/inventory-contract.ts` 신규(재고계약 스냅샷 통합)
- `codex/freepass-option-source-audit` — TCar 유료옵션 소싱/파싱, `sonokong/lib/tcar-options.mjs` 신규
- `codex/freepass-source-snapshot-engine` — `lib/server/source-snapshot.ts` 신규(공급사 소스 스냅샷 캡처)

**정정(2026-09-16, 병합 시도 실제 실행)**: 이 3개를 직접 `git merge origin/main`해보니 **각각 40개 이상 파일 충돌**이 났다 — 공통 조상이 main보다 417커밋 뒤처져 있어 브랜치 자체가 너무 오래됨(낡은 문서·삭제된 파일·78,913줄짜리 옛 JSON 등, 진짜 기능 파일이랑 무관한 충돌 다수). **직접 merge 금지.**

**정정(2026-09-16, 실제 cherry-pick 시도 완료)**: 커밋 전체를 그대로 cherry-pick해도 안 된다 — 각 커밋이 신규 기능 파일 외에 main에서 이미 삭제된 옛 스크립트 15개 이상을 같이 건드려서 modify/delete 충돌이 난다. **파일 단위로 골라내야 한다.** 정확한 커밋 SHA와 명령:

```bash
git checkout -b feat/cherry-picks main
git cherry-pick d96d0a0f                    # source-snapshot-engine, 충돌 없이 깨끗하게 적용됨
git checkout df92c014 -- sonokong/lib/tcar-options.mjs scripts/fix-tcar-description-options.mts
git checkout 16b565a2 -- sonokong/lib/tcar-options.mjs sonokong/scripts/손오공.mjs   # 그대로 checkout이 정답 — 수동 병합 불필요
#   ★2026-09-16 정정: 위 줄에 원래 「손오공.mjs는 수동 병합 필요」라고 적혀 있었으나 근거 없는 보수적 경고였다.
#   blob 3자 대조 결과 16b565a2는 df92c014의 직계 자식(사이 커밋 0개)이라 두 변경은 누적 관계이고,
#   main은 fork 이후 손오공.mjs·tcar-options.mjs를 한 줄도 건드리지 않았다(공통조상과 blob 동일).
#   따라서 3-way 병합의 정답이 16b565a2 버전 그대로다. 덮어쓰기는 손실이 아니라 의도된 최신화다.
#   실행 결과: 브랜치 feat/cherry-picks, tsc --noEmit 에러 0 경고 0 통과.
git checkout 18338c6d -- lib/domain/inventory-contract.ts lib/server/sales-publish-snapshot.ts
git checkout c01944f6 -- lib/domain/photo-projection.ts
npm ci && npm run typecheck
```

`sales-publish-snapshot.ts`는 `freepasserp4-0d` 세션이 별도 브랜치(`claude/f86-on-gate`)에서 export 1개만 추가 중이라 실제 충돌 위험 낮음(2026-09-16 직접 확인). typecheck는 격리 워크트리에 node_modules가 없어서 이번 세션에서 실행 못 함 — 사람이 직접 돌려야 한다.

**이미 main에 흡수됐거나 사소해서 버려도 되는 것**: `codex/erp5-publication-gate-current`(순수 subset), `codex/erp5-publication-gate`(main에 이미 있음), `codex/contract-status-erp5-main`/`codex/freepass-freshness-audit`/`codex/source-registry-v2`(main 대비 진짜 미흡수분은 1~3커밋뿐, 이미 main에 있음), `codex/source-registry-current`(문서만).

**안전하게 버려도 될 것으로 보이는 브랜치**: photo 파이프라인 구버전 2개, RTDB 초기 부분조치 2개, 배포 스냅샷용 detached-HEAD worktree들. `codex/rtdb-cutover-current`·`codex/restore-canonical-whitelabel`·`feat/settlement-firestore-cockpit`은 아직 main 기준 재검증 안 함.

## 담당자 없는 이슈 2건 (freepasserp4-4d 세션이 인계, 2026-09-16)

1. **hourly-sync가 회차를 꾸준히 못 닫는다** — 2026-09-16 08:56 실측 기준 마지막 닫힌 회차는 09-14 02:01(약 55시간 전). 매시간 도는 작업이라 이 공백은 비정상. 손님 화면 상단 update 시각이 이 값을 그대로 보여준다. 첫 단서: `tmp/자동동기-상태.json`의 "중단", `hourly-sync-quota-stall.md`(시트 요청한도로 멈춘 전례 있음).
2. **(출처: freepasserp4-a2, 아직 재확인 안 됨) 2026-09-11 08:17 Vercel Production Firebase env에서 `DATABASE_URL` 누락 → 빌드 실패** — 지금도 유효한 문제인지는 미확인, freepasserp4-a2 세션에 직접 확인 필요.

## Blocker

이 저장소는 실운영 배포(Vercel+Firebase) 중이라 워크트리 재배치나 브랜치 병합을 검증 없이 진행하면 배포 경로가 깨질 위험이 있다. 위 "살릴 가치 있는 브랜치" 목록도 3-way diff 대조 전에는 실제로 main에 흡수됐는지 불확실하다.

## 다음 한 작업

위 cherry-pick 명령 시퀀스를 실제로 실행하고 `npm run typecheck` 확인(담당 세션 배정 필요 — 이번 세션은 준비만 함). hourly-sync 55시간 공백 원인 확인이 더 급함(실운영 손님 화면에 바로 보이는 문제).

## 마지막 실제 검증

없음 — 이번 세션은 이 저장소의 빌드/테스트를 실행하지 않았다(`package.json`에 test 스크립트 자체가 없음, `registry/projects.json` known_blockers 참조).

---

## feat/spring-atom-monitor → main 병합 조사 (2026-09-16, 조사만 · 머지 안 함)

대표 결정 전제: **정산을 erp5로 옮기지 않는다 · 9월 정산은 아직 시트에서 한다 · `SETTLEMENT_STORE` 기본값을 안 바꾼다.**
⇒ 이 병합은 동작을 바꾸는 게 아니라 만들어 둔 것을 운영 브랜치에 «올려놓는» 것이다. **그 전제가 성립하는지 실제로 재 봤다.**

### 차이 실측

공통 조상 `4bab085d` (2026-09-04). 이후 **main 451커밋 · 브랜치 461커밋**, 3-way diff `612 files / +246,563 / -91,841`.
461커밋을 «건드린 경로»로 분류(제목 키워드 분류는 이 저장소 문체에선 못 쓴다 — 기타가 286개 나왔다):

| 갈래 | 커밋 |
|---|---|
| 재고/SSOT/견적/상점 | 117 |
| CI·스크립트 | 115 |
| 정산 | 106 |
| 문서 | 48 |
| UI·기타 코드 | 47 |
| 기타(대부분 `data/new-car/genesis-config*.json`) | 28 |

### 충돌 실측 — `git merge-tree` 로만 쟀고 머지 커밋은 안 만들었다

**충돌 파일 110개.** 갈래별 대표:
`.github/workflows/{ci,sales-erp-hourly}.yml` · `package.json` · `middleware.ts` · `firestore.rules` · `CLAUDE.md` · `AGENTS.md` ·
정산 12개(`app/api/settlement/{agents,confirm,invoice,ledger,mine}` · `lib/server/settlement-{store,erp-store,sheet-import}.ts` · `lib/domain/settlement-money.ts` · `scripts/publish-{channel,supplier}-settlement.mts` · `scripts/check-settlement-locked.mts`) ·
상점/견적 UI 약 20개 · `lib/firebase/*`·`lib/server/*` 약 15개 · `scripts/*` 약 20개.
브랜치가 base 대비 **170개 파일을 지웠다** — 그중 main이 살려 둔 것이 있는지는 파일별로 봐야 한다(미확인).

### ★동작 변경 위험 판정표

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | `SETTLEMENT_STORE` 기본값 | **안 바뀐다** | `lib/server/settlement-store.ts:61` 이 main·브랜치 «동일» — `=== 'erp' ? 'erp' : 'sheet'`. 전제 성립. |
| 2 | `ERP5_WHITELABEL_FIRESTORE_ENABLED` | **안 바뀐다** | 양쪽 다 `=== 'true'` 게이트, 기본 OFF(`.env.example:47` = false). |
| 3 | `ATOM_FROM_MONTH` | **안 바뀐다** | 브랜치 신규 상수(`lib/domain/settlement-atom.ts:197` = '2026-08'). main에 없던 파일이라 기존 경로를 안 문다. |
| 4 | **새 cron 이 돈다** | ★**바뀐다** | `.github/workflows/direct-ingest-hourly.yml` 신규 — `cron: '0 0-9 * * 1-5'` **활성**. `scripts/ingest-all-suppliers.mts` 로 **Firestore 에 쓴다.** main 에 올리는 순간 평일 매시 자동 실행된다. |
| 5 | `refresh-30min.yml` 신규 | **안 바뀐다** | cron 이 «의도적으로 꺼져» 있고 `workflow_dispatch` 뿐. 머리말에 켜지 말라고 적혀 있다. |
| 6 | **`sales-erp-hourly.yml` 이 «지금 도는 것»을 끈다** | ★★**바뀐다 — 제일 위험** | 두 쪽이 **정반대**다. main(`145dffb8`, **2026-09-13**)은 「GitHub Actions 가 단일 오케스트레이터」로 `cron: '0 0-9 * * 1-5'` 를 **켜고** `cloud-hourly-sync.mts --apply` 를 돌린다. 브랜치(`420b3b1e`/`e1fda409`, **2026-09-08**)는 「이 집 PC 스케줄러가 오케스트레이터」라며 **cron 을 뺐다.** 충돌 해결에서 브랜치 쪽을 고르면 **지금 도는 매시 동기가 조용히 멈춘다.** ⇒ **main 쪽을 취해야 한다.** ★브랜치 쪽 머리말은 이미 «낡았다» — 같은 브랜치가 2026-09-11 에 `scripts/hourly-sync.cmd` 를 「erp3 폐기·발행 안 함」으로 세웠다. 즉 **양쪽 다 로컬 .cmd 는 안 쓴다**는 데 합의돼 있고, 남은 차이는 cron 유무뿐이다. |
| 7 | `concurrency.group` 이름 바뀜 | **바뀐다(경미)** | 브랜치가 `sales-erp-hourly`·`sheet-sync` → 둘 다 `freepass-sales-publish` 로 묶는다. main 은 옛 이름 유지. 줄서기 대상이 달라진다 — 6번을 main 쪽으로 풀면 함께 정리해야 한다. |
| 8 | **RTDB 참조** | ★**늘어나는 곳이 있다**(총량은 준다) | 총량은 **main 290 → 머지트리 148** 로 «줄지만», **25개 파일에 새로 생긴다.** 그중 운영 경로: `lib/server/firebase-admin.ts`(브랜치는 `getDatabase` import + `NEXT_PUBLIC_FIREBASE_DATABASE_URL` 없으면 **throw**, main 은 이미 다 걷어냄) · `lib/firebase/auth.ts`(`firebase/database` import, main 에 없음) · `lib/server/firestore-ref-shim.ts`(**읽기 RTDB 폴백**) · `app/api/settlement/{ledger,invoice,confirm,agents,mine}/route.ts`(`getDatabase`) · 워크플로 2개가 `NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://freepasserp3-default-rtdb...` 를 **env 로 박는다**. main 은 `lib/domain/vehicle-master-rtdb.ts`·`lib/firebase/rtdb-{adapter,records}.ts` 를 **이미 삭제**했다. ⇒ **전역 RTDB 영구폐기 지침 위반.** 그대로 올리면 안 된다. |
| 9 | **RTDB env 누락 → 빌드 실패 재발** | ★**바뀔 수 있다** | 8번의 `firebase-admin.ts` throw 는 위 「담당자 없는 이슈 2」(2026-09-11 Vercel Production `DATABASE_URL` 누락 → 빌드 실패)와 **같은 고장**이다. main 은 그 의존을 걷어내 고쳤는데, 브랜치 쪽을 취하면 되살아난다. |
| 10 | **CI 가 빨개진다** | ★**바뀐다(실측)** | main 이 CI 에 건 검사를 브랜치 트리에 돌려 봤다 — `check:ui`(UI 계약) **FAIL**, `check:building`(도면) **FAIL**. 같은 검사를 main 트리에 돌리면 **둘 다 PASS**. 즉 **브랜치 코드가 main 의 계약을 깬다.** (main 의 `ShopDetail.tsx`·`ShopFilters.tsx`·`WhitelabelFrame.tsx` 가 이겨야 한다 — 전부 충돌 파일이다.) |
| 11 | 시트에 쓰는 코드의 동작 | **부분 확인 — 나머지는 모른다** | `scripts/hourly-sync.cmd` 는 **양쪽 다 쓰기 없음**(main=RETIRED, 브랜치=erp3 폐기 중지). 시트 규격 잠금 `check-settlement-locked` 는 브랜치 트리에서 **PASS**. 다만 `scripts/publish-{channel,supplier}-settlement.mts`·`lib/server/settlement-sheet-import.ts`·`scripts/hourly-sync.mts` 가 **충돌**이라 실제 쓰기 내용이 어느 쪽으로 가는지는 **해결 전엔 모른다.** ★추측으로 「안 바뀐다」고 쓰지 않는다. |
| 12 | 마이그레이션·일회성 스크립트의 자동 실행 | **모른다** | 4번 워크플로가 `ingest-all-suppliers.mts` 를 부르는 것은 확인했다. `scripts/migrate-*`·`apply-*` 가 자동 경로에 붙는지는 **이번에 전수 확인 못 했다.** |

### 검증 실측

- 임시 워크트리(`C:\c\dev\.wt-mergecheck-tmp`, 조사 후 제거)에 **브랜치 끝단** 체크아웃: `npm ci` **exit 0**, `npm run typecheck` **exit 0 · TS 에러 0**.
- ★**머지 트리는 typecheck 못 한다** — 충돌 110개라 충돌 표식이 박힌 트리밖에 안 나온다. 사람이 해결한 뒤에 돌려야 한다. 「안 돌렸다」가 아니라 **「해결 전엔 못 돈다」**.
- 외부 접속 없는 `scripts/check-*.mts` 만 골라 돌린 결과(브랜치 트리):

| 검사 | 결과 |
|---|---|
| `check-settlement-engine` | **PASS** — 「심장 14장이 저장·세션·시트·화면을 물지 않습니다 — 통째로 떼어낼 수 있습니다」 |
| `check-settlement-cycle` | PASS |
| `check-settlement-locked` | PASS — 정산 시트 규격 그대로 |
| `check-settlement-workstation` | PASS |
| `check-design-locked` | PASS |
| `check-pipeline-contracts` | PASS |
| `check-ui-contract` | **FAIL**(main 에선 PASS) |
| `check-building` | **FAIL**(main 에선 PASS) |
| `check-erp5-firestore-cutover` | 실행 불가(자격증명 필요 — 오프라인 분류가 틀렸다) |

시트·Firestore·RTDB 를 무는 검사 39개는 **안 돌렸다.**

### 병합 계획 — **한 번에 밀지 마라. 정산만 뗀다.**

근거: ①충돌 110개 중 정산은 12개뿐이고 나머지 98개는 상점 UI·재고·스크립트라 정산과 무관하다. ②그 98개를 같이 풀면 위 10번(CI 빨간불)·6번(매시 동기 정지)·8번(RTDB 부활)을 **한 커밋에 다 안고** 간다. ③`check-settlement-engine` 이 **엔진 14장이 저장·시트·화면을 안 문다**고 실측으로 말한다 — 떼어낼 수 있다는 증거다.

**정산 관련 변경 파일 65개의 실제 성격:**
- **신규 31개(main 에 없음 = 충돌 0)** ← 이게 1차로 올릴 것
- 충돌 12개 ← 2차, 사람이 봐야 함
- 충돌 없는 수정 22개 ← 3차

**1차(안전): 충돌 0 · 기본 동작 0 변경.** `git checkout feat/spring-atom-monitor -- <파일>` 로 파일 단위로 얹는다.

```
# ㉠ 셈의 심장 — 순수 모듈, 저장·시트·화면 안 뭄
lib/domain/settlement/engine.ts
lib/domain/settlement-atom.ts
lib/domain/settlement-intake.ts
lib/domain/settlement-link.ts
# ㉡ 결정문
docs/정산-ERP전환-2026-09.md
# ㉢ 검사기(자동 실행 아님)
scripts/check-settlement-{atom,chain,complete,engine,parity,ssot,workstation}.mts
scripts/check-no-rtdb-settlement.mts
# ㉣ 화면·API — SETTLEMENT_STORE 기본이 sheet 라 직원 경로에 안 걸린다
app/api/settlement/{statement,board}/route.ts
app/settlement/{board,board/preview,intake,intake/preview}/page.tsx
app/settlement/intake/layout.tsx  app/settlement/icon.svg
components/settlement/{SettlementBoard,IntakeStation,SamplePreview}.tsx
components/settlement/{board,classic}.css
# ㉤ 손으로만 돌리는 스크립트
scripts/{harvest-settlement-state,order-settlement-tabs,set-settlement-carry,settlement-ask,sync-settlement-to-firestore}.mts
```

★**가능 근거(실측)**: `engine.ts` 는 «배럴»이라 `lib/domain/settlement-{money,stage,fee-table,billstate,timeline,confirm,cycle,invoice,alert,billing-month}` 를 re-export 하는데 **그 10장이 이미 main 에 다 있다.** main 에 없는 건 `settlement-atom.ts` 하나뿐이고 그건 위 ㉠에 들어간다. 그리고 `engine.ts` 안의 RTDB 언급은 **주석과 「금지 import 목록」뿐 — 실코드 없음**(41·165·168행).

⚠ **1차에서 절대 가져오지 말 것**: `lib/server/firebase-admin.ts` · `lib/firebase/auth.ts` · `lib/server/firestore-ref-shim.ts` · `app/api/settlement/{ledger,invoice,confirm,agents,mine}/route.ts` · `.github/workflows/*` — **전부 RTDB 를 되살린다**(8·9번).

**2차(사람이 결정)**: 충돌 12개. 정산 5개 라우트는 **main 의 Firestore 전용 버전 위에 브랜치의 셈만 옮겨 태워야** 한다 — 브랜치 파일을 통째로 덮으면 RTDB 가 따라온다.
**3차**: 워크플로. 6번은 **main 쪽 채택 고정**. 4번 `direct-ingest-hourly.yml` 은 **cron 을 지우고 `workflow_dispatch` 로만** 올린다(대표 승인 전에 자동으로 Firestore 에 쓰게 두지 않는다).
**4차**: 상점 UI·재고. 10번 때문에 `check:ui`·`check:building` 을 **먼저 초록으로 만든 뒤** 손댄다.

### 머지 후 스모크 체크리스트

1. `npm ci && npm run typecheck` — 에러 0 인가(브랜치 단독 기준선 = 0).
2. `npm run check:ui` · `check:building` · `check:design` — **셋 다 초록인가**(지금 브랜치는 앞 둘이 빨갛다).
3. `lib/server/settlement-store.ts:61` 을 **눈으로** 확인 — `: 'sheet'` 가 그대로인가.
4. `git grep -nE "firebase/database|getDatabase|databaseURL" -- lib app .github` — **머지 전 main 결과와 개수가 같은가**. 늘었으면 되돌린다.
5. `.github/workflows/sales-erp-hourly.yml` 에 `cron: '0 0-9 * * 1-5'` 가 **남아 있는가**(사라졌으면 매시 동기가 죽는다).
6. `gh run list --workflow=sales-erp-hourly.yml` — 머지 다음 정각에 **회차가 실제로 돌았는가**.
7. `.github/workflows/direct-ingest-hourly.yml` 에 `schedule:` 이 **없는가**(있으면 승인 없이 Firestore 에 쓴다).
8. 직원 화면: `/settlement` 이 시트 값 그대로 보이는가 — `SETTLEMENT_STORE` 미설정 = sheet.
9. `npx tsx scripts/check-settlement-locked.mts` — 시트 규격 그대로인가.

### 모르는 것 (「없다」로 바꾸지 마라)

- 브랜치가 지운 170개 파일 중 **main 이 아직 쓰는 것이 있는지** — 전수 확인 못 했다.
- 충돌 110개 중 **시트에 실제로 쓰는 코드**(`publish-*-settlement.mts` · `settlement-sheet-import.ts` · `hourly-sync.mts`)가 해결 후 어느 쪽 동작이 되는지.
- `scripts/migrate-*`·`apply-*` 가 자동 실행 경로에 붙는지(12번).
- **머지 트리의 typecheck 숫자** — 충돌 해결 전에는 못 낸다.
- 시트·Firestore 를 무는 검사 39개의 결과.
